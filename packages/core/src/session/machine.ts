import { SessionState, DurationRange, BASE_DURATION_RANGES } from "./state.js";
import { SessionProfile, DEFAULT_SESSION_PROFILE, validateProfile } from "./profile.js";
import {
  TransitionMatrix,
  TimePeriod,
  ActivityType,
  getTimePeriod,
  buildTransitionMatrix,
  sampleTransition,
} from "./transitions.js";

/**
 * Snapshot of the state machine at a point in time.
 * Emitted on every transition for external consumers (action orchestrator, logging).
 */
export interface StateSnapshot {
  readonly state: SessionState;
  readonly enteredAt: number;
  readonly scheduledDuration: number;
  readonly timePeriod: TimePeriod;
  readonly transitionCount: number;
}

/**
 * Event emitted when the state machine transitions.
 */
export interface TransitionEvent {
  readonly from: SessionState;
  readonly to: SessionState;
  readonly timestamp: number;
  readonly dwellTime: number;
  readonly timePeriod: TimePeriod;
  readonly activityType: ActivityType;
}

/** Listener callback for state transitions. */
export type TransitionListener = (event: TransitionEvent) => void;

/** RNG function signature — returns a value in [0, 1). */
export type RandomFn = () => number;

/** Clock function signature — returns current time in ms. */
export type ClockFn = () => number;

/**
 * Configuration for the SessionStateMachine.
 */
export interface SessionStateMachineConfig {
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

  /** Custom duration ranges per state. Merged with BASE_DURATION_RANGES. */
  readonly durationOverrides?: Partial<Record<SessionState, Partial<DurationRange>>>;
}

/**
 * Session state machine implementing probabilistic transitions between
 * behavioral states (IDLE, ACTIVE, READING, THINKING, AWAY, SCROLLING).
 *
 * The machine does NOT use timers internally — it's a pull-based model.
 * External code calls `tick()` or `advance()` to drive transitions.
 * This makes it testable, deterministic when seeded, and compatible
 * with both real-time and simulated time.
 *
 * Usage:
 * ```ts
 * const machine = new SessionStateMachine({ profile: myProfile });
 * machine.onTransition((event) => {
 *   console.log(`${event.from} → ${event.to} after ${event.dwellTime}ms`);
 * });
 *
 * // In your main loop or timer callback:
 * const snapshot = machine.tick();
 * if (snapshot.state === SessionState.ACTIVE) {
 *   // Perform actions
 * }
 * ```
 */
export class SessionStateMachine {
  private _state: SessionState;
  private _enteredAt: number;
  private _scheduledDuration: number;
  private _transitionCount: number;
  private _activityType: ActivityType;
  private _currentMatrix: TransitionMatrix;
  private _currentTimePeriod: TimePeriod;

  private readonly _profile: SessionProfile;
  private readonly _random: RandomFn;
  private readonly _clock: ClockFn;
  private readonly _getHour: (timestamp: number) => number;
  private readonly _durations: Record<SessionState, DurationRange>;
  private readonly _listeners: TransitionListener[];

  constructor(config: SessionStateMachineConfig = {}) {
    this._profile = config.profile
      ? validateProfile(config.profile)
      : DEFAULT_SESSION_PROFILE;
    this._random = config.random ?? Math.random;
    this._clock = config.clock ?? Date.now;
    this._getHour = config.getHour ?? ((ts: number) => new Date(ts).getHours());
    this._listeners = [];
    this._activityType = ActivityType.BROWSING;
    this._transitionCount = 0;

    // Merge duration overrides
    this._durations = { ...BASE_DURATION_RANGES };
    if (config.durationOverrides) {
      for (const [stateStr, override] of Object.entries(config.durationOverrides)) {
        const state = stateStr as SessionState;
        if (this._durations[state] && override) {
          this._durations[state] = {
            min: override.min ?? this._durations[state].min,
            max: override.max ?? this._durations[state].max,
          };
        }
      }
    }

    // Initialize in IDLE (per PRD: START → IDLE)
    const now = this._clock();
    this._state = SessionState.IDLE;
    this._enteredAt = now;
    this._currentTimePeriod = getTimePeriod(this._getHour(now));
    this._currentMatrix = buildTransitionMatrix(
      this._currentTimePeriod,
      this._profile,
      this._activityType,
    );
    this._scheduledDuration = this._sampleDuration(SessionState.IDLE);
  }

  /** Current state. */
  get state(): SessionState {
    return this._state;
  }

  /** Timestamp when the current state was entered. */
  get enteredAt(): number {
    return this._enteredAt;
  }

  /** Scheduled duration for the current state (ms). */
  get scheduledDuration(): number {
    return this._scheduledDuration;
  }

  /** Total number of transitions since creation. */
  get transitionCount(): number {
    return this._transitionCount;
  }

  /** Current activity type context. */
  get activityType(): ActivityType {
    return this._activityType;
  }

  /** Current time period. */
  get timePeriod(): TimePeriod {
    return this._currentTimePeriod;
  }

  /** The active user profile. */
  get profile(): SessionProfile {
    return this._profile;
  }

