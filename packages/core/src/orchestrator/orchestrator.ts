import { SessionState } from "../session/state.js";
import { ActivityType } from "../session/transitions.js";
import type { SessionStateMachine, RandomFn, ClockFn } from "../session/machine.js";
import type {
  ActionOrchestratorConfig,
  ActionRequest,
  ActionExecutor,
  MouseTrajectoryProvider,
  KeystrokeTimingProvider,
  ClickRequest,
  TypeRequest,
  ScrollRequest,
  HoverRequest,
  WaitRequest,
  Point,
} from "./types.js";
import {
  getPreActionDelay,
  getInterActionDelay,
  sampleDelay,
  CLICK_HOLD_DELAY,
  HOVER_DWELL_DELAY,
  DOUBLE_CLICK_GAP,
  SCROLL_INCREMENT,
  SCROLL_INTER_DELAY,
} from "./delays.js";

/** States that allow action execution. */
const ACTIONABLE_STATES = new Set([
  SessionState.ACTIVE,
  SessionState.IDLE,
  SessionState.READING,
  SessionState.THINKING,
  SessionState.SCROLLING,
]);

/** Maximum time to wait for the state machine to leave AWAY (ms). */
const MAX_AWAY_WAIT = 1_800_000; // 30 minutes

/** Tick interval while waiting for state machine transitions (ms). */
const STATE_POLL_INTERVAL = 500;

/**
 * Action orchestrator that sequences mouse/keyboard actions with realistic
 * delays, coordinated with the session state machine.
 *
 * The orchestrator sits between high-level intent ("click this element",
 * "type this text") and low-level browser automation (CDP mouse/keyboard
 * events). It ensures actions look human by:
 *
 * 1. Consulting the session state machine for behavioral context
 * 2. Generating realistic mouse trajectories via the trajectory provider
 * 3. Generating realistic keystroke timing via the keyboard provider
 * 4. Inserting state-aware delays between actions
 * 5. Feeding activity type back to the state machine
 *
 * Usage:
 * ```ts
 * const orchestrator = new ActionOrchestrator({
 *   stateMachine,
 *   executor: cdpExecutor,
 *   mouseProvider: new FallbackMouseProvider(),
 *   keyboardProvider: new FallbackKeyboardProvider(),
 * });
 *
 * await orchestrator.execute({ type: "click", target: { x: 500, y: 300 } });
 * await orchestrator.execute({ type: "type", text: "Hello, world!" });
 * ```
 */
export class ActionOrchestrator {
  private readonly _stateMachine: SessionStateMachine;
  private readonly _executor: ActionExecutor;
  private readonly _mouseProvider: MouseTrajectoryProvider;
  private readonly _keyboardProvider: KeystrokeTimingProvider;
  private readonly _random: RandomFn;
  private readonly _clock: ClockFn;
  private readonly _sleep: (ms: number) => Promise<void>;
  private _aborted: boolean;

  constructor(config: ActionOrchestratorConfig) {
    this._stateMachine = config.stateMachine;
    this._executor = config.executor;
    this._mouseProvider = config.mouseProvider;
    this._keyboardProvider = config.keyboardProvider;
    this._random = config.random ?? Math.random;
    this._clock = config.clock ?? Date.now;
    this._sleep = config.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    this._aborted = false;
  }

  /**
   * Execute a single action with human-like timing.
   *
   * Waits for an appropriate session state, applies pre-action delay,
   * executes the action, and updates the state machine's activity type.
   *
   * @throws {Error} If aborted during execution.
   */
  async execute(request: ActionRequest): Promise<void> {
    this._checkAborted();
    await this._waitForActionableState();
    this._checkAborted();

    // Pre-action delay based on current state
    const snap = this._stateMachine.tick();
    const preDelay = getPreActionDelay(snap.state, this._random);
    if (preDelay > 0) {
      await this._sleep(preDelay);
    }
    this._checkAborted();

    switch (request.type) {
      case "click":
        await this._executeClick(request);
        break;
      case "type":
        await this._executeType(request);
        break;
      case "scroll":
        await this._executeScroll(request);
        break;
      case "hover":
        await this._executeHover(request);
        break;
      case "wait":
        await this._executeWait(request);
        break;
    }
  }

