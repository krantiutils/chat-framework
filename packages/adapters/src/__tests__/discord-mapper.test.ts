import { describe, it, expect } from "vitest";
import { ChannelType } from "discord.js";
import type {
  Attachment as DAttachment,
  Channel,
  Collection,
  Message as DMessage,
  MessageReaction as DReaction,
  PartialUser as DPartialUser,
  Sticker,
  User as DUser,
} from "discord.js";
import {
  mapDiscordUser,
  mapDiscordChannelToConversation,
  mapDiscordAttachmentToContent,
  mapDiscordMessageToContent,
  mapDiscordMessage,
  mapDiscordReaction,
  mapPartialDiscordMessage,
} from "../discord/mapper.js";

// ── Factories ───────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<DUser> = {}): DUser {
  return {
    id: "123456789",
    username: "alice",
    displayName: "Alice",
    avatarURL: () => "https://cdn.discordapp.com/avatars/123/abc.png",
    displayAvatarURL: () => "https://cdn.discordapp.com/avatars/123/abc.png",
    bot: false,
    ...overrides,
  } as unknown as DUser;
}

function makePartialUser(overrides: Partial<DPartialUser> = {}): DPartialUser {
  return {
    id: "987654321",
    username: undefined,
    displayName: undefined,
    avatarURL: undefined,
    displayAvatarURL: undefined,
    ...overrides,
  } as unknown as DPartialUser;
}

function makeAttachment(overrides: Partial<DAttachment> = {}): DAttachment {
  return {
    url: "https://cdn.discordapp.com/attachments/1/2/file.png",
    contentType: "image/png",
    name: "file.png",
    size: 1024,
    duration: undefined,
    ...overrides,
  } as unknown as DAttachment;
}

function makeCollection<V>(entries: [string, V][]): Collection<string, V> {
  const map = new Map(entries);
  return {
    ...map,
    first: () => entries.length > 0 ? entries[0][1] : undefined,
    values: () => map.values(),
    size: entries.length,
    [Symbol.iterator]: () => map[Symbol.iterator](),
  } as unknown as Collection<string, V>;
}

function makeDmChannel(overrides: Record<string, unknown> = {}): Channel {
  return {
    id: "dm-channel-1",
    type: ChannelType.DM,
    recipient: makeUser(),
    isTextBased: () => true,
    isThread: () => false,
    ...overrides,
  } as unknown as Channel;
}

function makeGroupDmChannel(overrides: Record<string, unknown> = {}): Channel {
  const recipients = new Map([
    ["1", makeUser({ id: "1", username: "alice" })],
    ["2", makeUser({ id: "2", username: "bob" })],
  ]);
  return {
    id: "group-dm-1",
    type: ChannelType.GroupDM,
    recipients,
    isTextBased: () => true,
    isThread: () => false,
    ...overrides,
  } as unknown as Channel;
}

function makeGuildTextChannel(overrides: Record<string, unknown> = {}): Channel {
  return {
    id: "text-channel-1",
    type: ChannelType.GuildText,
    name: "general",
    guild: { id: "guild-1", name: "Test Server" },
    isTextBased: () => true,
    isThread: () => false,
    ...overrides,
  } as unknown as Channel;
}

function makeThreadChannel(overrides: Record<string, unknown> = {}): Channel {
  return {
    id: "thread-1",
    type: ChannelType.PublicThread,
    name: "help-thread",
    guild: { id: "guild-1", name: "Test Server" },
    parentId: "text-channel-1",
    isTextBased: () => true,
    isThread: () => true,
    ...overrides,
  } as unknown as Channel;
}

function makeMessage(overrides: Partial<DMessage> & Record<string, unknown> = {}): DMessage {
  const {
    attachments: attachmentEntries,
    stickers: stickerEntries,
    reactions: reactionEntries,
    ...rest
  } = overrides;

  return {
    id: "msg-1",
    channel: makeGuildTextChannel(),
    author: makeUser(),
    createdAt: new Date(1700000000000),
    content: "hello world",
    attachments: attachmentEntries ?? makeCollection([]),
    stickers: stickerEntries ?? makeCollection([]),
    reactions: reactionEntries ?? { cache: makeCollection([]) },
    reference: null,
    ...rest,
  } as unknown as DMessage;
}

