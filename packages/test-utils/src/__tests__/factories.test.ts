import { describe, it, expect, beforeEach } from "vitest";
import {
  createUser,
  createConversation,
  createContent,
  createMessage,
  createReaction,
  resetIdCounter,
} from "../factories.js";

describe("test factories", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("createUser", () => {
    it("creates a user with defaults", () => {
      const user = createUser();
      expect(user.id).toBe("user-1");
      expect(user.platform).toBe("signal");
      expect(user.username).toBeDefined();
      expect(user.displayName).toBeDefined();
    });

    it("accepts overrides", () => {
      const user = createUser({
        id: "custom-id",
        platform: "telegram",
        username: "alice",
      });
      expect(user.id).toBe("custom-id");
      expect(user.platform).toBe("telegram");
      expect(user.username).toBe("alice");
    });

    it("auto-increments IDs", () => {
      const u1 = createUser();
      const u2 = createUser();
      expect(u1.id).not.toBe(u2.id);
    });
  });

  describe("createConversation", () => {
    it("creates a DM by default", () => {
      const conv = createConversation();
      expect(conv.type).toBe("dm");
      expect(conv.platform).toBe("signal");
      expect(conv.participants).toEqual([]);
      expect(conv.metadata).toEqual({});
    });

    it("accepts overrides", () => {
      const conv = createConversation({
        type: "group",
        platform: "discord",
        metadata: { name: "test-group" },
      });
      expect(conv.type).toBe("group");
      expect(conv.platform).toBe("discord");
      expect(conv.metadata).toEqual({ name: "test-group" });
    });
  });

  describe("createContent", () => {
    it("defaults to text", () => {
      const content = createContent();
      expect(content.type).toBe("text");
      if (content.type === "text") {
        expect(content.text).toBe("test message");
      }
    });

    it("creates image content", () => {
      const content = createContent({ type: "image" });
      expect(content.type).toBe("image");
      if (content.type === "image") {
        expect(content.url).toBeDefined();
      }
    });

    it("creates audio content with duration", () => {
      const content = createContent({ type: "audio" });
      expect(content.type).toBe("audio");
      if (content.type === "audio") {
        expect(content.duration).toBeGreaterThan(0);
      }
    });

    it("creates file content with size", () => {
      const content = createContent({ type: "file" });
      expect(content.type).toBe("file");
      if (content.type === "file") {
        expect(content.filename).toBeDefined();
        expect(content.size).toBeGreaterThan(0);
      }
    });

    it("creates location content", () => {
      const content = createContent({ type: "location" });
      expect(content.type).toBe("location");
      if (content.type === "location") {
        expect(content.lat).toBeDefined();
        expect(content.lng).toBeDefined();
      }
    });

    it("creates contact content", () => {
      const content = createContent({ type: "contact" });
      expect(content.type).toBe("contact");
    });

    it("creates sticker content", () => {
      const content = createContent({ type: "sticker" });
      expect(content.type).toBe("sticker");
    });

    it("creates link content", () => {
      const content = createContent({ type: "link" });
      expect(content.type).toBe("link");
    });
  });

  describe("createMessage", () => {
    it("creates a message with all required fields", () => {
      const msg = createMessage();
      expect(msg.id).toBeDefined();
      expect(msg.conversation).toBeDefined();
      expect(msg.sender).toBeDefined();
      expect(msg.timestamp).toBeInstanceOf(Date);
      expect(msg.content).toBeDefined();
    });

    it("accepts overrides", () => {
      const conv = createConversation({ id: "my-conv" });
      const sender = createUser({ id: "my-user" });
      const msg = createMessage({ conversation: conv, sender });
      expect(msg.conversation.id).toBe("my-conv");
      expect(msg.sender.id).toBe("my-user");
    });
  });

  describe("createReaction", () => {
    it("creates a reaction with defaults", () => {
      const reaction = createReaction();
      expect(reaction.emoji).toBe("👍");
      expect(reaction.user).toBeDefined();
      expect(reaction.timestamp).toBeInstanceOf(Date);
    });

    it("accepts overrides", () => {
      const reaction = createReaction({ emoji: "❤️" });
      expect(reaction.emoji).toBe("❤️");
    });
  });

  describe("resetIdCounter", () => {
    it("resets IDs to start from 1", () => {
      createUser(); // user-1
      createUser(); // user-2
      resetIdCounter();
      const user = createUser();
      expect(user.id).toBe("user-1");
    });
  });
});
