import { describe, it, expect } from "vitest";
import {
  HumanResponseSimulator,
  computeReadDelay,
  computeThinkDelay,
  computeTypingDuration,
  countWords,
  sampleRange,
  clamp,
  applyVariance,
  getTimeMultiplier,
  READ_DELAY_BOUNDS,
  THINK_DELAY_BOUNDS,
  TYPING_DURATION_BOUNDS,
} from "../simulation/index.js";
import { DEFAULT_SESSION_PROFILE } from "../session/profile.js";
import type { SessionProfile } from "../session/profile.js";
import type { Message, MessageContent, Conversation, User } from "../messaging/types.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<SessionProfile> = {}): SessionProfile {
  return { ...DEFAULT_SESSION_PROFILE, ...overrides };
}

function makeMessage(content: MessageContent): Message {
  const user: User = { id: "user-1", platform: "whatsapp", displayName: "Alice" };
  const conversation: Conversation = {
    id: "conv-1",
    platform: "whatsapp",
    participants: [user],
    type: "dm",
    metadata: {},
  };
  return {
    id: "msg-1",
    conversation,
    sender: user,
    timestamp: new Date("2026-02-12T10:30:00Z"),
    content,
  };
}

function textMessage(text: string): Message {
  return makeMessage({ type: "text", text });
}

/** Create a deterministic RNG from a fixed sequence. */
function seededRandom(seq: number[]): () => number {
  let idx = 0;
  return () => {
    const val = seq[idx % seq.length];
    idx++;
    return val;
  };
}

// ─── countWords ──────────────────────────────────────────────────────────────

describe("countWords", () => {
  it("counts words in normal text", () => {
    expect(countWords("hello world")).toBe(2);
    expect(countWords("one two three four five")).toBe(5);
  });

  it("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });

  it("handles single word", () => {
    expect(countWords("hello")).toBe(1);
  });

  it("handles multiple whitespace", () => {
    expect(countWords("hello   world")).toBe(2);
    expect(countWords("  spaced  out  text  ")).toBe(3);
  });

  it("handles tabs and newlines", () => {
    expect(countWords("hello\tworld\nfoo")).toBe(3);
  });
});

// ─── sampleRange ─────────────────────────────────────────────────────────────

describe("sampleRange", () => {
  it("returns min when random = 0", () => {
    expect(sampleRange({ min: 100, max: 200 }, () => 0)).toBe(100);
  });

  it("returns max when random → 1", () => {
    expect(sampleRange({ min: 100, max: 200 }, () => 0.999)).toBeCloseTo(200, 0);
  });

  it("returns midpoint when random = 0.5", () => {
    expect(sampleRange({ min: 100, max: 200 }, () => 0.5)).toBe(150);
  });
});

// ─── clamp ───────────────────────────────────────────────────────────────────

describe("clamp", () => {
  it("returns value when in range", () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });

  it("clamps to min", () => {
    expect(clamp(-10, 0, 100)).toBe(0);
  });

  it("clamps to max", () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });
});

// ─── applyVariance ───────────────────────────────────────────────────────────

describe("applyVariance", () => {
  it("applies no variance when random = 0.5 (jitter=0)", () => {
    // random=0.5 → (0.5*2-1)*fraction = 0 → multiplier=1
    expect(applyVariance(1000, 0.2, () => 0.5)).toBe(1000);
  });

  it("applies positive variance when random > 0.5", () => {
    // random=1 → (1*2-1)*0.2 = 0.2 → multiplier=1.2
    expect(applyVariance(1000, 0.2, () => 1)).toBe(1200);
  });

  it("applies negative variance when random < 0.5", () => {
    // random=0 → (0*2-1)*0.2 = -0.2 → multiplier=0.8
    expect(applyVariance(1000, 0.2, () => 0)).toBe(800);
  });
});

// ─── getTimeMultiplier ───────────────────────────────────────────────────────

describe("getTimeMultiplier", () => {
  it("returns 0.8 for peak hours", () => {
    expect(getTimeMultiplier(10)).toBe(0.8); // 10am = PEAK
    expect(getTimeMultiplier(15)).toBe(0.8); // 3pm = PEAK
  });

  it("returns 1.0 for normal hours", () => {
    expect(getTimeMultiplier(13)).toBe(1.0); // 1pm = NORMAL
    expect(getTimeMultiplier(19)).toBe(1.0); // 7pm = NORMAL
  });

  it("returns 1.5 for low hours", () => {
    expect(getTimeMultiplier(22)).toBe(1.5); // 10pm = LOW
  });

  it("returns 3.0 for dormant hours", () => {
    expect(getTimeMultiplier(3)).toBe(3.0); // 3am = DORMANT
  });
});

// ─── computeReadDelay ────────────────────────────────────────────────────────

