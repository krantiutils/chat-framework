import { describe, it, expect, beforeEach } from "vitest";
import type { Message, User, Conversation } from "@chat-framework/core";
import { MockMessagingClient } from "../mock-client.js";
import {
  createConversation,
  createMessage,
  createUser,
  resetIdCounter,
} from "../factories.js";

describe("MockMessagingClient", () => {
  let client: MockMessagingClient;

  beforeEach(() => {
    resetIdCounter();
    client = new MockMessagingClient();
  });

  describe("connection lifecycle", () => {
    it("starts disconnected", () => {
      expect(client.isConnected()).toBe(false);
    });

    it("connects", async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);
    });

    it("disconnects", async () => {
      await client.connect();
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it("tracks connect calls", async () => {
      await client.connect();
      expect(client.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe("sending messages", () => {
    it("sendText returns a message with the sent text", async () => {
      const conv = createConversation();
      const msg = await client.sendText(conv, "hello");
      expect(msg.content).toEqual({ type: "text", text: "hello" });
      expect(msg.conversation).toBe(conv);
    });

    it("sendImage returns a message with image content", async () => {
      const conv = createConversation();
      const msg = await client.sendImage(conv, "/path/to/img.jpg", "caption");
      expect(msg.content.type).toBe("image");
    });

    it("sendAudio returns a message with audio content", async () => {
      const conv = createConversation();
      const msg = await client.sendAudio(conv, "/path/to/audio.mp3");
      expect(msg.content.type).toBe("audio");
    });

    it("sendVoice returns a message with voice content", async () => {
      const conv = createConversation();
      const msg = await client.sendVoice(conv, "/path/to/voice.ogg");
      expect(msg.content.type).toBe("voice");
    });

    it("sendFile returns a message with file content", async () => {
      const conv = createConversation();
      const msg = await client.sendFile(conv, "/path/to/doc.pdf", "doc.pdf");
      expect(msg.content.type).toBe("file");
      if (msg.content.type === "file") {
        expect(msg.content.filename).toBe("doc.pdf");
      }
    });

    it("sendLocation returns a message with location content", async () => {
      const conv = createConversation();
      const msg = await client.sendLocation(conv, 40.7128, -74.006);
      expect(msg.content.type).toBe("location");
      if (msg.content.type === "location") {
        expect(msg.content.lat).toBe(40.7128);
        expect(msg.content.lng).toBe(-74.006);
      }
    });

    it("records all send calls as spies", async () => {
      const conv = createConversation();
      await client.sendText(conv, "a");
      await client.sendText(conv, "b");
      expect(client.sendText).toHaveBeenCalledTimes(2);
      expect(client.sendText).toHaveBeenLastCalledWith(conv, "b");
    });
  });

  describe("event handling", () => {
    it("on/off registers and removes listeners", () => {
      const handler = () => {};
      client.on("message", handler);
      expect(client.listenerCount("message")).toBe(1);

      client.off("message", handler);
      expect(client.listenerCount("message")).toBe(0);
    });

    it("emit dispatches to registered listeners", () => {
      const received: Message[] = [];
      client.on("message", (msg) => received.push(msg));

      const msg = createMessage();
      client.emit("message", msg);

      expect(received).toHaveLength(1);
      expect(received[0]).toBe(msg);
    });

    it("emit typing event", () => {
      const events: Array<{ user: User; conv: Conversation }> = [];
      client.on("typing", (user, conv) => events.push({ user, conv }));

      const user = createUser();
      const conv = createConversation();
      client.emit("typing", user, conv);

      expect(events).toHaveLength(1);
      expect(events[0].user).toBe(user);
    });

    it("emit error event", () => {
      const errors: Error[] = [];
      client.on("error", (err) => errors.push(err));

      client.emit("error", new Error("test error"));

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe("test error");
    });

    it("does not emit to removed listeners", () => {
      const received: unknown[] = [];
      const handler = () => received.push(1);

      client.on("message", handler);
      client.off("message", handler);
      client.emit("message", createMessage());

      expect(received).toHaveLength(0);
    });
  });

  describe("interactions", () => {
    it("react records calls", async () => {
      const msg = createMessage();
      await client.react(msg, "👍");
      expect(client.react).toHaveBeenCalledWith(msg, "👍");
    });

    it("reply returns a new message", async () => {
      const original = createMessage();
      const reply = await client.reply(original, { type: "text", text: "reply" });
      expect(reply.content).toEqual({ type: "text", text: "reply" });
      expect(reply.conversation).toBe(original.conversation);
    });

    it("forward returns a message in the target conversation", async () => {
      const original = createMessage();
      const target = createConversation({ id: "target-conv" });
      const forwarded = await client.forward(original, target);
      expect(forwarded.conversation).toBe(target);
    });

    it("delete records calls", async () => {
      const msg = createMessage();
      await client.delete(msg);
      expect(client.delete).toHaveBeenCalledWith(msg);
    });
  });

  describe("presence", () => {
    it("setTyping records calls", async () => {
      const conv = createConversation();
      await client.setTyping(conv, 3000);
      expect(client.setTyping).toHaveBeenCalledWith(conv, 3000);
    });

    it("markRead records calls", async () => {
      const msg = createMessage();
      await client.markRead(msg);
      expect(client.markRead).toHaveBeenCalledWith(msg);
    });
  });

  describe("conversations", () => {
    it("getConversations returns empty by default", async () => {
      const convs = await client.getConversations();
      expect(convs).toEqual([]);
    });

    it("getMessages returns empty by default", async () => {
      const msgs = await client.getMessages(createConversation());
      expect(msgs).toEqual([]);
    });

    it("return values can be overridden via mockResolvedValue", async () => {
      const convs = [createConversation(), createConversation()];
      client.getConversations.mockResolvedValue(convs);

      const result = await client.getConversations();
      expect(result).toHaveLength(2);
    });
  });

  describe("reset", () => {
    it("clears connection state and listeners", async () => {
      await client.connect();
      client.on("message", () => {});
      expect(client.isConnected()).toBe(true);
      expect(client.listenerCount("message")).toBe(1);

      client.reset();

      // Connection state is cleared (the mock itself is cleared too)
      expect(client.listenerCount("message")).toBe(0);
    });

    it("clears mock call history", async () => {
      await client.sendText(createConversation(), "test");
      expect(client.sendText).toHaveBeenCalledTimes(1);

      client.reset();
      expect(client.sendText).toHaveBeenCalledTimes(0);
    });
  });
});
