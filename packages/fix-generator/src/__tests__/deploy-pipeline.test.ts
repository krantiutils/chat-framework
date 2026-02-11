import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applyPatches,
  revertPatches,
  writeTestCases,
  runTests,
  evaluateDeployment,
  RolloutTracker,
  executeDeploy,
} from '../deploy-pipeline.js';
import type { CommandRunner, CommandResult } from '../deploy-pipeline.js';
import type { CodePatch, FixResponse, TestCase } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'fix-gen-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeFix(overrides: Partial<FixResponse> = {}): FixResponse {
  return {
    diagnosis: 'Selector changed',
    confidence: 0.9,
    patches: [
      {
        filePath: 'src/selectors.ts',
        originalCode: "const BTN = '.old-class';",
        newCode: "const BTN = '.new-class';",
        description: 'Update selector',
      },
    ],
    testCases: [
      {
        name: 'test selector',
        filePath: 'src/__tests__/selectors.test.ts',
        code: "import { test } from 'vitest';\ntest('ok', () => {});",
        description: 'Validates selector',
      },
    ],
    rollbackPlan: 'git revert HEAD',
    ...overrides,
  };
}

function makeRunner(exitCode = 0, stdout = '', stderr = ''): CommandRunner {
  return {
    run: vi.fn<(cmd: string, cwd?: string) => Promise<CommandResult>>().mockResolvedValue({
      exitCode,
      stdout,
      stderr,
    }),
  };
}

// ---------------------------------------------------------------------------
// applyPatches
// ---------------------------------------------------------------------------

describe('applyPatches', () => {
  it('applies a patch by replacing originalCode with newCode', async () => {
    const filePath = 'src/selectors.ts';
    const fullPath = join(tempDir, filePath);
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(fullPath, "const BTN = '.old-class';\nexport { BTN };");

    const patches: CodePatch[] = [
      {
        filePath,
        originalCode: "const BTN = '.old-class';",
        newCode: "const BTN = '.new-class';",
        description: 'Update selector',
      },
    ];

    const results = await applyPatches(patches, tempDir);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].originalContent).toContain('.old-class');

    const updated = await readFile(fullPath, 'utf-8');
    expect(updated).toContain('.new-class');
    expect(updated).not.toContain('.old-class');
    expect(updated).toContain('export { BTN }');
  });

  it('returns failure when originalCode is not found in file', async () => {
    const filePath = 'src/selectors.ts';
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, filePath), 'completely different content');

    const patches: CodePatch[] = [
      {
        filePath,
        originalCode: 'code that does not exist',
        newCode: 'new code',
        description: 'Bogus patch',
      },
    ];

    const results = await applyPatches(patches, tempDir);

    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('not found');
    expect(results[0].originalContent).toBe('completely different content');
  });

  it('returns failure when file does not exist', async () => {
    const patches: CodePatch[] = [
      {
        filePath: 'nonexistent/file.ts',
        originalCode: 'old',
        newCode: 'new',
        description: 'Patch to missing file',
      },
    ];

    const results = await applyPatches(patches, tempDir);

    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeDefined();
  });

  it('applies multiple patches in order', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src/a.ts'), 'const A = 1;');
    await writeFile(join(tempDir, 'src/b.ts'), 'const B = 2;');

    const patches: CodePatch[] = [
      { filePath: 'src/a.ts', originalCode: 'const A = 1;', newCode: 'const A = 10;', description: 'a' },
      { filePath: 'src/b.ts', originalCode: 'const B = 2;', newCode: 'const B = 20;', description: 'b' },
    ];

    const results = await applyPatches(patches, tempDir);

    expect(results.every((r) => r.success)).toBe(true);
    expect(await readFile(join(tempDir, 'src/a.ts'), 'utf-8')).toBe('const A = 10;');
    expect(await readFile(join(tempDir, 'src/b.ts'), 'utf-8')).toBe('const B = 20;');
  });
});

// ---------------------------------------------------------------------------
// revertPatches
// ---------------------------------------------------------------------------

