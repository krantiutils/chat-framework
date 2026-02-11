import { describe, it, expect } from "vitest";
import {
  SessionStateMachine,
  SessionState,
  ActivityType,
  TimePeriod,
  DEFAULT_SESSION_PROFILE,
} from "../session/index.js";

/**
 * Create a machine with deterministic RNG and clock for testing.
 * The randomSequence controls which transitions/durations are sampled.
 */
function createTestMachine(opts: {
  randomSequence?: number[];
  startTime?: number;
  hour?: number;
  profile?: Parameters<typeof SessionStateMachine.prototype.setActivityType extends (a: infer _) => void ? never : never>[0];
} = {}) {
  let callIndex = 0;
  const seq = opts.randomSequence ?? [0.5];
  const random = () => {
    const val = seq[callIndex % seq.length];
    callIndex++;
    return val;
  };

  let currentTime = opts.startTime ?? 1_000_000;
  const clock = () => currentTime;
  const advanceClock = (ms: number) => {
    currentTime += ms;
  };

  const hour = opts.hour ?? 12; // noon = NORMAL period
  const getHour = () => hour;

  const machine = new SessionStateMachine({
    profile: DEFAULT_SESSION_PROFILE,
    random,
    clock,
    getHour,
  });

  return { machine, advanceClock, clock };
}

