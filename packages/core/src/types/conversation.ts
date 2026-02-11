import type { Platform } from "./platform.js";
import type { User } from "./user.js";

/** Conversation type classification. */
export type ConversationType = "dm" | "group" | "channel";

/**
 * Arbitrary platform-specific metadata attached to a conversation.
 * Each platform adapter can store additional info here.
 */
export type PlatformMetadata = Record<string, unknown>;

/** Unified conversation reference across platforms. */
export interface Conversation {
  /** Platform-specific conversation identifier. */
  readonly id: string;
  /** Platform this conversation belongs to. */
  readonly platform: Platform;
  /** List of participants in this conversation. */
  readonly participants: readonly User[];
  /** Whether this is a DM, group chat, or channel. */
  readonly type: ConversationType;
  /** Platform-specific metadata (group name, admin flags, etc.). */
  readonly metadata: PlatformMetadata;
}
