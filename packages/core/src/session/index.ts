export { SessionState, BASE_DURATION_RANGES, ALL_STATES } from "./state.js";
export type { DurationRange } from "./state.js";

export { DEFAULT_SESSION_PROFILE, clampProfileValue, validateProfile } from "./profile.js";
export type { SessionProfile } from "./profile.js";

export {
  TimePeriod,
  ActivityType,
  getTimePeriod,
  buildTransitionMatrix,
  normalizeRow,
  sampleTransition,
} from "./transitions.js";
export type { TransitionRow, TransitionMatrix } from "./transitions.js";

export { SessionStateMachine } from "./machine.js";
export type {
  StateSnapshot,
  TransitionEvent,
  TransitionListener,
  RandomFn,
  ClockFn,
  SessionStateMachineConfig,
} from "./machine.js";
