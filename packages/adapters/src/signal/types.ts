/**
 * Configuration and signal-cli specific types for the Signal adapter.
 */

/** Configuration for the Signal adapter. */
export interface SignalAdapterConfig {
  /** Registered phone number in E.164 format (e.g., "+1234567890"). */
  readonly phoneNumber: string;

  /**
   * Path to the signal-cli binary.
   * Defaults to "signal-cli" (must be on PATH).
   */
  readonly signalCliBin?: string;

  /**
   * Directory for signal-cli data storage (keys, sessions, etc.).
   * Defaults to ~/.local/share/signal-cli.
   */
  readonly dataDir?: string;

  /**
   * Timeout in ms for JSON-RPC requests to signal-cli.
   * Defaults to 30_000 (30 seconds).
   */
  readonly requestTimeoutMs?: number;
}

// ─── signal-cli JSON-RPC Envelope ─────────────────────────────────────────────

/** JSON-RPC 2.0 request. */
export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: Record<string, unknown>;
  readonly id: number;
}

/** JSON-RPC 2.0 success response. */
export interface JsonRpcSuccessResponse {
  readonly jsonrpc: "2.0";
  readonly result: unknown;
  readonly id: number;
}

/** JSON-RPC 2.0 error response. */
export interface JsonRpcErrorResponse {
  readonly jsonrpc: "2.0";
  readonly error: { readonly code: number; readonly message: string; readonly data?: unknown };
  readonly id: number;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// ─── signal-cli Envelope Types ────────────────────────────────────────────────

/** Envelope received from signal-cli's receive command / JSON-RPC. */
export interface SignalEnvelope {
  readonly source?: string;
  readonly sourceNumber?: string;
  readonly sourceUuid?: string;
  readonly sourceName?: string;
  readonly sourceDevice?: number;
  readonly timestamp?: number;
  readonly dataMessage?: SignalDataMessage;
  readonly syncMessage?: SignalSyncMessage;
  readonly receiptMessage?: SignalReceiptMessage;
  readonly typingMessage?: SignalTypingMessage;
}

/** Data message received from signal-cli. */
export interface SignalDataMessage {
  readonly timestamp?: number;
  readonly message?: string | null;
  readonly groupInfo?: SignalGroupInfo;
  readonly attachments?: readonly SignalAttachment[];
  readonly reaction?: SignalReaction;
  readonly quote?: SignalQuote;
  readonly expiresInSeconds?: number;
}

/** Sync message (sent by another linked device). */
export interface SignalSyncMessage {
  readonly sentMessage?: {
    readonly destination?: string;
    readonly destinationNumber?: string;
    readonly destinationUuid?: string;
    readonly timestamp?: number;
    readonly message?: string | null;
    readonly groupInfo?: SignalGroupInfo;
    readonly attachments?: readonly SignalAttachment[];
  };
  readonly readMessages?: readonly {
    readonly sender?: string;
    readonly senderNumber?: string;
    readonly timestamp?: number;
  }[];
}

/** Receipt message (delivery/read confirmation). */
export interface SignalReceiptMessage {
  readonly type?: "DELIVERY" | "READ";
  readonly timestamps?: readonly number[];
}

/** Typing indicator from signal-cli. */
export interface SignalTypingMessage {
  readonly action?: "STARTED" | "STOPPED";
  readonly timestamp?: number;
  readonly groupId?: string;
}

/** Group info from signal-cli. */
export interface SignalGroupInfo {
  readonly groupId?: string;
  readonly type?: string;
}

/** Attachment metadata from signal-cli. */
export interface SignalAttachment {
  readonly contentType?: string;
  readonly filename?: string;
  readonly id?: string;
  readonly size?: number;
  readonly width?: number;
  readonly height?: number;
  readonly voiceNote?: boolean;
}

/** Reaction from signal-cli. */
export interface SignalReaction {
  readonly emoji?: string;
  readonly targetAuthor?: string;
  readonly targetAuthorNumber?: string;
  readonly targetSentTimestamp?: number;
  readonly isRemove?: boolean;
}

/** Quote (reply reference) from signal-cli. */
export interface SignalQuote {
  readonly id?: number;
  readonly author?: string;
  readonly authorNumber?: string;
  readonly text?: string;
}

// ─── signal-cli Send Result ───────────────────────────────────────────────────

/** Result from signal-cli send commands. */
export interface SignalSendResult {
  readonly timestamp?: number;
  readonly results?: readonly {
    readonly recipientAddress?: { readonly uuid?: string; readonly number?: string };
    readonly type?: string;
  }[];
}
