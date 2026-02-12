import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Conversation, Message } from "@chat-framework/core";
import type {
  BaileysEventMap,
  ConnectionState,
  WAMessage,
} from "@whiskeysockets/baileys";

/**
 * Tests for WhatsAppAdapter.
 *
 * Mocks the Baileys makeWASocket function to test the adapter's message routing,
 * event emission, and API methods without requiring a real WhatsApp connection.
 */

// ── Mock Baileys Socket ──────────────────────────────────────────────────────

// Store event handlers registered by the adapter
const eventHandlers = new Map<string, Set<(...args: unknown[]) => void>>();

// Track sendMessage calls
let lastSendJid: string | null = null;
let lastSendContent: unknown = null;
let lastSendOptions: unknown = null;
let sendResult: WAMessage | undefined = {
  key: { remoteJid: "15559876543@s.whatsapp.net", fromMe: true, id: "SENT_001" },
  messageTimestamp: 1700000000,
  message: { conversation: "" },
};

// Track other method calls
let lastGroupFetchResult: Record<string, unknown> = {};

function emitBaileysEvent<K extends keyof BaileysEventMap>(
  event: K,
  data: BaileysEventMap[K],
): void {
  const handlers = eventHandlers.get(event);
  if (handlers) {
    for (const handler of handlers) {
      handler(data);
    }
  }
}

const mockSocket = {
  user: { id: "15551234567@s.whatsapp.net", name: "Test" },
  ev: {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      let set = eventHandlers.get(event);
      if (!set) {
        set = new Set();
        eventHandlers.set(event, set);
      }
      set.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      eventHandlers.get(event)?.delete(handler);
    }),
    removeAllListeners: vi.fn((event: string) => {
      eventHandlers.delete(event);
    }),
  },
  sendMessage: vi.fn(async (jid: string, content: unknown, options?: unknown) => {
    lastSendJid = jid;
    lastSendContent = content;
    lastSendOptions = options;
    return sendResult;
  }),
  sendPresenceUpdate: vi.fn(async () => {}),
  readMessages: vi.fn(async () => {}),
  groupFetchAllParticipating: vi.fn(async () => lastGroupFetchResult),
  end: vi.fn(),
};

// Mock the makeWASocket default export
vi.mock("@whiskeysockets/baileys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@whiskeysockets/baileys")>();
  return {
    ...actual,
    default: vi.fn(() => mockSocket),
    // Re-export named exports
    DisconnectReason: actual.DisconnectReason,
    isJidGroup: actual.isJidGroup,
  };
});

// Import after mocks
const { WhatsAppAdapter } = await import("../whatsapp/adapter.js");
const { DisconnectReason } = await import("@whiskeysockets/baileys");

const SELF_JID = "15551234567@s.whatsapp.net";
const PEER_JID = "15559876543@s.whatsapp.net";
const GROUP_JID = "120363012345678901@g.us";

function makeAuth() {
  return {
    creds: {} as never,
    keys: {} as never,
  };
}

function makeDmConversation(peerId: string = PEER_JID): Conversation {
  return {
    id: peerId,
    platform: "whatsapp",
    participants: [],
    type: "dm",
    metadata: {},
  };
}

function makeGroupConversation(groupId: string = GROUP_JID): Conversation {
  return {
    id: groupId,
    platform: "whatsapp",
    participants: [],
    type: "group",
    metadata: {},
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "MSG_001",
    conversation: makeDmConversation(),
    sender: { id: PEER_JID, platform: "whatsapp" },
    timestamp: new Date(1700000000000),
    content: { type: "text", text: "test" },
    ...overrides,
  };
}

/** Simulate connection.update "open" event that connect() waits for. */
function simulateConnected(): void {
  emitBaileysEvent("connection.update", { connection: "open" } as Partial<ConnectionState>);
}

