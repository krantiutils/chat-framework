import { describe, it, expect } from 'vitest';

import { RootCauseAnalyzer } from '../../src/diagnosis/root-cause.js';
import {
  ErrorCategory,
  DiagnosisSeverity,
} from '../../src/diagnosis/types.js';
import type {
  DOMDiff,
  DOMSnapshot,
  ErrorClassification,
} from '../../src/diagnosis/types.js';

function makeClassification(
  category: ErrorCategory,
  confidence = 0.8,
): ErrorClassification {
  return {
    category,
    confidence,
    reasoning: 'test reasoning',
    secondaryCategories: [],
  };
}

function makeDiff(overrides: Partial<DOMDiff> = {}): DOMDiff {
  return {
    removedSelectors: [],
    addedSelectors: [],
    changedElements: [],
    urlChanged: false,
    urlBefore: 'https://example.com',
    urlAfter: 'https://example.com',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<DOMSnapshot> = {}): DOMSnapshot {
  return {
    url: 'https://example.com',
    title: 'Test',
    timestamp: new Date().toISOString(),
    elements: [],
    documentHTML: '<html><body></body></html>',
    consoleMessages: [],
    failedRequests: [],
    ...overrides,
  };
}

describe('RootCauseAnalyzer', () => {
  const analyzer = new RootCauseAnalyzer();

  describe('analyze', () => {
    it('produces summary for ELEMENT_MISSING with removed selectors', () => {
      const diff = makeDiff({ removedSelectors: ['#login-btn'] });
      const result = analyzer.analyze(
        new Error('No node found'),
        makeClassification(ErrorCategory.ELEMENT_MISSING),
        diff,
        null,
        null,
      );

      expect(result.summary).toContain('#login-btn');
      expect(result.summary).toContain('not found');
      expect(result.suggestedActions.length).toBeGreaterThan(0);
    });

    it('produces summary for SELECTOR_STALE with changed elements', () => {
      const diff = makeDiff({
        changedElements: [{
          selector: '#btn',
          changes: [{ property: 'outerHTML', before: '<button>', after: '<div>' }],
        }],
      });
      const result = analyzer.analyze(
        new Error('stale element'),
        makeClassification(ErrorCategory.SELECTOR_STALE),
        diff,
        null,
        null,
      );

      expect(result.summary).toContain('#btn');
      expect(result.summary.toLowerCase()).toContain('stale');
    });

    it('produces summary for DETECTION', () => {
      const result = analyzer.analyze(
        new Error('Captcha detected'),
        makeClassification(ErrorCategory.DETECTION),
        null,
        null,
        null,
      );

      expect(result.summary.toLowerCase()).toContain('bot detection');
      expect(result.suggestedActions).toContainEqual(
        expect.stringMatching(/fingerprint/i),
      );
    });

    it('produces summary for NAVIGATION_FAILURE with URL change', () => {
      const diff = makeDiff({
        urlChanged: true,
        urlBefore: 'https://app.example.com/dashboard',
        urlAfter: 'https://app.example.com/error',
      });
      const result = analyzer.analyze(
        new Error('Navigation failed'),
        makeClassification(ErrorCategory.NAVIGATION_FAILURE),
        diff,
        null,
        null,
      );

      expect(result.summary).toContain('dashboard');
      expect(result.summary).toContain('error');
    });

    it('produces summary for NETWORK_ERROR with failed requests', () => {
      const snapshot = makeSnapshot({
        failedRequests: [{
          url: 'https://api.example.com/data',
          method: 'GET',
          statusCode: null,
          errorText: 'net::ERR_CONNECTION_REFUSED',
          timestamp: new Date().toISOString(),
        }],
      });
      const result = analyzer.analyze(
        new Error('Network error'),
        makeClassification(ErrorCategory.NETWORK_ERROR),
        null,
        null,
        snapshot,
      );

      expect(result.summary).toContain('ERR_CONNECTION_REFUSED');
    });

    it('gathers signals from all sources', () => {
      const diff = makeDiff({
        removedSelectors: ['#btn'],
        urlChanged: true,
        urlBefore: 'https://a.com',
        urlAfter: 'https://b.com',
      });
      const snapshot = makeSnapshot({
        consoleMessages: [
          { level: 'error', text: 'Script error at line 42', timestamp: new Date().toISOString() },
        ],
        failedRequests: [
          { url: 'https://api.com', method: 'POST', statusCode: 500, errorText: 'Internal Server Error', timestamp: new Date().toISOString() },
        ],
      });

      const result = analyzer.analyze(
        new Error('Something failed'),
        makeClassification(ErrorCategory.ELEMENT_MISSING),
        diff,
        null,
        snapshot,
      );

      const sources = result.signals.map((s) => s.source);
      expect(sources).toContain('error_message');
      expect(sources).toContain('dom_diff');
      expect(sources).toContain('url_change');
      expect(sources).toContain('console');
      expect(sources).toContain('network');
    });

    it('includes details with classification info', () => {
      const classification = makeClassification(ErrorCategory.TIMEOUT, 0.7);
      classification.secondaryCategories = [
        { category: ErrorCategory.NETWORK_ERROR, confidence: 0.3 },
      ];

      const result = analyzer.analyze(
        new Error('Timeout'),
        classification,
        null,
        null,
        null,
      );

      expect(result.details).toContain('TIMEOUT');
      expect(result.details).toContain('NETWORK_ERROR');
    });

    it('includes diff details in the analysis', () => {
      const diff = makeDiff({
        removedSelectors: ['#gone'],
        addedSelectors: ['#new-element'],
        changedElements: [{
          selector: '#changed',
          changes: [{
            property: 'visible',
            before: 'true',
            after: 'false',
          }],
        }],
      });

      const result = analyzer.analyze(
        new Error('test'),
        makeClassification(ErrorCategory.ELEMENT_MISSING),
        diff,
        null,
        null,
      );

      expect(result.details).toContain('#gone');
      expect(result.details).toContain('#new-element');
      expect(result.details).toContain('#changed');
    });
  });

  describe('assessSeverity', () => {
    it('rates DETECTION as CRITICAL', () => {
      expect(
        analyzer.assessSeverity(makeClassification(ErrorCategory.DETECTION), null),
      ).toBe(DiagnosisSeverity.CRITICAL);
    });

    it('rates AUTH_FAILURE as HIGH', () => {
      expect(
        analyzer.assessSeverity(makeClassification(ErrorCategory.AUTH_FAILURE), null),
      ).toBe(DiagnosisSeverity.HIGH);
    });

    it('rates NAVIGATION_FAILURE as HIGH', () => {
      expect(
        analyzer.assessSeverity(makeClassification(ErrorCategory.NAVIGATION_FAILURE), null),
      ).toBe(DiagnosisSeverity.HIGH);
    });

    it('rates ELEMENT_MISSING as MEDIUM with few removals', () => {
      const diff = makeDiff({ removedSelectors: ['#btn'] });
      expect(
        analyzer.assessSeverity(makeClassification(ErrorCategory.ELEMENT_MISSING), diff),
      ).toBe(DiagnosisSeverity.MEDIUM);
    });

    it('rates ELEMENT_MISSING as HIGH with many removals', () => {
      const diff = makeDiff({ removedSelectors: ['#a', '#b', '#c'] });
      expect(
        analyzer.assessSeverity(makeClassification(ErrorCategory.ELEMENT_MISSING), diff),
      ).toBe(DiagnosisSeverity.HIGH);
    });

    it('rates NETWORK_ERROR as LOW', () => {
      expect(
        analyzer.assessSeverity(makeClassification(ErrorCategory.NETWORK_ERROR), null),
      ).toBe(DiagnosisSeverity.LOW);
    });

    it('rates TIMEOUT as LOW', () => {
      expect(
        analyzer.assessSeverity(makeClassification(ErrorCategory.TIMEOUT), null),
      ).toBe(DiagnosisSeverity.LOW);
    });

    it('rates SELECTOR_STALE as MEDIUM', () => {
      expect(
        analyzer.assessSeverity(makeClassification(ErrorCategory.SELECTOR_STALE), null),
      ).toBe(DiagnosisSeverity.MEDIUM);
    });

    it('rates LAYOUT_SHIFT as MEDIUM', () => {
      expect(
        analyzer.assessSeverity(makeClassification(ErrorCategory.LAYOUT_SHIFT), null),
      ).toBe(DiagnosisSeverity.MEDIUM);
    });
  });

  describe('suggestions', () => {
    const categories = Object.values(ErrorCategory);

    for (const category of categories) {
      it(`provides suggestions for ${category}`, () => {
        const result = analyzer.analyze(
          new Error('test'),
          makeClassification(category),
          null,
          null,
          null,
        );
        expect(result.suggestedActions.length).toBeGreaterThan(0);
        for (const action of result.suggestedActions) {
          expect(typeof action).toBe('string');
          expect(action.length).toBeGreaterThan(0);
        }
      });
    }
  });
});
