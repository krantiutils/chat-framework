import { describe, it, expect } from "vitest";
import {
  classifyError,
  extractBrokenSelectors,
  isLikelyDetection,
  assessSeverity,
  diagnose,
} from "../diagnosis.js";
import { ErrorCategory } from "../types.js";
import type { FixRequest, DOMDiff } from "../types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeError(message: string, stack?: string): FixRequest["error"] {
  return { name: "Error", message, stack };
}

function makeContext(
  overrides: Partial<FixRequest["context"]> = {},
): FixRequest["context"] {
  return {
    screenshot: Buffer.from("fake-png"),
    dom: "<html></html>",
    networkLogs: [],
    lastWorkingCode: "function foo() {}",
    recentChanges: { changes: [], totalChanged: 0, changeRatio: 0 },
    ...overrides,
  };
}

function makeDiff(overrides: Partial<DOMDiff> = {}): DOMDiff {
  return { changes: [], totalChanged: 0, changeRatio: 0, ...overrides };
}

// ─── classifyError ──────────────────────────────────────────────────────────

describe("classifyError", () => {
  it("classifies selector-not-found errors", () => {
    const ctx = makeContext();
    expect(
      classifyError(makeError("Element not found: div.chat-list"), ctx),
    ).toBe(ErrorCategory.SELECTOR_NOT_FOUND);
    expect(
      classifyError(makeError("querySelector failed for selector"), ctx),
    ).toBe(ErrorCategory.SELECTOR_NOT_FOUND);
  });

  it("classifies timeout errors", () => {
    const ctx = makeContext();
    expect(classifyError(makeError("Navigation timeout exceeded"), ctx)).toBe(
      ErrorCategory.TIMEOUT,
    );
    expect(classifyError(makeError("ETIMEDOUT: request timed out"), ctx)).toBe(
      ErrorCategory.TIMEOUT,
    );
  });

  it("classifies auth errors", () => {
    const ctx = makeContext();
    expect(classifyError(makeError("401 Unauthorized"), ctx)).toBe(
      ErrorCategory.AUTH_ERROR,
    );
    expect(classifyError(makeError("Session expired, login required"), ctx)).toBe(
      ErrorCategory.AUTH_ERROR,
    );
  });

  it("classifies network errors", () => {
    const ctx = makeContext();
    expect(classifyError(makeError("ECONNREFUSED 127.0.0.1:443"), ctx)).toBe(
      ErrorCategory.NETWORK_ERROR,
    );
    expect(classifyError(makeError("fetch failed: ENOTFOUND"), ctx)).toBe(
      ErrorCategory.NETWORK_ERROR,
    );
  });

  it("classifies captcha errors", () => {
    const ctx = makeContext();
    expect(classifyError(makeError("Captcha challenge detected"), ctx)).toBe(
      ErrorCategory.CAPTCHA,
    );
    expect(classifyError(makeError("reCAPTCHA verification required"), ctx)).toBe(
      ErrorCategory.CAPTCHA,
    );
  });

  it("classifies rate-limit errors", () => {
    const ctx = makeContext();
    expect(classifyError(makeError("429 Too Many Requests"), ctx)).toBe(
      ErrorCategory.RATE_LIMITED,
    );
    expect(classifyError(makeError("Rate limit exceeded"), ctx)).toBe(
      ErrorCategory.RATE_LIMITED,
    );
  });

  it("classifies unexpected response errors", () => {
    const ctx = makeContext();
    expect(
      classifyError(makeError("Unexpected token < in JSON at position 0"), ctx),
    ).toBe(ErrorCategory.UNEXPECTED_RESPONSE);
  });

  it("returns UNKNOWN for unrecognized errors", () => {
    const ctx = makeContext();
    expect(classifyError(makeError("Something completely different"), ctx)).toBe(
      ErrorCategory.UNKNOWN,
    );
  });

  it("applies rules in priority order (captcha before timeout)", () => {
    const ctx = makeContext();
    // A message that could match multiple rules — captcha should win (earlier rule)
    expect(
      classifyError(makeError("Captcha challenge timed out"), ctx),
    ).toBe(ErrorCategory.CAPTCHA);
  });
});

// ─── extractBrokenSelectors ─────────────────────────────────────────────────

describe("extractBrokenSelectors", () => {
  it("extracts quoted CSS selectors from the error message", () => {
    const err = makeError(`Element not found: 'div.chat-list > span.msg'`);
    expect(extractBrokenSelectors(err)).toContain("div.chat-list > span.msg");
  });

  it("extracts selectors from querySelector calls in the stack", () => {
    const err = makeError("not found", `at querySelector('div#main .content')`);
    expect(extractBrokenSelectors(err)).toContain("div#main .content");
  });

  it("extracts selectors from waitForSelector calls", () => {
    const err = makeError("timeout", `waitForSelector('[data-testid="inbox"]')`);
    expect(extractBrokenSelectors(err)).toContain('[data-testid="inbox"]');
  });

  it("deduplicates selectors found via multiple patterns", () => {
    const err = makeError(
      `querySelector('.foo') failed`,
      `at querySelector('.foo')`,
    );
    const selectors = extractBrokenSelectors(err);
    const fooCount = selectors.filter((s) => s === ".foo").length;
    expect(fooCount).toBe(1);
  });

  it("returns empty array when no selectors found", () => {
    const err = makeError("generic error");
    expect(extractBrokenSelectors(err)).toEqual([]);
  });
});

