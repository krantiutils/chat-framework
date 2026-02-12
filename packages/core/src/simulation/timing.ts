import { TimePeriod, getTimePeriod } from "../session/transitions.js";
import type { SessionProfile } from "../session/profile.js";
import type { RandomFn } from "../session/machine.js";

// ─── Read Delay Constants ───────────────────────────────────────────────────

/**
 * Base delay before marking a message as read (ms).
 * Represents the "noticed the notification" latency — independent of content.
 */
export const READ_NOTICE_DELAY = { min: 500, max: 3_000 };

/**
 * Per-word reading time (ms).
 * Average adult reads 200-300 WPM; this gives ~200-400ms per word at
 * the profile midpoint, scaled by readingSpeed.
 */
export const READ_PER_WORD_MS = { min: 200, max: 400 };

/**
 * Absolute bounds on read delay (ms).
 * Prevents unrealistically fast or absurdly slow read receipts.
 */
export const READ_DELAY_BOUNDS = { min: 500, max: 30_000 };

// ─── Think Delay Constants ──────────────────────────────────────────────────

/**
 * Base think delay — time between finishing reading and starting to type (ms).
 * Models the human "pause to consider" before composing a reply.
 */
export const THINK_DELAY_BASE = { min: 300, max: 2_000 };

/** Absolute bounds on think delay (ms). */
export const THINK_DELAY_BOUNDS = { min: 200, max: 15_000 };

// ─── Typing Duration Constants ──────────────────────────────────────────────

/**
 * WPM range for simulated typing indicator duration.
 * These are lower than actual typing speeds because the typing indicator
 * should represent "composing + typing + editing" not just raw keystroke speed.
 *
 * Mapped from profile's activityLevel:
 *   0 (low energy) → slow end (25 WPM)
 *   1 (hyper-active) → fast end (90 WPM)
 */
export const TYPING_WPM_RANGE = { min: 25, max: 90 };

/** Absolute bounds on typing indicator duration (ms). */
export const TYPING_DURATION_BOUNDS = { min: 500, max: 120_000 };

// ─── Time-of-Day Multipliers ────────────────────────────────────────────────

/**
 * Time-of-day multipliers for response timing.
 * Applied uniformly to read, think, and typing delays.
 *
 * PEAK hours: faster responses (people are attentive)
 * DORMANT hours: much slower (people are sleepy/distracted)
 */
export const TIME_PERIOD_MULTIPLIERS: Record<TimePeriod, number> = {
  [TimePeriod.PEAK]: 0.8,
  [TimePeriod.NORMAL]: 1.0,
  [TimePeriod.LOW]: 1.5,
  [TimePeriod.DORMANT]: 3.0,
};

// ─── Sampling Utilities ─────────────────────────────────────────────────────

/** Sample uniformly from [min, max]. */
export function sampleRange(
  range: { min: number; max: number },
  random: RandomFn,
): number {
  return range.min + random() * (range.max - range.min);
}

/** Clamp a value to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Count words in a string (splitting on whitespace). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Get the time-of-day multiplier for the current hour.
 */
export function getTimeMultiplier(hour: number): number {
  return TIME_PERIOD_MULTIPLIERS[getTimePeriod(hour)];
}

/**
 * Apply variance to a delay value.
 * Adds ±varianceFraction jitter (e.g. 0.2 = ±20%).
 */
export function applyVariance(
  value: number,
  varianceFraction: number,
  random: RandomFn,
): number {
  const jitter = 1 + (random() * 2 - 1) * varianceFraction;
  return value * jitter;
}

/**
 * Compute read delay for a given message text.
 *
 * Model:
 *   readDelay = (noticeDelay + wordCount * perWordTime) * readingSpeedScale * timeMultiplier * variance
 *
 * Profile influence (readingSpeed):
 *   0 (slow) → 1.5x duration (takes longer to read)
 *   0.5 (average) → 1.0x
 *   1 (speed reader) → 0.5x (reads fast, marks read quickly)
 */
export function computeReadDelay(
  messageText: string,
  profile: SessionProfile,
  hour: number,
  random: RandomFn,
): number {
  const wordCount = countWords(messageText);

  const noticeDelay = sampleRange(READ_NOTICE_DELAY, random);
  const perWordTime = sampleRange(READ_PER_WORD_MS, random);
  const readingTime = wordCount * perWordTime;

  // readingSpeed: 0→1.5x (slow), 0.5→1.0x, 1→0.5x (fast)
  const readingSpeedScale = 1.5 - profile.readingSpeed;

  const timeMultiplier = getTimeMultiplier(hour);

  const raw = (noticeDelay + readingTime) * readingSpeedScale * timeMultiplier;
  const withVariance = applyVariance(raw, 0.2, random);

  return Math.round(clamp(withVariance, READ_DELAY_BOUNDS.min, READ_DELAY_BOUNDS.max));
}

/**
 * Compute think delay — pause between finishing reading and starting to type.
 *
 * Profile influence (deliberation):
 *   0 (impulsive) → 0.5x (starts typing immediately)
 *   0.5 (average) → 1.0x
 *   1 (deliberate) → 2.0x (thinks carefully before typing)
 */
export function computeThinkDelay(
  profile: SessionProfile,
  hour: number,
  random: RandomFn,
): number {
  const base = sampleRange(THINK_DELAY_BASE, random);

  // deliberation: 0→0.5x, 0.5→1.0x, 1→2.0x
  const deliberationScale = 0.5 + profile.deliberation * 1.5;

  const timeMultiplier = getTimeMultiplier(hour);

  const raw = base * deliberationScale * timeMultiplier;
  const withVariance = applyVariance(raw, 0.25, random);

  return Math.round(clamp(withVariance, THINK_DELAY_BOUNDS.min, THINK_DELAY_BOUNDS.max));
}

/**
 * Compute typing indicator duration for a response of given text.
 *
 * Model:
 *   WPM derived from profile's activityLevel
 *   duration = (wordCount / wpm) * 60_000 * timeMultiplier * variance
 *
 * Profile influence (activityLevel):
 *   0 (low energy) → slow typing (25 WPM)
 *   0.5 (average) → ~57 WPM
 *   1 (hyper-active) → fast typing (90 WPM)
 */
export function computeTypingDuration(
  responseText: string,
  profile: SessionProfile,
  hour: number,
  random: RandomFn,
): number {
  const wordCount = countWords(responseText);
  if (wordCount === 0) return TYPING_DURATION_BOUNDS.min;

  // Map activityLevel to WPM
  const wpm = TYPING_WPM_RANGE.min +
    profile.activityLevel * (TYPING_WPM_RANGE.max - TYPING_WPM_RANGE.min);

  // Convert words to duration
  const baseDuration = (wordCount / wpm) * 60_000;

  const timeMultiplier = getTimeMultiplier(hour);

  const raw = baseDuration * timeMultiplier;
  const withVariance = applyVariance(raw, 0.2, random);

  return Math.round(clamp(withVariance, TYPING_DURATION_BOUNDS.min, TYPING_DURATION_BOUNDS.max));
}
