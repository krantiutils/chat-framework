/**
 * Session State Machine for the Human Simulation Engine.
 *
 * Models realistic user session behavior with six states:
 * IDLE, ACTIVE, READING, THINKING, AWAY, SCROLLING.
 *
 * Transitions are probabilistic, time-of-day aware, and activity-based.
 * Each simulated user profile can override default transition weights
 * and duration ranges.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All possible session states. */
export type SessionState =
  | "IDLE"
  | "ACTIVE"
  | "READING"
  | "THINKING"
  | "AWAY"
  | "SCROLLING";

/** Inclusive min/max range in milliseconds. */
export interface DurationRange {
  minMs: number;
  maxMs: number;
}

/** A single weighted edge in the transition graph. */
export interface TransitionEdge {
  target: SessionState;
  /** Relative weight (not a probability). Normalised at transition time. */
  weight: number;
}

/** Maps each state to its outgoing edges. */
export type TransitionTable = Record<SessionState, TransitionEdge[]>;

/** Maps each state to how long it lasts before the next transition fires. */
export type DurationTable = Record<SessionState, DurationRange>;

/**
 * Time-of-day period bucket.
 *
 * MORNING  : 06:00–11:59
 * AFTERNOON: 12:00–17:59
 * EVENING  : 18:00–22:59
 * NIGHT    : 23:00–05:59
 */
export type TimeOfDay = "MORNING" | "AFTERNOON" | "EVENING" | "NIGHT";

/**
 * Per-period multiplier applied to transition weights.
 *
 * A multiplier of 0 suppresses that edge entirely.
 * Unspecified edges default to 1.0 (no change).
 */
export type TimeOfDayModifiers = Record<
  TimeOfDay,
  Partial<Record<SessionState, number>>
>;

/** User-level overrides for tuning the state machine per profile. */
export interface SessionProfile {
  /** Override default duration ranges. Partial — unset states use defaults. */
  durations?: Partial<DurationTable>;
  /** Override default transition edges for specific states. */
  transitions?: Partial<TransitionTable>;
  /** Override time-of-day modifiers. */
  timeModifiers?: Partial<TimeOfDayModifiers>;
}

/** Snapshot emitted on every state change. */
export interface StateTransition {
  from: SessionState;
  to: SessionState;
  /** Duration the machine stayed in `from` (ms). */
  dwellMs: number;
  /** Wall-clock time of the transition. */
  timestamp: Date;
}

/** Listener signature for state-change events. */
export type TransitionListener = (transition: StateTransition) => void;

/** Injectable RNG — returns a float in [0, 1). */
export type RandomFn = () => number;

/** Injectable clock — returns "now" as a Date. */
export type ClockFn = () => Date;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default duration ranges straight from the PRD. */
export const DEFAULT_DURATIONS: DurationTable = {
  IDLE: { minMs: 2_000, maxMs: 30_000 },
  ACTIVE: { minMs: 5_000, maxMs: 60_000 },
  READING: { minMs: 3_000, maxMs: 15_000 },
  THINKING: { minMs: 1_000, maxMs: 5_000 },
  AWAY: { minMs: 300_000, maxMs: 1_800_000 }, // 5–30 min
  SCROLLING: { minMs: 2_000, maxMs: 20_000 },
};

/**
 * Default transition graph.
 *
 * Weights encode realistic session flow:
 *  - IDLE commonly transitions to ACTIVE or AWAY.
 *  - ACTIVE leads to READING, SCROLLING, THINKING, IDLE, or AWAY.
 *  - READING leads to THINKING, ACTIVE, SCROLLING, or IDLE.
 *  - THINKING leads to ACTIVE (most likely), READING, or IDLE.
 *  - AWAY returns to IDLE.
 *  - SCROLLING leads to READING, ACTIVE, or IDLE.
 */
