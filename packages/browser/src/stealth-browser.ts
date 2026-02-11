import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page, LaunchOptions } from 'puppeteer';

import type {
  StealthBrowserOptions,
  StealthBrowserInstance,
  BrowserProfile,
  BrowserFingerprint,
  ProxyConfig,
} from './types.js';

/**
 * Launches and manages stealth-configured Puppeteer browser instances.
 *
 * Each instance is configured with:
 * - puppeteer-extra stealth plugin (automation evasion)
 * - Custom fingerprint injection (navigator, screen, WebGL, canvas, fonts)
 * - Optional proxy with authentication
 * - CDP-level patches for deeper evasion
 *
 * Usage:
 * ```ts
 * const browser = new StealthBrowser();
 * const instance = await browser.launch({ profile });
 * // Use instance.page for automation
 * await instance.close();
 * ```
 */
export class StealthBrowser {
  private readonly stealthPlugin: ReturnType<typeof StealthPlugin>;
  private initialized = false;

  constructor() {
    this.stealthPlugin = StealthPlugin();
  }

  /**
   * Launch a stealth browser instance with the given profile.
   */
  async launch(options: StealthBrowserOptions): Promise<StealthBrowserInstance> {
    this.ensureInitialized();

    const { profile, headless = true, puppeteerOptions = {}, userDataDir } = options;
    const launchOptions = this.buildLaunchOptions(profile, headless, puppeteerOptions, userDataDir);

    const browser = await puppeteerExtra.launch(launchOptions);

    try {
      const page = await this.setupPage(browser, profile);

      return {
        browser,
        page,
        profile,
        close: async () => {
          await browser.close();
        },
      };
    } catch (err) {
      // If page setup fails, close the browser to avoid leaks
      await browser.close();
      throw err;
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      puppeteerExtra.use(this.stealthPlugin);
      this.initialized = true;
    }
  }

  private buildLaunchOptions(
    profile: BrowserProfile,
    headless: boolean,
    extraOptions: Partial<LaunchOptions>,
    userDataDir?: string,
  ): LaunchOptions {
    const args = [
      // Required on many Linux distros (AppArmor restrictions)
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // Disable features that leak automation
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      // Window size from fingerprint
      `--window-size=${profile.fingerprint.screen.width},${profile.fingerprint.screen.height}`,
      // Timezone
      `--timezone=${profile.fingerprint.timezone}`,
      // Language
      `--lang=${profile.fingerprint.language}`,
      // Disable infobars
      '--disable-infobars',
      // Disable default apps
      '--disable-default-apps',
      // No first run
      '--no-first-run',
      // Disable extensions
      '--disable-extensions',
    ];

    // Proxy configuration
    if (profile.proxy) {
      const proxyUrl = this.formatProxyUrl(profile.proxy);
      args.push(`--proxy-server=${proxyUrl}`);
    }

    // WebGL renderer override
    args.push(
      `--use-gl=angle`,
      `--use-angle=default`,
    );

    return {
      headless: headless ? true : false,
      args: [...args, ...(extraOptions.args ?? [])],
      defaultViewport: {
        width: profile.fingerprint.screen.width,
        height: profile.fingerprint.screen.height,
        deviceScaleFactor: profile.fingerprint.screen.devicePixelRatio,
      },
      userDataDir,
      acceptInsecureCerts: true,
      ...extraOptions,
    };
  }

  /**
   * Set up a page with fingerprint injections and CDP patches.
   */
  private async setupPage(browser: Browser, profile: BrowserProfile): Promise<Page> {
    const page = (await browser.pages())[0] ?? await browser.newPage();
    const fp = profile.fingerprint;

    // Authenticate with proxy if credentials provided
    if (profile.proxy?.username && profile.proxy?.password) {
      await page.authenticate({
        username: profile.proxy.username,
        password: profile.proxy.password,
      });
    }

    // Set user agent
    await page.setUserAgent(fp.userAgent);

    // Set extra HTTP headers for language
    await page.setExtraHTTPHeaders({
      'Accept-Language': fp.languages.join(','),
    });

    // Inject fingerprint overrides via evaluateOnNewDocument
    await this.injectFingerprint(page, fp);

    // CDP-level patches
    await this.applyCDPPatches(page, fp);

    return page;
  }

