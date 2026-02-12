import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { TelegramAdapterConfig, TelegramMessage } from "../telegram/types.js";
import type { Conversation, Message } from "@chat-framework/core";

/**
 * Tests for TelegramAdapter.
 *
 * Mocks Telegraf to test the adapter's message routing,
 * event emission, and API methods without a real bot token.
 */

// Track registered handlers and mock state
const handlers = new Map<string, (ctx: unknown) => void>();
let mockCatchHandler: ((err: unknown) => void) | null = null;
let launched = false;
let stopped = false;
let lastApiCall: { method: string; args: unknown[] } | null = null;

const mockTelegram = {
  getMe: vi.fn(async () => ({
    id: 999,
    is_bot: true,
    first_name: "TestBot",
    username: "test_bot",
  })),
  sendMessage: vi.fn(async (_chatId: number, text: string) => ({
    message_id: 100,
    from: { id: 999, is_bot: true, first_name: "TestBot" },
    chat: { id: _chatId, type: "private" as const },
    date: 1700000000,
    text,
  })),
  sendPhoto: vi.fn(async (_chatId: number, _photo: unknown, extra?: Record<string, unknown>) => ({
    message_id: 101,
    from: { id: 999, is_bot: true, first_name: "TestBot" },
    chat: { id: _chatId, type: "private" as const },
    date: 1700000000,
    photo: [{ file_id: "sent_photo", file_unique_id: "sp", width: 800, height: 600 }],
    caption: extra?.caption,
  })),
  sendAudio: vi.fn(async (_chatId: number) => ({
    message_id: 102,
    from: { id: 999, is_bot: true, first_name: "TestBot" },
    chat: { id: _chatId, type: "private" as const },
    date: 1700000000,
    audio: { file_id: "sent_audio", file_unique_id: "sa", duration: 120 },
  })),
  sendVoice: vi.fn(async (_chatId: number) => ({
    message_id: 103,
    from: { id: 999, is_bot: true, first_name: "TestBot" },
    chat: { id: _chatId, type: "private" as const },
    date: 1700000000,
    voice: { file_id: "sent_voice", file_unique_id: "sv", duration: 5 },
  })),
  sendDocument: vi.fn(async (_chatId: number) => ({
    message_id: 104,
    from: { id: 999, is_bot: true, first_name: "TestBot" },
    chat: { id: _chatId, type: "private" as const },
    date: 1700000000,
    document: { file_id: "sent_doc", file_unique_id: "sd", file_name: "file.pdf" },
  })),
  sendLocation: vi.fn(async (_chatId: number, lat: number, lng: number) => ({
    message_id: 105,
    from: { id: 999, is_bot: true, first_name: "TestBot" },
    chat: { id: _chatId, type: "private" as const },
    date: 1700000000,
    location: { latitude: lat, longitude: lng },
  })),
  sendChatAction: vi.fn(async () => true),
  deleteMessage: vi.fn(async () => true),
  forwardMessage: vi.fn(async (_toChatId: number, _fromChatId: number, msgId: number) => ({
    message_id: 106,
    from: { id: 999, is_bot: true, first_name: "TestBot" },
    chat: { id: _toChatId, type: "private" as const },
    date: 1700000000,
    text: "forwarded",
  })),
  sendContact: vi.fn(async (_chatId: number) => ({
    message_id: 107,
    from: { id: 999, is_bot: true, first_name: "TestBot" },
    chat: { id: _chatId, type: "private" as const },
    date: 1700000000,
    contact: { phone_number: "+1234567890", first_name: "Bob" },
  })),
  sendSticker: vi.fn(async (_chatId: number) => ({
    message_id: 108,
    from: { id: 999, is_bot: true, first_name: "TestBot" },
    chat: { id: _chatId, type: "private" as const },
    date: 1700000000,
    sticker: { file_id: "stk1", file_unique_id: "s", type: "regular", width: 512, height: 512, is_animated: false, is_video: false },
  })),
  sendVideo: vi.fn(async (_chatId: number) => ({
    message_id: 109,
    from: { id: 999, is_bot: true, first_name: "TestBot" },
    chat: { id: _chatId, type: "private" as const },
    date: 1700000000,
    video: { file_id: "vid1", file_unique_id: "v", width: 1920, height: 1080, duration: 30 },
  })),
  setMessageReaction: vi.fn(async () => true),
  callApi: vi.fn(async (method: string, ...args: unknown[]) => {
    lastApiCall = { method, args };
    return true;
  }),
};

