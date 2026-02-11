# @chat-framework/core API Reference

Session state machine for human behavior simulation. Provides probabilistic state transitions influenced by time-of-day, activity type, and user profile biases.

**Package**: `@chat-framework/core` (v0.0.1)

---

## SessionStateMachine

Pull-based state machine. No internal timers — external code calls `tick()` to drive transitions. Deterministic when seeded.

**Source**: `packages/core/src/session/machine.ts`

### Constructor

```typescript
new SessionStateMachine(config?: SessionStateMachineConfig)
```

Starts in `IDLE` state. If no config is provided, uses `DEFAULT_SESSION_PROFILE` and `Math.random`.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `state` | `SessionState` | Current state |
| `enteredAt` | `number` | Timestamp (ms) when current state was entered |
| `scheduledDuration` | `number` | Planned duration (ms) for current state |
| `transitionCount` | `number` | Total transitions since creation |
| `activityType` | `ActivityType` | Current activity context |
| `timePeriod` | `TimePeriod` | Current time-of-day period |
| `profile` | `SessionProfile` | Active user profile (readonly) |

### Methods

#### `tick(): StateSnapshot`

Check if the scheduled duration has elapsed. If so, perform a probabilistic transition. Returns the current snapshot (which may reflect a new state).

Call this periodically from your main loop.

```typescript
setInterval(() => {
  const snap = machine.tick();
  if (snap.state === SessionState.ACTIVE) { /* act */ }
}, 500);
```

#### `forceTransition(targetState: SessionState): StateSnapshot`

Force an immediate transition to a specific state. Useful when external events demand a state change (e.g., user action detected).

```typescript
machine.forceTransition(SessionState.ACTIVE);
```

#### `snapshot(): StateSnapshot`

Get the current state snapshot without triggering any transition.

#### `onTransition(listener: TransitionListener): () => void`

Register a listener for state transitions. Returns an unsubscribe function.

```typescript
const unsub = machine.onTransition((event) => {
  console.log(`${event.from} -> ${event.to}, dwell: ${event.dwellTime}ms`);
});
// Later: unsub();
```

#### `setActivityType(type: ActivityType): void`

Set the current activity type. Rebuilds the transition matrix immediately so the new activity influences the next transition.

#### `elapsed(): number`

Milliseconds spent in the current state.

#### `remaining(): number`

Milliseconds remaining before the scheduled transition. Can be negative if `tick()` hasn't been called recently.

---

## SessionStateMachineConfig

```typescript
interface SessionStateMachineConfig {
  profile?: SessionProfile;
  random?: RandomFn;        // () => number in [0, 1)
  clock?: ClockFn;          // () => number (ms timestamp)
  getHour?: (timestamp: number) => number;
  durationOverrides?: Partial<Record<SessionState, Partial<DurationRange>>>;
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `profile` | `DEFAULT_SESSION_PROFILE` | Behavioral biases |
| `random` | `Math.random` | RNG for deterministic testing |
| `clock` | `Date.now` | Clock for deterministic testing |
| `getHour` | `new Date(ts).getHours()` | Hour resolver for testing |
| `durationOverrides` | `{}` | Override min/max durations per state |

---

## SessionState

```typescript
enum SessionState {
  IDLE = "IDLE",
  ACTIVE = "ACTIVE",
  READING = "READING",
  THINKING = "THINKING",
  AWAY = "AWAY",
  SCROLLING = "SCROLLING",
}
```

### State Diagram

```
START → IDLE ←→ ACTIVE → READING → THINKING
          ↓        ↓        ↓         ↓
          └── AWAY ─────────────────────┘
          └── SCROLLING ────────────────┘
