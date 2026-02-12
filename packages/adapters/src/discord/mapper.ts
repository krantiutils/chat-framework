/**
 * Mapping functions: discord.js objects → unified chat-framework types.
 *
 * All functions are pure (no side effects) and safe to call with partial
 * discord.js objects — they gracefully degrade when optional fields are absent.
 */
import { ChannelType } from "discord.js";
import type {
  Attachment as DAttachment,
  Channel,
  Message as DMessage,
  MessageReaction as DReaction,
  PartialMessage as DPartialMessage,
  PartialUser as DPartialUser,
  User as DUser,
} from "discord.js";
import type {
  Conversation,
  ConversationType,
  Message,
  MessageContent,
  PlatformMetadata,
  Reaction,
  User,
} from "@chat-framework/core";

// ── User ────────────────────────────────────────────────────────────────────

/**
 * Map a discord.js User (or PartialUser) to a unified User.
 * PartialUser may lack username/displayName — those fields are optional
 * in the unified type so this is safe.
 */
export function mapDiscordUser(user: DUser | DPartialUser): User {
  const full = user as DUser;
  return {
    id: user.id,
    platform: "discord",
    username: full.username ?? undefined,
    displayName: full.displayName ?? full.username ?? undefined,
    avatar: full.avatarURL?.() ?? full.displayAvatarURL?.() ?? undefined,
  };
}

// ── Conversation ────────────────────────────────────────────────────────────

/**
 * Resolve the unified ConversationType from a discord.js channel type.
 */
function resolveConversationType(channel: Channel): ConversationType {
  switch (channel.type) {
    case ChannelType.DM:
      return "dm";
    case ChannelType.GroupDM:
      return "group";
    default:
      return "channel";
  }
}

/**
 * Build platform metadata for a discord.js channel.
 */
function buildChannelMetadata(channel: Channel): PlatformMetadata {
  const meta: PlatformMetadata = {};

  if ("guild" in channel && channel.guild) {
    const guild = channel.guild as { id: string; name: string };
    meta.guildId = guild.id;
    meta.guildName = guild.name;
  }

  if ("name" in channel && channel.name) {
    meta.channelName = channel.name as string;
  }

  if ("parentId" in channel && channel.parentId) {
    meta.parentChannelId = channel.parentId as string;
  }

  // Thread channels have isThread()
  if ("isThread" in channel && typeof channel.isThread === "function" && channel.isThread()) {
    meta.threadId = channel.id;
  }

  return meta;
}

/**
 * Build the participants list for a channel.
 * - DM: the recipient (bot user excluded since we don't have a reference here)
 * - GroupDM: all recipients
 * - Guild channels: empty array (too many members to enumerate)
 */
function buildParticipants(channel: Channel): User[] {
  if (channel.type === ChannelType.DM) {
    const dm = channel as { recipient: DUser | null };
    return dm.recipient ? [mapDiscordUser(dm.recipient)] : [];
  }

  if (channel.type === ChannelType.GroupDM) {
    // PartialGroupDMChannel.recipients is PartialRecipient[] (username-only)
    // We can't build full User objects from these, so return empty.
    // Full user data is only available when messages arrive.
    return [];
  }

  return [];
}

/**
 * Map a discord.js Channel to a unified Conversation.
 */
export function mapDiscordChannelToConversation(channel: Channel): Conversation {
  return {
    id: channel.id,
    platform: "discord",
    participants: buildParticipants(channel),
    type: resolveConversationType(channel),
    metadata: buildChannelMetadata(channel),
  };
}

// ── Message Content ─────────────────────────────────────────────────────────

/**
 * Map a single discord.js Attachment to unified MessageContent.
 */
export function mapDiscordAttachmentToContent(attachment: DAttachment): MessageContent {
  const contentType = attachment.contentType ?? "";
  const url = attachment.url;

  if (contentType.startsWith("image/")) {
    return { type: "image", url, caption: undefined };
  }
  if (contentType.startsWith("video/")) {
    return { type: "video", url, caption: undefined };
  }
  if (contentType.startsWith("audio/")) {
    return { type: "audio", url, duration: attachment.duration ?? 0 };
  }
  return {
    type: "file",
    url,
    filename: attachment.name ?? "unknown",
    size: attachment.size ?? 0,
  };
}

/**
 * Map a discord.js Message's full content to unified MessageContent.
 *
 * Priority:
 * 1. Attachments (first attachment determines type)
 * 2. Stickers
 * 3. Text content
 * 4. Empty text fallback
 *
 * When an image/video attachment has accompanying text, the text becomes
 * the caption (mirroring Signal adapter behavior).
 */
