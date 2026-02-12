import type { SessionProfile } from "../session/profile.js";
import type { RandomFn, ClockFn } from "../session/machine.js";
import { DEFAULT_SESSION_PROFILE, validateProfile } from "../session/profile.js";
import type { Message, MessageContent } from "../messaging/types.js";
import {
  computeReadDelay,
  computeThinkDelay,
  computeTypingDuration,
} from "./timing.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Full response timeline from message receipt to reply sent.
 * All values are durations in milliseconds.
 *
 * The sequence is:
 *   receive → [readDelay] → markRead → [thinkDelay] → startTyping → [typingDuration] → send
 */
export interface ResponseTimeline {
  /** Delay before marking the incoming message as read (ms). */
  readonly readDelay: number;

  /** Delay between marking read and starting to type (ms). */
  readonly thinkDelay: number;

  /** Duration to show typing indicator before sending (ms). */
  readonly typingDuration: number;

  /** Total time from message received to response sent (ms). */
  readonly totalDelay: number;
}

/**
 * Configuration for HumanResponseSimulator.
 */
export interface HumanResponseSimulatorConfig {
  /** User profile controlling behavioral biases. Defaults to average profile. */
  readonly profile?: SessionProfile;

  /** Override the RNG for deterministic testing. Defaults to Math.random. */
  readonly random?: RandomFn;

  /** Override the clock for deterministic testing. Defaults to Date.now. */
  readonly clock?: ClockFn;

  /**
   * Override the hour-of-day resolver for testing.
   * Defaults to extracting from `new Date(clock())`.
   */
  readonly getHour?: (timestamp: number) => number;
}

// ─── Simulator ──────────────────────────────────────────────────────────────

/**
 * Simulates realistic human response timing for chat platforms.
 *
 * This class produces timing values that adapters use to pace their
 * interactions: when to mark messages as read, how long to show typing
 * indicators, and when to send replies. All timing is influenced by:
 *
 * - **User profile**: reading speed, deliberation, activity level
 * - **Time of day**: responses are slower at night, faster during peak hours
 * - **Message content**: longer messages take longer to "read"
 * - **Response length**: longer replies show longer typing indicators
 *
 * The simulator does NOT execute actions or sleep — it only computes
 * timing values. The adapter is responsible for using these values
 * to pace its actual API calls / browser actions.
 *
 * Usage:
 * ```ts
 * const sim = new HumanResponseSimulator({ profile: myProfile });
 *
 * // Plan a full response
 * const timeline = sim.planResponse(incomingMessage, "Sure, I'll check on that.");
 * await sleep(timeline.readDelay);
 * await adapter.markRead(incomingMessage);
 * await sleep(timeline.thinkDelay);
 * await adapter.setTyping(conversation, timeline.typingDuration);
 * await sleep(timeline.typingDuration);
 * await adapter.sendText(conversation, "Sure, I'll check on that.");
 *
 * // Or compute individual delays
 * const readDelay = sim.calculateReadDelay(incomingMessage);
 * const typingDuration = sim.calculateTypingDuration("Thanks!");
 * ```
 */
export class HumanResponseSimulator {
  private readonly _profile: SessionProfile;
  private readonly _random: RandomFn;
  private readonly _clock: ClockFn;
  private readonly _getHour: (timestamp: number) => number;

  constructor(config: HumanResponseSimulatorConfig = {}) {
    this._profile = config.profile
      ? validateProfile(config.profile)
      : DEFAULT_SESSION_PROFILE;
    this._random = config.random ?? Math.random;
    this._clock = config.clock ?? Date.now;
    this._getHour = config.getHour ?? ((ts: number) => new Date(ts).getHours());
  }

  /** The active user profile. */
  get profile(): SessionProfile {
    return this._profile;
  }

  /**
   * Calculate how long to wait before marking a message as read.
   *
   * Based on message content length, reading speed profile, and time of day.
   * Shorter messages (e.g. "ok") yield shorter delays; longer messages
   * yield delays proportional to the reading time.
   */
  calculateReadDelay(message: Message): number {
    const text = extractText(message.content);
    const hour = this._getHour(this._clock());
    return computeReadDelay(text, this._profile, hour, this._random);
  }

  /**
   * Calculate how long the typing indicator should be shown
   * before sending a response of the given text.
   *
   * Based on response word count, simulated WPM from profile, and time of day.
   */
  calculateTypingDuration(responseText: string): number {
    const hour = this._getHour(this._clock());
    return computeTypingDuration(responseText, this._profile, hour, this._random);
  }

  /**
   * Plan the full response timeline: read → think → type → send.
   *
   * Returns a timeline with all delay values that the adapter can
   * execute sequentially to produce a realistic response pattern.
   */
  planResponse(incomingMessage: Message, responseText: string): ResponseTimeline {
    const hour = this._getHour(this._clock());
    const incomingText = extractText(incomingMessage.content);

    const readDelay = computeReadDelay(incomingText, this._profile, hour, this._random);
    const thinkDelay = computeThinkDelay(this._profile, hour, this._random);
    const typingDuration = computeTypingDuration(responseText, this._profile, hour, this._random);

    return {
      readDelay,
      thinkDelay,
      typingDuration,
      totalDelay: readDelay + thinkDelay + typingDuration,
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract readable text from message content for word-count estimation.
 * Non-text content types return a short placeholder to simulate
 * the brief "glance at image/file" reading time.
 */
function extractText(content: MessageContent): string {
  switch (content.type) {
    case "text":
      return content.text;
    case "image":
      return content.caption ?? "image attachment";
    case "video":
      return content.caption ?? "video attachment";
    case "audio":
      return "audio message";
    case "voice":
      return "voice message";
    case "file":
      return content.filename;
    case "location":
      return content.name ?? "shared location";
    case "contact":
      return content.name;
    case "sticker":
      return "sticker";
    case "link":
      return content.preview?.title ?? content.url;
  }
}
