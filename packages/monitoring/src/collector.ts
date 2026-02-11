import type {
  ActionResult,
  ClockFn,
  CollectorConfig,
  HealthMetrics,
} from "./types.js";
import { ActionOutcome, Platform } from "./types.js";

const DEFAULT_WINDOW_MS = 300_000; // 5 minutes
const DEFAULT_MAX_WINDOW_SIZE = 10_000;
const DEFAULT_DISCONNECT_THRESHOLD_MS = 60_000; // 1 minute

/**
 * Collects and aggregates action results for a single platform.
 *
 * Uses a time-based sliding window: only actions within the last `windowMs`
 * milliseconds are considered when computing metrics. Eviction happens lazily
 * on record() and snapshot() calls — no background timers.
 *
 * Thread-safety: not thread-safe. Designed for single-threaded Node.js use.
 */
export class PlatformMetricsCollector {
  readonly platform: Platform;

  private readonly _windowMs: number;
  private readonly _maxWindowSize: number;
  private readonly _disconnectThresholdMs: number;
  private readonly _clock: ClockFn;

  /**
   * Circular buffer of action results within the current window.
   * Sorted by timestamp ascending (newest at the end).
   */
  private _window: ActionResult[] = [];

  /** Timestamp of the last successful action (ms epoch), or null if none. */
  private _lastSuccessAt: number | null = null;

  /**
   * Whether the platform is considered connected.
   * Starts as false until the first successful action.
   */
  private _connected = false;

  /**
   * Detection signal flags. Sticky within the current window:
   * set to true when observed, reset only when no actions in the
   * window carry the signal.
   */
  private _captchaEncountered = false;
  private _rateLimited = false;
  private _suspectedDetection = false;

  constructor(config: CollectorConfig) {
    this.platform = config.platform;
    this._windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
    this._maxWindowSize = config.maxWindowSize ?? DEFAULT_MAX_WINDOW_SIZE;
    this._disconnectThresholdMs = config.disconnectThresholdMs ?? DEFAULT_DISCONNECT_THRESHOLD_MS;
    this._clock = config.clock ?? Date.now;
  }

  /**
   * Record an action result. Evicts stale entries, then appends.
   */
  record(result: ActionResult): void {
    this._evict();

    // Enforce max window size by dropping oldest entries
    if (this._window.length >= this._maxWindowSize) {
      this._window.splice(0, this._window.length - this._maxWindowSize + 1);
    }

    this._window.push(result);

    if (result.outcome === ActionOutcome.SUCCESS) {
      this._lastSuccessAt = result.timestamp;
      this._connected = true;
    }

    // Update detection flags from this action
    if (result.detection) {
      if (result.detection.captchaEncountered) this._captchaEncountered = true;
      if (result.detection.rateLimited) this._rateLimited = true;
      if (result.detection.suspectedDetection) this._suspectedDetection = true;
    }
  }

  /**
   * Compute a health metrics snapshot from the current window.
   */
  snapshot(): HealthMetrics {
    this._evict();
    this._updateConnectionStatus();
    this._refreshDetectionFlags();

    const now = this._clock();
    const window = this._window;
    const count = window.length;

    if (count === 0) {
      return {
        platform: this.platform,
        timestamp: new Date(now),
        connected: this._connected,
        lastSuccessfulAction: this._lastSuccessAt !== null ? new Date(this._lastSuccessAt) : null,
        avgLatencyMs: 0,
        p99LatencyMs: 0,
        successRate: 0,
        errorRate: 0,
        errorTypes: new Map(),
        suspectedDetection: this._suspectedDetection,
        captchaEncountered: this._captchaEncountered,
        rateLimited: this._rateLimited,
        sampleCount: 0,
      };
    }

    // Compute latency statistics
    const latencies = window.map(r => r.latencyMs).sort((a, b) => a - b);
    const avgLatencyMs = latencies.reduce((sum, l) => sum + l, 0) / count;
    const p99Index = Math.min(Math.ceil(count * 0.99) - 1, count - 1);
    const p99LatencyMs = latencies[p99Index];

    // Compute success/error rates
    const successCount = window.filter(r => r.outcome === ActionOutcome.SUCCESS).length;
    const successRate = successCount / count;
    const errorRate = 1 - successRate;

    // Aggregate error types
    const errorTypes = new Map<string, number>();
    for (const result of window) {
      if (result.outcome === ActionOutcome.FAILURE && result.errorType) {
        errorTypes.set(result.errorType, (errorTypes.get(result.errorType) ?? 0) + 1);
      }
    }

    return {
      platform: this.platform,
      timestamp: new Date(now),
      connected: this._connected,
      lastSuccessfulAction: this._lastSuccessAt !== null ? new Date(this._lastSuccessAt) : null,
      avgLatencyMs,
      p99LatencyMs,
      successRate,
      errorRate,
      errorTypes,
      suspectedDetection: this._suspectedDetection,
      captchaEncountered: this._captchaEncountered,
      rateLimited: this._rateLimited,
      sampleCount: count,
    };
  }

  /**
   * Number of action results currently in the window.
   */
  get windowSize(): number {
    return this._window.length;
  }

  /**
   * Clear all collected data and reset state.
   */
  reset(): void {
    this._window = [];
    this._lastSuccessAt = null;
    this._connected = false;
    this._captchaEncountered = false;
    this._rateLimited = false;
    this._suspectedDetection = false;
  }

  /**
   * Evict actions older than the sliding window.
   */
  private _evict(): void {
    const cutoff = this._clock() - this._windowMs;
    // Binary search for the first entry within the window.
    // Since _window is sorted by timestamp, we can find the cutoff point efficiently.
    let lo = 0;
    let hi = this._window.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._window[mid].timestamp < cutoff) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo > 0) {
      this._window.splice(0, lo);
    }
  }

  /**
   * Update connection status based on disconnect threshold.
   */
  private _updateConnectionStatus(): void {
    if (this._lastSuccessAt === null) {
      this._connected = false;
      return;
    }
    const elapsed = this._clock() - this._lastSuccessAt;
    this._connected = elapsed < this._disconnectThresholdMs;
  }

  /**
   * Refresh detection flags from the current window.
   * Flags are cleared if no actions in the window carry them.
   */
  private _refreshDetectionFlags(): void {
    let captcha = false;
    let rateLimit = false;
    let detection = false;

    for (const result of this._window) {
      if (result.detection) {
        if (result.detection.captchaEncountered) captcha = true;
        if (result.detection.rateLimited) rateLimit = true;
        if (result.detection.suspectedDetection) detection = true;
      }
    }

    this._captchaEncountered = captcha;
    this._rateLimited = rateLimit;
    this._suspectedDetection = detection;
  }
}
