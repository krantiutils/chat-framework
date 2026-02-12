import { describe, it, expect } from "vitest";
import {
  jidToPhone,
  isGroupJid,
  mapWhatsAppUser,
  mapWhatsAppConversation,
  mapWhatsAppMessageContent,
  mapWhatsAppMessage,
  mapWhatsAppReaction,
  buildReactionTargetStub,
  unwrapMessageContent,
} from "../whatsapp/mapper.js";
import type { WAMessage } from "@whiskeysockets/baileys";

const SELF_JID = "15551234567@s.whatsapp.net";
const PEER_JID = "15559876543@s.whatsapp.net";
const GROUP_JID = "120363012345678901@g.us";

// ── JID Utilities ────────────────────────────────────────────────────────────

describe("jidToPhone", () => {
  it("extracts phone from user JID", () => {
    expect(jidToPhone("15551234567@s.whatsapp.net")).toBe("15551234567");
  });

  it("extracts group id from group JID", () => {
    expect(jidToPhone("120363012345678901@g.us")).toBe("120363012345678901");
  });

  it("returns input if no @ present", () => {
    expect(jidToPhone("15551234567")).toBe("15551234567");
  });
});

describe("isGroupJid", () => {
  it("returns true for group JIDs", () => {
    expect(isGroupJid(GROUP_JID)).toBe(true);
  });

  it("returns false for user JIDs", () => {
    expect(isGroupJid(PEER_JID)).toBe(false);
  });
});

// ── User Mapping ─────────────────────────────────────────────────────────────

describe("mapWhatsAppUser", () => {
  it("uses JID as id and phone as username", () => {
    const user = mapWhatsAppUser(PEER_JID);
    expect(user).toEqual({
      id: PEER_JID,
      platform: "whatsapp",
      username: "15559876543",
      displayName: "15559876543",
    });
  });

  it("uses pushName as displayName when provided", () => {
    const user = mapWhatsAppUser(PEER_JID, "Alice");
    expect(user.displayName).toBe("Alice");
    expect(user.id).toBe(PEER_JID);
  });

  it("handles null pushName", () => {
    const user = mapWhatsAppUser(PEER_JID, null);
    expect(user.displayName).toBe("15559876543");
  });
});

// ── Conversation Mapping ─────────────────────────────────────────────────────

describe("mapWhatsAppConversation", () => {
  it("returns DM conversation for user JID", () => {
    const conv = mapWhatsAppConversation(PEER_JID, SELF_JID);
    expect(conv.type).toBe("dm");
    expect(conv.platform).toBe("whatsapp");
    expect(conv.id).toBe(PEER_JID);
    expect(conv.participants).toHaveLength(2);
  });

  it("returns group conversation for group JID", () => {
    const conv = mapWhatsAppConversation(GROUP_JID, SELF_JID);
    expect(conv.type).toBe("group");
    expect(conv.id).toBe(GROUP_JID);
    expect(conv.participants).toEqual([]);
  });
});

// ── Content Unwrapping ───────────────────────────────────────────────────────

describe("unwrapMessageContent", () => {
  it("returns null/undefined as undefined", () => {
    expect(unwrapMessageContent(null)).toBeUndefined();
    expect(unwrapMessageContent(undefined)).toBeUndefined();
  });

  it("returns plain messages as-is", () => {
    const msg = { conversation: "hello" };
    expect(unwrapMessageContent(msg)).toEqual(msg);
  });

  it("unwraps viewOnceMessage", () => {
    const inner = { imageMessage: { url: "https://example.com/img.jpg" } };
    const msg = { viewOnceMessage: { message: inner } };
    expect(unwrapMessageContent(msg)).toEqual(inner);
  });

  it("unwraps viewOnceMessageV2", () => {
    const inner = { videoMessage: { url: "https://example.com/vid.mp4" } };
    const msg = { viewOnceMessageV2: { message: inner } };
    expect(unwrapMessageContent(msg)).toEqual(inner);
  });

  it("unwraps ephemeralMessage", () => {
    const inner = { conversation: "ephemeral text" };
    const msg = { ephemeralMessage: { message: inner } };
    expect(unwrapMessageContent(msg)).toEqual(inner);
  });

  it("unwraps documentWithCaptionMessage", () => {
    const inner = { documentMessage: { fileName: "doc.pdf" } };
    const msg = { documentWithCaptionMessage: { message: inner } };
    expect(unwrapMessageContent(msg)).toEqual(inner);
  });

  it("unwraps nested wrappers recursively", () => {
    const inner = { conversation: "deep" };
    const msg = {
      ephemeralMessage: {
        message: { viewOnceMessage: { message: inner } },
      },
    };
    expect(unwrapMessageContent(msg)).toEqual(inner);
  });
});

