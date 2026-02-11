import type { SessionProfile } from "@chat-framework/core";
import type {
  BrowserProfile,
  ProxyConfig,
} from "@chat-framework/browser";

/**
 * Configuration for the Facebook Messenger adapter.
 */
export interface FacebookMessengerConfig {
  /** Facebook login credentials. */
  readonly credentials: FacebookCredentials;

  /**
   * Browser profile for fingerprint consistency.
   * If not provided, a new profile is generated on each connection.
   */
  readonly browserProfile?: BrowserProfile;

  /**
   * Proxy configuration for the browser.
   * Strongly recommended for production use to avoid IP-based detection.
   */
  readonly proxy?: ProxyConfig;

  /**
   * Directory for persistent browser data (cookies, localStorage).
   * Enables session persistence across adapter restarts.
   * If not set, a temporary directory is used and sessions are not persisted.
   */
  readonly userDataDir?: string;

  /**
   * Whether to run the browser in headless mode.
   * Defaults to true. Set to false for debugging.
   */
  readonly headless?: boolean;

  /**
   * Session profile for human simulation behavior.
   * Controls typing speed, idle patterns, etc.
   * Defaults to average profile if not set.
   */
  readonly sessionProfile?: SessionProfile;

  /**
   * DOM selector overrides. Facebook frequently changes their DOM.
   * Use this to override default selectors when they break.
   */
  readonly selectorOverrides?: Partial<MessengerSelectors>;

  /**
   * Timeout in ms for waiting for page elements. Defaults to 30000.
   */
  readonly elementTimeoutMs?: number;

  /**
   * Interval in ms for polling for new messages. Defaults to 2000.
   */
  readonly messagePollingIntervalMs?: number;
}

/**
 * Facebook login credentials.
 */
export interface FacebookCredentials {
  readonly email: string;
  readonly password: string;
}

/**
 * DOM selectors for Messenger web interface elements.
 * These are separated into their own interface so they can be overridden
 * when Facebook changes their UI.
 */
export interface MessengerSelectors {
  // ── Login ───────────────────────────────────────────────────────────────────
  readonly loginEmailInput: string;
  readonly loginPasswordInput: string;
  readonly loginButton: string;
  readonly loginTwoFactorInput: string;
  readonly loginTwoFactorSubmit: string;

  // ── Navigation ──────────────────────────────────────────────────────────────
  readonly conversationList: string;
  readonly conversationListItem: string;
  readonly conversationLink: string;

  // ── Message Compose ─────────────────────────────────────────────────────────
  readonly messageInput: string;
  readonly sendButton: string;
  readonly fileInput: string;
  readonly attachmentButton: string;

  // ── Messages ────────────────────────────────────────────────────────────────
  readonly messageContainer: string;
  readonly messageRow: string;
  readonly messageText: string;
  readonly messageSenderName: string;
  readonly messageTimestamp: string;

  // ── Reactions ───────────────────────────────────────────────────────────────
  readonly reactionTrigger: string;
  readonly reactionPicker: string;
  readonly reactionEmoji: string;

  // ── Presence ────────────────────────────────────────────────────────────────
  readonly onlineIndicator: string;
}