vi.mock("telegraf", () => {
  return {
    Telegraf: class MockTelegraf {
      telegram = mockTelegram;

      constructor(_token: string, _opts?: unknown) {}

      on(event: string, handler: (ctx: unknown) => void) {
        handlers.set(event, handler);
      }

      catch(handler: (err: unknown) => void) {
        mockCatchHandler = handler;
      }

      async launch(_opts?: unknown) {
        launched = true;
      }

      stop(_reason?: string) {
        stopped = true;
      }
    },
    Input: {
      fromBuffer: (buf: Buffer, filename?: string) => ({ source: buf, filename }),
      fromURL: (url: string, filename?: string) => ({ url, filename }),
    },
  };
});

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (path: string) => Buffer.from(`contents-of-${path}`)),
}));

// Import after mocks
const { TelegramAdapter } = await import("../telegram/adapter.js");

const CONFIG: TelegramAdapterConfig = {
  token: "123456:ABC-DEF",
};

function makeDmConversation(chatId = "42"): Conversation {
  return {
    id: chatId,
    platform: "telegram",
    participants: [],
    type: "dm",
    metadata: {},
  };
}

function makeGroupConversation(chatId = "-100111222333"): Conversation {
  return {
    id: chatId,
    platform: "telegram",
    participants: [],
    type: "group",
    metadata: {},
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "42",
    conversation: makeDmConversation(),
    sender: { id: "123456", platform: "telegram" },
    timestamp: new Date(1700000000000),
    content: { type: "text", text: "test" },
    ...overrides,
  };
}

