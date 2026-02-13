import {
  CodePatch,
  TestCase,
  FixResponse,
  ValidationResult,
  TestFailure,
} from "./types.js";

// ─── Patch Application ─────────────────────────────────────────────────────

/**
 * Apply a set of code patches to a virtual file system (path → content map).
 * Throws if a patch's `originalCode` doesn't match the target region.
 *
 * Patches are applied in reverse line-order within each file so that earlier
 * patches don't shift line numbers for later ones.
 */
export function applyPatches(
  files: ReadonlyMap<string, string>,
  patches: readonly CodePatch[],
): Map<string, string> {
  const result = new Map(files);

  // Group patches by file
  const byFile = new Map<string, CodePatch[]>();
  for (const patch of patches) {
    const group = byFile.get(patch.filePath) ?? [];
    group.push(patch);
    byFile.set(patch.filePath, group);
  }

  for (const [filePath, filePatches] of byFile) {
    const content = result.get(filePath);
    if (content === undefined) {
      throw new Error(
        `Patch targets file "${filePath}" which does not exist in the file set.`,
      );
    }

    const lines = content.split("\n");

    // Sort patches by startLine descending so we apply bottom-up
    const sorted = [...filePatches].sort(
      (a, b) => b.startLine - a.startLine,
    );

    for (const patch of sorted) {
      // Lines are 1-indexed in patches
      const start = patch.startLine - 1;
      const end = patch.endLine; // endLine is inclusive, splice end is exclusive

      if (start < 0 || end > lines.length) {
        throw new Error(
          `Patch for "${filePath}" references lines ${patch.startLine}-${patch.endLine} ` +
            `but file has ${lines.length} lines.`,
        );
      }

      const originalRegion = lines.slice(start, end).join("\n");
      const normalizedOriginal = originalRegion.replace(/\s+/g, " ").trim();
      const normalizedExpected = patch.originalCode.replace(/\s+/g, " ").trim();

      if (normalizedOriginal !== normalizedExpected) {
        throw new PatchMismatchError(
          filePath,
          patch.startLine,
          patch.endLine,
          patch.originalCode,
          originalRegion,
        );
      }

      const replacementLines = patch.replacementCode.split("\n");
      lines.splice(start, end - start, ...replacementLines);
    }

    result.set(filePath, lines.join("\n"));
  }

  return result;
}

/** Thrown when a patch's `originalCode` doesn't match the actual file content. */
export class PatchMismatchError extends Error {
  constructor(
    readonly filePath: string,
    readonly startLine: number,
    readonly endLine: number,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `Patch mismatch in "${filePath}" lines ${startLine}-${endLine}.\n` +
        `Expected:\n${expected}\nActual:\n${actual}`,
    );
    this.name = "PatchMismatchError";
  }
}

// ─── Test Execution ─────────────────────────────────────────────────────────

/**
 * Strategy for executing generated tests.
 * The self-healing engine injects the real implementation;
 * tests use a mock by default.
 */
export interface TestRunner {
  /**
   * Write test files to disk, run them, and return results.
   * @param testCases - Test cases to execute.
   * @param patchedFiles - Map of filePath → patched content (for sandboxed execution).
   * @returns Aggregated validation result.
   */
  run(
    testCases: readonly TestCase[],
    patchedFiles: ReadonlyMap<string, string>,
  ): Promise<ValidationResult>;
}

/**
 * Validate a fix by applying its patches and running its generated tests.
 *
 * @param fix - The fix response from the generator.
 * @param currentFiles - Current file contents (path → content).
 * @param runner - Test execution strategy.
 * @returns Validation result indicating whether the fix is sound.
 */
export async function validateFix(
  fix: FixResponse,
  currentFiles: ReadonlyMap<string, string>,
  runner: TestRunner,
): Promise<ValidationResult> {
  // 1. Apply patches
  let patchedFiles: Map<string, string>;
  try {
    patchedFiles = applyPatches(currentFiles, fix.suggestedFix);
  } catch (error) {
    // Patch application failure is an immediate validation failure
    return {
      passed: false,
      totalTests: fix.testCases.length,
      passedTests: 0,
      failedTests: fix.testCases.length,
      failures: [
        {
          testName: "(patch application)",
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      ],
      durationMs: 0,
    };
  }

  // 2. No test cases → can't validate → fail
  if (fix.testCases.length === 0) {
    return {
      passed: false,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      failures: [
        {
          testName: "(no tests)",
          error: "Fix has no test cases — cannot validate correctness.",
        },
      ],
      durationMs: 0,
    };
  }

  // 3. Run the generated tests against the patched code
  return runner.run(fix.testCases, patchedFiles);
}

// ─── Revert Utility ─────────────────────────────────────────────────────────

/**
 * Build a revert patch set from an original patch set.
 * Each revert patch swaps `originalCode` and `replacementCode`.
 */
export function buildRevertPatches(
  patches: readonly CodePatch[],
): CodePatch[] {
  return patches.map((patch) => ({
    filePath: patch.filePath,
    startLine: patch.startLine,
    endLine: patch.startLine + patch.replacementCode.split("\n").length - 1,
    originalCode: patch.replacementCode,
    replacementCode: patch.originalCode,
  }));
}
