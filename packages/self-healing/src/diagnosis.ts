import {
  ErrorCategory,
  FixRequest,
  DiagnosisResult,
  DOMDiff,
} from "./types.js";

// ─── Error Classification ───────────────────────────────────────────────────

/** Pattern table mapping error signals to categories. */
interface ClassificationRule {
  readonly test: (error: FixRequest["error"], context: FixRequest["context"]) => boolean;
  readonly category: ErrorCategory;
}

const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    test: (err) =>
      /selector|queryselector|element not found|no element/i.test(err.message),
    category: ErrorCategory.SELECTOR_NOT_FOUND,
  },
  {
    test: (err) =>
      /captcha|challenge|verify.*human|recaptcha/i.test(err.message),
    category: ErrorCategory.CAPTCHA,
  },
  {
    test: (err) =>
      /rate.?limit|too many requests|429/i.test(err.message),
    category: ErrorCategory.RATE_LIMITED,
  },
  {
    test: (err) =>
      /timeout|timed?\s*out|deadline|ETIMEDOUT/i.test(err.message),
    category: ErrorCategory.TIMEOUT,
  },
  {
    test: (err) =>
      /auth|unauthorized|forbidden|401|403|login.*required|session.*expired/i.test(
        err.message,
      ),
    category: ErrorCategory.AUTH_ERROR,
  },
  {
    test: (err) =>
      /ECONNREFUSED|ENOTFOUND|network|fetch.*fail|ERR_CONNECTION/i.test(
        err.message,
      ),
    category: ErrorCategory.NETWORK_ERROR,
  },
  {
    test: (err) =>
      /unexpected.*response|invalid.*json|unexpected.*token|malformed/i.test(
        err.message,
      ),
    category: ErrorCategory.UNEXPECTED_RESPONSE,
  },
];

/**
 * Classify an error into an {@link ErrorCategory} using pattern matching
 * on the error message and, where applicable, the diagnostic context.
 */
export function classifyError(
  error: FixRequest["error"],
  context: FixRequest["context"],
): ErrorCategory {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.test(error, context)) {
      return rule.category;
    }
  }
  return ErrorCategory.UNKNOWN;
}

// ─── Broken-Selector Extraction ─────────────────────────────────────────────

