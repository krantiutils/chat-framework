import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SignalAdapterConfig, SignalEnvelope } from "../signal/types.js";
import type { Conversation, Message } from "@chat-framework/core";

/**
 * Tests for SignalAdapter.
 *
 * Mocks the SignalCliProcess to test the adapter's message routing,
 * event emission, and API methods without requiring signal-cli.
 */

// Mock fs/os/crypto for the temp file handling
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(async () => {}),
  mkdtemp: vi.fn(async () => "/tmp/signal-adapter-test"),
  rm: vi.fn(async () => {}),
}));

// Capture the envelope and error callbacks registered by the adapter
let envelopeCb: ((env: SignalEnvelope) => void) | null = null;
let errorCb: ((err: Error) => void) | null = null;
let mockRunning = false;
let lastRequest: { method: string; params?: Record<string, unknown> } | null = null;
let requestResult: unknown = { timestamp: Date.now() };

vi.mock("../signal/process.js", () => {
  return {
    SignalCliProcess: class MockSignalCliProcess {
      onEnvelope(cb: (env: SignalEnvelope) => void) {
        envelopeCb = cb;
      }
      onError(cb: (err: Error) => void) {
        errorCb = cb;
      }
      get running() {
        return mockRunning;
      }
      start() {
        mockRunning = true;
      }
      async stop() {
        mockRunning = false;
      }
      async request(method: string, params?: Record<string, unknown>) {
        lastRequest = { method, params };
        return requestResult;
      }
    },
  };
});

// Import after mocks are set up
const { SignalAdapter } = await import("../signal/adapter.js");

const CONFIG: SignalAdapterConfig = {
  phoneNumber: "+15551234567",
  dataDir: "/tmp/signal-data",
};

const SELF = "+15551234567";
const PEER = "+15559876543";

function makeDmConversation(peerId: string = PEER): Conversation {
  return {
    id: peerId,
    platform: "signal",
    participants: [],
    type: "dm",
    metadata: {},
  };
}

function makeGroupConversation(groupId: string = "grp-1"): Conversation {
  return {
    id: groupId,
    platform: "signal",
    participants: [],
    type: "group",
    metadata: {},
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "12345",
    conversation: makeDmConversation(),
    sender: { id: PEER, platform: "signal" },
    timestamp: new Date(1700000000000),
    content: { type: "text", text: "test" },
    ...overrides,
  };
}

