// @chat-framework/monitoring
// Health monitoring with per-platform metrics collection, error rate tracking, and alerting.

export {
  Platform,
  ActionOutcome,
  AlertSeverity,
  AlertState,
} from "./types.js";

export type {
  ClockFn,
  DetectionSignals,
  ActionResult,
  HealthMetrics,
  CollectorConfig,
  HealthListener,
  MonitorConfig,
  AlertCondition,
  AlertRule,
  AlertEvent,
  AlertListener,
  AlertManagerConfig,
} from "./types.js";

export { PlatformMetricsCollector } from "./collector.js";
export { HealthMonitor } from "./monitor.js";
export { AlertManager } from "./alerting.js";
