import { describe, it, expect, vi, beforeEach } from "vitest";

import { EventBus } from "../events/bus.js";
import type { EventOrigin, BusHandler } from "../events/bus.js";
import type { MessagingClient, MessagingClientEvents, MessagingEventName } from "../types/client.js";
import type { Message } from "../types/message.js";

/**
 * Creates a minimal mock MessagingClient that stores its registered
 * handlers so we can trigger events manually in tests.
 */
function makeMockClient() {
  const handlers = new Map<MessagingEventName, Set<(...args: unknown[]) => void>>();

  const client: MessagingClient = {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
    sendText: vi.fn(async () => ({} as never)),
    sendImage: vi.fn(async () => ({} as never)),
    sendAudio: vi.fn(async () => ({} as never)),
    sendVoice: vi.fn(async () => ({} as never)),
    sendFile: vi.fn(async () => ({} as never)),
    sendLocation: vi.fn(async () => ({} as never)),
    on: vi.fn(<E extends MessagingEventName>(event: E, handler: MessagingClientEvents[E]) => {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler as (...args: unknown[]) => void);
    }),
    off: vi.fn(<E extends MessagingEventName>(event: E, handler: MessagingClientEvents[E]) => {
      handlers.get(event)?.delete(handler as (...args: unknown[]) => void);
    }),
    react: vi.fn(async () => {}),
    reply: vi.fn(async () => ({} as never)),
    forward: vi.fn(async () => ({} as never)),
    delete: vi.fn(async () => {}),
    setTyping: vi.fn(async () => {}),
    markRead: vi.fn(async () => {}),
    getConversations: vi.fn(async () => []),
    getMessages: vi.fn(async () => []),
  };

  /** Fire an event on this mock client, triggering all registered handlers. */
  function fireEvent(event: MessagingEventName, ...args: unknown[]) {
    const set = handlers.get(event);
    if (set) {
      for (const handler of set) {
        handler(...args);
      }
    }
  }

  return { client, fireEvent, handlers };
}