describe("SignalAdapter", () => {
  let adapter: SignalAdapter;

  beforeEach(() => {
    envelopeCb = null;
    errorCb = null;
    mockRunning = false;
    lastRequest = null;
    requestResult = { timestamp: 1700000000000 };
    adapter = new SignalAdapter(CONFIG);
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

    it("sends text to DM", async () => {
      const conv = makeDmConversation();
      const msg = await adapter.sendText(conv, "hello");
      expect(lastRequest!.method).toBe("send");
      expect(lastRequest!.params).toEqual({
        recipient: [PEER],
        message: "hello",
      });
      expect(msg.content).toEqual({ type: "text", text: "hello" });
      expect(msg.sender.id).toBe(SELF);
    });

    it("sends text to group", async () => {
      const conv = makeGroupConversation("grp-1");
      await adapter.sendText(conv, "hello group");
      expect(lastRequest!.params).toEqual({
        groupId: "grp-1",
        message: "hello group",
      });
    });

    it("sends image with caption", async () => {
      const conv = makeDmConversation();
      const msg = await adapter.sendImage(conv, "/path/to/img.jpg", "photo");
      expect(lastRequest!.method).toBe("send");
      expect(lastRequest!.params!.message).toBe("photo");
      expect(lastRequest!.params!.attachments).toEqual(["/path/to/img.jpg"]);
      expect(msg.content.type).toBe("image");
    });

    it("sends audio", async () => {
      const conv = makeDmConversation();
      const msg = await adapter.sendAudio(conv, "/path/to/audio.mp3");
      expect(msg.content.type).toBe("audio");
      expect(lastRequest!.params!.attachments).toEqual(["/path/to/audio.mp3"]);
    });

    it("sends voice", async () => {
      const conv = makeDmConversation();
      const msg = await adapter.sendVoice(conv, "/path/to/voice.ogg");
      expect(msg.content.type).toBe("voice");
    });

    it("sends file", async () => {
      const conv = makeDmConversation();
      const msg = await adapter.sendFile(conv, "/path/to/doc.pdf", "doc.pdf");
      expect(msg.content.type).toBe("file");
      if (msg.content.type === "file") {
        expect(msg.content.filename).toBe("doc.pdf");
      }
    });

    it("sends location as maps link", async () => {
      const conv = makeDmConversation();
      const msg = await adapter.sendLocation(conv, 40.7128, -74.006);
      expect(msg.content.type).toBe("location");
      expect(lastRequest!.params!.message).toContain("maps.google.com");
      expect(lastRequest!.params!.message).toContain("40.7128");
    });

    it("sends image with Buffer attachment (writes to temp file)", async () => {
      const conv = makeDmConversation();
      const buf = Buffer.from("fake-image-data");
      await adapter.sendImage(conv, buf, "caption");
      // Buffer should be written to a temp file, not sent as base64
      const attachments = lastRequest!.params!.attachments as string[];
      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toMatch(/^\/tmp\/signal-adapter-test\//);
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
      adapter.on("message", (msg) => received.push(msg));

      envelopeCb!({
        sourceNumber: PEER,
        sourceName: "Alice",
        timestamp: 1700000000000,
        dataMessage: {
          timestamp: 1700000000000,
          message: "hello",
        },
      });

      expect(received).toHaveLength(1);
      expect(received[0].content).toEqual({ type: "text", text: "hello" });
      expect(received[0].sender.displayName).toBe("Alice");
    });

    it("emits typing event", () => {
      const typingEvents: Array<{ user: unknown; conv: unknown }> = [];
      adapter.on("typing", (user, conv) =>
        typingEvents.push({ user, conv }),
      );

      envelopeCb!({
        sourceNumber: PEER,
        typingMessage: { action: "STARTED", timestamp: 123 },
      });

      expect(typingEvents).toHaveLength(1);
    });

    it("does not emit typing for STOPPED action", () => {
      const typingEvents: unknown[] = [];
      adapter.on("typing", () => typingEvents.push(1));

      envelopeCb!({
        sourceNumber: PEER,
        typingMessage: { action: "STOPPED", timestamp: 123 },
      });

      expect(typingEvents).toHaveLength(0);
    });

    it("emits reaction event", () => {
      const reactions: Array<{ reaction: unknown; msg: unknown }> = [];
      adapter.on("reaction", (reaction, msg) =>
        reactions.push({ reaction, msg }),
      );

      envelopeCb!({
        sourceNumber: PEER,
        timestamp: 1700000000000,
        dataMessage: {
          reaction: {
            emoji: "👍",
            targetAuthorNumber: SELF,
            targetSentTimestamp: 1699999999999,
          },
        },
      });

      expect(reactions).toHaveLength(1);
    });

    it("emits read event for read receipts", () => {
      const reads: unknown[] = [];
      adapter.on("read", (user, msg) => reads.push({ user, msg }));

      envelopeCb!({
        sourceNumber: PEER,
        receiptMessage: {
          type: "READ",
          timestamps: [1700000000000, 1700000000001],
        },
      });

      expect(reads).toHaveLength(2);
    });

    it("emits error event from process errors", () => {
      const errors: Error[] = [];
      adapter.on("error", (err) => errors.push(err));

      errorCb!(new Error("process crashed"));

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe("process crashed");
    });

    it("supports off to remove listeners", () => {
      const received: unknown[] = [];
      const handler = (msg: Message) => received.push(msg);
      adapter.on("message", handler);
      adapter.off("message", handler);

      envelopeCb!({
        sourceNumber: PEER,
        timestamp: 123,
        dataMessage: { timestamp: 123, message: "ignored" },
      });

      expect(received).toHaveLength(0);
    });

    it("does not crash on listener errors", () => {
      const errors: Error[] = [];
      adapter.on("error", (err) => errors.push(err));
      adapter.on("message", () => {
        throw new Error("listener bug");
      });

      envelopeCb!({
        sourceNumber: PEER,
        timestamp: 123,
        dataMessage: { timestamp: 123, message: "hello" },
      });

      // The adapter should catch the listener error and emit it
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
      await adapter.react(msg, "❤️");
      expect(lastRequest!.method).toBe("sendReaction");
      expect(lastRequest!.params!.emoji).toBe("❤️");
      expect(lastRequest!.params!.targetTimestamp).toBe(1700000000000);
    });

    it("sends reaction to group message", async () => {
      const msg = makeMessage({
        conversation: makeGroupConversation("grp-1"),
      });
      await adapter.react(msg, "🎉");
      expect(lastRequest!.params!.groupId).toBe("grp-1");
      expect(lastRequest!.params!.recipient).toBeUndefined();
    });

    it("replies to a message", async () => {
      const msg = makeMessage();
      const reply = await adapter.reply(msg, { type: "text", text: "replying" });
      expect(lastRequest!.method).toBe("send");
      expect(lastRequest!.params!.quoteTimestamp).toBe(1700000000000);
      expect(lastRequest!.params!.quoteAuthor).toBe(PEER);
      expect(reply.content).toEqual({ type: "text", text: "replying" });
    });

    it("forwards a text message", async () => {
      const msg = makeMessage();
      const target = makeDmConversation("+15550000000");
      const forwarded = await adapter.forward(msg, target);
      expect(lastRequest!.method).toBe("send");
      expect(forwarded.conversation.id).toBe("+15550000000");
    });

    it("deletes a DM message", async () => {
      const msg = makeMessage();
      await adapter.delete(msg);
      expect(lastRequest!.method).toBe("remoteDelete");
      expect(lastRequest!.params!.targetTimestamp).toBe(1700000000000);
      expect(lastRequest!.params!.recipient).toEqual([PEER]);
    });

    it("deletes a group message", async () => {
      const msg = makeMessage({
        conversation: makeGroupConversation("grp-1"),
      });
      await adapter.delete(msg);
      expect(lastRequest!.params!.groupId).toBe("grp-1");
    });
  });

  describe("presence", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("sends typing indicator for DM", async () => {
      const conv = makeDmConversation();
      await adapter.setTyping(conv);
      expect(lastRequest!.method).toBe("sendTyping");
      expect(lastRequest!.params!.recipient).toBe(PEER);
    });

    it("sends typing indicator for group", async () => {
      const conv = makeGroupConversation("grp-1");
      await adapter.setTyping(conv);
      expect(lastRequest!.params!.groupId).toBe("grp-1");
    });

    it("marks message as read", async () => {
      const msg = makeMessage();
      await adapter.markRead(msg);
      expect(lastRequest!.method).toBe("sendReceipt");
      expect(lastRequest!.params!.type).toBe("read");
    });
  });

  describe("conversations", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("lists groups", async () => {
      requestResult = [
        { id: "grp-1", name: "Family" },
        { groupId: "grp-2", name: "Work" },
      ];
      const convs = await adapter.getConversations();
      expect(lastRequest!.method).toBe("listGroups");
      expect(convs).toHaveLength(2);
      expect(convs[0].id).toBe("grp-1");
      expect(convs[0].metadata.name).toBe("Family");
      expect(convs[1].id).toBe("grp-2");
    });

    it("returns empty array for getMessages (unsupported)", async () => {
      const msgs = await adapter.getMessages(makeDmConversation());
      expect(msgs).toEqual([]);
    });

    it("handles empty listGroups result", async () => {
      requestResult = [];
      const convs = await adapter.getConversations();
      expect(convs).toEqual([]);
    });
  });
});
