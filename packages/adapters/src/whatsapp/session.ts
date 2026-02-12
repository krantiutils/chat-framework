/**
 * WhatsApp session manager — handles QR code auth, session persistence,
 * and automatic reconnection with exponential backoff.
 *
 * This is the session lifecycle layer that sits between the WhatsApp adapter
 * and the raw Baileys socket. It owns the connection state machine:
 *
 *   [disconnected] → connect() → [connecting/qr] → [connected]
 *                  ← disconnect() ←
 *                  ← auto-reconnect (on transient failures)
 *                  ← session-expired (on permanent failures)
 *
 * The adapter (cf-t1l) consumes the live socket reference via {@link socket}
 * and listens to session events to track connection health.
 */
import type { Boom } from "@hapi/boom";

import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
} from "@whiskeysockets/baileys";

import type {
  DisconnectCategory,
  DisconnectClassification,
  SessionEventMap,
  SessionEventName,
  WASocket,
  WhatsAppSessionConfig,
} from "./types.js";

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_BROWSER: [string, string, string] = ["Ubuntu", "Chrome", "22.0"];
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
const DEFAULT_BASE_RECONNECT_DELAY_MS = 1_000;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 60_000;
const DEFAULT_QR_TIMEOUT_MS = 60_000;

// ─── Session State ───────────────────────────────────────────────────────────

export type SessionState =
  | "disconnected"
  | "connecting"
  | "waiting_for_qr"
  | "connected";

// ─── Session Manager ─────────────────────────────────────────────────────────

/**
 * Manages the WhatsApp connection lifecycle.
 *
 * @example
 * ```typescript
 * const session = new WhatsAppSessionManager({
 *   authStore: new FileAuthStateStore("./auth"),
 *   maxReconnectAttempts: 5,
 * });
 *
 * session.on("qr", ({ qr }) => {
 *   // Render QR for user to scan
 *   qrcodeTerminal.generate(qr, { small: true });
 * });
 *
 * session.on("connected", ({ jid }) => {
 *   console.log(`Connected as ${jid}`);
 * });
 *
 * session.on("session-expired", ({ reason }) => {
 *   console.log(`Session expired: ${reason}. Re-scan required.`);
 * });
 *
 * await session.connect();
 * ```
 */
export class WhatsAppSessionManager {
  private readonly config: WhatsAppSessionConfig;
  private sock: WASocket | null = null;
  private state: SessionState = "disconnected";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private qrAttempt = 0;
  private intentionalDisconnect = false;

  private readonly listeners = new Map<
    SessionEventName,
    Set<(...args: unknown[]) => void>
  >();

  constructor(config: WhatsAppSessionConfig) {
    this.config = config;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Initiate connection to WhatsApp.
   *
   * If no existing session is found, a QR code flow starts and `qr` events
   * are emitted. If a session exists, reconnection is attempted immediately.
   *
   * @throws If already connecting or connected.
   */
  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      throw new Error(
        `WhatsAppSessionManager: cannot connect while in state '${this.state}'`,
      );
    }

