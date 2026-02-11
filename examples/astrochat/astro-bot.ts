/**
 * AstroChat bot — demonstrates chat framework integration patterns.
 *
 * This bot uses the session state machine to drive human-like behavior:
 * - Waits in IDLE before responding
 * - Transitions to READING when a message arrives
 * - Moves to THINKING to simulate composing a response
 * - Enters ACTIVE to type and send the reply
 * - Respects typing delays based on message length
 */

import {
  SessionStateMachine,
  SessionState,
  ActivityType,
} from "@chat-framework/core";
import type { TransitionEvent, SessionProfile } from "@chat-framework/core";

/** A simulated incoming message. */
export interface ChatMessage {
  from: string;
  text: string;
  timestamp: number;
}

/** A response queued for sending. */
export interface QueuedResponse {
  to: string;
  text: string;
  typingDurationMs: number;
}

/** Zodiac sign lookup by birth date range. */
const ZODIAC_SIGNS = [
  { sign: "Capricorn", start: [12, 22], end: [1, 19] },
  { sign: "Aquarius", start: [1, 20], end: [2, 18] },
  { sign: "Pisces", start: [2, 19], end: [3, 20] },
  { sign: "Aries", start: [3, 21], end: [4, 19] },
  { sign: "Taurus", start: [4, 20], end: [5, 20] },
  { sign: "Gemini", start: [5, 21], end: [6, 20] },
  { sign: "Cancer", start: [6, 21], end: [7, 22] },
  { sign: "Leo", start: [7, 23], end: [8, 22] },
  { sign: "Virgo", start: [8, 23], end: [9, 22] },
  { sign: "Libra", start: [9, 23], end: [10, 22] },
  { sign: "Scorpio", start: [10, 23], end: [11, 21] },
  { sign: "Sagittarius", start: [11, 22], end: [12, 21] },
];

const READINGS: Record<string, string[]> = {
  Aries: [
    "Mars energizes your communication sector today. Bold moves in conversation pay off.",
    "Your fire energy is magnetic right now. Someone important is paying attention.",
  ],
  Taurus: [
    "Venus aligns with your financial house. A steady opportunity presents itself.",
    "Ground yourself today. The stability you crave is closer than you think.",
  ],
  Gemini: [
    "Mercury sharpens your wit today. Your words carry extra weight.",
    "A dual perspective serves you well. Trust both sides of your intuition.",
  ],
  Cancer: [
    "The Moon illuminates your home sector. Nurture what matters most.",
    "Emotional intelligence is your superpower today. Lead with empathy.",
  ],
  Leo: [
    "The Sun amplifies your creative output. Share your vision boldly.",
    "Your natural magnetism peaks today. Step into the spotlight.",
  ],
  Virgo: [
    "Mercury brings clarity to complex problems. Your analytical edge is sharp.",
    "Details matter today. Your careful approach prevents a costly mistake.",
  ],
  Libra: [
    "Venus harmonizes your partnerships. Collaboration brings unexpected rewards.",
    "Balance is not just your nature — it's your strategy today.",
  ],
  Scorpio: [
    "Pluto deepens your insight. Hidden truths surface for those brave enough to look.",
    "Transformation is uncomfortable but necessary. Trust the process.",
  ],
  Sagittarius: [
    "Jupiter expands your horizons. An unexpected journey shifts your perspective.",
    "Your optimism is well-placed today. The arrow you shoot finds its mark.",
  ],
  Capricorn: [
    "Saturn rewards your discipline. Long-term plans crystallize into reality.",
    "Your patience is about to pay dividends. Keep climbing.",
  ],
  Aquarius: [
    "Uranus sparks innovation in your sector. Unconventional ideas gain traction.",
    "Your vision for the future resonates with others today.",
  ],
  Pisces: [
    "Neptune enhances your intuition. Pay attention to dreams and symbols.",
    "Creative flow is strong today. Let your imagination guide you.",
  ],
};

