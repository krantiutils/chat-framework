import { describe, it, expect, vi, beforeEach } from "vitest";

import { AdapterRegistry } from "../registry/registry.js";
import { createCapabilities } from "../capabilities/matrix.js";
import type { PlatformCapabilities } from "../capabilities/types.js";
import type { MessagingClient } from "../types/client.js";

/** Minimal mock MessagingClient for testing. */
function makeMockClient(overrides: Partial<MessagingClient> = {}): MessagingClient {
  return {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    isConnected: vi.fn(() => false),
    sendText: vi.fn(async () => ({} as never)),
    sendImage: vi.fn(async () => ({} as never)),
    sendAudio: vi.fn(async () => ({} as never)),
    sendVoice: vi.fn(async () => ({} as never)),
    sendFile: vi.fn(async () => ({} as never)),
    sendLocation: vi.fn(async () => ({} as never)),
    on: vi.fn(),
    off: vi.fn(),
    react: vi.fn(async () => {}),
    reply: vi.fn(async () => ({} as never)),
    forward: vi.fn(async () => ({} as never)),
    delete: vi.fn(async () => {}),
    setTyping: vi.fn(async () => {}),
    markRead: vi.fn(async () => {}),
    getConversations: vi.fn(async () => []),
    getMessages: vi.fn(async () => []),
    ...overrides,
  };
}

const BASIC_CAPS: PlatformCapabilities = createCapabilities({ text: true });

describe("AdapterRegistry", () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  describe("register", () => {
    it("registers an adapter factory", () => {
      const factory = vi.fn(() => makeMockClient());
      registry.register("signal", factory, BASIC_CAPS);
      expect(registry.has("signal")).toBe(true);
    });

    it("throws when registering the same platform twice", () => {
      const factory = vi.fn(() => makeMockClient());
      registry.register("signal", factory, BASIC_CAPS);
      expect(() => registry.register("signal", factory, BASIC_CAPS)).toThrow(
        /already registered.*signal/,
      );
    });

    it("allows registering different platforms", () => {
      registry.register("signal", () => makeMockClient(), BASIC_CAPS);
      registry.register("telegram", () => makeMockClient(), BASIC_CAPS);
      expect(registry.size).toBe(2);
    });
  });

  describe("unregister", () => {
    it("removes a registered adapter", () => {
      registry.register("signal", () => makeMockClient(), BASIC_CAPS);
      expect(registry.unregister("signal")).toBe(true);
      expect(registry.has("signal")).toBe(false);
    });

    it("returns false for unregistered platform", () => {
      expect(registry.unregister("signal")).toBe(false);
    });

    it("allows re-registration after unregister", () => {
      const factory1 = vi.fn(() => makeMockClient());
      const factory2 = vi.fn(() => makeMockClient());
      registry.register("signal", factory1, BASIC_CAPS);
      registry.unregister("signal");
      registry.register("signal", factory2, BASIC_CAPS);
      registry.create("signal", {});
      expect(factory2).toHaveBeenCalled();
      expect(factory1).not.toHaveBeenCalled();
    });
  });

  describe("create", () => {
    it("creates a client by calling the factory with the config", () => {
      const mockClient = makeMockClient();
      const factory = vi.fn(() => mockClient);
      const config = { phoneNumber: "+1234567890" };

      registry.register("signal", factory, BASIC_CAPS);
      const client = registry.create("signal", config);

      expect(factory).toHaveBeenCalledWith(config);
      expect(client).toBe(mockClient);
    });

    it("throws for unregistered platform", () => {
      expect(() => registry.create("telegram", {})).toThrow(
        /no adapter registered.*telegram/i,
      );
    });

    it("includes registered platforms in error message", () => {
      registry.register("signal", () => makeMockClient(), BASIC_CAPS);
      registry.register("discord", () => makeMockClient(), BASIC_CAPS);

      try {
        registry.create("telegram", {});
        expect.fail("should have thrown");
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toContain("signal");
        expect(msg).toContain("discord");
      }
    });

    it("creates independent instances on each call", () => {
      let callCount = 0;
      registry.register(
        "signal",
        () => {
          callCount++;
          return makeMockClient();
        },
        BASIC_CAPS,
      );

      const a = registry.create("signal", {});
      const b = registry.create("signal", {});
      expect(a).not.toBe(b);
      expect(callCount).toBe(2);
    });
  });

  describe("getCapabilities", () => {
    it("returns the registered capabilities", () => {
      const caps = createCapabilities({ text: true, reactions: true, voiceCalls: true });
      registry.register("discord", () => makeMockClient(), caps);

      const result = registry.getCapabilities("discord");
      expect(result.text).toBe(true);
      expect(result.reactions).toBe(true);
      expect(result.voiceCalls).toBe(true);
      expect(result.payments).toBe(false);
    });

    it("throws for unregistered platform", () => {
      expect(() => registry.getCapabilities("telegram")).toThrow(
        /no adapter registered.*telegram/i,
      );
    });
  });

  describe("has", () => {
    it("returns false for unregistered platform", () => {
      expect(registry.has("signal")).toBe(false);
    });

    it("returns true for registered platform", () => {
      registry.register("signal", () => makeMockClient(), BASIC_CAPS);
      expect(registry.has("signal")).toBe(true);
    });
  });

  describe("platforms", () => {
    it("returns empty array when nothing is registered", () => {
      expect(registry.platforms()).toEqual([]);
    });

    it("returns all registered platforms", () => {
      registry.register("signal", () => makeMockClient(), BASIC_CAPS);
      registry.register("telegram", () => makeMockClient(), BASIC_CAPS);
      registry.register("discord", () => makeMockClient(), BASIC_CAPS);

      const platforms = registry.platforms();
      expect(platforms).toHaveLength(3);
      expect(platforms).toContain("signal");
      expect(platforms).toContain("telegram");
      expect(platforms).toContain("discord");
    });
  });

  describe("size", () => {
    it("is 0 initially", () => {
      expect(registry.size).toBe(0);
    });

    it("reflects registrations", () => {
      registry.register("signal", () => makeMockClient(), BASIC_CAPS);
      expect(registry.size).toBe(1);
      registry.register("telegram", () => makeMockClient(), BASIC_CAPS);
      expect(registry.size).toBe(2);
      registry.unregister("signal");
      expect(registry.size).toBe(1);
    });
  });

  describe("clear", () => {
    it("removes all registrations", () => {
      registry.register("signal", () => makeMockClient(), BASIC_CAPS);
      registry.register("telegram", () => makeMockClient(), BASIC_CAPS);
      registry.clear();
      expect(registry.size).toBe(0);
      expect(registry.has("signal")).toBe(false);
      expect(registry.has("telegram")).toBe(false);
    });
  });
});
