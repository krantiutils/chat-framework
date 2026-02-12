import { describe, it, expect } from "vitest";
import { PlatformMetricsCollector } from "../src/collector.js";
import { ActionOutcome, Platform } from "../src/types.js";
import type { ActionResult } from "../src/types.js";

function makeResult(
  overrides: Partial<ActionResult> & { timestamp: number; latencyMs: number },
): ActionResult {
  return {
    outcome: ActionOutcome.SUCCESS,
    ...overrides,
  };
}

describe("PlatformMetricsCollector", () => {
  it("returns empty metrics when no actions recorded", () => {
    const collector = new PlatformMetricsCollector({
      platform: Platform.TELEGRAM,
      clock: () => 10_000,
    });

    const metrics = collector.snapshot();
    expect(metrics.platform).toBe(Platform.TELEGRAM);
    expect(metrics.sampleCount).toBe(0);
    expect(metrics.connected).toBe(false);
    expect(metrics.lastSuccessfulAction).toBeNull();
    expect(metrics.avgLatencyMs).toBe(0);
    expect(metrics.p99LatencyMs).toBe(0);
    expect(metrics.successRate).toBe(0);
    expect(metrics.errorRate).toBe(0);
    expect(metrics.errorTypes.size).toBe(0);
    expect(metrics.suspectedDetection).toBe(false);
    expect(metrics.captchaEncountered).toBe(false);
    expect(metrics.rateLimited).toBe(false);
  });

  it("tracks success rate and error rate", () => {
    let now = 1000;
    const collector = new PlatformMetricsCollector({
      platform: Platform.WHATSAPP,
      clock: () => now,
    });

    // 7 successes, 3 failures
    for (let i = 0; i < 7; i++) {
      collector.record(makeResult({ timestamp: now, latencyMs: 100, outcome: ActionOutcome.SUCCESS }));
      now += 10;
    }
    for (let i = 0; i < 3; i++) {
      collector.record(makeResult({
        timestamp: now,
        latencyMs: 200,
        outcome: ActionOutcome.FAILURE,
        errorType: "TIMEOUT",
      }));
      now += 10;
    }

    const metrics = collector.snapshot();
    expect(metrics.sampleCount).toBe(10);
    expect(metrics.successRate).toBeCloseTo(0.7, 5);
    expect(metrics.errorRate).toBeCloseTo(0.3, 5);
    expect(metrics.connected).toBe(true);
  });

  it("computes average and p99 latency", () => {
    let now = 1000;
    const collector = new PlatformMetricsCollector({
      platform: Platform.INSTAGRAM,
      clock: () => now,
    });

    // 100 actions with varied latencies
    // 90 at 100ms, 5 at 500ms, 4 at 800ms, 1 at 2000ms
    for (let i = 0; i < 90; i++) {
      collector.record(makeResult({ timestamp: now, latencyMs: 100 }));
      now += 10;
    }
    for (let i = 0; i < 5; i++) {
      collector.record(makeResult({ timestamp: now, latencyMs: 500 }));
      now += 10;
    }
    for (let i = 0; i < 4; i++) {
      collector.record(makeResult({ timestamp: now, latencyMs: 800 }));
      now += 10;
    }
    collector.record(makeResult({ timestamp: now, latencyMs: 2000 }));
    now += 10;

    const metrics = collector.snapshot();
    expect(metrics.sampleCount).toBe(100);
    // avg = (90*100 + 5*500 + 4*800 + 2000) / 100 = (9000 + 2500 + 3200 + 2000) / 100 = 167
    expect(metrics.avgLatencyMs).toBeCloseTo(167, 0);
    // p99: ceil(100 * 0.99) - 1 = 98 (0-indexed). Sorted: 90 at 100, 5 at 500, 4 at 800, 1 at 2000
    // Index 98 = 800 (the last 800ms value, since 90+5+4=99, index 98 is 4th of 800 group)
    expect(metrics.p99LatencyMs).toBe(800);
  });

  it("aggregates error types", () => {
    let now = 1000;
    const collector = new PlatformMetricsCollector({
      platform: Platform.FACEBOOK,
      clock: () => now,
    });

    collector.record(makeResult({
      timestamp: now++, latencyMs: 50,
      outcome: ActionOutcome.FAILURE, errorType: "SELECTOR_NOT_FOUND",
    }));
    collector.record(makeResult({
      timestamp: now++, latencyMs: 50,
      outcome: ActionOutcome.FAILURE, errorType: "SELECTOR_NOT_FOUND",
    }));
    collector.record(makeResult({
      timestamp: now++, latencyMs: 50,
      outcome: ActionOutcome.FAILURE, errorType: "TIMEOUT",
    }));
    collector.record(makeResult({
      timestamp: now++, latencyMs: 50,
      outcome: ActionOutcome.FAILURE, errorType: "AUTH_ERROR",
    }));

    const metrics = collector.snapshot();
    expect(metrics.errorTypes.get("SELECTOR_NOT_FOUND")).toBe(2);
    expect(metrics.errorTypes.get("TIMEOUT")).toBe(1);
    expect(metrics.errorTypes.get("AUTH_ERROR")).toBe(1);
  });

  it("evicts stale entries outside the sliding window", () => {
    let now = 0;
    const collector = new PlatformMetricsCollector({
      platform: Platform.TELEGRAM,
      windowMs: 1000,
      clock: () => now,
    });

    // Record at t=0
    collector.record(makeResult({ timestamp: 0, latencyMs: 500 }));
    expect(collector.windowSize).toBe(1);

    // Advance past the window
    now = 1500;
    const metrics = collector.snapshot();
    expect(metrics.sampleCount).toBe(0);
    expect(collector.windowSize).toBe(0);
  });

  it("handles sliding window correctly with mixed timestamps", () => {
    let now = 5000;
    const collector = new PlatformMetricsCollector({
      platform: Platform.DISCORD,
      windowMs: 2000,
      clock: () => now,
    });

    // Record at t=3000, t=3500, t=4000, t=4500
    collector.record(makeResult({ timestamp: 3000, latencyMs: 100 }));
    collector.record(makeResult({ timestamp: 3500, latencyMs: 200 }));
    collector.record(makeResult({ timestamp: 4000, latencyMs: 300 }));
    collector.record(makeResult({ timestamp: 4500, latencyMs: 400 }));

    // At t=5000, window is [3000, 5000). cutoff = 3000.
    // t=3000 is exactly at cutoff — binary search uses < so it stays
    const metrics = collector.snapshot();
    expect(metrics.sampleCount).toBe(4);

    // Advance to t=5500 — cutoff is 3500, so t=3000 is evicted
    now = 5500;
    const metrics2 = collector.snapshot();
    expect(metrics2.sampleCount).toBe(3);
  });

  it("enforces maxWindowSize", () => {
    let now = 1000;
    const collector = new PlatformMetricsCollector({
      platform: Platform.SIGNAL,
      maxWindowSize: 5,
      clock: () => now,
    });

    for (let i = 0; i < 10; i++) {
      collector.record(makeResult({ timestamp: now, latencyMs: i * 10 }));
      now += 1;
    }

    expect(collector.windowSize).toBeLessThanOrEqual(5);
  });

  it("tracks connection status via disconnect threshold", () => {
    let now = 1000;
    const collector = new PlatformMetricsCollector({
      platform: Platform.WHATSAPP,
      disconnectThresholdMs: 500,
      clock: () => now,
    });

    // Not connected initially
    expect(collector.snapshot().connected).toBe(false);

    // Record success → connected
    collector.record(makeResult({ timestamp: now, latencyMs: 50 }));
    expect(collector.snapshot().connected).toBe(true);

    // Advance past threshold → disconnected
    now = 1600;
    expect(collector.snapshot().connected).toBe(false);

    // Record another success → connected again
    collector.record(makeResult({ timestamp: now, latencyMs: 50 }));
    expect(collector.snapshot().connected).toBe(true);
  });

  it("tracks detection signals within window", () => {
    let now = 1000;
    const collector = new PlatformMetricsCollector({
      platform: Platform.INSTAGRAM,
      windowMs: 500,
      clock: () => now,
    });

    collector.record(makeResult({
      timestamp: now,
      latencyMs: 100,
      outcome: ActionOutcome.FAILURE,
      detection: { captchaEncountered: true },
    }));

    let metrics = collector.snapshot();
    expect(metrics.captchaEncountered).toBe(true);
    expect(metrics.rateLimited).toBe(false);
    expect(metrics.suspectedDetection).toBe(false);

    // Advance past window — signal should clear
    now = 2000;
    metrics = collector.snapshot();
    expect(metrics.captchaEncountered).toBe(false);
  });

  it("tracks multiple detection signals independently", () => {
    let now = 1000;
    const collector = new PlatformMetricsCollector({
      platform: Platform.FACEBOOK,
      clock: () => now,
    });

    collector.record(makeResult({
      timestamp: now, latencyMs: 100,
      detection: { rateLimited: true },
    }));
    now += 10;
    collector.record(makeResult({
      timestamp: now, latencyMs: 100,
      detection: { suspectedDetection: true },
    }));

    const metrics = collector.snapshot();
    expect(metrics.rateLimited).toBe(true);
    expect(metrics.suspectedDetection).toBe(true);
    expect(metrics.captchaEncountered).toBe(false);
  });

  it("reset clears all state", () => {
    const now = 1000;
    const collector = new PlatformMetricsCollector({
      platform: Platform.TELEGRAM,
      clock: () => now,
    });

    collector.record(makeResult({ timestamp: now, latencyMs: 100 }));
    expect(collector.windowSize).toBe(1);

    collector.reset();
    expect(collector.windowSize).toBe(0);
    expect(collector.snapshot().connected).toBe(false);
    expect(collector.snapshot().lastSuccessfulAction).toBeNull();
  });

  it("p99 latency with few samples", () => {
    const now = 1000;
    const collector = new PlatformMetricsCollector({
      platform: Platform.DISCORD,
      clock: () => now,
    });

    // Single sample
    collector.record(makeResult({ timestamp: now, latencyMs: 42 }));
    const metrics = collector.snapshot();
    expect(metrics.avgLatencyMs).toBe(42);
    expect(metrics.p99LatencyMs).toBe(42);
  });

  it("handles all-failure window", () => {
    let now = 1000;
    const collector = new PlatformMetricsCollector({
      platform: Platform.SIGNAL,
      clock: () => now,
    });

    for (let i = 0; i < 5; i++) {
      collector.record(makeResult({
        timestamp: now++,
        latencyMs: 100,
        outcome: ActionOutcome.FAILURE,
        errorType: "NETWORK_ERROR",
      }));
    }

    const metrics = collector.snapshot();
    expect(metrics.successRate).toBe(0);
    expect(metrics.errorRate).toBe(1);
    expect(metrics.connected).toBe(false);
    expect(metrics.errorTypes.get("NETWORK_ERROR")).toBe(5);
  });
});
