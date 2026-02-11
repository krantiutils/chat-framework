import { describe, it, expect, vi } from "vitest";
import { HealthMonitor } from "../src/monitor.js";
import { ActionOutcome, Platform } from "../src/types.js";
import type { ActionResult, HealthMetrics } from "../src/types.js";

function makeResult(
  overrides: Partial<ActionResult> & { timestamp: number; latencyMs: number },
): ActionResult {
  return {
    outcome: ActionOutcome.SUCCESS,
    ...overrides,
  };
}

describe("HealthMonitor", () => {
  it("creates collectors lazily on record()", () => {
    const monitor = new HealthMonitor({ clock: () => 1000 });

    expect(monitor.platforms.size).toBe(0);

    monitor.record(Platform.TELEGRAM, makeResult({ timestamp: 1000, latencyMs: 50 }));
    expect(monitor.platforms.has(Platform.TELEGRAM)).toBe(true);
    expect(monitor.platforms.size).toBe(1);
  });

  it("registerPlatform creates collector eagerly", () => {
    const monitor = new HealthMonitor({ clock: () => 1000 });

    monitor.registerPlatform(Platform.DISCORD);
    expect(monitor.platforms.has(Platform.DISCORD)).toBe(true);

    const metrics = monitor.snapshot(Platform.DISCORD);
    expect(metrics).not.toBeNull();
    expect(metrics!.platform).toBe(Platform.DISCORD);
    expect(metrics!.sampleCount).toBe(0);
  });

  it("snapshot returns null for unknown platform", () => {
    const monitor = new HealthMonitor();
    expect(monitor.snapshot(Platform.INSTAGRAM)).toBeNull();
  });

  it("tracks metrics per platform independently", () => {
    let now = 1000;
    const monitor = new HealthMonitor({ clock: () => now });

    // Telegram: all success
    for (let i = 0; i < 5; i++) {
      monitor.record(Platform.TELEGRAM, makeResult({ timestamp: now, latencyMs: 100 }));
      now += 10;
    }

    // Instagram: all failure
    for (let i = 0; i < 5; i++) {
      monitor.record(Platform.INSTAGRAM, makeResult({
        timestamp: now,
        latencyMs: 200,
        outcome: ActionOutcome.FAILURE,
        errorType: "TIMEOUT",
      }));
      now += 10;
    }

    const telegram = monitor.snapshot(Platform.TELEGRAM)!;
    const instagram = monitor.snapshot(Platform.INSTAGRAM)!;

    expect(telegram.successRate).toBe(1);
    expect(telegram.avgLatencyMs).toBe(100);

    expect(instagram.successRate).toBe(0);
    expect(instagram.errorRate).toBe(1);
  });

  it("snapshotAll returns metrics for all registered platforms", () => {
    let now = 1000;
    const monitor = new HealthMonitor({ clock: () => now });

    monitor.record(Platform.TELEGRAM, makeResult({ timestamp: now, latencyMs: 50 }));
    monitor.record(Platform.DISCORD, makeResult({ timestamp: now, latencyMs: 60 }));
    monitor.registerPlatform(Platform.WHATSAPP);

    const all = monitor.snapshotAll();
    expect(all.size).toBe(3);
    expect(all.has(Platform.TELEGRAM)).toBe(true);
    expect(all.has(Platform.DISCORD)).toBe(true);
    expect(all.has(Platform.WHATSAPP)).toBe(true);
  });

  it("snapshotAll notifies listeners for each platform", () => {
    let now = 1000;
    const monitor = new HealthMonitor({ clock: () => now });

    monitor.record(Platform.TELEGRAM, makeResult({ timestamp: now, latencyMs: 50 }));
    monitor.record(Platform.DISCORD, makeResult({ timestamp: now, latencyMs: 60 }));

    const received: HealthMetrics[] = [];
    monitor.onHealth((metrics) => received.push(metrics));

    monitor.snapshotAll();
    expect(received.length).toBe(2);
    expect(received.map(m => m.platform).sort()).toEqual(
      [Platform.DISCORD, Platform.TELEGRAM].sort(),
    );
  });

  it("onHealth unsubscribe works", () => {
    let now = 1000;
    const monitor = new HealthMonitor({ clock: () => now });

    monitor.record(Platform.TELEGRAM, makeResult({ timestamp: now, latencyMs: 50 }));

    const received: HealthMetrics[] = [];
    const unsub = monitor.onHealth((metrics) => received.push(metrics));

    monitor.snapshotAll();
    expect(received.length).toBe(1);

    unsub();
    monitor.snapshotAll();
    expect(received.length).toBe(1); // No new notifications
  });

  it("handles listener exceptions gracefully", () => {
    let now = 1000;
    const monitor = new HealthMonitor({ clock: () => now });
    monitor.record(Platform.TELEGRAM, makeResult({ timestamp: now, latencyMs: 50 }));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const good: HealthMetrics[] = [];
    monitor.onHealth(() => { throw new Error("boom"); });
    monitor.onHealth((metrics) => good.push(metrics));

    monitor.snapshotAll();
    expect(good.length).toBe(1); // Second listener still called
    expect(consoleSpy).toHaveBeenCalledOnce();

    consoleSpy.mockRestore();
  });

  it("hasDetectionSignal returns true when any platform is detected", () => {
    let now = 1000;
    const monitor = new HealthMonitor({ clock: () => now });

    monitor.record(Platform.TELEGRAM, makeResult({ timestamp: now, latencyMs: 50 }));
    expect(monitor.hasDetectionSignal()).toBe(false);

    monitor.record(Platform.INSTAGRAM, makeResult({
      timestamp: now,
      latencyMs: 100,
      detection: { captchaEncountered: true },
    }));
    expect(monitor.hasDetectionSignal()).toBe(true);
  });

  it("getDisconnectedPlatforms returns platforms without recent success", () => {
    let now = 1000;
    const monitor = new HealthMonitor({
      clock: () => now,
      defaultCollectorConfig: { disconnectThresholdMs: 500 },
    });

    monitor.record(Platform.TELEGRAM, makeResult({ timestamp: now, latencyMs: 50 }));
    monitor.record(Platform.INSTAGRAM, makeResult({ timestamp: now, latencyMs: 50 }));

    expect(monitor.getDisconnectedPlatforms()).toEqual([]);

    // Advance past threshold
    now = 2000;
    expect(monitor.getDisconnectedPlatforms().sort()).toEqual(
      [Platform.INSTAGRAM, Platform.TELEGRAM].sort(),
    );
  });

  it("reset clears all collectors", () => {
    let now = 1000;
    const monitor = new HealthMonitor({ clock: () => now });

    monitor.record(Platform.TELEGRAM, makeResult({ timestamp: now, latencyMs: 50 }));
    expect(monitor.platforms.size).toBe(1);

    monitor.reset();
    expect(monitor.platforms.size).toBe(0);
    expect(monitor.snapshot(Platform.TELEGRAM)).toBeNull();
  });

  it("resetPlatform clears only one platform", () => {
    let now = 1000;
    const monitor = new HealthMonitor({ clock: () => now });

    monitor.record(Platform.TELEGRAM, makeResult({ timestamp: now, latencyMs: 50 }));
    monitor.record(Platform.DISCORD, makeResult({ timestamp: now, latencyMs: 60 }));

    monitor.resetPlatform(Platform.TELEGRAM);

    // Telegram collector still exists but is empty
    const telegram = monitor.snapshot(Platform.TELEGRAM)!;
    expect(telegram.sampleCount).toBe(0);

    // Discord unaffected
    const discord = monitor.snapshot(Platform.DISCORD)!;
    expect(discord.sampleCount).toBe(1);
  });

  it("applies per-platform config overrides", () => {
    let now = 1000;
    const monitor = new HealthMonitor({
      clock: () => now,
      defaultCollectorConfig: { windowMs: 5000 },
      platformConfigs: {
        [Platform.INSTAGRAM]: { windowMs: 1000 },
      },
    });

    // Record at t=1000
    monitor.record(Platform.TELEGRAM, makeResult({ timestamp: 1000, latencyMs: 50 }));
    monitor.record(Platform.INSTAGRAM, makeResult({ timestamp: 1000, latencyMs: 50 }));

    // Advance to t=3000 — past Instagram's 1s window but within Telegram's 5s window
    now = 3000;
    expect(monitor.snapshot(Platform.TELEGRAM)!.sampleCount).toBe(1);
    expect(monitor.snapshot(Platform.INSTAGRAM)!.sampleCount).toBe(0);
  });
});
