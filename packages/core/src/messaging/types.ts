/**
 * Unified messaging types shared across all platform adapters.
 *
 * These types represent the platform-agnostic data model for conversations,
 * messages, users, and content. Each adapter maps platform-specific structures
 * to/from these types.
 */

/** Supported chat platforms. */
export type Platform =
  | "telegram"
  | "discord"
  | "whatsapp"
  | "instagram"
  | "facebook"
  | "signal";

/** Conversation type. */
export type ConversationType = "dm" | "group" | "channel";

/** Presence status. */
export type PresenceStatus = "online" | "offline";

/**
 * A user on a specific platform.
 */
export interface User {
  readonly id: string;
  readonly platform: Platform;
  readonly username?: string;
  readonly displayName?: string;
  readonly avatar?: string;
}

/**
 * Platform-specific metadata bag. Adapters can store arbitrary
 * platform-specific data here (thread IDs, group settings, etc.).
 */
export type PlatformMetadata = Record<string, unknown>;

/**
 * A conversation (DM, group chat, or channel) on a platform.
 */
export interface Conversation {
  readonly id: string;
  readonly platform: Platform;
  readonly participants: readonly User[];
  readonly type: ConversationType;
  readonly metadata: PlatformMetadata;
}

/** Link preview extracted from a URL. */
export interface LinkPreview {
  readonly title?: string;
  readonly description?: string;
  readonly image?: string;
  readonly url: string;
}

/** Union of possible message content types. */
export type MessageContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly url: string; readonly caption?: string }
  | { readonly type: "video"; readonly url: string; readonly caption?: string }
  | { readonly type: "audio"; readonly url: string; readonly duration: number }
  | { readonly type: "voice"; readonly url: string; readonly duration: number }
  | {
      readonly type: "file";
      readonly url: string;
      readonly filename: string;
      readonly size: number;
    }
  | {
      readonly type: "location";
      readonly lat: number;
      readonly lng: number;
      readonly name?: string;
    }
  | { readonly type: "contact"; readonly name: string; readonly phone: string }
  | { readonly type: "sticker"; readonly id: string; readonly url: string }
  | {
      readonly type: "link";
      readonly url: string;
      readonly preview?: LinkPreview;
    };

/**
 * A reaction on a message.
 */
export interface Reaction {
  readonly emoji: string;
  readonly user: User;
  readonly timestamp: Date;
}

/**
 * A message in a conversation.
 */
export interface Message {
  readonly id: string;
  readonly conversation: Conversation;
  readonly sender: User;
  readonly timestamp: Date;
  readonly content: MessageContent;
  readonly replyTo?: Message;
  readonly reactions?: readonly Reaction[];
}
