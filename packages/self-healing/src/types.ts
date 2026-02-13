// ─── Platform & Error Types ─────────────────────────────────────────────────

/** Supported messaging platforms. */
export type Platform =
  | "whatsapp"
  | "telegram"
  | "signal"
  | "instagram"
  | "facebook"
  | "discord";

/** Broad classification of a scraper failure. */
export enum ErrorCategory {
  /** DOM selector no longer matches — UI redesign or A/B test. */
  SELECTOR_NOT_FOUND = "SELECTOR_NOT_FOUND",
  /** Operation timed out — performance degradation or blocking. */
  TIMEOUT = "TIMEOUT",
  /** Auth/session error — session expired or bot detection. */
  AUTH_ERROR = "AUTH_ERROR",
  /** Network-level failure — connectivity or IP blocking. */
  NETWORK_ERROR = "NETWORK_ERROR",
  /** Platform returned an unexpected response shape. */
  UNEXPECTED_RESPONSE = "UNEXPECTED_RESPONSE",
  /** Captcha or challenge page encountered. */
  CAPTCHA = "CAPTCHA",
  /** Rate limiting detected. */
  RATE_LIMITED = "RATE_LIMITED",
  /** Error doesn't fit any known pattern. */
  UNKNOWN = "UNKNOWN",
}

// ─── Network Log ────────────────────────────────────────────────────────────

/** Captured network request/response pair for diagnostic context. */
export interface NetworkLog {
  readonly url: string;
  readonly method: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly timestamp: number;
  /** Truncated response body (first 4 KB). */
  readonly responseBody?: string;
}

// ─── DOM Diff ───────────────────────────────────────────────────────────────

/** A single change detected between two DOM snapshots. */
export interface DOMChange {
  readonly type: "added" | "removed" | "modified" | "attribute_changed";
  /** CSS selector path to the changed element. */
  readonly selector: string;
  readonly oldValue?: string;
  readonly newValue?: string;
}

/** Full diff result comparing two DOM snapshots. */
export interface DOMDiff {
  readonly changes: readonly DOMChange[];
  readonly totalChanged: number;
  /** Fraction of total elements that changed (0-1). */
  readonly changeRatio: number;
}

// ─── Fix Request / Response (PRD §5.4) ──────────────────────────────────────

/**
 * Everything the fix generator needs to diagnose a failure and produce a patch.
 *
 * The `context` object carries the same data a human debugger would inspect:
 * a screenshot, DOM snapshot, recent network traffic, the last-known-good
 * source code, and a structured diff showing what changed in the DOM.
 */
export interface FixRequest {
  /** The error that triggered self-healing. */
  readonly error: {
    readonly name: string;
    readonly message: string;
    readonly stack?: string;
  };
  /** Diagnostic context gathered by the monitoring layer. */
  readonly context: {
    /** Screenshot of the current browser state (PNG). */
    readonly screenshot: Buffer;
    /** Serialized DOM snapshot (outerHTML). */
    readonly dom: string;
    /** Recent network requests/responses. */
    readonly networkLogs: readonly NetworkLog[];
    /** Source code of the function that was working before the breakage. */
    readonly lastWorkingCode: string;
    /** Structured diff between last-good and current DOM. */
    readonly recentChanges: DOMDiff;
  };
  /** Which platform the scraper targets. */
  readonly platform: Platform;
  /** Fully-qualified name of the broken function (e.g. "InstagramAdapter.sendMessage"). */
  readonly affectedFunction: string;
}

/**
 * A contiguous code replacement.
 * `filePath` is repo-relative (e.g. "packages/adapters/src/instagram.ts").
 */
export interface CodePatch {
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly originalCode: string;
  readonly replacementCode: string;
}

/** A single test case generated alongside the fix. */
export interface TestCase {
  readonly name: string;
  readonly description: string;
  /** Complete executable test source (vitest compatible). */
  readonly code: string;
  /** File where the test should be written. */
  readonly filePath: string;
}

/**
 * Output of the fix generator after Claude produces a diagnosis + patch.
 */
export interface FixResponse {
  /** Human-readable explanation of the root cause. */
  readonly diagnosis: string;
  /** Model's self-assessed confidence in the fix (0-1). */
  readonly confidence: number;
  /** Ordered list of code patches to apply. */
  readonly suggestedFix: readonly CodePatch[];
  /** Generated test cases that exercise the fix. */
  readonly testCases: readonly TestCase[];
  /** Steps to revert if the fix causes regressions. */
  readonly rollbackPlan: string;
}

// ─── Diagnosis ──────────────────────────────────────────────────────────────

