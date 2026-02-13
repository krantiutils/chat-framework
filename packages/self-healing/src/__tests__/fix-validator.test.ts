import { describe, it, expect } from "vitest";
import {
  applyPatches,
  PatchMismatchError,
  validateFix,
  buildRevertPatches,
} from "../fix-validator.js";
import type { TestRunner } from "../fix-validator.js";
import type { CodePatch, FixResponse, ValidationResult } from "../types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFiles(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

function makePatch(overrides: Partial<CodePatch> = {}): CodePatch {
  return {
    filePath: "src/adapter.ts",
    startLine: 2,
    endLine: 2,
    originalCode: '  return page.$(\'div.inbox\');',
    replacementCode: '  return page.$(\'div.new-inbox\');',
    ...overrides,
  };
}

function makeFixResponse(overrides: Partial<FixResponse> = {}): FixResponse {
  return {
    diagnosis: "Selector changed",
    confidence: 0.9,
    suggestedFix: [makePatch()],
    testCases: [
      {
        name: "test selector",
        description: "checks new selector",
        code: "expect(true).toBe(true)",
        filePath: "src/__tests__/adapter.test.ts",
      },
    ],
    rollbackPlan: "git revert HEAD",
    ...overrides,
  };
}

function makePassingRunner(): TestRunner {
  return {
    async run(_testCases, _patchedFiles): Promise<ValidationResult> {
      return {
        passed: true,
        totalTests: _testCases.length,
        passedTests: _testCases.length,
        failedTests: 0,
        failures: [],
        durationMs: 100,
      };
    },
  };
}

function makeFailingRunner(error: string): TestRunner {
  return {
    async run(testCases): Promise<ValidationResult> {
      return {
        passed: false,
        totalTests: testCases.length,
        passedTests: 0,
        failedTests: testCases.length,
        failures: [{ testName: testCases[0]?.name ?? "unknown", error }],
        durationMs: 50,
      };
    },
  };
}

// ─── applyPatches ───────────────────────────────────────────────────────────

describe("applyPatches", () => {
  it("applies a single-line replacement", () => {
    const files = makeFiles({
      "src/adapter.ts": `function getInbox() {\n  return page.$('div.inbox');\n}`,
    });
    const patches = [makePatch()];
    const result = applyPatches(files, patches);

    expect(result.get("src/adapter.ts")).toContain("div.new-inbox");
    expect(result.get("src/adapter.ts")).not.toContain("'div.inbox'");
  });

  it("applies multiple patches to the same file (bottom-up)", () => {
    const files = makeFiles({
      "src/adapter.ts": [
        "function getInbox() {",
        "  return page.$('div.inbox');",
        "}",
        "function getMessages() {",
        "  return page.$('div.messages');",
        "}",
      ].join("\n"),
    });

    const patches: CodePatch[] = [
      {
        filePath: "src/adapter.ts",
        startLine: 2,
        endLine: 2,
        originalCode: "  return page.$('div.inbox');",
        replacementCode: "  return page.$('div.new-inbox');",
      },
      {
        filePath: "src/adapter.ts",
        startLine: 5,
        endLine: 5,
        originalCode: "  return page.$('div.messages');",
        replacementCode: "  return page.$('div.msg-list');",
      },
    ];

    const result = applyPatches(files, patches);
    const output = result.get("src/adapter.ts")!;

    expect(output).toContain("div.new-inbox");
    expect(output).toContain("div.msg-list");
  });

  it("applies patches to different files", () => {
    const files = makeFiles({
      "a.ts": "line1\nline2\nline3",
      "b.ts": "alpha\nbeta\ngamma",
    });

    const patches: CodePatch[] = [
      {
        filePath: "a.ts",
        startLine: 2,
        endLine: 2,
        originalCode: "line2",
        replacementCode: "LINE_TWO",
      },
      {
        filePath: "b.ts",
        startLine: 1,
        endLine: 1,
        originalCode: "alpha",
        replacementCode: "ALPHA",
      },
    ];

    const result = applyPatches(files, patches);
    expect(result.get("a.ts")).toBe("line1\nLINE_TWO\nline3");
    expect(result.get("b.ts")).toBe("ALPHA\nbeta\ngamma");
  });

  it("throws PatchMismatchError when original code doesn't match", () => {
    const files = makeFiles({
      "src/adapter.ts": "function x() {\n  return 42;\n}",
    });
    const patches = [makePatch()]; // expects 'page.$(div.inbox)' on line 2

    expect(() => applyPatches(files, patches)).toThrow(PatchMismatchError);
  });

  it("throws when target file doesn't exist", () => {
    const files = makeFiles({});
    const patches = [makePatch({ filePath: "nonexistent.ts" })];

    expect(() => applyPatches(files, patches)).toThrow(/does not exist/);
  });

  it("throws when line numbers are out of range", () => {
    const files = makeFiles({ "src/adapter.ts": "one line" });
    const patches = [makePatch({ startLine: 5, endLine: 10 })];

    expect(() => applyPatches(files, patches)).toThrow(/lines 5-10/);
  });

  it("handles multi-line replacements", () => {
    const files = makeFiles({
      "src/adapter.ts": "line1\nline2\nline3\nline4",
    });

    const patches: CodePatch[] = [
      {
        filePath: "src/adapter.ts",
        startLine: 2,
        endLine: 3,
        originalCode: "line2\nline3",
        replacementCode: "replaced2\nreplaced3\nextraLine",
      },
    ];

    const result = applyPatches(files, patches);
    expect(result.get("src/adapter.ts")).toBe(
      "line1\nreplaced2\nreplaced3\nextraLine\nline4",
    );
  });

  it("preserves files not touched by patches", () => {
    const files = makeFiles({
      "a.ts": "unchanged",
      "b.ts": "line1\nline2",
    });
    const patches: CodePatch[] = [
      {
        filePath: "b.ts",
        startLine: 1,
        endLine: 1,
        originalCode: "line1",
        replacementCode: "CHANGED",
      },
    ];

    const result = applyPatches(files, patches);
    expect(result.get("a.ts")).toBe("unchanged");
  });
});

