import { describe, it, expect, vi } from "vitest";
import { DeployPipeline } from "../deploy-pipeline.js";
import type { HealthMonitor, DeployExecutor } from "../deploy-pipeline.js";
import { DeployStatus } from "../types.js";
import type {
  FixResponse,
  HealthMetrics,
  DeploymentConfig,
} from "../types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFix(confidence: number): FixResponse {
  return {
    diagnosis: "test",
    confidence,
    suggestedFix: [],
    testCases: [],
    rollbackPlan: "revert",
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

function makeUnhealthy(errorRate: number): HealthMetrics {
  return {
    ...makeHealthy(),
    errorRate,
    successRate: 1 - errorRate,
  };
}

function makeMockMonitor(metrics: HealthMetrics): HealthMonitor {
  return { getMetrics: vi.fn().mockResolvedValue(metrics) };
}

function makeMockExecutor(): DeployExecutor & {
  applyAtPercentage: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
} {
  return {
    applyAtPercentage: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  };
}

function makeConfig(overrides: Partial<DeploymentConfig> = {}): DeploymentConfig {
  return {
    autoDeployThreshold: 0.8,
    stages: [
      { percentage: 10, soakDurationMs: 0, rollbackThreshold: 0.05 },
      { percentage: 50, soakDurationMs: 0, rollbackThreshold: 0.03 },
      { percentage: 100, soakDurationMs: 0, rollbackThreshold: 0.02 },
    ],
    maxRolloutDurationMs: 60_000,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("DeployPipeline", () => {
  it("returns PENDING_REVIEW when confidence is below threshold", async () => {
    const pipeline = new DeployPipeline({
      deployment: makeConfig(),
      healthMonitor: makeMockMonitor(makeHealthy()),
      deployExecutor: makeMockExecutor(),
      sleep: vi.fn(),
    });

    const result = await pipeline.deploy(makeFix(0.5), "instagram");
    expect(result.status).toBe(DeployStatus.PENDING_REVIEW);
  });

  it("deploys through all stages when healthy", async () => {
    const executor = makeMockExecutor();
    const pipeline = new DeployPipeline({
      deployment: makeConfig(),
      healthMonitor: makeMockMonitor(makeHealthy()),
      deployExecutor: executor,
      sleep: vi.fn(),
    });

    const result = await pipeline.deploy(makeFix(0.95), "instagram");

    expect(result.status).toBe(DeployStatus.COMPLETE);
    expect(executor.applyAtPercentage).toHaveBeenCalledTimes(3);
    expect(executor.applyAtPercentage).toHaveBeenCalledWith(
      expect.anything(),
      10,
    );
    expect(executor.applyAtPercentage).toHaveBeenCalledWith(
      expect.anything(),
      50,
    );
    expect(executor.applyAtPercentage).toHaveBeenCalledWith(
      expect.anything(),
      100,
    );
  });

  it("rolls back when error rate exceeds threshold", async () => {
    const executor = makeMockExecutor();
    // Error rate 10% — will exceed the 5% threshold at stage 1
    const pipeline = new DeployPipeline({
      deployment: makeConfig(),
      healthMonitor: makeMockMonitor(makeUnhealthy(0.10)),
      deployExecutor: executor,
      sleep: vi.fn(),
    });

    const result = await pipeline.deploy(makeFix(0.9), "instagram");

    expect(result.status).toBe(DeployStatus.ROLLED_BACK);
    expect(result.rollbackReason).toContain("10.0%");
    expect(result.rollbackReason).toContain("5.0%");
    expect(executor.rollback).toHaveBeenCalledTimes(1);
  });

  it("returns FAILED when executor throws during apply", async () => {
    const executor = makeMockExecutor();
    executor.applyAtPercentage.mockRejectedValueOnce(new Error("deploy broke"));

    const pipeline = new DeployPipeline({
      deployment: makeConfig(),
      healthMonitor: makeMockMonitor(makeHealthy()),
      deployExecutor: executor,
      sleep: vi.fn(),
    });

    const result = await pipeline.deploy(makeFix(0.9), "instagram");

    expect(result.status).toBe(DeployStatus.FAILED);
    expect(result.rollbackReason).toContain("deploy broke");
    expect(executor.rollback).toHaveBeenCalledTimes(1);
  });

  it("handles soak duration with health monitoring", async () => {
    let now = 1000;
    const clock = () => now;
    const sleepFn = vi.fn().mockImplementation(async (ms: number) => {
      now += ms;
    });

    const monitor = makeMockMonitor(makeHealthy());
    const executor = makeMockExecutor();

    const pipeline = new DeployPipeline({
      deployment: {
        autoDeployThreshold: 0.8,
        stages: [
          { percentage: 100, soakDurationMs: 30_000, rollbackThreshold: 0.05 },
        ],
        maxRolloutDurationMs: 60_000,
      },
      healthMonitor: monitor,
      deployExecutor: executor,
      clock,
      sleep: sleepFn,
    });

    const result = await pipeline.deploy(makeFix(0.9), "instagram");

    expect(result.status).toBe(DeployStatus.COMPLETE);
    // Should have called sleep during soak
    expect(sleepFn).toHaveBeenCalled();
    // Should have checked health multiple times during soak
    expect(monitor.getMetrics).toHaveBeenCalled();
  });

  it("survives rollback failure during error path", async () => {
    const executor = makeMockExecutor();
    executor.applyAtPercentage.mockRejectedValueOnce(new Error("boom"));
    executor.rollback.mockRejectedValueOnce(new Error("rollback also broke"));

    const pipeline = new DeployPipeline({
      deployment: makeConfig(),
      healthMonitor: makeMockMonitor(makeHealthy()),
      deployExecutor: executor,
      sleep: vi.fn(),
    });

    // Should not throw even though rollback also fails
    const result = await pipeline.deploy(makeFix(0.9), "instagram");
    expect(result.status).toBe(DeployStatus.FAILED);
  });

  it("sets completedAt timestamp on completion", async () => {
    let now = 1000;
    const pipeline = new DeployPipeline({
      deployment: makeConfig(),
      healthMonitor: makeMockMonitor(makeHealthy()),
      deployExecutor: makeMockExecutor(),
      clock: () => now,
      sleep: vi.fn(),
    });

    now = 5000;
    const result = await pipeline.deploy(makeFix(0.9), "instagram");

    expect(result.completedAt).toBe(5000);
  });

  it("uses default config when none provided", async () => {
    const pipeline = new DeployPipeline({
      healthMonitor: makeMockMonitor(makeHealthy()),
      deployExecutor: makeMockExecutor(),
      sleep: vi.fn(),
    });

    // Default threshold is 0.8, so 0.9 should auto-deploy
    const result = await pipeline.deploy(makeFix(0.9), "instagram");
    expect(result.status).toBe(DeployStatus.COMPLETE);
  });
});
