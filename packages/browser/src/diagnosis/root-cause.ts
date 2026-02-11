import {
  ErrorCategory,
  DiagnosisSeverity,
  type DOMDiff,
  type DOMSnapshot,
  type ErrorClassification,
  type RootCauseAnalysis,
  type DiagnosisSignal,
} from './types.js';

/**
 * Synthesizes all diagnostic signals (error classification, DOM diff,
 * console/network logs) into a human-readable root cause analysis
 * with actionable remediation suggestions.
 */
export class RootCauseAnalyzer {
  /**
   * Analyze the root cause of a browser automation error.
   *
   * @param error - The original error
   * @param classification - Error classification result
   * @param diff - DOM diff between before and after states
   * @param snapshotBefore - DOM snapshot before the error
   * @param snapshotAfter - DOM snapshot after the error
   * @returns Root cause analysis with summary, details, and suggested actions
   */
  analyze(
    error: Error,
    classification: ErrorClassification,
    diff: DOMDiff | null,
    snapshotBefore: DOMSnapshot | null,
    snapshotAfter: DOMSnapshot | null,
  ): RootCauseAnalysis {
    const signals = this.gatherSignals(error, classification, diff, snapshotBefore, snapshotAfter);

    const summary = this.buildSummary(classification, diff, snapshotAfter);
    const details = this.buildDetails(classification, diff, snapshotBefore, snapshotAfter, signals);
    const suggestedActions = this.buildSuggestions(classification, diff);

    return { summary, details, suggestedActions, signals };
  }

  /**
   * Determine the severity of a diagnosed error.
   */
  assessSeverity(
    classification: ErrorClassification,
    diff: DOMDiff | null,
  ): DiagnosisSeverity {
    switch (classification.category) {
      case ErrorCategory.DETECTION:
        return DiagnosisSeverity.CRITICAL;

      case ErrorCategory.AUTH_FAILURE:
        return DiagnosisSeverity.HIGH;

      case ErrorCategory.ELEMENT_MISSING:
        // If many selectors disappeared, it's likely a page redesign
        if (diff && diff.removedSelectors.length > 2) {
          return DiagnosisSeverity.HIGH;
        }
        return DiagnosisSeverity.MEDIUM;

      case ErrorCategory.SELECTOR_STALE:
        return DiagnosisSeverity.MEDIUM;

      case ErrorCategory.LAYOUT_SHIFT:
        return DiagnosisSeverity.MEDIUM;

      case ErrorCategory.NAVIGATION_FAILURE:
        return DiagnosisSeverity.HIGH;

      case ErrorCategory.NETWORK_ERROR:
        return DiagnosisSeverity.LOW;

      case ErrorCategory.TIMEOUT:
        return DiagnosisSeverity.LOW;

      case ErrorCategory.UNKNOWN:
        return classification.confidence < 0.3
          ? DiagnosisSeverity.MEDIUM
          : DiagnosisSeverity.LOW;

      default: {
        const _exhaustive: never = classification.category;
        return DiagnosisSeverity.LOW;
      }
    }
  }

