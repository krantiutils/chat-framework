/**
 * Configuration and Telegram Bot API types for the Telegram adapter.
 *
 * Telegraf wraps the Bot API, but we define lightweight interfaces here
 * for the subset of update structures we need in mappers. This keeps
 * mapper unit tests independent of the telegraf dependency.
 */

/** Configuration for the Telegram adapter. */
export interface TelegramAdapterConfig {
  /** Bot token from @BotFather. */
  readonly token: string;

  /**
   * Whether to use webhooks instead of long polling.
   * If true, `webhookDomain` and optionally `webhookPort` must be set.
   * Defaults to false (long polling).
   */
  readonly useWebhook?: boolean;

  /** Domain for webhook mode (e.g., "https://bot.example.com"). */
  readonly webhookDomain?: string;

  /** Port for the built-in webhook server. Defaults to 443. */
  readonly webhookPort?: number;

  /** Secret path appended to webhook URL to prevent unauthorized calls. */
  readonly webhookSecretToken?: string;

  /**
   * Telegram Bot API server URL override.
   * Useful for local Bot API server deployments.
   */
  readonly apiRoot?: string;

  /**
   * Allowed update types to receive. Defaults to all.
   * See https://core.telegram.org/bots/api#update
   */
  readonly allowedUpdates?: readonly string[];
}

// ─── Telegram Bot API subset types ──────────────────────────────────────────
// These mirror the Telegram Bot API structures that Telegraf exposes.
// We define them here so mappers can be tested without importing telegraf.

/** Telegram user object (subset of Bot API User). */
export interface TelegramUser {
  readonly id: number;
  readonly is_bot: boolean;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
}

/** Telegram chat object (subset of Bot API Chat). */
export interface TelegramChat {
  readonly id: number;
  readonly type: "private" | "group" | "supergroup" | "channel";
  readonly title?: string;
  readonly username?: string;
  readonly first_name?: string;
  readonly last_name?: string;
}

/** Telegram photo size. */
export interface TelegramPhotoSize {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly width: number;
  readonly height: number;
  readonly file_size?: number;
}

/** Telegram audio object. */
export interface TelegramAudio {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly duration: number;
  readonly performer?: string;
  readonly title?: string;
  readonly file_name?: string;
  readonly mime_type?: string;
  readonly file_size?: number;
}

/** Telegram voice object. */
export interface TelegramVoice {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly duration: number;
  readonly mime_type?: string;
  readonly file_size?: number;
}

/** Telegram video object. */
export interface TelegramVideo {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly file_name?: string;
  readonly mime_type?: string;
  readonly file_size?: number;
}

/** Telegram document (generic file). */
export interface TelegramDocument {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly file_name?: string;
  readonly mime_type?: string;
  readonly file_size?: number;
}

/** Telegram sticker object. */
export interface TelegramSticker {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly type: string;
  readonly width: number;
  readonly height: number;
  readonly is_animated: boolean;
  readonly is_video: boolean;
}

/** Telegram location object. */
export interface TelegramLocation {
  readonly latitude: number;
  readonly longitude: number;
}

/** Telegram contact object. */
export interface TelegramContact {
  readonly phone_number: string;
  readonly first_name: string;
  readonly last_name?: string;
  readonly user_id?: number;
}

/** Telegram message entity (for detecting links, mentions, etc.). */
export interface TelegramMessageEntity {
  readonly type: string;
  readonly offset: number;
  readonly length: number;
  readonly url?: string;
}

/** Telegram message (subset of Bot API Message). */
export interface TelegramMessage {
  readonly message_id: number;
  readonly from?: TelegramUser;
  readonly chat: TelegramChat;
  readonly date: number;
  readonly text?: string;
  readonly caption?: string;
  readonly photo?: readonly TelegramPhotoSize[];
  readonly audio?: TelegramAudio;
  readonly voice?: TelegramVoice;
  readonly video?: TelegramVideo;
  readonly document?: TelegramDocument;
  readonly sticker?: TelegramSticker;
  readonly location?: TelegramLocation;
  readonly contact?: TelegramContact;
  readonly entities?: readonly TelegramMessageEntity[];
  readonly reply_to_message?: TelegramMessage;
}

/** Telegram message reaction updated event. */
export interface TelegramMessageReactionUpdated {
  readonly chat: TelegramChat;
  readonly message_id: number;
  readonly user?: TelegramUser;
  readonly date: number;
  readonly old_reaction: readonly TelegramReactionType[];
  readonly new_reaction: readonly TelegramReactionType[];
}

/** Telegram reaction type (emoji or custom). */
export interface TelegramReactionType {
  readonly type: "emoji" | "custom_emoji";
  readonly emoji?: string;
  readonly custom_emoji_id?: string;
}

/** Telegram callback query (inline keyboard button press). */
export interface TelegramCallbackQuery {
  readonly id: string;
  readonly from: TelegramUser;
  readonly message?: TelegramMessage;
  readonly chat_instance: string;
  readonly data?: string;
}

/** Result from Telegram getUpdates with chat info. */
export interface TelegramChatMember {
  readonly status: string;
  readonly user: TelegramUser;
}
