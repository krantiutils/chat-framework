import { describe, it, expect } from "vitest";

import type {
  TelegramChat,
  TelegramMessage,
  TelegramMessageReactionUpdated,
  TelegramPhotoSize,
  TelegramUser,
} from "../telegram/types.js";
import {
  mapTelegramUser,
  mapTelegramChatType,
  mapTelegramConversation,
  pickLargestPhoto,
  mapTelegramMessageContent,
  mapTelegramMessage,
  mapTelegramReactions,
} from "../telegram/mapper.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<TelegramUser> = {}): TelegramUser {
  return {
    id: 123456,
    is_bot: false,
    first_name: "Alice",
    ...overrides,
  };
}

function makeChat(overrides: Partial<TelegramChat> = {}): TelegramChat {
  return {
    id: -100111222333,
    type: "group",
    title: "Test Group",
    ...overrides,
  };
}

function makeMessage(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    message_id: 42,
    from: makeUser(),
    chat: makeChat({ id: 123456, type: "private" }),
    date: 1700000000,
    ...overrides,
  };
}

// ── mapTelegramUser ─────────────────────────────────────────────────────────

describe("mapTelegramUser", () => {
  it("maps basic user", () => {
    const user = mapTelegramUser(makeUser());
    expect(user.id).toBe("123456");
    expect(user.platform).toBe("telegram");
    expect(user.displayName).toBe("Alice");
    expect(user.username).toBeUndefined();
  });

  it("concatenates first and last name", () => {
    const user = mapTelegramUser(makeUser({ last_name: "Smith" }));
    expect(user.displayName).toBe("Alice Smith");
  });

  it("includes username", () => {
    const user = mapTelegramUser(makeUser({ username: "alice_bot" }));
    expect(user.username).toBe("alice_bot");
  });
});

// ── mapTelegramChatType ─────────────────────────────────────────────────────

describe("mapTelegramChatType", () => {
  it("maps private to dm", () => {
    expect(mapTelegramChatType("private")).toBe("dm");
  });

  it("maps group to group", () => {
    expect(mapTelegramChatType("group")).toBe("group");
  });

  it("maps supergroup to group", () => {
    expect(mapTelegramChatType("supergroup")).toBe("group");
  });

  it("maps channel to channel", () => {
    expect(mapTelegramChatType("channel")).toBe("channel");
  });
});

// ── mapTelegramConversation ─────────────────────────────────────────────────

describe("mapTelegramConversation", () => {
  it("maps group chat", () => {
    const conv = mapTelegramConversation(makeChat());
    expect(conv.id).toBe("-100111222333");
    expect(conv.platform).toBe("telegram");
    expect(conv.type).toBe("group");
    expect(conv.metadata.title).toBe("Test Group");
  });

  it("maps private chat", () => {
    const conv = mapTelegramConversation(
      makeChat({ id: 42, type: "private", first_name: "Bob" }),
    );
    expect(conv.type).toBe("dm");
    expect(conv.id).toBe("42");
  });

  it("maps channel", () => {
    const conv = mapTelegramConversation(
      makeChat({ type: "channel", username: "test_channel" }),
    );
    expect(conv.type).toBe("channel");
    expect(conv.metadata.username).toBe("test_channel");
  });
});

// ── pickLargestPhoto ────────────────────────────────────────────────────────

describe("pickLargestPhoto", () => {
  it("returns undefined for empty array", () => {
    expect(pickLargestPhoto([])).toBeUndefined();
  });

  it("picks the largest by area", () => {
    const photos: TelegramPhotoSize[] = [
      { file_id: "small", file_unique_id: "s", width: 100, height: 100 },
      { file_id: "large", file_unique_id: "l", width: 800, height: 600 },
      { file_id: "medium", file_unique_id: "m", width: 320, height: 240 },
    ];
    expect(pickLargestPhoto(photos)?.file_id).toBe("large");
  });

  it("returns single photo", () => {
    const photos: TelegramPhotoSize[] = [
      { file_id: "only", file_unique_id: "o", width: 200, height: 200 },
    ];
    expect(pickLargestPhoto(photos)?.file_id).toBe("only");
  });
});