/** Pull CSS selectors referenced in the error or its stack trace. */
export function extractBrokenSelectors(error: FixRequest["error"]): string[] {
  const seen = new Set<string>();
  const selectors: string[] = [];
  const text = `${error.message}\n${error.stack ?? ""}`;

  function add(selector: string): void {
    if (!seen.has(selector)) {
      seen.add(selector);
      selectors.push(selector);
    }
  }

  // Match selectors inside API calls first (most reliable signal).
  // Use a two-pass approach to handle nested quotes like waitForSelector('[data-testid="inbox"]')
  const apiCall = text.matchAll(
    /(?:querySelector(?:All)?|waitForSelector|\$)\(\s*'([^)]*?)'\s*\)|(?:querySelector(?:All)?|waitForSelector|\$)\(\s*"([^)]*?)"\s*\)/g,
  );
  for (const m of apiCall) {
    const sel = m[1] ?? m[2];
    if (sel) {
      add(sel);
    }
  }

  // Match quoted strings that look like CSS selectors (contain . # [ > ~ + :)
  const quoted = text.matchAll(/['"]([^'"]{2,})['"]/g);
  for (const m of quoted) {
    const candidate = m[1];
    if (/[.#\[>~+:]/.test(candidate)) {
      add(candidate);
    }
  }

  return selectors;
}

// ─── Detection Heuristic ────────────────────────────────────────────────────

/** Heuristic: is this failure likely caused by anti-bot detection? */
export function isLikelyDetection(
  category: ErrorCategory,
  context: FixRequest["context"],
): boolean {
  // Direct detection signals
  if (
    category === ErrorCategory.CAPTCHA ||
    category === ErrorCategory.RATE_LIMITED
  ) {
    return true;
  }

  // Auth errors with no other explanation are often detection
  if (category === ErrorCategory.AUTH_ERROR) {
    return true;
  }

  // Look for detection-related strings in network responses
  for (const log of context.networkLogs) {
    if (log.responseBody) {
      if (/captcha|challenge|bot.*detect|automated/i.test(log.responseBody)) {
        return true;
      }
    }
    // HTTP 429 or 403 from the target platform are suspect
    if (log.status === 429 || log.status === 403) {
      return true;
    }
  }

  return false;
}

// ─── Severity Assessment ────────────────────────────────────────────────────

/** Assign a severity level based on category and DOM change magnitude. */
export function assessSeverity(
  category: ErrorCategory,
  domDiff: DOMDiff,
): DiagnosisResult["severity"] {
  // Detection and auth issues are always critical — they can cascade
  if (
    category === ErrorCategory.AUTH_ERROR ||
    category === ErrorCategory.CAPTCHA
  ) {
    return "critical";
  }

  // Large DOM overhaul means the platform shipped a redesign
  if (domDiff.changeRatio > 0.5) {
    return "critical";
  }

  if (
    category === ErrorCategory.SELECTOR_NOT_FOUND ||
    category === ErrorCategory.UNEXPECTED_RESPONSE
  ) {
    return domDiff.changeRatio > 0.1 ? "high" : "medium";
  }

  if (category === ErrorCategory.RATE_LIMITED) {
    return "high";
  }

  if (
    category === ErrorCategory.TIMEOUT ||
    category === ErrorCategory.NETWORK_ERROR
  ) {
    return "medium";
  }

  return "low";
}

// ─── Summary Generation ─────────────────────────────────────────────────────

const CATEGORY_SUMMARIES: Record<ErrorCategory, string> = {
  [ErrorCategory.SELECTOR_NOT_FOUND]:
    "DOM selector no longer matches — the platform likely updated its UI.",
  [ErrorCategory.TIMEOUT]:
    "Operation timed out — could be performance degradation or element not rendering.",
  [ErrorCategory.AUTH_ERROR]:
    "Authentication failure — session may have expired or bot was detected.",
  [ErrorCategory.NETWORK_ERROR]:
    "Network-level failure — connectivity issue or IP block.",
  [ErrorCategory.UNEXPECTED_RESPONSE]:
    "Platform returned an unexpected response format.",
  [ErrorCategory.CAPTCHA]:
    "Captcha or challenge page encountered — anti-bot detection triggered.",
  [ErrorCategory.RATE_LIMITED]:
    "Rate limiting detected — too many requests in window.",
  [ErrorCategory.UNKNOWN]:
    "Unclassified error — manual investigation may be needed.",
};

function buildSummary(
  category: ErrorCategory,
  brokenSelectors: readonly string[],
  domDiff: DOMDiff,
): string {
  let summary = CATEGORY_SUMMARIES[category];

  if (brokenSelectors.length > 0) {
    summary += ` Broken selectors: ${brokenSelectors.join(", ")}.`;
  }

  if (domDiff.totalChanged > 0) {
    summary += ` DOM diff: ${domDiff.totalChanged} elements changed (${(domDiff.changeRatio * 100).toFixed(1)}% of page).`;
  }

  return summary;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Run the full diagnosis pipeline: classify → extract selectors → assess severity.
 *
 * This is a fast, local operation (no LLM call). It feeds into the fix
 * generator which uses Claude for the expensive reasoning step.
 */
export function diagnose(request: FixRequest): DiagnosisResult {
  const category = classifyError(request.error, request.context);
  const brokenSelectors = extractBrokenSelectors(request.error);
  const likelyDetection = isLikelyDetection(category, request.context);
  const severity = assessSeverity(category, request.context.recentChanges);
  const summary = buildSummary(
    category,
    brokenSelectors,
    request.context.recentChanges,
  );

  return {
    category,
    summary,
    brokenSelectors,
    likelyDetection,
    severity,
  };
}
