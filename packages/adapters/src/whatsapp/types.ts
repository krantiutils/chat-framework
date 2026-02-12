/**
 * WhatsApp session management types.
 *
 * Types for QR code auth flow, session persistence, reconnection logic,
 * and disconnect reason classification. Built on top of @whiskeysockets/baileys.
 */
import type {
  AuthenticationCreds,
  AuthenticationState,
  ConnectionState,
  SignalKeyStore,
  UserFacingSocketConfig,
  WASocket,
} from "@whiskeysockets/baileys";

// ─── Auth State Store ────────────────────────────────────────────────────────

/**
 * Abstract interface for persisting WhatsApp auth state.
 *
 * Implementations must provide both credential and key storage.
 * Baileys requires that `saveCreds` is called on every `creds.update` event,
 * and that keys are persisted automatically through the SignalKeyStore interface.
 *
 * For development/testing, use {@link FileAuthStateStore} which wraps
 * Baileys' useMultiFileAuthState. For production, implement this interface
 * against a database (Postgres, Redis, etc.).
 */
export interface AuthStateStore {
  /** Load or initialize auth state. Must be called before passing to makeWASocket. */
  loadState(): Promise<AuthenticationState>;

  /** Persist updated credentials. Wire this to the `creds.update` event. */
  saveCreds(creds: AuthenticationCreds): Promise<void>;

  /**
   * Delete all stored auth state. Called when session is permanently
   * invalidated (logged out, bad session, banned).
   */
  clearState(): Promise<void>;

  /**
   * Whether persisted state already exists (i.e., we've paired before).
   * Useful for deciding whether to expect a QR flow or a reconnection.
   */
  hasExistingState(): Promise<boolean>;
}

// ─── Session Config ──────────────────────────────────────────────────────────

/** Configuration for WhatsAppSessionManager. */
export interface WhatsAppSessionConfig {
  /** Auth state store for credential/key persistence. */
  readonly authStore: AuthStateStore;

  /**
   * Browser identity presented to WhatsApp.
   * Format: [platform, browser, version].
   * @default ["Ubuntu", "Chrome", "22.0"]
   */
  readonly browser?: [string, string, string];

  /**
   * Whether to sync full message history on first login.
   * Increases initial connection time but provides message backfill.
   * @default false
   */
  readonly syncFullHistory?: boolean;

  /**
   * Maximum number of automatic reconnection attempts before giving up.
   * Set to 0 to disable auto-reconnect.
   * @default 10
   */
  readonly maxReconnectAttempts?: number;

  /**
   * Base delay in ms for exponential backoff between reconnection attempts.
   * Actual delay = baseReconnectDelayMs * 2^attempt, capped at maxReconnectDelayMs.
   * @default 1000
   */
  readonly baseReconnectDelayMs?: number;

  /**
   * Maximum delay in ms between reconnection attempts.
   * @default 60000
   */
  readonly maxReconnectDelayMs?: number;

  /**
   * Timeout in ms for QR code scanning. After this period without a scan,
   * the connection attempt is abandoned.
   * @default 60000
   */
  readonly qrTimeoutMs?: number;

  /**
   * Additional Baileys socket config overrides.
   * Use with caution — the session manager controls auth, browser, and
   * connection lifecycle settings itself.
   */
  readonly socketConfig?: Partial<Omit<UserFacingSocketConfig, "auth" | "browser">>;
}

// ─── Session Events ──────────────────────────────────────────────────────────

/** QR code is available for scanning. */
export interface QRCodeEvent {
  /** QR string suitable for rendering (e.g., with `qrcode-terminal` or `qrcode`). */
  readonly qr: string;
  /** Which QR this is in the current connection attempt (1-based). */
  readonly attempt: number;
}

/** Session successfully authenticated (first-time pairing or re-auth). */
export interface AuthenticatedEvent {
  /** Whether this was a fresh pairing (true) or session restore (false). */
  readonly isNewLogin: boolean;
  /** JID of the authenticated account, if available. */
  readonly jid: string | undefined;
}

/** Connection is fully open and operational. */
export interface ConnectedEvent {
  /** JID of the connected account. */
  readonly jid: string | undefined;
}

/** Connection was closed. */
export interface DisconnectedEvent {
  /** Classified reason for disconnection. */
  readonly reason: DisconnectClassification;
  /** The raw error from Baileys, if any. */
  readonly error: Error | undefined;
}

/** Automatic reconnection is being attempted. */
export interface ReconnectingEvent {
  /** Which reconnect attempt this is (1-based). */
  readonly attempt: number;
  /** Maximum attempts configured. */
  readonly maxAttempts: number;
  /** Delay in ms before this attempt. */
  readonly delayMs: number;
}

/** Session permanently expired — must re-scan QR. */
export interface SessionExpiredEvent {
  /** Why the session expired. */
  readonly reason: "logged_out" | "bad_session" | "banned";
}

/** Map of session event names to their handler signatures. */
export interface SessionEventMap {
  qr: (event: QRCodeEvent) => void;
  authenticated: (event: AuthenticatedEvent) => void;
  connected: (event: ConnectedEvent) => void;
  disconnected: (event: DisconnectedEvent) => void;
  reconnecting: (event: ReconnectingEvent) => void;
  "session-expired": (event: SessionExpiredEvent) => void;
}

export type SessionEventName = keyof SessionEventMap;

// ─── Disconnect Classification ───────────────────────────────────────────────

/**
 * Classified disconnect reason with recommended action.
 *
 * Maps Baileys' raw DisconnectReason codes to actionable categories
 * so the session manager (and consumers) can decide what to do.
 */
export interface DisconnectClassification {
  /** Human-readable label for the disconnect reason. */
  readonly label: string;
  /** The raw Baileys status code, if available. */
  readonly statusCode: number | undefined;
  /** Whether automatic reconnection should be attempted. */
  readonly shouldReconnect: boolean;
  /**
   * Whether the stored session should be cleared (credentials deleted).
   * True for permanent failures like logout, ban, or corrupted session.
   */
  readonly shouldClearSession: boolean;
  /** Category for programmatic handling. */
  readonly category: DisconnectCategory;
}

export type DisconnectCategory =
  | "connection_lost"       // Transient network issue
  | "connection_closed"     // Server closed connection
  | "connection_replaced"   // Another client took over
  | "timed_out"             // Keep-alive or QR timeout
  | "restart_required"      // Baileys requests restart
  | "logged_out"            // User removed linked device
  | "bad_session"           // Session data corrupted
  | "banned"                // Account forbidden/banned
  | "multidevice_mismatch"  // Multi-device not enabled on phone
  | "service_unavailable"   // WhatsApp servers down
  | "unknown";              // Unrecognized status code

// ─── Re-exports for convenience ──────────────────────────────────────────────

export type {
  AuthenticationCreds,
  AuthenticationState,
  ConnectionState,
  SignalKeyStore,
  WASocket,
};
