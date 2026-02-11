/**
 * Unified messaging types shared across all platform adapters.
 * Follows the specification in PRD Section 4.1.
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

/**
 * Platform-specific metadata that doesn't fit the unified model.
 * Adapters attach raw platform data here for pass-through.
 */
export type PlatformMetadata = Record<string, unknown>;

/** Unified user reference. */
export interface User {
  id: string;
  platform: Platform;
  username?: string;
  displayName?: string;
  avatar?: string;
}

/** Unified conversation reference. */
export interface Conversation {
  id: string;
  platform: Platform;
  participants: User[];
  type: ConversationType;
  metadata: PlatformMetadata;
}

/** Link preview embedded in a link message. */
export interface LinkPreview {
  title?: string;
  description?: string;
  image?: string;
  url: string;
}

/** Discriminated union of all message content types. */
export type MessageContent =
  | { type: "text"; text: string }
  | { type: "image"; url: string; caption?: string }
  | { type: "video"; url: string; caption?: string }
  | { type: "audio"; url: string; duration: number }
  | { type: "voice"; url: string; duration: number }
  | { type: "file"; url: string; filename: string; size: number }
  | { type: "location"; lat: number; lng: number; name?: string }
  | { type: "contact"; name: string; phone: string }
  | { type: "sticker"; id: string; url: string }
  | { type: "link"; url: string; preview?: LinkPreview };

/** Reaction on a message. */
export interface Reaction {
  emoji: string;
  user: User;
  timestamp: Date;
}

/** Unified message. */
export interface Message {
  id: string;
  conversation: Conversation;
  sender: User;
  timestamp: Date;
  content: MessageContent;
  replyTo?: Message;
  reactions?: Reaction[];
}

/** User presence status. */
export type PresenceStatus = "online" | "offline";

/** Events emitted by a MessagingClient. */
export interface MessagingEvents {
  message: (msg: Message) => void;
  reaction: (reaction: Reaction, msg: Message) => void;
  typing: (user: User, conversation: Conversation) => void;
  read: (user: User, msg: Message) => void;
  presence: (user: User, status: PresenceStatus) => void;
  error: (error: Error) => void;
  connected: () => void;
  disconnected: () => void;
}