describe("computeReadDelay", () => {
  const profile = DEFAULT_SESSION_PROFILE;
  const noonHour = 13; // NORMAL period

  it("returns a value within bounds", () => {
    const random = seededRandom([0.5]);
    const delay = computeReadDelay("hello world", profile, noonHour, random);
    expect(delay).toBeGreaterThanOrEqual(READ_DELAY_BOUNDS.min);
    expect(delay).toBeLessThanOrEqual(READ_DELAY_BOUNDS.max);
  });

  it("produces longer delays for longer messages", () => {
    const shortRandom = seededRandom([0.5]);
    const longRandom = seededRandom([0.5]);

    const shortDelay = computeReadDelay("ok", profile, noonHour, shortRandom);
    const longDelay = computeReadDelay(
      "This is a much longer message with many words that should take longer to read through completely",
      profile,
      noonHour,
      longRandom,
    );

    expect(longDelay).toBeGreaterThan(shortDelay);
  });

  it("produces shorter delays for fast readers", () => {
    const fastRandom = seededRandom([0.5]);
    const slowRandom = seededRandom([0.5]);

    const fastProfile = makeProfile({ readingSpeed: 1.0 });
    const slowProfile = makeProfile({ readingSpeed: 0.0 });

    const fastDelay = computeReadDelay("hello world foo bar baz", fastProfile, noonHour, fastRandom);
    const slowDelay = computeReadDelay("hello world foo bar baz", slowProfile, noonHour, slowRandom);

    expect(fastDelay).toBeLessThan(slowDelay);
  });

  it("produces longer delays during dormant hours", () => {
    const dayRandom = seededRandom([0.5]);
    const nightRandom = seededRandom([0.5]);

    const dayDelay = computeReadDelay("hello world", profile, 10, dayRandom); // PEAK
    const nightDelay = computeReadDelay("hello world", profile, 3, nightRandom); // DORMANT

    expect(nightDelay).toBeGreaterThan(dayDelay);
  });

  it("clamps to minimum for empty message", () => {
    const random = seededRandom([0.0]); // Lowest possible values
    const delay = computeReadDelay("", profile, noonHour, random);
    expect(delay).toBeGreaterThanOrEqual(READ_DELAY_BOUNDS.min);
  });

  it("clamps to maximum for extremely long message", () => {
    const random = seededRandom([0.99]);
    const longText = "word ".repeat(500).trim();
    const delay = computeReadDelay(longText, profile, 3, random); // DORMANT + long text
    expect(delay).toBeLessThanOrEqual(READ_DELAY_BOUNDS.max);
  });

  it("is deterministic with same seed", () => {
    const r1 = seededRandom([0.3, 0.7, 0.5]);
    const r2 = seededRandom([0.3, 0.7, 0.5]);

    const d1 = computeReadDelay("test message", profile, noonHour, r1);
    const d2 = computeReadDelay("test message", profile, noonHour, r2);

    expect(d1).toBe(d2);
  });
});

// ─── computeThinkDelay ───────────────────────────────────────────────────────

describe("computeThinkDelay", () => {
  const noonHour = 13;

  it("returns a value within bounds", () => {
    const random = seededRandom([0.5]);
    const delay = computeThinkDelay(DEFAULT_SESSION_PROFILE, noonHour, random);
    expect(delay).toBeGreaterThanOrEqual(THINK_DELAY_BOUNDS.min);
    expect(delay).toBeLessThanOrEqual(THINK_DELAY_BOUNDS.max);
  });

  it("produces longer delays for deliberate users", () => {
    const impulsiveRandom = seededRandom([0.5]);
    const deliberateRandom = seededRandom([0.5]);

    const impulsive = makeProfile({ deliberation: 0.0 });
    const deliberate = makeProfile({ deliberation: 1.0 });

    const impulsiveDelay = computeThinkDelay(impulsive, noonHour, impulsiveRandom);
    const deliberateDelay = computeThinkDelay(deliberate, noonHour, deliberateRandom);

    expect(deliberateDelay).toBeGreaterThan(impulsiveDelay);
  });

  it("produces longer delays at night", () => {
    const dayRandom = seededRandom([0.5]);
    const nightRandom = seededRandom([0.5]);

    const dayDelay = computeThinkDelay(DEFAULT_SESSION_PROFILE, 10, dayRandom);
    const nightDelay = computeThinkDelay(DEFAULT_SESSION_PROFILE, 3, nightRandom);

    expect(nightDelay).toBeGreaterThan(dayDelay);
  });
});

// ─── computeTypingDuration ───────────────────────────────────────────────────

