import type {
  AlertCondition,
  AlertEvent,
  AlertListener,
  AlertManagerConfig,
  AlertRule,
  ClockFn,
  HealthMetrics,
} from "./types.js";
import { AlertState, Platform } from "./types.js";

const DEFAULT_COOLDOWN_MS = 300_000; // 5 minutes

/**
 * Composite key for tracking alert state per (rule, platform) pair.
 */
function alertKey(ruleId: string, platform: Platform): string {
  return `${ruleId}::${platform}`;
}

/**
 * Internal state for a single (rule, platform) alert instance.
 */
interface AlertInstance {
  /** Current state of this alert */
  state: AlertState;
  /** Timestamp when this alert last fired */
  lastFiredAt: number;
  /** Timestamp when this alert last resolved */
  lastResolvedAt: number;
}

/**
 * Evaluates alert rules against health metrics and manages alert lifecycle.
 *
 * Features:
 * - AND logic: all conditions in a rule must be met to trigger
 * - Hysteresis: separate trigger and resolve conditions prevent flapping
 * - Cooldown: minimum time between repeated firings per (rule, platform)
 * - Severity levels: INFO, WARNING, CRITICAL
 * - Callback-based notifications (no external dependencies)
 *
 * Usage:
 * ```ts
 * const alerter = new AlertManager({
 *   rules: [{
 *     id: "high-error-rate",
 *     name: "High error rate",
 *     severity: AlertSeverity.CRITICAL,
 *     platforms: [],
 *     conditions: [{ metric: "errorRate", operator: "gt", threshold: 0.5 }],
 *     resolveConditions: [{ metric: "errorRate", operator: "lt", threshold: 0.3 }],
 *     cooldownMs: 60_000,
 *   }],
 * });
 *
 * alerter.onAlert((event) => {
 *   console.log(`[${event.severity}] ${event.ruleName} on ${event.platform}: ${event.state}`);
 * });
 *
 * // Feed metrics from the HealthMonitor
 * alerter.evaluate(metrics);
 * ```
 */
export class AlertManager {
  private readonly _rules: AlertRule[];
  private readonly _clock: ClockFn;
  private readonly _instances: Map<string, AlertInstance> = new Map();
  private readonly _listeners: AlertListener[] = [];

  constructor(config: AlertManagerConfig) {
    this._rules = config.rules;
    this._clock = config.clock ?? Date.now;
  }

  /**
   * Evaluate all applicable rules against a health metrics snapshot.
   * Fires or resolves alerts as appropriate and notifies listeners.
   *
   * Returns the list of alert events emitted during this evaluation.
   */
  evaluate(metrics: HealthMetrics): AlertEvent[] {
    const events: AlertEvent[] = [];
    const now = this._clock();

    for (const rule of this._rules) {
      // Check if this rule applies to the given platform
      if (rule.platforms.length > 0 && !rule.platforms.includes(metrics.platform)) {
        continue;
      }

      const key = alertKey(rule.id, metrics.platform);
      const instance = this._ensureInstance(key);
      const triggered = this._evaluateConditions(rule.conditions, metrics);

      if (instance.state === AlertState.RESOLVED && triggered) {
        // Check cooldown
        const cooldown = rule.cooldownMs ?? DEFAULT_COOLDOWN_MS;
        if (now - instance.lastFiredAt < cooldown) {
          continue;
        }

        // FIRE
        instance.state = AlertState.FIRING;
        instance.lastFiredAt = now;

        const event: AlertEvent = {
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          platform: metrics.platform,
          state: AlertState.FIRING,
          timestamp: now,
          metrics,
        };
        events.push(event);
        this._notifyListeners(event);
      } else if (instance.state === AlertState.FIRING) {
        // Check resolve conditions (hysteresis)
        const resolveConditions = rule.resolveConditions ?? rule.conditions;
        const shouldResolve = rule.resolveConditions
          ? this._evaluateConditions(resolveConditions, metrics)
          : !triggered;

        if (shouldResolve) {
          // RESOLVE
          instance.state = AlertState.RESOLVED;
          instance.lastResolvedAt = now;

          const event: AlertEvent = {
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            platform: metrics.platform,
            state: AlertState.RESOLVED,
            timestamp: now,
            metrics,
          };
          events.push(event);
          this._notifyListeners(event);
        }
      }
    }

    return events;
  }

  /**
   * Register a listener for alert events.
   * Returns an unsubscribe function.
   */
  onAlert(listener: AlertListener): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  /**
   * Get the current state of all alert instances.
   */
  getActiveAlerts(): (AlertInstance & { ruleId: string; platform: string })[] {
    const active: (AlertInstance & { ruleId: string; platform: string })[] = [];
    for (const [key, instance] of this._instances) {
      if (instance.state === AlertState.FIRING) {
        const [ruleId, platform] = key.split("::");
        active.push({ ...instance, ruleId, platform });
      }
    }
    return active;
  }

  /**
   * Check if a specific rule is currently firing for a platform.
   */
  isFiring(ruleId: string, platform: Platform): boolean {
    const key = alertKey(ruleId, platform);
    const instance = this._instances.get(key);
    return instance?.state === AlertState.FIRING;
  }

  /**
   * Manually resolve an alert. Useful for operator acknowledgement.
   */
  resolve(ruleId: string, platform: Platform): void {
    const key = alertKey(ruleId, platform);
    const instance = this._instances.get(key);
    if (instance && instance.state === AlertState.FIRING) {
      instance.state = AlertState.RESOLVED;
      instance.lastResolvedAt = this._clock();
    }
  }

  /**
   * Clear all alert state.
   */
  reset(): void {
    this._instances.clear();
  }

  /**
   * Get the currently configured rules.
   */
  get rules(): readonly AlertRule[] {
    return this._rules;
  }

  /**
   * Evaluate a set of conditions against metrics. All conditions must be
   * satisfied (AND logic).
   */
  private _evaluateConditions(conditions: AlertCondition[], metrics: HealthMetrics): boolean {
    return conditions.every(cond => this._evaluateCondition(cond, metrics));
  }

  /**
   * Evaluate a single condition against metrics.
   */
  private _evaluateCondition(condition: AlertCondition, metrics: HealthMetrics): boolean {
    const rawValue = metrics[condition.metric];
    // Convert booleans to numbers for comparison
    const value = typeof rawValue === "boolean" ? (rawValue ? 1 : 0) : rawValue;

    switch (condition.operator) {
      case "gt":
        return value > condition.threshold;
      case "gte":
        return value >= condition.threshold;
      case "lt":
        return value < condition.threshold;
      case "lte":
        return value <= condition.threshold;
      case "eq":
        return value === condition.threshold;
    }
  }

  private _ensureInstance(key: string): AlertInstance {
    let instance = this._instances.get(key);
    if (!instance) {
      instance = {
        state: AlertState.RESOLVED,
        lastFiredAt: 0,
        lastResolvedAt: 0,
      };
      this._instances.set(key, instance);
    }
    return instance;
  }

  private _notifyListeners(event: AlertEvent): void {
    const listeners = [...this._listeners];
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("AlertManager: listener threw during notification", err);
      }
    }
  }
}
