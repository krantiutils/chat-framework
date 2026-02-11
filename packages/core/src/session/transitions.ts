import { SessionState, ALL_STATES } from "./state.js";
import { SessionProfile } from "./profile.js";

/**
 * A row in the transition matrix: probability of moving to each target state.
 * Values must sum to 1.0 (within floating-point tolerance).
 */
export type TransitionRow = Record<SessionState, number>;

/**
 * Full transition matrix: for each source state, the probability distribution
 * over target states.
 */
export type TransitionMatrix = Record<SessionState, TransitionRow>;

/**
 * Time-of-day period affecting transition probabilities.
 *
 * - PEAK: 9am–12pm, 2pm–6pm — high activity
 * - NORMAL: 12pm–2pm, 6pm–9pm — moderate activity
 * - LOW: 9pm–1am — winding down
 * - DORMANT: 1am–9am — minimal activity, high AFK
 */
export enum TimePeriod {
  PEAK = "PEAK",
  NORMAL = "NORMAL",
  LOW = "LOW",
  DORMANT = "DORMANT",
}

/**
 * Activity type context influencing transition behavior.
 * The action orchestrator (cf-1ek) will feed this in.
 */
export enum ActivityType {
  /** Typing a message or filling a form. */
  TYPING = "TYPING",
  /** Browsing / navigating pages. */
  BROWSING = "BROWSING",
  /** Waiting for a response or page load. */
  WAITING = "WAITING",
}

/**
 * Determine the current time period from an hour (0–23).
 */
export function getTimePeriod(hour: number): TimePeriod {
  if (hour >= 9 && hour < 12) return TimePeriod.PEAK;
  if (hour >= 14 && hour < 18) return TimePeriod.PEAK;
  if (hour >= 12 && hour < 14) return TimePeriod.NORMAL;
  if (hour >= 18 && hour < 21) return TimePeriod.NORMAL;
  if (hour >= 21 || hour < 1) return TimePeriod.LOW;
  return TimePeriod.DORMANT; // 1am–9am
}

/**
 * Base transition probabilities. These represent the "average" user during
 * NORMAL time period. Profile and time-of-day modifiers are applied on top.
 *
 * Design rationale from the PRD state diagram:
 * - START → IDLE (handled externally; machine always starts in IDLE)
 * - IDLE → ACTIVE (primary), AWAY, SCROLLING
 * - ACTIVE → READING (primary), IDLE, AWAY, SCROLLING
 * - READING → THINKING (primary), ACTIVE, IDLE
 * - THINKING → ACTIVE (primary), READING, IDLE
 * - AWAY → IDLE (always returns to IDLE)
 * - SCROLLING → IDLE (primary), ACTIVE, READING
 */
const BASE_MATRIX: TransitionMatrix = {
  [SessionState.IDLE]: {
    [SessionState.IDLE]: 0.0,
    [SessionState.ACTIVE]: 0.60,
    [SessionState.READING]: 0.0,
    [SessionState.THINKING]: 0.0,
    [SessionState.AWAY]: 0.15,
    [SessionState.SCROLLING]: 0.25,
  },
  [SessionState.ACTIVE]: {
    [SessionState.IDLE]: 0.15,
    [SessionState.ACTIVE]: 0.0,
    [SessionState.READING]: 0.50,
    [SessionState.THINKING]: 0.0,
    [SessionState.AWAY]: 0.10,
    [SessionState.SCROLLING]: 0.25,
  },
  [SessionState.READING]: {
    [SessionState.IDLE]: 0.10,
    [SessionState.ACTIVE]: 0.25,
    [SessionState.READING]: 0.0,
    [SessionState.THINKING]: 0.55,
    [SessionState.AWAY]: 0.05,
    [SessionState.SCROLLING]: 0.05,
  },
  [SessionState.THINKING]: {
    [SessionState.IDLE]: 0.10,
    [SessionState.ACTIVE]: 0.60,
    [SessionState.READING]: 0.25,
    [SessionState.THINKING]: 0.0,
    [SessionState.AWAY]: 0.0,
    [SessionState.SCROLLING]: 0.05,
  },
  [SessionState.AWAY]: {
    [SessionState.IDLE]: 1.0,
    [SessionState.ACTIVE]: 0.0,
    [SessionState.READING]: 0.0,
    [SessionState.THINKING]: 0.0,
    [SessionState.AWAY]: 0.0,
    [SessionState.SCROLLING]: 0.0,
  },
  [SessionState.SCROLLING]: {
    [SessionState.IDLE]: 0.35,
    [SessionState.ACTIVE]: 0.30,
    [SessionState.READING]: 0.30,
    [SessionState.THINKING]: 0.0,
    [SessionState.AWAY]: 0.05,
    [SessionState.SCROLLING]: 0.0,
  },
};

