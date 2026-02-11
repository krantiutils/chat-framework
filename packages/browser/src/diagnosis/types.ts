/**
 * Error categories for browser automation failures.
 * Each category maps to a distinct class of root cause.
 */
export enum ErrorCategory {
  /** Target element no longer matches selector (DOM structure changed) */
  SELECTOR_STALE = 'SELECTOR_STALE',
  /** Target element not found in DOM at all */
  ELEMENT_MISSING = 'ELEMENT_MISSING',
  /** Page layout shifted — element exists but moved significantly */
  LAYOUT_SHIFT = 'LAYOUT_SHIFT',
  /** Page navigation failed or redirected unexpectedly */
  NAVIGATION_FAILURE = 'NAVIGATION_FAILURE',
  /** Bot detection triggered (CAPTCHA, block page, fingerprint rejection) */
  DETECTION = 'DETECTION',
  /** Network-level failure (DNS, connection refused, timeout) */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** Operation exceeded time limit without network failure */
  TIMEOUT = 'TIMEOUT',
  /** Authentication or session expired */
  AUTH_FAILURE = 'AUTH_FAILURE',
  /** Cannot determine root cause */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Severity levels for diagnosis reports.
 */
export enum DiagnosisSeverity {
  /** Transient issue, likely resolves on retry */
  LOW = 'LOW',
  /** Requires attention but may self-resolve */
  MEDIUM = 'MEDIUM',
  /** Requires intervention — automation will continue failing */
  HIGH = 'HIGH',
  /** Automation is fundamentally broken for this target */
  CRITICAL = 'CRITICAL',
}

/**
 * Serialized state of a single DOM element relevant to diagnosis.
 */
export interface ElementSnapshot {
  /** CSS selector that matched this element */
  selector: string;
  /** Element tag name (lowercase) */
  tagName: string;
  /** Element's outerHTML (truncated to maxHtmlLength) */
  outerHTML: string;
  /** Bounding box in viewport coordinates, null if not visible */
  boundingBox: BoundingBox | null;
  /** Whether the element is visible (not display:none, visibility:hidden, or zero-size) */
  visible: boolean;
  /** Key attributes (id, class, data-*, role, aria-*) */
  attributes: Record<string, string>;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A point-in-time snapshot of the DOM state relevant to an operation.
 */
export interface DOMSnapshot {
  /** URL at time of capture */
  url: string;
  /** Page title at time of capture */
  title: string;
  /** ISO timestamp of capture */
  timestamp: string;
  /** Tracked elements and their states */
  elements: ElementSnapshot[];
  /** Full document.documentElement.outerHTML (may be truncated) */
  documentHTML: string;
  /** Console messages captured since last snapshot */
  consoleMessages: ConsoleEntry[];
  /** Failed network requests since last snapshot */
  failedRequests: FailedRequest[];
}

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  text: string;
  timestamp: string;
}

export interface FailedRequest {
  url: string;
  method: string;
  statusCode: number | null;
  errorText: string;
  timestamp: string;
}

/**
 * Result of comparing two DOM snapshots.
 */
export interface DOMDiff {
  /** Selectors that existed in "before" but not in "after" */
  removedSelectors: string[];
  /** Selectors that exist in "after" but not in "before" */
  addedSelectors: string[];
  /** Selectors present in both but with changed properties */
  changedElements: ElementChange[];
  /** Whether the page URL changed between snapshots */
  urlChanged: boolean;
  /** URL before */
  urlBefore: string;
  /** URL after */
  urlAfter: string;
}

export interface ElementChange {
  selector: string;
  /** Which properties changed */
  changes: ElementChangeDetail[];
}

export interface ElementChangeDetail {
  property: 'outerHTML' | 'boundingBox' | 'visible' | 'attributes' | 'tagName';
  before: string;
  after: string;
}

/**
 * Screenshot captured at a point in time.
 */
export interface ScreenshotCapture {
  /** Raw PNG image data */
  data: Buffer;
  /** ISO timestamp of capture */
  timestamp: string;
  /** Viewport dimensions at capture time */
  viewport: { width: number; height: number };
  /** Whether this is a full-page or viewport-only capture */
  fullPage: boolean;
}

/**
 * Classification result with confidence.
 */
export interface ErrorClassification {
  /** Primary error category */
  category: ErrorCategory;
  /** Confidence in the classification (0.0 to 1.0) */
  confidence: number;
  /** Human-readable explanation of why this category was chosen */
  reasoning: string;
  /** Secondary categories that may also apply */
  secondaryCategories: Array<{ category: ErrorCategory; confidence: number }>;
}

/**
 * Complete diagnosis report for a browser automation error.
 */
export interface DiagnosisReport {
  /** Unique report ID */
  id: string;
  /** ISO timestamp of when diagnosis was performed */
  timestamp: string;
  /** The original error that triggered diagnosis */
  error: {
    message: string;
    stack?: string;
    name: string;
  };
  /** Error classification result */
  classification: ErrorClassification;
  /** Severity assessment */
  severity: DiagnosisSeverity;
  /** DOM state before the error (if captured) */
  snapshotBefore: DOMSnapshot | null;
  /** DOM state after the error */
  snapshotAfter: DOMSnapshot | null;
  /** Diff between before and after snapshots */
  domDiff: DOMDiff | null;
  /** Screenshot before the error (if captured) */
  screenshotBefore: ScreenshotCapture | null;
  /** Screenshot after the error */
  screenshotAfter: ScreenshotCapture | null;
  /** Root cause analysis */
  rootCause: RootCauseAnalysis;
}

/**
 * Root cause analysis result.
 */
export interface RootCauseAnalysis {
  /** Concise summary of what went wrong */
  summary: string;
  /** Detailed explanation with evidence */
  details: string;
  /** Suggested remediation actions, ordered by priority */
  suggestedActions: string[];
  /** Signals that contributed to the analysis */
  signals: DiagnosisSignal[];
}

export interface DiagnosisSignal {
  /** What was observed */
  observation: string;
  /** How strongly this signal supports the conclusion (0.0 to 1.0) */
  weight: number;
  /** Source of the signal */
  source: 'dom_diff' | 'console' | 'network' | 'screenshot' | 'error_message' | 'url_change';
}

/**
 * Options for the DiagnosisEngine.
 */
export interface DiagnosisEngineOptions {
  /** CSS selectors to track across snapshots */
  trackedSelectors: string[];
  /** Maximum length of outerHTML to store per element (default: 2000) */
  maxHtmlLength?: number;
  /** Maximum length of full document HTML to store (default: 50000) */
  maxDocumentHtmlLength?: number;
  /** Whether to capture full-page screenshots (default: false, viewport only) */
  fullPageScreenshots?: boolean;
}
