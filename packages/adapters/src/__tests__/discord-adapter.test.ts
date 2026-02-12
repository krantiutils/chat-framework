import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Conversation, Message } from "@chat-framework/core";

/**
 * Tests for DiscordAdapter.
 *
 * Mocks the discord.js Client to test the adapter's event routing,
 * message sending, and API methods without a real Discord connection.
 */

// ── Mock discord.js ─────────────────────────────────────────────────────────

// Capture event handlers registered by the adapter on the discord.js Client
const clientEventHandlers = new Map<string, ((...args: unknown[]) => void)[]>();
let mockIsReady = false;
const BOT_USER_ID = "BOT_USER_ID";

// Track channel.send() calls
let lastSendPayload: Record<string, unknown> | null = null;
let sendResult: Record<string, unknown> = {};

// Track channel.messages.fetch() calls
let lastMessagesFetchOptions: unknown = null;
let messagesFetchResult: Map<string, unknown> = new Map();

// Track channel.sendTyping() calls
let sendTypingCalled = false;

// Track message-level operations
let lastReactEmoji: string | null = null;
let lastReplyPayload: Record<string, unknown> | null = null;
let deleteMessageCalled = false;

// Guilds for getConversations
let mockGuilds = new Map<string, { id: string; channels: { fetch: () => Promise<Map<string, unknown>> } }>();

// Channels cache for DMs
let mockChannelsCache = new Map<string, { id: string; type: number }>();

function makeDiscordSentMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sent-msg-1",
    channel: {
      id: "ch-1",
      type: 0, // GuildText
      name: "general",
      guild: { id: "guild-1", name: "Test" },
      isTextBased: () => true,
      isThread: () => false,
    },
    author: {
      id: BOT_USER_ID,
      username: "testbot",
      displayName: "Test Bot",
      avatarURL: () => null,
      displayAvatarURL: () => null,
    },
    createdAt: new Date(1700000000000),
    content: "sent text",
    attachments: makeMockCollection([]),
    stickers: makeMockCollection([]),
    reactions: { cache: makeMockCollection([]) },
    reference: null,
    ...overrides,
  };
}

function makeMockCollection<V>(entries: [string, V][]): unknown {
  const map = new Map(entries);
  return {
    ...map,
    first: () => entries.length > 0 ? entries[0][1] : undefined,
    values: () => map.values(),
    size: entries.length,
    [Symbol.iterator]: () => map[Symbol.iterator](),
  };
}

function makeMockFetchedMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...makeDiscordSentMessage(),
    react: vi.fn(async (emoji: string) => {
      lastReactEmoji = emoji;
    }),
    reply: vi.fn(async (payload: Record<string, unknown>) => {
      lastReplyPayload = payload;
      return makeDiscordSentMessage({ content: "reply" });
    }),
    delete: vi.fn(async () => {
      deleteMessageCalled = true;
    }),
    ...overrides,
  };
}

vi.mock("discord.js", () => {
  return {
    Client: class MockClient {
      user = { id: BOT_USER_ID };
      guilds = { cache: mockGuilds };
      channels = {
        cache: mockChannelsCache,
        fetch: vi.fn(async (id: string) => {
          return {
            id,
            type: 0,
            name: "test-channel",
            guild: { id: "guild-1", name: "Test" },
            isTextBased: () => true,
            isSendable: () => true,
            isThread: () => false,
            send: vi.fn(async (payload: unknown) => {
              lastSendPayload = payload as Record<string, unknown>;
              return { ...sendResult, ...makeDiscordSentMessage() };
            }),
            sendTyping: vi.fn(async () => {
              sendTypingCalled = true;
            }),
            messages: {
              fetch: vi.fn(async (options: unknown) => {
                lastMessagesFetchOptions = options;
                // If options is a string (message ID), return a single message
                if (typeof options === "string") {
                  return makeMockFetchedMessage();
                }
                return messagesFetchResult;
              }),
              resolve: () => null,
            },
          };
        }),
      };
      rest = {
        on: vi.fn(),
      };

      on(event: string, handler: (...args: unknown[]) => void) {
        const handlers = clientEventHandlers.get(event) ?? [];
        handlers.push(handler);
        clientEventHandlers.set(event, handlers);
      }

      isReady() {
        return mockIsReady;
      }

      async login(_token: string) {
        mockIsReady = true;
        return _token;
      }

      destroy() {
        mockIsReady = false;
      }
    },
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 512,
      GuildMessageReactions: 1024,
      GuildMessageTyping: 2048,
      GuildPresences: 256,
      DirectMessages: 4096,
      DirectMessageReactions: 8192,
      DirectMessageTyping: 16384,
      MessageContent: 32768,
    },
    Partials: {
      Message: 0,
      Channel: 1,
      Reaction: 2,
      User: 3,
      GuildMember: 4,
    },
    ChannelType: {
      DM: 1,
      GroupDM: 3,
      GuildText: 0,
      GuildAnnouncement: 5,
      PublicThread: 11,
      PrivateThread: 12,
      GuildVoice: 2,
      GuildForum: 15,
    },
    AttachmentBuilder: class MockAttachmentBuilder {
      constructor(
        public data: unknown,
        public options: unknown,
      ) {}
    },
    SnowflakeUtil: {
      generate: vi.fn(({ timestamp }: { timestamp: number }) => {
        return BigInt((timestamp - 1420070400000) << 22);
      }),
    },
  };
});