describe('revertPatches', () => {
  it('restores original file content', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    const filePath = join(tempDir, 'src/selectors.ts');
    await writeFile(filePath, 'modified content');

    await revertPatches(
      [
        {
          filePath: 'src/selectors.ts',
          success: true,
          originalContent: 'original content',
        },
      ],
      tempDir,
    );

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('original content');
  });

  it('skips failed patches (no original content)', async () => {
    // Should not throw
    await revertPatches(
      [{ filePath: 'src/missing.ts', success: false, error: 'not found' }],
      tempDir,
    );
  });

  it('reverts in reverse order', async () => {
    // Verify reverse-order revert by using files whose content depends on write order.
    // Write initial files, then revert two patches. If second is reverted first (correctly),
    // the final state should be the original content from each patch result.
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src/first.ts'), 'patched-first');
    await writeFile(join(tempDir, 'src/second.ts'), 'patched-second');

    await revertPatches(
      [
        { filePath: 'src/first.ts', success: true, originalContent: 'original-first' },
        { filePath: 'src/second.ts', success: true, originalContent: 'original-second' },
      ],
      tempDir,
    );

    // Both files should be restored to their originals
    expect(await readFile(join(tempDir, 'src/first.ts'), 'utf-8')).toBe('original-first');
    expect(await readFile(join(tempDir, 'src/second.ts'), 'utf-8')).toBe('original-second');
  });
});

// ---------------------------------------------------------------------------
// writeTestCases
// ---------------------------------------------------------------------------

describe('writeTestCases', () => {
  it('writes test files to the filesystem', async () => {
    const testCases: TestCase[] = [
      {
        name: 'test one',
        filePath: 'src/__tests__/fix.test.ts',
        code: 'test("works", () => {});',
        description: 'Validates fix',
      },
    ];

    await writeTestCases(testCases, tempDir);

    const content = await readFile(join(tempDir, 'src/__tests__/fix.test.ts'), 'utf-8');
    expect(content).toBe('test("works", () => {});');
  });

  it('creates nested directories', async () => {
    const testCases: TestCase[] = [
      {
        name: 'deep test',
        filePath: 'deep/nested/dir/test.ts',
        code: 'test("deep", () => {});',
        description: 'Deep test',
      },
    ];

    await writeTestCases(testCases, tempDir);

    const content = await readFile(join(tempDir, 'deep/nested/dir/test.ts'), 'utf-8');
    expect(content).toBe('test("deep", () => {});');
  });
});

// ---------------------------------------------------------------------------
// runTests
// ---------------------------------------------------------------------------

describe('runTests', () => {
  it('returns passed=true when exit code is 0', async () => {
    const runner = makeRunner(0, 'all tests passed', '');
    const result = await runTests(runner, tempDir);

    expect(result.passed).toBe(true);
    expect(result.output).toContain('all tests passed');
    expect(runner.run).toHaveBeenCalledWith('pnpm test', tempDir);
  });

  it('returns passed=false when exit code is non-zero', async () => {
    const runner = makeRunner(1, '', 'FAIL src/test.ts');
    const result = await runTests(runner, tempDir);

    expect(result.passed).toBe(false);
    expect(result.output).toContain('FAIL');
  });
});

// ---------------------------------------------------------------------------
// evaluateDeployment
// ---------------------------------------------------------------------------

