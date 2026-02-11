import { SessionState } from "../session/state.js";
import type { RandomFn } from "../session/machine.js";

/**
 * Delay ranges per session state (ms).
 * These control how long the orchestrator waits before executing an action
 * based on the current behavioral state.
 */
const PRE_ACTION_DELAYS: Record<SessionState, { min: number; max: number }> = {
  [SessionState.ACTIVE]: { min: 80, max: 400 },
  [SessionState.IDLE]: { min: 400, max: 1800 },
  [SessionState.READING]: { min: 800, max: 2500 },
  [SessionState.THINKING]: { min: 400, max: 1200 },
  [SessionState.SCROLLING]: { min: 150, max: 600 },
  [SessionState.AWAY]: { min: 0, max: 0 }, // Should not execute during AWAY
};

/**
 * Delays inserted between consecutive actions in a sequence (ms).
 * Keyed by "previousActionType -> nextActionType".
 */
const INTER_ACTION_DELAYS: Record<string, { min: number; max: number }> = {
  "click->click": { min: 250, max: 1200 },
  "click->type": { min: 400, max: 1500 },
  "click->scroll": { min: 200, max: 800 },
  "click->hover": { min: 150, max: 600 },
  "type->click": { min: 200, max: 1000 },
  "type->type": { min: 300, max: 1200 },
  "type->scroll": { min: 200, max: 800 },
  "scroll->click": { min: 200, max: 800 },
  "scroll->type": { min: 300, max: 1000 },
  "scroll->scroll": { min: 80, max: 400 },
  "hover->click": { min: 100, max: 500 },
  "hover->type": { min: 200, max: 800 },
  "wait->click": { min: 100, max: 500 },
  "wait->type": { min: 150, max: 600 },
  "wait->scroll": { min: 100, max: 400 },
};

const DEFAULT_INTER_ACTION_DELAY = { min: 200, max: 1000 };

/**
 * Post-click delay before mouse-up (simulates realistic click duration).
 */
export const CLICK_HOLD_DELAY = { min: 50, max: 120 };

/**
 * Hover dwell time — how long to pause after mouse arrives at target
 * before clicking (simulates visual confirmation).
 */
export const HOVER_DWELL_DELAY = { min: 40, max: 180 };

/**
 * Double-click inter-click gap (ms).
 */
export const DOUBLE_CLICK_GAP = { min: 40, max: 100 };

/**
 * Sample a value uniformly from [min, max].
 */
export function sampleDelay(
  range: { min: number; max: number },
  random: RandomFn,
): number {
  return Math.round(range.min + random() * (range.max - range.min));
}

/**
 * Get the pre-action delay for the current session state.
 */
export function getPreActionDelay(
  state: SessionState,
  random: RandomFn,
): number {
  const range = PRE_ACTION_DELAYS[state];
  return sampleDelay(range, random);
}

/**
 * Get the inter-action delay between two action types.
 */
export function getInterActionDelay(
  previousType: string,
  nextType: string,
  random: RandomFn,
): number {
  const key = `${previousType}->${nextType}`;
  const range = INTER_ACTION_DELAYS[key] ?? DEFAULT_INTER_ACTION_DELAY;
  return sampleDelay(range, random);
}

/**
 * Scroll increment sizing — humans scroll in discrete wheel "clicks"
 * typically 100-120px per click, with some variation.
 */
export const SCROLL_INCREMENT = { min: 80, max: 140 };

/**
 * Delay between scroll wheel "clicks" (ms).
 */
export const SCROLL_INTER_DELAY = { min: 30, max: 120 };
