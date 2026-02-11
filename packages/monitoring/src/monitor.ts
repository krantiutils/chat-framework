import type {
  ActionResult,
  ClockFn,
  HealthListener,
  HealthMetrics,
  MonitorConfig,
} from "./types.js";
import { Platform } from "./types.js";
import { PlatformMetricsCollector } from "./collector.js";

/**
 * Orchestrates per-platform metrics collectors and provides a unified
 * health view across all monitored platforms.
 *
 * Collectors are created lazily on the first record() call for a platform,
 * or eagerly via registerPlatform().
 *
 * No internal timers — call snapshotAll() or snapshot(platform) to pull
 * current metrics, consistent with the pull-based design of @chat-framework/core.
 */
export class HealthMonitor {
  private readonly _collectors: Map<Platform, PlatformMetricsCollector> = new Map();
  private readonly _listeners: HealthListener[] = [];
  private readonly _config: MonitorConfig;
  private readonly _clock: ClockFn;

  constructor(config: MonitorConfig = {}) {
    this._config = config;
    this._clock = config.clock ?? Date.now;
  }

  /**
   * Eagerly register a platform, creating its collector if it doesn't exist.
   * Useful for platforms that should appear in snapshots even before their
   * first action is recorded.
   */
  registerPlatform(platform: Platform): void {
    this._ensureCollector(platform);
  }

  /**
   * Record an action result for a platform.
   * Creates the collector lazily if it doesn't exist yet.
   */
  record(platform: Platform, result: ActionResult): void {
    const collector = this._ensureCollector(platform);
    collector.record(result);
  }

  /**
   * Get the current health metrics snapshot for a specific platform.
   * Returns null if the platform has never been registered or recorded to.
   */
  snapshot(platform: Platform): HealthMetrics | null {
    const collector = this._collectors.get(platform);
    if (!collector) return null;
    return collector.snapshot();
  }

  /**
   * Get health metrics snapshots for all registered platforms.
   * Notifies listeners for each snapshot.
   */
  snapshotAll(): Map<Platform, HealthMetrics> {
    const snapshots = new Map<Platform, HealthMetrics>();

    for (const [platform, collector] of this._collectors) {
      const metrics = collector.snapshot();
      snapshots.set(platform, metrics);
      this._notifyListeners(metrics);
    }

    return snapshots;
  }

  /**
   * Register a listener that receives health metrics on snapshotAll() calls.
   * Returns an unsubscribe function.
   */
  onHealth(listener: HealthListener): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  /**
   * Get the set of currently registered platforms.
   */
  get platforms(): ReadonlySet<Platform> {
    return new Set(this._collectors.keys());
  }

  /**
   * Reset all collectors and clear registrations.
   */
  reset(): void {
    for (const collector of this._collectors.values()) {
      collector.reset();
    }
    this._collectors.clear();
  }

  /**
   * Reset a specific platform's collector.
   */
  resetPlatform(platform: Platform): void {
    const collector = this._collectors.get(platform);
    if (collector) {
      collector.reset();
    }
  }

  /**
   * Check if any platform has an active detection signal.
   * Useful for quick "are we detected?" checks without pulling full snapshots.
   */
  hasDetectionSignal(): boolean {
    for (const collector of this._collectors.values()) {
      const metrics = collector.snapshot();
      if (metrics.suspectedDetection || metrics.captchaEncountered || metrics.rateLimited) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get platforms that are currently disconnected.
   */
  getDisconnectedPlatforms(): Platform[] {
    const disconnected: Platform[] = [];
    for (const [platform, collector] of this._collectors) {
      const metrics = collector.snapshot();
      if (!metrics.connected) {
        disconnected.push(platform);
      }
    }
    return disconnected;
  }

  private _ensureCollector(platform: Platform): PlatformMetricsCollector {
    let collector = this._collectors.get(platform);
    if (!collector) {
      const platformOverride = this._config.platformConfigs?.[platform];
      const defaults = this._config.defaultCollectorConfig ?? {};
      collector = new PlatformMetricsCollector({
        ...defaults,
        ...platformOverride,
        platform,
        clock: platformOverride?.clock ?? defaults.clock ?? this._clock,
      });
      this._collectors.set(platform, collector);
    }
    return collector;
  }

  private _notifyListeners(metrics: HealthMetrics): void {
    const listeners = [...this._listeners];
    for (const listener of listeners) {
      try {
        listener(metrics);
      } catch (err) {
        console.error("HealthMonitor: listener threw during notification", err);
      }
    }
  }
}