function makeReaction(overrides: Record<string, unknown> = {}): DReaction {
  return {
    emoji: { name: "👍", id: null, animated: false },
    message: makeMessage(),
    ...overrides,
  } as unknown as DReaction;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("mapDiscordUser", () => {
  it("maps a full user", () => {
    const user = mapDiscordUser(makeUser());
    expect(user).toEqual({
      id: "123456789",
      platform: "discord",
      username: "alice",
      displayName: "Alice",
      avatar: "https://cdn.discordapp.com/avatars/123/abc.png",
    });
  });

  it("maps a partial user with missing fields", () => {
    const user = mapDiscordUser(makePartialUser());
    expect(user.id).toBe("987654321");
    expect(user.platform).toBe("discord");
    expect(user.username).toBeUndefined();
    expect(user.displayName).toBeUndefined();
  });

  it("uses username as displayName fallback", () => {
    const user = mapDiscordUser(
      makeUser({ displayName: undefined as unknown as string }),
    );
    expect(user.displayName).toBe("alice");
  });

  it("maps a bot user", () => {
    const user = mapDiscordUser(makeUser({ id: "bot-id", username: "bot" }));
    expect(user.id).toBe("bot-id");
    expect(user.username).toBe("bot");
  });
});

describe("mapDiscordChannelToConversation", () => {
  it("maps a DM channel", () => {
    const conv = mapDiscordChannelToConversation(makeDmChannel());
    expect(conv.id).toBe("dm-channel-1");
    expect(conv.platform).toBe("discord");
    expect(conv.type).toBe("dm");
    expect(conv.participants).toHaveLength(1);
    expect(conv.participants[0].id).toBe("123456789");
  });

  it("maps a group DM channel", () => {
    const conv = mapDiscordChannelToConversation(makeGroupDmChannel());
    expect(conv.type).toBe("group");
    // PartialGroupDMChannel.recipients is PartialRecipient[] (username-only),
    // insufficient to build full User objects, so participants are empty.
    expect(conv.participants).toHaveLength(0);
  });

  it("maps a guild text channel", () => {
    const conv = mapDiscordChannelToConversation(makeGuildTextChannel());
    expect(conv.type).toBe("channel");
    expect(conv.participants).toHaveLength(0);
    expect(conv.metadata.guildId).toBe("guild-1");
    expect(conv.metadata.guildName).toBe("Test Server");
    expect(conv.metadata.channelName).toBe("general");
  });

  it("maps a thread channel with parent info", () => {
    const conv = mapDiscordChannelToConversation(makeThreadChannel());
    expect(conv.type).toBe("channel");
    expect(conv.metadata.threadId).toBe("thread-1");
    expect(conv.metadata.parentChannelId).toBe("text-channel-1");
  });
});

describe("mapDiscordAttachmentToContent", () => {
  it("maps image attachment", () => {
    const content = mapDiscordAttachmentToContent(
      makeAttachment({ contentType: "image/jpeg" }),
    );
    expect(content.type).toBe("image");
    if (content.type === "image") {
      expect(content.url).toContain("cdn.discordapp.com");
    }
  });

  it("maps video attachment", () => {
    const content = mapDiscordAttachmentToContent(
      makeAttachment({ contentType: "video/mp4" }),
    );
    expect(content.type).toBe("video");
  });

  it("maps audio attachment", () => {
    const content = mapDiscordAttachmentToContent(
      makeAttachment({ contentType: "audio/mpeg", duration: 120 }),
    );
    expect(content.type).toBe("audio");
    if (content.type === "audio") {
      expect(content.duration).toBe(120);
    }
  });

  it("maps audio attachment with no duration", () => {
    const content = mapDiscordAttachmentToContent(
      makeAttachment({ contentType: "audio/ogg", duration: undefined }),
    );
    if (content.type === "audio") {
      expect(content.duration).toBe(0);
    }
  });

  it("maps unknown type as file", () => {
    const content = mapDiscordAttachmentToContent(
      makeAttachment({
        contentType: "application/pdf",
        name: "doc.pdf",
        size: 2048,
      }),
    );
    expect(content).toEqual({
      type: "file",
      url: expect.any(String),
      filename: "doc.pdf",
      size: 2048,
    });
  });

  it("handles null contentType as file", () => {
    const content = mapDiscordAttachmentToContent(
      makeAttachment({ contentType: null }),
    );
    expect(content.type).toBe("file");
  });
});

describe("mapDiscordMessageToContent", () => {
  it("maps text-only message", () => {
    const content = mapDiscordMessageToContent(makeMessage());
    expect(content).toEqual({ type: "text", text: "hello world" });
  });

  it("maps message with image attachment", () => {
    const att = makeAttachment({ contentType: "image/png" });
    const msg = makeMessage({
      content: "",
      attachments: makeCollection([["1", att]]),
    });
    const content = mapDiscordMessageToContent(msg);
    expect(content.type).toBe("image");
  });

  it("adds caption from text when image attachment present", () => {
    const att = makeAttachment({ contentType: "image/png" });
    const msg = makeMessage({
      content: "check this out",
      attachments: makeCollection([["1", att]]),
    });
    const content = mapDiscordMessageToContent(msg);
    expect(content.type).toBe("image");
    if (content.type === "image") {
      expect(content.caption).toBe("check this out");
    }
  });

  it("adds caption from text when video attachment present", () => {
    const att = makeAttachment({ contentType: "video/mp4" });
    const msg = makeMessage({
      content: "funny video",
      attachments: makeCollection([["1", att]]),
    });
    const content = mapDiscordMessageToContent(msg);
    expect(content.type).toBe("video");
    if (content.type === "video") {
      expect(content.caption).toBe("funny video");
    }
  });

  it("does not add caption for audio attachment", () => {
    const att = makeAttachment({ contentType: "audio/mpeg" });
    const msg = makeMessage({
      content: "listen",
      attachments: makeCollection([["1", att]]),
    });
    const content = mapDiscordMessageToContent(msg);
    expect(content.type).toBe("audio");
    expect("caption" in content).toBe(false);
  });

  it("maps sticker message", () => {
    const sticker = {
      id: "sticker-1",
      url: "https://cdn.discordapp.com/stickers/1.png",
    } as unknown as Sticker;
    const msg = makeMessage({
      content: "",
      stickers: makeCollection([["sticker-1", sticker]]),
    });
    const content = mapDiscordMessageToContent(msg);
    expect(content).toEqual({
      type: "sticker",
      id: "sticker-1",
      url: "https://cdn.discordapp.com/stickers/1.png",
    });
  });

  it("returns empty text for empty message", () => {
    const msg = makeMessage({ content: "" });
    const content = mapDiscordMessageToContent(msg);
    expect(content).toEqual({ type: "text", text: "" });
  });

  it("returns empty text for null content", () => {
    const msg = makeMessage({ content: null });
    const content = mapDiscordMessageToContent(msg);
    expect(content).toEqual({ type: "text", text: "" });
  });
});

describe("mapDiscordReaction", () => {
  it("maps unicode emoji reaction", () => {
    const reaction = mapDiscordReaction(makeReaction(), makeUser());
    expect(reaction.emoji).toBe("👍");
    expect(reaction.user.id).toBe("123456789");
    expect(reaction.timestamp).toBeInstanceOf(Date);
  });

  it("maps custom emoji reaction", () => {
    const reaction = mapDiscordReaction(
      makeReaction({
        emoji: { name: "pepehappy", id: "999888777", animated: false },
      }),
      makeUser(),
    );
    expect(reaction.emoji).toBe("<:pepehappy:999888777>");
  });

  it("maps animated custom emoji", () => {
    const reaction = mapDiscordReaction(
      makeReaction({
        emoji: { name: "dance", id: "111222333", animated: true },
      }),
      makeUser(),
    );
    expect(reaction.emoji).toBe("<a:dance:111222333>");
  });

  it("handles missing emoji name", () => {
    const reaction = mapDiscordReaction(
      makeReaction({
        emoji: { name: null, id: null, animated: false },
      }),
      makeUser(),
    );
    expect(reaction.emoji).toBe("?");
  });
});

describe("mapDiscordMessage", () => {
  it("maps a full text message", () => {
    const msg = mapDiscordMessage(makeMessage());
    expect(msg.id).toBe("msg-1");
    expect(msg.sender.id).toBe("123456789");
    expect(msg.sender.platform).toBe("discord");
    expect(msg.content).toEqual({ type: "text", text: "hello world" });
    expect(msg.conversation.platform).toBe("discord");
    expect(msg.timestamp).toEqual(new Date(1700000000000));
  });

  it("maps a message with reply reference (uncached)", () => {
    const msg = mapDiscordMessage(
      makeMessage({
        reference: { messageId: "ref-msg-1", channelId: "ch-1", guildId: "g-1" },
      }),
    );
    expect(msg.replyTo).toBeDefined();
    expect(msg.replyTo!.id).toBe("ref-msg-1");
  });

  it("maps a message without reactions", () => {
    const msg = mapDiscordMessage(makeMessage());
    expect(msg.reactions).toBeUndefined();
  });

  it("maps a message with reactions", () => {
    const reactionCache = makeCollection([
      [
        "👍",
        {
          emoji: { name: "👍", id: null, animated: false },
          count: 3,
        },
      ],
    ]);
    const msg = mapDiscordMessage(
      makeMessage({ reactions: { cache: reactionCache } }),
    );
    expect(msg.reactions).toBeDefined();
    expect(msg.reactions).toHaveLength(1);
    expect(msg.reactions![0].emoji).toBe("👍");
  });
});

describe("mapPartialDiscordMessage", () => {
  it("maps a partial message with missing author", () => {
    const partial = {
      id: "partial-1",
      channel: makeGuildTextChannel(),
      author: null,
      createdAt: null,
      content: "partial text",
      attachments: makeCollection([]),
      stickers: makeCollection([]),
    };
    const msg = mapPartialDiscordMessage(partial as never);
    expect(msg.id).toBe("partial-1");
    expect(msg.sender.id).toBe("unknown");
    expect(msg.timestamp).toEqual(new Date(0));
    expect(msg.content).toEqual({ type: "text", text: "partial text" });
  });
});