/** Result of the error-classification + root-cause analysis step. */
export interface DiagnosisResult {
  /** Classified error category. */
  readonly category: ErrorCategory;
  /** Short description of the probable root cause. */
  readonly summary: string;
  /** Selector paths that appear broken (if applicable). */
  readonly brokenSelectors: readonly string[];
  /** True if the failure is likely caused by bot detection. */
  readonly likelyDetection: boolean;
  /** Severity: how urgently does this need a fix? */
  readonly severity: "critical" | "high" | "medium" | "low";
}

// ─── Health Metrics (PRD §5.2) ──────────────────────────────────────────────

/** Real-time health snapshot for a single platform adapter. */
export interface HealthMetrics {
  readonly platform: Platform;
  readonly timestamp: number;

  // Availability
  readonly connected: boolean;
  readonly lastSuccessfulAction: number;

  // Performance
  readonly avgLatencyMs: number;
  readonly p99LatencyMs: number;

  // Reliability
  /** Success rate over the sliding window (0-1). */
  readonly successRate: number;
  /** Error rate over the sliding window (0-1). */
  readonly errorRate: number;
  /** Counts per error category. */
  readonly errorCounts: Readonly<Record<string, number>>;

  // Detection indicators
  readonly suspectedDetection: boolean;
  readonly captchaEncountered: boolean;
  readonly rateLimited: boolean;
}

// ─── Deployment (PRD §5.5) ──────────────────────────────────────────────────

/** Stage in a progressive rollout. */
export interface RolloutStage {
  /** Percentage of traffic that receives the fix (0-100). */
  readonly percentage: number;
  /** How long to soak at this percentage before advancing (ms). */
  readonly soakDurationMs: number;
  /** Error rate threshold that triggers automatic rollback (0-1). */
  readonly rollbackThreshold: number;
}

/** Policy governing how a validated fix is deployed. */
export interface DeploymentConfig {
  /**
   * Minimum confidence for fully automatic deployment.
   * Below this threshold the fix is queued for human review.
   */
  readonly autoDeployThreshold: number;
  /** Progressive rollout stages (e.g. 10% → 50% → 100%). */
  readonly stages: readonly RolloutStage[];
  /** Maximum time to wait for all stages to complete (ms). */
  readonly maxRolloutDurationMs: number;
}

export const DEFAULT_DEPLOYMENT_CONFIG: DeploymentConfig = {
  autoDeployThreshold: 0.8,
  stages: [
    { percentage: 10, soakDurationMs: 5 * 60_000, rollbackThreshold: 0.05 },
    { percentage: 50, soakDurationMs: 10 * 60_000, rollbackThreshold: 0.03 },
    { percentage: 100, soakDurationMs: 0, rollbackThreshold: 0.02 },
  ],
  maxRolloutDurationMs: 60 * 60_000,
};

/** Current status of a deploy. */
export enum DeployStatus {
  PENDING_REVIEW = "PENDING_REVIEW",
  DEPLOYING = "DEPLOYING",
  ROLLED_BACK = "ROLLED_BACK",
  COMPLETE = "COMPLETE",
  FAILED = "FAILED",
}

/** Tracks the lifecycle of one fix deployment. */
export interface DeploymentRecord {
  readonly id: string;
  readonly fixResponse: FixResponse;
  readonly config: DeploymentConfig;
  status: DeployStatus;
  readonly currentStageIndex: number;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly rollbackReason?: string;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/** Outcome of running generated tests against a candidate fix. */
export interface ValidationResult {
  readonly passed: boolean;
  readonly totalTests: number;
  readonly passedTests: number;
  readonly failedTests: number;
  readonly failures: readonly TestFailure[];
  readonly durationMs: number;
}

/** Detail about a single test failure. */
export interface TestFailure {
  readonly testName: string;
  readonly error: string;
  readonly expected?: string;
  readonly actual?: string;
}

// ─── Self-Healing Engine ────────────────────────────────────────────────────

/** Configuration for the top-level SelfHealingEngine. */
export interface SelfHealingConfig {
  /** Anthropic API key for Claude calls. */
  readonly apiKey: string;
  /** Claude model to use (defaults to claude-sonnet-4-5-20250929). */
  readonly model?: string;
  /** Maximum tokens for Claude response. */
  readonly maxTokens?: number;
  /** Deployment policy. */
  readonly deployment?: DeploymentConfig;
}

/** Listener for self-healing lifecycle events. */
export interface HealingEventListener {
  onDiagnosisComplete?(diagnosis: DiagnosisResult, request: FixRequest): void;
  onFixGenerated?(response: FixResponse, request: FixRequest): void;
  onValidationComplete?(result: ValidationResult, response: FixResponse): void;
  onDeployStarted?(record: DeploymentRecord): void;
  onDeployComplete?(record: DeploymentRecord): void;
  onRollback?(record: DeploymentRecord, reason: string): void;
  onHumanReviewRequired?(response: FixResponse, reason: string): void;
}