function makeMessage(platform: string = "signal"): Message {
  return {
    id: "msg-1",
    conversation: {
      id: "conv-1",
      platform: platform as Message["conversation"]["platform"],
      participants: [],
      type: "dm",
      metadata: {},
    },
    sender: { id: "user-1", platform: platform as Message["sender"]["platform"] },
    timestamp: new Date(1700000000000),
    content: { type: "text", text: "hello" },
  };
}

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe("attach", () => {
    it("attaches a client and registers event listeners", () => {
      const { client } = makeMockClient();
      bus.attach("signal", client);
      // on() should have been called for each event type
      expect(client.on).toHaveBeenCalledTimes(6); // message, reaction, typing, read, presence, error
    });

    it("throws when attaching the same platform twice", () => {
      const { client: c1 } = makeMockClient();
      const { client: c2 } = makeMockClient();
      bus.attach("signal", c1);
      expect(() => bus.attach("signal", c2)).toThrow(/already attached.*signal/);
    });

    it("allows attaching different platforms", () => {
      const { client: c1 } = makeMockClient();
      const { client: c2 } = makeMockClient();
      bus.attach("signal", c1);
      bus.attach("telegram", c2);
      expect(bus.size).toBe(2);
    });
  });

  describe("detach", () => {
    it("removes event listeners from the client", () => {
      const { client } = makeMockClient();
      bus.attach("signal", client);
      bus.detach("signal");
      // off() should have been called for each event type
      expect(client.off).toHaveBeenCalledTimes(6);
      expect(bus.size).toBe(0);
    });

    it("returns false for non-attached platform", () => {
      expect(bus.detach("signal")).toBe(false);
    });

    it("returns true when detaching", () => {
      const { client } = makeMockClient();
      bus.attach("signal", client);
      expect(bus.detach("signal")).toBe(true);
    });
  });

  describe("event forwarding", () => {
    it("forwards message events with origin", () => {
      const { client, fireEvent } = makeMockClient();
      bus.attach("signal", client);

      const received: Array<{ msg: Message; origin: EventOrigin }> = [];
      const handler: BusHandler<"message"> = (msg, origin) => {
        received.push({ msg, origin });
      };
      bus.on("message", handler);

      const msg = makeMessage("signal");
      fireEvent("message", msg);

      expect(received).toHaveLength(1);
      expect(received[0].msg).toBe(msg);
      expect(received[0].origin.platform).toBe("signal");
      expect(received[0].origin.client).toBe(client);
    });

    it("forwards error events with origin", () => {
      const { client, fireEvent } = makeMockClient();
      bus.attach("signal", client);

      const received: Array<{ err: Error; origin: EventOrigin }> = [];
      bus.on("error", (err, origin) => {
        received.push({ err, origin });
      });

      const err = new Error("test error");
      fireEvent("error", err);

      expect(received).toHaveLength(1);
      expect(received[0].err).toBe(err);
      expect(received[0].origin.platform).toBe("signal");
    });

    it("forwards events from multiple clients", () => {
      const signal = makeMockClient();
      const telegram = makeMockClient();
      bus.attach("signal", signal.client);
      bus.attach("telegram", telegram.client);

      const origins: string[] = [];
      bus.on("message", (_msg, origin) => {
        origins.push(origin.platform);
      });

      signal.fireEvent("message", makeMessage("signal"));
      telegram.fireEvent("message", makeMessage("telegram"));

      expect(origins).toEqual(["signal", "telegram"]);
    });

    it("stops forwarding after detach", () => {
      const { client, fireEvent } = makeMockClient();
      bus.attach("signal", client);

      const received: Message[] = [];
      bus.on("message", (msg) => {
        received.push(msg);
      });

      fireEvent("message", makeMessage());
      expect(received).toHaveLength(1);

      bus.detach("signal");
      fireEvent("message", makeMessage()); // should not be forwarded
      expect(received).toHaveLength(1);
    });
  });

  describe("platform filtering", () => {
    it("filters events by platform", () => {
      const signal = makeMockClient();
      const telegram = makeMockClient();
      bus.attach("signal", signal.client);
      bus.attach("telegram", telegram.client);

      const signalMessages: Message[] = [];
      bus.on(
        "message",
        (msg) => signalMessages.push(msg),
        { platforms: ["signal"] },
      );

      signal.fireEvent("message", makeMessage("signal"));
      telegram.fireEvent("message", makeMessage("telegram"));

      expect(signalMessages).toHaveLength(1);
      expect(signalMessages[0].conversation.platform).toBe("signal");
    });

    it("allows filtering by multiple platforms", () => {
      const signal = makeMockClient();
      const telegram = makeMockClient();
      const discord = makeMockClient();
      bus.attach("signal", signal.client);
      bus.attach("telegram", telegram.client);
      bus.attach("discord", discord.client);

      const received: string[] = [];
      bus.on(
        "message",
        (_msg, origin) => received.push(origin.platform),
        { platforms: ["signal", "telegram"] },
      );

      signal.fireEvent("message", makeMessage("signal"));
      telegram.fireEvent("message", makeMessage("telegram"));
      discord.fireEvent("message", makeMessage("discord"));

      expect(received).toEqual(["signal", "telegram"]);
    });
  });

  describe("off", () => {
    it("removes a handler", () => {
      const { client, fireEvent } = makeMockClient();
      bus.attach("signal", client);

      const received: Message[] = [];
      const handler: BusHandler<"message"> = (msg) => received.push(msg);
      bus.on("message", handler);
      bus.off("message", handler);

      fireEvent("message", makeMessage());
      expect(received).toHaveLength(0);
    });

    it("is a no-op for unregistered handler", () => {
      // Should not throw
      bus.off("message", (() => {}) as BusHandler<"message">);
    });
  });

  describe("error handling in bus handlers", () => {
    it("forwards handler errors to error event", () => {
      const { client, fireEvent } = makeMockClient();
      bus.attach("signal", client);

      const errors: Error[] = [];
      bus.on("error", (err) => errors.push(err));
      bus.on("message", () => {
        throw new Error("bus handler bug");
      });

      fireEvent("message", makeMessage());
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe("bus handler bug");
    });

    it("does not cause infinite recursion on error handler errors", () => {
      const { client, fireEvent } = makeMockClient();
      bus.attach("signal", client);

      bus.on("error", () => {
        throw new Error("error handler also broken");
      });

      // Should not throw or recurse infinitely
      expect(() => fireEvent("error", new Error("original error"))).not.toThrow();
    });
  });

  describe("platforms / getClient / size", () => {
    it("lists attached platforms", () => {
      const { client: c1 } = makeMockClient();
      const { client: c2 } = makeMockClient();
      bus.attach("signal", c1);
      bus.attach("telegram", c2);

      const platforms = bus.platforms();
      expect(platforms).toHaveLength(2);
      expect(platforms).toContain("signal");
      expect(platforms).toContain("telegram");
    });

    it("returns the attached client", () => {
      const { client } = makeMockClient();
      bus.attach("signal", client);
      expect(bus.getClient("signal")).toBe(client);
    });

    it("returns undefined for non-attached platform", () => {
      expect(bus.getClient("signal")).toBeUndefined();
    });

    it("tracks size correctly", () => {
      expect(bus.size).toBe(0);
      const { client } = makeMockClient();
      bus.attach("signal", client);
      expect(bus.size).toBe(1);
      bus.detach("signal");
      expect(bus.size).toBe(0);
    });
  });

  describe("destroy", () => {
    it("detaches all clients and clears subscribers", () => {
      const signal = makeMockClient();
      const telegram = makeMockClient();
      bus.attach("signal", signal.client);
      bus.attach("telegram", telegram.client);
      bus.on("message", () => {});

      bus.destroy();

      expect(bus.size).toBe(0);
      expect(signal.client.off).toHaveBeenCalled();
      expect(telegram.client.off).toHaveBeenCalled();
    });

    it("bus is reusable after destroy", () => {
      const { client: c1 } = makeMockClient();
      bus.attach("signal", c1);
      bus.destroy();

      const c2 = makeMockClient();
      bus.attach("signal", c2.client); // should not throw
      expect(bus.size).toBe(1);
    });
  });
});
