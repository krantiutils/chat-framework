# @chat-framework/browser API Reference

Stealth browser automation with deterministic fingerprinting and proxy management. Launches Puppeteer instances configured to evade bot detection on Tier C platforms (Instagram, Facebook).

**Package**: `@chat-framework/browser` (v0.0.1)

---

## StealthBrowser

Launches and manages stealth-configured Puppeteer instances with fingerprint injection, proxy authentication, and CDP-level patches.

**Source**: `packages/browser/src/stealth-browser.ts`

### Constructor

```typescript
new StealthBrowser()
```

Initializes the stealth plugin lazily on first `launch()` call.

### Methods

#### `launch(options: StealthBrowserOptions): Promise<StealthBrowserInstance>`

Launch a browser instance with stealth configuration. Each instance gets:

- `puppeteer-extra-plugin-stealth` (automation evasion)
- Fingerprint injection via `evaluateOnNewDocument` (navigator, screen, WebGL, canvas, plugins, timezone)
- CDP-level patches (timezone, locale, user agent, device metrics, hardware concurrency)
- Proxy with authentication if configured

```typescript
const browser = new StealthBrowser();
const instance = await browser.launch({
  profile: {
    id: 'profile-abc123',
    fingerprint: myFingerprint,
    proxy: { host: '1.2.3.4', port: 8080, protocol: 'http' },
    createdAt: new Date().toISOString(),
  },
  headless: true,
});

await instance.page.goto('https://example.com');
await instance.close();
```

If page setup fails after the browser launches, the browser is automatically closed to prevent leaks.

### Stealth Evasions Applied

| Layer | Evasion |
|-------|---------|
| JS | `navigator.webdriver` removed |
| JS | Navigator properties overridden (platform, language, hardwareConcurrency, deviceMemory) |
| JS | Screen properties overridden (width, height, availWidth, availHeight, colorDepth, pixelDepth, devicePixelRatio) |
| JS | WebGL vendor/renderer spoofed (both WebGL1 and WebGL2) |
| JS | Canvas fingerprint noise injection (seeded PRNG, deterministic per profile) |
| JS | Plugin list spoofed |
| JS | Timezone overridden via Intl.DateTimeFormat |
| CDP | `Emulation.setTimezoneOverride` |
| CDP | `Emulation.setLocaleOverride` |
| CDP | `Emulation.setUserAgentOverride` |
| CDP | `Emulation.setDeviceMetricsOverride` |
| CDP | `Emulation.setHardwareConcurrencyOverride` |
| Launch | `--disable-blink-features=AutomationControlled` |
| Launch | `--disable-infobars`, `--no-first-run`, `--disable-extensions` |
| Plugin | `puppeteer-extra-plugin-stealth` (full suite) |

---

## FingerprintManager

Generates deterministic browser fingerprints. Same profile ID always produces the same fingerprint across runs.

**Source**: `packages/browser/src/fingerprint.ts`

### Constructor

```typescript
new FingerprintManager()
```

### Methods

#### `generate(profileId: string, options?: FingerprintGeneratorOptions): BrowserFingerprint`

Generate a fingeristic fingerprint from a profile ID using a seeded xorshift128+ PRNG (SHA-256 of the ID as seed).

```typescript
const manager = new FingerprintManager();
const fp = manager.generate('user-abc-123', {
  platform: 'win32',
  locale: 'en-US',
  screen: { width: 1920, height: 1080 },
});
```

**Generated properties**:
- User agent (Chrome versions 129-131, platform-appropriate)
- Screen resolution (weighted by market share if not specified)
- WebGL renderer (real GPU hardware strings: NVIDIA, AMD, Intel)
- Canvas fingerprint noise (seeded PRNG, intensity 0.01-0.05)
- System fonts (platform-appropriate, with random 1-3 removals for variation)
- Chrome plugins (3-5 PDF viewers)
- Hardware concurrency (2, 4, 6, 8, 12, or 16)
- Device memory (2, 4, 8, or 16 GB)
- Timezone (random from common list)

#### `generateProfileId(): string`

Generate a random 32-character hex profile ID using `crypto.randomBytes(16)`.

---

## ProxyManager

Manages a pool of proxies with health checking, sticky sessions, and load-balanced failover.

**Source**: `packages/browser/src/proxy.ts`

### Constructor

```typescript
new ProxyManager(options: ProxyManagerOptions)
```

All proxies are assumed healthy initially.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `healthyCount` | `number` | Number of currently healthy proxies |
| `totalCount` | `number` | Total proxy count |

### Methods

#### `getProxy(profileId: string): ProxyConfig | null`

Get a proxy for a profile. Returns the same proxy on subsequent calls (sticky session). If the current proxy is unhealthy, reassigns to the healthy proxy with the fewest sticky profiles (load balancing). Returns `null` if no healthy proxies are available.

```typescript
const proxy = proxies.getProxy('profile-abc');
// proxy is always the same for 'profile-abc' unless it becomes unhealthy
```

#### `releaseProfile(profileId: string): void`

Release a profile's sticky session, freeing the proxy for rebalancing.

#### `reportFailure(proxy: ProxyConfig): void`

