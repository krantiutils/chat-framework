export { StealthBrowser } from './stealth-browser.js';
export { FingerprintManager } from './fingerprint.js';
export { ProxyManager } from './proxy.js';

export {
  DiagnosisEngine,
  DiagnosedError,
  ScreenshotCapturer,
  DOMDiffer,
  ErrorClassifier,
  RootCauseAnalyzer,
  ErrorCategory,
  DiagnosisSeverity,
} from './diagnosis/index.js';

export type {
  BrowserFingerprint,
  ScreenFingerprint,
  WebGLFingerprint,
  CanvasFingerprint,
  PluginFingerprint,
  ProxyConfig,
  BrowserProfile,
  StealthBrowserOptions,
  StealthBrowserInstance,
  FingerprintGeneratorOptions,
  ProxyHealthResult,
  ProxyManagerOptions,
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
} from './diagnosis/index.js';
