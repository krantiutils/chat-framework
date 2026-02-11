import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SessionStateMachine,
  SessionState,
  ActivityType,
  DEFAULT_SESSION_PROFILE,
} from "../session/index.js";
import { ActionOrchestrator } from "../orchestrator/orchestrator.js";
import { FallbackMouseProvider } from "../orchestrator/fallback-mouse.js";
import { FallbackKeyboardProvider } from "../orchestrator/fallback-keyboard.js";
import type {
  ActionExecutor,
  ActionRequest,
  Point,
  MouseButton,
} from "../orchestrator/types.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Create a mock ActionExecutor that records all calls. */
function createMockExecutor(): ActionExecutor & {
  calls: Array<{ method: string; args: unknown[] }>;
  mousePos: Point;
} {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const state = { mousePos: { x: 0, y: 0 } };

  return {
    calls,
    get mousePos() { return state.mousePos; },
    set mousePos(p: Point) { state.mousePos = p; },

    async mouseMove(x: number, y: number) {
      calls.push({ method: "mouseMove", args: [x, y] });
      state.mousePos = { x, y };
    },
    async mouseDown(button?: MouseButton) {
      calls.push({ method: "mouseDown", args: [button] });
    },
    async mouseUp(button?: MouseButton) {
      calls.push({ method: "mouseUp", args: [button] });
    },
    async keyDown(key: string) {
      calls.push({ method: "keyDown", args: [key] });
    },
    async keyUp(key: string) {
      calls.push({ method: "keyUp", args: [key] });
    },
    async scroll(deltaX: number, deltaY: number) {
      calls.push({ method: "scroll", args: [deltaX, deltaY] });
    },
    async getMousePosition(): Promise<Point> {
      return { ...state.mousePos };
    },
    async getViewportSize() {
      return { width: 1920, height: 1080 };
    },
  };
}

