import { describe, it, expect, vi } from "vitest";
import { AlertManager } from "../src/alerting.js";
import { AlertSeverity, AlertState, Platform } from "../src/types.js";
import type { AlertEvent, AlertRule, HealthMetrics } from "../src/types.js";

/**
 * Build a HealthMetrics object with sensible defaults.
 * Override any field via the partial parameter.
 */
function makeMetrics(overrides: Partial<HealthMetrics> = {}): HealthMetrics {
  return {
    platform: Platform.TELEGRAM,
    timestamp: new Date(1000),
    connected: true,
    lastSuccessfulAction: new Date(1000),
    avgLatencyMs: 100,
    p99LatencyMs: 200,
    successRate: 1,
    errorRate: 0,
    errorTypes: new Map(),
    suspectedDetection: false,
    captchaEncountered: false,
    rateLimited: false,
    sampleCount: 10,
    ...overrides,
  };
}

const HIGH_ERROR_RATE_RULE: AlertRule = {
  id: "high-error-rate",
  name: "High error rate",
  severity: AlertSeverity.CRITICAL,
  platforms: [],
  conditions: [{ metric: "errorRate", operator: "gt", threshold: 0.5 }],
  cooldownMs: 1000,
};

const HIGH_LATENCY_RULE: AlertRule = {
  id: "high-latency",
  name: "High p99 latency",
  severity: AlertSeverity.WARNING,
  platforms: [Platform.INSTAGRAM],
  conditions: [{ metric: "p99LatencyMs", operator: "gt", threshold: 5000 }],
  cooldownMs: 1000,
};

const DETECTION_RULE: AlertRule = {
  id: "detection",
  name: "Bot detection",
  severity: AlertSeverity.CRITICAL,
  platforms: [],
  conditions: [{ metric: "captchaEncountered", operator: "eq", threshold: 1 }],
  cooldownMs: 500,
};

