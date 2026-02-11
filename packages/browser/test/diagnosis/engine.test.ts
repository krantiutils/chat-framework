import { describe, it, expect, afterAll } from 'vitest';
import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';

import { DiagnosisEngine, DiagnosedError } from '../../src/diagnosis/engine.js';
import { ErrorCategory, DiagnosisSeverity } from '../../src/diagnosis/types.js';

describe('DiagnosisEngine (integration)', () => {
  let browser: Browser;
  let page: Page;

  afterAll(async () => {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  async function launchPage(html: string): Promise<Page> {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return page;
  }

  describe('constructor', () => {
    it('requires at least one tracked selector', async () => {
      const p = await launchPage('<html><body></body></html>');
      expect(() => new DiagnosisEngine(p, { trackedSelectors: [] })).toThrow(
        'at least one tracked selector',
      );
      await p.close();
    });
  });

  describe('captureBaseline + diagnose', () => {
    it('captures baseline snapshot and produces diagnosis after DOM change', async () => {
      const p = await launchPage(`
        <html><body>
          <button id="submit">Submit</button>
          <input id="email" type="email" value="" />
        </body></html>
      `);

      const engine = new DiagnosisEngine(p, {
        trackedSelectors: ['#submit', '#email'],
      });

      // Capture baseline with both elements present
      await engine.captureBaseline();

      // Remove the button from DOM
      await p.evaluate(() => {
        document.getElementById('submit')?.remove();
      });

      // Diagnose the "error"
      const report = await engine.diagnose(
        new Error('No node found for selector: #submit'),
      );

      expect(report.id).toBeDefined();
      expect(report.timestamp).toBeDefined();
      expect(report.error.message).toBe('No node found for selector: #submit');
      expect(report.classification.category).toBe(ErrorCategory.ELEMENT_MISSING);
      expect(report.domDiff).not.toBeNull();
      expect(report.domDiff!.removedSelectors).toContain('#submit');
      expect(report.snapshotBefore).not.toBeNull();
      expect(report.snapshotAfter).not.toBeNull();
      expect(report.rootCause.summary).toContain('#submit');
      expect(report.rootCause.suggestedActions.length).toBeGreaterThan(0);

      await p.close();
    });

    it('captures screenshots in the report', async () => {
      const p = await launchPage(`
        <html><body>
          <div id="content" style="width:200px;height:100px;background:red;">Hello</div>
        </body></html>
      `);

      const engine = new DiagnosisEngine(p, {
        trackedSelectors: ['#content'],
      });

      await engine.captureBaseline();

      const report = await engine.diagnose(new Error('test error'));

      expect(report.screenshotBefore).not.toBeNull();
      expect(report.screenshotBefore!.data).toBeInstanceOf(Buffer);
      expect(report.screenshotBefore!.data.length).toBeGreaterThan(0);
      expect(report.screenshotAfter).not.toBeNull();
      expect(report.screenshotAfter!.data).toBeInstanceOf(Buffer);

      await p.close();
    });

    it('detects layout shifts', async () => {
      const p = await launchPage(`
        <html><body>
          <div style="height:50px;"></div>
          <button id="btn" style="position:relative;top:0;">Click me</button>
        </body></html>
      `);

      const engine = new DiagnosisEngine(p, {
        trackedSelectors: ['#btn'],
      });

      await engine.captureBaseline();

      // Shift the button down significantly
      await p.evaluate(() => {
        const btn = document.getElementById('btn');
        if (btn) btn.style.top = '500px';
      });

      const report = await engine.diagnose(
        new Error('Element is not clickable at point (100, 200)'),
      );

      expect(report.classification.category).toBe(ErrorCategory.LAYOUT_SHIFT);
      expect(report.domDiff!.changedElements.length).toBeGreaterThan(0);
      expect(report.domDiff!.changedElements[0].changes).toContainEqual(
        expect.objectContaining({ property: 'boundingBox' }),
      );

      await p.close();
    });

    it('detects visibility changes', async () => {
      const p = await launchPage(`
        <html><body>
          <button id="btn" style="display:block;">Submit</button>
        </body></html>
      `);

      const engine = new DiagnosisEngine(p, {
        trackedSelectors: ['#btn'],
      });

      await engine.captureBaseline();

      // Hide the button
      await p.evaluate(() => {
        const btn = document.getElementById('btn');
        if (btn) btn.style.display = 'none';
      });

      const report = await engine.diagnose(
        new Error('Element not visible'),
      );

      const visChange = report.domDiff!.changedElements
        .flatMap((el) => el.changes)
        .find((c) => c.property === 'visible');

      expect(visChange).toBeDefined();
      expect(visChange!.before).toBe('true');
      expect(visChange!.after).toBe('false');

      await p.close();
    });
  });

  describe('wrapAction', () => {
    it('returns result when action succeeds', async () => {
      const p = await launchPage(`
        <html><body><div id="test">Hello</div></body></html>
      `);

      const engine = new DiagnosisEngine(p, {
        trackedSelectors: ['#test'],
      });

      const result = await engine.wrapAction(async () => {
        return await p.evaluate(() => document.getElementById('test')?.textContent);
      });

      expect(result).toBe('Hello');
      await p.close();
    });

    it('throws DiagnosedError when action fails', async () => {
      const p = await launchPage(`
        <html><body><div id="test">Hello</div></body></html>
      `);

      const engine = new DiagnosisEngine(p, {
        trackedSelectors: ['#test'],
      });

      let caught: DiagnosedError | null = null;
      try {
        await engine.wrapAction(async () => {
          // Remove the element then try to click it
          await p.evaluate(() => document.getElementById('test')?.remove());
          await p.click('#test');
        });
      } catch (err) {
        if (err instanceof DiagnosedError) {
          caught = err;
        } else {
          throw err;
        }
      }

      expect(caught).not.toBeNull();
      expect(caught!.report).toBeDefined();
      expect(caught!.report.classification).toBeDefined();
      expect(caught!.report.domDiff).not.toBeNull();
      expect(caught!.report.domDiff!.removedSelectors).toContain('#test');
      expect(caught!.report.rootCause.summary).toBeDefined();

      await p.close();
    });

    it('preserves the original error as cause', async () => {
      const p = await launchPage(`
        <html><body><div id="test">Hello</div></body></html>
      `);

      const engine = new DiagnosisEngine(p, {
        trackedSelectors: ['#test'],
      });

      try {
        await engine.wrapAction(async () => {
          throw new Error('Custom error from action');
        });
      } catch (err) {
        expect(err).toBeInstanceOf(DiagnosedError);
        const diagnosed = err as DiagnosedError;
        expect(diagnosed.cause).toBeInstanceOf(Error);
        expect((diagnosed.cause as Error).message).toBe('Custom error from action');
      }

      await p.close();
    });
  });

  describe('resetBaseline', () => {
    it('clears baseline so diagnose works without diff', async () => {
      const p = await launchPage(`
        <html><body><div id="test">Hello</div></body></html>
      `);

      const engine = new DiagnosisEngine(p, {
        trackedSelectors: ['#test'],
      });

      await engine.captureBaseline();
      engine.resetBaseline();

      const report = await engine.diagnose(new Error('test'));
      expect(report.snapshotBefore).toBeNull();
      expect(report.screenshotBefore).toBeNull();
      expect(report.domDiff).toBeNull();

      await p.close();
    });
  });

  describe('console and network monitoring', () => {
    it('captures console errors in the snapshot', async () => {
      const p = await launchPage(`
        <html><body><div id="test">Hello</div></body></html>
      `);

      const engine = new DiagnosisEngine(p, {
        trackedSelectors: ['#test'],
      });

      await engine.captureBaseline();

      // Trigger a console error
      await p.evaluate(() => {
        console.error('Something went wrong in the page');
      });

      const report = await engine.diagnose(new Error('test'));

      // Console messages should be captured in the after snapshot
      expect(report.snapshotAfter).not.toBeNull();
      const errors = report.snapshotAfter!.consoleMessages.filter(
        (m) => m.level === 'error',
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].text).toContain('Something went wrong');

      await p.close();
    });
  });

  describe('detection diagnosis', () => {
    it('identifies captcha/bot detection from page content', async () => {
      const p = await launchPage(`
        <html><body>
          <div id="challenge">
            <h1>Please verify you are human</h1>
            <div class="captcha-container">
              <div id="recaptcha">reCAPTCHA challenge</div>
            </div>
          </div>
        </body></html>
      `);

      const engine = new DiagnosisEngine(p, {
        trackedSelectors: ['#challenge', '#recaptcha'],
      });

      const report = await engine.diagnose(
        new Error('Expected element #login-btn not found'),
      );

      // Detection should be identified
      const allCategories = [
        report.classification.category,
        ...report.classification.secondaryCategories.map((s) => s.category),
      ];
      expect(allCategories).toContain(ErrorCategory.DETECTION);
      expect(report.severity).toBe(DiagnosisSeverity.CRITICAL);

      await p.close();
    });
  });
});
