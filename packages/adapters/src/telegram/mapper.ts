/**
 * Maps between Telegram Bot API types and unified messaging types.
 *
 * Telegram uses numeric user/chat IDs and returns rich message objects.
 * This module translates those into the framework's Conversation, User,
 * Message, MessageContent, and Reaction types.
 */
import type {
  Conversation,
  ConversationType,
  Message,
  MessageContent,
  Reaction,
  User,
} from "@chat-framework/core";

import type {
  TelegramChat,
  TelegramMessage,
  TelegramMessageReactionUpdated,
  TelegramPhotoSize,
  TelegramUser,
} from "./types.js";

/**
 * Build a User from a Telegram user object.
 * Uses the numeric Telegram user ID (stringified) as the canonical ID.
 */
export function mapTelegramUser(tgUser: TelegramUser): User {
  const displayName = tgUser.last_name
    ? `${tgUser.first_name} ${tgUser.last_name}`
    : tgUser.first_name;

  return {
    id: String(tgUser.id),
    platform: "telegram",
    username: tgUser.username,
    displayName,
  };
}

/**
 * Map a Telegram chat type to the unified ConversationType.
 */
export function mapTelegramChatType(
  type: TelegramChat["type"],
): ConversationType {
  switch (type) {
    case "private":
      return "dm";
    case "channel":
      return "channel";
    case "group":
    case "supergroup":
      return "group";
    default:
      return "group";
  }
}

/**
 * Build a Conversation from a Telegram chat object.
 */
export function mapTelegramConversation(chat: TelegramChat): Conversation {
  return {
    id: String(chat.id),
    platform: "telegram",
    participants: [],
    type: mapTelegramChatType(chat.type),
    metadata: {
      title: chat.title,
      username: chat.username,
      chatType: chat.type,
    },
  };
}

/**
 * Pick the largest photo from a Telegram photo array.
 * Telegram sends multiple sizes; we want the highest resolution.
 */
export function pickLargestPhoto(
  photos: readonly TelegramPhotoSize[],
): TelegramPhotoSize | undefined {
  if (photos.length === 0) return undefined;

  let largest = photos[0];
  for (let i = 1; i < photos.length; i++) {
    const current = photos[i];
    if (current.width * current.height > largest.width * largest.height) {
      largest = current;
    }
  }
  return largest;
}

/**
 * Determine the primary MessageContent for a Telegram message.
 *
 * Priority (matching Telegram's mutual exclusivity):
 * 1. Photo
 * 2. Video
 * 3. Audio
 * 4. Voice
 * 5. Document (generic file)
 * 6. Sticker
 * 7. Location
 * 8. Contact
 * 9. Text
 * 10. Fallback to empty text
 */
export function mapTelegramMessageContent(
  msg: TelegramMessage,
): MessageContent {
  if (msg.photo && msg.photo.length > 0) {
    const largest = pickLargestPhoto(msg.photo);
    return {
      type: "image",
      url: largest?.file_id ?? "",
      caption: msg.caption,
    };
  }

  if (msg.video) {
    return {
      type: "video",
      url: msg.video.file_id,
      caption: msg.caption,
    };
  }

  if (msg.audio) {
    return {
      type: "audio",
      url: msg.audio.file_id,
      duration: msg.audio.duration,
    };
  }

  if (msg.voice) {
    return {
      type: "voice",
      url: msg.voice.file_id,
      duration: msg.voice.duration,
    };
  }

  if (msg.document) {
    return {
      type: "file",
      url: msg.document.file_id,
      filename: msg.document.file_name ?? "unknown",
      size: msg.document.file_size ?? 0,
    };
  }

  if (msg.sticker) {
    return {
      type: "sticker",
      id: msg.sticker.file_id,
      url: msg.sticker.file_id,
    };
  }

  if (msg.location) {
    return {
      type: "location",
      lat: msg.location.latitude,
      lng: msg.location.longitude,
    };
  }

  if (msg.contact) {
    return {
      type: "contact",
      name: msg.contact.last_name
        ? `${msg.contact.first_name} ${msg.contact.last_name}`
        : msg.contact.first_name,
      phone: msg.contact.phone_number,
    };
  }

  return { type: "text", text: msg.text ?? "" };
}

/**
 * Map a Telegram message to the unified Message type.
 * Returns undefined if the message has no sender (shouldn't happen in practice).
 */
export function mapTelegramMessage(
  msg: TelegramMessage,
): Message | undefined {
  if (!msg.from) return undefined;

  const sender = mapTelegramUser(msg.from);
  const conversation = mapTelegramConversation(msg.chat);
  const content = mapTelegramMessageContent(msg);

  const replyTo = msg.reply_to_message
    ? mapTelegramMessage(msg.reply_to_message)
    : undefined;

  return {
    id: String(msg.message_id),
    conversation,
    sender,
    timestamp: new Date(msg.date * 1000),
    content,
    replyTo,
  };
}

/**
 * Map a Telegram message_reaction update to unified Reaction(s).
 *
 * Telegram sends the full old and new reaction lists. We compute the diff
 * to determine which reactions were added. Returns the added reactions.
 */
export function mapTelegramReactions(
  update: TelegramMessageReactionUpdated,
): Reaction[] {
  if (!update.user) return [];

  const user = mapTelegramUser(update.user);
  const timestamp = new Date(update.date * 1000);

  const oldEmojis = new Set(
    update.old_reaction
      .filter((r) => r.type === "emoji" && r.emoji)
      .map((r) => r.emoji!),
  );

  const added: Reaction[] = [];
  for (const reaction of update.new_reaction) {
    if (reaction.type === "emoji" && reaction.emoji && !oldEmojis.has(reaction.emoji)) {
      added.push({ emoji: reaction.emoji, user, timestamp });
    }
  }

  return added;
}
