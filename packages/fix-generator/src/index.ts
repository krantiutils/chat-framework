// Types
export type {
  Platform,
  NetworkLog,
  DOMDiff,
  ErrorCategory,
  FixRequest,
  CodePatch,
  TestCase,
  FixResponse,
  DeploymentStrategy,
  RolloutStage,
  DeploymentDecision,
  DeploymentResult,
  FixGeneratorConfig,
  ResolvedConfig,
} from './types.js';

// Fix generator
export { FixGenerator, FixGenerationError } from './fix-generator.js';

// Prompt builder
export { buildMessages } from './prompt-builder.js';

// Response parser
export { parseResponse, ParseError } from './response-parser.js';

// Deploy pipeline
export type { CommandResult, CommandRunner, PatchResult, DeployPipelineConfig } from './deploy-pipeline.js';
export {
  applyPatches,
  revertPatches,
  writeTestCases,
  runTests,
  evaluateDeployment,
  RolloutTracker,
  executeDeploy,
} from './deploy-pipeline.js';
