import type { Conversation } from "./conversation.js";
import type { Message, MessageContent, Reaction } from "./message.js";
import type { User } from "./user.js";

/** Event types emitted by a messaging client. */
export interface MessagingClientEvents {
  message: (msg: Message) => void;
  reaction: (reaction: Reaction, msg: Message) => void;
  typing: (user: User, conversation: Conversation) => void;
  read: (user: User, msg: Message) => void;
  presence: (user: User, status: "online" | "offline") => void;
  error: (error: Error) => void;
}

/** Event name union for type-safe event handling. */
export type MessagingEventName = keyof MessagingClientEvents;

/**
 * Unified messaging client interface that all platform adapters must implement.
 *
 * This abstraction provides a consistent API across Telegram, Discord, WhatsApp,
 * Instagram, Facebook, and Signal — regardless of whether the underlying
 * implementation uses an official API, a reverse-engineered protocol, browser
 * automation, or a CLI tool.
 */
export interface MessagingClient {
  // ── Connection ──────────────────────────────────────────────────────────────

  /** Establish connection to the platform. */
  connect(): Promise<void>;

  /** Gracefully disconnect from the platform. */
  disconnect(): Promise<void>;

  /** Whether the client is currently connected and operational. */
  isConnected(): boolean;

  // ── Sending ─────────────────────────────────────────────────────────────────

  sendText(conversation: Conversation, text: string): Promise<Message>;

  sendImage(
    conversation: Conversation,
    image: Buffer | string,
    caption?: string,
  ): Promise<Message>;

  sendAudio(
    conversation: Conversation,
    audio: Buffer | string,
  ): Promise<Message>;

  sendVoice(
    conversation: Conversation,
    voice: Buffer | string,
  ): Promise<Message>;

  sendFile(
    conversation: Conversation,
    file: Buffer | string,
    filename: string,
  ): Promise<Message>;

  sendLocation(
    conversation: Conversation,
    lat: number,
    lng: number,
  ): Promise<Message>;

  // ── Receiving (event-based) ─────────────────────────────────────────────────

  on<E extends MessagingEventName>(
    event: E,
    handler: MessagingClientEvents[E],
  ): void;

  off<E extends MessagingEventName>(
    event: E,
    handler: MessagingClientEvents[E],
  ): void;

  // ── Interactions ────────────────────────────────────────────────────────────

  react(message: Message, emoji: string): Promise<void>;
  reply(message: Message, content: MessageContent): Promise<Message>;
  forward(message: Message, to: Conversation): Promise<Message>;
  delete(message: Message): Promise<void>;

  // ── Presence ────────────────────────────────────────────────────────────────

  setTyping(conversation: Conversation, duration?: number): Promise<void>;
  markRead(message: Message): Promise<void>;

  // ── Conversations ───────────────────────────────────────────────────────────

  getConversations(): Promise<Conversation[]>;
  getMessages(
    conversation: Conversation,
    limit?: number,
    before?: Date,
  ): Promise<Message[]>;
}