// ── mapTelegramMessageContent ───────────────────────────────────────────────

describe("mapTelegramMessageContent", () => {
  it("maps text message", () => {
    const content = mapTelegramMessageContent(makeMessage({ text: "hello world" }));
    expect(content).toEqual({ type: "text", text: "hello world" });
  });

  it("maps photo message with caption", () => {
    const content = mapTelegramMessageContent(
      makeMessage({
        photo: [
          { file_id: "small", file_unique_id: "s", width: 100, height: 100 },
          { file_id: "large", file_unique_id: "l", width: 800, height: 600 },
        ],
        caption: "nice pic",
      }),
    );
    expect(content.type).toBe("image");
    if (content.type === "image") {
      expect(content.url).toBe("large");
      expect(content.caption).toBe("nice pic");
    }
  });

  it("maps video message", () => {
    const content = mapTelegramMessageContent(
      makeMessage({
        video: {
          file_id: "vid123",
          file_unique_id: "v",
          width: 1920,
          height: 1080,
          duration: 60,
        },
        caption: "cool vid",
      }),
    );
    expect(content.type).toBe("video");
    if (content.type === "video") {
      expect(content.url).toBe("vid123");
      expect(content.caption).toBe("cool vid");
    }
  });

  it("maps audio message", () => {
    const content = mapTelegramMessageContent(
      makeMessage({
        audio: {
          file_id: "aud123",
          file_unique_id: "a",
          duration: 180,
          title: "Song",
        },
      }),
    );
    expect(content.type).toBe("audio");
    if (content.type === "audio") {
      expect(content.url).toBe("aud123");
      expect(content.duration).toBe(180);
    }
  });

  it("maps voice message", () => {
    const content = mapTelegramMessageContent(
      makeMessage({
        voice: {
          file_id: "voice123",
          file_unique_id: "v",
          duration: 5,
        },
      }),
    );
    expect(content.type).toBe("voice");
    if (content.type === "voice") {
      expect(content.url).toBe("voice123");
      expect(content.duration).toBe(5);
    }
  });

  it("maps document message", () => {
    const content = mapTelegramMessageContent(
      makeMessage({
        document: {
          file_id: "doc123",
          file_unique_id: "d",
          file_name: "report.pdf",
          file_size: 1024,
        },
      }),
    );
    expect(content.type).toBe("file");
    if (content.type === "file") {
      expect(content.filename).toBe("report.pdf");
      expect(content.size).toBe(1024);
    }
  });

  it("maps sticker message", () => {
    const content = mapTelegramMessageContent(
      makeMessage({
        sticker: {
          file_id: "stk123",
          file_unique_id: "s",
          type: "regular",
          width: 512,
          height: 512,
          is_animated: false,
          is_video: false,
        },
      }),
    );
    expect(content.type).toBe("sticker");
    if (content.type === "sticker") {
      expect(content.id).toBe("stk123");
    }
  });

  it("maps location message", () => {
    const content = mapTelegramMessageContent(
      makeMessage({
        location: { latitude: 40.7128, longitude: -74.006 },
      }),
    );
    expect(content.type).toBe("location");
    if (content.type === "location") {
      expect(content.lat).toBe(40.7128);
      expect(content.lng).toBe(-74.006);
    }
  });

  it("maps contact message", () => {
    const content = mapTelegramMessageContent(
      makeMessage({
        contact: {
          phone_number: "+1234567890",
          first_name: "Bob",
          last_name: "Jones",
        },
      }),
    );
    expect(content.type).toBe("contact");
    if (content.type === "contact") {
      expect(content.name).toBe("Bob Jones");
      expect(content.phone).toBe("+1234567890");
    }
  });

  it("falls back to empty text for empty message", () => {
    const content = mapTelegramMessageContent(makeMessage());
    expect(content).toEqual({ type: "text", text: "" });
  });

  it("document without file_name defaults to unknown", () => {
    const content = mapTelegramMessageContent(
      makeMessage({
        document: { file_id: "d1", file_unique_id: "d" },
      }),
    );
    if (content.type === "file") {
      expect(content.filename).toBe("unknown");
      expect(content.size).toBe(0);
    }
  });
});