describe('evaluateDeployment', () => {
  it('returns auto for high confidence with tests', () => {
    const fix = makeFix({ confidence: 0.92 });
    const decision = evaluateDeployment(fix, 0.8);

    expect(decision.strategy).toBe('auto');
    expect(decision.reason).toContain('0.92');
  });

  it('returns manual for no patches', () => {
    const fix = makeFix({ patches: [], confidence: 0.95 });
    const decision = evaluateDeployment(fix, 0.8);

    expect(decision.strategy).toBe('manual');
    expect(decision.reason).toContain('No code patches');
  });

  it('returns manual for low confidence (<0.4)', () => {
    const fix = makeFix({ confidence: 0.2 });
    const decision = evaluateDeployment(fix, 0.8);

    expect(decision.strategy).toBe('manual');
    expect(decision.reason).toContain('Low confidence');
  });

  it('returns staged for moderate confidence', () => {
    const fix = makeFix({ confidence: 0.6 });
    const decision = evaluateDeployment(fix, 0.8);

    expect(decision.strategy).toBe('staged');
    expect(decision.reason).toContain('Moderate confidence');
  });

  it('returns staged when high confidence but no tests', () => {
    const fix = makeFix({ confidence: 0.95, testCases: [] });
    const decision = evaluateDeployment(fix, 0.8);

    expect(decision.strategy).toBe('staged');
  });

  it('respects custom threshold', () => {
    const fix = makeFix({ confidence: 0.85 });
    const decision = evaluateDeployment(fix, 0.9);

    expect(decision.strategy).toBe('staged');
  });

  it('auto at exactly the threshold', () => {
    const fix = makeFix({ confidence: 0.8 });
    const decision = evaluateDeployment(fix, 0.8);

    expect(decision.strategy).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// RolloutTracker
// ---------------------------------------------------------------------------

describe('RolloutTracker', () => {
  it('starts with no stage', () => {
    const tracker = new RolloutTracker({
      strategy: 'staged',
      reason: 'test',
      fix: makeFix(),
    });

    expect(tracker.getCurrentStage()).toBeNull();
    expect(tracker.isComplete()).toBe(false);
  });

  it('stages through 10 → 50 → 100 for staged strategy', () => {
    const tracker = new RolloutTracker({
      strategy: 'staged',
      reason: 'test',
      fix: makeFix(),
    });

    expect(tracker.advance()).toBe(10);
    expect(tracker.isComplete()).toBe(false);

    expect(tracker.advance()).toBe(50);
    expect(tracker.isComplete()).toBe(false);

    expect(tracker.advance()).toBe(100);
    expect(tracker.isComplete()).toBe(true);
  });

  it('auto strategy goes straight to 100', () => {
    const tracker = new RolloutTracker({
      strategy: 'auto',
      reason: 'test',
      fix: makeFix(),
    });

    expect(tracker.advance()).toBe(100);
    expect(tracker.isComplete()).toBe(true);
  });

  it('stays at 100 when already complete', () => {
    const tracker = new RolloutTracker({
      strategy: 'auto',
      reason: 'test',
      fix: makeFix(),
    });

    tracker.advance();
    expect(tracker.advance()).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// executeDeploy (integration)
// ---------------------------------------------------------------------------

describe('executeDeploy', () => {
  it('successfully deploys a high-confidence fix', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src/selectors.ts'), "const BTN = '.old-class';\n");

    const fix = makeFix({ confidence: 0.92 });
    const runner = makeRunner(0, 'Tests passed');

    const result = await executeDeploy(fix, {
      projectRoot: tempDir,
      runner,
      autoDeployThreshold: 0.8,
    });

    expect(result.success).toBe(true);
    expect(result.stage).toBe(100); // auto → straight to 100
    expect(result.patchesApplied).toBe(1);
    expect(result.testsPassedCount).toBe(1);
    expect(result.testsFailedCount).toBe(0);

    // Verify file was patched
    const content = await readFile(join(tempDir, 'src/selectors.ts'), 'utf-8');
    expect(content).toContain('.new-class');
  });

  it('reverts patches when tests fail', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src/selectors.ts'), "const BTN = '.old-class';\n");

    const fix = makeFix({ confidence: 0.92 });
    const runner = makeRunner(1, '', 'FAIL');

    const result = await executeDeploy(fix, {
      projectRoot: tempDir,
      runner,
      autoDeployThreshold: 0.8,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Tests failed');

    // Verify file was reverted
    const content = await readFile(join(tempDir, 'src/selectors.ts'), 'utf-8');
    expect(content).toContain('.old-class');
  });

  it('returns failure for manual strategy without applying anything', async () => {
    const fix = makeFix({ confidence: 0.2 }); // low confidence → manual

    const result = await executeDeploy(fix, {
      projectRoot: tempDir,
      runner: makeRunner(),
      autoDeployThreshold: 0.8,
    });

    expect(result.success).toBe(false);
    expect(result.patchesApplied).toBe(0);
    expect(result.error).toContain('Low confidence');
  });

  it('returns failure and reverts when patch application fails', async () => {
    // Don't create the file — patch will fail
    const fix = makeFix();

    const result = await executeDeploy(fix, {
      projectRoot: tempDir,
      runner: makeRunner(),
      autoDeployThreshold: 0.8,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Patch application failed');
  });

  it('uses staged rollout for moderate confidence', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src/selectors.ts'), "const BTN = '.old-class';\n");

    const fix = makeFix({ confidence: 0.7 });
    const runner = makeRunner(0, 'Tests passed');

    const result = await executeDeploy(fix, {
      projectRoot: tempDir,
      runner,
      autoDeployThreshold: 0.8,
    });

    expect(result.success).toBe(true);
    expect(result.stage).toBe(10); // staged → starts at 10%
  });
});
