import { describe, it, expect, beforeEach } from 'vitest';
import { ProxyManager } from '../src/proxy.js';
import type { ProxyConfig } from '../src/types.js';

const makeProxy = (port: number): ProxyConfig => ({
  host: '192.168.1.1',
  port,
  protocol: 'http',
  username: 'user',
  password: 'pass',
});

describe('ProxyManager', () => {
  let proxies: ProxyConfig[];
  let manager: ProxyManager;

  beforeEach(() => {
    proxies = [makeProxy(8001), makeProxy(8002), makeProxy(8003)];
    manager = new ProxyManager({ proxies });
  });

  describe('getProxy', () => {
    it('returns a proxy for a profile', () => {
      const proxy = manager.getProxy('profile-1');
      expect(proxy).not.toBeNull();
      expect(proxy!.host).toBe('192.168.1.1');
    });

    it('returns the same proxy for the same profile (sticky session)', () => {
      const proxy1 = manager.getProxy('sticky-test');
      const proxy2 = manager.getProxy('sticky-test');
      expect(proxy1).toEqual(proxy2);
    });

    it('load-balances across proxies for different profiles', () => {
      const ports = new Set<number>();
      for (let i = 0; i < 3; i++) {
        const proxy = manager.getProxy(`profile-${i}`);
        if (proxy) ports.add(proxy.port);
      }
      // With 3 proxies and 3 profiles, should use all 3
      expect(ports.size).toBe(3);
    });

    it('returns null when no proxies configured', () => {
      const empty = new ProxyManager({ proxies: [] });
      expect(empty.getProxy('any')).toBeNull();
    });
  });

  describe('reportFailure / reportSuccess', () => {
    it('marks proxy unhealthy after maxConsecutiveFailures', () => {
      const mgr = new ProxyManager({
        proxies: [makeProxy(9001)],
        maxConsecutiveFailures: 2,
      });

      const proxy = mgr.getProxy('test')!;
      expect(proxy).not.toBeNull();

      mgr.reportFailure(proxy);
      // Still healthy after 1 failure
      expect(mgr.getProxy('test')).toEqual(proxy);

      mgr.reportFailure(proxy);
      // Now unhealthy (2 >= maxConsecutiveFailures)
      // Release and try to get new one
      mgr.releaseProfile('test');
      expect(mgr.getProxy('test2')).toBeNull();
    });

    it('resets failure count on success', () => {
      const mgr = new ProxyManager({
        proxies: [makeProxy(9001)],
        maxConsecutiveFailures: 3,
      });

      const proxy = mgr.getProxy('test')!;
      mgr.reportFailure(proxy);
      mgr.reportFailure(proxy);
      mgr.reportSuccess(proxy); // Reset
      mgr.reportFailure(proxy);
      mgr.reportFailure(proxy);
      // Should still be healthy (only 2 consecutive after reset)
      expect(mgr.healthyCount).toBe(1);
    });
  });

  describe('releaseProfile', () => {
    it('allows proxy to be reassigned after release', () => {
      const mgr = new ProxyManager({ proxies: [makeProxy(7001)] });
      const proxy = mgr.getProxy('profile-a')!;

      mgr.releaseProfile('profile-a');

      const status = mgr.getStatus();
      expect(status[0].stickyProfileCount).toBe(0);

      // New profile can get the same proxy
      const proxy2 = mgr.getProxy('profile-b')!;
      expect(proxy2).toEqual(proxy);
    });
  });

  describe('reassignment on unhealthy proxy', () => {
    it('reassigns profile to healthy proxy when sticky one becomes unhealthy', () => {
      const mgr = new ProxyManager({
        proxies: [makeProxy(5001), makeProxy(5002)],
        maxConsecutiveFailures: 1,
      });

      const proxy1 = mgr.getProxy('victim')!;

      // Kill that proxy
      mgr.reportFailure(proxy1);

      // Profile should get reassigned
      const proxy2 = mgr.getProxy('victim')!;
      expect(proxy2).not.toBeNull();
      expect(proxy2.port).not.toBe(proxy1.port);
    });
  });

  describe('formatProxyUrl', () => {
    it('formats proxy as URL without credentials', () => {
      const url = manager.formatProxyUrl(proxies[0]);
      expect(url).toBe('http://192.168.1.1:8001');
    });

    it('handles socks5 protocol', () => {
      const socks: ProxyConfig = {
        host: '10.0.0.1',
        port: 1080,
        protocol: 'socks5',
      };
      expect(manager.formatProxyUrl(socks)).toBe('socks5://10.0.0.1:1080');
    });
  });

  describe('getStatus', () => {
    it('returns status for all proxies', () => {
      const status = manager.getStatus();
      expect(status).toHaveLength(3);
      expect(status[0].healthy).toBe(true);
      expect(status[0].consecutiveFailures).toBe(0);
    });
  });

  describe('healthyCount / totalCount', () => {
    it('tracks counts correctly', () => {
      expect(manager.totalCount).toBe(3);
      expect(manager.healthyCount).toBe(3);

      // Mark one unhealthy
      const mgr = new ProxyManager({
        proxies,
        maxConsecutiveFailures: 1,
      });
      mgr.reportFailure(proxies[0]);
      expect(mgr.healthyCount).toBe(2);
      expect(mgr.totalCount).toBe(3);
    });
  });

  describe('health check interval', () => {
    it('starts and stops without errors', () => {
      manager.startHealthChecks();
      // Should be idempotent
      manager.startHealthChecks();
      manager.stopHealthChecks();
      manager.stopHealthChecks();
    });
  });
});
