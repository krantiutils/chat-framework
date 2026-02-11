import { describe, it, expect } from "vitest";
import {
  mapSignalUser,
  mapSignalConversation,
  mapSignalAttachmentToContent,
  mapSignalMessageContent,
  mapSignalQuoteToReplyRef,
  mapSignalReaction,
  mapSignalEnvelopeToMessage,
} from "../signal/mapper.js";
import type {
  SignalAttachment,
  SignalDataMessage,
  SignalEnvelope,
} from "../signal/types.js";

const SELF = "+15551234567";
const PEER = "+15559876543";
const ATTACH_BASE = "file:///tmp/attachments";

describe("mapSignalUser", () => {
  it("uses phone number as id and username", () => {
    const user = mapSignalUser(PEER);
    expect(user).toEqual({
      id: PEER,
      platform: "signal",
      username: PEER,
      displayName: PEER,
    });
  });

  it("uses display name when provided", () => {
    const user = mapSignalUser(PEER, "Alice");
    expect(user.displayName).toBe("Alice");
    expect(user.id).toBe(PEER);
  });
});

describe("mapSignalConversation", () => {
  it("returns DM conversation for non-group envelopes", () => {
    const env: SignalEnvelope = {
      sourceNumber: PEER,
      dataMessage: { message: "hello" },
    };
    const conv = mapSignalConversation(env, SELF);
    expect(conv.type).toBe("dm");
    expect(conv.platform).toBe("signal");
    expect(conv.id).toBe(PEER);
    expect(conv.participants).toHaveLength(2);
  });

  it("returns group conversation when groupInfo present", () => {
    const env: SignalEnvelope = {
      sourceNumber: PEER,
      dataMessage: {
        message: "hello group",
        groupInfo: { groupId: "group-abc", type: "DELIVER" },
      },
    };
    const conv = mapSignalConversation(env, SELF);
    expect(conv.type).toBe("group");
    expect(conv.id).toBe("group-abc");
    expect(conv.metadata).toEqual({ groupType: "DELIVER" });
  });

  it("uses source as fallback when sourceNumber missing", () => {
    const env: SignalEnvelope = {
      source: PEER,
      dataMessage: { message: "hi" },
    };
    const conv = mapSignalConversation(env, SELF);
    expect(conv.id).toBe(PEER);
  });
});

describe("mapSignalAttachmentToContent", () => {
  it("maps image attachment", () => {
    const att: SignalAttachment = {
      contentType: "image/jpeg",
      id: "att-123",
      size: 1024,
    };
    const content = mapSignalAttachmentToContent(att, ATTACH_BASE);
    expect(content).toEqual({
      type: "image",
      url: `${ATTACH_BASE}/att-123`,
    });
  });

  it("maps video attachment", () => {
    const att: SignalAttachment = {
      contentType: "video/mp4",
      id: "att-vid",
    };
    const content = mapSignalAttachmentToContent(att, ATTACH_BASE);
    expect(content.type).toBe("video");
  });

  it("maps audio attachment", () => {
    const att: SignalAttachment = {
      contentType: "audio/mpeg",
      id: "att-aud",
    };
    const content = mapSignalAttachmentToContent(att, ATTACH_BASE);
    expect(content.type).toBe("audio");
  });

  it("maps voice note", () => {
    const att: SignalAttachment = {
      contentType: "audio/aac",
      id: "att-voice",
      voiceNote: true,
    };
    const content = mapSignalAttachmentToContent(att, ATTACH_BASE);
    expect(content.type).toBe("voice");
  });

  it("maps unknown type as file", () => {
    const att: SignalAttachment = {
      contentType: "application/pdf",
      id: "att-pdf",
      filename: "doc.pdf",
      size: 2048,
    };
    const content = mapSignalAttachmentToContent(att, ATTACH_BASE);
    expect(content).toEqual({
      type: "file",
      url: `${ATTACH_BASE}/att-pdf`,
      filename: "doc.pdf",
      size: 2048,
    });
  });

  it("handles missing id with empty url", () => {
    const att: SignalAttachment = { contentType: "image/png" };
    const content = mapSignalAttachmentToContent(att, ATTACH_BASE);
    expect(content.type).toBe("image");
    if (content.type === "image") {
      expect(content.url).toBe("");
    }
  });
});

describe("mapSignalMessageContent", () => {
  it("returns text content for text-only messages", () => {
    const dm: SignalDataMessage = { message: "hello world" };
    const content = mapSignalMessageContent(dm, ATTACH_BASE);
    expect(content).toEqual({ type: "text", text: "hello world" });
  });

  it("returns empty text for null message", () => {
    const dm: SignalDataMessage = { message: null };
    const content = mapSignalMessageContent(dm, ATTACH_BASE);
    expect(content).toEqual({ type: "text", text: "" });
  });

  it("returns attachment content when attachments present", () => {
    const dm: SignalDataMessage = {
      message: "check this photo",
      attachments: [{ contentType: "image/jpeg", id: "att-1" }],
    };
    const content = mapSignalMessageContent(dm, ATTACH_BASE);
    expect(content.type).toBe("image");
    if (content.type === "image") {
      expect(content.caption).toBe("check this photo");
    }
  });

  it("adds caption to video attachment", () => {
    const dm: SignalDataMessage = {
      message: "funny video",
      attachments: [{ contentType: "video/mp4", id: "v-1" }],
    };
    const content = mapSignalMessageContent(dm, ATTACH_BASE);
    expect(content.type).toBe("video");
    if (content.type === "video") {
      expect(content.caption).toBe("funny video");
    }
  });

  it("does not add caption to audio attachment", () => {
    const dm: SignalDataMessage = {
      message: "listen",
      attachments: [{ contentType: "audio/mpeg", id: "a-1" }],
    };
    const content = mapSignalMessageContent(dm, ATTACH_BASE);
    expect(content.type).toBe("audio");
    // Audio doesn't support captions
    expect("caption" in content).toBe(false);
  });
});