  /**
   * Register a listener for state transitions.
   * Returns an unsubscribe function.
   */
  onTransition(listener: TransitionListener): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  /**
   * Set the current activity type. Rebuilds the transition matrix immediately
   * so the new activity influences the next transition.
   */
  setActivityType(type: ActivityType): void {
    if (type === this._activityType) return;
    this._activityType = type;
    this._currentMatrix = buildTransitionMatrix(
      this._currentTimePeriod,
      this._profile,
      this._activityType,
    );
  }

  /**
   * Get a snapshot of the current state.
   */
  snapshot(): StateSnapshot {
    return {
      state: this._state,
      enteredAt: this._enteredAt,
      scheduledDuration: this._scheduledDuration,
      timePeriod: this._currentTimePeriod,
      transitionCount: this._transitionCount,
    };
  }

  /**
   * Check if the scheduled duration has elapsed and transition if so.
   * Returns the current snapshot (which may reflect a new state).
   *
   * This is the primary driver — call it periodically from your loop.
   */
  tick(): StateSnapshot {
    const now = this._clock();
    const elapsed = now - this._enteredAt;

    if (elapsed >= this._scheduledDuration) {
      this._transition(now);
    }

    return this.snapshot();
  }

  /**
   * Force a transition to a specific state. Useful when external events
   * demand a state change (e.g., user action detected → ACTIVE).
   */
  forceTransition(targetState: SessionState): StateSnapshot {
    const now = this._clock();
    this._refreshTimePeriod(now);
    this._performTransition(targetState, now);
    return this.snapshot();
  }

  /**
   * Elapsed time in the current state (ms).
   */
  elapsed(): number {
    return this._clock() - this._enteredAt;
  }

  /**
   * Remaining time before scheduled transition (ms). Can be negative
   * if tick() hasn't been called recently.
   */
  remaining(): number {
    return this._scheduledDuration - this.elapsed();
  }

  /**
   * Refresh the time period and rebuild the transition matrix if needed.
   */
  private _refreshTimePeriod(now: number): void {
    const hour = this._getHour(now);
    const period = getTimePeriod(hour);
    if (period !== this._currentTimePeriod) {
      this._currentTimePeriod = period;
      this._currentMatrix = buildTransitionMatrix(
        period,
        this._profile,
        this._activityType,
      );
    }
  }

  /**
   * Perform a probabilistic transition from the current state.
   */
  private _transition(now: number): void {
    this._refreshTimePeriod(now);

    const row = this._currentMatrix[this._state];
    const nextState = sampleTransition(row, this._random());
    this._performTransition(nextState, now);
  }

  /**
   * Execute a state transition and notify listeners.
   */
  private _performTransition(nextState: SessionState, now: number): void {
    const from = this._state;
    const dwellTime = now - this._enteredAt;

    this._state = nextState;
    this._enteredAt = now;
    this._scheduledDuration = this._sampleDuration(nextState);
    this._transitionCount++;

    const event: TransitionEvent = {
      from,
      to: nextState,
      timestamp: now,
      dwellTime,
      timePeriod: this._currentTimePeriod,
      activityType: this._activityType,
    };

    // Snapshot the listener array to protect against mutation during iteration.
    // Wrap each call in try/catch so one throwing listener doesn't block others.
    const listeners = [...this._listeners];
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        // Listeners must not throw, but if they do, log and continue.
        console.error("SessionStateMachine: listener threw during transition", err);
      }
    }
  }

  /**
   * Sample a duration for a state from its range, biased by the user profile.
   *
   * Profile influences:
   * - IDLE duration scaled by idleTendency
   * - AWAY duration scaled by afkProneness
   * - READING duration scaled inversely by readingSpeed
   * - THINKING duration scaled by deliberation
   * - ACTIVE duration scaled inversely by activityLevel (more active = shorter bursts, more frequent)
   * - SCROLLING uses base range (no profile bias)
   */
  private _sampleDuration(state: SessionState): number {
    const range = this._durations[state];
    const base = range.min + this._random() * (range.max - range.min);

    // Apply profile-based scaling
    let scale = 1.0;
    switch (state) {
      case SessionState.IDLE:
        // idleTendency 0→0.5x, 0.5→1x, 1→1.5x
        scale = 0.5 + this._profile.idleTendency;
        break;
      case SessionState.AWAY:
        // afkProneness 0→0.5x, 0.5→1x, 1→1.5x
        scale = 0.5 + this._profile.afkProneness;
        break;
      case SessionState.READING:
        // readingSpeed 0→1.5x (slow), 0.5→1x, 1→0.5x (fast)
        scale = 1.5 - this._profile.readingSpeed;
        break;
      case SessionState.THINKING:
        // deliberation 0→0.5x, 0.5→1x, 1→1.5x
        scale = 0.5 + this._profile.deliberation;
        break;
      case SessionState.ACTIVE:
        // activityLevel 0→1.5x (longer tasks), 0.5→1x, 1→0.5x (quick bursts)
        scale = 1.5 - this._profile.activityLevel;
        break;
      case SessionState.SCROLLING:
        break;
    }

    // Floor at 50ms to prevent zero-duration hot loops
    return Math.max(50, Math.round(base * scale));
  }
}