// ── Message Content Mapping ──────────────────────────────────────────────────

describe("mapWhatsAppMessageContent", () => {
  it("maps plain conversation text", () => {
    const content = mapWhatsAppMessageContent({ conversation: "hello" });
    expect(content).toEqual({ type: "text", text: "hello" });
  });

  it("maps extended text message", () => {
    const content = mapWhatsAppMessageContent({
      extendedTextMessage: { text: "hello with formatting" },
    });
    expect(content).toEqual({ type: "text", text: "hello with formatting" });
  });

  it("maps image message", () => {
    const content = mapWhatsAppMessageContent({
      imageMessage: { url: "https://example.com/img.jpg", caption: "a photo" },
    });
    expect(content).toEqual({
      type: "image",
      url: "https://example.com/img.jpg",
      caption: "a photo",
    });
  });

  it("maps image message without caption", () => {
    const content = mapWhatsAppMessageContent({
      imageMessage: { url: "https://example.com/img.jpg" },
    });
    expect(content).toEqual({
      type: "image",
      url: "https://example.com/img.jpg",
      caption: undefined,
    });
  });

  it("maps video message", () => {
    const content = mapWhatsAppMessageContent({
      videoMessage: { url: "https://example.com/vid.mp4", caption: "a video" },
    });
    expect(content).toEqual({
      type: "video",
      url: "https://example.com/vid.mp4",
      caption: "a video",
    });
  });

  it("maps audio message (non-ptt)", () => {
    const content = mapWhatsAppMessageContent({
      audioMessage: { url: "https://example.com/audio.mp3", seconds: 120, ptt: false },
    });
    expect(content).toEqual({
      type: "audio",
      url: "https://example.com/audio.mp3",
      duration: 120,
    });
  });

  it("maps voice note (ptt audio)", () => {
    const content = mapWhatsAppMessageContent({
      audioMessage: { url: "https://example.com/voice.ogg", seconds: 5, ptt: true },
    });
    expect(content).toEqual({
      type: "voice",
      url: "https://example.com/voice.ogg",
      duration: 5,
    });
  });

  it("maps document message", () => {
    const content = mapWhatsAppMessageContent({
      documentMessage: {
        url: "https://example.com/doc.pdf",
        fileName: "report.pdf",
        fileLength: 2048,
      },
    });
    expect(content).toEqual({
      type: "file",
      url: "https://example.com/doc.pdf",
      filename: "report.pdf",
      size: 2048,
    });
  });

  it("maps sticker message", () => {
    const sha256 = new Uint8Array([0xab, 0xcd, 0xef]);
    const content = mapWhatsAppMessageContent({
      stickerMessage: { url: "https://example.com/sticker.webp", fileSha256: sha256 },
    });
    expect(content.type).toBe("sticker");
    if (content.type === "sticker") {
      expect(content.url).toBe("https://example.com/sticker.webp");
      expect(content.id).toBe("abcdef");
    }
  });

  it("maps location message", () => {
    const content = mapWhatsAppMessageContent({
      locationMessage: {
        degreesLatitude: 40.7128,
        degreesLongitude: -74.006,
        name: "NYC",
      },
    });
    expect(content).toEqual({
      type: "location",
      lat: 40.7128,
      lng: -74.006,
      name: "NYC",
    });
  });

  it("maps live location message", () => {
    const content = mapWhatsAppMessageContent({
      liveLocationMessage: {
        degreesLatitude: 51.5074,
        degreesLongitude: -0.1278,
      },
    });
    expect(content).toEqual({
      type: "location",
      lat: 51.5074,
      lng: -0.1278,
    });
  });

  it("maps contact message with vcard", () => {
    const content = mapWhatsAppMessageContent({
      contactMessage: {
        displayName: "Bob",
        vcard: "BEGIN:VCARD\nVERSION:3.0\nFN:Bob\nTEL;type=CELL:+1234567890\nEND:VCARD",
      },
    });
    expect(content).toEqual({
      type: "contact",
      name: "Bob",
      phone: "+1234567890",
    });
  });

  it("maps contact array message (takes first)", () => {
    const content = mapWhatsAppMessageContent({
      contactsArrayMessage: {
        contacts: [
          {
            displayName: "Alice",
            vcard: "BEGIN:VCARD\nTEL;type=CELL:+1111111111\nEND:VCARD",
          },
          { displayName: "Bob" },
        ],
      },
    });
    expect(content).toEqual({
      type: "contact",
      name: "Alice",
      phone: "+1111111111",
    });
  });

  it("returns empty text for null/undefined", () => {
    expect(mapWhatsAppMessageContent(null)).toEqual({ type: "text", text: "" });
    expect(mapWhatsAppMessageContent(undefined)).toEqual({ type: "text", text: "" });
  });

  it("returns empty text for unknown message types", () => {
    const content = mapWhatsAppMessageContent({ protocolMessage: {} });
    expect(content).toEqual({ type: "text", text: "" });
  });

  it("unwraps viewOnce before mapping", () => {
    const content = mapWhatsAppMessageContent({
      viewOnceMessage: {
        message: {
          imageMessage: { url: "https://example.com/once.jpg", caption: "view once" },
        },
      },
    });
    expect(content).toEqual({
      type: "image",
      url: "https://example.com/once.jpg",
      caption: "view once",
    });
  });
});