/**
 * Time-of-day multipliers applied to specific transitions.
 * Values > 1 increase probability, < 1 decrease.
 * After applying, the row is re-normalized to sum to 1.
 */
const TIME_MODIFIERS: Record<TimePeriod, Partial<Record<SessionState, Partial<Record<SessionState, number>>>>> = {
  [TimePeriod.PEAK]: {
    // During peak hours: more ACTIVE, less AWAY
    [SessionState.IDLE]: { [SessionState.ACTIVE]: 1.3, [SessionState.AWAY]: 0.4 },
    [SessionState.ACTIVE]: { [SessionState.AWAY]: 0.3 },
  },
  [TimePeriod.NORMAL]: {
    // No modifiers — base probabilities apply
  },
  [TimePeriod.LOW]: {
    // Winding down: more IDLE/AWAY, less ACTIVE
    [SessionState.IDLE]: { [SessionState.ACTIVE]: 0.7, [SessionState.AWAY]: 1.8 },
    [SessionState.ACTIVE]: { [SessionState.IDLE]: 1.5, [SessionState.AWAY]: 1.5 },
    [SessionState.READING]: { [SessionState.THINKING]: 0.7, [SessionState.IDLE]: 1.5 },
  },
  [TimePeriod.DORMANT]: {
    // Late night: very high AWAY probability, sluggish transitions
    [SessionState.IDLE]: { [SessionState.ACTIVE]: 0.3, [SessionState.AWAY]: 3.0 },
    [SessionState.ACTIVE]: { [SessionState.IDLE]: 2.0, [SessionState.AWAY]: 3.0 },
    [SessionState.READING]: { [SessionState.IDLE]: 2.0, [SessionState.AWAY]: 2.0 },
    [SessionState.SCROLLING]: { [SessionState.AWAY]: 3.0, [SessionState.IDLE]: 1.5 },
  },
};

/**
 * Apply profile biases to a transition row. Profile values shift probability
 * mass between certain transitions.
 */
function applyProfileBias(
  row: TransitionRow,
  fromState: SessionState,
  profile: SessionProfile,
): TransitionRow {
  const result = { ...row };

  // afkProneness: scales AWAY probability everywhere
  if (result[SessionState.AWAY] > 0) {
    // Map 0–1 to 0.3x–2.5x multiplier
    result[SessionState.AWAY] *= 0.3 + profile.afkProneness * 2.2;
  }

  // scrollTendency: scales SCROLLING probability
  if (result[SessionState.SCROLLING] > 0) {
    result[SessionState.SCROLLING] *= 0.4 + profile.scrollTendency * 1.6;
  }

  // deliberation: from READING, increase THINKING; from THINKING, decrease ACTIVE
  if (fromState === SessionState.READING && result[SessionState.THINKING] > 0) {
    result[SessionState.THINKING] *= 0.6 + profile.deliberation * 0.8;
  }
  if (fromState === SessionState.THINKING && result[SessionState.ACTIVE] > 0) {
    // More deliberate = slightly less rush to ACTIVE
    result[SessionState.ACTIVE] *= 1.2 - profile.deliberation * 0.4;
  }

  // activityLevel: from IDLE, scale ACTIVE probability
  if (fromState === SessionState.IDLE && result[SessionState.ACTIVE] > 0) {
    result[SessionState.ACTIVE] *= 0.5 + profile.activityLevel * 1.0;
  }

  return result;
}

/**
 * Normalize a transition row so probabilities sum to 1.0.
 * If all values are zero (shouldn't happen), returns uniform over non-self states.
 */
