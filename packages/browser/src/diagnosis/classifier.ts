import {
  ErrorCategory,
  type ErrorClassification,
  type DOMDiff,
  type DOMSnapshot,
} from './types.js';

/**
 * Patterns that indicate specific error categories based on error messages,
 * DOM state, and network signals.
 */
interface ClassificationRule {
  category: ErrorCategory;
  /** Test the error message */
  errorPatterns?: RegExp[];
  /** Test console messages from the snapshot */
  consolePatterns?: RegExp[];
  /** Test failed request URLs */
  networkPatterns?: RegExp[];
  /** Test conditions on the DOM diff */
  diffCondition?: (diff: DOMDiff) => boolean;
  /** Test conditions on the page content */
  contentPatterns?: RegExp[];
  /** Base weight of this rule (0.0 to 1.0) */
  weight: number;
}

const DETECTION_CONTENT_PATTERNS = [
  /captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /challenge/i,
  /bot.?detect/i,
  /access.?denied/i,
  /blocked/i,
  /security.?check/i,
  /cloudflare/i,
  /ddos.?protection/i,
  /please.?verify/i,
  /are.?you.?human/i,
  /unusual.?traffic/i,
];

const AUTH_CONTENT_PATTERNS = [
  /login/i,
  /sign.?in/i,
  /session.?expired/i,
  /unauthorized/i,
  /forbidden/i,
  /authentication/i,
  /log.?in.?again/i,
  /credentials/i,
];

const RULES: ClassificationRule[] = [
  // Selector stale — element existed before but changed/moved
  {
    category: ErrorCategory.SELECTOR_STALE,
    errorPatterns: [
      /stale.?element/i,
      /element.?is.?not.?attached/i,
      /detached/i,
      /node.?is.?detached/i,
    ],
    diffCondition: (diff) =>
      diff.changedElements.some((el) =>
        el.changes.some((c) => c.property === 'outerHTML' || c.property === 'tagName'),
      ),
    weight: 0.8,
  },

  // Element missing — selector no longer matches anything
  {
    category: ErrorCategory.ELEMENT_MISSING,
    errorPatterns: [
      /no.?node.?found/i,
      /waiting.?for.?selector/i,
      /failed.?to.?find/i,
      /element.?not.?found/i,
      /querySelector.?returned.?null/i,
      /cannot.?find/i,
    ],
    diffCondition: (diff) => diff.removedSelectors.length > 0,
    weight: 0.85,
  },

  // Layout shift — element exists but moved
  {
    category: ErrorCategory.LAYOUT_SHIFT,
    errorPatterns: [
      /element.?is.?not.?clickable/i,
      /intercepted/i,
      /obscured/i,
      /not.?visible/i,
      /outside.?viewport/i,
    ],
    diffCondition: (diff) =>
      diff.changedElements.some((el) =>
        el.changes.some((c) => c.property === 'boundingBox'),
      ),
    weight: 0.7,
  },

  // Navigation failure
  {
    category: ErrorCategory.NAVIGATION_FAILURE,
    errorPatterns: [
      /navigation/i,
      /net::ERR_/i,
      /ERR_CONNECTION/i,
      /ERR_NAME_NOT_RESOLVED/i,
      /ERR_ABORTED/i,
      /ERR_BLOCKED/i,
      /ERR_CERT/i,
      /navigat.*failed/i,
      /navigat.*timeout/i,
    ],
    diffCondition: (diff) => diff.urlChanged,
    weight: 0.75,
  },

  // Detection — bot detection triggered
  {
    category: ErrorCategory.DETECTION,
    contentPatterns: DETECTION_CONTENT_PATTERNS,
    consolePatterns: [/captcha/i, /challenge/i, /bot/i],
    weight: 0.9,
  },

  // Network error
  {
    category: ErrorCategory.NETWORK_ERROR,
    errorPatterns: [
      /net::ERR_/i,
      /ECONNREFUSED/i,
      /ECONNRESET/i,
      /ETIMEDOUT/i,
      /ENOTFOUND/i,
      /socket.?hang.?up/i,
      /fetch.?failed/i,
      /network.?error/i,
    ],
    weight: 0.8,
  },

  // Timeout
  {
    category: ErrorCategory.TIMEOUT,
    errorPatterns: [
      /timeout/i,
      /timed.?out/i,
      /exceeded.*time/i,
      /deadline/i,
    ],
    weight: 0.7,
  },

  // Auth failure
  {
    category: ErrorCategory.AUTH_FAILURE,
    errorPatterns: [/401/i, /403/i, /unauthorized/i, /forbidden/i],
    contentPatterns: AUTH_CONTENT_PATTERNS,
    networkPatterns: [/401/, /403/],
    weight: 0.75,
  },
];