// ── Full Message Mapping ─────────────────────────────────────────────────────

describe("mapWhatsAppMessage", () => {
  function makeWAMessage(overrides: Partial<WAMessage> = {}): WAMessage {
    return {
      key: {
        remoteJid: PEER_JID,
        fromMe: false,
        id: "MSG_001",
      },
      messageTimestamp: 1700000000,
      pushName: "Alice",
      message: { conversation: "hello" },
      ...overrides,
    };
  }

  it("maps a text message", () => {
    const msg = mapWhatsAppMessage(makeWAMessage(), SELF_JID);
    expect(msg).toBeDefined();
    expect(msg!.id).toBe("MSG_001");
    expect(msg!.content).toEqual({ type: "text", text: "hello" });
    expect(msg!.sender.displayName).toBe("Alice");
    expect(msg!.sender.id).toBe(PEER_JID);
    expect(msg!.conversation.type).toBe("dm");
    expect(msg!.conversation.id).toBe(PEER_JID);
  });

  it("handles fromMe messages", () => {
    const msg = mapWhatsAppMessage(
      makeWAMessage({ key: { remoteJid: PEER_JID, fromMe: true, id: "MSG_002" } }),
      SELF_JID,
    );
    expect(msg!.sender.id).toBe(SELF_JID);
  });

  it("handles group messages with participant", () => {
    const msg = mapWhatsAppMessage(
      makeWAMessage({
        key: {
          remoteJid: GROUP_JID,
          fromMe: false,
          id: "MSG_003",
          participant: PEER_JID,
        },
      }),
      SELF_JID,
    );
    expect(msg!.conversation.type).toBe("group");
    expect(msg!.conversation.id).toBe(GROUP_JID);
    expect(msg!.sender.id).toBe(PEER_JID);
  });

  it("returns undefined for messages without remoteJid", () => {
    const msg = mapWhatsAppMessage(
      makeWAMessage({ key: { remoteJid: undefined as unknown as string, id: "x" } }),
      SELF_JID,
    );
    expect(msg).toBeUndefined();
  });

  it("returns undefined for messages without content", () => {
    const msg = mapWhatsAppMessage(
      makeWAMessage({ message: undefined }),
      SELF_JID,
    );
    expect(msg).toBeUndefined();
  });

  it("returns undefined for protocol messages", () => {
    const msg = mapWhatsAppMessage(
      makeWAMessage({ message: { protocolMessage: { type: 0 } } }),
      SELF_JID,
    );
    expect(msg).toBeUndefined();
  });

  it("returns undefined for reaction-only messages", () => {
    const msg = mapWhatsAppMessage(
      makeWAMessage({
        message: {
          reactionMessage: {
            key: { remoteJid: PEER_JID, id: "target" },
            text: "👍",
          },
        },
      }),
      SELF_JID,
    );
    expect(msg).toBeUndefined();
  });

  it("includes replyTo for quoted messages", () => {
    const msg = mapWhatsAppMessage(
      makeWAMessage({
        message: {
          extendedTextMessage: {
            text: "replying",
            contextInfo: {
              stanzaId: "QUOTED_MSG_ID",
              participant: PEER_JID,
            },
          },
        },
      }),
      SELF_JID,
    );
    expect(msg!.replyTo).toBeDefined();
    expect(msg!.replyTo!.id).toBe("QUOTED_MSG_ID");
    expect(msg!.replyTo!.sender.id).toBe(PEER_JID);
  });

  it("converts timestamp from seconds to Date", () => {
    const msg = mapWhatsAppMessage(
      makeWAMessage({ messageTimestamp: 1700000000 }),
      SELF_JID,
    );
    expect(msg!.timestamp.getTime()).toBe(1700000000 * 1000);
  });

  it("maps media messages", () => {
    const msg = mapWhatsAppMessage(
      makeWAMessage({
        message: {
          imageMessage: { url: "https://example.com/img.jpg", caption: "pic" },
        },
      }),
      SELF_JID,
    );
    expect(msg!.content.type).toBe("image");
  });
});

