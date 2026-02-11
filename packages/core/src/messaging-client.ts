/**
 * Unified MessagingClient interface that all platform adapters implement.
 * Follows the specification in PRD Section 4.2.
 *
 * Not all platforms support all methods. Adapters throw
 * `UnsupportedOperationError` for capabilities their platform lacks.
 * Consumers should check the capability matrix or catch errors.
 */

import type {
  Conversation,
  Message,
  MessageContent,
  MessagingEvents,
  Reaction,
} from "./types.js";

/** Thrown when an adapter doesn't support a particular operation. */
export class UnsupportedOperationError extends Error {
  constructor(platform: string, operation: string) {
    super(`${platform} does not support "${operation}"`);
    this.name = "UnsupportedOperationError";
  }
}

/**
 * Callback types extracted from MessagingEvents for use in the `on()` method.
 */
export type EventHandler<K extends keyof MessagingEvents> = MessagingEvents[K];

/**
 * Unified messaging client interface.
 *
 * All platform adapters (Telegram, Discord, WhatsApp, Instagram, etc.)
 * implement this interface. Browser-automation adapters (Tier C) integrate
 * the Human Simulation Engine transparently — callers don't need to know
 * whether HSE is active.
 */
export interface MessagingClient {
  /** Platform identifier for this adapter. */
  readonly platform: string;

  // ── Connection ──────────────────────────────────────────────

  /** Establish connection / login. Resolves when ready to send/receive. */
  connect(): Promise<void>;

  /** Graceful shutdown. Closes browser, sockets, etc. */
  disconnect(): Promise<void>;

  /** Whether the client is currently connected and operational. */
  isConnected(): boolean;

  // ── Sending ─────────────────────────────────────────────────

  sendText(conversation: Conversation, text: string): Promise<Message>;

  sendImage(
    conversation: Conversation,
    image: Uint8Array | string,
    caption?: string,
  ): Promise<Message>;

  sendAudio(
    conversation: Conversation,
    audio: Uint8Array | string,
  ): Promise<Message>;

  sendVoice(
    conversation: Conversation,
    voice: Uint8Array | string,
  ): Promise<Message>;

  sendFile(
    conversation: Conversation,
    file: Uint8Array | string,
    filename: string,
  ): Promise<Message>;

  sendLocation(
    conversation: Conversation,
    lat: number,
    lng: number,
  ): Promise<Message>;

  // ── Events ──────────────────────────────────────────────────

  on<K extends keyof MessagingEvents>(
    event: K,
    handler: EventHandler<K>,
  ): void;

  off<K extends keyof MessagingEvents>(
    event: K,
    handler: EventHandler<K>,
  ): void;

  // ── Interactions ────────────────────────────────────────────

  react(message: Message, emoji: string): Promise<void>;

  reply(message: Message, content: MessageContent): Promise<Message>;

  forward(message: Message, to: Conversation): Promise<Message>;

  delete(message: Message): Promise<void>;

  // ── Presence ────────────────────────────────────────────────

  setTyping(conversation: Conversation, duration?: number): Promise<void>;

  markRead(message: Message): Promise<void>;

  // ── Conversations ───────────────────────────────────────────

  getConversations(): Promise<Conversation[]>;

  getMessages(
    conversation: Conversation,
    limit?: number,
    before?: Date,
  ): Promise<Message[]>;
}