```

- `AWAY` always returns to `IDLE`.
- `SCROLLING` can transition to `IDLE`, `ACTIVE`, or `READING`.

### Base Duration Ranges

| State | Min | Max |
|-------|-----|-----|
| `IDLE` | 2s | 30s |
| `ACTIVE` | 5s | 120s |
| `READING` | 3s | 15s |
| `THINKING` | 1s | 5s |
| `AWAY` | 5min | 30min |
| `SCROLLING` | 2s | 20s |

Durations are scaled by the user profile. For example, `idleTendency=1.0` multiplies IDLE duration by 1.5x, while `idleTendency=0.0` multiplies by 0.5x.

---

## SessionProfile

All values are normalized to `[0, 1]`. Values outside this range are clamped.

```typescript
interface SessionProfile {
  idleTendency: number;    // 0=impatient, 1=relaxed
  afkProneness: number;    // 0=rarely AFK, 1=frequently AFK
  readingSpeed: number;    // 0=slow reader, 1=speed reader
  scrollTendency: number;  // 0=rarely scrolls, 1=scroll-heavy
  deliberation: number;    // 0=impulsive, 1=deliberate
  activityLevel: number;   // 0=low energy, 1=hyper-active
}
```

### DEFAULT_SESSION_PROFILE

All values at `0.5` (middle of range).

### Profile Effects on Duration

| State | Profile Field | Scale at 0 | Scale at 0.5 | Scale at 1 |
|-------|--------------|------------|-------------|------------|
| IDLE | `idleTendency` | 0.5x | 1.0x | 1.5x |
| AWAY | `afkProneness` | 0.5x | 1.0x | 1.5x |
| READING | `readingSpeed` | 1.5x (slow) | 1.0x | 0.5x (fast) |
| THINKING | `deliberation` | 0.5x | 1.0x | 1.5x |
| ACTIVE | `activityLevel` | 1.5x (long tasks) | 1.0x | 0.5x (quick bursts) |
| SCROLLING | — | 1.0x | 1.0x | 1.0x |

### Utility Functions

#### `validateProfile(profile: SessionProfile): SessionProfile`

Clamp all values to `[0, 1]`. Throws if any value is `NaN`.

#### `clampProfileValue(value: number): number`

Clamp a single value to `[0, 1]`.

---

## TimePeriod

```typescript
enum TimePeriod {
  PEAK = "PEAK",       // 9am-12pm, 2pm-6pm
  NORMAL = "NORMAL",   // 12pm-2pm, 6pm-9pm
  LOW = "LOW",         // 9pm-1am
  DORMANT = "DORMANT", // 1am-9am
}
```

### Time-of-Day Effects

| Period | Effect on Transitions |
|--------|----------------------|
| `PEAK` | 1.3x ACTIVE from IDLE, 0.4x AWAY from IDLE, 0.3x AWAY from ACTIVE |
| `NORMAL` | No modifiers (base probabilities) |
| `LOW` | 0.7x ACTIVE, 1.8x AWAY from IDLE, 1.5x IDLE/AWAY from ACTIVE |
| `DORMANT` | 0.3x ACTIVE, 3.0x AWAY from IDLE, 2.0x IDLE + 3.0x AWAY from ACTIVE |

#### `getTimePeriod(hour: number): TimePeriod`

Map an hour (0-23) to a time period.

---

## ActivityType

```typescript
enum ActivityType {
  TYPING = "TYPING",
  BROWSING = "BROWSING",
  WAITING = "WAITING",
}
```

| Type | Effect |
|------|--------|
| `TYPING` | Stays in ACTIVE/READING/THINKING loop; less IDLE/AWAY |
| `BROWSING` | Neutral (no modifiers) |
| `WAITING` | More SCROLLING, IDLE, AWAY; less READING |

---

## Transition Functions

#### `buildTransitionMatrix(timePeriod, profile, activityType?): TransitionMatrix`

Build a complete transition matrix. Pipeline: base matrix → time modifiers → activity modifiers → profile biases → normalization.

#### `sampleTransition(row: TransitionRow, random: number): SessionState`

Sample a next state from a probability row using a uniform random value in `[0, 1)`.

#### `normalizeRow(row: TransitionRow, selfState: SessionState): TransitionRow`

Normalize probabilities to sum to 1.0. Falls back to uniform distribution over non-self states if all values are zero.

---

## Types

```typescript
interface StateSnapshot {
  readonly state: SessionState;
  readonly enteredAt: number;
  readonly scheduledDuration: number;
  readonly timePeriod: TimePeriod;
  readonly transitionCount: number;
}

interface TransitionEvent {
  readonly from: SessionState;
  readonly to: SessionState;
  readonly timestamp: number;
  readonly dwellTime: number;
  readonly timePeriod: TimePeriod;
  readonly activityType: ActivityType;
}

type TransitionListener = (event: TransitionEvent) => void;
type RandomFn = () => number;
type ClockFn = () => number;

interface DurationRange {
  readonly min: number;
  readonly max: number;
}

type TransitionRow = Record<SessionState, number>;
type TransitionMatrix = Record<SessionState, TransitionRow>;
```

---

## Exports

```typescript
// Classes
export { SessionStateMachine }

// Enums
export { SessionState, TimePeriod, ActivityType }

// Constants
export { ALL_STATES, BASE_DURATION_RANGES, DEFAULT_SESSION_PROFILE }

// Functions
export { validateProfile, clampProfileValue, getTimePeriod }
export { buildTransitionMatrix, normalizeRow, sampleTransition }

// Types
export type {
  SessionProfile,
  DurationRange,
  StateSnapshot,
  TransitionEvent,
  TransitionListener,
  RandomFn,
  ClockFn,
  SessionStateMachineConfig,
  TransitionRow,
  TransitionMatrix,
}
```