// ── Reaction Mapping ─────────────────────────────────────────────────────────

describe("mapWhatsAppReaction", () => {
  it("maps a reaction", () => {
    const reaction = mapWhatsAppReaction(
      { text: "👍", senderTimestampMs: 1700000000000 },
      PEER_JID,
      "Alice",
    );
    expect(reaction).toBeDefined();
    expect(reaction!.emoji).toBe("👍");
    expect(reaction!.user.id).toBe(PEER_JID);
    expect(reaction!.user.displayName).toBe("Alice");
  });

  it("returns undefined for empty text (reaction removal)", () => {
    const reaction = mapWhatsAppReaction(
      { text: "", senderTimestampMs: 1700000000000 },
      PEER_JID,
    );
    expect(reaction).toBeUndefined();
  });

  it("returns undefined for null text", () => {
    const reaction = mapWhatsAppReaction(
      { text: null, senderTimestampMs: 1700000000000 },
      PEER_JID,
    );
    expect(reaction).toBeUndefined();
  });

  it("defaults timestamp to now when not provided", () => {
    const before = Date.now();
    const reaction = mapWhatsAppReaction({ text: "❤️" }, PEER_JID);
    expect(reaction!.timestamp.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("buildReactionTargetStub", () => {
  it("builds stub for DM target", () => {
    const stub = buildReactionTargetStub(
      { remoteJid: PEER_JID, fromMe: false, id: "TARGET_001" },
      SELF_JID,
    );
    expect(stub.id).toBe("TARGET_001");
    expect(stub.conversation.id).toBe(PEER_JID);
    expect(stub.sender.id).toBe(PEER_JID);
  });

  it("builds stub for fromMe target", () => {
    const stub = buildReactionTargetStub(
      { remoteJid: PEER_JID, fromMe: true, id: "TARGET_002" },
      SELF_JID,
    );
    expect(stub.sender.id).toBe(SELF_JID);
  });

  it("builds stub for group target with participant", () => {
    const stub = buildReactionTargetStub(
      { remoteJid: GROUP_JID, fromMe: false, id: "TARGET_003", participant: PEER_JID },
      SELF_JID,
    );
    expect(stub.conversation.type).toBe("group");
    expect(stub.sender.id).toBe(PEER_JID);
  });
});