export function mapDiscordMessageToContent(msg: DMessage | DPartialMessage): MessageContent {
  // 1. Attachments
  const firstAttachment = msg.attachments?.first?.();
  if (firstAttachment) {
    const content = mapDiscordAttachmentToContent(firstAttachment);
    // Add caption from message text for image/video
    if (msg.content && (content.type === "image" || content.type === "video")) {
      return { ...content, caption: msg.content };
    }
    return content;
  }

  // 2. Stickers
  const firstSticker = msg.stickers?.first?.();
  if (firstSticker) {
    return {
      type: "sticker",
      id: firstSticker.id,
      url: firstSticker.url,
    };
  }

  // 3. Text content (or empty fallback)
  return { type: "text", text: msg.content ?? "" };
}

// ── Reaction ────────────────────────────────────────────────────────────────

/**
 * Map a discord.js MessageReaction + the reacting user to a unified Reaction.
 *
 * Discord custom emoji: `<:name:id>` format.
 * Unicode emoji: stored in `emoji.name`.
 * Discord does not provide per-reaction timestamps.
 */
export function mapDiscordReaction(
  reaction: DReaction,
  user: DUser | DPartialUser,
): Reaction {
  let emoji: string;
  if (reaction.emoji.id) {
    // Custom emoji — use Discord's formatted string
    const animated = reaction.emoji.animated ? "a" : "";
    emoji = `<${animated}:${reaction.emoji.name ?? "_"}:${reaction.emoji.id}>`;
  } else {
    emoji = reaction.emoji.name ?? "?";
  }

  return {
    emoji,
    user: mapDiscordUser(user),
    timestamp: new Date(),
  };
}

// ── Message ─────────────────────────────────────────────────────────────────

/**
 * Build a partial Message stub from a message reference.
 * Used for replyTo when the referenced message content isn't cached.
 */
function buildReplyReference(msg: DMessage): Message | undefined {
  const ref = msg.reference;
  if (!ref?.messageId) return undefined;

  // If the referenced message is cached (resolved), use it
  const resolved = msg.channel && "messages" in msg.channel
    ? (msg.channel.messages as { resolve(id: string): DMessage | null }).resolve(ref.messageId)
    : null;

  if (resolved) {
    return mapDiscordMessage(resolved);
  }

  // Otherwise build a minimal stub
  return {
    id: ref.messageId,
    conversation: mapDiscordChannelToConversation(msg.channel),
    sender: { id: "unknown", platform: "discord" },
    timestamp: new Date(0),
    content: { type: "text", text: "" },
  };
}

/**
 * Collect existing reactions from a discord.js Message into unified Reactions.
 * Only includes reactions where the user info is cached.
 */
function collectReactions(msg: DMessage): Reaction[] | undefined {
  if (!msg.reactions?.cache?.size) return undefined;

  const reactions: Reaction[] = [];
  for (const [, reaction] of msg.reactions.cache) {
    // We can only report the reaction emoji + count; individual users
    // require a separate API call. Store count in a minimal form.
    if (reaction.emoji.name || reaction.emoji.id) {
      let emoji: string;
      if (reaction.emoji.id) {
        const animated = reaction.emoji.animated ? "a" : "";
        emoji = `<${animated}:${reaction.emoji.name ?? "_"}:${reaction.emoji.id}>`;
      } else {
        emoji = reaction.emoji.name ?? "?";
      }
      reactions.push({
        emoji,
        user: { id: "aggregate", platform: "discord" },
        timestamp: new Date(),
      });
    }
  }

  return reactions.length > 0 ? reactions : undefined;
}

/**
 * Map a discord.js Message to a unified Message.
 */
export function mapDiscordMessage(msg: DMessage): Message {
  return {
    id: msg.id,
    conversation: mapDiscordChannelToConversation(msg.channel),
    sender: mapDiscordUser(msg.author),
    timestamp: msg.createdAt,
    content: mapDiscordMessageToContent(msg),
    replyTo: buildReplyReference(msg),
    reactions: collectReactions(msg),
  };
}

/**
 * Build a partial Message from a PartialMessage (used in event handlers
 * when the full message isn't cached and can't be fetched).
 */
export function mapPartialDiscordMessage(msg: DPartialMessage): Message {
  return {
    id: msg.id,
    conversation: mapDiscordChannelToConversation(msg.channel),
    sender: msg.author ? mapDiscordUser(msg.author) : { id: "unknown", platform: "discord" },
    timestamp: msg.createdAt ?? new Date(0),
    content: mapDiscordMessageToContent(msg),
  };
}
