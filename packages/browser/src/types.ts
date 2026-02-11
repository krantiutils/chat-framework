import type { LaunchOptions, Browser, Page } from 'puppeteer';

/**
 * Browser fingerprint profile for consistent identity across sessions.
 * Each field corresponds to a detectable browser property.
 */
export interface BrowserFingerprint {
  userAgent: string;
  platform: string;
  language: string;
  languages: string[];
  timezone: string;
  screen: ScreenFingerprint;
  webgl: WebGLFingerprint;
  canvas: CanvasFingerprint;
  fonts: string[];
  plugins: PluginFingerprint[];
  hardwareConcurrency: number;
  deviceMemory: number;
  maxTouchPoints: number;
}

export interface ScreenFingerprint {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
  pixelDepth: number;
  devicePixelRatio: number;
}

export interface WebGLFingerprint {
  vendor: string;
  renderer: string;
  unmaskedVendor: string;
  unmaskedRenderer: string;
}

export interface CanvasFingerprint {
  /** Seed for deterministic noise injection into canvas operations */
  noiseSeed: number;
  /** Noise magnitude (0-1, typically 0.01-0.05) */
  noiseIntensity: number;
}

export interface PluginFingerprint {
  name: string;
  description: string;
  filename: string;
}

/**
 * Proxy configuration for browser connections.
 */
export interface ProxyConfig {
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  username?: string;
  password?: string;
}

/**
 * Complete browser profile combining fingerprint and proxy.
 * Represents a persistent "identity" for browser sessions.
 */
export interface BrowserProfile {
  id: string;
  fingerprint: BrowserFingerprint;
  proxy?: ProxyConfig;
  /** ISO timestamp of profile creation */
  createdAt: string;
  /** ISO timestamp of last use */
  lastUsedAt?: string;
}

/**
 * Options for launching a stealth browser instance.
 */
export interface StealthBrowserOptions {
  /** Browser profile to use (fingerprint + proxy) */
  profile: BrowserProfile;
  /** Run in headless mode. Defaults to true. */
  headless?: boolean;
  /** Additional Puppeteer launch options (profile settings take precedence) */
  puppeteerOptions?: Partial<LaunchOptions>;
  /** Directory for persistent browser data (cookies, localStorage, etc.) */
  userDataDir?: string;
  /** Extra stealth evasions to enable beyond the defaults */
  extraEvasions?: string[];
}

/**
 * Options for generating a new browser fingerprint.
 */
export interface FingerprintGeneratorOptions {
  /** Target OS platform. Defaults to random selection. */
  platform?: 'win32' | 'linux' | 'darwin';
  /** Target browser. Currently only 'chrome' is supported. */
  browser?: 'chrome';
  /** Locale for language settings. Defaults to 'en-US'. */
  locale?: string;
  /** Specific screen resolution. Defaults to random common resolution. */
  screen?: { width: number; height: number };
}

/**
 * Result of a proxy health check.
 */
export interface ProxyHealthResult {
  proxy: ProxyConfig;
  healthy: boolean;
  latencyMs: number;
  externalIp?: string;
  error?: string;
}

/**
 * Options for the ProxyManager.
 */
export interface ProxyManagerOptions {
  /** List of available proxies */
  proxies: ProxyConfig[];
  /** Health check interval in milliseconds. Defaults to 60000 (1 min). */
  healthCheckIntervalMs?: number;
  /** Maximum consecutive failures before marking proxy unhealthy. Defaults to 3. */
  maxConsecutiveFailures?: number;
  /** Timeout for health check requests in milliseconds. Defaults to 10000. */
  healthCheckTimeoutMs?: number;
}

/**
 * A managed stealth browser instance.
 */
export interface StealthBrowserInstance {
  browser: Browser;
  page: Page;
  profile: BrowserProfile;
  close(): Promise<void>;
}
