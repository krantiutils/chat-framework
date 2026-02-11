import type { Page, ElementHandle } from 'puppeteer';

import type { ScreenshotCapture } from './types.js';

/**
 * Captures screenshots from a Puppeteer page for diagnosis purposes.
 *
 * Provides viewport, full-page, and element-level screenshot capture
 * with consistent metadata for before/after comparison.
 */
export class ScreenshotCapturer {
  /**
   * Capture a screenshot of the current page state.
   *
   * @param page - The Puppeteer page to screenshot
   * @param fullPage - Whether to capture the full scrollable page (default: false)
   * @returns Screenshot data with metadata
   * @throws If the page is closed or screenshot fails
   */
  async capture(page: Page, fullPage = false): Promise<ScreenshotCapture> {
    const viewport = page.viewport();
    if (!viewport) {
      throw new Error('Cannot capture screenshot: page has no viewport set');
    }

    const data = await page.screenshot({
      type: 'png',
      fullPage,
      encoding: 'binary',
    });

    return {
      data: Buffer.from(data),
      timestamp: new Date().toISOString(),
      viewport: { width: viewport.width, height: viewport.height },
      fullPage,
    };
  }

  /**
   * Capture a screenshot of a specific element.
   *
   * @param element - The element handle to screenshot
   * @param page - The page containing the element (for viewport metadata)
   * @returns Screenshot data with metadata
   * @throws If the element is detached or not visible
   */
  async captureElement(element: ElementHandle, page: Page): Promise<ScreenshotCapture> {
    const viewport = page.viewport();
    if (!viewport) {
      throw new Error('Cannot capture element screenshot: page has no viewport set');
    }

    const data = await element.screenshot({
      type: 'png',
      encoding: 'binary',
    });

    if (!data) {
      throw new Error('Element screenshot returned no data — element may be detached or invisible');
    }

    return {
      data: Buffer.from(data),
      timestamp: new Date().toISOString(),
      viewport: { width: viewport.width, height: viewport.height },
      fullPage: false,
    };
  }

  /**
   * Capture a before/after screenshot pair. Calls `action` between captures.
   *
   * @param page - The page to capture
   * @param action - The action to perform between before and after captures
   * @param fullPage - Whether to capture full-page screenshots
   * @returns Tuple of [before, after] screenshots. If `action` throws,
   *          the after screenshot is still captured and the error is re-thrown.
   */
  async captureAround(
    page: Page,
    action: () => Promise<void>,
    fullPage = false,
  ): Promise<{ before: ScreenshotCapture; after: ScreenshotCapture; error?: Error }> {
    const before = await this.capture(page, fullPage);

    let error: Error | undefined;
    try {
      await action();
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
    }

    const after = await this.capture(page, fullPage);

    return { before, after, error };
  }
}
