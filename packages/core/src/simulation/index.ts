export { HumanResponseSimulator } from "./human-response-simulator.js";
export type {
  ResponseTimeline,
  HumanResponseSimulatorConfig,
} from "./human-response-simulator.js";

export {
  computeReadDelay,
  computeThinkDelay,
  computeTypingDuration,
  countWords,
  sampleRange,
  clamp,
  applyVariance,
  getTimeMultiplier,
  READ_NOTICE_DELAY,
  READ_PER_WORD_MS,
  READ_DELAY_BOUNDS,
  THINK_DELAY_BASE,
  THINK_DELAY_BOUNDS,
  TYPING_WPM_RANGE,
  TYPING_DURATION_BOUNDS,
  TIME_PERIOD_MULTIPLIERS,
} from "./timing.js";