export function normalizeRow(row: TransitionRow, selfState: SessionState): TransitionRow {
  const sum = ALL_STATES.reduce((s, st) => s + row[st], 0);
  if (sum <= 0) {
    // Fallback: uniform over non-self states
    const others = ALL_STATES.filter((s) => s !== selfState);
    const uniform = 1.0 / others.length;
    const result = { ...row };
    for (const st of ALL_STATES) {
      result[st] = st === selfState ? 0 : uniform;
    }
    return result;
  }
  const result = { ...row };
  for (const st of ALL_STATES) {
    result[st] = row[st] / sum;
  }
  return result;
}

/**
 * Activity type multipliers. When TYPING, the user is more likely to stay
 * in ACTIVE/READING/THINKING loops and less likely to go IDLE/AWAY.
 * When WAITING, the user is more likely to scroll or go idle.
 * BROWSING is the neutral baseline.
 */
const ACTIVITY_MODIFIERS: Record<ActivityType, Partial<Record<SessionState, Partial<Record<SessionState, number>>>>> = {
  [ActivityType.BROWSING]: {
    // Neutral — no modifiers
  },
  [ActivityType.TYPING]: {
    // While typing: stay in the active→reading→thinking loop
    [SessionState.ACTIVE]: {
      [SessionState.READING]: 1.3,
      [SessionState.IDLE]: 0.5,
      [SessionState.AWAY]: 0.3,
    },
    [SessionState.READING]: {
      [SessionState.THINKING]: 1.2,
      [SessionState.IDLE]: 0.5,
    },
    [SessionState.THINKING]: {
      [SessionState.ACTIVE]: 1.3,
      [SessionState.IDLE]: 0.4,
    },
  },
  [ActivityType.WAITING]: {
    // While waiting: more likely to scroll, go idle, or go AFK
    [SessionState.ACTIVE]: {
      [SessionState.IDLE]: 1.5,
      [SessionState.SCROLLING]: 1.5,
      [SessionState.READING]: 0.7,
    },
    [SessionState.IDLE]: {
      [SessionState.SCROLLING]: 1.4,
      [SessionState.AWAY]: 1.5,
      [SessionState.ACTIVE]: 0.6,
    },
  },
};

/**
 * Build a complete transition matrix for a given time period, user profile,
 * and current activity type.
 *
 * Steps:
 * 1. Start from BASE_MATRIX
 * 2. Apply time-of-day modifiers
 * 3. Apply activity type modifiers
 * 4. Apply profile biases
 * 5. Re-normalize each row
 */
export function buildTransitionMatrix(
  timePeriod: TimePeriod,
  profile: SessionProfile,
  activityType: ActivityType = ActivityType.BROWSING,
): TransitionMatrix {
  const matrix = {} as TransitionMatrix;

  for (const fromState of ALL_STATES) {
    let row: TransitionRow = { ...BASE_MATRIX[fromState] };

    // Apply time-of-day modifiers
    const timeModsForState = TIME_MODIFIERS[timePeriod][fromState];
    if (timeModsForState) {
      for (const [targetStr, multiplier] of Object.entries(timeModsForState)) {
        const target = targetStr as SessionState;
        if (row[target] !== undefined && multiplier !== undefined) {
          row[target] *= multiplier;
        }
      }
    }

    // Apply activity type modifiers
    const activityModsForState = ACTIVITY_MODIFIERS[activityType][fromState];
    if (activityModsForState) {
      for (const [targetStr, multiplier] of Object.entries(activityModsForState)) {
        const target = targetStr as SessionState;
        if (row[target] !== undefined && multiplier !== undefined) {
          row[target] *= multiplier;
        }
      }
    }

    // Apply profile biases
    row = applyProfileBias(row, fromState, profile);

    // Normalize
    matrix[fromState] = normalizeRow(row, fromState);
  }

  return matrix;
}

/**
 * Sample a next state from a transition row using a uniform random value in [0, 1).
 */
export function sampleTransition(row: TransitionRow, random: number): SessionState {
  let cumulative = 0;
  for (const state of ALL_STATES) {
    cumulative += row[state];
    if (random < cumulative) {
      return state;
    }
  }
  // Floating-point edge case: return last non-zero state
  for (let i = ALL_STATES.length - 1; i >= 0; i--) {
    if (row[ALL_STATES[i]] > 0) {
      return ALL_STATES[i];
    }
  }
  return SessionState.IDLE; // absolute fallback
}
