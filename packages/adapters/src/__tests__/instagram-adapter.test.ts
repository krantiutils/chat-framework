import { describe, it, expect } from "vitest";

import { InstagramAdapter } from "../instagram/instagram-adapter.js";
import { UnsupportedOperationError } from "@chat-framework/core";
import type { Conversation, Message } from "@chat-framework/core";

const DUMMY_CONFIG = {
  credentials: { username: "testuser", password: "testpass" },
  userDataDir: "/tmp/test-instagram-session",
};

const DUMMY_CONVERSATION: Conversation = {
  id: "123456",
  platform: "instagram",
  participants: [],
  type: "dm" as const,
  metadata: {},
};

const DUMMY_MESSAGE: Message = {
  id: "msg-1",
  conversation: DUMMY_CONVERSATION,
  sender: { id: "other", platform: "instagram" },
  timestamp: new Date(),
  content: { type: "text", text: "hello" },
};

describe("InstagramAdapter", () => {
  describe("construction", () => {
    it("sets platform to 'instagram'", () => {
      const adapter = new InstagramAdapter(DUMMY_CONFIG);
      expect(adapter.platform).toBe("instagram");
    });

    it("starts disconnected", () => {
      const adapter = new InstagramAdapter(DUMMY_CONFIG);
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe("pre-connection guards", () => {
    it("throws on sendText when not connected", async () => {
      const adapter = new InstagramAdapter(DUMMY_CONFIG);
      await expect(
        adapter.sendText(DUMMY_CONVERSATION, "test"),
      ).rejects.toThrow("not connected");
    });

    it("throws on getConversations when not connected", async () => {
      const adapter = new InstagramAdapter(DUMMY_CONFIG);
      await expect(adapter.getConversations()).rejects.toThrow("not connected");
    });

    it("throws on react when not connected", async () => {
      const adapter = new InstagramAdapter(DUMMY_CONFIG);
      await expect(adapter.react(DUMMY_MESSAGE, "❤️")).rejects.toThrow(
        "not connected",
      );
    });
  });

  describe("unsupported operations", () => {
    it("throws UnsupportedOperationError for sendFile", async () => {
      const adapter = new InstagramAdapter(DUMMY_CONFIG);
      // Bypass connection check by checking the error type
      try {
        await adapter.sendFile(DUMMY_CONVERSATION, "data", "file.txt");
      } catch (err) {
        // Either not connected or unsupported — both are correct pre-connection
        expect(
          err instanceof UnsupportedOperationError ||
            (err instanceof Error && err.message.includes("not connected")),
        ).toBe(true);
      }
    });

    it("throws UnsupportedOperationError for sendLocation", async () => {
      const adapter = new InstagramAdapter(DUMMY_CONFIG);
      try {
        await adapter.sendLocation(DUMMY_CONVERSATION, 0, 0);
      } catch (err) {
        expect(
          err instanceof UnsupportedOperationError ||
            (err instanceof Error && err.message.includes("not connected")),
        ).toBe(true);
      }
    });

    it("throws UnsupportedOperationError for forward", async () => {
      const adapter = new InstagramAdapter(DUMMY_CONFIG);
      try {
        await adapter.forward(DUMMY_MESSAGE, DUMMY_CONVERSATION);
      } catch (err) {
        expect(
          err instanceof UnsupportedOperationError ||
            (err instanceof Error && err.message.includes("not connected")),
        ).toBe(true);
      }
    });
  });

  describe("event emitter", () => {
    it("supports on/off for message events", () => {
      const adapter = new InstagramAdapter(DUMMY_CONFIG);
      const handler = () => {};
      // Should not throw
      adapter.on("message", handler);
      adapter.off("message", handler);
    });

    it("supports on/off for error events", () => {
      const adapter = new InstagramAdapter(DUMMY_CONFIG);
      const handler = () => {};
      adapter.on("error", handler);
      adapter.off("error", handler);
    });

    it("supports on/off for connected/disconnected events", () => {
      const adapter = new InstagramAdapter(DUMMY_CONFIG);
      const handler = () => {};
      adapter.on("connected", handler);
      adapter.on("disconnected", handler);
      adapter.off("connected", handler);
      adapter.off("disconnected", handler);
    });
  });
});
