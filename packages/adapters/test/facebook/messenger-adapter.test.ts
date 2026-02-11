import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FacebookMessengerAdapter } from "../../src/facebook/messenger-adapter.js";
import type { FacebookMessengerConfig } from "../../src/facebook/types.js";
import type { Conversation, Message } from "@chat-framework/core";

describe("FacebookMessengerAdapter", () => {
  const baseConfig: FacebookMessengerConfig = {
    credentials: { email: "test@example.com", password: "password123" },
    headless: true,
  };

  describe("constructor", () => {
    it("creates adapter with minimal config", () => {
      const adapter = new FacebookMessengerAdapter(baseConfig);
      expect(adapter.isConnected()).toBe(false);
    });

    it("accepts full config with all options", () => {
      const fullConfig: FacebookMessengerConfig = {
        ...baseConfig,
        userDataDir: "/tmp/fb-session",
        headless: false,
        elementTimeoutMs: 15000,
        messagePollingIntervalMs: 5000,
        sessionProfile: {
          idleTendency: 0.3,
          afkProneness: 0.1,
          readingSpeed: 0.7,
          scrollTendency: 0.4,
          deliberation: 0.5,
          activityLevel: 0.8,
        },
        selectorOverrides: {
          messageInput: '[data-custom="input"]',
        },
      };

      const adapter = new FacebookMessengerAdapter(fullConfig);
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe("isConnected", () => {
    it("returns false before connect", () => {
      const adapter = new FacebookMessengerAdapter(baseConfig);
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe("operations before connect", () => {
    let adapter: FacebookMessengerAdapter;

    beforeEach(() => {
      adapter = new FacebookMessengerAdapter(baseConfig);
    });

    const mockConversation: Conversation = {
      id: "123",
      platform: "facebook",
      participants: [],
      type: "dm",
      metadata: {},
    };

    const mockMessage: Message = {
      id: "msg-1",
      conversation: mockConversation,
      sender: { id: "user1", platform: "facebook" },
      timestamp: new Date(),
      content: { type: "text", text: "test" },
    };

    it("sendText throws when not connected", async () => {
      await expect(
        adapter.sendText(mockConversation, "hello"),
      ).rejects.toThrow("not connected");
    });

    it("sendImage throws when not connected", async () => {
      await expect(
        adapter.sendImage(mockConversation, "/path/to/image.jpg"),
      ).rejects.toThrow("not connected");
    });

    it("sendFile throws when not connected", async () => {
      await expect(
        adapter.sendFile(mockConversation, "/path/to/file.pdf", "file.pdf"),
      ).rejects.toThrow("not connected");
    });

    it("react throws when not connected", async () => {
      await expect(adapter.react(mockMessage, "thumbsup")).rejects.toThrow(
        "not connected",
      );
    });

    it("reply throws when not connected", async () => {
      await expect(
        adapter.reply(mockMessage, { type: "text", text: "reply" }),
      ).rejects.toThrow("not connected");
    });

    it("delete throws when not connected", async () => {
      await expect(adapter.delete(mockMessage)).rejects.toThrow(
        "not connected",
      );
    });

    it("setTyping throws when not connected", async () => {
      await expect(adapter.setTyping(mockConversation)).rejects.toThrow(
        "not connected",
      );
    });

    it("markRead throws when not connected", async () => {
      await expect(adapter.markRead(mockMessage)).rejects.toThrow(
        "not connected",
      );
    });

    it("getConversations throws when not connected", async () => {
      await expect(adapter.getConversations()).rejects.toThrow("not connected");
    });

    it("getMessages throws when not connected", async () => {
      await expect(adapter.getMessages(mockConversation)).rejects.toThrow(
        "not connected",
      );
    });
  });

  describe("event listeners", () => {
    it("registers and unregisters listeners", () => {
      const adapter = new FacebookMessengerAdapter(baseConfig);
      const handler = vi.fn();

      const unsubscribe = adapter.on("message", handler);
      expect(typeof unsubscribe).toBe("function");

      // Unsubscribe should not throw
      unsubscribe();
    });

    it("supports multiple listeners for same event", () => {
      const adapter = new FacebookMessengerAdapter(baseConfig);
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const unsub1 = adapter.on("message", handler1);
      const unsub2 = adapter.on("message", handler2);

      expect(typeof unsub1).toBe("function");
      expect(typeof unsub2).toBe("function");

      unsub1();
      unsub2();
    });

    it("supports different event types", () => {
      const adapter = new FacebookMessengerAdapter(baseConfig);

      const msgHandler = vi.fn();
      const reactionHandler = vi.fn();
      const typingHandler = vi.fn();
      const readHandler = vi.fn();
      const presenceHandler = vi.fn();

      adapter.on("message", msgHandler);
      adapter.on("reaction", reactionHandler);
      adapter.on("typing", typingHandler);
      adapter.on("read", readHandler);
      adapter.on("presence", presenceHandler);
    });
  });

  describe("getPage", () => {
    it("returns null when not connected", () => {
      const adapter = new FacebookMessengerAdapter(baseConfig);
      expect(adapter.getPage()).toBeNull();
    });
  });

  describe("disconnect", () => {
    it("does not throw when not connected", async () => {
      const adapter = new FacebookMessengerAdapter(baseConfig);
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });
});
