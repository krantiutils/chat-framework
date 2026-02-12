/**
 * Capability names corresponding to features a platform may or may not support.
 *
 * Derived from PRD section 4.3 — Platform Capability Matrix.
 */
export type Capability =
  | "text"
  | "images"
  | "video"
  | "audio"
  | "voiceNotes"
  | "files"
  | "location"
  | "reactions"
  | "replies"
  | "forward"
  | "delete"
  | "typingIndicator"
  | "readReceipts"
  | "inlineKeyboards"
  | "payments"
  | "voiceCalls";

/** All known capability names as a readonly array. */
export const ALL_CAPABILITIES: readonly Capability[] = [
  "text",
  "images",
  "video",
  "audio",
  "voiceNotes",
  "files",
  "location",
  "reactions",
  "replies",
  "forward",
  "delete",
  "typingIndicator",
  "readReceipts",
  "inlineKeyboards",
  "payments",
  "voiceCalls",
] as const;

/**
 * Declares which capabilities a platform supports.
 *
 * Every field is a boolean indicating support. Consumers should check
 * capabilities before invoking the corresponding MessagingClient methods
 * to avoid runtime errors on unsupported operations.
 */
export interface PlatformCapabilities {
  /** Plain text messages. */
  readonly text: boolean;
  /** Image messages (with optional caption). */
  readonly images: boolean;
  /** Video messages. */
  readonly video: boolean;
  /** Audio file messages. */
  readonly audio: boolean;
  /** Voice note messages (distinct from audio files on some platforms). */
  readonly voiceNotes: boolean;
  /** Arbitrary file attachments. */
  readonly files: boolean;
  /** Location sharing. */
  readonly location: boolean;
  /** Emoji reactions on messages. */
  readonly reactions: boolean;
  /** Reply-to / quote messages. */
  readonly replies: boolean;
  /** Forwarding messages to other conversations. */
  readonly forward: boolean;
  /** Deleting sent messages. */
  readonly delete: boolean;
  /** Typing indicator ("user is typing…"). */
  readonly typingIndicator: boolean;
  /** Read receipts. */
  readonly readReceipts: boolean;
  /** Inline keyboards / interactive buttons. */
  readonly inlineKeyboards: boolean;
  /** Payment integration. */
  readonly payments: boolean;
  /** Voice/audio calls. */
  readonly voiceCalls: boolean;
}
