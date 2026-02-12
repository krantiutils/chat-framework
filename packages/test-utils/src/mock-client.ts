/**
 * Mock implementation of the MessagingClient interface for testing.
 *
 * Every method is a vitest spy (vi.fn) with configurable default behavior.
 * Event registration works out of the box — you can emit events from tests
 * to trigger handlers registered via on().
 *
 * @example
 * ```ts
 * const client = new MockMessagingClient();
 * await client.connect();
 *
 * // Register a handler in the code under test
 * client.on("message", handler);
 *
 * // Emit from the test to trigger the handler
 * client.emit("message", createMessage());
 *
 * // Assert send calls
 * expect(client.sendText).toHaveBeenCalledWith(conv, "hello");
 * ```
 */
import { vi } from "vitest";
import type { Mock } from "vitest";

import type {
  Conversation,
  Message,
  MessageContent,
  MessagingClient,
  MessagingClientEvents,
  MessagingEventName,
} from "@chat-framework/core";

import { createMessage } from "./factories.js";

export class MockMessagingClient implements MessagingClient {
  private _connected = false;
  private readonly _listeners = new Map<
    MessagingEventName,
    Set<(...args: unknown[]) => void>
  >();

  // ── Connection ──────────────────────────────────────────────────────────────

  connect: Mock<() => Promise<void>> = vi.fn(async () => {
    this._connected = true;
  });

  disconnect: Mock<() => Promise<void>> = vi.fn(async () => {
    this._connected = false;
  });

  isConnected: Mock<() => boolean> = vi.fn(() => this._connected);

  // ── Sending ─────────────────────────────────────────────────────────────────

  sendText: Mock<(conversation: Conversation, text: string) => Promise<Message>> =
    vi.fn(async (conversation: Conversation, text: string) =>
      createMessage({ conversation, content: { type: "text", text } }),
    );

  sendImage: Mock<
    (conversation: Conversation, image: Buffer | string, caption?: string) => Promise<Message>
  > = vi.fn(
    async (conversation: Conversation, image: Buffer | string, caption?: string) =>
      createMessage({
        conversation,
        content: {
          type: "image",
          url: typeof image === "string" ? image : "buffer://mock",
          caption,
        },
      }),
  );

  sendAudio: Mock<
    (conversation: Conversation, audio: Buffer | string) => Promise<Message>
  > = vi.fn(async (conversation: Conversation, _audio: Buffer | string) =>
    createMessage({
      conversation,
      content: { type: "audio", url: "mock://audio", duration: 0 },
    }),
  );

  sendVoice: Mock<
    (conversation: Conversation, voice: Buffer | string) => Promise<Message>
  > = vi.fn(async (conversation: Conversation, _voice: Buffer | string) =>
    createMessage({
      conversation,
      content: { type: "voice", url: "mock://voice", duration: 0 },
    }),
  );

  sendFile: Mock<
    (conversation: Conversation, file: Buffer | string, filename: string) => Promise<Message>
  > = vi.fn(
    async (conversation: Conversation, _file: Buffer | string, filename: string) =>
      createMessage({
        conversation,
        content: { type: "file", url: "mock://file", filename, size: 0 },
      }),
  );

  sendLocation: Mock<
    (conversation: Conversation, lat: number, lng: number) => Promise<Message>
  > = vi.fn(async (conversation: Conversation, lat: number, lng: number) =>
    createMessage({
      conversation,
      content: { type: "location", lat, lng },
    }),
  );

  // ── Events ──────────────────────────────────────────────────────────────────

  on<E extends MessagingEventName>(
    event: E,
    handler: MessagingClientEvents[E],
  ): void {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(handler as (...args: unknown[]) => void);
  }

  off<E extends MessagingEventName>(
    event: E,
    handler: MessagingClientEvents[E],
  ): void {
    this._listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  /**
   * Emit an event to all registered listeners. This is the test-side API
   * for simulating incoming events (messages, typing, etc.).
   */
  emit<E extends MessagingEventName>(
    event: E,
    ...args: Parameters<MessagingClientEvents[E]>
  ): void {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      handler(...args);
    }
  }

  /** Return the number of listeners registered for a given event. */
  listenerCount(event: MessagingEventName): number {
    return this._listeners.get(event)?.size ?? 0;
  }

  // ── Interactions ────────────────────────────────────────────────────────────

  react: Mock<(message: Message, emoji: string) => Promise<void>> = vi.fn(
    async () => {},
  );

  reply: Mock<(message: Message, content: MessageContent) => Promise<Message>> =
    vi.fn(async (message: Message, content: MessageContent) =>
      createMessage({ conversation: message.conversation, content }),
    );

  forward: Mock<(message: Message, to: Conversation) => Promise<Message>> =
    vi.fn(async (message: Message, to: Conversation) =>
      createMessage({ conversation: to, content: message.content }),
    );

  delete: Mock<(message: Message) => Promise<void>> = vi.fn(async () => {});

  // ── Presence ────────────────────────────────────────────────────────────────

  setTyping: Mock<
    (conversation: Conversation, duration?: number) => Promise<void>
  > = vi.fn(async () => {});

  markRead: Mock<(message: Message) => Promise<void>> = vi.fn(async () => {});

  // ── Conversations ───────────────────────────────────────────────────────────

  getConversations: Mock<() => Promise<Conversation[]>> = vi.fn(
    async () => [],
  );

  getMessages: Mock<
    (conversation: Conversation, limit?: number, before?: Date) => Promise<Message[]>
  > = vi.fn(async () => []);

  // ── Test Utilities ──────────────────────────────────────────────────────────

  /**
   * Reset all mocks and clear listeners. Call in afterEach.
   */
  reset(): void {
    this._connected = false;
    this._listeners.clear();

    this.connect.mockClear();
    this.disconnect.mockClear();
    this.isConnected.mockClear();
    this.sendText.mockClear();
    this.sendImage.mockClear();
    this.sendAudio.mockClear();
    this.sendVoice.mockClear();
    this.sendFile.mockClear();
    this.sendLocation.mockClear();
    this.react.mockClear();
    this.reply.mockClear();
    this.forward.mockClear();
    this.delete.mockClear();
    this.setTyping.mockClear();
    this.markRead.mockClear();
    this.getConversations.mockClear();
    this.getMessages.mockClear();
  }
}
