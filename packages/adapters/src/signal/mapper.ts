/**
 * Maps between signal-cli envelope format and unified messaging types.
 *
 * signal-cli uses phone numbers as the primary identifier and returns
 * envelopes via JSON-RPC. This module translates that into the framework's
 * Conversation, User, Message, and MessageContent types.
 */
import type {
  Conversation,
  Message,
  MessageContent,
  Reaction,
  User,
} from "@chat-framework/core";
import type {
  SignalAttachment,
  SignalDataMessage,
  SignalEnvelope,
  SignalQuote,
} from "./types.js";

/**
 * Build a User from a Signal phone number and optional display name.
 * Uses the phone number as the canonical ID since Signal is phone-based.
 */
export function mapSignalUser(
  phoneNumber: string,
  displayName?: string,
): User {
  return {
    id: phoneNumber,
    platform: "signal",
    username: phoneNumber,
    displayName: displayName ?? phoneNumber,
  };
}

/**
 * Build a Conversation from a signal-cli envelope.
 *
 * If the message has groupInfo, it's a group conversation keyed by groupId.
 * Otherwise it's a DM keyed by the source phone number.
 */
export function mapSignalConversation(
  envelope: SignalEnvelope,
  selfNumber: string,
): Conversation {
  const dataMsg = envelope.dataMessage;
  const group = dataMsg?.groupInfo;
  const source = envelope.sourceNumber ?? envelope.source ?? "";

  if (group?.groupId) {
    return {
      id: group.groupId,
      platform: "signal",
      participants: [],
      type: "group",
      metadata: { groupType: group.type },
    };
  }

  const sender = mapSignalUser(source);
  const self = mapSignalUser(selfNumber);

  return {
    id: source,
    platform: "signal",
    participants: source === selfNumber ? [self] : [sender, self],
    type: "dm",
    metadata: {},
  };
}

/**
 * Map a signal-cli attachment to a MessageContent union member.
 * Uses MIME content type to determine the appropriate variant.
 */
export function mapSignalAttachmentToContent(
  attachment: SignalAttachment,
  attachmentBaseUrl: string,
): MessageContent {
  const url = attachment.id
    ? `${attachmentBaseUrl}/${attachment.id}`
    : "";
  const contentType = attachment.contentType ?? "";

  if (attachment.voiceNote) {
    return { type: "voice", url, duration: 0 };
  }

  if (contentType.startsWith("image/")) {
    return { type: "image", url };
  }

  if (contentType.startsWith("video/")) {
    return { type: "video", url };
  }

  if (contentType.startsWith("audio/")) {
    return { type: "audio", url, duration: 0 };
  }

  return {
    type: "file",
    url,
    filename: attachment.filename ?? "unknown",
    size: attachment.size ?? 0,
  };
}

/**
 * Determine the primary MessageContent for a signal-cli data message.
 *
 * Priority:
 * 1. Attachments (first one becomes primary content)
 * 2. Text message body
 * 3. Fallback to empty text
 */
export function mapSignalMessageContent(
  dataMsg: SignalDataMessage,
  attachmentBaseUrl: string,
): MessageContent {
  if (dataMsg.attachments && dataMsg.attachments.length > 0) {
    const content = mapSignalAttachmentToContent(
      dataMsg.attachments[0],
      attachmentBaseUrl,
    );
    // Attach caption from message body if content supports it
    if (
      dataMsg.message &&
      (content.type === "image" || content.type === "video")
    ) {
      return { ...content, caption: dataMsg.message };
    }
    return content;
  }

  return { type: "text", text: dataMsg.message ?? "" };
}

/**
 * Map a signal-cli quote to a partial reply Message reference.
 * Only fills id, timestamp, and sender — the full message isn't available
 * without a separate lookup.
 */
export function mapSignalQuoteToReplyRef(
  quote: SignalQuote,
): Message | undefined {
  if (!quote.id) return undefined;

  const author = quote.authorNumber ?? quote.author ?? "";
  return {
    id: String(quote.id),
    conversation: {
      id: "",
      platform: "signal",
      participants: [],
      type: "dm",
      metadata: {},
    },
    sender: mapSignalUser(author),
    timestamp: new Date(quote.id),
    content: { type: "text", text: quote.text ?? "" },
  };
}

/**
 * Map a signal-cli reaction to the unified Reaction type.
 */
export function mapSignalReaction(
  envelope: SignalEnvelope,
): Reaction | undefined {
  const reaction = envelope.dataMessage?.reaction;
  if (!reaction?.emoji) return undefined;

  const source = envelope.sourceNumber ?? envelope.source ?? "";
  return {
    emoji: reaction.emoji,
    user: mapSignalUser(source),
    timestamp: new Date(envelope.timestamp ?? Date.now()),
  };
}

/**
 * Map a full signal-cli envelope to the unified Message type.
 * Returns undefined if the envelope doesn't contain a meaningful data message.
 */
export function mapSignalEnvelopeToMessage(
  envelope: SignalEnvelope,
  selfNumber: string,
  attachmentBaseUrl: string,
): Message | undefined {
  const dataMsg = envelope.dataMessage;
  if (!dataMsg) return undefined;

  // Reaction-only envelopes don't produce a regular message
  if (dataMsg.reaction && !dataMsg.message && !dataMsg.attachments?.length) {
    return undefined;
  }

  const source = envelope.sourceNumber ?? envelope.source ?? "";
  const sender = mapSignalUser(source, envelope.sourceName);
  const conversation = mapSignalConversation(envelope, selfNumber);
  const content = mapSignalMessageContent(dataMsg, attachmentBaseUrl);
  const replyTo = dataMsg.quote
    ? mapSignalQuoteToReplyRef(dataMsg.quote)
    : undefined;

  const ts = dataMsg.timestamp ?? envelope.timestamp ?? Date.now();
  return {
    id: String(ts),
    conversation,
    sender,
    timestamp: new Date(ts),
    content,
    replyTo,
  };
}
