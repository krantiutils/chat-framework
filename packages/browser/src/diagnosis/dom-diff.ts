import type { Page } from 'puppeteer';

import type {
  DOMSnapshot,
  DOMDiff,
  ElementSnapshot,
  ElementChange,
  ElementChangeDetail,
  ConsoleEntry,
  FailedRequest,
  BoundingBox,
} from './types.js';

const DEFAULT_MAX_HTML_LENGTH = 2000;
const DEFAULT_MAX_DOCUMENT_HTML_LENGTH = 50_000;

/**
 * Captures DOM snapshots and computes diffs between them.
 *
 * Tracks specific selectors across page states to identify what
 * changed when an automation error occurs. The diff highlights
 * removed elements, layout shifts, visibility changes, and
 * attribute mutations.
 */
export class DOMDiffer {
  private readonly trackedSelectors: string[];
  private readonly maxHtmlLength: number;
  private readonly maxDocumentHtmlLength: number;

  /** Accumulated console messages since last snapshot */
  private consoleBuffer: ConsoleEntry[] = [];
  /** Accumulated failed requests since last snapshot */
  private failedRequestBuffer: FailedRequest[] = [];
  /** Whether we're currently listening on a page */
  private listening = false;

  constructor(
    trackedSelectors: string[],
    maxHtmlLength = DEFAULT_MAX_HTML_LENGTH,
    maxDocumentHtmlLength = DEFAULT_MAX_DOCUMENT_HTML_LENGTH,
  ) {
    if (trackedSelectors.length === 0) {
      throw new Error('DOMDiffer requires at least one tracked selector');
    }
    this.trackedSelectors = trackedSelectors;
    this.maxHtmlLength = maxHtmlLength;
    this.maxDocumentHtmlLength = maxDocumentHtmlLength;
  }

