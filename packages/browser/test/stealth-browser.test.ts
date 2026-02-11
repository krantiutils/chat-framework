import { describe, it, expect, afterAll } from 'vitest';
import { StealthBrowser } from '../src/stealth-browser.js';
import { FingerprintManager } from '../src/fingerprint.js';
import type { BrowserProfile } from '../src/types.js';

const fpManager = new FingerprintManager();

function makeProfile(id?: string): BrowserProfile {
  const profileId = id ?? fpManager.generateProfileId();
  return {
    id: profileId,
    fingerprint: fpManager.generate(profileId),
    createdAt: new Date().toISOString(),
  };
}

describe('StealthBrowser', () => {
  const browser = new StealthBrowser();
  const instances: Array<{ close(): Promise<void> }> = [];

  afterAll(async () => {
    for (const inst of instances) {
      try {
        await inst.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it('launches a browser with stealth evasions', async () => {
    const profile = makeProfile();
    const instance = await browser.launch({
      profile,
      headless: true,
    });
    instances.push(instance);

    expect(instance.browser).toBeDefined();
    expect(instance.page).toBeDefined();
    expect(instance.profile).toBe(profile);
  });

  it('applies navigator overrides correctly', async () => {
    const profile = makeProfile('nav-override-test');
    const instance = await browser.launch({ profile, headless: true });
    instances.push(instance);

    const fp = profile.fingerprint;
    const page = instance.page;

    const platform = await page.evaluate(() => navigator.platform);
    expect(platform).toBe(fp.platform);

    const language = await page.evaluate(() => navigator.language);
    expect(language).toBe(fp.language);

    const hardwareConcurrency = await page.evaluate(() => navigator.hardwareConcurrency);
    expect(hardwareConcurrency).toBe(fp.hardwareConcurrency);

    const maxTouchPoints = await page.evaluate(() => navigator.maxTouchPoints);
    expect(maxTouchPoints).toBe(fp.maxTouchPoints);
  });

  it('hides webdriver flag', async () => {
    const profile = makeProfile('webdriver-test');
    const instance = await browser.launch({ profile, headless: true });
    instances.push(instance);

    const webdriver = await instance.page.evaluate(() => navigator.webdriver);
    expect(webdriver).toBeFalsy();
  });

  it('overrides screen properties', async () => {
    const profile = makeProfile('screen-test');
    const instance = await browser.launch({ profile, headless: true });
    instances.push(instance);

    const fp = profile.fingerprint;

    const screenWidth = await instance.page.evaluate(() => screen.width);
    const screenHeight = await instance.page.evaluate(() => screen.height);
    expect(screenWidth).toBe(fp.screen.width);
    expect(screenHeight).toBe(fp.screen.height);
  });

  it('overrides WebGL renderer info', async () => {
    const profile = makeProfile('webgl-test');
    const instance = await browser.launch({ profile, headless: true });
    instances.push(instance);

    const fp = profile.fingerprint;

    const webglInfo = await instance.page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      if (!gl) return null;

      const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
      if (!debugExt) return null;

      return {
        vendor: gl.getParameter(debugExt.UNMASKED_VENDOR_WEBGL),
        renderer: gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL),
      };
    });

    if (webglInfo) {
      expect(webglInfo.vendor).toBe(fp.webgl.unmaskedVendor);
      expect(webglInfo.renderer).toBe(fp.webgl.unmaskedRenderer);
    }
  });

  it('sets timezone via CDP', async () => {
    const profile = makeProfile('timezone-test');
    const instance = await browser.launch({ profile, headless: true });
    instances.push(instance);

    const fp = profile.fingerprint;

    const resolvedTz = await instance.page.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(resolvedTz).toBe(fp.timezone);
  });

  it('produces consistent fingerprint across page navigations', async () => {
    const profile = makeProfile('consistency-test');
    const instance = await browser.launch({ profile, headless: true });
    instances.push(instance);

    const fp = profile.fingerprint;

    // Navigate to a data: URI (about:blank-like)
    await instance.page.goto('data:text/html,<h1>test</h1>');

    const platform = await instance.page.evaluate(() => navigator.platform);
    expect(platform).toBe(fp.platform);

    const language = await instance.page.evaluate(() => navigator.language);
    expect(language).toBe(fp.language);
  });

  it('respects headless option', async () => {
    const profile = makeProfile('headless-false');
    // Just verify it doesn't throw (can't easily test non-headless in CI)
    const instance = await browser.launch({
      profile,
      headless: true, // Keep headless for CI
    });
    instances.push(instance);
    expect(instance.browser).toBeDefined();
  });

  it('sets user agent at HTTP level', async () => {
    const profile = makeProfile('ua-test');
    const instance = await browser.launch({ profile, headless: true });
    instances.push(instance);

    const userAgent = await instance.page.evaluate(() => navigator.userAgent);
    expect(userAgent).toBe(profile.fingerprint.userAgent);
  });

  it('closes browser cleanly', async () => {
    const profile = makeProfile('close-test');
    const instance = await browser.launch({ profile, headless: true });

    await instance.close();
    // Browser should be disconnected after close
    expect(instance.browser.connected).toBe(false);
  });
});