/** Create orchestrator with deterministic RNG, instant sleeps, and mock executor. */
function createTestOrchestrator(opts: {
  randomSeq?: number[];
  startTime?: number;
  hour?: number;
} = {}) {
  let callIndex = 0;
  const seq = opts.randomSeq ?? [0.5];
  const random = () => {
    const val = seq[callIndex % seq.length];
    callIndex++;
    return val;
  };

  let currentTime = opts.startTime ?? 1_000_000;
  const clock = () => currentTime;
  const advanceClock = (ms: number) => { currentTime += ms; };

  const hour = opts.hour ?? 12;

  const stateMachine = new SessionStateMachine({
    profile: DEFAULT_SESSION_PROFILE,
    random,
    clock,
    getHour: () => hour,
  });

  const executor = createMockExecutor();

  // No-op sleep for testing (but still advances clock slightly)
  const sleepCalls: number[] = [];
  const sleep = async (ms: number) => {
    sleepCalls.push(ms);
    advanceClock(ms);
  };

  const mouseProvider = new FallbackMouseProvider(random);
  const keyboardProvider = new FallbackKeyboardProvider(random);

  const orchestrator = new ActionOrchestrator({
    stateMachine,
    executor,
    mouseProvider,
    keyboardProvider,
    random,
    clock,
    sleep,
  });

  return {
    orchestrator,
    executor,
    stateMachine,
    sleepCalls,
    advanceClock,
    clock,
    random,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ActionOrchestrator", () => {
  describe("execute — click", () => {
    it("moves mouse along trajectory then clicks", async () => {
      const { orchestrator, executor } = createTestOrchestrator();

      await orchestrator.execute({
        type: "click",
        target: { x: 500, y: 300 },
      });

      // Should have mouseMove calls (trajectory), then mouseDown + mouseUp
      const moveCalls = executor.calls.filter((c) => c.method === "mouseMove");
      const downCalls = executor.calls.filter((c) => c.method === "mouseDown");
      const upCalls = executor.calls.filter((c) => c.method === "mouseUp");

      expect(moveCalls.length).toBeGreaterThan(0);
      expect(downCalls).toHaveLength(1);
      expect(upCalls).toHaveLength(1);

      // Final move should be near the target
      const lastMove = moveCalls[moveCalls.length - 1];
      expect(lastMove.args[0]).toBe(500); // x
      expect(lastMove.args[1]).toBe(300); // y
    });

    it("executes double click when requested", async () => {
      const { orchestrator, executor } = createTestOrchestrator();

      await orchestrator.execute({
        type: "click",
        target: { x: 100, y: 100 },
        doubleClick: true,
      });

      const downCalls = executor.calls.filter((c) => c.method === "mouseDown");
      const upCalls = executor.calls.filter((c) => c.method === "mouseUp");

      expect(downCalls).toHaveLength(2);
      expect(upCalls).toHaveLength(2);
    });

    it("uses specified mouse button", async () => {
      const { orchestrator, executor } = createTestOrchestrator();

      await orchestrator.execute({
        type: "click",
        target: { x: 100, y: 100 },
        button: "right",
      });

      const downCalls = executor.calls.filter((c) => c.method === "mouseDown");
      expect(downCalls[0].args[0]).toBe("right");
    });

    it("sets activity type to BROWSING after click", async () => {
      const { orchestrator, stateMachine } = createTestOrchestrator();

      // Change activity type first
      stateMachine.setActivityType(ActivityType.TYPING);

      await orchestrator.execute({
        type: "click",
        target: { x: 100, y: 100 },
      });

      expect(stateMachine.activityType).toBe(ActivityType.BROWSING);
    });
  });

  describe("execute — type", () => {
    it("dispatches keyDown/keyUp for each character", async () => {
      const { orchestrator, executor } = createTestOrchestrator();

      await orchestrator.execute({
        type: "type",
        text: "hi",
      });

      const keyDowns = executor.calls.filter((c) => c.method === "keyDown");
      const keyUps = executor.calls.filter((c) => c.method === "keyUp");

      // Should have at least keyDown/keyUp for 'h' and 'i'
      // May have more if typos were injected
      expect(keyDowns.length).toBeGreaterThanOrEqual(2);
      expect(keyUps.length).toBeGreaterThanOrEqual(2);

      // Check that the actual characters appear in key events
      const allKeys = keyDowns.map((c) => c.args[0]);
      expect(allKeys).toContain("h");
      expect(allKeys).toContain("i");
    });

    it("sets activity type to TYPING during text input", async () => {
      const { orchestrator, stateMachine, executor } = createTestOrchestrator();

      // Track activity type changes
      const activityChanges: ActivityType[] = [];
      const origSetActivity = stateMachine.setActivityType.bind(stateMachine);
      stateMachine.setActivityType = (type: ActivityType) => {
        activityChanges.push(type);
        origSetActivity(type);
      };

      await orchestrator.execute({
        type: "type",
        text: "a",
      });

      // Should have set TYPING and then back to BROWSING
      expect(activityChanges).toContain(ActivityType.TYPING);
      expect(activityChanges[activityChanges.length - 1]).toBe(ActivityType.BROWSING);
    });

    it("handles clearFirst by sending Ctrl+A then Backspace", async () => {
      const { orchestrator, executor } = createTestOrchestrator();

      await orchestrator.execute({
        type: "type",
        text: "x",
        clearFirst: true,
      });

      const keyDowns = executor.calls
        .filter((c) => c.method === "keyDown")
        .map((c) => c.args[0]);

      // Should include Control, a, Backspace before the actual 'x'
      const ctrlIdx = keyDowns.indexOf("Control");
      const aIdx = keyDowns.indexOf("a");
      const bsIdx = keyDowns.indexOf("Backspace");
      const xIdx = keyDowns.indexOf("x");

      expect(ctrlIdx).toBeGreaterThanOrEqual(0);
      expect(aIdx).toBeGreaterThan(ctrlIdx);
      expect(bsIdx).toBeGreaterThan(aIdx);
      expect(xIdx).toBeGreaterThan(bsIdx);
    });

    it("handles empty text without error", async () => {
      const { orchestrator, executor } = createTestOrchestrator();

      await orchestrator.execute({
        type: "type",
        text: "",
      });

      // Only Shift-related or no key events
      const keyDowns = executor.calls.filter((c) => c.method === "keyDown");
      expect(keyDowns).toHaveLength(0);
    });
  });

  describe("execute — scroll", () => {
    it("dispatches scroll events in increments", async () => {
      const { orchestrator, executor } = createTestOrchestrator();

      await orchestrator.execute({
        type: "scroll",
        deltaY: 500,
      });

      const scrollCalls = executor.calls.filter((c) => c.method === "scroll");
      expect(scrollCalls.length).toBeGreaterThan(0);

      // Total scrolled should approximately equal requested
      const totalY = scrollCalls.reduce(
        (sum, c) => sum + (c.args[1] as number),
        0,
      );
      expect(totalY).toBe(500);
    });

    it("handles zero scroll gracefully", async () => {
      const { orchestrator, executor } = createTestOrchestrator();

      await orchestrator.execute({
        type: "scroll",
        deltaX: 0,
        deltaY: 0,
      });

      const scrollCalls = executor.calls.filter((c) => c.method === "scroll");
      expect(scrollCalls).toHaveLength(0);
    });

    it("handles horizontal scroll", async () => {
      const { orchestrator, executor } = createTestOrchestrator();

      await orchestrator.execute({
        type: "scroll",
        deltaX: 200,
      });

      const scrollCalls = executor.calls.filter((c) => c.method === "scroll");
      const totalX = scrollCalls.reduce(
        (sum, c) => sum + (c.args[0] as number),
        0,
      );
      expect(totalX).toBe(200);
    });
  });

  describe("execute — hover", () => {
    it("moves mouse to target without clicking", async () => {
      const { orchestrator, executor } = createTestOrchestrator();

      await orchestrator.execute({
        type: "hover",
        target: { x: 300, y: 200 },
      });

      const moveCalls = executor.calls.filter((c) => c.method === "mouseMove");
      const clickCalls = executor.calls.filter(
        (c) => c.method === "mouseDown" || c.method === "mouseUp",
      );

      expect(moveCalls.length).toBeGreaterThan(0);
      expect(clickCalls).toHaveLength(0);

      // Final position should be the target
      const lastMove = moveCalls[moveCalls.length - 1];
      expect(lastMove.args[0]).toBe(300);
      expect(lastMove.args[1]).toBe(200);
    });
  });

  describe("execute — wait", () => {
    it("pauses for the specified duration range", async () => {
      const { orchestrator, sleepCalls, stateMachine } = createTestOrchestrator();

      // Track activity type
      const activityChanges: ActivityType[] = [];
      const origSetActivity = stateMachine.setActivityType.bind(stateMachine);
      stateMachine.setActivityType = (type: ActivityType) => {
        activityChanges.push(type);
        origSetActivity(type);
      };

      await orchestrator.execute({
        type: "wait",
        minMs: 1000,
        maxMs: 2000,
      });

      // Should have set WAITING activity type
      expect(activityChanges).toContain(ActivityType.WAITING);

      // Should have slept for a duration in the range
      // (includes pre-action delay + actual wait)
      const totalSleep = sleepCalls.reduce((a, b) => a + b, 0);
      expect(totalSleep).toBeGreaterThan(0);
    });
  });

  describe("executeSequence", () => {
    it("executes multiple actions in order", async () => {
      const { orchestrator, executor } = createTestOrchestrator();

      await orchestrator.executeSequence([
        { type: "click", target: { x: 100, y: 100 } },
        { type: "type", text: "a" },
      ]);

      // Click should come before type
      const allMethods = executor.calls.map((c) => c.method);
      const lastMouseUp = allMethods.lastIndexOf("mouseUp");
      const firstKeyDown = allMethods.indexOf("keyDown");

      // mouseUp (from click) should precede keyDown (from type)
      // Note: we need to find the mouseUp from the click, not from scroll etc.
      expect(lastMouseUp).toBeLessThan(firstKeyDown);
    });

    it("inserts inter-action delays between actions", async () => {
      const { orchestrator, sleepCalls } = createTestOrchestrator();

      const sleepCountBefore = sleepCalls.length;

      await orchestrator.executeSequence([
        { type: "hover", target: { x: 50, y: 50 } },
        { type: "click", target: { x: 100, y: 100 } },
      ]);

      // Should have more sleep calls than a single action
      expect(sleepCalls.length).toBeGreaterThan(sleepCountBefore);
    });

    it("handles empty sequence without error", async () => {
      const { orchestrator, executor } = createTestOrchestrator();

      await orchestrator.executeSequence([]);

      expect(executor.calls).toHaveLength(0);
    });
  });

  describe("abort", () => {
    it("throws on aborted execution", async () => {
      const { orchestrator } = createTestOrchestrator();

      orchestrator.abort();

      await expect(
        orchestrator.execute({ type: "hover", target: { x: 0, y: 0 } }),
      ).rejects.toThrow("execution aborted");
    });

    it("can be reset and reused", async () => {
      const { orchestrator, executor } = createTestOrchestrator();

      orchestrator.abort();
      orchestrator.resetAbort();

      await orchestrator.execute({ type: "hover", target: { x: 50, y: 50 } });

      const moveCalls = executor.calls.filter((c) => c.method === "mouseMove");
      expect(moveCalls.length).toBeGreaterThan(0);
    });
  });

  describe("state machine integration", () => {
    it("waits for actionable state when in AWAY", async () => {
      const t = createTestOrchestrator();
      const { orchestrator, stateMachine, sleepCalls } = t;

      // Force into AWAY state
      stateMachine.forceTransition(SessionState.AWAY);

      // The orchestrator should wait and tick until AWAY ends
      // Since our test clock advances on sleep, eventually the AWAY
      // duration will elapse and the machine will transition to IDLE
      await orchestrator.execute({
        type: "hover",
        target: { x: 100, y: 100 },
      });

      // Should have waited (multiple poll intervals)
      expect(sleepCalls.length).toBeGreaterThan(1);
    });

    it("applies pre-action delay based on session state", async () => {
      const { orchestrator, sleepCalls } = createTestOrchestrator();

      await orchestrator.execute({
        type: "hover",
        target: { x: 100, y: 100 },
      });

      // First sleep should be the pre-action delay (> 0)
      expect(sleepCalls[0]).toBeGreaterThan(0);
    });
  });
});