describe("WhatsAppAdapter", () => {
  let adapter: InstanceType<typeof WhatsAppAdapter>;

  beforeEach(() => {
    eventHandlers.clear();
    lastSendJid = null;
    lastSendContent = null;
    lastSendOptions = null;
    lastGroupFetchResult = {};
    sendResult = {
      key: { remoteJid: PEER_JID, fromMe: true, id: "SENT_001" },
      messageTimestamp: 1700000000,
      message: { conversation: "" },
    };
    vi.clearAllMocks();
    adapter = new WhatsAppAdapter({ auth: makeAuth() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Connection Lifecycle ─────────────────────────────────────────────────

  describe("connection lifecycle", () => {
    it("connects successfully", async () => {
      expect(adapter.isConnected()).toBe(false);
      const connectPromise = adapter.connect();
      // Simulate Baileys emitting connection open
      simulateConnected();
      await connectPromise;
      expect(adapter.isConnected()).toBe(true);
    });

    it("throws when connecting twice", async () => {
      const p = adapter.connect();
      simulateConnected();
      await p;

      await expect(adapter.connect()).rejects.toThrow("already connected");
    });

    it("disconnects cleanly", async () => {
      const p = adapter.connect();
      simulateConnected();
      await p;

      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it("disconnect is idempotent", async () => {
      await adapter.disconnect(); // no-op, shouldn't throw
    });

    it("times out if connection never opens", async () => {
      const adapter2 = new WhatsAppAdapter({
        auth: makeAuth(),
        connectTimeoutMs: 50,
      });
      await expect(adapter2.connect()).rejects.toThrow("timed out");
    });

    it("rejects connect on logout during connection", async () => {
      const connectPromise = adapter.connect();
      emitBaileysEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: { output: { statusCode: DisconnectReason.loggedOut } } as never,
          date: new Date(),
        },
      } as Partial<ConnectionState>);
      await expect(connectPromise).rejects.toThrow("logged out");
    });
  });

  // ── Sending Messages ────────────────────────────────────────────────────

  describe("sending messages", () => {
    beforeEach(async () => {
      const p = adapter.connect();
      simulateConnected();
      await p;
    });

    it("sends text to DM", async () => {
      const conv = makeDmConversation();
      sendResult = {
        key: { remoteJid: PEER_JID, fromMe: true, id: "SENT_TEXT" },
        messageTimestamp: 1700000000,
        message: { conversation: "hello" },
      };

      const msg = await adapter.sendText(conv, "hello");
      expect(lastSendJid).toBe(PEER_JID);
      expect(lastSendContent).toEqual({ text: "hello" });
      expect(msg.sender.id).toBe(SELF_JID);
    });

    it("sends text to group", async () => {
      const conv = makeGroupConversation();
      await adapter.sendText(conv, "hello group");
      expect(lastSendJid).toBe(GROUP_JID);
      expect(lastSendContent).toEqual({ text: "hello group" });
    });

    it("sends image with caption (string path)", async () => {
      const conv = makeDmConversation();
      await adapter.sendImage(conv, "/path/to/img.jpg", "a photo");
      expect(lastSendContent).toEqual({
        image: { url: "/path/to/img.jpg" },
        caption: "a photo",
      });
    });

    it("sends image with Buffer", async () => {
      const conv = makeDmConversation();
      const buf = Buffer.from("fake-image");
      await adapter.sendImage(conv, buf, "caption");
      expect(lastSendContent).toEqual({ image: buf, caption: "caption" });
    });

    it("sends audio", async () => {
      const conv = makeDmConversation();
      await adapter.sendAudio(conv, "/path/to/audio.mp3");
      expect(lastSendContent).toEqual({
        audio: { url: "/path/to/audio.mp3" },
        ptt: false,
      });
    });

    it("sends voice note (ptt)", async () => {
      const conv = makeDmConversation();
      await adapter.sendVoice(conv, "/path/to/voice.ogg");
      expect(lastSendContent).toEqual({
        audio: { url: "/path/to/voice.ogg" },
        ptt: true,
      });
    });

    it("sends file", async () => {
      const conv = makeDmConversation();
      await adapter.sendFile(conv, "/path/to/doc.pdf", "doc.pdf");
      expect(lastSendContent).toEqual({
        document: { url: "/path/to/doc.pdf" },
        mimetype: "application/octet-stream",
        fileName: "doc.pdf",
      });
    });

    it("sends location", async () => {
      const conv = makeDmConversation();
      await adapter.sendLocation(conv, 40.7128, -74.006);
      expect(lastSendContent).toEqual({
        location: { degreesLatitude: 40.7128, degreesLongitude: -74.006 },
      });
    });

    it("throws when not connected", async () => {
      await adapter.disconnect();
      await expect(
        adapter.sendText(makeDmConversation(), "hi"),
      ).rejects.toThrow("not connected");
    });
  });

  // ── Event Handling ──────────────────────────────────────────────────────

  describe("event handling", () => {
    beforeEach(async () => {
      const p = adapter.connect();
      simulateConnected();
      await p;
    });

    it("emits message event on incoming text", () => {
      const received: Message[] = [];
      adapter.on("message", (msg) => received.push(msg));

      emitBaileysEvent("messages.upsert", {
        messages: [
          {
            key: { remoteJid: PEER_JID, fromMe: false, id: "IN_001" },
            messageTimestamp: 1700000000,
            pushName: "Alice",
            message: { conversation: "hello" },
          },
        ],
        type: "notify",
      });

      expect(received).toHaveLength(1);
      expect(received[0].content).toEqual({ type: "text", text: "hello" });
      expect(received[0].sender.displayName).toBe("Alice");
    });

    it("does not emit for history sync messages (type: append)", () => {
      const received: Message[] = [];
      adapter.on("message", (msg) => received.push(msg));

      emitBaileysEvent("messages.upsert", {
        messages: [
          {
            key: { remoteJid: PEER_JID, fromMe: false, id: "HIST_001" },
            messageTimestamp: 1700000000,
            message: { conversation: "old message" },
          },
        ],
        type: "append",
      });

      expect(received).toHaveLength(0);
    });

    it("skips status broadcast messages", () => {
      const received: Message[] = [];
      adapter.on("message", (msg) => received.push(msg));

      emitBaileysEvent("messages.upsert", {
        messages: [
          {
            key: { remoteJid: "status@broadcast", fromMe: false, id: "STATUS_001" },
            messageTimestamp: 1700000000,
            message: { conversation: "status update" },
          },
        ],
        type: "notify",
      });

      expect(received).toHaveLength(0);
    });

    it("emits typing event on composing presence", () => {
      const typingEvents: Array<{ user: unknown; conv: unknown }> = [];
      adapter.on("typing", (user, conv) => typingEvents.push({ user, conv }));

      emitBaileysEvent("presence.update", {
        id: PEER_JID,
        presences: {
          [PEER_JID]: { lastKnownPresence: "composing" },
        },
      });

      expect(typingEvents).toHaveLength(1);
    });

    it("emits typing event on recording presence", () => {
      const typingEvents: unknown[] = [];
      adapter.on("typing", () => typingEvents.push(1));

      emitBaileysEvent("presence.update", {
        id: PEER_JID,
        presences: {
          [PEER_JID]: { lastKnownPresence: "recording" },
        },
      });

      expect(typingEvents).toHaveLength(1);
    });

    it("emits presence online/offline", () => {
      const presenceEvents: Array<{ user: unknown; status: string }> = [];
      adapter.on("presence", (user, status) => presenceEvents.push({ user, status }));

      emitBaileysEvent("presence.update", {
        id: PEER_JID,
        presences: {
          [PEER_JID]: { lastKnownPresence: "available" },
        },
      });

      emitBaileysEvent("presence.update", {
        id: PEER_JID,
        presences: {
          [PEER_JID]: { lastKnownPresence: "unavailable" },
        },
      });

      expect(presenceEvents).toHaveLength(2);
      expect(presenceEvents[0].status).toBe("online");
      expect(presenceEvents[1].status).toBe("offline");
    });

    it("emits reaction event", () => {
      const reactions: Array<{ reaction: unknown; msg: unknown }> = [];
      adapter.on("reaction", (reaction, msg) => reactions.push({ reaction, msg }));

      emitBaileysEvent("messages.reaction", [
        {
          key: { remoteJid: PEER_JID, fromMe: true, id: "TARGET_001" },
          reaction: {
            key: { remoteJid: PEER_JID, participant: PEER_JID },
            text: "👍",
            senderTimestampMs: 1700000000000 as unknown as import("long").default,
          },
        },
      ]);

      expect(reactions).toHaveLength(1);
    });

    it("emits read event for read receipts", () => {
      const reads: unknown[] = [];
      adapter.on("read", (user, msg) => reads.push({ user, msg }));

      emitBaileysEvent("message-receipt.update", [
        {
          key: { remoteJid: PEER_JID, fromMe: true, id: "READ_001" },
          receipt: {
            userJid: PEER_JID,
            readTimestamp: 1700000001 as unknown as import("long").default,
          },
        },
      ]);

      expect(reads).toHaveLength(1);
    });

    it("does not emit read event without readTimestamp", () => {
      const reads: unknown[] = [];
      adapter.on("read", (user, msg) => reads.push({ user, msg }));

      emitBaileysEvent("message-receipt.update", [
        {
          key: { remoteJid: PEER_JID, fromMe: true, id: "DELIV_001" },
          receipt: {
            userJid: PEER_JID,
            // No readTimestamp — this is a delivery receipt
          },
        },
      ]);

      expect(reads).toHaveLength(0);
    });

    it("emits error event from connection close", () => {
      const errors: Error[] = [];
      adapter.on("error", (err) => errors.push(err));

      emitBaileysEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: { output: { statusCode: 408 } } as never,
          date: new Date(),
        },
      } as Partial<ConnectionState>);

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("408");
    });

    it("supports off to remove listeners", () => {
      const received: unknown[] = [];
      const handler = (msg: Message) => received.push(msg);
      adapter.on("message", handler);
      adapter.off("message", handler);

      emitBaileysEvent("messages.upsert", {
        messages: [
          {
            key: { remoteJid: PEER_JID, fromMe: false, id: "IGN_001" },
            messageTimestamp: 1700000000,
            message: { conversation: "ignored" },
          },
        ],
        type: "notify",
      });

      expect(received).toHaveLength(0);
    });

    it("does not crash on listener errors", () => {
      const errors: Error[] = [];
      adapter.on("error", (err) => errors.push(err));
      adapter.on("message", () => {
        throw new Error("listener bug");
      });

      emitBaileysEvent("messages.upsert", {
        messages: [
          {
            key: { remoteJid: PEER_JID, fromMe: false, id: "ERR_001" },
            messageTimestamp: 1700000000,
            message: { conversation: "trigger error" },
          },
        ],
        type: "notify",
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe("listener bug");
    });
  });

  // ── Interactions ────────────────────────────────────────────────────────

  describe("interactions", () => {
    beforeEach(async () => {
      const p = adapter.connect();
      simulateConnected();
      await p;
    });

    it("sends reaction", async () => {
      const msg = makeMessage();
      await adapter.react(msg, "❤️");
      expect(mockSocket.sendMessage).toHaveBeenCalledWith(
        PEER_JID,
        expect.objectContaining({
          react: expect.objectContaining({
            text: "❤️",
            key: expect.objectContaining({
              remoteJid: PEER_JID,
              id: "MSG_001",
            }),
          }),
        }),
      );
    });

    it("replies to a message", async () => {
      const msg = makeMessage();
      await adapter.reply(msg, { type: "text", text: "replying" });
      expect(lastSendJid).toBe(PEER_JID);
      expect(lastSendContent).toEqual({ text: "replying" });
      expect(lastSendOptions).toHaveProperty("quoted");
    });

    it("forwards a text message", async () => {
      const msg = makeMessage();
      const target = makeDmConversation("15550000000@s.whatsapp.net");
      await adapter.forward(msg, target);
      expect(lastSendJid).toBe("15550000000@s.whatsapp.net");
      expect(lastSendContent).toEqual({ text: "test" });
    });

    it("deletes a DM message", async () => {
      const msg = makeMessage();
      await adapter.delete(msg);
      expect(mockSocket.sendMessage).toHaveBeenCalledWith(
        PEER_JID,
        expect.objectContaining({
          delete: expect.objectContaining({
            remoteJid: PEER_JID,
            id: "MSG_001",
          }),
        }),
      );
    });

    it("deletes a group message with participant", async () => {
      const msg = makeMessage({
        conversation: makeGroupConversation(),
        sender: { id: PEER_JID, platform: "whatsapp" },
      });
      await adapter.delete(msg);
      expect(mockSocket.sendMessage).toHaveBeenCalledWith(
        GROUP_JID,
        expect.objectContaining({
          delete: expect.objectContaining({
            remoteJid: GROUP_JID,
            participant: PEER_JID,
          }),
        }),
      );
    });
  });

  // ── Presence ────────────────────────────────────────────────────────────

  describe("presence", () => {
    beforeEach(async () => {
      const p = adapter.connect();
      simulateConnected();
      await p;
    });

    it("sends typing indicator", async () => {
      const conv = makeDmConversation();
      await adapter.setTyping(conv);
      expect(mockSocket.sendPresenceUpdate).toHaveBeenCalledWith("composing", PEER_JID);
    });

    it("marks message as read", async () => {
      const msg = makeMessage();
      await adapter.markRead(msg);
      expect(mockSocket.readMessages).toHaveBeenCalledWith([
        expect.objectContaining({
          remoteJid: PEER_JID,
          id: "MSG_001",
        }),
      ]);
    });
  });

  // ── Conversations ───────────────────────────────────────────────────────

  describe("conversations", () => {
    beforeEach(async () => {
      const p = adapter.connect();
      simulateConnected();
      await p;
    });

    it("lists groups", async () => {
      lastGroupFetchResult = {
        [GROUP_JID]: {
          id: GROUP_JID,
          subject: "Family Chat",
          owner: SELF_JID,
          participants: [
            { id: SELF_JID, notify: "Me" },
            { id: PEER_JID, notify: "Alice" },
          ],
        },
      };

      const convs = await adapter.getConversations();
      expect(convs).toHaveLength(1);
      expect(convs[0].id).toBe(GROUP_JID);
      expect(convs[0].type).toBe("group");
      expect(convs[0].metadata.subject).toBe("Family Chat");
      expect(convs[0].participants).toHaveLength(2);
    });

    it("returns empty array for getMessages (unsupported)", async () => {
      const msgs = await adapter.getMessages(makeDmConversation());
      expect(msgs).toEqual([]);
    });
  });

  // ── Credential Saving ──────────────────────────────────────────────────

  describe("credential saving", () => {
    it("calls saveCreds on creds.update event", async () => {
      const saveCreds = vi.fn(async () => {});
      const adapterWithSave = new WhatsAppAdapter({
        auth: makeAuth(),
        saveCreds,
      });

      const p = adapterWithSave.connect();
      simulateConnected();
      await p;

      emitBaileysEvent("creds.update", {} as never);
      expect(saveCreds).toHaveBeenCalled();
    });

    it("emits error if saveCreds throws", async () => {
      const saveCreds = vi.fn(async () => {
        throw new Error("save failed");
      });
      const adapterWithSave = new WhatsAppAdapter({
        auth: makeAuth(),
        saveCreds,
      });

      const errors: Error[] = [];
      adapterWithSave.on("error", (err) => errors.push(err));

      const p = adapterWithSave.connect();
      simulateConnected();
      await p;

      emitBaileysEvent("creds.update", {} as never);

      // Wait for the async rejection to propagate
      await vi.waitFor(() => {
        expect(errors).toHaveLength(1);
      });
      expect(errors[0].message).toContain("save failed");
    });
  });
});
