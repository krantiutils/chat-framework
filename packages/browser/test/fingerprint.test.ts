import { describe, it, expect } from 'vitest';
import { FingerprintManager } from '../src/fingerprint.js';

describe('FingerprintManager', () => {
  const manager = new FingerprintManager();

  describe('generate', () => {
    it('produces a complete fingerprint with all required fields', () => {
      const fp = manager.generate('test-profile-1');

      expect(fp.userAgent).toContain('Chrome/');
      expect(fp.userAgent).toContain('Mozilla/5.0');
      expect(fp.platform).toBeDefined();
      expect(['Win32', 'Linux x86_64', 'MacIntel']).toContain(fp.platform);
      expect(fp.language).toBe('en-US');
      expect(fp.languages).toContain('en-US');
      expect(fp.timezone).toBeDefined();

      // Screen
      expect(fp.screen.width).toBeGreaterThan(0);
      expect(fp.screen.height).toBeGreaterThan(0);
      expect(fp.screen.availWidth).toBe(fp.screen.width);
      expect(fp.screen.availHeight).toBeLessThan(fp.screen.height);
      expect(fp.screen.colorDepth).toBe(24);
      expect(fp.screen.pixelDepth).toBe(24);
      expect(fp.screen.devicePixelRatio).toBeGreaterThan(0);

      // WebGL
      expect(fp.webgl.vendor).toBeDefined();
      expect(fp.webgl.renderer).toBeDefined();
      expect(fp.webgl.unmaskedVendor).toBeDefined();
      expect(fp.webgl.unmaskedRenderer).toBeDefined();

      // Canvas
      expect(fp.canvas.noiseSeed).toBeGreaterThanOrEqual(0);
      expect(fp.canvas.noiseIntensity).toBeGreaterThan(0);
      expect(fp.canvas.noiseIntensity).toBeLessThanOrEqual(0.05);

      // Fonts
      expect(fp.fonts.length).toBeGreaterThan(0);

      // Plugins
      expect(fp.plugins.length).toBeGreaterThan(0);
      expect(fp.plugins[0].name).toBeDefined();

      // Hardware
      expect([2, 4, 6, 8, 12, 16]).toContain(fp.hardwareConcurrency);
      expect([2, 4, 8, 16]).toContain(fp.deviceMemory);
      expect(fp.maxTouchPoints).toBe(0);
    });

    it('is deterministic — same profile ID produces same fingerprint', () => {
      const fp1 = manager.generate('deterministic-test');
      const fp2 = manager.generate('deterministic-test');

      expect(fp1).toEqual(fp2);
    });

    it('produces different fingerprints for different profile IDs', () => {
      const fp1 = manager.generate('profile-a');
      const fp2 = manager.generate('profile-b');

      // Very unlikely to be identical across all fields
      expect(fp1.userAgent === fp2.userAgent &&
             fp1.canvas.noiseSeed === fp2.canvas.noiseSeed &&
             fp1.timezone === fp2.timezone).toBe(false);
    });

    it('respects platform option', () => {
      const fpWin = manager.generate('platform-test', { platform: 'win32' });
      const fpLinux = manager.generate('platform-test', { platform: 'linux' });
      const fpMac = manager.generate('platform-test', { platform: 'darwin' });

      expect(fpWin.platform).toBe('Win32');
      expect(fpWin.userAgent).toContain('Windows');

      expect(fpLinux.platform).toBe('Linux x86_64');
      expect(fpLinux.userAgent).toContain('Linux');

      expect(fpMac.platform).toBe('MacIntel');
      expect(fpMac.userAgent).toContain('Macintosh');
    });

    it('respects locale option', () => {
      const fp = manager.generate('locale-test', { locale: 'fr-FR' });
      expect(fp.language).toBe('fr-FR');
      expect(fp.languages).toContain('fr-FR');
      expect(fp.languages).toContain('fr');
    });

    it('respects screen resolution option', () => {
      const fp = manager.generate('screen-test', {
        screen: { width: 2560, height: 1440 },
      });
      expect(fp.screen.width).toBe(2560);
      expect(fp.screen.height).toBe(1440);
    });

    it('generates reasonable font lists per platform', () => {
      const fpWin = manager.generate('fonts-win', { platform: 'win32' });
      const fpLinux = manager.generate('fonts-linux', { platform: 'linux' });
      const fpMac = manager.generate('fonts-mac', { platform: 'darwin' });

      // Windows should have Windows-specific fonts
      expect(fpWin.fonts.some(f => f === 'Segoe UI' || f === 'Calibri' || f === 'Consolas')).toBe(true);

      // Linux should have Linux-specific fonts
      expect(fpLinux.fonts.some(f => f.startsWith('DejaVu') || f.startsWith('Liberation') || f === 'Ubuntu')).toBe(true);

      // Mac should have Mac-specific fonts
      expect(fpMac.fonts.some(f => f === 'Helvetica Neue' || f === 'Menlo' || f.startsWith('SF'))).toBe(true);
    });

    it('generates WebGL configs matching real hardware', () => {
      const fp = manager.generate('webgl-test');
      // Should contain GPU vendor info
      expect(fp.webgl.renderer).toContain('ANGLE');
      expect(
        fp.webgl.vendor.includes('NVIDIA') ||
        fp.webgl.vendor.includes('AMD') ||
        fp.webgl.vendor.includes('Intel')
      ).toBe(true);
    });
  });

  describe('generateProfileId', () => {
    it('generates unique hex IDs', () => {
      const id1 = manager.generateProfileId();
      const id2 = manager.generateProfileId();

      expect(id1).toMatch(/^[0-9a-f]{32}$/);
      expect(id2).toMatch(/^[0-9a-f]{32}$/);
      expect(id1).not.toBe(id2);
    });
  });
});