// ─── isLikelyDetection ─────────────────────────────────────────────────────

describe("isLikelyDetection", () => {
  it("returns true for CAPTCHA category", () => {
    expect(isLikelyDetection(ErrorCategory.CAPTCHA, makeContext())).toBe(true);
  });

  it("returns true for RATE_LIMITED category", () => {
    expect(isLikelyDetection(ErrorCategory.RATE_LIMITED, makeContext())).toBe(true);
  });

  it("returns true for AUTH_ERROR category", () => {
    expect(isLikelyDetection(ErrorCategory.AUTH_ERROR, makeContext())).toBe(true);
  });

  it("returns true when network logs contain detection keywords", () => {
    const ctx = makeContext({
      networkLogs: [
        {
          url: "https://example.com/check",
          method: "GET",
          status: 200,
          headers: {},
          timestamp: 1000,
          responseBody: '{"error": "bot detected, please verify"}',
        },
      ],
    });
    expect(isLikelyDetection(ErrorCategory.UNKNOWN, ctx)).toBe(true);
  });

  it("returns true when network logs contain 429 status", () => {
    const ctx = makeContext({
      networkLogs: [
        {
          url: "https://example.com/api",
          method: "POST",
          status: 429,
          headers: {},
          timestamp: 1000,
        },
      ],
    });
    expect(isLikelyDetection(ErrorCategory.UNKNOWN, ctx)).toBe(true);
  });

  it("returns false for normal selector errors with clean network logs", () => {
    const ctx = makeContext({
      networkLogs: [
        {
          url: "https://example.com/page",
          method: "GET",
          status: 200,
          headers: {},
          timestamp: 1000,
        },
      ],
    });
    expect(isLikelyDetection(ErrorCategory.SELECTOR_NOT_FOUND, ctx)).toBe(false);
  });
});

// ─── assessSeverity ─────────────────────────────────────────────────────────

describe("assessSeverity", () => {
  it("returns critical for AUTH_ERROR", () => {
    expect(assessSeverity(ErrorCategory.AUTH_ERROR, makeDiff())).toBe("critical");
  });

  it("returns critical for CAPTCHA", () => {
    expect(assessSeverity(ErrorCategory.CAPTCHA, makeDiff())).toBe("critical");
  });

  it("returns critical for large DOM change ratio", () => {
    expect(
      assessSeverity(
        ErrorCategory.SELECTOR_NOT_FOUND,
        makeDiff({ changeRatio: 0.6 }),
      ),
    ).toBe("critical");
  });

  it("returns high for SELECTOR_NOT_FOUND with moderate DOM changes", () => {
    expect(
      assessSeverity(
        ErrorCategory.SELECTOR_NOT_FOUND,
        makeDiff({ changeRatio: 0.15 }),
      ),
    ).toBe("high");
  });

  it("returns medium for SELECTOR_NOT_FOUND with small DOM changes", () => {
    expect(
      assessSeverity(
        ErrorCategory.SELECTOR_NOT_FOUND,
        makeDiff({ changeRatio: 0.05 }),
      ),
    ).toBe("medium");
  });

  it("returns high for RATE_LIMITED", () => {
    expect(assessSeverity(ErrorCategory.RATE_LIMITED, makeDiff())).toBe("high");
  });

  it("returns medium for TIMEOUT", () => {
    expect(assessSeverity(ErrorCategory.TIMEOUT, makeDiff())).toBe("medium");
  });

  it("returns low for UNKNOWN", () => {
    expect(assessSeverity(ErrorCategory.UNKNOWN, makeDiff())).toBe("low");
  });
});

// ─── diagnose (integration) ─────────────────────────────────────────────────

describe("diagnose", () => {
  it("produces a complete diagnosis for a selector failure", () => {
    const request: FixRequest = {
      error: makeError(`Element not found: 'div.inbox-list'`),
      context: makeContext({
        recentChanges: {
          changes: [
            {
              type: "modified",
              selector: "div.inbox-list",
              oldValue: "inbox-list",
              newValue: "inbox-container",
            },
          ],
          totalChanged: 1,
          changeRatio: 0.02,
        },
      }),
      platform: "instagram",
      affectedFunction: "InstagramAdapter.getInbox",
    };

    const result = diagnose(request);

    expect(result.category).toBe(ErrorCategory.SELECTOR_NOT_FOUND);
    expect(result.brokenSelectors).toContain("div.inbox-list");
    expect(result.likelyDetection).toBe(false);
    expect(result.severity).toBe("medium");
    expect(result.summary).toContain("DOM selector");
    expect(result.summary).toContain("1 elements changed");
  });

  it("produces a complete diagnosis for a detection scenario", () => {
    const request: FixRequest = {
      error: makeError("reCAPTCHA challenge presented"),
      context: makeContext({
        networkLogs: [
          {
            url: "https://instagram.com/captcha",
            method: "GET",
            status: 403,
            headers: {},
            timestamp: 1000,
            responseBody: "automated browser detected",
          },
        ],
      }),
      platform: "instagram",
      affectedFunction: "InstagramAdapter.login",
    };

    const result = diagnose(request);

    expect(result.category).toBe(ErrorCategory.CAPTCHA);
    expect(result.likelyDetection).toBe(true);
    expect(result.severity).toBe("critical");
  });
});