  /**
   * Execute a sequence of actions with realistic inter-action delays.
   *
   * Between each action, the orchestrator:
   * - Ticks the state machine to allow natural transitions
   * - Inserts state-aware delays between different action types
   * - Respects AWAY states (waits for user to "return")
   */
  async executeSequence(requests: readonly ActionRequest[]): Promise<void> {
    for (let i = 0; i < requests.length; i++) {
      this._checkAborted();

      // Inter-action delay (not before the first action)
      if (i > 0) {
        const prevType = requests[i - 1].type;
        const nextType = requests[i].type;
        const interDelay = getInterActionDelay(prevType, nextType, this._random);

        // Tick state machine during the inter-action delay
        this._stateMachine.tick();

        if (interDelay > 0) {
          await this._sleep(interDelay);
        }
      }

      await this.execute(requests[i]);
    }
  }

  /**
   * Abort any ongoing execution. Causes in-flight operations to throw.
   */
  abort(): void {
    this._aborted = true;
  }

  /**
   * Reset the abort flag. Must be called before re-using an aborted orchestrator.
   */
  resetAbort(): void {
    this._aborted = false;
  }

  // ─── Action Executors ──────────────────────────────────────────────────────

  private async _executeClick(request: ClickRequest): Promise<void> {
    const button = request.button ?? "left";

    // Move to target with trajectory
    await this._moveToTarget(request.target);
    this._checkAborted();

    // Hover dwell (visual confirmation before click)
    const dwellDelay = sampleDelay(HOVER_DWELL_DELAY, this._random);
    await this._sleep(dwellDelay);
    this._checkAborted();

    // Click (down + hold + up)
    await this._executor.mouseDown(button);
    const holdDelay = sampleDelay(CLICK_HOLD_DELAY, this._random);
    await this._sleep(holdDelay);
    await this._executor.mouseUp(button);

    // Double click if requested
    if (request.doubleClick) {
      const gap = sampleDelay(DOUBLE_CLICK_GAP, this._random);
      await this._sleep(gap);
      await this._executor.mouseDown(button);
      const holdDelay2 = sampleDelay(CLICK_HOLD_DELAY, this._random);
      await this._sleep(holdDelay2);
      await this._executor.mouseUp(button);
    }

    // Update activity: clicking is browsing
    this._stateMachine.setActivityType(ActivityType.BROWSING);
  }

  private async _executeType(request: TypeRequest): Promise<void> {
    // Clear field if requested
    if (request.clearFirst) {
      // Select all: Ctrl+A
      await this._executor.keyDown("Control");
      await this._sleep(sampleDelay({ min: 20, max: 60 }, this._random));
      await this._executor.keyDown("a");
      await this._sleep(sampleDelay({ min: 40, max: 80 }, this._random));
      await this._executor.keyUp("a");
      await this._executor.keyUp("Control");
      await this._sleep(sampleDelay({ min: 30, max: 80 }, this._random));

      // Delete selection
      await this._executor.keyDown("Backspace");
      await this._sleep(sampleDelay({ min: 40, max: 80 }, this._random));
      await this._executor.keyUp("Backspace");
      await this._sleep(sampleDelay({ min: 80, max: 200 }, this._random));
    }

    // Signal typing activity
    this._stateMachine.setActivityType(ActivityType.TYPING);

    // Generate keystroke timing
    const events = this._keyboardProvider.generate(request.text);

    // Track shift state to properly handle held modifier
    let shiftHeld = false;

    for (const event of events) {
      this._checkAborted();

      // Pre-delay (flight time)
      if (event.preDelay > 0) {
        await this._sleep(event.preDelay);
      }

      if (event.key === "Shift") {
        // Shift down (will be released after the next real key)
        await this._executor.keyDown("Shift");
        shiftHeld = true;
        continue;
      }

      // Key down
      await this._executor.keyDown(event.key);

      // Hold time
      if (event.holdTime > 0) {
        await this._sleep(event.holdTime);
      }

      // Key up
      await this._executor.keyUp(event.key);

      // Release shift if it was held for this character
      if (shiftHeld) {
        await this._sleep(sampleDelay({ min: 10, max: 30 }, this._random));
        await this._executor.keyUp("Shift");
        shiftHeld = false;
      }
    }

    // Safety: release shift if still held
    if (shiftHeld) {
      await this._executor.keyUp("Shift");
    }

    // Return to browsing activity
    this._stateMachine.setActivityType(ActivityType.BROWSING);
  }

