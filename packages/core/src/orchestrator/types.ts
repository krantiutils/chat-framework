import type { SessionStateMachine, RandomFn, ClockFn } from "../session/index.js";

// ─── Action Request Types ────────────────────────────────────────────────────

/** Point in 2D pixel coordinates. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Viewport dimensions. */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/** Mouse button type. */
export type MouseButton = "left" | "right" | "middle";

/** Request to click at a pixel position. */
export interface ClickRequest {
  readonly type: "click";
  /** Target pixel coordinates. */
  readonly target: Point;
  readonly button?: MouseButton;
  readonly doubleClick?: boolean;
}

/** Request to type text. */
export interface TypeRequest {
  readonly type: "type";
  /** Text to type. */
  readonly text: string;
  /** If true, select-all + delete before typing. */
  readonly clearFirst?: boolean;
}

/** Request to scroll by a delta amount. */
export interface ScrollRequest {
  readonly type: "scroll";
  /** Horizontal scroll delta (pixels). Positive = scroll right. */
  readonly deltaX?: number;
  /** Vertical scroll delta (pixels). Positive = scroll down. */
  readonly deltaY?: number;
}

/** Request to move the mouse to a position without clicking. */
export interface HoverRequest {
  readonly type: "hover";
  readonly target: Point;
}

/** Request to pause execution, simulating user waiting. */
export interface WaitRequest {
  readonly type: "wait";
  /** Minimum wait time in ms. Actual delay may be longer (state-dependent). */
  readonly minMs?: number;
  /** Maximum wait time in ms. */
  readonly maxMs?: number;
}

/** Union of all action request types. */
export type ActionRequest =
  | ClickRequest
  | TypeRequest
  | ScrollRequest
  | HoverRequest
  | WaitRequest;

// ─── Trajectory & Timing Providers ───────────────────────────────────────────

/** A single point in a mouse trajectory with timing. */
export interface TrajectoryPoint {
  readonly x: number;
  readonly y: number;
  /** Relative time from trajectory start, in ms. */
  readonly timestamp: number;
}

/**
 * Provides mouse trajectories between two points.
 * Implementations may use a GAN model or simpler heuristics.
 */
export interface MouseTrajectoryProvider {
  /**
   * Generate a trajectory from start to end.
   * @param start Starting pixel position.
   * @param end Target pixel position.
   * @returns Array of trajectory points with timestamps.
   */
  generate(start: Point, end: Point): TrajectoryPoint[];
}

/** A single keystroke event with timing. */
export interface KeystrokeEvent {
  /** The character to type (or "Backspace" for corrections). */
  readonly key: string;
  /** How long the key is held down, in ms. */
  readonly holdTime: number;
  /** Delay before this key is pressed (from previous key up), in ms. */
  readonly preDelay: number;
}

/**
 * Provides keystroke timing sequences for text input.
 * Implementations may use a GAN model or simpler statistical heuristics.
 */
export interface KeystrokeTimingProvider {
  /**
   * Generate keystroke events for the given text.
   * May include typos and corrections (Backspace events).
   * @param text The text to generate keystrokes for.
   * @returns Array of keystroke events with timing.
   */
  generate(text: string): KeystrokeEvent[];
}

// ─── Action Executor (Browser-side) ─────────────────────────────────────────

/**
 * Low-level action executor that dispatches CDP events to the browser.
 * Implemented by the browser package using Puppeteer's CDPSession.
 */
export interface ActionExecutor {
  /** Move mouse to absolute pixel coordinates. */
  mouseMove(x: number, y: number): Promise<void>;

  /** Press mouse button down. */
  mouseDown(button?: MouseButton): Promise<void>;

  /** Release mouse button. */
  mouseUp(button?: MouseButton): Promise<void>;

  /** Press a key down. */
  keyDown(key: string): Promise<void>;

  /** Release a key. */
  keyUp(key: string): Promise<void>;

  /** Dispatch a scroll/wheel event. */
  scroll(deltaX: number, deltaY: number): Promise<void>;

  /** Get the current mouse position. */
  getMousePosition(): Promise<Point>;

  /** Get the viewport dimensions. */
  getViewportSize(): Promise<ViewportSize>;
}

// ─── Orchestrator Configuration ──────────────────────────────────────────────

/**
 * Configuration for the ActionOrchestrator.
 */
export interface ActionOrchestratorConfig {
  /** Session state machine controlling behavioral modes. */
  readonly stateMachine: SessionStateMachine;

  /** Low-level action executor (browser CDP). */
  readonly executor: ActionExecutor;

  /** Provider for mouse trajectory generation. */
  readonly mouseProvider: MouseTrajectoryProvider;

  /** Provider for keystroke timing generation. */
  readonly keyboardProvider: KeystrokeTimingProvider;

  /** Override RNG for deterministic testing. Defaults to Math.random. */
  readonly random?: RandomFn;

  /** Override clock for deterministic testing. Defaults to Date.now. */
  readonly clock?: ClockFn;

  /**
   * Override the sleep function for testing. Defaults to a real delay.
   * In tests, this can be replaced with a no-op or tracked function.
   */
  readonly sleep?: (ms: number) => Promise<void>;
}
