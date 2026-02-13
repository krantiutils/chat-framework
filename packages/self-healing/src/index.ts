// @chat-framework/self-healing
// Claude-powered self-healing system: fix generation, test creation, and auto-deploy pipeline.

// Types
export {
  ErrorCategory,
  DeployStatus,
  DEFAULT_DEPLOYMENT_CONFIG,
} from "./types.js";
export type {
  Platform,
  NetworkLog,
  DOMChange,
  DOMDiff,
  FixRequest,
  FixResponse,
  CodePatch,
  TestCase,
  DiagnosisResult,
  HealthMetrics,
  RolloutStage,
  DeploymentConfig,
  DeploymentRecord,
  ValidationResult,
  TestFailure,
  SelfHealingConfig,
  HealingEventListener,
} from "./types.js";

// Diagnosis
export {
  diagnose,
  classifyError,
  extractBrokenSelectors,
  isLikelyDetection,
  assessSeverity,
} from "./diagnosis.js";

// Fix generation
export { FixGenerator } from "./fix-generator.js";
export type { FixGeneratorConfig } from "./fix-generator.js";

// Fix validation
export {
  validateFix,
  applyPatches,
  buildRevertPatches,
  PatchMismatchError,
} from "./fix-validator.js";
export type { TestRunner } from "./fix-validator.js";

// Deploy pipeline
export { DeployPipeline } from "./deploy-pipeline.js";
export type {
  DeployPipelineConfig,
  HealthMonitor,
  DeployExecutor,
} from "./deploy-pipeline.js";

// Engine (top-level orchestrator)
export { SelfHealingEngine } from "./engine.js";
export type { SelfHealingEngineConfig, HealResult } from "./engine.js";
