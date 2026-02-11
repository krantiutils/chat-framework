/**
 * Unified messaging client interface.
 *
 * All platform adapters implement this interface, providing a consistent API
 * regardless of the underlying transport (official API, reverse-engineered
 * protocol, or browser automation).
 */

import type {
  Conversation,
  Message,
  MessageContent,
  Reaction,
  User,
  PresenceStatus,
} from "./types.js";

// ─── Event Listener Types ────────────────────────────────────────────────────

export type MessageListener = (message: Message) => void;
export type ReactionListener = (reaction: Reaction, message: Message) => void;
export type TypingListener = (user: User, conversation: Conversation) => void;
export type ReadListener = (user: User, message: Message) => void;
export type PresenceListener = (user: User, status: PresenceStatus) => void;

/** Event name to listener type mapping. */
export interface MessagingEventMap {
  message: MessageListener;
  reaction: ReactionListener;
  typing: TypingListener;
  read: ReadListener;
  presence: PresenceListener;
}

/** Valid event names. */
export type MessagingEvent = keyof MessagingEventMap;

// ─── MessagingClient Interface ───────────────────────────────────────────────

export interface MessagingClient {
  // ── Connection ──────────────────────────────────────────────────────────────

  /** Establish a connection to the platform. */
  connect(): Promise<void>;

  /** Disconnect from the platform and release resources. */
  disconnect(): Promise<void>;

  /** Whether the client is currently connected. */
  isConnected(): boolean;

  // ── Sending ─────────────────────────────────────────────────────────────────

  /** Send a text message to a conversation. */
  sendText(conversation: Conversation, text: string): Promise<Message>;

  /**
   * Send an image to a conversation.
   * @param image File path or URL of the image.
   */
  sendImage(
    conversation: Conversation,
    image: string,
    caption?: string,
  ): Promise<Message>;

  /**
   * Send a file to a conversation.
   * @param file File path of the file to upload.
   */
  sendFile(
    conversation: Conversation,
    file: string,
    filename: string,
  ): Promise<Message>;

  // ── Receiving (event-based) ─────────────────────────────────────────────────

  /**
   * Register a listener for a messaging event. Returns an unsubscribe function.
   */
  on<E extends MessagingEvent>(
    event: E,
    handler: MessagingEventMap[E],
  ): () => void;

  // ── Interactions ────────────────────────────────────────────────────────────

  /** React to a message with an emoji. */
  react(message: Message, emoji: string): Promise<void>;

  /** Reply to a message with new content. */
  reply(message: Message, content: MessageContent): Promise<Message>;

  /** Delete a message (if supported by the platform). */
  delete(message: Message): Promise<void>;

  // ── Presence ────────────────────────────────────────────────────────────────

  /**
   * Simulate typing indicator in a conversation.
   * @param durationMs How long to show typing (ms). Defaults to platform-specific value.
   */
  setTyping(conversation: Conversation, durationMs?: number): Promise<void>;

  /** Mark a message as read. */
  markRead(message: Message): Promise<void>;

  // ── Queries ─────────────────────────────────────────────────────────────────

  /** List available conversations. */
  getConversations(): Promise<Conversation[]>;

  /**
   * Get messages from a conversation.
   * @param limit Maximum number of messages to return.
   * @param before Only return messages before this date.
   */
  getMessages(
    conversation: Conversation,
    limit?: number,
    before?: Date,
  ): Promise<Message[]>;
}
