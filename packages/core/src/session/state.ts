/**
 * Session states for the human simulation engine.
 *
 * Each state represents a distinct behavioral mode with associated duration
 * ranges (in milliseconds). Transitions between states are probabilistic
 * and influenced by time-of-day and activity type.
 */
export enum SessionState {
  IDLE = "IDLE",
  ACTIVE = "ACTIVE",
  READING = "READING",
  THINKING = "THINKING",
  AWAY = "AWAY",
  SCROLLING = "SCROLLING",
}

/** Duration range in milliseconds [min, max]. */
export interface DurationRange {
  readonly min: number;
  readonly max: number;
}

/**
 * Base duration ranges per state from the PRD spec.
 *
 * - IDLE: 2–30 seconds
 * - ACTIVE: 5–120 seconds (doing tasks — variable)
 * - READING: 3–15 seconds
 * - THINKING: 1–5 seconds
 * - AWAY: 5–30 minutes
 * - SCROLLING: 2–20 seconds (random)
 */
export const BASE_DURATION_RANGES: Record<SessionState, DurationRange> = {
  [SessionState.IDLE]: { min: 2_000, max: 30_000 },
  [SessionState.ACTIVE]: { min: 5_000, max: 120_000 },
  [SessionState.READING]: { min: 3_000, max: 15_000 },
  [SessionState.THINKING]: { min: 1_000, max: 5_000 },
  [SessionState.AWAY]: { min: 300_000, max: 1_800_000 },
  [SessionState.SCROLLING]: { min: 2_000, max: 20_000 },
};

/** All valid session states as an array, useful for iteration. */
export const ALL_STATES: readonly SessionState[] = Object.values(SessionState);
