import { describe, it, expect } from 'vitest';

import { DOMDiffer } from '../../src/diagnosis/dom-diff.js';
import type { DOMSnapshot, ElementSnapshot } from '../../src/diagnosis/types.js';

function makeElement(overrides: Partial<ElementSnapshot> = {}): ElementSnapshot {
  return {
    selector: '#test',
    tagName: 'div',
    outerHTML: '<div id="test">content</div>',
    boundingBox: { x: 0, y: 0, width: 100, height: 50 },
    visible: true,
    attributes: { id: 'test' },
    ...overrides,
  };
}

function makeSnapshot(
  elements: ElementSnapshot[],
  overrides: Partial<DOMSnapshot> = {},
): DOMSnapshot {
  return {
    url: 'https://example.com',
    title: 'Test',
    timestamp: new Date().toISOString(),
    elements,
    documentHTML: '<html><body></body></html>',
    consoleMessages: [],
    failedRequests: [],
    ...overrides,
  };
}

describe('DOMDiffer', () => {
  describe('constructor', () => {
    it('requires at least one tracked selector', () => {
      expect(() => new DOMDiffer([])).toThrow('at least one tracked selector');
    });

    it('accepts valid selectors', () => {
      const differ = new DOMDiffer(['#test', '.btn']);
      expect(differ).toBeDefined();
    });
  });

  describe('diff', () => {
    const differ = new DOMDiffer(['#btn', '#input', '#form']);

    it('detects removed selectors', () => {
      const before = makeSnapshot([
        makeElement({ selector: '#btn', tagName: 'button' }),
        makeElement({ selector: '#input', tagName: 'input' }),
      ]);
      const after = makeSnapshot([
        makeElement({ selector: '#input', tagName: 'input' }),
        // #btn is gone
      ]);

      const result = differ.diff(before, after);
      expect(result.removedSelectors).toEqual(['#btn']);
      expect(result.addedSelectors).toEqual([]);
    });

    it('detects added selectors', () => {
      const before = makeSnapshot([
        makeElement({ selector: '#btn' }),
      ]);
      const after = makeSnapshot([
        makeElement({ selector: '#btn' }),
        makeElement({ selector: '#form', tagName: 'form' }),
      ]);

      const result = differ.diff(before, after);
      expect(result.addedSelectors).toEqual(['#form']);
      expect(result.removedSelectors).toEqual([]);
    });

    it('detects visibility changes', () => {
      const before = makeSnapshot([
        makeElement({ selector: '#btn', visible: true }),
      ]);
      const after = makeSnapshot([
        makeElement({ selector: '#btn', visible: false }),
      ]);

      const result = differ.diff(before, after);
      expect(result.changedElements).toHaveLength(1);
      expect(result.changedElements[0].selector).toBe('#btn');
      expect(result.changedElements[0].changes).toContainEqual(
        expect.objectContaining({ property: 'visible', before: 'true', after: 'false' }),
      );
    });

    it('detects bounding box changes above threshold', () => {
      const before = makeSnapshot([
        makeElement({
          selector: '#btn',
          boundingBox: { x: 100, y: 200, width: 80, height: 40 },
        }),
      ]);
      const after = makeSnapshot([
        makeElement({
          selector: '#btn',
          boundingBox: { x: 100, y: 500, width: 80, height: 40 },
        }),
      ]);

      const result = differ.diff(before, after);
      expect(result.changedElements).toHaveLength(1);
      expect(result.changedElements[0].changes).toContainEqual(
        expect.objectContaining({ property: 'boundingBox' }),
      );
    });

    it('ignores sub-pixel bounding box changes (within 5px threshold)', () => {
      const before = makeSnapshot([
        makeElement({
          selector: '#btn',
          boundingBox: { x: 100, y: 200, width: 80, height: 40 },
        }),
      ]);
      const after = makeSnapshot([
        makeElement({
          selector: '#btn',
          boundingBox: { x: 102, y: 201, width: 80, height: 40 },
        }),
      ]);

      const result = differ.diff(before, after);
      // No bounding box change should be reported
      const bbChanges = result.changedElements.flatMap((el) =>
        el.changes.filter((c) => c.property === 'boundingBox'),
      );
      expect(bbChanges).toHaveLength(0);
    });

    it('detects outerHTML changes', () => {
      const before = makeSnapshot([
        makeElement({
          selector: '#btn',
          outerHTML: '<button id="btn">Login</button>',
        }),
      ]);
      const after = makeSnapshot([
        makeElement({
          selector: '#btn',
          outerHTML: '<button id="btn" disabled>Login</button>',
        }),
      ]);

      const result = differ.diff(before, after);
      expect(result.changedElements).toHaveLength(1);
      expect(result.changedElements[0].changes).toContainEqual(
        expect.objectContaining({ property: 'outerHTML' }),
      );
    });

    it('detects tag name changes', () => {
      const before = makeSnapshot([
        makeElement({ selector: '#btn', tagName: 'button' }),
      ]);
      const after = makeSnapshot([
        makeElement({ selector: '#btn', tagName: 'div' }),
      ]);

      const result = differ.diff(before, after);
      expect(result.changedElements[0].changes).toContainEqual(
        expect.objectContaining({ property: 'tagName', before: 'button', after: 'div' }),
      );
    });

    it('detects attribute changes', () => {
      const before = makeSnapshot([
        makeElement({
          selector: '#btn',
          attributes: { id: 'btn', class: 'primary' },
        }),
      ]);
      const after = makeSnapshot([
        makeElement({
          selector: '#btn',
          attributes: { id: 'btn', class: 'primary disabled' },
        }),
      ]);

      const result = differ.diff(before, after);
      expect(result.changedElements).toHaveLength(1);
      expect(result.changedElements[0].changes).toContainEqual(
        expect.objectContaining({ property: 'attributes' }),
      );
    });

    it('detects URL changes', () => {
      const before = makeSnapshot([], { url: 'https://example.com/page1' });
      const after = makeSnapshot([], { url: 'https://example.com/page2' });

      const result = differ.diff(before, after);
      expect(result.urlChanged).toBe(true);
      expect(result.urlBefore).toBe('https://example.com/page1');
      expect(result.urlAfter).toBe('https://example.com/page2');
    });

    it('reports no changes when snapshots are identical', () => {
      const el = makeElement({ selector: '#btn' });
      const before = makeSnapshot([el]);
      const after = makeSnapshot([el]);

      const result = differ.diff(before, after);
      expect(result.removedSelectors).toEqual([]);
      expect(result.addedSelectors).toEqual([]);
      expect(result.changedElements).toEqual([]);
      expect(result.urlChanged).toBe(false);
    });

    it('handles elements with null bounding boxes', () => {
      const before = makeSnapshot([
        makeElement({ selector: '#btn', boundingBox: null }),
      ]);
      const after = makeSnapshot([
        makeElement({
          selector: '#btn',
          boundingBox: { x: 100, y: 200, width: 80, height: 40 },
        }),
      ]);

      const result = differ.diff(before, after);
      expect(result.changedElements[0].changes).toContainEqual(
        expect.objectContaining({ property: 'boundingBox' }),
      );
    });

    it('handles both bounding boxes being null', () => {
      const before = makeSnapshot([
        makeElement({ selector: '#btn', boundingBox: null }),
      ]);
      const after = makeSnapshot([
        makeElement({ selector: '#btn', boundingBox: null }),
      ]);

      const result = differ.diff(before, after);
      const bbChanges = result.changedElements.flatMap((el) =>
        el.changes.filter((c) => c.property === 'boundingBox'),
      );
      expect(bbChanges).toHaveLength(0);
    });

    it('handles complex scenario with multiple changes', () => {
      const before = makeSnapshot([
        makeElement({ selector: '#btn', visible: true, tagName: 'button' }),
        makeElement({ selector: '#input', visible: true, tagName: 'input' }),
        makeElement({ selector: '#form', visible: true, tagName: 'form' }),
      ], { url: 'https://example.com/login' });

      const after = makeSnapshot([
        // #btn removed
        makeElement({ selector: '#input', visible: false, tagName: 'input' }), // visibility changed
        makeElement({ selector: '#form', visible: true, tagName: 'form' }), // unchanged
      ], { url: 'https://example.com/error' });

      const result = differ.diff(before, after);
      expect(result.removedSelectors).toEqual(['#btn']);
      expect(result.addedSelectors).toEqual([]);
      expect(result.changedElements).toHaveLength(1); // only #input changed
      expect(result.changedElements[0].selector).toBe('#input');
      expect(result.urlChanged).toBe(true);
    });
  });
});
