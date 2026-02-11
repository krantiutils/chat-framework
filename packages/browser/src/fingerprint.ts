import { randomBytes, createHash } from 'node:crypto';

import type {
  BrowserFingerprint,
  ScreenFingerprint,
  WebGLFingerprint,
  CanvasFingerprint,
  PluginFingerprint,
  FingerprintGeneratorOptions,
} from './types.js';

// Common desktop resolutions weighted by market share (StatCounter 2024-2025)
const COMMON_RESOLUTIONS: Array<{ width: number; height: number; weight: number }> = [
  { width: 1920, height: 1080, weight: 0.35 },
  { width: 1366, height: 768, weight: 0.15 },
  { width: 1536, height: 864, weight: 0.10 },
  { width: 1440, height: 900, weight: 0.08 },
  { width: 2560, height: 1440, weight: 0.08 },
  { width: 1680, height: 1050, weight: 0.05 },
  { width: 1280, height: 720, weight: 0.05 },
  { width: 1600, height: 900, weight: 0.04 },
  { width: 3840, height: 2160, weight: 0.04 },
  { width: 1280, height: 1024, weight: 0.03 },
  { width: 1920, height: 1200, weight: 0.03 },
];

// Chrome user agent templates by OS
const USER_AGENT_TEMPLATES: Record<string, string[]> = {
  win32: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version} Safari/537.36',
  ],
  linux: [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version} Safari/537.36',
  ],
  darwin: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version} Safari/537.36',
  ],
};

// Recent stable Chrome versions (keep updated)
const CHROME_VERSIONS = [
  '131.0.6778.139',
  '131.0.6778.108',
  '130.0.6723.117',
  '130.0.6723.91',
  '129.0.6668.100',
  '129.0.6668.89',
];

// WebGL renderer strings that match real GPU hardware
const WEBGL_CONFIGS: Array<{ vendor: string; renderer: string; unmaskedVendor: string; unmaskedRenderer: string }> = [
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    unmaskedVendor: 'Google Inc. (NVIDIA)',
    unmaskedRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
    unmaskedVendor: 'Google Inc. (NVIDIA)',
    unmaskedRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    unmaskedVendor: 'Google Inc. (NVIDIA)',
    unmaskedRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    vendor: 'Google Inc. (AMD)',
    renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    unmaskedVendor: 'Google Inc. (AMD)',
    unmaskedRenderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    vendor: 'Google Inc. (Intel)',
    renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    unmaskedVendor: 'Google Inc. (Intel)',
    unmaskedRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    vendor: 'Google Inc. (Intel)',
    renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    unmaskedVendor: 'Google Inc. (Intel)',
    unmaskedRenderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
];

// Common system fonts by platform
const SYSTEM_FONTS: Record<string, string[]> = {
  win32: [
    'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS',
    'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Georgia', 'Impact',
    'Lucida Console', 'Lucida Sans Unicode', 'Microsoft Sans Serif',
    'Palatino Linotype', 'Segoe UI', 'Tahoma', 'Times New Roman',
    'Trebuchet MS', 'Verdana',
  ],
  linux: [
    'Arial', 'Courier New', 'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif',
    'FreeMono', 'FreeSans', 'FreeSerif', 'Liberation Mono', 'Liberation Sans',
    'Liberation Serif', 'Noto Sans', 'Noto Serif', 'Ubuntu', 'Ubuntu Mono',
  ],
  darwin: [
    'Arial', 'Arial Black', 'Courier New', 'Georgia', 'Helvetica',
    'Helvetica Neue', 'Lucida Grande', 'Menlo', 'Monaco', 'Optima',
    'Palatino', 'SF Pro', 'SF Mono', 'Times New Roman', 'Trebuchet MS',
    'Verdana',
  ],
};