/**
 * Classifies browser automation errors into categories based on
 * error messages, DOM diffs, console logs, and network state.
 *
 * Uses a weighted rule system where each rule contributes a score
 * to one or more categories. The category with the highest aggregate
 * score wins.
 */
export class ErrorClassifier {
  /**
   * Classify an error based on all available signals.
   *
   * @param error - The error that occurred
   * @param diff - DOM diff between before/after states (may be null)
   * @param snapshotAfter - DOM snapshot after the error (may be null)
   * @returns Classification with confidence and reasoning
   */
  classify(
    error: Error,
    diff: DOMDiff | null,
    snapshotAfter: DOMSnapshot | null,
  ): ErrorClassification {
    const scores = new Map<ErrorCategory, { score: number; reasons: string[] }>();

    // Initialize all categories
    for (const cat of Object.values(ErrorCategory)) {
      scores.set(cat, { score: 0, reasons: [] });
    }

    for (const rule of RULES) {
      let ruleScore = 0;
      const reasons: string[] = [];

      // Check error message patterns
      if (rule.errorPatterns) {
        for (const pattern of rule.errorPatterns) {
          if (pattern.test(error.message)) {
            ruleScore += rule.weight;
            reasons.push(`Error message matches pattern: ${pattern.source}`);
            break; // One match per pattern set is sufficient
          }
        }
      }

      // Check DOM diff conditions
      if (rule.diffCondition && diff) {
        if (rule.diffCondition(diff)) {
          ruleScore += rule.weight * 0.6;
          reasons.push('DOM diff condition matched');
        }
      }

      // Check console message patterns
      if (rule.consolePatterns && snapshotAfter) {
        for (const entry of snapshotAfter.consoleMessages) {
          for (const pattern of rule.consolePatterns) {
            if (pattern.test(entry.text)) {
              ruleScore += rule.weight * 0.4;
              reasons.push(`Console message matches: "${entry.text.substring(0, 100)}"`);
              break;
            }
          }
        }
      }

      // Check page content patterns
      if (rule.contentPatterns && snapshotAfter) {
        for (const pattern of rule.contentPatterns) {
          if (pattern.test(snapshotAfter.documentHTML)) {
            ruleScore += rule.weight * 0.5;
            reasons.push(`Page content matches pattern: ${pattern.source}`);
            break;
          }
        }
      }

      // Check network failure patterns
      if (rule.networkPatterns && snapshotAfter) {
        for (const req of snapshotAfter.failedRequests) {
          const statusStr = String(req.statusCode ?? '');
          for (const pattern of rule.networkPatterns) {
            if (pattern.test(req.url) || pattern.test(statusStr) || pattern.test(req.errorText)) {
              ruleScore += rule.weight * 0.3;
              reasons.push(`Network failure matches: ${req.url} (${req.errorText})`);
              break;
            }
          }
        }
      }

      if (ruleScore > 0) {
        const entry = scores.get(rule.category)!;
        entry.score += ruleScore;
        entry.reasons.push(...reasons);
      }
    }

    // Sort categories by score
    const sorted = [...scores.entries()]
      .filter(([, v]) => v.score > 0)
      .sort((a, b) => b[1].score - a[1].score);

    if (sorted.length === 0) {
      return {
        category: ErrorCategory.UNKNOWN,
        confidence: 0.1,
        reasoning: `No classification rules matched for error: ${error.message}`,
        secondaryCategories: [],
      };
    }

    const [primaryCategory, primaryData] = sorted[0];
    // Max possible per-rule: weight(0.9) + diff(0.9*0.6) + console(0.9*0.4) + content(0.9*0.5) + network(0.9*0.3) = 2.52
    // Use 2.5 as a practical normalization ceiling (slight overconfidence is acceptable)
    const maxPossibleScore = 2.5;
    const confidence = Math.min(1.0, primaryData.score / maxPossibleScore);

    const secondaryCategories = sorted.slice(1, 4).map(([cat, data]) => ({
      category: cat,
      confidence: Math.min(1.0, data.score / maxPossibleScore),
    }));

    return {
      category: primaryCategory,
      confidence,
      reasoning: primaryData.reasons.join('; '),
      secondaryCategories,
    };
  }
}
