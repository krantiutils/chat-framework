import { describe, it, expect } from "vitest";
import {
  _buildUserPrompt,
  _parseFixResponse,
} from "../fix-generator.js";
import { ErrorCategory } from "../types.js";
import type { FixRequest, DiagnosisResult } from "../types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<FixRequest> = {}): FixRequest {
  return {
    error: { name: "Error", message: "Element not found" },
    context: {
      screenshot: Buffer.from("fake-png"),
      dom: "<html><body><div class='new-inbox'></div></body></html>",
      networkLogs: [
        {
          url: "https://instagram.com/api/inbox",
          method: "GET",
          status: 200,
          headers: {},
          timestamp: 1000,
        },
      ],
      lastWorkingCode: `async function getInbox() {\n  return page.waitForSelector('div.inbox');\n}`,
      recentChanges: {
        changes: [
          {
            type: "modified",
            selector: "div.inbox",
            oldValue: "inbox",
            newValue: "new-inbox",
          },
        ],
        totalChanged: 1,
        changeRatio: 0.01,
      },
    },
    platform: "instagram",
    affectedFunction: "InstagramAdapter.getInbox",
    ...overrides,
  };
}

function makeDiagnosis(
  overrides: Partial<DiagnosisResult> = {},
): DiagnosisResult {
  return {
    category: ErrorCategory.SELECTOR_NOT_FOUND,
    summary: "DOM selector changed",
    brokenSelectors: ["div.inbox"],
    likelyDetection: false,
    severity: "medium",
    ...overrides,
  };
}

// ─── _buildUserPrompt ───────────────────────────────────────────────────────

describe("_buildUserPrompt", () => {
  it("includes the error information", () => {
    const prompt = _buildUserPrompt(makeRequest(), makeDiagnosis());
    expect(prompt).toContain("Element not found");
    expect(prompt).toContain("## Error");
  });

  it("includes the diagnosis summary", () => {
    const prompt = _buildUserPrompt(makeRequest(), makeDiagnosis());
    expect(prompt).toContain("SELECTOR_NOT_FOUND");
    expect(prompt).toContain("medium");
    expect(prompt).toContain("div.inbox");
  });

  it("includes the last working code", () => {
    const prompt = _buildUserPrompt(makeRequest(), makeDiagnosis());
    expect(prompt).toContain("waitForSelector");
    expect(prompt).toContain("## Last Working Code");
  });

  it("includes network logs", () => {
    const prompt = _buildUserPrompt(makeRequest(), makeDiagnosis());
    expect(prompt).toContain("instagram.com/api/inbox");
    expect(prompt).toContain("200");
  });

  it("includes DOM changes", () => {
    const prompt = _buildUserPrompt(makeRequest(), makeDiagnosis());
    expect(prompt).toContain("new-inbox");
    expect(prompt).toContain("[modified]");
  });

  it("truncates large DOMs", () => {
    const longDom = "x".repeat(40_000);
    const req = makeRequest({
      context: {
        ...makeRequest().context,
        dom: longDom,
      },
    });
    const prompt = _buildUserPrompt(req, makeDiagnosis());
    expect(prompt).toContain("[truncated]");
    expect(prompt.length).toBeLessThan(longDom.length);
  });

  it("handles empty network logs gracefully", () => {
    const req = makeRequest({
      context: {
        ...makeRequest().context,
        networkLogs: [],
      },
    });
    const prompt = _buildUserPrompt(req, makeDiagnosis());
    expect(prompt).toContain("(none)");
  });
});

// ─── _parseFixResponse ─────────────────────────────────────────────────────

describe("_parseFixResponse", () => {
  const validResponse = JSON.stringify({
    diagnosis: "The div.inbox selector was renamed to div.new-inbox.",
    confidence: 0.9,
    suggestedFix: [
      {
        filePath: "packages/adapters/src/instagram.ts",
        startLine: 2,
        endLine: 2,
        originalCode: "  return page.waitForSelector('div.inbox');",
        replacementCode: "  return page.waitForSelector('div.new-inbox');",
      },
    ],
    testCases: [
      {
        name: "getInbox uses updated selector",
        description: "Verifies the inbox selector matches the new DOM",
        code: `import { describe, it, expect } from "vitest";\ndescribe("getInbox", () => { it("works", () => { expect(true).toBe(true); }); });`,
        filePath: "packages/adapters/src/__tests__/instagram-inbox.test.ts",
      },
    ],
    rollbackPlan:
      "git revert HEAD to undo the selector change in instagram.ts",
  });

  it("parses a valid response", () => {
    const result = _parseFixResponse(validResponse);
    expect(result.diagnosis).toContain("div.inbox");
    expect(result.confidence).toBe(0.9);
    expect(result.suggestedFix).toHaveLength(1);
    expect(result.suggestedFix[0].filePath).toBe(
      "packages/adapters/src/instagram.ts",
    );
    expect(result.testCases).toHaveLength(1);
    expect(result.rollbackPlan).toContain("git revert");
  });

  it("strips markdown code fences", () => {
    const wrapped = "```json\n" + validResponse + "\n```";
    const result = _parseFixResponse(wrapped);
    expect(result.confidence).toBe(0.9);
  });

  it("throws on invalid JSON", () => {
    expect(() => _parseFixResponse("not json at all")).toThrow(
      /invalid JSON/i,
    );
  });

  it("throws on non-object JSON", () => {
    expect(() => _parseFixResponse('"a string"')).toThrow(/non-object/i);
  });

  it("throws on missing diagnosis", () => {
    const bad = JSON.stringify({
      confidence: 0.5,
      suggestedFix: [],
      testCases: [],
      rollbackPlan: "revert",
    });
    expect(() => _parseFixResponse(bad)).toThrow(/diagnosis/i);
  });

  it("throws on confidence out of range", () => {
    const bad = JSON.stringify({
      diagnosis: "test",
      confidence: 1.5,
      suggestedFix: [],
      testCases: [],
      rollbackPlan: "revert",
    });
    expect(() => _parseFixResponse(bad)).toThrow(/confidence/i);
  });

  it("throws on missing suggestedFix array", () => {
    const bad = JSON.stringify({
      diagnosis: "test",
      confidence: 0.5,
      suggestedFix: "not an array",
      testCases: [],
      rollbackPlan: "revert",
    });
    expect(() => _parseFixResponse(bad)).toThrow(/suggestedFix/i);
  });

  it("throws on invalid patch entry", () => {
    const bad = JSON.stringify({
      diagnosis: "test",
      confidence: 0.5,
      suggestedFix: [{ filePath: 123 }],
      testCases: [],
      rollbackPlan: "revert",
    });
    expect(() => _parseFixResponse(bad)).toThrow(/filePath/i);
  });

  it("throws on missing testCases array", () => {
    const bad = JSON.stringify({
      diagnosis: "test",
      confidence: 0.5,
      suggestedFix: [],
      rollbackPlan: "revert",
    });
    expect(() => _parseFixResponse(bad)).toThrow(/testCases/i);
  });

  it("throws on missing rollbackPlan", () => {
    const bad = JSON.stringify({
      diagnosis: "test",
      confidence: 0.5,
      suggestedFix: [],
      testCases: [],
    });
    expect(() => _parseFixResponse(bad)).toThrow(/rollbackPlan/i);
  });
});