  private gatherSignals(
    error: Error,
    classification: ErrorClassification,
    diff: DOMDiff | null,
    snapshotBefore: DOMSnapshot | null,
    snapshotAfter: DOMSnapshot | null,
  ): DiagnosisSignal[] {
    const signals: DiagnosisSignal[] = [];

    // Error message signal
    signals.push({
      observation: `Error: ${error.message}`,
      weight: 0.8,
      source: 'error_message',
    });

    // DOM diff signals
    if (diff) {
      if (diff.removedSelectors.length > 0) {
        signals.push({
          observation: `${diff.removedSelectors.length} tracked selector(s) no longer present: ${diff.removedSelectors.join(', ')}`,
          weight: 0.9,
          source: 'dom_diff',
        });
      }

      if (diff.addedSelectors.length > 0) {
        signals.push({
          observation: `${diff.addedSelectors.length} new selector(s) appeared: ${diff.addedSelectors.join(', ')}`,
          weight: 0.4,
          source: 'dom_diff',
        });
      }

      if (diff.changedElements.length > 0) {
        for (const change of diff.changedElements) {
          const changeTypes = change.changes.map((c) => c.property).join(', ');
          signals.push({
            observation: `Element "${change.selector}" changed: ${changeTypes}`,
            weight: 0.7,
            source: 'dom_diff',
          });
        }
      }

      if (diff.urlChanged) {
        signals.push({
          observation: `URL changed from "${diff.urlBefore}" to "${diff.urlAfter}"`,
          weight: 0.8,
          source: 'url_change',
        });
      }
    }

    // Console signals
    if (snapshotAfter) {
      const errors = snapshotAfter.consoleMessages.filter((m) => m.level === 'error');
      if (errors.length > 0) {
        signals.push({
          observation: `${errors.length} console error(s): ${errors.map((e) => e.text.substring(0, 80)).join('; ')}`,
          weight: 0.5,
          source: 'console',
        });
      }
    }

    // Network signals
    if (snapshotAfter && snapshotAfter.failedRequests.length > 0) {
      const reqs = snapshotAfter.failedRequests;
      signals.push({
        observation: `${reqs.length} failed network request(s): ${reqs.map((r) => `${r.method} ${r.url} (${r.statusCode ?? r.errorText})`).join('; ').substring(0, 200)}`,
        weight: 0.6,
        source: 'network',
      });
    }

    return signals;
  }

  private buildSummary(
    classification: ErrorClassification,
    diff: DOMDiff | null,
    snapshotAfter: DOMSnapshot | null,
  ): string {
    switch (classification.category) {
      case ErrorCategory.SELECTOR_STALE:
        if (diff && diff.changedElements.length > 0) {
          const changed = diff.changedElements.map((e) => `"${e.selector}"`).join(', ');
          return `Stale element reference. Element(s) ${changed} changed in the DOM between action setup and execution.`;
        }
        return 'Stale element reference. The target element was detached from the DOM.';

      case ErrorCategory.ELEMENT_MISSING:
        if (diff && diff.removedSelectors.length > 0) {
          return `Element(s) not found: ${diff.removedSelectors.map((s) => `"${s}"`).join(', ')}. These selectors no longer match any DOM element.`;
        }
        return 'Target element not found in the DOM. The selector may be incorrect or the page structure changed.';

      case ErrorCategory.LAYOUT_SHIFT:
        return 'Layout shift detected. The target element moved or was obscured by another element.';

      case ErrorCategory.NAVIGATION_FAILURE:
        if (diff?.urlChanged) {
          return `Navigation failure. Page URL changed unexpectedly from "${diff.urlBefore}" to "${diff.urlAfter}".`;
        }
        return 'Navigation failed. The page did not load or was redirected unexpectedly.';

      case ErrorCategory.DETECTION:
        return 'Bot detection triggered. The target site detected automated browsing and served a challenge or block page.';

      case ErrorCategory.NETWORK_ERROR:
        if (snapshotAfter && snapshotAfter.failedRequests.length > 0) {
          const first = snapshotAfter.failedRequests[0];
          return `Network error: ${first.errorText} for ${first.url}.`;
        }
        return 'Network-level failure prevented the operation from completing.';

      case ErrorCategory.TIMEOUT:
        return 'Operation timed out waiting for a condition that was never met.';

      case ErrorCategory.AUTH_FAILURE:
        return 'Authentication failure. Session may have expired or credentials are invalid.';

      case ErrorCategory.UNKNOWN:
        return 'Unable to determine root cause with high confidence.';
    }
  }