// ── mapTelegramMessage ──────────────────────────────────────────────────────

describe("mapTelegramMessage", () => {
  it("maps a full text message", () => {
    const msg = mapTelegramMessage(makeMessage({ text: "hello" }));
    expect(msg).toBeDefined();
    expect(msg!.id).toBe("42");
    expect(msg!.sender.id).toBe("123456");
    expect(msg!.sender.displayName).toBe("Alice");
    expect(msg!.conversation.platform).toBe("telegram");
    expect(msg!.content).toEqual({ type: "text", text: "hello" });
    expect(msg!.timestamp).toEqual(new Date(1700000000 * 1000));
  });

  it("returns undefined if no sender", () => {
    const msg = mapTelegramMessage(
      makeMessage({ from: undefined } as any),
    );
    expect(msg).toBeUndefined();
  });

  it("maps reply_to_message", () => {
    const msg = mapTelegramMessage(
      makeMessage({
        text: "reply",
        reply_to_message: makeMessage({
          message_id: 41,
          text: "original",
        }),
      }),
    );
    expect(msg!.replyTo).toBeDefined();
    expect(msg!.replyTo!.id).toBe("41");
    expect(msg!.replyTo!.content).toEqual({ type: "text", text: "original" });
  });
});

// ── mapTelegramReactions ────────────────────────────────────────────────────

describe("mapTelegramReactions", () => {
  function makeReactionUpdate(
    overrides: Partial<TelegramMessageReactionUpdated> = {},
  ): TelegramMessageReactionUpdated {
    return {
      chat: makeChat(),
      message_id: 42,
      user: makeUser(),
      date: 1700000000,
      old_reaction: [],
      new_reaction: [],
      ...overrides,
    };
  }

  it("returns added emoji reactions", () => {
    const reactions = mapTelegramReactions(
      makeReactionUpdate({
        old_reaction: [],
        new_reaction: [{ type: "emoji", emoji: "👍" }],
      }),
    );
    expect(reactions).toHaveLength(1);
    expect(reactions[0].emoji).toBe("👍");
    expect(reactions[0].user.id).toBe("123456");
  });

  it("ignores reactions that already existed", () => {
    const reactions = mapTelegramReactions(
      makeReactionUpdate({
        old_reaction: [{ type: "emoji", emoji: "👍" }],
        new_reaction: [{ type: "emoji", emoji: "👍" }, { type: "emoji", emoji: "❤️" }],
      }),
    );
    expect(reactions).toHaveLength(1);
    expect(reactions[0].emoji).toBe("❤️");
  });

  it("returns empty array when no user", () => {
    const reactions = mapTelegramReactions(
      makeReactionUpdate({ user: undefined }),
    );
    expect(reactions).toEqual([]);
  });

  it("ignores custom emoji reactions", () => {
    const reactions = mapTelegramReactions(
      makeReactionUpdate({
        new_reaction: [{ type: "custom_emoji", custom_emoji_id: "12345" }],
      }),
    );
    expect(reactions).toEqual([]);
  });

  it("handles multiple new reactions", () => {
    const reactions = mapTelegramReactions(
      makeReactionUpdate({
        new_reaction: [
          { type: "emoji", emoji: "👍" },
          { type: "emoji", emoji: "🎉" },
        ],
      }),
    );
    expect(reactions).toHaveLength(2);
    expect(reactions[0].emoji).toBe("👍");
    expect(reactions[1].emoji).toBe("🎉");
  });
});