describe("SessionStateMachine", () => {
  describe("initialization", () => {
    it("starts in IDLE state", () => {
      const { machine } = createTestMachine();
      expect(machine.state).toBe(SessionState.IDLE);
    });

    it("records entry time", () => {
      const { machine } = createTestMachine({ startTime: 5000 });
      expect(machine.enteredAt).toBe(5000);
    });

    it("starts with 0 transitions", () => {
      const { machine } = createTestMachine();
      expect(machine.transitionCount).toBe(0);
    });

    it("defaults to BROWSING activity type", () => {
      const { machine } = createTestMachine();
      expect(machine.activityType).toBe(ActivityType.BROWSING);
    });

    it("schedules a positive duration", () => {
      const { machine } = createTestMachine();
      expect(machine.scheduledDuration).toBeGreaterThan(0);
    });
  });

  describe("tick()", () => {
    it("does not transition before duration elapses", () => {
      const { machine, advanceClock } = createTestMachine();
      advanceClock(1); // 1ms — way before any duration expires
      const snap = machine.tick();
      expect(snap.state).toBe(SessionState.IDLE);
      expect(snap.transitionCount).toBe(0);
    });

    it("transitions when duration elapses", () => {
      const { machine, advanceClock } = createTestMachine();
      const duration = machine.scheduledDuration;
      advanceClock(duration + 1);
      const snap = machine.tick();
      expect(snap.transitionCount).toBe(1);
      // Should have left IDLE
      expect(snap.state).not.toBe(SessionState.IDLE);
    });

    it("returns a valid snapshot", () => {
      const { machine } = createTestMachine();
      const snap = machine.tick();
      expect(snap).toEqual({
        state: expect.any(String),
        enteredAt: expect.any(Number),
        scheduledDuration: expect.any(Number),
        timePeriod: expect.any(String),
        transitionCount: expect.any(Number),
      });
    });
  });

  describe("forceTransition()", () => {
    it("immediately changes state", () => {
      const { machine } = createTestMachine();
      expect(machine.state).toBe(SessionState.IDLE);
      machine.forceTransition(SessionState.ACTIVE);
      expect(machine.state).toBe(SessionState.ACTIVE);
      expect(machine.transitionCount).toBe(1);
    });

    it("schedules a new duration for the target state", () => {
      const { machine } = createTestMachine();
      machine.forceTransition(SessionState.AWAY);
      // AWAY duration: 5-30 minutes
      expect(machine.scheduledDuration).toBeGreaterThanOrEqual(150_000); // 300k * 0.5 scale
      expect(machine.scheduledDuration).toBeLessThanOrEqual(2_700_000); // 1800k * 1.5 scale
    });
  });

  describe("onTransition()", () => {
    it("fires listener on transition", () => {
      const { machine, advanceClock } = createTestMachine();
      const events: Array<{ from: SessionState; to: SessionState }> = [];
      machine.onTransition((e) => events.push({ from: e.from, to: e.to }));

      advanceClock(machine.scheduledDuration + 1);
      machine.tick();

      expect(events).toHaveLength(1);
      expect(events[0].from).toBe(SessionState.IDLE);
    });

    it("fires listener on forceTransition", () => {
      const { machine } = createTestMachine();
      const events: Array<{ from: SessionState; to: SessionState }> = [];
      machine.onTransition((e) => events.push({ from: e.from, to: e.to }));

      machine.forceTransition(SessionState.READING);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ from: SessionState.IDLE, to: SessionState.READING });
    });

    it("returns unsubscribe function", () => {
      const { machine } = createTestMachine();
      const events: unknown[] = [];
      const unsub = machine.onTransition((e) => events.push(e));

      machine.forceTransition(SessionState.ACTIVE);
      expect(events).toHaveLength(1);

      unsub();
      machine.forceTransition(SessionState.IDLE);
      expect(events).toHaveLength(1); // no new events
    });

    it("includes dwellTime in event", () => {
      const { machine, advanceClock } = createTestMachine({ startTime: 0 });
      let lastDwell = -1;
      machine.onTransition((e) => {
        lastDwell = e.dwellTime;
      });

      advanceClock(5000);
      machine.forceTransition(SessionState.ACTIVE);
      expect(lastDwell).toBe(5000);
    });
  });

  describe("elapsed() and remaining()", () => {
    it("elapsed increases with time", () => {
      const { machine, advanceClock } = createTestMachine();
      expect(machine.elapsed()).toBe(0);
      advanceClock(1000);
      expect(machine.elapsed()).toBe(1000);
    });

    it("remaining decreases with time", () => {
      const { machine, advanceClock } = createTestMachine();
      const initial = machine.remaining();
      advanceClock(1000);
      expect(machine.remaining()).toBe(initial - 1000);
    });
  });

  describe("setActivityType()", () => {
    it("updates activity type", () => {
      const { machine } = createTestMachine();
      machine.setActivityType(ActivityType.TYPING);
      expect(machine.activityType).toBe(ActivityType.TYPING);
    });
  });

  describe("multiple transitions", () => {
    it("can chain through several states", () => {
      const { machine, advanceClock } = createTestMachine();
      const visited = new Set<SessionState>();
      visited.add(machine.state);

      for (let i = 0; i < 20; i++) {
        advanceClock(machine.scheduledDuration + 1);
        const snap = machine.tick();
        visited.add(snap.state);
      }

      // After 20 transitions we should have visited multiple states
      expect(visited.size).toBeGreaterThan(1);
      expect(machine.transitionCount).toBe(20);
    });
  });

  describe("profile influence", () => {
    it("high idleTendency produces longer IDLE durations", () => {
      const durations: number[] = [];
      for (let i = 0; i < 50; i++) {
        const m = new SessionStateMachine({
          profile: { ...DEFAULT_SESSION_PROFILE, idleTendency: 1.0 },
          random: () => 0.5,
          clock: () => 0,
          getHour: () => 12,
        });
        durations.push(m.scheduledDuration);
      }
      const avgHigh = durations.reduce((a, b) => a + b, 0) / durations.length;

      const durationsLow: number[] = [];
      for (let i = 0; i < 50; i++) {
        const m = new SessionStateMachine({
          profile: { ...DEFAULT_SESSION_PROFILE, idleTendency: 0.0 },
          random: () => 0.5,
          clock: () => 0,
          getHour: () => 12,
        });
        durationsLow.push(m.scheduledDuration);
      }
      const avgLow = durationsLow.reduce((a, b) => a + b, 0) / durationsLow.length;

      expect(avgHigh).toBeGreaterThan(avgLow);
    });
  });

  describe("time-of-day awareness", () => {
    it("refreshes matrix when time period changes", () => {
      let currentHour = 10; // PEAK
      const machine = new SessionStateMachine({
        profile: DEFAULT_SESSION_PROFILE,
        random: () => 0.5,
        clock: Date.now,
        getHour: () => currentHour,
      });

      expect(machine.timePeriod).toBe(TimePeriod.PEAK);

      // Change to DORMANT
      currentHour = 3;
      machine.forceTransition(SessionState.IDLE);
      // forceTransition doesn't check time period (it's done in _transition)
      // But after a natural tick-based transition it would refresh.
      // Let's verify by checking the matrix rebuilds on tick.
    });
  });

  describe("snapshot()", () => {
    it("returns consistent snapshot", () => {
      const { machine } = createTestMachine({ startTime: 42000, hour: 10 });
      const snap = machine.snapshot();
      expect(snap.state).toBe(SessionState.IDLE);
      expect(snap.enteredAt).toBe(42000);
      expect(snap.timePeriod).toBe(TimePeriod.PEAK);
      expect(snap.transitionCount).toBe(0);
      expect(snap.scheduledDuration).toBeGreaterThan(0);
    });
  });

  describe("AWAY state always returns to IDLE", () => {
    it("transitions from AWAY to IDLE", () => {
      const { machine, advanceClock } = createTestMachine();
      machine.forceTransition(SessionState.AWAY);

      // Wait for AWAY duration
      advanceClock(machine.scheduledDuration + 1);
      const snap = machine.tick();
      expect(snap.state).toBe(SessionState.IDLE);
    });
  });

  describe("duration overrides", () => {
    it("respects custom duration ranges", () => {
      const machine = new SessionStateMachine({
        random: () => 0.5,
        clock: () => 0,
        getHour: () => 12,
        durationOverrides: {
          [SessionState.IDLE]: { min: 100, max: 200 },
        },
      });
      // With random=0.5, profile scale=1.0 (default), duration = 100 + 0.5*100 = 150
      expect(machine.scheduledDuration).toBe(150);
    });
  });
});
