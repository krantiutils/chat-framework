// @chat-framework/core
// Core types, interfaces, and shared utilities for the chat framework.

export {
  SessionStateMachine,
  getTimeOfDay,
  DEFAULT_DURATIONS,
  DEFAULT_TRANSITIONS,
  DEFAULT_TIME_MODIFIERS,
} from "./session-state-machine.js";

export type {
  SessionState,
  DurationRange,
  TransitionEdge,
  TransitionTable,
  DurationTable,
  TimeOfDay,
  TimeOfDayModifiers,
  SessionProfile,
  StateTransition,
  TransitionListener,
  RandomFn,
  ClockFn,
  SessionStateMachineOptions,
} from "./session-state-machine.js";
