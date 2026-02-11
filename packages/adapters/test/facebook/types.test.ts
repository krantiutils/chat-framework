import { describe, it, expect } from "vitest";
import type {
  Platform,
  User,
  Conversation,
  Message,
  MessageContent,
  Reaction,
  MessagingClient,
} from "@chat-framework/core";

/**
 * Type-level tests for the core messaging types.
 * These ensure the types are properly exported and usable.
 * The actual runtime behavior is tested in the adapter tests.
 */
describe("core messaging types", () => {
  it("Platform type accepts all supported platforms", () => {
    const platforms: Platform[] = [
      "telegram",
      "discord",
      "whatsapp",
      "instagram",
      "facebook",
      "signal",
    ];
    expect(platforms).toHaveLength(6);
  });

  it("User type is constructible", () => {
    const user: User = {
      id: "user-123",
      platform: "facebook",
      username: "testuser",
      displayName: "Test User",
      avatar: "https://example.com/avatar.jpg",
    };
    expect(user.id).toBe("user-123");
    expect(user.platform).toBe("facebook");
  });

  it("Conversation type is constructible", () => {
    const conv: Conversation = {
      id: "conv-456",
      platform: "facebook",
      participants: [{ id: "u1", platform: "facebook" }],
      type: "dm",
      metadata: { threadId: "t-789" },
    };
    expect(conv.id).toBe("conv-456");
    expect(conv.type).toBe("dm");
  });

  it("Message type is constructible with all content types", () => {
    const conversation: Conversation = {
      id: "c1",
      platform: "facebook",
      participants: [],
      type: "dm",
      metadata: {},
    };
    const sender: User = { id: "u1", platform: "facebook" };

    const textMsg: Message = {
      id: "m1",
      conversation,
      sender,
      timestamp: new Date(),
      content: { type: "text", text: "Hello" },
    };
    expect(textMsg.content.type).toBe("text");

    const imageMsg: Message = {
      id: "m2",
      conversation,
      sender,
      timestamp: new Date(),
      content: { type: "image", url: "https://img.com/a.jpg", caption: "pic" },
    };
    expect(imageMsg.content.type).toBe("image");

    const fileMsg: Message = {
      id: "m3",
      conversation,
      sender,
      timestamp: new Date(),
      content: {
        type: "file",
        url: "https://f.com/doc.pdf",
        filename: "doc.pdf",
        size: 1024,
      },
    };
    expect(fileMsg.content.type).toBe("file");
  });

  it("Reaction type is constructible", () => {
    const reaction: Reaction = {
      emoji: "thumbsup",
      user: { id: "u1", platform: "facebook" },
      timestamp: new Date(),
    };
    expect(reaction.emoji).toBe("thumbsup");
  });

  it("MessageContent covers all content types", () => {
    const contents: MessageContent[] = [
      { type: "text", text: "hello" },
      { type: "image", url: "img.jpg" },
      { type: "video", url: "vid.mp4" },
      { type: "audio", url: "audio.mp3", duration: 60 },
      { type: "voice", url: "voice.ogg", duration: 5 },
      { type: "file", url: "doc.pdf", filename: "doc.pdf", size: 1024 },
      { type: "location", lat: 40.7, lng: -74.0, name: "NYC" },
      { type: "contact", name: "John", phone: "+1234567890" },
      { type: "sticker", id: "s1", url: "sticker.webp" },
      { type: "link", url: "https://example.com" },
    ];
    expect(contents).toHaveLength(10);
    expect(contents.map((c) => c.type)).toEqual([
      "text",
      "image",
      "video",
      "audio",
      "voice",
      "file",
      "location",
      "contact",
      "sticker",
      "link",
    ]);
  });
});
