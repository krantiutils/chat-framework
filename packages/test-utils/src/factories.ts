/**
 * Factory functions for creating test fixtures.
 *
 * Every factory produces valid instances of the core types with sensible
 * defaults. Override any field by passing a partial object.
 */
import type {
  Conversation,
  ConversationType,
  Message,
  MessageContent,
  Platform,
  Reaction,
  User,
} from "@chat-framework/core";

let _idCounter = 0;

/** Reset the auto-incrementing ID counter. Call in beforeEach if needed. */
export function resetIdCounter(): void {
  _idCounter = 0;
}

function nextId(prefix: string): string {
  return `${prefix}-${++_idCounter}`;
}

/**
 * Create a test User.
 *
 * @example
 * ```ts
 * const user = createUser(); // default signal user
 * const alice = createUser({ username: "alice", platform: "telegram" });
 * ```
 */
export function createUser(overrides: Partial<User> = {}): User {
  const id = overrides.id ?? nextId("user");
  return {
    id,
    platform: "signal" as Platform,
    username: `user_${id}`,
    displayName: `User ${id}`,
    ...overrides,
  };
}

/**
 * Create a test Conversation.
 *
 * @example
 * ```ts
 * const dm = createConversation(); // default DM
 * const group = createConversation({ type: "group", participants: [alice, bob] });
 * ```
 */
export function createConversation(
  overrides: Partial<Conversation> = {},
): Conversation {
  const id = overrides.id ?? nextId("conv");
  const type: ConversationType = overrides.type ?? "dm";
  return {
    id,
    platform: "signal" as Platform,
    participants: [],
    type,
    metadata: {},
    ...overrides,
  };
}

/**
 * Create a test MessageContent.
 *
 * Defaults to a text message. Pass a `type` override to get other content types
 * with sensible defaults for their required fields.
 */
export function createContent(
  overrides: Partial<MessageContent> & { type?: MessageContent["type"] } = {},
): MessageContent {
  const type = overrides.type ?? "text";

  switch (type) {
    case "text":
      return { type: "text", text: "test message", ...overrides } as MessageContent;
    case "image":
      return { type: "image", url: "https://example.com/img.jpg", ...overrides } as MessageContent;
    case "video":
      return { type: "video", url: "https://example.com/vid.mp4", ...overrides } as MessageContent;
    case "audio":
      return { type: "audio", url: "https://example.com/audio.mp3", duration: 30, ...overrides } as MessageContent;
    case "voice":
      return { type: "voice", url: "https://example.com/voice.ogg", duration: 5, ...overrides } as MessageContent;
    case "file":
      return { type: "file", url: "https://example.com/doc.pdf", filename: "doc.pdf", size: 1024, ...overrides } as MessageContent;
    case "location":
      return { type: "location", lat: 40.7128, lng: -74.006, ...overrides } as MessageContent;
    case "contact":
      return { type: "contact", name: "Jane Doe", phone: "+15551234567", ...overrides } as MessageContent;
    case "sticker":
      return { type: "sticker", id: "sticker-1", url: "https://example.com/sticker.webp", ...overrides } as MessageContent;
    case "link":
      return { type: "link", url: "https://example.com", ...overrides } as MessageContent;
    default:
      return { type: "text", text: "test message" } as MessageContent;
  }
}

/**
 * Create a test Message.
 *
 * @example
 * ```ts
 * const msg = createMessage(); // default text message
 * const reply = createMessage({ replyTo: msg, content: { type: "text", text: "reply" } });
 * ```
 */
export function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: overrides.id ?? nextId("msg"),
    conversation: overrides.conversation ?? createConversation(),
    sender: overrides.sender ?? createUser(),
    timestamp: overrides.timestamp ?? new Date(1700000000000),
    content: overrides.content ?? createContent(),
    ...overrides,
  };
}

/**
 * Create a test Reaction.
 */
export function createReaction(overrides: Partial<Reaction> = {}): Reaction {
  return {
    emoji: "👍",
    user: overrides.user ?? createUser(),
    timestamp: overrides.timestamp ?? new Date(1700000000000),
    ...overrides,
  };
}