// ─── validateFix ────────────────────────────────────────────────────────────

describe("validateFix", () => {
  it("returns passed=true when patches apply and tests pass", async () => {
    const files = makeFiles({
      "src/adapter.ts": `function getInbox() {\n  return page.$('div.inbox');\n}`,
    });
    const fix = makeFixResponse();
    const runner = makePassingRunner();

    const result = await validateFix(fix, files, runner);

    expect(result.passed).toBe(true);
    expect(result.passedTests).toBe(1);
    expect(result.failedTests).toBe(0);
  });

  it("returns passed=false when patch application fails", async () => {
    const files = makeFiles({
      "src/adapter.ts": "completely different content",
    });
    const fix = makeFixResponse();
    const runner = makePassingRunner();

    const result = await validateFix(fix, files, runner);

    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].testName).toBe("(patch application)");
  });

  it("returns passed=false when tests fail", async () => {
    const files = makeFiles({
      "src/adapter.ts": `function getInbox() {\n  return page.$('div.inbox');\n}`,
    });
    const fix = makeFixResponse();
    const runner = makeFailingRunner("assertion failed");

    const result = await validateFix(fix, files, runner);

    expect(result.passed).toBe(false);
    expect(result.failures[0].error).toBe("assertion failed");
  });

  it("returns passed=false when fix has no test cases", async () => {
    const files = makeFiles({
      "src/adapter.ts": `function getInbox() {\n  return page.$('div.inbox');\n}`,
    });
    const fix = makeFixResponse({ testCases: [] });
    const runner = makePassingRunner();

    const result = await validateFix(fix, files, runner);

    expect(result.passed).toBe(false);
    expect(result.failures[0].testName).toBe("(no tests)");
  });
});

// ─── buildRevertPatches ─────────────────────────────────────────────────────

describe("buildRevertPatches", () => {
  it("swaps original and replacement code", () => {
    const patches: CodePatch[] = [
      {
        filePath: "a.ts",
        startLine: 5,
        endLine: 5,
        originalCode: "old code",
        replacementCode: "new code",
      },
    ];

    const revert = buildRevertPatches(patches);
    expect(revert).toHaveLength(1);
    expect(revert[0].originalCode).toBe("new code");
    expect(revert[0].replacementCode).toBe("old code");
    expect(revert[0].filePath).toBe("a.ts");
  });

  it("adjusts endLine for multi-line replacements", () => {
    const patches: CodePatch[] = [
      {
        filePath: "a.ts",
        startLine: 1,
        endLine: 2,
        originalCode: "line1\nline2",
        replacementCode: "new1\nnew2\nnew3",
      },
    ];

    const revert = buildRevertPatches(patches);
    // The replacement has 3 lines starting at line 1, so endLine = 1 + 3 - 1 = 3
    expect(revert[0].startLine).toBe(1);
    expect(revert[0].endLine).toBe(3);
  });
});
