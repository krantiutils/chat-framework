import { describe, it, expect } from 'vitest';

import { ErrorClassifier } from '../../src/diagnosis/classifier.js';
import { ErrorCategory } from '../../src/diagnosis/types.js';
import type { DOMDiff, DOMSnapshot } from '../../src/diagnosis/types.js';

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

describe('ErrorClassifier', () => {
  const classifier = new ErrorClassifier();

  describe('error message classification', () => {
    it('classifies stale element errors', () => {
      const result = classifier.classify(
        new Error('stale element reference: element is not attached to the page document'),
        null,
        null,
      );
      expect(result.category).toBe(ErrorCategory.SELECTOR_STALE);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('classifies element not found errors', () => {
      const result = classifier.classify(
        new Error('No node found for selector: #login-btn'),
        null,
        null,
      );
      expect(result.category).toBe(ErrorCategory.ELEMENT_MISSING);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('classifies waiting for selector errors as element missing', () => {
      const result = classifier.classify(
        new Error('waiting for selector `.message-input` failed: timeout 30000ms exceeded'),
        null,
        null,
      );
      expect(result.category).toBe(ErrorCategory.ELEMENT_MISSING);
    });

    it('classifies navigation errors', () => {
      const result = classifier.classify(
        new Error('net::ERR_CONNECTION_REFUSED at https://example.com'),
        null,
        null,
      );
      // Could be NAVIGATION_FAILURE or NETWORK_ERROR — both match
      expect([ErrorCategory.NAVIGATION_FAILURE, ErrorCategory.NETWORK_ERROR]).toContain(
        result.category,
      );
    });

    it('classifies timeout errors', () => {
      const result = classifier.classify(
        new Error('TimeoutError: Operation timed out after 30000ms deadline exceeded'),
        null,
        null,
      );
      expect(result.category).toBe(ErrorCategory.TIMEOUT);
    });

    it('classifies network errors', () => {
      const result = classifier.classify(
        new Error('ECONNREFUSED 127.0.0.1:3000'),
        null,
        null,
      );
      expect(result.category).toBe(ErrorCategory.NETWORK_ERROR);
    });

    it('classifies layout shift / click interception errors', () => {
      const result = classifier.classify(
        new Error('Element is not clickable at point (100, 200). Other element would receive the click'),
        null,
        null,
      );
      expect(result.category).toBe(ErrorCategory.LAYOUT_SHIFT);
    });

    it('returns UNKNOWN for unrecognized errors', () => {
      const result = classifier.classify(
        new Error('Something completely unexpected happened'),
        null,
        null,
      );
      expect(result.category).toBe(ErrorCategory.UNKNOWN);
      expect(result.confidence).toBeLessThan(0.5);
    });
  });

  describe('DOM diff classification', () => {
    it('boosts ELEMENT_MISSING when selectors were removed', () => {
      const diff = makeDiff({ removedSelectors: ['#login-btn'] });
      const result = classifier.classify(
        new Error('No node found for selector: #login-btn'),
        diff,
        null,
      );
      expect(result.category).toBe(ErrorCategory.ELEMENT_MISSING);
      // Confidence should be higher with diff evidence
      const withoutDiff = classifier.classify(
        new Error('No node found for selector: #login-btn'),
        null,
        null,
      );
      expect(result.confidence).toBeGreaterThanOrEqual(withoutDiff.confidence);
    });

    it('boosts SELECTOR_STALE when elements changed', () => {
      const diff = makeDiff({
        changedElements: [{
          selector: '#btn',
          changes: [{
            property: 'outerHTML',
            before: '<button id="btn">Login</button>',
            after: '<div id="btn">Login</div>',
          }],
        }],
      });
      const result = classifier.classify(
        new Error('stale element reference'),
        diff,
        null,
      );
      expect(result.category).toBe(ErrorCategory.SELECTOR_STALE);
    });

    it('detects LAYOUT_SHIFT from bounding box changes', () => {
      const diff = makeDiff({
        changedElements: [{
          selector: '#submit',
          changes: [{
            property: 'boundingBox',
            before: '{"x":100,"y":200,"width":80,"height":40}',
            after: '{"x":100,"y":600,"width":80,"height":40}',
          }],
        }],
      });
      const result = classifier.classify(
        new Error('Element is not clickable at point'),
        diff,
        null,
      );
      expect(result.category).toBe(ErrorCategory.LAYOUT_SHIFT);
    });

    it('detects NAVIGATION_FAILURE from URL change', () => {
      const diff = makeDiff({
        urlChanged: true,
        urlBefore: 'https://app.example.com/dashboard',
        urlAfter: 'https://app.example.com/error',
      });
      const result = classifier.classify(
        new Error('Navigation failed'),
        diff,
        null,
      );
      expect(result.category).toBe(ErrorCategory.NAVIGATION_FAILURE);
    });
  });

  describe('page content classification', () => {
    it('detects bot detection from page content', () => {
      const snapshot = makeSnapshot({
        documentHTML: '<html><body><h1>Please verify you are human</h1><div id="captcha"></div></body></html>',
      });
      const result = classifier.classify(
        new Error('Unexpected page content'), // Generic error, no specific category match
        null,
        snapshot,
      );
      expect(result.category).toBe(ErrorCategory.DETECTION);
    });

    it('detects Cloudflare challenge', () => {
      const snapshot = makeSnapshot({
        documentHTML: '<html><body><div>Checking if the site connection is secure</div><div>cloudflare</div></body></html>',
      });
      const result = classifier.classify(
        new Error('timeout waiting for element'),
        null,
        snapshot,
      );
      // Detection should be primary or secondary
      const allCategories = [
        result.category,
        ...result.secondaryCategories.map((s) => s.category),
      ];
      expect(allCategories).toContain(ErrorCategory.DETECTION);
    });

    it('detects auth failure from login page redirect', () => {
      const snapshot = makeSnapshot({
        documentHTML: '<html><body><form><h1>Sign In</h1><input name="password"/></form></body></html>',
      });
      const result = classifier.classify(
        new Error('Unexpected page content'),
        null,
        snapshot,
      );
      // Auth failure should appear somewhere in the classification
      const allCategories = [
        result.category,
        ...result.secondaryCategories.map((s) => s.category),
      ];
      expect(allCategories).toContain(ErrorCategory.AUTH_FAILURE);
    });
  });

  describe('network failure classification', () => {
    it('considers failed requests in classification', () => {
      const snapshot = makeSnapshot({
        failedRequests: [{
          url: 'https://api.example.com/auth',
          method: 'POST',
          statusCode: 401,
          errorText: 'Unauthorized',
          timestamp: new Date().toISOString(),
        }],
      });
      const result = classifier.classify(
        new Error('Request failed with status 401'),
        null,
        snapshot,
      );
      expect(result.category).toBe(ErrorCategory.AUTH_FAILURE);
    });
  });

  describe('multi-signal classification', () => {
    it('combines error message and DOM diff signals', () => {
      const diff = makeDiff({
        removedSelectors: ['#submit-btn', '#username-input'],
        changedElements: [{
          selector: '#form',
          changes: [{ property: 'outerHTML', before: '<form>...</form>', after: '<div>Redesigned</div>' }],
        }],
      });
      const snapshot = makeSnapshot({
        documentHTML: '<html><body><div>New page design</div></body></html>',
      });
      const result = classifier.classify(
        new Error('No node found for selector: #submit-btn'),
        diff,
        snapshot,
      );
      expect(result.category).toBe(ErrorCategory.ELEMENT_MISSING);
      // Should have high confidence due to multiple signals
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('provides secondary categories when multiple rules match', () => {
      const result = classifier.classify(
        new Error('net::ERR_CONNECTION_REFUSED navigation timeout'),
        makeDiff({ urlChanged: true, urlBefore: 'https://a.com', urlAfter: 'about:blank' }),
        null,
      );
      expect(result.secondaryCategories.length).toBeGreaterThan(0);
    });
  });

  describe('classification structure', () => {
    it('always returns valid classification fields', () => {
      const result = classifier.classify(new Error('test'), null, null);
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reasoning');
      expect(result).toHaveProperty('secondaryCategories');
      expect(typeof result.confidence).toBe('number');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(result.secondaryCategories)).toBe(true);
    });
  });
});