    this.intentionalDisconnect = false;
    this.reconnectAttempt = 0;
    await this.createSocket();
  }

  /**
   * Gracefully disconnect from WhatsApp.
   *
   * Cancels any pending reconnection and closes the socket.
   * Does NOT clear the session — call `clearSession()` for that.
   */
  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.cancelReconnect();

    if (this.sock) {
      const sock = this.sock;
      this.sock = null;
      this.state = "disconnected";
      await sock.logout().catch(() => {
        // logout() can throw if already disconnected — ignore.
      });
      sock.end(new Error("Intentional disconnect"));
    } else {
      this.state = "disconnected";
    }
  }

  /**
   * Clear persisted session state.
   *
   * Call this when the session is permanently invalidated (logged out,
   * banned, etc.) to clean up stored credentials. The next `connect()`
   * will start a fresh QR code flow.
   */
  async clearSession(): Promise<void> {
    await this.config.authStore.clearState();
  }

  /**
   * Request a pairing code instead of QR scanning.
   *
   * Must be called after `connect()` and before a QR is scanned.
   * The phone number owner enters this code on their WhatsApp app
   * under "Link a Device" → "Link with phone number instead".
   *
   * @param phoneNumber - Phone number in digits only (no +, spaces, or dashes).
   *                      Include country code, e.g., "12025551234".
   * @returns The pairing code string to display to the user.
   * @throws If no socket is active.
   */
  async requestPairingCode(phoneNumber: string): Promise<string> {
    if (!this.sock) {
      throw new Error(
        "WhatsAppSessionManager: no active socket. Call connect() first.",
      );
    }
    return this.sock.requestPairingCode(phoneNumber);
  }

  /** Current session state. */
  get sessionState(): SessionState {
    return this.state;
  }

  /**
   * The live Baileys socket, or null if not connected.
   *
   * The adapter layer uses this to send messages, manage presence, etc.
   * The reference changes on each reconnection, so consumers should
   * re-fetch it after `connected` events.
   */
  get socket(): WASocket | null {
    return this.sock;
  }

  /** Number of reconnection attempts since last successful connection. */
  get currentReconnectAttempt(): number {
    return this.reconnectAttempt;
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  on<E extends SessionEventName>(
    event: E,
    handler: SessionEventMap[E],
  ): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (...args: unknown[]) => void);
  }

  off<E extends SessionEventName>(
    event: E,
    handler: SessionEventMap[E],
  ): void {
    this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  // ── Internal: Socket Creation ──────────────────────────────────────────────

  private async createSocket(): Promise<void> {
    this.state = "connecting";
    this.qrAttempt = 0;

    const authState = await this.config.authStore.loadState();
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: authState,
      browser: this.config.browser ?? DEFAULT_BROWSER,
      version,
      syncFullHistory: this.config.syncFullHistory ?? false,
      qrTimeout: this.config.qrTimeoutMs ?? DEFAULT_QR_TIMEOUT_MS,
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
      ...this.config.socketConfig,
    });

    this.sock = sock;

    // Wire up event handlers
    sock.ev.on("connection.update", (update) =>
      this.handleConnectionUpdate(update),
    );

    sock.ev.on("creds.update", async () => {
      try {
        // Baileys emits a partial creds update and has already merged it
        // into authState.creds by the time this fires. We pass the full
        // (merged) creds to the store, not just the partial update.
        await this.config.authStore.saveCreds(sock.authState.creds);
      } catch (err) {
        // Credential save failure is serious — emit as error context
        // but don't crash the socket. The session will work until restart.
        this.emit("disconnected", {
          reason: classifyDisconnect(undefined),
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    });
  }

  // ── Internal: Connection Update Handler ────────────────────────────────────

  private handleConnectionUpdate(
    update: Partial<{
      connection: "open" | "connecting" | "close";
      lastDisconnect?: { error: Error | undefined; date: Date };
      isNewLogin?: boolean;
      qr?: string;
      receivedPendingNotifications?: boolean;
      isOnline?: boolean;
    }>,
  ): void {
    const { connection, qr, isNewLogin, lastDisconnect } = update;

    // QR code available for scanning
    if (qr) {
      this.qrAttempt++;
      this.state = "waiting_for_qr";
      this.emit("qr", { qr, attempt: this.qrAttempt });
    }

    // Fresh pairing completed
    if (isNewLogin) {
      this.emit("authenticated", {
        isNewLogin: true,
        jid: this.sock?.user?.id,
      });
    }

    // Connection state changes
    if (connection === "open") {
      this.state = "connected";
      this.reconnectAttempt = 0;
      this.qrAttempt = 0;

      // If this isn't a new login, it's a session restore
      if (!isNewLogin) {
        this.emit("authenticated", {
          isNewLogin: false,
          jid: this.sock?.user?.id,
        });
      }

      this.emit("connected", { jid: this.sock?.user?.id });
    }

    if (connection === "close") {
      const error = lastDisconnect?.error;
      const classification = classifyDisconnect(error);

      this.state = "disconnected";
      this.sock = null;

      this.emit("disconnected", { reason: classification, error });

      // Handle permanent failures
      if (classification.shouldClearSession) {
        const expiredReason =
          classification.category === "banned"
            ? "banned"
            : classification.category === "bad_session"
              ? "bad_session"
              : "logged_out";

        this.emit("session-expired", { reason: expiredReason });

        // Clear session state asynchronously
        this.config.authStore.clearState().catch(() => {
          // Best effort — if this fails, the next connect() will handle it.
        });
        return;
      }

      // Auto-reconnect for transient failures
      if (
        !this.intentionalDisconnect &&
        classification.shouldReconnect
      ) {
        this.scheduleReconnect();
      }
    }
  }

  // ── Internal: Reconnection ─────────────────────────────────────────────────

  private scheduleReconnect(): void {
    const maxAttempts =
      this.config.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;

    if (maxAttempts <= 0) return;

    this.reconnectAttempt++;

    if (this.reconnectAttempt > maxAttempts) {
      // Exhausted all attempts — let consumers decide what to do.
      return;
    }

    const baseDelay =
      this.config.baseReconnectDelayMs ?? DEFAULT_BASE_RECONNECT_DELAY_MS;
    const maxDelay =
      this.config.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS;

    const delay = Math.min(
      baseDelay * Math.pow(2, this.reconnectAttempt - 1),
      maxDelay,
    );

    // Add jitter: ±25% to prevent thundering herd
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    const finalDelay = Math.max(0, Math.round(delay + jitter));

    this.emit("reconnecting", {
      attempt: this.reconnectAttempt,
      maxAttempts,
      delayMs: finalDelay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.createSocket().catch((err) => {
        // Socket creation failed (e.g., auth store error).
        // Emit disconnected and try again.
        this.emit("disconnected", {
          reason: classifyDisconnect(undefined),
          error: err instanceof Error ? err : new Error(String(err)),
        });
        this.scheduleReconnect();
      });
    }, finalDelay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ── Internal: Event Emission ───────────────────────────────────────────────

  private emit<E extends SessionEventName>(
    event: E,
    ...args: Parameters<SessionEventMap[E]>
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;

    for (const handler of set) {
      try {
        handler(...args);
      } catch {
        // Swallow listener errors to prevent one bad listener from
        // breaking the session lifecycle.
      }
    }
  }
}

// ─── Disconnect Classification ───────────────────────────────────────────────

/**
 * Classify a Baileys disconnect error into an actionable recommendation.
 *
 * @param error - The error from `lastDisconnect.error`, or undefined.
 * @returns Classification with reconnect/clear recommendations.
 */
export function classifyDisconnect(
  error: Error | undefined,
): DisconnectClassification {
  if (!error) {
    return {
      label: "Unknown disconnect",
      statusCode: undefined,
      shouldReconnect: true,
      shouldClearSession: false,
      category: "unknown",
    };
  }

  const statusCode = (error as Boom)?.output?.statusCode;

  return classifyStatusCode(statusCode, error.message);
}

function classifyStatusCode(
  statusCode: number | undefined,
  message: string,
): DisconnectClassification {
  // Map known Baileys DisconnectReason codes to classifications.
  // Note: DisconnectReason.connectionLost and .timedOut share code 408.
  // We use the error message to disambiguate when needed.

  const classifications: Record<number, DisconnectClassification> = {
    [DisconnectReason.loggedOut]: {
      label: "Logged out — device removed from WhatsApp",
      statusCode: DisconnectReason.loggedOut,
      shouldReconnect: false,
      shouldClearSession: true,
      category: "logged_out",
    },
    [DisconnectReason.badSession]: {
      label: "Bad session — credentials corrupted",
      statusCode: DisconnectReason.badSession,
      shouldReconnect: false,
      shouldClearSession: true,
      category: "bad_session",
    },
    [DisconnectReason.forbidden]: {
      label: "Forbidden — account banned or restricted",
      statusCode: DisconnectReason.forbidden,
      shouldReconnect: false,
      shouldClearSession: true,
      category: "banned",
    },
    [DisconnectReason.connectionClosed]: {
      label: "Connection closed by server",
      statusCode: DisconnectReason.connectionClosed,
      shouldReconnect: true,
      shouldClearSession: false,
      category: "connection_closed",
    },
    [DisconnectReason.connectionReplaced]: {
      label: "Connection replaced by another client",
      statusCode: DisconnectReason.connectionReplaced,
      shouldReconnect: false,
      shouldClearSession: false,
      category: "connection_replaced",
    },
    [DisconnectReason.restartRequired]: {
      label: "Restart required by server",
      statusCode: DisconnectReason.restartRequired,
      shouldReconnect: true,
      shouldClearSession: false,
      category: "restart_required",
    },
    [DisconnectReason.multideviceMismatch]: {
      label: "Multi-device mismatch — enable on phone",
      statusCode: DisconnectReason.multideviceMismatch,
      shouldReconnect: false,
      shouldClearSession: false,
      category: "multidevice_mismatch",
    },
    [DisconnectReason.unavailableService]: {
      label: "WhatsApp service unavailable",
      statusCode: DisconnectReason.unavailableService,
      shouldReconnect: true,
      shouldClearSession: false,
      category: "service_unavailable",
    },
  };

  if (statusCode !== undefined && statusCode in classifications) {
    return classifications[statusCode];
  }

  // Code 408 is shared between connectionLost and timedOut.
  // Try to disambiguate from the error message.
  if (statusCode === 408) {
    const isQrTimeout = message.toLowerCase().includes("qr");
    const category: DisconnectCategory = isQrTimeout
      ? "timed_out"
      : "connection_lost";
    return {
      label: isQrTimeout
        ? "QR code scan timed out"
        : "Connection lost",
      statusCode: 408,
      shouldReconnect: !isQrTimeout,
      shouldClearSession: false,
      category,
    };
  }

  return {
    label: `Disconnect: ${message || "unknown reason"}`,
    statusCode,
    shouldReconnect: true,
    shouldClearSession: false,
    category: "unknown",
  };
}