  /**
   * Start listening for console messages and failed network requests.
   * Call this before taking snapshots to capture events between them.
   *
   * @param page - The Puppeteer page to monitor
   */
  startListening(page: Page): void {
    if (this.listening) {
      return;
    }

    page.on('console', (msg) => {
      try {
        const level = msg.type();
        if (['log', 'warn', 'error', 'info', 'debug'].includes(level)) {
          this.consoleBuffer.push({
            level: level as ConsoleEntry['level'],
            text: msg.text(),
            timestamp: new Date().toISOString(),
          });
        }
      } catch {
        // Listener must not throw — page may be navigating or closed
      }
    });

    page.on('requestfailed', (request) => {
      try {
        this.failedRequestBuffer.push({
          url: request.url(),
          method: request.method(),
          statusCode: null,
          errorText: request.failure()?.errorText ?? 'Unknown failure',
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Listener must not throw
      }
    });

    page.on('response', (response) => {
      try {
        if (response.status() >= 400) {
          this.failedRequestBuffer.push({
            url: response.url(),
            method: response.request().method(),
            statusCode: response.status(),
            errorText: response.statusText(),
            timestamp: new Date().toISOString(),
          });
        }
      } catch {
        // Listener must not throw
      }
    });

    this.listening = true;
  }

  /**
   * Capture a DOM snapshot of the current page state.
   *
   * Evaluates all tracked selectors and records element states including
   * visibility, bounding boxes, attributes, and HTML content.
   *
   * @param page - The Puppeteer page to snapshot
   * @returns A serializable DOM snapshot
   */
  async snapshot(page: Page): Promise<DOMSnapshot> {
    const [url, title] = await Promise.all([
      page.url(),
      page.title(),
    ]);

    const elements = await this.captureElements(page);

    const documentHTML = await page.evaluate((maxLen: number) => {
      const html = document.documentElement.outerHTML;
      return html.length > maxLen ? html.substring(0, maxLen) + '<!-- truncated -->' : html;
    }, this.maxDocumentHtmlLength);

    // Drain buffers
    const consoleMessages = this.consoleBuffer.splice(0);
    const failedRequests = this.failedRequestBuffer.splice(0);

    return {
      url,
      title,
      timestamp: new Date().toISOString(),
      elements,
      documentHTML,
      consoleMessages,
      failedRequests,
    };
  }

  /**
   * Compute the diff between two DOM snapshots.
   *
   * Identifies selectors that were added, removed, or changed between
   * the "before" and "after" states.
   */
  diff(before: DOMSnapshot, after: DOMSnapshot): DOMDiff {
    const beforeMap = new Map(before.elements.map((e) => [e.selector, e]));
    const afterMap = new Map(after.elements.map((e) => [e.selector, e]));

    const removedSelectors: string[] = [];
    const addedSelectors: string[] = [];
    const changedElements: ElementChange[] = [];

    // An element with tagName === '' means the selector didn't match anything in the DOM.
    // We treat these as "absent" for diff purposes.
    const isPresent = (el: ElementSnapshot): boolean => el.tagName !== '';

    // Find removed and changed elements
    for (const [selector, beforeEl] of beforeMap) {
      const beforePresent = isPresent(beforeEl);
      const afterEl = afterMap.get(selector);
      const afterPresent = afterEl ? isPresent(afterEl) : false;

      if (beforePresent && !afterPresent) {
        removedSelectors.push(selector);
        continue;
      }

      if (!beforePresent && afterPresent) {
        addedSelectors.push(selector);
        continue;
      }

      // Both absent or selector missing from afterMap — skip
      if (!beforePresent || !afterEl) {
        continue;
      }

      const changes = this.computeElementChanges(beforeEl, afterEl);
      if (changes.length > 0) {
        changedElements.push({ selector, changes });
      }
    }

    // Find selectors only in after (not in before map at all)
    for (const [selector, afterEl] of afterMap) {
      if (!beforeMap.has(selector) && isPresent(afterEl)) {
        addedSelectors.push(selector);
      }
    }

    return {
      removedSelectors,
      addedSelectors,
      changedElements,
      urlChanged: before.url !== after.url,
      urlBefore: before.url,
      urlAfter: after.url,
    };
  }

  private async captureElements(page: Page): Promise<ElementSnapshot[]> {
    const maxLen = this.maxHtmlLength;
    const selectors = this.trackedSelectors;

    // Evaluate all selectors in a single browser round-trip for performance
    const results = await page.evaluate(
      (sels: string[], maxHtmlLen: number) => {
        return sels.map((selector) => {
          const el = document.querySelector(selector);
          if (!el) {
            return null;
          }

          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);

          const visible =
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            rect.width > 0 &&
            rect.height > 0;

          // Collect key attributes
          const attrs: Record<string, string> = {};
          for (const attr of el.attributes) {
            if (
              attr.name === 'id' ||
              attr.name === 'class' ||
              attr.name === 'role' ||
              attr.name.startsWith('data-') ||
              attr.name.startsWith('aria-')
            ) {
              attrs[attr.name] = attr.value;
            }
          }

          const html = el.outerHTML;
          return {
            tagName: el.tagName.toLowerCase(),
            outerHTML: html.length > maxHtmlLen
              ? html.substring(0, maxHtmlLen) + '<!-- truncated -->'
              : html,
            boundingBox: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            visible,
            attributes: attrs,
          };
        });
      },
      selectors,
      maxLen,
    );

    return selectors.map((selector, i) => {
      const result = results[i];
      if (!result) {
        return {
          selector,
          tagName: '',
          outerHTML: '',
          boundingBox: null,
          visible: false,
          attributes: {},
        };
      }
      return {
        selector,
        tagName: result.tagName,
        outerHTML: result.outerHTML,
        boundingBox: result.boundingBox,
        visible: result.visible,
        attributes: result.attributes,
      };
    });
  }

  private computeElementChanges(
    before: ElementSnapshot,
    after: ElementSnapshot,
  ): ElementChangeDetail[] {
    const changes: ElementChangeDetail[] = [];

    if (before.tagName !== after.tagName) {
      changes.push({
        property: 'tagName',
        before: before.tagName,
        after: after.tagName,
      });
    }

    if (before.visible !== after.visible) {
      changes.push({
        property: 'visible',
        before: String(before.visible),
        after: String(after.visible),
      });
    }

    if (before.outerHTML !== after.outerHTML) {
      changes.push({
        property: 'outerHTML',
        before: before.outerHTML.substring(0, 200),
        after: after.outerHTML.substring(0, 200),
      });
    }

    if (this.boundingBoxChanged(before.boundingBox, after.boundingBox)) {
      changes.push({
        property: 'boundingBox',
        before: JSON.stringify(before.boundingBox),
        after: JSON.stringify(after.boundingBox),
      });
    }

    if (JSON.stringify(before.attributes) !== JSON.stringify(after.attributes)) {
      changes.push({
        property: 'attributes',
        before: JSON.stringify(before.attributes),
        after: JSON.stringify(after.attributes),
      });
    }

    return changes;
  }

  private boundingBoxChanged(a: BoundingBox | null, b: BoundingBox | null): boolean {
    if (a === null && b === null) return false;
    if (a === null || b === null) return true;

    // Threshold of 5px to ignore sub-pixel rendering differences
    const threshold = 5;
    return (
      Math.abs(a.x - b.x) > threshold ||
      Math.abs(a.y - b.y) > threshold ||
      Math.abs(a.width - b.width) > threshold ||
      Math.abs(a.height - b.height) > threshold
    );
  }
}
