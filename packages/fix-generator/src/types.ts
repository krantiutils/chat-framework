/**
 * Types for the Claude-powered fix generation system.
 *
 * The fix generator sits between the diagnosis engine (which produces
 * error context) and the deploy pipeline (which applies fixes).
 *
 * Flow: DiagnosisReport → FixRequest → Claude API → FixResponse → DeployPipeline
 */

// ---------------------------------------------------------------------------
// Platform types (mirrors monitoring/diagnosis — kept local to avoid
// cross-package dependency on packages not present in this branch)
// ---------------------------------------------------------------------------

export type Platform =
  | 'telegram'
  | 'discord'
  | 'whatsapp'
  | 'instagram'
  | 'facebook'
  | 'signal';

// ---------------------------------------------------------------------------
// Error context types (input from the diagnosis engine)
// ---------------------------------------------------------------------------

/** A single HTTP request/response pair captured during the failure. */
export interface NetworkLog {
  url: string;
  method: string;
  status: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  timing?: {
    startedAt: number;
    durationMs: number;
  };
}

/** Element-level diff between two DOM snapshots. */
export interface DOMDiff {
  /** Selectors that existed before but are now missing. */
  removedSelectors: string[];
  /** Selectors that are new in the current DOM. */
  addedSelectors: string[];
  /** Selectors whose attributes or structure changed. */
  changedSelectors: Array<{
    selector: string;
    before: string;
    after: string;
  }>;
}

/** Classification of the error that triggered fix generation. */
export type ErrorCategory =
  | 'selector_not_found'
  | 'timeout'
  | 'auth_error'
  | 'network_error'
  | 'rate_limit'
  | 'captcha'
  | 'element_stale'
  | 'navigation_error'
  | 'unknown';

// ---------------------------------------------------------------------------
// Fix request / response (core contract)
// ---------------------------------------------------------------------------

/** Everything the fix generator needs to produce a fix. */
export interface FixRequest {
  /** The error that triggered fix generation. */
  error: {
    message: string;
    stack?: string;
    category: ErrorCategory;
  };

  /** Contextual evidence gathered by the diagnosis engine. */
  context: {
    /** Screenshot of the page at time of failure (PNG buffer). */
    screenshot?: Buffer;
    /** Full or partial DOM snapshot at time of failure. */
    dom?: string;
    /** Recent network requests/responses. */
    networkLogs: NetworkLog[];
    /** The source code that was executing when the error occurred. */
    lastWorkingCode: string;
    /** DOM diff between last-known-good state and current state. */
    recentChanges?: DOMDiff;
    /** Console errors captured from the browser. */
    consoleErrors?: string[];
  };

  /** Which chat platform the scraper targets. */
  platform: Platform;

  /** Fully-qualified name of the function/method that failed. */
  affectedFunction: string;

  /** The full source file content containing the affected function. */
  sourceFile?: string;

  /** Path to the source file on disk. */
  sourceFilePath?: string;
}

/** A single code patch — one contiguous edit to a file. */
export interface CodePatch {
  /** Relative path from project root to the file being patched. */
  filePath: string;
  /** The original code to be replaced (exact match). */
  originalCode: string;
  /** The replacement code. */
  newCode: string;
  /** Human-readable explanation of what this patch does. */
  description: string;
}

/** A test case generated to validate the fix. */
export interface TestCase {
  /** Descriptive name for the test. */
  name: string;
  /** Relative path where the test file should be written. */
  filePath: string;
  /** Full test source code. */
  code: string;
  /** What this test verifies. */
  description: string;
}

/** The complete response from fix generation. */
export interface FixResponse {
  /** Human-readable diagnosis of the root cause. */
  diagnosis: string;
  /** Confidence that this fix will resolve the issue (0–1). */
  confidence: number;
  /** Ordered list of code patches to apply. */
  patches: CodePatch[];
  /** Generated test cases to validate the fix. */
  testCases: TestCase[];
  /** Instructions for reverting if the fix causes regressions. */
  rollbackPlan: string;
  /** Raw model output for debugging/auditing. */
  rawModelResponse?: string;
}

// ---------------------------------------------------------------------------
// Deployment types
// ---------------------------------------------------------------------------

export type DeploymentStrategy = 'auto' | 'staged' | 'manual';

export type RolloutStage = 10 | 50 | 100;

export interface DeploymentDecision {
  /** Whether to deploy automatically, via staged rollout, or require manual review. */
  strategy: DeploymentStrategy;
  /** Why this strategy was chosen. */
  reason: string;
  /** The fix response driving this deployment. */
  fix: FixResponse;
}

export interface DeploymentResult {
  /** Whether deployment succeeded. */
  success: boolean;
  /** Current rollout stage (10%, 50%, or 100%). */
  stage: RolloutStage;
  /** Number of patches applied. */
  patchesApplied: number;
  /** Number of generated tests that passed. */
  testsPassedCount: number;
  /** Number of generated tests that failed. */
  testsFailedCount: number;
  /** Error if deployment failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface FixGeneratorConfig {
  /** Anthropic API key. */
  apiKey: string;
  /** Model to use for fix generation. Defaults to claude-sonnet-4-5-20250929. */
  model?: string;
  /** Maximum tokens for the model response. Defaults to 8192. */
  maxTokens?: number;
  /** Confidence threshold for auto-deploy (0–1). Defaults to 0.8. */
  autoDeployThreshold?: number;
  /** Maximum number of retry attempts on transient API errors. Defaults to 2. */
  maxRetries?: number;
  /** Whether to include the screenshot in the prompt (costs more tokens). Defaults to true. */
  includeScreenshot?: boolean;
}

/** Resolved config with all defaults applied. */
export interface ResolvedConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  autoDeployThreshold: number;
  maxRetries: number;
  includeScreenshot: boolean;
}