/**
 * AstroChat bot that responds to messages with astrology readings,
 * driven by the session state machine for human-like pacing.
 */
export class AstroBot {
  readonly machine: SessionStateMachine;
  private readonly pendingMessages: ChatMessage[] = [];
  private readonly responseQueue: QueuedResponse[] = [];

  constructor(profile?: SessionProfile) {
    this.machine = new SessionStateMachine({
      profile: profile ?? {
        idleTendency: 0.4,
        afkProneness: 0.15,
        readingSpeed: 0.6,
        scrollTendency: 0.3,
        deliberation: 0.7, // Thoughtful astrologer
        activityLevel: 0.5,
      },
    });

    this.machine.onTransition((event: TransitionEvent) => {
      console.log(
        `  [state] ${event.from} -> ${event.to} (${event.dwellTime}ms in ${event.from})`
      );
    });
  }

  /**
   * Receive an incoming message. The bot doesn't respond immediately —
   * it queues the message and the state machine controls when processing happens.
   */
  receiveMessage(message: ChatMessage): void {
    console.log(`  [inbox] Message from ${message.from}: "${message.text}"`);
    this.pendingMessages.push(message);

    // Force transition to READING when a message arrives
    if (this.machine.state === SessionState.IDLE) {
      this.machine.forceTransition(SessionState.READING);
    }
  }

  /**
   * Tick the bot. Call this periodically. Returns any responses that are
   * ready to send (typing delay has elapsed).
   */
  tick(): QueuedResponse[] {
    const snapshot = this.machine.tick();
    const ready: QueuedResponse[] = [];

    switch (snapshot.state) {
      case SessionState.READING:
        // Process pending messages while in READING state
        this.processNextMessage();
        break;

      case SessionState.THINKING:
        // Composing response — nothing to do externally
        break;

      case SessionState.ACTIVE:
        // Ready to send queued responses
        this.machine.setActivityType(ActivityType.TYPING);
        while (this.responseQueue.length > 0) {
          const response = this.responseQueue.shift()!;
          ready.push(response);
          console.log(
            `  [send] To ${response.to}: "${response.text}" (typing: ${response.typingDurationMs}ms)`
          );
        }
        break;

      case SessionState.IDLE:
      case SessionState.AWAY:
      case SessionState.SCROLLING:
        this.machine.setActivityType(ActivityType.BROWSING);
        break;
    }

    return ready;
  }

  private processNextMessage(): void {
    const message = this.pendingMessages.shift();
    if (!message) return;

    const response = this.generateReading(message.text);
    const typingDurationMs = response.length * 45 + Math.random() * 500;

    this.responseQueue.push({
      to: message.from,
      text: response,
      typingDurationMs: Math.round(typingDurationMs),
    });

    // After reading, transition to thinking
    this.machine.forceTransition(SessionState.THINKING);
  }

  private generateReading(input: string): string {
    const text = input.toLowerCase().trim();

    // Check if user mentioned a zodiac sign
    for (const { sign } of ZODIAC_SIGNS) {
      if (text.includes(sign.toLowerCase())) {
        const readings = READINGS[sign];
        const reading = readings[Math.floor(Math.random() * readings.length)];
        return `${sign}: ${reading}`;
      }
    }

    // Check for greetings
    if (
      text.includes("hello") ||
      text.includes("hi") ||
      text.includes("hey")
    ) {
      return "Welcome to AstroChat! Tell me your zodiac sign for a personalized reading. Or just say your sign — Aries, Taurus, Gemini...";
    }

    // Check for help
    if (text.includes("help") || text.includes("how")) {
      return "Just tell me your zodiac sign and I'll give you today's reading. For example, say 'Aries' or 'What's in store for Leo?'";
    }

    // Default response
    return "I didn't catch your sign. Try telling me your zodiac sign — like Aries, Taurus, Gemini, Cancer, Leo, Virgo, Libra, Scorpio, Sagittarius, Capricorn, Aquarius, or Pisces.";
  }
}
