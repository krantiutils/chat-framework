/**
 * DeployPipeline — applies fixes and manages staged rollouts.
 *
 * Responsibilities:
 * 1. Evaluate whether a fix should be auto-deployed, staged, or manual-reviewed
 * 2. Apply code patches to the filesystem
 * 3. Write generated test files
 * 4. Execute tests to validate the fix
 * 5. Track rollout stages (10% → 50% → 100%)
 * 6. Provide rollback capability
 *
 * The pipeline does NOT do git operations directly. It delegates those to
 * a provided CommandRunner interface so callers can control the execution
 * environment (and tests can mock it).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  CodePatch,
  DeploymentDecision,
  DeploymentResult,
  DeploymentStrategy,
  FixResponse,
  RolloutStage,
  TestCase,
} from './types.js';

// ---------------------------------------------------------------------------
// Command runner abstraction (for git, test execution, etc.)
// ---------------------------------------------------------------------------

/** Result of running a shell command. */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Abstraction for executing shell commands.
 *
 * Implementations may shell out to child_process, run in a sandbox, etc.
 * Tests inject a mock.
 */
export interface CommandRunner {
  run(command: string, cwd?: string): Promise<CommandResult>;
}

// ---------------------------------------------------------------------------
// Patch applier
// ---------------------------------------------------------------------------

export interface PatchResult {
  filePath: string;
  success: boolean;
  error?: string;
  /** Original file content for rollback. */
  originalContent?: string;
}

/**
 * Apply a list of code patches to the filesystem.
 *
 * Each patch does a find-and-replace of originalCode → newCode in the
 * target file. Returns results for each patch including original content
 * for rollback purposes.
 *
 * @param patches - Ordered list of patches to apply.
 * @param projectRoot - Absolute path to the project root.
 */