describe("computeTypingDuration", () => {
  const noonHour = 13;

  it("returns minimum for empty text", () => {
    const random = seededRandom([0.5]);
    const duration = computeTypingDuration("", DEFAULT_SESSION_PROFILE, noonHour, random);
    expect(duration).toBe(TYPING_DURATION_BOUNDS.min);
  });

  it("returns a value within bounds for normal text", () => {
    const random = seededRandom([0.5]);
    const duration = computeTypingDuration("hello world", DEFAULT_SESSION_PROFILE, noonHour, random);
    expect(duration).toBeGreaterThanOrEqual(TYPING_DURATION_BOUNDS.min);
    expect(duration).toBeLessThanOrEqual(TYPING_DURATION_BOUNDS.max);
  });

  it("produces longer durations for longer responses", () => {
    const shortRandom = seededRandom([0.5]);
    const longRandom = seededRandom([0.5]);

    const shortDuration = computeTypingDuration("ok", DEFAULT_SESSION_PROFILE, noonHour, shortRandom);
    const longDuration = computeTypingDuration(
      "This is a much longer response message with many words that would take more time to type out completely",
      DEFAULT_SESSION_PROFILE,
      noonHour,
      longRandom,
    );

    expect(longDuration).toBeGreaterThan(shortDuration);
  });

  it("produces shorter durations for high-activity users", () => {
    const slowRandom = seededRandom([0.5]);
    const fastRandom = seededRandom([0.5]);

    const slowProfile = makeProfile({ activityLevel: 0.0 }); // 25 WPM
    const fastProfile = makeProfile({ activityLevel: 1.0 }); // 90 WPM

    const text = "This is a test response with several words to type";
    const slowDuration = computeTypingDuration(text, slowProfile, noonHour, slowRandom);
    const fastDuration = computeTypingDuration(text, fastProfile, noonHour, fastRandom);

    expect(slowDuration).toBeGreaterThan(fastDuration);
  });

  it("clamps to maximum for extremely long text", () => {
    const random = seededRandom([0.99]);
    const longText = "word ".repeat(2000).trim();
    const duration = computeTypingDuration(longText, DEFAULT_SESSION_PROFILE, 3, random);
    expect(duration).toBeLessThanOrEqual(TYPING_DURATION_BOUNDS.max);
  });
});

// ─── HumanResponseSimulator ─────────────────────────────────────────────────