  /**
   * Inject JavaScript overrides for navigator, screen, WebGL, canvas, etc.
   * These run before any page script via evaluateOnNewDocument.
   *
   * The fingerprint data is serialized to JSON and parsed in-browser to avoid
   * complex type serialization issues between Node and browser contexts.
   */
  private async injectFingerprint(page: Page, fp: BrowserFingerprint): Promise<void> {
    const fpJson = JSON.stringify(fp);

    await page.evaluateOnNewDocument(`(function() {
      const fp = ${fpJson};

      // === Navigator overrides ===
      // Override on both Navigator.prototype and the navigator instance to
      // cover all access patterns. Prototype override is more reliable for
      // properties defined as getters on the prototype.
      var navOverrides = {
        platform: fp.platform,
        language: fp.language,
        languages: Object.freeze(fp.languages.slice()),
        hardwareConcurrency: fp.hardwareConcurrency,
        deviceMemory: fp.deviceMemory,
        maxTouchPoints: fp.maxTouchPoints,
      };
      for (var _nk of Object.keys(navOverrides)) {
        var _nv = navOverrides[_nk];
        try {
          Object.defineProperty(Navigator.prototype, _nk, {
            get: function(v) { return function() { return v; }; }(_nv),
            configurable: true,
          });
        } catch (e) {}
        try {
          Object.defineProperty(navigator, _nk, {
            get: function(v) { return function() { return v; }; }(_nv),
            configurable: true,
          });
        } catch (e) {}
      }

      // Remove webdriver flag (belt and suspenders with stealth plugin)
      try {
        Object.defineProperty(Navigator.prototype, 'webdriver', {
          get: function() { return undefined; },
          configurable: true,
        });
      } catch (e) {}
      try {
        Object.defineProperty(navigator, 'webdriver', {
          get: function() { return undefined; },
          configurable: true,
        });
      } catch (e) {}

      // === Screen overrides ===
      // Override on Screen.prototype for reliability (Chrome defines these
      // as prototype getters, not own properties of the screen instance).
      var screenOverrides = {
        width: fp.screen.width,
        height: fp.screen.height,
        availWidth: fp.screen.availWidth,
        availHeight: fp.screen.availHeight,
        colorDepth: fp.screen.colorDepth,
        pixelDepth: fp.screen.pixelDepth,
      };
      for (var _sk of Object.keys(screenOverrides)) {
        var _sv = screenOverrides[_sk];
        try {
          Object.defineProperty(Screen.prototype, _sk, {
            get: function(v) { return function() { return v; }; }(_sv),
            configurable: true,
          });
        } catch (e) {}
        try {
          Object.defineProperty(screen, _sk, {
            get: function(v) { return function() { return v; }; }(_sv),
            configurable: true,
          });
        } catch (e) {}
      }

      // Device pixel ratio
      try {
        Object.defineProperty(window, 'devicePixelRatio', {
          get: () => fp.screen.devicePixelRatio,
          configurable: true,
        });
      } catch (e) {}

      // === WebGL overrides ===
      function patchWebGL(proto) {
        const origGetParameter = proto.getParameter;
        proto.getParameter = function(param) {
          var debugExt = this.getExtension('WEBGL_debug_renderer_info');
          if (debugExt) {
            if (param === debugExt.UNMASKED_VENDOR_WEBGL) return fp.webgl.unmaskedVendor;
            if (param === debugExt.UNMASKED_RENDERER_WEBGL) return fp.webgl.unmaskedRenderer;
          }
          if (param === 0x1F00) return fp.webgl.vendor;
          if (param === 0x1F01) return fp.webgl.renderer;
          return origGetParameter.call(this, param);
        };
      }

      if (typeof WebGLRenderingContext !== 'undefined') {
        patchWebGL(WebGLRenderingContext.prototype);
      }
      if (typeof WebGL2RenderingContext !== 'undefined') {
        patchWebGL(WebGL2RenderingContext.prototype);
      }

      // === Canvas fingerprint noise injection ===
      var canvasSeed = fp.canvas.noiseSeed;
      var canvasIntensity = fp.canvas.noiseIntensity;

      // Mulberry32 seeded PRNG for deterministic canvas noise
      function mulberry32(a) {
        return function() {
          a |= 0;
          a = (a + 0x6D2B79F5) | 0;
          var t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }

      var canvasRng = mulberry32(canvasSeed);

      var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function() {
        var ctx = this.getContext('2d');
        if (ctx && this.width > 0 && this.height > 0) {
          try {
            var imageData = ctx.getImageData(0, 0, this.width, this.height);
            var data = imageData.data;
            var step = Math.max(1, Math.floor(data.length / 4 / 100));
            for (var i = 0; i < data.length; i += step * 4) {
              for (var c = 0; c < 3; c++) {
                var noise = (canvasRng() - 0.5) * 2 * canvasIntensity * 255;
                data[i + c] = Math.max(0, Math.min(255, data[i + c] + noise));
              }
            }
            ctx.putImageData(imageData, 0, 0);
          } catch (e) {}
        }
        return origToDataURL.apply(this, arguments);
      };

      // === Plugin spoofing ===
      if (fp.plugins.length > 0) {
        var pluginArray = fp.plugins.map(function(p) {
          return { name: p.name, description: p.description, filename: p.filename, length: 1 };
        });
        try {
          Object.defineProperty(navigator, 'plugins', {
            get: function() {
              Object.defineProperty(pluginArray, 'length', { value: pluginArray.length });
              return pluginArray;
            },
            configurable: true,
          });
        } catch (e) {}
      }

      // === Timezone override via Intl ===
      var origDateTimeFormat = Intl.DateTimeFormat;
      var targetTz = fp.timezone;

      Intl.DateTimeFormat = function(locales, options) {
        var opts = Object.assign({}, options, { timeZone: (options && options.timeZone) || targetTz });
        return new origDateTimeFormat(locales, opts);
      };
      Intl.DateTimeFormat.prototype = origDateTimeFormat.prototype;
      Intl.DateTimeFormat.supportedLocalesOf = origDateTimeFormat.supportedLocalesOf;
      Object.defineProperty(Intl.DateTimeFormat, 'name', { value: 'DateTimeFormat' });
    })()`);
  }

