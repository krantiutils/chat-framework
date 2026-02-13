import { describe, it, expect, vi } from "vitest";
import { SelfHealingEngine } from "../engine.js";
import type { SelfHealingEngineConfig } from "../engine.js";
import { DeployStatus, ErrorCategory } from "../types.js";
import type {
  FixRequest,
  FixResponse,
  ValidationResult,
  HealingEventListener,
  HealthMetrics,
} from "../types.js";
import type { TestRunner } from "../fix-validator.js";
import type { HealthMonitor, DeployExecutor } from "../deploy-pipeline.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(): FixRequest {
  return {
    error: { name: "Error", message: "Element not found: 'div.inbox'" },
    context: {
      screenshot: Buffer.from("fake"),
      dom: "<html><body></body></html>",
      networkLogs: [],
      lastWorkingCode: "function foo() {}",
      recentChanges: { changes: [], totalChanged: 0, changeRatio: 0 },
    },
    platform: "instagram",
    affectedFunction: "Adapter.foo",
  };
}

function makePassingRunner(): TestRunner {
  return {
    async run(testCases): Promise<ValidationResult> {
      return {
        passed: true,
        totalTests: testCases.length,
        passedTests: testCases.length,
        failedTests: 0,
        failures: [],
        durationMs: 100,
      };
    },
  };
}

function makeFailingRunner(): TestRunner {
  return {
    async run(testCases): Promise<ValidationResult> {
      return {
        passed: false,
        totalTests: testCases.length,
        passedTests: 0,
        failedTests: testCases.length,
        failures: [{ testName: "test", error: "assertion failed" }],
        durationMs: 50,
      };
    },
  };
}

function makeHealthy(): HealthMetrics {
  return {
    platform: "instagram",
    timestamp: Date.now(),
    connected: true,
    lastSuccessfulAction: Date.now(),
    avgLatencyMs: 100,
    p99LatencyMs: 500,
    successRate: 0.99,
    errorRate: 0.01,
    errorCounts: {},
    suspectedDetection: false,
    captchaEncountered: false,
    rateLimited: false,
  };
}

/**
 * Build an engine config with a mocked fix generator.
 * We mock at the Claude API level by replacing the `generate` method
 * on the engine's internal FixGenerator via a subclass trick.
 */
function makeEngineConfig(
  overrides: {
    fixResponse?: FixResponse;
    testRunner?: TestRunner;
    healthMonitor?: HealthMonitor;
    deployExecutor?: DeployExecutor;
    listeners?: HealingEventListener[];
  } = {},
): SelfHealingEngineConfig {
  const defaultFix: FixResponse = {
    diagnosis: "Selector changed",
    confidence: 0.9,
    suggestedFix: [
      {
        filePath: "src/adapter.ts",
        startLine: 1,
        endLine: 1,
        originalCode: "old",
        replacementCode: "new",
      },
    ],
    testCases: [
      {
        name: "test fix",
        description: "verifies fix",
        code: "expect(true).toBe(true)",
        filePath: "src/__tests__/fix.test.ts",
      },
    ],
    rollbackPlan: "git revert HEAD",
  };

  return {
    apiKey: "test-key",
    model: "claude-sonnet-4-5-20250929",
    testRunner: overrides.testRunner ?? makePassingRunner(),
    healthMonitor: overrides.healthMonitor ?? {
      getMetrics: vi.fn().mockResolvedValue(makeHealthy()),
    },
    deployExecutor: overrides.deployExecutor ?? {
      applyAtPercentage: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    },
    listeners: overrides.listeners ?? [],
    deployment: {
      autoDeployThreshold: 0.8,
      stages: [
        { percentage: 100, soakDurationMs: 0, rollbackThreshold: 0.05 },
      ],
      maxRolloutDurationMs: 60_000,
    },
    sleep: vi.fn(),
    // The fixResponse override is used below to monkey-patch the generator
    _fixResponse: overrides.fixResponse ?? defaultFix,
  } as SelfHealingEngineConfig & { _fixResponse: FixResponse };
}

/**
 * Create a SelfHealingEngine with a mocked FixGenerator.
 * We patch the private `fixGenerator.generate` to return our test fixture
 * instead of making a real Claude API call.
 */
