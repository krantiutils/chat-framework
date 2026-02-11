// @chat-framework/inference
// ONNX model serving for keyboard dynamics and mouse trajectory generation.

export { KeystrokeGenerator } from "./keyboard-generator.js";
export { TrajectoryGenerator } from "./mouse-generator.js";

export type {
  KeystrokeGeneratorConfig,
  KeystrokeSequence,
  TrajectoryGeneratorConfig,
  Trajectory,
  Point,
  ScreenDimensions,
  GenerateOptions,
  TrajectoryGenerateOptions,
} from "./types.js";

export {
  InferenceError,
  ModelLoadError,
  InputValidationError,
} from "./errors.js";

export {
  encodeCharIds,
  sampleLatentVector,
  normalizeCoords,
} from "./preprocessing.js";

export {
  computeKeystrokeTimestamps,
  extractKeystrokeTimings,
  processTrajectoryOutput,
} from "./postprocessing.js";