export const DEFAULT_TRANSITIONS: TransitionTable = {
  IDLE: [
    { target: "ACTIVE", weight: 60 },
    { target: "AWAY", weight: 25 },
    { target: "SCROLLING", weight: 15 },
  ],
  ACTIVE: [
    { target: "READING", weight: 25 },
    { target: "SCROLLING", weight: 20 },
    { target: "THINKING", weight: 20 },
    { target: "IDLE", weight: 25 },
    { target: "AWAY", weight: 10 },
  ],
  READING: [
    { target: "THINKING", weight: 35 },
    { target: "ACTIVE", weight: 30 },
    { target: "SCROLLING", weight: 20 },
    { target: "IDLE", weight: 15 },
  ],
  THINKING: [
    { target: "ACTIVE", weight: 55 },
    { target: "READING", weight: 25 },
    { target: "IDLE", weight: 20 },
  ],
  AWAY: [
    { target: "IDLE", weight: 80 },
    { target: "ACTIVE", weight: 20 },
  ],
  SCROLLING: [
    { target: "READING", weight: 35 },
    { target: "ACTIVE", weight: 35 },
    { target: "IDLE", weight: 20 },
    { target: "AWAY", weight: 10 },
  ],
};

/**
 * Default time-of-day modifiers.
 *
 * At NIGHT the user is much more likely to go AWAY and less likely
 * to be ACTIVE. In the MORNING activity ramps up, etc.
 */