describe("TelegramAdapter", () => {
  let adapter: InstanceType<typeof TelegramAdapter>;

  beforeEach(() => {
    handlers.clear();
    mockCatchHandler = null;
    launched = false;
    stopped = false;
    lastApiCall = null;
    vi.clearAllMocks();
    adapter = new TelegramAdapter(CONFIG);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("connection lifecycle", () => {
    it("connects successfully", async () => {
      expect(adapter.isConnected()).toBe(false);
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
      expect(launched).toBe(true);
      expect(mockTelegram.getMe).toHaveBeenCalledOnce();
    });

    it("throws when connecting twice", async () => {
      await adapter.connect();
      await expect(adapter.connect()).rejects.toThrow("already connected");
    });

    it("disconnects cleanly", async () => {
      await adapter.connect();
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
      expect(stopped).toBe(true);
    });

    it("disconnect is idempotent", async () => {
      await adapter.disconnect(); // no-op
    });
  });

  describe("sending messages", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("sends text to DM", async () => {
      const conv = makeDmConversation("42");
      const msg = await adapter.sendText(conv, "hello");
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(42, "hello");
      expect(msg.content).toEqual({ type: "text", text: "hello" });
      expect(msg.id).toBe("100");
    });

    it("sends image with caption", async () => {
      const conv = makeDmConversation("42");
      const msg = await adapter.sendImage(conv, "https://example.com/img.jpg", "caption");
      expect(mockTelegram.sendPhoto).toHaveBeenCalled();
      expect(msg.content.type).toBe("image");
    });

    it("sends image from buffer", async () => {
      const conv = makeDmConversation("42");
      const buf = Buffer.from("fake-image");
      const msg = await adapter.sendImage(conv, buf, "photo");
      expect(mockTelegram.sendPhoto).toHaveBeenCalled();
      expect(msg.content.type).toBe("image");
    });

    it("sends audio", async () => {
      const conv = makeDmConversation("42");
      const msg = await adapter.sendAudio(conv, "https://example.com/song.mp3");
      expect(mockTelegram.sendAudio).toHaveBeenCalled();
      expect(msg.content.type).toBe("audio");
    });

    it("sends voice", async () => {
      const conv = makeDmConversation("42");
      const msg = await adapter.sendVoice(conv, "https://example.com/voice.ogg");
      expect(mockTelegram.sendVoice).toHaveBeenCalled();
      expect(msg.content.type).toBe("voice");
    });

    it("sends file", async () => {
      const conv = makeDmConversation("42");
      const msg = await adapter.sendFile(conv, "https://example.com/doc.pdf", "doc.pdf");
      expect(mockTelegram.sendDocument).toHaveBeenCalled();
      expect(msg.content.type).toBe("file");
    });

    it("sends location", async () => {
      const conv = makeDmConversation("42");
      const msg = await adapter.sendLocation(conv, 40.7128, -74.006);
      expect(mockTelegram.sendLocation).toHaveBeenCalledWith(42, 40.7128, -74.006);
      expect(msg.content.type).toBe("location");
    });

    it("sends file from local path", async () => {
      const conv = makeDmConversation("42");
      const msg = await adapter.sendFile(conv, "/tmp/report.pdf", "report.pdf");
      expect(mockTelegram.sendDocument).toHaveBeenCalled();
    });

    it("throws when not connected", async () => {
      await adapter.disconnect();
      await expect(adapter.sendText(makeDmConversation(), "hi")).rejects.toThrow(
        "not connected",
      );
    });
  });

  describe("event handling", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("emits message event on incoming text", () => {
      const received: Message[] = [];
      adapter.on("message", (msg: Message) => received.push(msg));

      const handler = handlers.get("message");
      expect(handler).toBeDefined();

      handler!({
        message: {
          message_id: 55,
          from: { id: 789, is_bot: false, first_name: "Bob" },
          chat: { id: 42, type: "private" },
          date: 1700000000,
          text: "hello from Bob",
        },
      });

      expect(received).toHaveLength(1);
      expect(received[0].content).toEqual({ type: "text", text: "hello from Bob" });
      expect(received[0].sender.displayName).toBe("Bob");
    });

    it("emits message event for edited messages", () => {
      const received: Message[] = [];
      adapter.on("message", (msg: Message) => received.push(msg));

      const handler = handlers.get("edited_message");
      expect(handler).toBeDefined();

      handler!({
        editedMessage: {
          message_id: 56,
          from: { id: 789, is_bot: false, first_name: "Bob" },
          chat: { id: 42, type: "private" },
          date: 1700000001,
          text: "edited message",
        },
      });

      expect(received).toHaveLength(1);
      expect(received[0].content).toEqual({ type: "text", text: "edited message" });
    });

    it("emits message event for channel posts", () => {
      const received: Message[] = [];
      adapter.on("message", (msg: Message) => received.push(msg));

      const handler = handlers.get("channel_post");
      expect(handler).toBeDefined();

      handler!({
        channelPost: {
          message_id: 57,
          from: { id: 999, is_bot: true, first_name: "TestBot" },
          chat: { id: -100111222, type: "channel", title: "News" },
          date: 1700000002,
          text: "channel update",
        },
      });

      expect(received).toHaveLength(1);
      expect(received[0].conversation.type).toBe("channel");
    });

    it("emits error event via bot catch", () => {
      const errors: Error[] = [];
      adapter.on("error", (err: Error) => errors.push(err));

      expect(mockCatchHandler).toBeDefined();
      mockCatchHandler!(new Error("bot error"));

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe("bot error");
    });

    it("supports off to remove listeners", () => {
      const received: unknown[] = [];
      const handler = (msg: Message) => received.push(msg);
      adapter.on("message", handler);
      adapter.off("message", handler);

      const msgHandler = handlers.get("message");
      msgHandler!({
        message: {
          message_id: 60,
          from: { id: 789, is_bot: false, first_name: "Bob" },
          chat: { id: 42, type: "private" },
          date: 1700000000,
          text: "ignored",
        },
      });

      expect(received).toHaveLength(0);
    });

    it("does not crash on listener errors", () => {
      const errors: Error[] = [];
      adapter.on("error", (err: Error) => errors.push(err));
      adapter.on("message", () => {
        throw new Error("listener bug");
      });

      const msgHandler = handlers.get("message");
      msgHandler!({
        message: {
          message_id: 61,
          from: { id: 789, is_bot: false, first_name: "Bob" },
          chat: { id: 42, type: "private" },
          date: 1700000000,
          text: "hello",
        },
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe("listener bug");
    });
  });

  describe("interactions", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("sends reaction", async () => {
      const msg = makeMessage();
      await adapter.react(msg, "👍");
      expect(mockTelegram.setMessageReaction).toHaveBeenCalledWith(
        42,
        42,
        [{ type: "emoji", emoji: "👍" }],
      );
    });

    it("replies to a text message", async () => {
      const msg = makeMessage();
      const reply = await adapter.reply(msg, { type: "text", text: "replying" });
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
        42,
        "replying",
        { reply_parameters: { message_id: 42 } },
      );
    });

    it("forwards a message", async () => {
      const msg = makeMessage();
      const target = makeDmConversation("99");
      const forwarded = await adapter.forward(msg, target);
      expect(mockTelegram.forwardMessage).toHaveBeenCalledWith(99, 42, 42);
    });

    it("deletes a message", async () => {
      const msg = makeMessage();
      await adapter.delete(msg);
      expect(mockTelegram.deleteMessage).toHaveBeenCalledWith(42, 42);
    });
  });

  describe("presence", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("sends typing action", async () => {
      const conv = makeDmConversation("42");
      await adapter.setTyping(conv);
      expect(mockTelegram.sendChatAction).toHaveBeenCalledWith(42, "typing");
    });

    it("markRead is a no-op", async () => {
      // Should not throw
      await adapter.markRead(makeMessage());
    });
  });

  describe("conversations", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("getConversations returns empty (API limitation)", async () => {
      const convs = await adapter.getConversations();
      expect(convs).toEqual([]);
    });

    it("getMessages returns empty (API limitation)", async () => {
      const msgs = await adapter.getMessages(makeDmConversation());
      expect(msgs).toEqual([]);
    });
  });
});