describe("AlertManager", () => {
  it("fires alert when conditions are met", () => {
    const now = 1000;
    const alerter = new AlertManager({
      rules: [HIGH_ERROR_RATE_RULE],
      clock: () => now,
    });

    const events = alerter.evaluate(makeMetrics({ errorRate: 0.8 }));
    expect(events).toHaveLength(1);
    expect(events[0].state).toBe(AlertState.FIRING);
    expect(events[0].ruleId).toBe("high-error-rate");
    expect(events[0].severity).toBe(AlertSeverity.CRITICAL);
  });

  it("does not fire when conditions are not met", () => {
    const now = 1000;
    const alerter = new AlertManager({
      rules: [HIGH_ERROR_RATE_RULE],
      clock: () => now,
    });

    const events = alerter.evaluate(makeMetrics({ errorRate: 0.3 }));
    expect(events).toHaveLength(0);
  });

  it("resolves alert when conditions are no longer met", () => {
    let now = 1000;
    const alerter = new AlertManager({
      rules: [HIGH_ERROR_RATE_RULE],
      clock: () => now,
    });

    // Fire
    alerter.evaluate(makeMetrics({ errorRate: 0.8 }));
    expect(alerter.isFiring("high-error-rate", Platform.TELEGRAM)).toBe(true);

    // Resolve
    now = 3000;
    const events = alerter.evaluate(makeMetrics({ errorRate: 0.2 }));
    expect(events).toHaveLength(1);
    expect(events[0].state).toBe(AlertState.RESOLVED);
    expect(alerter.isFiring("high-error-rate", Platform.TELEGRAM)).toBe(false);
  });

  it("enforces cooldown between firings", () => {
    let now = 1000;
    const alerter = new AlertManager({
      rules: [HIGH_ERROR_RATE_RULE],
      clock: () => now,
    });

    // Fire
    alerter.evaluate(makeMetrics({ errorRate: 0.8 }));

    // Resolve
    now = 1200;
    alerter.evaluate(makeMetrics({ errorRate: 0.2 }));

    // Try to fire again within cooldown (cooldownMs = 1000, fired at 1000, now 1500)
    now = 1500;
    const events = alerter.evaluate(makeMetrics({ errorRate: 0.9 }));
    expect(events).toHaveLength(0); // Still in cooldown

    // After cooldown expires
    now = 2500;
    const events2 = alerter.evaluate(makeMetrics({ errorRate: 0.9 }));
    expect(events2).toHaveLength(1);
    expect(events2[0].state).toBe(AlertState.FIRING);
  });

  it("supports hysteresis with separate resolve conditions", () => {
    let now = 1000;
    const rule: AlertRule = {
      id: "hysteresis",
      name: "Hysteresis test",
      severity: AlertSeverity.WARNING,
      platforms: [],
      conditions: [{ metric: "errorRate", operator: "gt", threshold: 0.5 }],
      resolveConditions: [{ metric: "errorRate", operator: "lt", threshold: 0.2 }],
      cooldownMs: 0,
    };

    const alerter = new AlertManager({
      rules: [rule],
      clock: () => now,
    });

    // Fire at 0.8
    alerter.evaluate(makeMetrics({ errorRate: 0.8 }));
    expect(alerter.isFiring("hysteresis", Platform.TELEGRAM)).toBe(true);

    // Drop to 0.3 — below trigger but above resolve threshold
    now = 2000;
    const events = alerter.evaluate(makeMetrics({ errorRate: 0.3 }));
    expect(events).toHaveLength(0); // Still firing (hysteresis)
    expect(alerter.isFiring("hysteresis", Platform.TELEGRAM)).toBe(true);

    // Drop to 0.1 — below resolve threshold
    now = 3000;
    const events2 = alerter.evaluate(makeMetrics({ errorRate: 0.1 }));
    expect(events2).toHaveLength(1);
    expect(events2[0].state).toBe(AlertState.RESOLVED);
  });

  it("only applies to specified platforms", () => {
    const now = 1000;
    const alerter = new AlertManager({
      rules: [HIGH_LATENCY_RULE], // Only applies to INSTAGRAM
      clock: () => now,
    });

    // Telegram — should not trigger
    const ev1 = alerter.evaluate(makeMetrics({
      platform: Platform.TELEGRAM,
      p99LatencyMs: 10_000,
    }));
    expect(ev1).toHaveLength(0);

    // Instagram — should trigger
    const ev2 = alerter.evaluate(makeMetrics({
      platform: Platform.INSTAGRAM,
      p99LatencyMs: 10_000,
    }));
    expect(ev2).toHaveLength(1);
    expect(ev2[0].platform).toBe(Platform.INSTAGRAM);
  });

  it("handles boolean metric conditions", () => {
    const now = 1000;
    const alerter = new AlertManager({
      rules: [DETECTION_RULE],
      clock: () => now,
    });

    // No captcha
    const ev1 = alerter.evaluate(makeMetrics({ captchaEncountered: false }));
    expect(ev1).toHaveLength(0);

    // Captcha detected
    const ev2 = alerter.evaluate(makeMetrics({ captchaEncountered: true }));
    expect(ev2).toHaveLength(1);
    expect(ev2[0].state).toBe(AlertState.FIRING);
  });

  it("supports AND logic for multiple conditions", () => {
    let now = 1000;
    const rule: AlertRule = {
      id: "multi-cond",
      name: "Multi-condition",
      severity: AlertSeverity.CRITICAL,
      platforms: [],
      conditions: [
        { metric: "errorRate", operator: "gt", threshold: 0.3 },
        { metric: "p99LatencyMs", operator: "gt", threshold: 1000 },
      ],
      cooldownMs: 0,
    };

    const alerter = new AlertManager({
      rules: [rule],
      clock: () => now,
    });

    // Only error rate high — should NOT fire
    const ev1 = alerter.evaluate(makeMetrics({ errorRate: 0.5, p99LatencyMs: 500 }));
    expect(ev1).toHaveLength(0);

    // Only latency high — should NOT fire
    now = 2000;
    const ev2 = alerter.evaluate(makeMetrics({ errorRate: 0.1, p99LatencyMs: 5000 }));
    expect(ev2).toHaveLength(0);

    // Both high — should fire
    now = 3000;
    const ev3 = alerter.evaluate(makeMetrics({ errorRate: 0.5, p99LatencyMs: 5000 }));
    expect(ev3).toHaveLength(1);
    expect(ev3[0].state).toBe(AlertState.FIRING);
  });

  it("notifies listeners on alert events", () => {
    const now = 1000;
    const alerter = new AlertManager({
      rules: [HIGH_ERROR_RATE_RULE],
      clock: () => now,
    });

    const received: AlertEvent[] = [];
    alerter.onAlert((event) => received.push(event));

    alerter.evaluate(makeMetrics({ errorRate: 0.8 }));
    expect(received).toHaveLength(1);
    expect(received[0].state).toBe(AlertState.FIRING);
  });

  it("onAlert unsubscribe works", () => {
    let now = 1000;
    const alerter = new AlertManager({
      rules: [HIGH_ERROR_RATE_RULE],
      clock: () => now,
    });

    const received: AlertEvent[] = [];
    const unsub = alerter.onAlert((event) => received.push(event));

    alerter.evaluate(makeMetrics({ errorRate: 0.8 }));
    expect(received).toHaveLength(1);

    unsub();
    now = 5000;
    alerter.evaluate(makeMetrics({ errorRate: 0.2 })); // resolve
    expect(received).toHaveLength(1); // No new event
  });

  it("handles listener exceptions gracefully", () => {
    const now = 1000;
    const alerter = new AlertManager({
      rules: [HIGH_ERROR_RATE_RULE],
      clock: () => now,
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const good: AlertEvent[] = [];
    alerter.onAlert(() => { throw new Error("boom"); });
    alerter.onAlert((event) => good.push(event));

    alerter.evaluate(makeMetrics({ errorRate: 0.8 }));
    expect(good).toHaveLength(1);
    expect(consoleSpy).toHaveBeenCalledOnce();

    consoleSpy.mockRestore();
  });

  it("getActiveAlerts returns currently firing alerts", () => {
    const now = 1000;
    const alerter = new AlertManager({
      rules: [HIGH_ERROR_RATE_RULE, DETECTION_RULE],
      clock: () => now,
    });

    // Both conditions met in the same metrics snapshot
    alerter.evaluate(makeMetrics({ errorRate: 0.8, captchaEncountered: true }));

    const active = alerter.getActiveAlerts();
    expect(active).toHaveLength(2);
    expect(active.map(a => a.ruleId).sort()).toEqual(["detection", "high-error-rate"]);
  });

  it("manual resolve works", () => {
    const now = 1000;
    const alerter = new AlertManager({
      rules: [HIGH_ERROR_RATE_RULE],
      clock: () => now,
    });

    alerter.evaluate(makeMetrics({ errorRate: 0.8 }));
    expect(alerter.isFiring("high-error-rate", Platform.TELEGRAM)).toBe(true);

    alerter.resolve("high-error-rate", Platform.TELEGRAM);
    expect(alerter.isFiring("high-error-rate", Platform.TELEGRAM)).toBe(false);
  });

  it("reset clears all alert state", () => {
    const now = 1000;
    const alerter = new AlertManager({
      rules: [HIGH_ERROR_RATE_RULE],
      clock: () => now,
    });

    alerter.evaluate(makeMetrics({ errorRate: 0.8 }));
    expect(alerter.getActiveAlerts()).toHaveLength(1);

    alerter.reset();
    expect(alerter.getActiveAlerts()).toHaveLength(0);
  });

  it("tracks alerts per platform independently", () => {
    let now = 1000;
    const alerter = new AlertManager({
      rules: [HIGH_ERROR_RATE_RULE],
      clock: () => now,
    });

    // Fire for Telegram
    alerter.evaluate(makeMetrics({ platform: Platform.TELEGRAM, errorRate: 0.8 }));
    expect(alerter.isFiring("high-error-rate", Platform.TELEGRAM)).toBe(true);
    expect(alerter.isFiring("high-error-rate", Platform.INSTAGRAM)).toBe(false);

    // Fire for Instagram
    alerter.evaluate(makeMetrics({ platform: Platform.INSTAGRAM, errorRate: 0.9 }));
    expect(alerter.isFiring("high-error-rate", Platform.INSTAGRAM)).toBe(true);

    // Resolve Telegram only
    now = 3000;
    alerter.evaluate(makeMetrics({ platform: Platform.TELEGRAM, errorRate: 0.1 }));
    expect(alerter.isFiring("high-error-rate", Platform.TELEGRAM)).toBe(false);
    expect(alerter.isFiring("high-error-rate", Platform.INSTAGRAM)).toBe(true);
  });

  it("comparison operators work correctly", () => {
    let now = 1000;

    const makeRule = (op: "gt" | "gte" | "lt" | "lte" | "eq", threshold: number): AlertRule => ({
      id: `test-${op}`,
      name: `Test ${op}`,
      severity: AlertSeverity.INFO,
      platforms: [],
      conditions: [{ metric: "errorRate", operator: op, threshold }],
      cooldownMs: 0,
    });

    // gt: 0.5 > 0.5 = false, 0.6 > 0.5 = true
    const gt = new AlertManager({ rules: [makeRule("gt", 0.5)], clock: () => now });
    expect(gt.evaluate(makeMetrics({ errorRate: 0.5 }))).toHaveLength(0);
    now++;
    expect(gt.evaluate(makeMetrics({ errorRate: 0.6 }))).toHaveLength(1); // fires

    // gte: 0.5 >= 0.5 = true
    now = 1000;
    const gte = new AlertManager({ rules: [makeRule("gte", 0.5)], clock: () => now });
    expect(gte.evaluate(makeMetrics({ errorRate: 0.5 }))).toHaveLength(1);

    // lt: 0.3 < 0.5 = true
    now = 1000;
    const lt = new AlertManager({ rules: [makeRule("lt", 0.5)], clock: () => now });
    expect(lt.evaluate(makeMetrics({ errorRate: 0.3 }))).toHaveLength(1);

    // lte: 0.5 <= 0.5 = true
    now = 1000;
    const lte = new AlertManager({ rules: [makeRule("lte", 0.5)], clock: () => now });
    expect(lte.evaluate(makeMetrics({ errorRate: 0.5 }))).toHaveLength(1);

    // eq: 0.5 == 0.5 = true
    now = 1000;
    const eq = new AlertManager({ rules: [makeRule("eq", 0.5)], clock: () => now });
    expect(eq.evaluate(makeMetrics({ errorRate: 0.5 }))).toHaveLength(1);
  });

  it("includes metrics in alert event", () => {
    const now = 1000;
    const alerter = new AlertManager({
      rules: [HIGH_ERROR_RATE_RULE],
      clock: () => now,
    });

    const metrics = makeMetrics({ errorRate: 0.8, p99LatencyMs: 3000 });
    const events = alerter.evaluate(metrics);

    expect(events[0].metrics).toBe(metrics);
    expect(events[0].metrics.errorRate).toBe(0.8);
    expect(events[0].metrics.p99LatencyMs).toBe(3000);
  });

  it("exposes configured rules", () => {
    const alerter = new AlertManager({
      rules: [HIGH_ERROR_RATE_RULE, HIGH_LATENCY_RULE],
    });

    expect(alerter.rules).toHaveLength(2);
    expect(alerter.rules[0].id).toBe("high-error-rate");
    expect(alerter.rules[1].id).toBe("high-latency");
  });
});