  /**
   * Apply Chrome DevTools Protocol patches for deeper evasion.
   * CDP-level overrides are more reliable than JS property overrides
   * because they operate at the browser engine level.
   */
  private async applyCDPPatches(page: Page, fp: BrowserFingerprint): Promise<void> {
    const client = await page.createCDPSession();

    // Override timezone
    await client.send('Emulation.setTimezoneOverride', {
      timezoneId: fp.timezone,
    });

    // Override locale
    await client.send('Emulation.setLocaleOverride', {
      locale: fp.language,
    });

    // Override user agent at protocol level
    await client.send('Emulation.setUserAgentOverride', {
      userAgent: fp.userAgent,
      platform: fp.platform,
      acceptLanguage: fp.languages.join(','),
    });

    // Override device metrics (screen dimensions, DPR) at CDP level.
    // This is more reliable than JS Object.defineProperty overrides for
    // screen.width/height because Chrome re-initializes these from the
    // rendering engine after evaluateOnNewDocument runs.
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: fp.screen.width,
      height: fp.screen.height,
      deviceScaleFactor: fp.screen.devicePixelRatio,
      mobile: false,
      screenWidth: fp.screen.width,
      screenHeight: fp.screen.height,
    });

    // Override hardware concurrency at CDP level
    await client.send('Emulation.setHardwareConcurrencyOverride', {
      hardwareConcurrency: fp.hardwareConcurrency,
    });
  }

  private formatProxyUrl(proxy: ProxyConfig): string {
    return `${proxy.protocol}://${proxy.host}:${proxy.port}`;
  }
}
