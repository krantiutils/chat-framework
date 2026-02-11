import type { Page } from 'puppeteer';
import { randomUUID } from 'node:crypto';

import { ScreenshotCapturer } from './screenshot.js';
import { DOMDiffer } from './dom-diff.js';
import { ErrorClassifier } from './classifier.js';
import { RootCauseAnalyzer } from './root-cause.js';
import type {
  DiagnosisEngineOptions,
  DiagnosisReport,
  DOMSnapshot,
  ScreenshotCapture,
} from './types.js';

/**
 * Orchestrates the full error diagnosis pipeline:
 * snapshot → error → diff → classify → root cause analysis.
 *
 * Usage:
 * ```ts
 * const engine = new DiagnosisEngine(page, {
 *   trackedSelectors: ['#login-btn', '.message-input', '#send-btn'],
 * });
 *
 * // Capture baseline state before performing actions
 * await engine.captureBaseline();
 *
 * try {
 *   await page.click('#login-btn');
 * } catch (error) {
 *   const report = await engine.diagnose(error as Error);
 *   console.log(report.rootCause.summary);
 *   console.log(report.rootCause.suggestedActions);
 * }
 * ```
 */
export class DiagnosisEngine {
  private readonly page: Page;
  private readonly screenshotCapturer: ScreenshotCapturer;
  private readonly domDiffer: DOMDiffer;
  private readonly classifier: ErrorClassifier;
  private readonly rootCauseAnalyzer: RootCauseAnalyzer;
  private readonly fullPageScreenshots: boolean;

  /** Baseline snapshot captured before an operation */
  private baselineSnapshot: DOMSnapshot | null = null;
  /** Baseline screenshot captured before an operation */
  private baselineScreenshot: ScreenshotCapture | null = null;

  constructor(page: Page, options: DiagnosisEngineOptions) {
    if (!options.trackedSelectors || options.trackedSelectors.length === 0) {
      throw new Error('DiagnosisEngine requires at least one tracked selector');
    }

    this.page = page;
    this.screenshotCapturer = new ScreenshotCapturer();
    this.domDiffer = new DOMDiffer(
      options.trackedSelectors,
      options.maxHtmlLength,
      options.maxDocumentHtmlLength,
    );
    this.classifier = new ErrorClassifier();
    this.rootCauseAnalyzer = new RootCauseAnalyzer();
    this.fullPageScreenshots = options.fullPageScreenshots ?? false;

    // Start listening for console/network events immediately
    this.domDiffer.startListening(page);
  }

  /**
   * Capture the baseline DOM state and screenshot.
   *
   * Call this before performing an action that might fail.
   * The baseline is used for comparison when `diagnose()` is called.
   */
  async captureBaseline(): Promise<void> {
    const [snapshot, screenshot] = await Promise.all([
      this.domDiffer.snapshot(this.page),
      this.captureScreenshotSafe(),
    ]);

    this.baselineSnapshot = snapshot;
    this.baselineScreenshot = screenshot;
  }

  /**
   * Diagnose an error that occurred during browser automation.
   *
   * Captures the current DOM/screenshot state, diffs against the
   * baseline (if available), classifies the error, and produces
   * a root cause analysis.
   *
   * @param error - The error to diagnose
   * @returns A complete diagnosis report
   */
  async diagnose(error: Error): Promise<DiagnosisReport> {
    // Capture current state (after error)
    const [snapshotAfter, screenshotAfter] = await Promise.all([
      this.snapshotSafe(),
      this.captureScreenshotSafe(),
    ]);

    // Compute diff if we have a baseline
    const diff = this.baselineSnapshot && snapshotAfter
      ? this.domDiffer.diff(this.baselineSnapshot, snapshotAfter)
      : null;

    // Classify the error
    const classification = this.classifier.classify(error, diff, snapshotAfter);

    // Analyze root cause
    const rootCause = this.rootCauseAnalyzer.analyze(
      error,
      classification,
      diff,
      this.baselineSnapshot,
      snapshotAfter,
    );

    // Assess severity
    const severity = this.rootCauseAnalyzer.assessSeverity(classification, diff);

    return {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      classification,
      severity,
      snapshotBefore: this.baselineSnapshot,
      snapshotAfter,
      domDiff: diff,
      screenshotBefore: this.baselineScreenshot,
      screenshotAfter,
      rootCause,
    };
  }

  /**
   * Wrap an action with automatic baseline capture and error diagnosis.
   *
   * If the action succeeds, returns the result. If it fails, diagnoses
   * the error, attaches the report, and re-throws with the report.
   *
   * @param action - The async action to wrap
   * @returns The action result if successful
   * @throws DiagnosedError if the action fails
   */
  async wrapAction<T>(action: () => Promise<T>): Promise<T> {
    await this.captureBaseline();

    try {
      return await action();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const report = await this.diagnose(error);
      throw new DiagnosedError(error.message, report, error);
    }
  }

  /**
   * Reset the baseline state. Useful between independent operations.
   */
  resetBaseline(): void {
    this.baselineSnapshot = null;
    this.baselineScreenshot = null;
  }

  private async snapshotSafe(): Promise<DOMSnapshot | null> {
    try {
      return await this.domDiffer.snapshot(this.page);
    } catch {
      // Page may be crashed, navigating, or closed — snapshot failure
      // should not prevent diagnosis from completing
      return null;
    }
  }

  private async captureScreenshotSafe(): Promise<ScreenshotCapture | null> {
    try {
      return await this.screenshotCapturer.capture(this.page, this.fullPageScreenshots);
    } catch {
      // Screenshot failure should not prevent diagnosis
      return null;
    }
  }
}

/**
 * Error subclass that carries a full diagnosis report.
 *
 * Thrown by `DiagnosisEngine.wrapAction()` when the wrapped action fails.
 * The original error is preserved as the `cause`.
 */
export class DiagnosedError extends Error {
  readonly report: DiagnosisReport;

  constructor(message: string, report: DiagnosisReport, cause?: Error) {
    super(message, { cause });
    this.name = 'DiagnosedError';
    this.report = report;
  }
}