function makeEngine(
  configOverrides: Parameters<typeof makeEngineConfig>[0] = {},
): SelfHealingEngine {
  const config = makeEngineConfig(configOverrides);
  const engine = new SelfHealingEngine(config);

  // Monkey-patch the fix generator to avoid real API calls
  const fixResponse = (config as ReturnType<typeof makeEngineConfig> & { _fixResponse: FixResponse })._fixResponse;
  (engine as unknown as { fixGenerator: { generate: () => Promise<FixResponse> } }).fixGenerator = {
    generate: vi.fn().mockResolvedValue(fixResponse),
  };

  return engine;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("SelfHealingEngine", () => {
  it("runs the full heal pipeline: diagnose → fix → validate → deploy", async () => {
    const engine = makeEngine();
    const files = new Map([["src/adapter.ts", "old"]]);

    const result = await engine.heal(makeRequest(), files);

    expect(result.fixResponse.diagnosis).toBe("Selector changed");
    expect(result.validation.passed).toBe(true);
    expect(result.deployment).toBeDefined();
    expect(result.deployment!.status).toBe(DeployStatus.COMPLETE);
  });

  it("does not deploy when validation fails", async () => {
    const engine = makeEngine({ testRunner: makeFailingRunner() });
    const files = new Map([["src/adapter.ts", "old"]]);

    const result = await engine.heal(makeRequest(), files);

    expect(result.validation.passed).toBe(false);
    expect(result.deployment).toBeUndefined();
  });

  it("returns PENDING_REVIEW when confidence is below threshold", async () => {
    const lowConfidenceFix: FixResponse = {
      diagnosis: "Unclear root cause",
      confidence: 0.4,
      suggestedFix: [
        {
          filePath: "src/adapter.ts",
          startLine: 1,
          endLine: 1,
          originalCode: "old",
          replacementCode: "maybe-new",
        },
      ],
      testCases: [
        {
          name: "test",
          description: "test",
          code: "expect(true).toBe(true)",
          filePath: "src/__tests__/t.test.ts",
        },
      ],
      rollbackPlan: "revert",
    };

    const engine = makeEngine({ fixResponse: lowConfidenceFix });
    const files = new Map([["src/adapter.ts", "old"]]);

    const result = await engine.heal(makeRequest(), files);

    expect(result.validation.passed).toBe(true);
    expect(result.deployment).toBeDefined();
    expect(result.deployment!.status).toBe(DeployStatus.PENDING_REVIEW);
  });

  it("fires lifecycle events to listeners", async () => {
    const listener: HealingEventListener = {
      onDiagnosisComplete: vi.fn(),
      onFixGenerated: vi.fn(),
      onValidationComplete: vi.fn(),
      onDeployStarted: vi.fn(),
      onDeployComplete: vi.fn(),
    };

    const engine = makeEngine({ listeners: [listener] });
    const files = new Map([["src/adapter.ts", "old"]]);

    await engine.heal(makeRequest(), files);

    expect(listener.onDiagnosisComplete).toHaveBeenCalledTimes(1);
    expect(listener.onFixGenerated).toHaveBeenCalledTimes(1);
    expect(listener.onValidationComplete).toHaveBeenCalledTimes(1);
    // onDeployStarted and onDeployComplete fire for successful deploys
    expect(listener.onDeployComplete).toHaveBeenCalledTimes(1);
  });

  it("fires onHumanReviewRequired for low-confidence fixes", async () => {
    const listener: HealingEventListener = {
      onHumanReviewRequired: vi.fn(),
    };

    const lowConfidenceFix: FixResponse = {
      diagnosis: "Guess",
      confidence: 0.3,
      suggestedFix: [
        {
          filePath: "src/adapter.ts",
          startLine: 1,
          endLine: 1,
          originalCode: "old",
          replacementCode: "new",
        },
      ],
      testCases: [
        {
          name: "t",
          description: "t",
          code: "ok",
          filePath: "t.ts",
        },
      ],
      rollbackPlan: "revert",
    };

    const engine = makeEngine({
      fixResponse: lowConfidenceFix,
      listeners: [listener],
    });
    const files = new Map([["src/adapter.ts", "old"]]);

    await engine.heal(makeRequest(), files);

    expect(listener.onHumanReviewRequired).toHaveBeenCalledTimes(1);
    expect(listener.onHumanReviewRequired).toHaveBeenCalledWith(
      expect.objectContaining({ confidence: 0.3 }),
      expect.stringContaining("Confidence"),
    );
  });

  it("survives listener errors without breaking the pipeline", async () => {
    const badListener: HealingEventListener = {
      onDiagnosisComplete: () => {
        throw new Error("listener exploded");
      },
    };

    const engine = makeEngine({ listeners: [badListener] });
    const files = new Map([["src/adapter.ts", "old"]]);

    // Should not throw
    const result = await engine.heal(makeRequest(), files);
    expect(result.fixResponse).toBeDefined();
  });

  it("diagnoses correctly as part of the pipeline", async () => {
    const listener: HealingEventListener = {
      onDiagnosisComplete: vi.fn(),
    };

    const engine = makeEngine({ listeners: [listener] });
    const files = new Map([["src/adapter.ts", "old"]]);

    await engine.heal(makeRequest(), files);

    const diagnosisCall = (listener.onDiagnosisComplete as ReturnType<typeof vi.fn>).mock.calls[0];
    const diagnosis = diagnosisCall[0];
    expect(diagnosis.category).toBe(ErrorCategory.SELECTOR_NOT_FOUND);
  });
});