// Import after mocks
const { DiscordAdapter } = await import("../discord/adapter.js");

// ── Test helpers ────────────────────────────────────────────────────────────

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "ch-1",
    platform: "discord",
    participants: [],
    type: "channel",
    metadata: {},
    ...overrides,
  };
}

function makeTestMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-123",
    conversation: makeConversation(),
    sender: { id: "user-1", platform: "discord" },
    timestamp: new Date(1700000000000),
    content: { type: "text", text: "test" },
    ...overrides,
  };
}

function fireClientEvent(event: string, ...args: unknown[]) {
  const handlers = clientEventHandlers.get(event) ?? [];
  for (const handler of handlers) {
    handler(...args);
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("DiscordAdapter", () => {
  let adapter: InstanceType<typeof DiscordAdapter>;

  beforeEach(() => {
    clientEventHandlers.clear();
    mockIsReady = false;
    lastSendPayload = null;
    lastMessagesFetchOptions = null;
    lastReactEmoji = null;
    lastReplyPayload = null;
    deleteMessageCalled = false;
    sendTypingCalled = false;
    sendResult = {};
    messagesFetchResult = new Map();
    mockGuilds = new Map();
    mockChannelsCache = new Map();
    adapter = new DiscordAdapter({ token: "test-token" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("connection lifecycle", () => {
    it("connects successfully", async () => {
      expect(adapter.isConnected()).toBe(false);
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
    });

    it("throws when connecting twice", async () => {
      await adapter.connect();
      await expect(adapter.connect()).rejects.toThrow("already connected");
    });

    it("disconnects cleanly", async () => {
      await adapter.connect();
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it("disconnect is idempotent", async () => {
      await adapter.disconnect(); // no-op, shouldn't throw
    });
  });

  describe("sending messages", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("sends text message", async () => {
      const conv = makeConversation();
      const msg = await adapter.sendText(conv, "hello discord");
      expect(lastSendPayload).toBeDefined();
      expect(lastSendPayload!.content).toBe("hello discord");
      expect(msg.sender.platform).toBe("discord");
    });

    it("sends image with caption", async () => {
      const conv = makeConversation();
      const msg = await adapter.sendImage(conv, "/path/to/img.png", "nice photo");
      expect(lastSendPayload!.content).toBe("nice photo");
      expect(lastSendPayload!.files).toHaveLength(1);
      expect(msg.id).toBeDefined();
    });

    it("sends image without caption", async () => {
      const conv = makeConversation();
      await adapter.sendImage(conv, Buffer.from("fake"), undefined);
      expect(lastSendPayload!.content).toBeUndefined();
      expect(lastSendPayload!.files).toHaveLength(1);
    });

    it("sends audio", async () => {
      const conv = makeConversation();
      await adapter.sendAudio(conv, "/path/to/audio.mp3");
      expect(lastSendPayload!.files).toHaveLength(1);
    });

    it("sends voice (delegates to sendAudio)", async () => {
      const conv = makeConversation();
      const msg = await adapter.sendVoice(conv, "/path/to/voice.ogg");
      expect(msg.id).toBeDefined();
      expect(lastSendPayload!.files).toHaveLength(1);
    });

    it("sends file", async () => {
      const conv = makeConversation();
      await adapter.sendFile(conv, "/path/to/doc.pdf", "doc.pdf");
      expect(lastSendPayload!.files).toHaveLength(1);
    });

    it("sends location as embed", async () => {
      const conv = makeConversation();
      const msg = await adapter.sendLocation(conv, 40.7128, -74.006);
      expect(lastSendPayload!.embeds).toBeDefined();
      const embeds = lastSendPayload!.embeds as { title: string; url: string }[];
      expect(embeds).toHaveLength(1);
      expect(embeds[0].title).toBe("Location");
      expect(embeds[0].url).toContain("40.7128");
      expect(embeds[0].url).toContain("-74.006");
      expect(msg.content.type).toBe("location");
      if (msg.content.type === "location") {
        expect(msg.content.lat).toBe(40.7128);
        expect(msg.content.lng).toBe(-74.006);
      }
    });

    it("throws when not connected", async () => {
      await adapter.disconnect();
      await expect(adapter.sendText(makeConversation(), "hi")).rejects.toThrow(
        "not connected",
      );
    });
  });

  describe("event handling", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("emits message event on incoming messageCreate", () => {
      const received: Message[] = [];
      adapter.on("message", (msg) => received.push(msg));

      const discordMsg = {
        id: "incoming-1",
        channel: {
          id: "ch-1",
          type: 0,
          name: "general",
          guild: { id: "guild-1", name: "Test" },
          isTextBased: () => true,
          isThread: () => false,
        },
        author: {
          id: "user-456",
          username: "bob",
          displayName: "Bob",
          avatarURL: () => null,
          displayAvatarURL: () => null,
        },
        guild: null,
        createdAt: new Date(1700000000000),
        content: "hello from discord",
        attachments: makeMockCollection([]),
        stickers: makeMockCollection([]),
        reactions: { cache: makeMockCollection([]) },
        reference: null,
      };

      fireClientEvent("messageCreate", discordMsg);

      expect(received).toHaveLength(1);
      expect(received[0].content).toEqual({
        type: "text",
        text: "hello from discord",
      });
      expect(received[0].sender.id).toBe("user-456");
    });

    it("skips messages from the bot itself", () => {
      const received: Message[] = [];
      adapter.on("message", (msg) => received.push(msg));

      fireClientEvent("messageCreate", {
        ...makeDiscordSentMessage(),
        author: {
          id: BOT_USER_ID,
          username: "bot",
          displayName: "Bot",
          avatarURL: () => null,
          displayAvatarURL: () => null,
        },
        guild: null,
      });

      expect(received).toHaveLength(0);
    });

    it("filters messages by guildFilter", async () => {
      await adapter.disconnect();
      adapter = new DiscordAdapter({
        token: "test-token",
        guildFilter: ["guild-allowed"],
      });
      await adapter.connect();

      const received: Message[] = [];
      adapter.on("message", (msg) => received.push(msg));

      // Message from blocked guild
      fireClientEvent("messageCreate", {
        ...makeDiscordSentMessage(),
        author: { id: "other-user", username: "x", displayName: "X", avatarURL: () => null, displayAvatarURL: () => null },
        guild: { id: "guild-blocked" },
      });

      expect(received).toHaveLength(0);
    });

    it("emits typing event", () => {
      const typingEvents: Array<{ user: unknown; conv: unknown }> = [];
      adapter.on("typing", (user, conv) => typingEvents.push({ user, conv }));

      fireClientEvent("typingStart", {
        user: {
          id: "user-789",
          username: "charlie",
          displayName: "Charlie",
          avatarURL: () => null,
          displayAvatarURL: () => null,
        },
        channel: {
          id: "ch-1",
          type: 0,
          name: "general",
          guild: { id: "guild-1", name: "Test" },
          isTextBased: () => true,
          isThread: () => false,
        },
      });

      expect(typingEvents).toHaveLength(1);
    });

    it("skips typing from the bot itself", () => {
      const typingEvents: unknown[] = [];
      adapter.on("typing", () => typingEvents.push(1));

      fireClientEvent("typingStart", {
        user: { id: BOT_USER_ID, username: "bot", displayName: "Bot", avatarURL: () => null, displayAvatarURL: () => null },
        channel: { id: "ch-1", type: 0, isTextBased: () => true, isThread: () => false },
      });

      expect(typingEvents).toHaveLength(0);
    });

    it("emits presence event", () => {
      const presenceEvents: Array<{ user: unknown; status: unknown }> = [];
      adapter.on("presence", (user, status) =>
        presenceEvents.push({ user, status }),
      );

      fireClientEvent("presenceUpdate", null, {
        user: {
          id: "user-100",
          username: "dan",
          displayName: "Dan",
          avatarURL: () => null,
          displayAvatarURL: () => null,
        },
        status: "online",
      });

      expect(presenceEvents).toHaveLength(1);
      expect(presenceEvents[0].status).toBe("online");
    });

    it("maps offline presence", () => {
      const presenceEvents: Array<{ status: unknown }> = [];
      adapter.on("presence", (_user, status) =>
        presenceEvents.push({ status }),
      );

      fireClientEvent("presenceUpdate", null, {
        user: { id: "user-100", username: "dan", displayName: "Dan", avatarURL: () => null, displayAvatarURL: () => null },
        status: "offline",
      });

      expect(presenceEvents[0].status).toBe("offline");
    });

    it("emits error event from discord.js errors", () => {
      const errors: Error[] = [];
      adapter.on("error", (err) => errors.push(err));

      fireClientEvent("error", new Error("gateway disconnected"));

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe("gateway disconnected");
    });

    it("emits error event from discord.js warnings", () => {
      const errors: Error[] = [];
      adapter.on("error", (err) => errors.push(err));

      fireClientEvent("warn", "Rate limit approaching");

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("Rate limit approaching");
    });

    it("supports off to remove listeners", () => {
      const received: unknown[] = [];
      const handler = (msg: Message) => received.push(msg);
      adapter.on("message", handler);
      adapter.off("message", handler);

      fireClientEvent("messageCreate", {
        ...makeDiscordSentMessage(),
        author: { id: "other", username: "x", displayName: "X", avatarURL: () => null, displayAvatarURL: () => null },
        guild: null,
      });

      expect(received).toHaveLength(0);
    });

    it("does not crash on listener errors", () => {
      const errors: Error[] = [];
      adapter.on("error", (err) => errors.push(err));
      adapter.on("message", () => {
        throw new Error("listener bug");
      });

      fireClientEvent("messageCreate", {
        ...makeDiscordSentMessage(),
        author: { id: "other", username: "x", displayName: "X", avatarURL: () => null, displayAvatarURL: () => null },
        guild: null,
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
      const msg = makeTestMessage();
      await adapter.react(msg, "❤️");
      expect(lastReactEmoji).toBe("❤️");
    });

    it("replies to a message", async () => {
      const msg = makeTestMessage();
      const reply = await adapter.reply(msg, {
        type: "text",
        text: "replying",
      });
      expect(lastReplyPayload).toBeDefined();
      expect(reply.id).toBeDefined();
    });

    it("forwards a text message", async () => {
      const msg = makeTestMessage();
      const target = makeConversation({ id: "ch-2" });
      const forwarded = await adapter.forward(msg, target);
      expect(forwarded.id).toBeDefined();
      expect(lastSendPayload!.content).toBe("test");
    });

    it("forwards a non-text message as label", async () => {
      const msg = makeTestMessage({
        content: { type: "image", url: "http://example.com/img.png" },
      });
      const target = makeConversation({ id: "ch-2" });
      await adapter.forward(msg, target);
      expect(lastSendPayload!.content).toContain("[Forwarded]");
      expect(lastSendPayload!.content).toContain("image");
    });

    it("deletes a message", async () => {
      const msg = makeTestMessage();
      await adapter.delete(msg);
      expect(deleteMessageCalled).toBe(true);
    });
  });

  describe("presence", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("sends typing indicator", async () => {
      const conv = makeConversation();
      await adapter.setTyping(conv);
      expect(sendTypingCalled).toBe(true);
    });

    it("markRead is a no-op", async () => {
      const msg = makeTestMessage();
      // Should not throw
      await adapter.markRead(msg);
    });
  });

  describe("conversations", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("returns empty when no guilds or DMs", async () => {
      const convs = await adapter.getConversations();
      expect(convs).toEqual([]);
    });

    it("fetches messages with limit", async () => {
      const sentMsg = makeDiscordSentMessage({ id: "hist-1", content: "old" });
      messagesFetchResult = new Map([["hist-1", sentMsg]]);

      const conv = makeConversation();
      const msgs = await adapter.getMessages(conv, 10);
      expect(lastMessagesFetchOptions).toEqual({ limit: 10 });
      expect(msgs).toHaveLength(1);
    });

    it("fetches messages with before date", async () => {
      const conv = makeConversation();
      const before = new Date(1700000000000);
      await adapter.getMessages(conv, 25, before);
      expect(lastMessagesFetchOptions).toHaveProperty("before");
      expect(lastMessagesFetchOptions).toHaveProperty("limit", 25);
    });
  });
});