describe("FallbackMouseProvider", () => {
  it("generates trajectory from start to end", () => {
    const provider = new FallbackMouseProvider(() => 0.5);
    const points = provider.generate({ x: 0, y: 0 }, { x: 500, y: 300 });

    expect(points.length).toBeGreaterThan(1);

    // First point should be near start
    expect(points[0].x).toBeCloseTo(0, -1);
    expect(points[0].y).toBeCloseTo(0, -1);

    // Last point should be exactly at end
    const last = points[points.length - 1];
    expect(last.x).toBe(500);
    expect(last.y).toBe(300);
  });

  it("returns single point for zero-distance move", () => {
    const provider = new FallbackMouseProvider(() => 0.5);
    const points = provider.generate({ x: 100, y: 200 }, { x: 100, y: 200 });

    expect(points).toHaveLength(1);
    expect(points[0].x).toBe(100);
    expect(points[0].y).toBe(200);
  });

  it("timestamps are monotonically increasing", () => {
    const provider = new FallbackMouseProvider(Math.random);
    const points = provider.generate({ x: 0, y: 0 }, { x: 800, y: 600 });

    for (let i = 1; i < points.length; i++) {
      expect(points[i].timestamp).toBeGreaterThanOrEqual(points[i - 1].timestamp);
    }
  });

  it("longer distances produce more points", () => {
    const rng = () => 0.5;
    const provider = new FallbackMouseProvider(rng);

    const short = provider.generate({ x: 0, y: 0 }, { x: 50, y: 0 });
    const long = provider.generate({ x: 0, y: 0 }, { x: 1000, y: 0 });

    expect(long.length).toBeGreaterThan(short.length);
  });

  it("longer distances produce longer total duration", () => {
    const rng = () => 0.5;
    const provider = new FallbackMouseProvider(rng);

    const short = provider.generate({ x: 0, y: 0 }, { x: 50, y: 0 });
    const long = provider.generate({ x: 0, y: 0 }, { x: 1000, y: 0 });

    const shortDuration = short[short.length - 1].timestamp;
    const longDuration = long[long.length - 1].timestamp;

    expect(longDuration).toBeGreaterThan(shortDuration);
  });
});