export async function applyPatches(
  patches: CodePatch[],
  projectRoot: string,
): Promise<PatchResult[]> {
  const results: PatchResult[] = [];

  for (const patch of patches) {
    const filePath = resolvePath(projectRoot, patch.filePath);

    try {
      const originalContent = await readFile(filePath, 'utf-8');

      if (!originalContent.includes(patch.originalCode)) {
        results.push({
          filePath: patch.filePath,
          success: false,
          error: `Original code not found in ${patch.filePath}. The file may have been modified since diagnosis.`,
          originalContent,
        });
        continue;
      }

      // Replace first occurrence only — patches should be precise
      const newContent = originalContent.replace(patch.originalCode, patch.newCode);
      await writeFile(filePath, newContent, 'utf-8');

      results.push({
        filePath: patch.filePath,
        success: true,
        originalContent,
      });
    } catch (err) {
      results.push({
        filePath: patch.filePath,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * Revert previously applied patches using stored original content.
 */
export async function revertPatches(
  patchResults: PatchResult[],
  projectRoot: string,
): Promise<void> {
  // Revert in reverse order
  for (let i = patchResults.length - 1; i >= 0; i--) {
    const result = patchResults[i];
    if (result.success && result.originalContent !== undefined) {
      const filePath = resolvePath(projectRoot, result.filePath);
      await writeFile(filePath, result.originalContent, 'utf-8');
    }
  }
}

// ---------------------------------------------------------------------------
// Test writer and runner
// ---------------------------------------------------------------------------

/**
 * Write generated test case files to the filesystem.
 */
export async function writeTestCases(
  testCases: TestCase[],
  projectRoot: string,
): Promise<void> {
  for (const testCase of testCases) {
    const filePath = resolvePath(projectRoot, testCase.filePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, testCase.code, 'utf-8');
  }
}

/**
 * Run the project's test suite and return whether tests passed.
 */
export async function runTests(
  runner: CommandRunner,
  projectRoot: string,
): Promise<{ passed: boolean; output: string }> {
  const result = await runner.run('pnpm test', projectRoot);
  return {
    passed: result.exitCode === 0,
    output: result.stdout + '\n' + result.stderr,
  };
}

// ---------------------------------------------------------------------------
// Deployment decision engine
// ---------------------------------------------------------------------------

/**
 * Determine the deployment strategy based on fix confidence and characteristics.
 */
export function evaluateDeployment(
  fix: FixResponse,
  autoDeployThreshold: number,
): DeploymentDecision {
  // No patches = nothing to deploy
  if (fix.patches.length === 0) {
    return {
      strategy: 'manual',
      reason: 'No code patches generated — manual investigation required.',
      fix,
    };
  }

  // Low confidence = manual review
  if (fix.confidence < 0.4) {
    return {
      strategy: 'manual',
      reason: `Low confidence (${fix.confidence.toFixed(2)}). Fix is speculative and requires human review.`,
      fix,
    };
  }

  // High confidence with tests = auto deploy
  if (fix.confidence >= autoDeployThreshold && fix.testCases.length > 0) {
    return {
      strategy: 'auto',
      reason: `High confidence (${fix.confidence.toFixed(2)}) with ${fix.testCases.length} test case(s). Safe for auto-deploy.`,
      fix,
    };
  }

  // Medium confidence or no tests = staged rollout
  return {
    strategy: 'staged',
    reason: `Moderate confidence (${fix.confidence.toFixed(2)}) or insufficient test coverage. Using staged rollout.`,
    fix,
  };
}

// ---------------------------------------------------------------------------
// Staged rollout tracker
// ---------------------------------------------------------------------------

const ROLLOUT_STAGES: RolloutStage[] = [10, 50, 100];

export class RolloutTracker {
  private currentStageIndex = -1;
  private readonly strategy: DeploymentStrategy;

  constructor(decision: DeploymentDecision) {
    this.strategy = decision.strategy;
  }

  /** Get the current rollout stage, or null if not started. */
  getCurrentStage(): RolloutStage | null {
    if (this.currentStageIndex < 0) return null;
    return ROLLOUT_STAGES[this.currentStageIndex];
  }

  /** Advance to the next rollout stage. Returns the new stage. */
  advance(): RolloutStage {
    if (this.strategy === 'auto') {
      // Auto-deploy goes straight to 100%
      this.currentStageIndex = ROLLOUT_STAGES.length - 1;
      return ROLLOUT_STAGES[this.currentStageIndex];
    }

    if (this.currentStageIndex >= ROLLOUT_STAGES.length - 1) {
      return ROLLOUT_STAGES[ROLLOUT_STAGES.length - 1];
    }

    this.currentStageIndex++;
    return ROLLOUT_STAGES[this.currentStageIndex];
  }

  /** Whether we've reached 100% rollout. */
  isComplete(): boolean {
    return this.currentStageIndex >= ROLLOUT_STAGES.length - 1;
  }
}

// ---------------------------------------------------------------------------
// Full deploy pipeline
// ---------------------------------------------------------------------------

export interface DeployPipelineConfig {
  projectRoot: string;
  runner: CommandRunner;
  autoDeployThreshold: number;
}

/**
 * Execute the full deployment pipeline for a fix.
 *
 * Steps:
 * 1. Evaluate deployment strategy
 * 2. Apply patches
 * 3. Write test cases
 * 4. Run tests
 * 5. Return result (auto-revert on test failure)
 */
export async function executeDeploy(
  fix: FixResponse,
  config: DeployPipelineConfig,
): Promise<DeploymentResult> {
  const decision = evaluateDeployment(fix, config.autoDeployThreshold);

  if (decision.strategy === 'manual') {
    return {
      success: false,
      stage: 10,
      patchesApplied: 0,
      testsPassedCount: 0,
      testsFailedCount: 0,
      error: decision.reason,
    };
  }

  // Apply patches
  const patchResults = await applyPatches(fix.patches, config.projectRoot);
  const failedPatches = patchResults.filter((r) => !r.success);

  if (failedPatches.length > 0) {
    // Revert everything and report failure
    await revertPatches(patchResults, config.projectRoot);
    const errors = failedPatches
      .map((p) => `${p.filePath}: ${p.error}`)
      .join('; ');

    return {
      success: false,
      stage: 10,
      patchesApplied: 0,
      testsPassedCount: 0,
      testsFailedCount: 0,
      error: `Patch application failed: ${errors}`,
    };
  }

  // Write test cases
  if (fix.testCases.length > 0) {
    await writeTestCases(fix.testCases, config.projectRoot);
  }

  // Run tests
  const testResult = await runTests(config.runner, config.projectRoot);

  if (!testResult.passed) {
    // Tests failed — revert patches (keep test files for inspection)
    await revertPatches(patchResults, config.projectRoot);

    return {
      success: false,
      stage: 10,
      patchesApplied: patchResults.filter((r) => r.success).length,
      testsPassedCount: 0,
      testsFailedCount: fix.testCases.length,
      error: `Tests failed after applying fix. Patches reverted.\n${testResult.output}`,
    };
  }

  // Success — determine rollout stage
  const tracker = new RolloutTracker(decision);
  const stage = tracker.advance();

  return {
    success: true,
    stage,
    patchesApplied: patchResults.filter((r) => r.success).length,
    testsPassedCount: fix.testCases.length,
    testsFailedCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolvePath(projectRoot: string, relativePath: string): string {
  // Normalize and join — avoid path traversal
  const normalized = relativePath.replace(/\.\.\//g, '');
  return `${projectRoot}/${normalized}`;
}
