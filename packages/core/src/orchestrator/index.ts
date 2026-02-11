export { ActionOrchestrator } from "./orchestrator.js";

export { FallbackMouseProvider } from "./fallback-mouse.js";
export { FallbackKeyboardProvider } from "./fallback-keyboard.js";

export {
  getPreActionDelay,
  getInterActionDelay,
  sampleDelay,
  CLICK_HOLD_DELAY,
  HOVER_DWELL_DELAY,
  DOUBLE_CLICK_GAP,
  SCROLL_INCREMENT,
  SCROLL_INTER_DELAY,
} from "./delays.js";

export type {
  Point,
  ViewportSize,
  MouseButton,
  ClickRequest,
  TypeRequest,
  ScrollRequest,
  HoverRequest,
  WaitRequest,
  ActionRequest,
  TrajectoryPoint,
  MouseTrajectoryProvider,
  KeystrokeEvent,
  KeystrokeTimingProvider,
  ActionExecutor,
  ActionOrchestratorConfig,
} from "./types.js";
