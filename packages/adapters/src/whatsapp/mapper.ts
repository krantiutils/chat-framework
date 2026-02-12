/**
 * Maps between Baileys WAMessage format and unified messaging types.
 *
 * Baileys uses protobuf-based message structures where the content is
 * determined by which field is populated on proto.IMessage. This module
 * translates those into the framework's Conversation, User, Message,
 * and MessageContent types.
 *
 * Key Baileys concepts:
 * - JID (Jabber ID): User/group identifier. Users end in @s.whatsapp.net,
 *   groups end in @g.us, LID format uses @lid.
 * - WAMessage: Wrapper (IWebMessageInfo) with key, message, timestamp,
 *   pushName, participant (for groups).
 * - proto.IMessage: The actual content — a union where exactly one field
 *   is populated (conversation, imageMessage, audioMessage, etc.).
 */
import type {
  WAMessage,
  WAMessageKey,
  proto,
} from "@whiskeysockets/baileys";

import type {
  Conversation,
  ConversationType,
  Message,
  MessageContent,
  Reaction,
  User,
} from "@chat-framework/core";

// ── JID Utilities ────────────────────────────────────────────────────────────

/** Extract the phone number / user portion from a JID. */
export function jidToPhone(jid: string): string {
  return jid.replace(/@.*$/, "");
}

/** Whether a JID represents a group chat. */
export function isGroupJid(jid: string): boolean {
  return jid.endsWith("@g.us");
}

// ── User Mapping ─────────────────────────────────────────────────────────────

/**
 * Build a User from a WhatsApp JID and optional display name.
 * Uses the phone number portion as the canonical username.
 */
export function mapWhatsAppUser(
  jid: string,
  pushName?: string | null,
): User {
  const phone = jidToPhone(jid);
  return {
    id: jid,
    platform: "whatsapp",
    username: phone,
    displayName: pushName ?? phone,
  };
}

// ── Conversation Mapping ─────────────────────────────────────────────────────

/**
 * Build a Conversation from a WAMessage.
 *
 * For group messages, key.remoteJid is the group JID and
 * key.participant / msg.participant is the sender's JID.
 * For DMs, key.remoteJid is the peer's JID.
 */
export function mapWhatsAppConversation(
  remoteJid: string,
  selfJid: string,
): Conversation {
  const type: ConversationType = isGroupJid(remoteJid) ? "group" : "dm";
  return {
    id: remoteJid,
    platform: "whatsapp",
    participants: type === "dm"
      ? [mapWhatsAppUser(remoteJid), mapWhatsAppUser(selfJid)]
      : [],
    type,
    metadata: {},
  };
}

// ── Message Content Mapping ──────────────────────────────────────────────────

/**
 * Extract the "real" message content from a Baileys proto.IMessage.
 *
 * Baileys wraps some messages in containers (viewOnceMessage,
 * ephemeralMessage, documentWithCaptionMessage, viewOnceMessageV2).
 * This function unwraps those containers to get the actual content.
 */
export function unwrapMessageContent(
  msg: proto.IMessage | null | undefined,
): proto.IMessage | undefined {
  if (!msg) return undefined;

  // Unwrap view-once, ephemeral, and document-with-caption wrappers
  const inner =
    msg.viewOnceMessage?.message ??
    msg.viewOnceMessageV2?.message ??
    msg.ephemeralMessage?.message ??
    msg.documentWithCaptionMessage?.message ??
    msg.editedMessage?.message;

  if (inner) return unwrapMessageContent(inner);
  return msg;
}

/**
 * Map a Baileys proto.IMessage to the unified MessageContent type.
 *
 * Priority order matches the proto field that's actually populated.
 * Falls back to empty text if no recognizable content is found.
 */