  private async _executeScroll(request: ScrollRequest): Promise<void> {
    const totalDeltaX = request.deltaX ?? 0;
    const totalDeltaY = request.deltaY ?? 0;

    if (totalDeltaX === 0 && totalDeltaY === 0) return;

    // Break scroll into discrete "wheel clicks"
    const totalDistance = Math.sqrt(totalDeltaX * totalDeltaX + totalDeltaY * totalDeltaY);
    const numIncrements = Math.max(1, Math.round(totalDistance / 110)); // ~110px per wheel click

    // Direction unit vector
    const dirX = totalDistance > 0 ? totalDeltaX / totalDistance : 0;
    const dirY = totalDistance > 0 ? totalDeltaY / totalDistance : 0;

    let scrolledX = 0;
    let scrolledY = 0;

    for (let i = 0; i < numIncrements; i++) {
      this._checkAborted();

      // Calculate this increment's scroll amount
      const remaining = numIncrements - i;
      let incrementX: number;
      let incrementY: number;

      if (i === numIncrements - 1) {
        // Last increment: consume remainder
        incrementX = totalDeltaX - scrolledX;
        incrementY = totalDeltaY - scrolledY;
      } else {
        // Normal increment with some variation
        const mag = sampleDelay(SCROLL_INCREMENT, this._random);
        incrementX = Math.round(dirX * mag);
        incrementY = Math.round(dirY * mag);

        // Don't overshoot
        if (Math.abs(scrolledX + incrementX) > Math.abs(totalDeltaX)) {
          incrementX = totalDeltaX - scrolledX;
        }
        if (Math.abs(scrolledY + incrementY) > Math.abs(totalDeltaY)) {
          incrementY = totalDeltaY - scrolledY;
        }
      }

      await this._executor.scroll(incrementX, incrementY);
      scrolledX += incrementX;
      scrolledY += incrementY;

      // Delay between scroll increments (not after the last one)
      if (i < numIncrements - 1) {
        const delay = sampleDelay(SCROLL_INTER_DELAY, this._random);
        await this._sleep(delay);
      }
    }

    this._stateMachine.setActivityType(ActivityType.BROWSING);
  }

  private async _executeHover(request: HoverRequest): Promise<void> {
    await this._moveToTarget(request.target);
    this._stateMachine.setActivityType(ActivityType.BROWSING);
  }

  private async _executeWait(request: WaitRequest): Promise<void> {
    const minMs = request.minMs ?? 500;
    const maxMs = request.maxMs ?? 3000;
    const delay = sampleDelay({ min: minMs, max: maxMs }, this._random);

    // Signal waiting state
    this._stateMachine.setActivityType(ActivityType.WAITING);

    await this._sleep(delay);

    // Return to browsing after wait
    this._stateMachine.setActivityType(ActivityType.BROWSING);
  }

  // ─── Shared Helpers ────────────────────────────────────────────────────────

  /**
   * Generate and execute a mouse trajectory to the target position.
   */
  private async _moveToTarget(target: Point): Promise<void> {
    const currentPos = await this._executor.getMousePosition();
    const trajectory = this._mouseProvider.generate(currentPos, target);

    if (trajectory.length === 0) return;

    let prevTimestamp = 0;

    for (const point of trajectory) {
      this._checkAborted();

      // Wait for the inter-point delay
      const delta = point.timestamp - prevTimestamp;
      if (delta > 0) {
        await this._sleep(delta);
      }

      await this._executor.mouseMove(point.x, point.y);
      prevTimestamp = point.timestamp;
    }
  }

  /**
   * Wait until the state machine is in a state where actions can be executed.
   * If the machine is in AWAY, waits for it to transition out.
   */
  private async _waitForActionableState(): Promise<void> {
    const startWait = this._clock();

    while (true) {
      const snap = this._stateMachine.tick();

      if (ACTIONABLE_STATES.has(snap.state)) {
        return;
      }

      // AWAY: wait for natural transition
      if (snap.state === SessionState.AWAY) {
        const waitedMs = this._clock() - startWait;
        if (waitedMs >= MAX_AWAY_WAIT) {
          // Force out of AWAY after max wait
          this._stateMachine.forceTransition(SessionState.IDLE);
          return;
        }
        await this._sleep(STATE_POLL_INTERVAL);
        continue;
      }

      // Unknown state — force to IDLE as safety net
      this._stateMachine.forceTransition(SessionState.IDLE);
      return;
    }
  }

  private _checkAborted(): void {
    if (this._aborted) {
      throw new Error("ActionOrchestrator: execution aborted");
    }
  }
}