export const DEFAULT_TIME_MODIFIERS: TimeOfDayModifiers = {
  MORNING: {
    ACTIVE: 1.2,
    AWAY: 0.6,
    READING: 1.1,
  },
  AFTERNOON: {
    ACTIVE: 1.0,
    AWAY: 0.8,
  },
  EVENING: {
    ACTIVE: 0.9,
    AWAY: 1.2,
    SCROLLING: 1.3,
  },
  NIGHT: {
    ACTIVE: 0.4,
    AWAY: 2.5,
    IDLE: 1.4,
    READING: 0.6,
    SCROLLING: 0.5,
    THINKING: 0.5,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_STATES: readonly SessionState[] = [
  "IDLE",
  "ACTIVE",
  "READING",
  "THINKING",
  "AWAY",
  "SCROLLING",
] as const;

/** Derive the time-of-day bucket from a Date. */
export function getTimeOfDay(date: Date): TimeOfDay {
  const h = date.getHours();
  if (h >= 6 && h < 12) return "MORNING";
  if (h >= 12 && h < 18) return "AFTERNOON";
  if (h >= 18 && h < 23) return "EVENING";
  return "NIGHT";
}

/**
 * Pick a random integer in [min, max] using the supplied RNG.
 * Clamps min to 0.
 */
function randIntInclusive(min: number, max: number, rng: RandomFn): number {
  const lo = Math.max(0, Math.floor(min));
  const hi = Math.max(lo, Math.floor(max));
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/**
 * Weighted random selection from a set of edges.
 *
 * Throws if edges is empty or all weights are zero (should never happen
 * with a well-formed transition table).
 */
function weightedPick(
  edges: TransitionEdge[],
  rng: RandomFn,
): SessionState {
  if (edges.length === 0) {
    throw new Error("weightedPick called with empty edge list");
  }

  const total = edges.reduce((sum, e) => sum + e.weight, 0);
  if (total <= 0) {
    throw new Error("weightedPick: total weight is zero");
  }

  let roll = rng() * total;
  for (const edge of edges) {
    roll -= edge.weight;
    if (roll <= 0) return edge.target;
  }

  // Floating-point rounding — return last edge.
  return edges[edges.length - 1]!.target;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateDurationRange(range: DurationRange, label: string): void {
  if (range.minMs < 0) {
    throw new Error(`${label}: minMs must be >= 0, got ${range.minMs}`);
  }
  if (range.maxMs < range.minMs) {
    throw new Error(
      `${label}: maxMs (${range.maxMs}) must be >= minMs (${range.minMs})`,
    );
  }
}

function validateTransitionEdges(
  edges: TransitionEdge[],
  from: string,
): void {
  if (edges.length === 0) {
    throw new Error(`State "${from}" has no outgoing transitions`);
  }
  for (const edge of edges) {
    if (edge.weight < 0) {
      throw new Error(
        `State "${from}" -> "${edge.target}": weight must be >= 0, got ${edge.weight}`,
      );
    }
    if (!ALL_STATES.includes(edge.target)) {
      throw new Error(
        `State "${from}" -> "${edge.target}": unknown target state`,
      );
    }
  }
  const totalWeight = edges.reduce((s, e) => s + e.weight, 0);
  if (totalWeight <= 0) {
    throw new Error(
      `State "${from}": total transition weight must be > 0`,
    );
  }
}

// ---------------------------------------------------------------------------
// Session State Machine
// ---------------------------------------------------------------------------

export interface SessionStateMachineOptions {
  /** Initial state. Defaults to IDLE. */
  initialState?: SessionState;
  /** User-level profile overrides. */
  profile?: SessionProfile;
  /** Injectable RNG for deterministic testing. Defaults to Math.random. */
  random?: RandomFn;
  /** Injectable clock for deterministic testing. Defaults to () => new Date(). */
  clock?: ClockFn;
}

export class SessionStateMachine {
  private _state: SessionState;
  private _stateEnteredAt: number; // epoch ms
  private readonly _durations: DurationTable;
  private readonly _transitions: TransitionTable;
  private readonly _timeModifiers: TimeOfDayModifiers;
  private readonly _rng: RandomFn;
  private readonly _clock: ClockFn;
  private readonly _listeners: Set<TransitionListener> = new Set();
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _running = false;
  private _scheduledDwellMs: number | null = null;

  constructor(options: SessionStateMachineOptions = {}) {
    const profile = options.profile ?? {};

    // Merge durations
    this._durations = { ...DEFAULT_DURATIONS };
    if (profile.durations) {
      for (const state of ALL_STATES) {
        if (profile.durations[state]) {
          this._durations[state] = { ...profile.durations[state]! };
        }
      }
    }

    // Merge transitions
    this._transitions = { ...DEFAULT_TRANSITIONS };
    if (profile.transitions) {
      for (const state of ALL_STATES) {
        if (profile.transitions[state]) {
          this._transitions[state] = [...profile.transitions[state]!];
        }
      }
    }

    // Merge time-of-day modifiers
    this._timeModifiers = {
      MORNING: { ...DEFAULT_TIME_MODIFIERS.MORNING },
      AFTERNOON: { ...DEFAULT_TIME_MODIFIERS.AFTERNOON },
      EVENING: { ...DEFAULT_TIME_MODIFIERS.EVENING },
      NIGHT: { ...DEFAULT_TIME_MODIFIERS.NIGHT },
    };
    if (profile.timeModifiers) {
      for (const period of [
        "MORNING",
        "AFTERNOON",
        "EVENING",
        "NIGHT",
      ] as const) {
        if (profile.timeModifiers[period]) {
          this._timeModifiers[period] = {
            ...this._timeModifiers[period],
            ...profile.timeModifiers[period],
          };
        }
      }
    }

    // Validate merged tables
    for (const state of ALL_STATES) {
      validateDurationRange(this._durations[state], `duration[${state}]`);
      validateTransitionEdges(this._transitions[state], state);
    }

    this._rng = options.random ?? Math.random;
    this._clock = options.clock ?? (() => new Date());
    this._state = options.initialState ?? "IDLE";
    this._stateEnteredAt = this._clock().getTime();
  }

  // -----------------------------------------------------------------------
  // Public API — queries
  // -----------------------------------------------------------------------

  /** Current state. */
  get state(): SessionState {
    return this._state;
  }

  /** Whether the auto-transition timer loop is running. */
  get running(): boolean {
    return this._running;
  }

  /** How long (ms) the machine has been in the current state. */
  get dwellMs(): number {
    return this._clock().getTime() - this._stateEnteredAt;
  }

  // -----------------------------------------------------------------------
  // Public API — event handling
  // -----------------------------------------------------------------------

  /** Register a listener for state transitions. Returns an unsubscribe fn. */
  onTransition(listener: TransitionListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  // -----------------------------------------------------------------------
  // Public API — manual / programmatic transition
  // -----------------------------------------------------------------------

  /**
   * Force a transition to `target`, bypassing probabilities.
   *
   * Useful when external events demand a specific state (e.g. the user
   * starts typing → force ACTIVE).
   *
   * Emits a transition event. If the timer loop is running, the dwell
   * timer is reset for the new state.
   */
  forceTransition(target: SessionState): StateTransition {
    return this._transitionTo(target);
  }

  // -----------------------------------------------------------------------
  // Public API — automatic transition loop
  // -----------------------------------------------------------------------

  /**
   * Start the auto-transition timer loop.
   *
   * On each tick the machine picks a next state probabilistically and
   * schedules a new tick for the duration of the new state.
   *
   * Calling start() when already running is a no-op.
   */
  start(): void {
    if (this._running) return;
    this._running = true;
    this._scheduleTick();
  }

  /**
   * Stop the auto-transition loop.
   *
   * The machine stays in its current state. Calling stop() when already
   * stopped is a no-op.
   */
  stop(): void {
    if (!this._running) return;
    this._running = false;
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._scheduledDwellMs = null;
  }

  /**
   * Advance the state machine by one step without using real timers.
   *
   * Returns the transition that occurred. Throws if the machine is
   * currently running with real timers — use stop() first.
   */
  tick(): StateTransition {
    if (this._running) {
      throw new Error(
        "Cannot manually tick() while the auto-transition loop is running. Call stop() first.",
      );
    }
    return this._performTransition();
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private _scheduleTick(): void {
    const dwell = this._randomDwell(this._state);
    this._scheduledDwellMs = dwell;
    this._timer = setTimeout(() => {
      this._timer = null;
      this._scheduledDwellMs = null;
      this._performTransition();
      if (this._running) {
        this._scheduleTick();
      }
    }, dwell);
  }

  private _performTransition(): StateTransition {
    const next = this._pickNext();
    return this._transitionTo(next);
  }

  private _transitionTo(target: SessionState): StateTransition {
    const now = this._clock();
    const from = this._state;
    const dwellMs = now.getTime() - this._stateEnteredAt;

    this._state = target;
    this._stateEnteredAt = now.getTime();

    // Reset timer if running
    if (this._running && this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
      this._scheduledDwellMs = null;
      this._scheduleTick();
    }

    const transition: StateTransition = {
      from,
      to: target,
      dwellMs,
      timestamp: now,
    };

    for (const listener of this._listeners) {
      listener(transition);
    }

    return transition;
  }

  /**
   * Pick the next state using the transition table + time-of-day modifiers.
   */
  private _pickNext(): SessionState {
    const edges = this._transitions[this._state];
    const tod = getTimeOfDay(this._clock());
    const modifiers = this._timeModifiers[tod];

    // Apply time-of-day multipliers to the edge weights.
    const adjusted: TransitionEdge[] = edges.map((e) => ({
      target: e.target,
      weight: e.weight * (modifiers[e.target] ?? 1),
    }));

    // Filter out edges with zero or negative weight.
    const viable = adjusted.filter((e) => e.weight > 0);
    if (viable.length === 0) {
      // Fallback: ignore modifiers to avoid dead-end.
      return weightedPick(edges, this._rng);
    }

    return weightedPick(viable, this._rng);
  }

  /** Generate a random dwell duration for the given state. */
  private _randomDwell(state: SessionState): number {
    const range = this._durations[state];
    return randIntInclusive(range.minMs, range.maxMs, this._rng);
  }
}
