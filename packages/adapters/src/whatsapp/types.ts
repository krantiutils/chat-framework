/**
 * Configuration and Baileys-specific types for the WhatsApp adapter.
 *
 * WhatsApp (Tier B) uses the @whiskeysockets/baileys library which
 * implements the WhatsApp Web multi-device protocol. Authentication
 * requires scanning a QR code or using a pairing code, and session
 * state must be persisted to survive restarts.
 */

import type { AuthenticationState, proto } from "@whiskeysockets/baileys";

/** Configuration for the WhatsApp adapter. */
export interface WhatsAppAdapterConfig {
  /**
   * Baileys authentication state. Consumers are responsible for creating
   * and persisting this (e.g. via `useMultiFileAuthState`).
   *
   * Required — Baileys needs a Signal protocol key store for E2E encryption.
   */
  readonly auth: AuthenticationState;

  /**
   * Callback invoked whenever auth credentials change and should be
   * persisted (e.g. the `saveCreds` from `useMultiFileAuthState`).
   */
  readonly saveCreds?: () => Promise<void>;

  /**
   * Callback invoked when a QR code is available for scanning.
   * The `qr` parameter is a QR-encoded string the user must scan
   * with their phone's WhatsApp app.
   *
   * If not provided, QR codes are silently ignored (useful for
   * already-authenticated sessions).
   */
  readonly onQr?: (qr: string) => void;

  /**
   * Whether to print QR codes to the terminal.
   * Convenience for development. Defaults to false.
   */
  readonly printQrInTerminal?: boolean;

  /**
   * Whether to mark the client as "online" on connect.
   * Defaults to false to reduce detection risk (Tier B consideration).
   */
  readonly markOnlineOnConnect?: boolean;

  /**
   * Browser identification sent to WhatsApp servers.
   * Format: [platform, browser, version].
   * Defaults to ["Ubuntu", "Chrome", "22.04"].
   */
  readonly browser?: readonly [string, string, string];

  /**
   * Timeout in ms to wait for the connection to open after socket creation.
   * Defaults to 60_000 (60 seconds).
   */
  readonly connectTimeoutMs?: number;

  /**
   * Callback to retrieve a previously-sent message for retry decryption.
   * Baileys calls this when a recipient requests a message retry.
   * If not provided, retries will fail silently (returns undefined).
   */
  readonly getMessage?: (key: proto.IMessageKey) => Promise<proto.IMessage | undefined>;
}