export function mapWhatsAppMessageContent(
  raw: proto.IMessage | null | undefined,
): MessageContent {
  const msg = unwrapMessageContent(raw);
  if (!msg) return { type: "text", text: "" };

  // Plain text (the `conversation` field is for simple text messages)
  if (msg.conversation) {
    return { type: "text", text: msg.conversation };
  }

  // Extended text (messages with formatting, links, mentions)
  if (msg.extendedTextMessage) {
    return { type: "text", text: msg.extendedTextMessage.text ?? "" };
  }

  // Image
  if (msg.imageMessage) {
    return {
      type: "image",
      url: msg.imageMessage.url ?? "",
      caption: msg.imageMessage.caption ?? undefined,
    };
  }

  // Video (regular or GIF)
  if (msg.videoMessage) {
    return {
      type: "video",
      url: msg.videoMessage.url ?? "",
      caption: msg.videoMessage.caption ?? undefined,
    };
  }

  // Audio — ptt (push-to-talk) means voice note
  if (msg.audioMessage) {
    if (msg.audioMessage.ptt) {
      return {
        type: "voice",
        url: msg.audioMessage.url ?? "",
        duration: msg.audioMessage.seconds ?? 0,
      };
    }
    return {
      type: "audio",
      url: msg.audioMessage.url ?? "",
      duration: msg.audioMessage.seconds ?? 0,
    };
  }

  // Document (files)
  if (msg.documentMessage) {
    return {
      type: "file",
      url: msg.documentMessage.url ?? "",
      filename: msg.documentMessage.fileName ?? "unknown",
      size: toLengthNumber(msg.documentMessage.fileLength),
    };
  }

  // Sticker
  if (msg.stickerMessage) {
    return {
      type: "sticker",
      id: msg.stickerMessage.fileSha256
        ? Buffer.from(msg.stickerMessage.fileSha256).toString("hex")
        : "",
      url: msg.stickerMessage.url ?? "",
    };
  }

  // Location
  if (msg.locationMessage) {
    return {
      type: "location",
      lat: msg.locationMessage.degreesLatitude ?? 0,
      lng: msg.locationMessage.degreesLongitude ?? 0,
      name: msg.locationMessage.name ?? undefined,
    };
  }

  // Live location (map to regular location)
  if (msg.liveLocationMessage) {
    return {
      type: "location",
      lat: msg.liveLocationMessage.degreesLatitude ?? 0,
      lng: msg.liveLocationMessage.degreesLongitude ?? 0,
    };
  }

  // Contact card
  if (msg.contactMessage) {
    const phone = extractPhoneFromVcard(msg.contactMessage.vcard);
    return {
      type: "contact",
      name: msg.contactMessage.displayName ?? "",
      phone,
    };
  }

  // Contact array (take first contact)
  if (msg.contactsArrayMessage?.contacts?.length) {
    const first = msg.contactsArrayMessage.contacts[0];
    const phone = extractPhoneFromVcard(first.vcard);
    return {
      type: "contact",
      name: first.displayName ?? "",
      phone,
    };
  }

  // Fallback
  return { type: "text", text: "" };
}

// ── Full Message Mapping ─────────────────────────────────────────────────────

/**
 * Map a Baileys WAMessage to the unified Message type.
 * Returns undefined if the message has no meaningful content (e.g. protocol
 * messages, reaction-only messages, or stub messages).
 */
export function mapWhatsAppMessage(
  waMsg: WAMessage,
  selfJid: string,
): Message | undefined {
  const key = waMsg.key;
  if (!key?.remoteJid) return undefined;

  const raw = waMsg.message;

  // Skip protocol messages (read receipts, delivery acks, etc.)
  const unwrapped = unwrapMessageContent(raw);
  if (!unwrapped) return undefined;

  // Skip reaction-only messages — those are handled separately
  if (unwrapped.reactionMessage && !unwrapped.conversation && !unwrapped.extendedTextMessage) {
    return undefined;
  }

  // Skip protocol messages
  if (unwrapped.protocolMessage) return undefined;

  const content = mapWhatsAppMessageContent(raw);

  // Determine sender
  const senderJid = key.fromMe
    ? selfJid
    : (key.participant ?? key.remoteJid ?? "");
  const sender = mapWhatsAppUser(senderJid, waMsg.pushName);

  const conversation = mapWhatsAppConversation(key.remoteJid, selfJid);
  const timestamp = toTimestamp(waMsg.messageTimestamp);

  // Build reply reference if this message quotes another
  const contextInfo = extractContextInfo(unwrapped);
  const replyTo = contextInfo?.stanzaId
    ? buildReplyRef(contextInfo, key.remoteJid, selfJid)
    : undefined;

  return {
    id: key.id ?? String(timestamp.getTime()),
    conversation,
    sender,
    timestamp,
    content,
    replyTo,
  };
}