describe("mapSignalQuoteToReplyRef", () => {
  it("maps a quote to a partial message reference", () => {
    const ref = mapSignalQuoteToReplyRef({
      id: 1700000000000,
      authorNumber: PEER,
      text: "original message",
    });
    expect(ref).toBeDefined();
    expect(ref!.id).toBe("1700000000000");
    expect(ref!.sender.id).toBe(PEER);
    expect(ref!.content).toEqual({ type: "text", text: "original message" });
  });

  it("returns undefined for quote without id", () => {
    const ref = mapSignalQuoteToReplyRef({ authorNumber: PEER });
    expect(ref).toBeUndefined();
  });

  it("uses author field as fallback for authorNumber", () => {
    const ref = mapSignalQuoteToReplyRef({
      id: 123456,
      author: "uuid-abc",
    });
    expect(ref!.sender.id).toBe("uuid-abc");
  });
});

describe("mapSignalReaction", () => {
  it("maps a reaction envelope", () => {
    const env: SignalEnvelope = {
      sourceNumber: PEER,
      timestamp: 1700000000000,
      dataMessage: {
        reaction: {
          emoji: "👍",
          targetAuthorNumber: SELF,
          targetSentTimestamp: 1699999999999,
        },
      },
    };
    const reaction = mapSignalReaction(env);
    expect(reaction).toBeDefined();
    expect(reaction!.emoji).toBe("👍");
    expect(reaction!.user.id).toBe(PEER);
  });

  it("returns undefined when no reaction in envelope", () => {
    const env: SignalEnvelope = {
      sourceNumber: PEER,
      dataMessage: { message: "text" },
    };
    expect(mapSignalReaction(env)).toBeUndefined();
  });

  it("returns undefined when reaction has no emoji", () => {
    const env: SignalEnvelope = {
      sourceNumber: PEER,
      dataMessage: {
        reaction: { targetSentTimestamp: 123 },
      },
    };
    expect(mapSignalReaction(env)).toBeUndefined();
  });
});

describe("mapSignalEnvelopeToMessage", () => {
  it("maps a text message envelope", () => {
    const env: SignalEnvelope = {
      sourceNumber: PEER,
      sourceName: "Alice",
      timestamp: 1700000000000,
      dataMessage: {
        timestamp: 1700000000000,
        message: "hello",
      },
    };
    const msg = mapSignalEnvelopeToMessage(env, SELF, ATTACH_BASE);
    expect(msg).toBeDefined();
    expect(msg!.id).toBe("1700000000000");
    expect(msg!.sender.id).toBe(PEER);
    expect(msg!.sender.displayName).toBe("Alice");
    expect(msg!.content).toEqual({ type: "text", text: "hello" });
    expect(msg!.conversation.type).toBe("dm");
  });

  it("returns undefined for envelope without dataMessage", () => {
    const env: SignalEnvelope = { sourceNumber: PEER };
    expect(mapSignalEnvelopeToMessage(env, SELF, ATTACH_BASE)).toBeUndefined();
  });

  it("returns undefined for reaction-only envelopes", () => {
    const env: SignalEnvelope = {
      sourceNumber: PEER,
      dataMessage: {
        reaction: { emoji: "❤️", targetSentTimestamp: 123 },
      },
    };
    expect(mapSignalEnvelopeToMessage(env, SELF, ATTACH_BASE)).toBeUndefined();
  });

  it("includes replyTo when quote present", () => {
    const env: SignalEnvelope = {
      sourceNumber: PEER,
      timestamp: 1700000000000,
      dataMessage: {
        timestamp: 1700000000000,
        message: "replying",
        quote: { id: 1699999999999, authorNumber: SELF, text: "original" },
      },
    };
    const msg = mapSignalEnvelopeToMessage(env, SELF, ATTACH_BASE);
    expect(msg!.replyTo).toBeDefined();
    expect(msg!.replyTo!.id).toBe("1699999999999");
    expect(msg!.replyTo!.sender.id).toBe(SELF);
  });

  it("maps attachment message", () => {
    const env: SignalEnvelope = {
      sourceNumber: PEER,
      timestamp: 1700000000000,
      dataMessage: {
        timestamp: 1700000000000,
        attachments: [{ contentType: "image/png", id: "att-1" }],
      },
    };
    const msg = mapSignalEnvelopeToMessage(env, SELF, ATTACH_BASE);
    expect(msg!.content.type).toBe("image");
  });

  it("maps group message", () => {
    const env: SignalEnvelope = {
      sourceNumber: PEER,
      timestamp: 1700000000000,
      dataMessage: {
        timestamp: 1700000000000,
        message: "group msg",
        groupInfo: { groupId: "grp-1" },
      },
    };
    const msg = mapSignalEnvelopeToMessage(env, SELF, ATTACH_BASE);
    expect(msg!.conversation.type).toBe("group");
    expect(msg!.conversation.id).toBe("grp-1");
  });
});