describe("FallbackKeyboardProvider", () => {
  it("generates keystroke events for text", () => {
    const provider = new FallbackKeyboardProvider(() => 0.5);
    const events = provider.generate("hello");

    // At minimum: h, e, l, l, o (may have more with typos/shift)
    expect(events.length).toBeGreaterThanOrEqual(5);

    // All events should have positive timing
    for (const event of events) {
      expect(event.holdTime).toBeGreaterThanOrEqual(0);
      expect(event.preDelay).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns empty array for empty text", () => {
    const provider = new FallbackKeyboardProvider(() => 0.5);
    const events = provider.generate("");
    expect(events).toHaveLength(0);
  });

  it("includes Shift events for uppercase characters", () => {
    const provider = new FallbackKeyboardProvider(() => 0.99); // high = no typos
    const events = provider.generate("Hi");

    const keys = events.map((e) => e.key);
    expect(keys).toContain("Shift");
    expect(keys).toContain("H");
    expect(keys).toContain("i");
  });

  it("produces positive pre-delays for all keystrokes", () => {
    const provider = new FallbackKeyboardProvider(Math.random);
    const events = provider.generate("The quick brown fox");

    for (const event of events) {
      expect(event.preDelay).toBeGreaterThan(0);
      expect(event.holdTime).toBeGreaterThanOrEqual(0);
    }
  });

  it("produces longer delays after sentence-ending punctuation", () => {
    // Use consistent random to compare
    const rng = () => 0.5;
    const provider = new FallbackKeyboardProvider(rng);

    const events = provider.generate("Hi. Bye");

    // Find the event after the period (space after '.')
    // Due to potential typo injection, find the space after period
    const periodIdx = events.findIndex((e) => e.key === ".");
    expect(periodIdx).toBeGreaterThanOrEqual(0);

    if (periodIdx + 1 < events.length) {
      const afterPeriod = events[periodIdx + 1];
      // The pre-delay after a period should be notably longer
      // than typical inter-key delays
      expect(afterPeriod.preDelay).toBeGreaterThan(100);
    }
  });
});