Report a proxy failure. After `maxConsecutiveFailures` (default: 3), the proxy is marked unhealthy and its sticky profiles will be reassigned.

#### `reportSuccess(proxy: ProxyConfig): void`

Report a successful proxy use. Resets the failure counter and marks the proxy healthy.

#### `checkHealth(proxy: ProxyConfig): Promise<ProxyHealthResult>`

Check health of a single proxy by making an HTTP request to `httpbin.org/ip`. Returns latency and external IP on success.

#### `checkAllHealth(): Promise<ProxyHealthResult[]>`

Check health of all proxies concurrently.

#### `startHealthChecks(): void`

Start periodic health checking at `healthCheckIntervalMs` (default: 60s). The timer is unref'd so it won't keep the process alive.

#### `stopHealthChecks(): void`

Stop periodic health checking.

#### `getStatus(): ProxyStatus[]`

Get current status of all proxies including health, failure count, sticky profile count, and latency.

#### `formatProxyUrl(proxy: ProxyConfig): string`

Format a proxy config as `protocol://host:port` (no auth — Puppeteer handles auth separately via `page.authenticate`).

---

## Types

### BrowserFingerprint

```typescript
interface BrowserFingerprint {
  userAgent: string;
  platform: string;              // 'Win32', 'Linux x86_64', 'MacIntel'
  language: string;              // e.g. 'en-US'
  languages: string[];           // e.g. ['en-US', 'en']
  timezone: string;              // e.g. 'America/New_York'
  screen: ScreenFingerprint;
  webgl: WebGLFingerprint;
  canvas: CanvasFingerprint;
  fonts: string[];
  plugins: PluginFingerprint[];
  hardwareConcurrency: number;   // 2, 4, 6, 8, 12, or 16
  deviceMemory: number;          // 2, 4, 8, or 16
  maxTouchPoints: number;        // 0 for desktop
}
```

### ScreenFingerprint

```typescript
interface ScreenFingerprint {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;           // height minus taskbar (30-50px)
  colorDepth: number;            // always 24
  pixelDepth: number;            // always 24
  devicePixelRatio: number;      // 1 for < 2560px, 1/1.25/1.5/2 for >= 2560px
}
```

### WebGLFingerprint

```typescript
interface WebGLFingerprint {
  vendor: string;                // e.g. 'Google Inc. (NVIDIA)'
  renderer: string;              // e.g. 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 ...)'
  unmaskedVendor: string;
  unmaskedRenderer: string;
}
```

### CanvasFingerprint

```typescript
interface CanvasFingerprint {
  noiseSeed: number;             // 0 to 2^31, deterministic per profile
  noiseIntensity: number;        // 0.01 to 0.05
}
```

### PluginFingerprint

```typescript
interface PluginFingerprint {
  name: string;
  description: string;
  filename: string;
}
```

### ProxyConfig

```typescript
interface ProxyConfig {
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  username?: string;
  password?: string;
}
```

### BrowserProfile

```typescript
interface BrowserProfile {
  id: string;
  fingerprint: BrowserFingerprint;
  proxy?: ProxyConfig;
  createdAt: string;             // ISO timestamp
  lastUsedAt?: string;           // ISO timestamp
}
```

### StealthBrowserOptions

```typescript
interface StealthBrowserOptions {
  profile: BrowserProfile;
  headless?: boolean;            // default: true
  puppeteerOptions?: Partial<LaunchOptions>;
  userDataDir?: string;          // persistent cookies/localStorage
  extraEvasions?: string[];
}
```

### FingerprintGeneratorOptions

```typescript
interface FingerprintGeneratorOptions {
  platform?: 'win32' | 'linux' | 'darwin';   // random if omitted
  browser?: 'chrome';                         // only chrome supported
  locale?: string;                            // default: 'en-US'
  screen?: { width: number; height: number }; // random common resolution if omitted
}
```

### ProxyHealthResult

```typescript
interface ProxyHealthResult {
  proxy: ProxyConfig;
  healthy: boolean;
  latencyMs: number;
  externalIp?: string;
  error?: string;
}
```

### ProxyManagerOptions

```typescript
interface ProxyManagerOptions {
  proxies: ProxyConfig[];
  healthCheckIntervalMs?: number;       // default: 60000
  maxConsecutiveFailures?: number;       // default: 3
  healthCheckTimeoutMs?: number;         // default: 10000
}
```

### StealthBrowserInstance

```typescript
interface StealthBrowserInstance {
  browser: Browser;              // Puppeteer Browser
  page: Page;                    // Pre-configured Page
  profile: BrowserProfile;
  close(): Promise<void>;
}
```

---

## Exports

```typescript
// Classes
export { StealthBrowser, FingerprintManager, ProxyManager }

// Types
export type {
  BrowserFingerprint,
  ScreenFingerprint,
  WebGLFingerprint,
  CanvasFingerprint,
  PluginFingerprint,
  ProxyConfig,
  BrowserProfile,
  StealthBrowserOptions,
  StealthBrowserInstance,
  FingerprintGeneratorOptions,
  ProxyHealthResult,
  ProxyManagerOptions,
}
```