// ── Reaction Mapping ─────────────────────────────────────────────────────────

/**
 * Extract a unified Reaction from a Baileys reaction event.
 *
 * Baileys emits reactions via `messages.reaction` with:
 * - key: the message key of the reacted-to message
 * - reaction: { key, text, senderTimestampMs }
 *
 * An empty `text` means the reaction was removed.
 */
export function mapWhatsAppReaction(
  reactionProto: proto.IReaction,
  senderJid: string,
  pushName?: string | null,
): Reaction | undefined {
  if (!reactionProto.text) return undefined;

  return {
    emoji: reactionProto.text,
    user: mapWhatsAppUser(senderJid, pushName),
    timestamp: new Date(
      toLongNumber(reactionProto.senderTimestampMs) || Date.now(),
    ),
  };
}

/**
 * Build a stub Message reference for a reaction target.
 * Only fills id, conversation, and timestamp — the full content
 * isn't available without a separate lookup.
 */
export function buildReactionTargetStub(
  targetKey: WAMessageKey,
  selfJid: string,
): Message {
  const remoteJid = targetKey.remoteJid ?? "";
  const senderJid = targetKey.fromMe
    ? selfJid
    : (targetKey.participant ?? remoteJid);

  return {
    id: targetKey.id ?? "",
    conversation: mapWhatsAppConversation(remoteJid, selfJid),
    sender: mapWhatsAppUser(senderJid),
    timestamp: new Date(0),
    content: { type: "text", text: "" },
  };
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Extract contextInfo from the first populated message field.
 * ContextInfo contains quote/reply references, mentions, etc.
 */
function extractContextInfo(
  msg: proto.IMessage,
): proto.IContextInfo | undefined {
  return (
    msg.extendedTextMessage?.contextInfo ??
    msg.imageMessage?.contextInfo ??
    msg.videoMessage?.contextInfo ??
    msg.audioMessage?.contextInfo ??
    msg.documentMessage?.contextInfo ??
    msg.stickerMessage?.contextInfo ??
    msg.locationMessage?.contextInfo ??
    msg.contactMessage?.contextInfo ??
    undefined
  ) ?? undefined;
}

/**
 * Build a partial Message reference from a ContextInfo quote.
 */
function buildReplyRef(
  ctx: proto.IContextInfo,
  remoteJid: string,
  selfJid: string,
): Message | undefined {
  if (!ctx.stanzaId) return undefined;

  const quotedSender = ctx.participant ?? remoteJid;
  return {
    id: ctx.stanzaId,
    conversation: mapWhatsAppConversation(remoteJid, selfJid),
    sender: mapWhatsAppUser(quotedSender),
    timestamp: new Date(0),
    content: { type: "text", text: "" },
  };
}

/**
 * Convert a Baileys messageTimestamp (number | Long | null) to a Date.
 * Baileys timestamps are Unix seconds (not milliseconds).
 */
function toTimestamp(ts: number | Long | null | undefined): Date {
  const num = toLongNumber(ts);
  if (!num) return new Date();
  // Baileys timestamps are in seconds
  return new Date(num * 1000);
}

/**
 * Convert a Long or number to a plain number.
 * Baileys uses Long.js for 64-bit integers in some places.
 */
function toLongNumber(val: number | Long | null | undefined): number {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  // Long.js object — has toNumber()
  if (typeof val === "object" && "toNumber" in val) {
    return (val as { toNumber(): number }).toNumber();
  }
  return 0;
}

/**
 * Convert a file length (number | Long | null) to a number.
 */
function toLengthNumber(val: number | Long | null | undefined): number {
  return toLongNumber(val);
}

/**
 * Extract a phone number from a vCard string.
 * vCards contain TEL fields like "TEL;type=CELL:+1234567890".
 */
function extractPhoneFromVcard(vcard: string | null | undefined): string {
  if (!vcard) return "";
  const match = vcard.match(/TEL[^:]*:([+\d\s-]+)/i);
  return match ? match[1].replace(/[\s-]/g, "") : "";
}

// Long type used by protobuf.js — we don't import it directly to avoid
// adding a dependency; instead we duck-type via toLongNumber.
type Long = {
  toNumber(): number;
  toString(): string;
};
