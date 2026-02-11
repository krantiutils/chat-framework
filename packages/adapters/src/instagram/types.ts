/**
 * Instagram adapter configuration and internal types.
 */

import type {
  MouseTrajectoryProvider,
  KeystrokeTimingProvider,
} from "./human-simulator.js";

/** Credentials for Instagram login. */
export interface InstagramCredentials {
  username: string;
  password: string;
}

/** Configuration for the Instagram adapter. */
export interface InstagramAdapterConfig {
  /** Instagram login credentials. */
  credentials: InstagramCredentials;

  /**
   * Directory for persistent browser data (cookies, localStorage, session).
   * Reuse across restarts to avoid re-login.
   */
  userDataDir: string;

  /**
   * Run the browser in headless mode.
   * @default true
   */
  headless?: boolean;

  /**
   * Polling interval for checking new DMs (ms).
   * Lower = more responsive but higher detection risk.
   * @default 15000 (15 seconds)
   */
  pollIntervalMs?: number;

  /**
   * Maximum time to wait for page loads / navigation (ms).
   * @default 30000
   */
  navigationTimeoutMs?: number;

  /**
   * Custom mouse trajectory provider (e.g., GAN-based).
   * Falls back to cubic-Bezier default if not provided.
   */
  mouseProvider?: MouseTrajectoryProvider;

  /**
   * Custom keystroke timing provider (e.g., GAN-based).
   * Falls back to statistical default if not provided.
   */
  keystrokeProvider?: KeystrokeTimingProvider;

  /**
   * Proxy configuration for the browser.
   * Passed through to StealthBrowser.
   */
  proxy?: {
    host: string;
    port: number;
    protocol: "http" | "https" | "socks4" | "socks5";
    username?: string;
    password?: string;
  };
}

/** Raw DM data extracted from the Instagram DOM. */
export interface RawInstagramMessage {
  /** Unique identifier (data attribute or constructed from content hash). */
  id: string;
  /** Username of the sender. */
  senderUsername: string;
  /** Text content of the message. */
  text: string;
  /** Timestamp string as displayed in the UI. */
  timestampRaw: string;
  /** Whether this message was sent by the logged-in user. */
  isOutgoing: boolean;
}

/** Raw conversation entry from the inbox list. */
export interface RawInstagramThread {
  /** Thread identifier (from URL or data attribute). */
  id: string;
  /** Display name / username of the other participant(s). */
  participantName: string;
  /** Last message preview text. */
  lastMessagePreview: string;
  /** Whether the thread has unread messages. */
  hasUnread: boolean;
}