describe("HumanResponseSimulator", () => {
  function createTestSimulator(opts: {
    profile?: Partial<SessionProfile>;
    randomSeq?: number[];
    hour?: number;
  } = {}) {
    let idx = 0;
    const seq = opts.randomSeq ?? [0.5];
    const random = () => {
      const val = seq[idx % seq.length];
      idx++;
      return val;
    };

    const hour = opts.hour ?? 13; // NORMAL period

    const sim = new HumanResponseSimulator({
      profile: opts.profile ? makeProfile(opts.profile) : undefined,
      random,
      clock: () => 1_000_000,
      getHour: () => hour,
    });

    return sim;
  }

  describe("constructor", () => {
    it("uses default profile when none provided", () => {
      const sim = createTestSimulator();
      expect(sim.profile).toEqual(DEFAULT_SESSION_PROFILE);
    });

    it("validates and clamps profile values", () => {
      const sim = createTestSimulator({
        profile: { readingSpeed: 1.5 }, // Over 1.0
      });
      expect(sim.profile.readingSpeed).toBe(1.0);
    });
  });

  describe("calculateReadDelay", () => {
    it("returns a positive delay", () => {
      const sim = createTestSimulator();
      const delay = sim.calculateReadDelay(textMessage("hello"));
      expect(delay).toBeGreaterThan(0);
    });

    it("scales with message length", () => {
      const sim1 = createTestSimulator({ randomSeq: [0.5] });
      const sim2 = createTestSimulator({ randomSeq: [0.5] });

      const shortDelay = sim1.calculateReadDelay(textMessage("hi"));
      const longDelay = sim2.calculateReadDelay(
        textMessage("This is a longer message that should take more time to read through carefully"),
      );

      expect(longDelay).toBeGreaterThan(shortDelay);
    });

    it("handles non-text content", () => {
      const sim = createTestSimulator();

      const imageDelay = sim.calculateReadDelay(makeMessage({ type: "image", url: "img.jpg" }));
      expect(imageDelay).toBeGreaterThan(0);

      const stickerDelay = sim.calculateReadDelay(makeMessage({ type: "sticker", id: "s1", url: "s.png" }));
      expect(stickerDelay).toBeGreaterThan(0);
    });

    it("uses caption for image messages", () => {
      const sim1 = createTestSimulator({ randomSeq: [0.5] });
      const sim2 = createTestSimulator({ randomSeq: [0.5] });

      const noCaption = sim1.calculateReadDelay(
        makeMessage({ type: "image", url: "img.jpg" }),
      );
      const withCaption = sim2.calculateReadDelay(
        makeMessage({ type: "image", url: "img.jpg", caption: "Look at this wonderful landscape photo from my vacation trip" }),
      );

      expect(withCaption).toBeGreaterThan(noCaption);
    });
  });

  describe("calculateTypingDuration", () => {
    it("returns a positive duration", () => {
      const sim = createTestSimulator();
      const duration = sim.calculateTypingDuration("hello");
      expect(duration).toBeGreaterThan(0);
    });

    it("returns minimum for empty response", () => {
      const sim = createTestSimulator();
      const duration = sim.calculateTypingDuration("");
      expect(duration).toBe(TYPING_DURATION_BOUNDS.min);
    });

    it("scales with response length", () => {
      const sim1 = createTestSimulator({ randomSeq: [0.5] });
      const sim2 = createTestSimulator({ randomSeq: [0.5] });

      const shortDuration = sim1.calculateTypingDuration("ok");
      const longDuration = sim2.calculateTypingDuration(
        "This is a much longer response message that would take more time to compose and type out",
      );

      expect(longDuration).toBeGreaterThan(shortDuration);
    });
  });

  describe("planResponse", () => {
    it("returns a complete timeline", () => {
      const sim = createTestSimulator();
      const timeline = sim.planResponse(
        textMessage("How are you?"),
        "I'm doing great, thanks for asking!",
      );

      expect(timeline.readDelay).toBeGreaterThan(0);
      expect(timeline.thinkDelay).toBeGreaterThan(0);
      expect(timeline.typingDuration).toBeGreaterThan(0);
      expect(timeline.totalDelay).toBe(
        timeline.readDelay + timeline.thinkDelay + timeline.typingDuration,
      );
    });

    it("totalDelay is sum of all phases", () => {
      const sim = createTestSimulator();
      const timeline = sim.planResponse(
        textMessage("What's the plan for today?"),
        "Let me check the schedule and get back to you on that",
      );

      expect(timeline.totalDelay).toBe(
        timeline.readDelay + timeline.thinkDelay + timeline.typingDuration,
      );
    });

    it("is deterministic with same seed", () => {
      const sim1 = createTestSimulator({ randomSeq: [0.3, 0.7, 0.5, 0.2, 0.9, 0.1, 0.4] });
      const sim2 = createTestSimulator({ randomSeq: [0.3, 0.7, 0.5, 0.2, 0.9, 0.1, 0.4] });

      const msg = textMessage("test message");
      const response = "test response";

      const t1 = sim1.planResponse(msg, response);
      const t2 = sim2.planResponse(msg, response);

      expect(t1).toEqual(t2);
    });

    it("produces longer total delay for longer conversations", () => {
      const sim1 = createTestSimulator({ randomSeq: [0.5] });
      const sim2 = createTestSimulator({ randomSeq: [0.5] });

      const shortTimeline = sim1.planResponse(
        textMessage("hi"),
        "hey",
      );
      const longTimeline = sim2.planResponse(
        textMessage("Can you explain how the new feature works and what changes were made to the codebase?"),
        "Sure, the new feature involves several changes across multiple files. First, we updated the database schema to add a new column for tracking user preferences. Then we modified the API endpoints to accept the new parameters. Finally we updated the frontend components to display the new options.",
      );

      expect(longTimeline.totalDelay).toBeGreaterThan(shortTimeline.totalDelay);
    });

    it("respects time-of-day — slower responses at night", () => {
      const daySim = createTestSimulator({ hour: 10, randomSeq: [0.5] }); // PEAK
      const nightSim = createTestSimulator({ hour: 3, randomSeq: [0.5] }); // DORMANT

      const msg = textMessage("test message with some words");
      const response = "test response with some words here";

      const dayTimeline = daySim.planResponse(msg, response);
      const nightTimeline = nightSim.planResponse(msg, response);

      expect(nightTimeline.totalDelay).toBeGreaterThan(dayTimeline.totalDelay);
    });

    it("respects profile — deliberate users respond slower", () => {
      const impulsiveSim = createTestSimulator({
        profile: { deliberation: 0.0, readingSpeed: 1.0, activityLevel: 1.0 },
        randomSeq: [0.5],
      });
      const deliberateSim = createTestSimulator({
        profile: { deliberation: 1.0, readingSpeed: 0.0, activityLevel: 0.0 },
        randomSeq: [0.5],
      });

      const msg = textMessage("What do you think about this approach?");
      const response = "I think we should consider the alternatives carefully";

      const impulsiveTimeline = impulsiveSim.planResponse(msg, response);
      const deliberateTimeline = deliberateSim.planResponse(msg, response);

      expect(deliberateTimeline.totalDelay).toBeGreaterThan(impulsiveTimeline.totalDelay);
    });
  });
});