// Default Chrome plugins
const CHROME_PLUGINS: PluginFingerprint[] = [
  { name: 'PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
  { name: 'Chrome PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
  { name: 'Chromium PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
  { name: 'Microsoft Edge PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
  { name: 'WebKit built-in PDF', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
];

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Asia/Dubai',
  'Australia/Sydney', 'America/Sao_Paulo', 'America/Toronto',
];

const PLATFORMS: Array<'win32' | 'linux' | 'darwin'> = ['win32', 'linux', 'darwin'];

/**
 * Seeded PRNG (xorshift128+) for deterministic fingerprint generation.
 * Given the same seed, always produces the same fingerprint.
 */
class SeededRandom {
  private state0: bigint;
  private state1: bigint;

  constructor(seed: string) {
    const hash = createHash('sha256').update(seed).digest();
    this.state0 = hash.readBigUInt64LE(0);
    this.state1 = hash.readBigUInt64LE(8);
    // Ensure non-zero state
    if (this.state0 === 0n) this.state0 = 1n;
    if (this.state1 === 0n) this.state1 = 2n;
  }

  /** Returns a float in [0, 1) */
  next(): number {
    let s1 = this.state0;
    const s0 = this.state1;
    this.state0 = s0;
    s1 ^= (s1 << 23n) & 0xFFFFFFFFFFFFFFFFn;
    s1 ^= s1 >> 17n;
    s1 ^= s0;
    s1 ^= s0 >> 26n;
    this.state1 = s1;
    // Convert to [0, 1) float
    const combined = (this.state0 + this.state1) & 0xFFFFFFFFFFFFFFFFn;
    return Number(combined & 0xFFFFFFFFFFFFFn) / 0x10000000000000;
  }

  /** Returns an integer in [min, max) */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }

  /** Pick a random element from an array */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Cannot pick from empty array');
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Pick from a weighted array */
  pickWeighted<T extends { weight: number }>(items: readonly T[]): T {
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let r = this.next() * totalWeight;
    for (const item of items) {
      r -= item.weight;
      if (r <= 0) return item;
    }
    return items[items.length - 1];
  }

  /** Shuffle array in place (Fisher-Yates) */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/**
 * Generates and manages browser fingerprints.
 *
 * Fingerprints are deterministic given a profile ID — the same ID always
 * produces the same fingerprint, ensuring consistency across sessions.
 */
export class FingerprintManager {
  /**
   * Generate a fingerprint deterministically from a profile ID.
   * Same ID always produces the same fingerprint.
   */
  generate(profileId: string, options: FingerprintGeneratorOptions = {}): BrowserFingerprint {
    const rng = new SeededRandom(profileId);

    const platform = options.platform ?? rng.pick(PLATFORMS);
    const chromeVersion = rng.pick(CHROME_VERSIONS);
    const locale = options.locale ?? 'en-US';

    const userAgent = this.generateUserAgent(rng, platform, chromeVersion);
    const screen = this.generateScreen(rng, options.screen);
    const webgl = this.generateWebGL(rng);
    const canvas = this.generateCanvas(rng);
    const fonts = this.generateFonts(rng, platform);
    const plugins = this.generatePlugins(rng);

    return {
      userAgent,
      platform: this.mapPlatformToNavigator(platform),
      language: locale,
      languages: this.generateLanguages(locale),
      timezone: rng.pick(TIMEZONES),
      screen,
      webgl,
      canvas,
      fonts,
      plugins,
      hardwareConcurrency: rng.pick([2, 4, 6, 8, 12, 16]),
      deviceMemory: rng.pick([2, 4, 8, 16]),
      maxTouchPoints: 0, // Desktop browser
    };
  }

  /**
   * Generate a random unique profile ID.
   */
  generateProfileId(): string {
    return randomBytes(16).toString('hex');
  }

  private generateUserAgent(rng: SeededRandom, platform: string, version: string): string {
    const templates = USER_AGENT_TEMPLATES[platform] ?? USER_AGENT_TEMPLATES['win32'];
    const template = rng.pick(templates);
    return template.replace('{version}', version);
  }

  private generateScreen(
    rng: SeededRandom,
    override?: { width: number; height: number },
  ): ScreenFingerprint {
    let width: number;
    let height: number;

    if (override) {
      width = override.width;
      height = override.height;
    } else {
      const res = rng.pickWeighted(COMMON_RESOLUTIONS);
      width = res.width;
      height = res.height;
    }

    // availHeight is slightly less due to taskbar (30-50px typically)
    const taskbarHeight = rng.int(30, 50);

    return {
      width,
      height,
      availWidth: width,
      availHeight: height - taskbarHeight,
      colorDepth: 24,
      pixelDepth: 24,
      devicePixelRatio: width >= 2560 ? rng.pick([1, 1.25, 1.5, 2]) : 1,
    };
  }

  private generateWebGL(rng: SeededRandom): WebGLFingerprint {
    return rng.pick(WEBGL_CONFIGS);
  }

  private generateCanvas(rng: SeededRandom): CanvasFingerprint {
    return {
      noiseSeed: rng.int(0, 2147483647),
      noiseIntensity: 0.01 + rng.next() * 0.04, // 0.01 to 0.05
    };
  }

  private generateFonts(rng: SeededRandom, platform: string): string[] {
    const baseFonts = [...(SYSTEM_FONTS[platform] ?? SYSTEM_FONTS['win32'])];
    // Remove 1-3 fonts randomly to create variation
    const removeCount = rng.int(1, 4);
    for (let i = 0; i < removeCount && baseFonts.length > 5; i++) {
      const idx = rng.int(0, baseFonts.length);
      baseFonts.splice(idx, 1);
    }
    return rng.shuffle(baseFonts);
  }

  private generatePlugins(rng: SeededRandom): PluginFingerprint[] {
    // Most Chrome installs report 5 PDF plugins; sometimes only a subset
    const count = rng.pick([3, 4, 5, 5, 5]); // heavily weighted toward 5
    return CHROME_PLUGINS.slice(0, count);
  }

  private generateLanguages(locale: string): string[] {
    const lang = locale.split('-')[0];
    if (lang === locale) {
      return [locale];
    }
    return [locale, lang];
  }

  private mapPlatformToNavigator(platform: string): string {
    switch (platform) {
      case 'win32': return 'Win32';
      case 'linux': return 'Linux x86_64';
      case 'darwin': return 'MacIntel';
      default: return 'Win32';
    }
  }
}
