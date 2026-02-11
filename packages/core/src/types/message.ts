import type { Conversation } from "./conversation.js";
import type { User } from "./user.js";

/** Preview metadata for link-type messages. */
export interface LinkPreview {
  readonly title?: string;
  readonly description?: string;
  readonly imageUrl?: string;
}

/** Discriminated union of all possible message content types. */
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

/** Emoji reaction on a message. */
export interface Reaction {
  readonly emoji: string;
  readonly user: User;
  readonly timestamp: Date;
}

/** Unified message across platforms. */
export interface Message {
  /** Platform-specific message identifier. */
  readonly id: string;
  /** Conversation this message belongs to. */
  readonly conversation: Conversation;
  /** User who sent this message. */
  readonly sender: User;
  /** When the message was sent. */
  readonly timestamp: Date;
  /** Message content (text, image, etc.). */
  readonly content: MessageContent;
  /** Message this is replying to, if any. */
  readonly replyTo?: Message;
  /** Reactions on this message. */
  readonly reactions?: readonly Reaction[];
}