  private buildDetails(
    classification: ErrorClassification,
    diff: DOMDiff | null,
    snapshotBefore: DOMSnapshot | null,
    snapshotAfter: DOMSnapshot | null,
    signals: DiagnosisSignal[],
  ): string {
    const lines: string[] = [];

    lines.push(`Classification: ${classification.category} (confidence: ${(classification.confidence * 100).toFixed(0)}%)`);
    lines.push(`Reasoning: ${classification.reasoning}`);
    lines.push('');

    if (classification.secondaryCategories.length > 0) {
      lines.push('Secondary classifications:');
      for (const sec of classification.secondaryCategories) {
        lines.push(`  - ${sec.category} (${(sec.confidence * 100).toFixed(0)}%)`);
      }
      lines.push('');
    }

    if (diff) {
      lines.push('DOM changes:');
      if (diff.removedSelectors.length > 0) {
        lines.push(`  Removed: ${diff.removedSelectors.join(', ')}`);
      }
      if (diff.addedSelectors.length > 0) {
        lines.push(`  Added: ${diff.addedSelectors.join(', ')}`);
      }
      for (const change of diff.changedElements) {
        lines.push(`  Changed "${change.selector}":`);
        for (const c of change.changes) {
          lines.push(`    ${c.property}: "${c.before}" → "${c.after}"`);
        }
      }
      if (diff.urlChanged) {
        lines.push(`  URL: "${diff.urlBefore}" → "${diff.urlAfter}"`);
      }
      lines.push('');
    }

    const highWeightSignals = signals.filter((s) => s.weight >= 0.6);
    if (highWeightSignals.length > 0) {
      lines.push('Key signals:');
      for (const signal of highWeightSignals) {
        lines.push(`  [${signal.source}] ${signal.observation}`);
      }
    }

    return lines.join('\n');
  }

  private buildSuggestions(
    classification: ErrorClassification,
    diff: DOMDiff | null,
  ): string[] {
    const suggestions: string[] = [];

    switch (classification.category) {
      case ErrorCategory.SELECTOR_STALE:
        suggestions.push('Re-query the element immediately before interacting with it');
        suggestions.push('Add a short delay or waitForSelector call before the interaction');
        if (diff && diff.changedElements.length > 0) {
          suggestions.push('Check if the page dynamically re-renders the target element (e.g., React/Vue hydration)');
        }
        break;

      case ErrorCategory.ELEMENT_MISSING:
        if (diff && diff.removedSelectors.length > 0) {
          suggestions.push(`Update selectors that no longer match: ${diff.removedSelectors.join(', ')}`);
          suggestions.push('Verify the target page has not been redesigned');
          suggestions.push('Use more resilient selectors (data-testid, aria-label) instead of CSS classes');
        } else {
          suggestions.push('Increase wait timeout for the element to appear');
          suggestions.push('Verify the selector is correct for the current page version');
        }
        break;

      case ErrorCategory.LAYOUT_SHIFT:
        suggestions.push('Wait for layout stability before clicking (e.g., wait for no DOM mutations for 500ms)');
        suggestions.push('Scroll the element into view before interacting');
        suggestions.push('Check for overlapping elements like cookie banners or modals');
        break;

      case ErrorCategory.NAVIGATION_FAILURE:
        suggestions.push('Verify the target URL is accessible and not geo-blocked');
        suggestions.push('Check proxy health — the current proxy may be blocked or down');
        suggestions.push('Retry with exponential backoff');
        break;

      case ErrorCategory.DETECTION:
        suggestions.push('Rotate browser fingerprint and proxy');
        suggestions.push('Increase delays between actions to appear more human');
        suggestions.push('Review and update stealth evasion configuration');
        suggestions.push('Check if the target site updated its detection mechanisms');
        break;

      case ErrorCategory.NETWORK_ERROR:
        suggestions.push('Check proxy connectivity and health');
        suggestions.push('Retry the operation — this may be a transient failure');
        suggestions.push('Verify DNS resolution for the target domain');
        break;

      case ErrorCategory.TIMEOUT:
        suggestions.push('Increase the operation timeout');
        suggestions.push('Check if the expected condition is still valid for the current page version');
        suggestions.push('Verify the page loaded completely before starting the operation');
        break;

      case ErrorCategory.AUTH_FAILURE:
        suggestions.push('Refresh session credentials or re-authenticate');
        suggestions.push('Check if the session cookie or token has expired');
        suggestions.push('Verify the account is not locked or rate-limited');
        break;

      case ErrorCategory.UNKNOWN:
        suggestions.push('Review the full error stack trace for more context');
        suggestions.push('Capture more tracked selectors to improve diagnosis');
        suggestions.push('Check browser console logs for additional error details');
        break;
    }

    return suggestions;
  }
}
