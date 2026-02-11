export { DiagnosisEngine, DiagnosedError } from './engine.js';
export { ScreenshotCapturer } from './screenshot.js';
export { DOMDiffer } from './dom-diff.js';
export { ErrorClassifier } from './classifier.js';
export { RootCauseAnalyzer } from './root-cause.js';

export {
  ErrorCategory,
  DiagnosisSeverity,
} from './types.js';

export type {
  DiagnosisReport,
  DiagnosisEngineOptions,
  DOMSnapshot,
  DOMDiff,
  ElementSnapshot,
  ElementChange,
  ElementChangeDetail,
  BoundingBox,
  ConsoleEntry,
  FailedRequest,
  ScreenshotCapture,
  ErrorClassification,
  RootCauseAnalysis,
  DiagnosisSignal,
} from './types.js';
