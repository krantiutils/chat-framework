import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SessionStateMachine,
  getTimeOfDay,
  DEFAULT_DURATIONS,
  DEFAULT_TRANSITIONS,
  DEFAULT_TIME_MODIFIERS,
} from "../../src/index.js";
import type {
  SessionState,
  StateTransition,
} from "../../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a deterministic RNG that returns values from the provided sequence,
 * cycling if the sequence is exhausted.
 */
function seededRng(values: number[]): () => number {
  let idx = 0;
  return () => {
    const v = values[idx % values.length]!;
    idx++;
    return v;
  };
}

/** Fixed clock returning the given date. */
function fixedClock(date: Date): () => Date {
  return () => date;
}

/** Advancing clock: starts at `start` and increments by `stepMs` on each call. */
function advancingClock(start: Date, stepMs: number): () => Date {
  let ts = start.getTime();
  return () => {
    const d = new Date(ts);
    ts += stepMs;
    return d;
  };
}

// ---------------------------------------------------------------------------
// getTimeOfDay
// ---------------------------------------------------------------------------

describe("getTimeOfDay", () => {
  it.each([
    [new Date("2026-01-15T06:00:00"), "MORNING"],
    [new Date("2026-01-15T11:59:00"), "MORNING"],
    [new Date("2026-01-15T12:00:00"), "AFTERNOON"],
    [new Date("2026-01-15T17:59:00"), "AFTERNOON"],
    [new Date("2026-01-15T18:00:00"), "EVENING"],
    [new Date("2026-01-15T22:59:00"), "EVENING"],
    [new Date("2026-01-15T23:00:00"), "NIGHT"],
    [new Date("2026-01-15T03:00:00"), "NIGHT"],
    [new Date("2026-01-15T05:59:00"), "NIGHT"],
  ] as const)("returns %s for %s", (date, expected) => {
    expect(getTimeOfDay(date)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Construction & defaults
// ---------------------------------------------------------------------------

describe("SessionStateMachine — construction", () => {
  it("starts in IDLE by default", () => {
    const sm = new SessionStateMachine();
    expect(sm.state).toBe("IDLE");
  });

  it("respects initialState option", () => {
    const sm = new SessionStateMachine({ initialState: "ACTIVE" });
    expect(sm.state).toBe("ACTIVE");
  });

  it("is not running after construction", () => {
    const sm = new SessionStateMachine();
    expect(sm.running).toBe(false);
  });

  it("throws on invalid duration range (negative minMs)", () => {
    expect(
      () =>
        new SessionStateMachine({
          profile: { durations: { IDLE: { minMs: -1, maxMs: 100 } } },
        }),
    ).toThrow("minMs must be >= 0");
  });

  it("throws on invalid duration range (maxMs < minMs)", () => {
    expect(
      () =>
        new SessionStateMachine({
          profile: { durations: { IDLE: { minMs: 200, maxMs: 100 } } },
        }),
    ).toThrow("maxMs (100) must be >= minMs (200)");
  });

  it("throws on transition edge with negative weight", () => {
    expect(
      () =>
        new SessionStateMachine({
          profile: {
            transitions: {
              IDLE: [{ target: "ACTIVE", weight: -5 }],
            },
          },
        }),
    ).toThrow('weight must be >= 0');
  });

  it("throws on empty transition edges for a state", () => {
    expect(
      () =>
        new SessionStateMachine({
          profile: { transitions: { IDLE: [] } },
        }),
    ).toThrow('has no outgoing transitions');
  });

  it("throws on transition edges with all-zero weights", () => {
    expect(
      () =>
        new SessionStateMachine({
          profile: {
            transitions: {
              IDLE: [
                { target: "ACTIVE", weight: 0 },
                { target: "AWAY", weight: 0 },
              ],
            },
          },
        }),
    ).toThrow("total transition weight must be > 0");
  });
});

// ---------------------------------------------------------------------------
// Manual tick()
// ---------------------------------------------------------------------------

describe("SessionStateMachine — tick()", () => {
  it("transitions from IDLE to a valid next state", () => {
    // RNG=0.0 should pick the first edge (ACTIVE, weight 60)
    const sm = new SessionStateMachine({
      random: seededRng([0.0]),
      clock: advancingClock(new Date("2026-01-15T10:00:00"), 5000),
    });

    const t = sm.tick();
    expect(t.from).toBe("IDLE");
    expect(t.to).toBe("ACTIVE");
    expect(sm.state).toBe("ACTIVE");
  });

  it("emits correct dwellMs based on clock", () => {
    // Use a controllable clock that we can advance manually.
    let now = new Date("2026-01-15T10:00:00").getTime();
    const clock = () => new Date(now);

    const sm = new SessionStateMachine({
      random: seededRng([0.0]),
      clock,
    });

    // Advance wall-clock by 7 seconds before ticking.
    now += 7000;
    const t = sm.tick();
    expect(t.dwellMs).toBe(7000);
  });

  it("runs a chain of transitions", () => {
    const sm = new SessionStateMachine({
      random: seededRng([0.0]),
      clock: advancingClock(new Date("2026-01-15T10:00:00"), 1000),
    });

    const states: SessionState[] = [sm.state];
    for (let i = 0; i < 20; i++) {
      sm.tick();
      states.push(sm.state);
    }

    // Every state in the sequence is valid.
    const valid: Set<SessionState> = new Set([
      "IDLE",
      "ACTIVE",
      "READING",
      "THINKING",
      "AWAY",
      "SCROLLING",
    ]);
    for (const s of states) {
      expect(valid.has(s)).toBe(true);
    }
  });

  it("throws when called while running", () => {
    const sm = new SessionStateMachine();
    sm.start();
    expect(() => sm.tick()).toThrow("Cannot manually tick()");
    sm.stop();
  });
});

// ---------------------------------------------------------------------------
// Probabilistic distribution
// ---------------------------------------------------------------------------

describe("SessionStateMachine — probabilistic transitions", () => {
  it("respects transition weights over many samples", () => {
    // Generate many random values and collect transition counts from IDLE.
    // IDLE edges: ACTIVE(60), AWAY(25), SCROLLING(15)
    const counts: Record<string, number> = {};
    const N = 10_000;

    for (let i = 0; i < N; i++) {
      const sm = new SessionStateMachine({
        random: () => Math.random(),
        clock: advancingClock(new Date("2026-01-15T14:00:00"), 1000), // AFTERNOON
      });
      sm.tick();
      counts[sm.state] = (counts[sm.state] ?? 0) + 1;
    }

    const total = N;
    const activePct = (counts["ACTIVE"] ?? 0) / total;
    const awayPct = (counts["AWAY"] ?? 0) / total;
    const scrollPct = (counts["SCROLLING"] ?? 0) / total;

    // Expected: ~60%, ~25%, ~15% (AFTERNOON modifiers: ACTIVE 1.0, AWAY 0.8)
    // After normalization: ACTIVE=60, AWAY=20, SCROLLING=15 → total=95
    // ACTIVE≈63%, AWAY≈21%, SCROLLING≈16%
    expect(activePct).toBeGreaterThan(0.5);
    expect(activePct).toBeLessThan(0.75);
    expect(awayPct).toBeGreaterThan(0.1);
    expect(awayPct).toBeLessThan(0.35);
    expect(scrollPct).toBeGreaterThan(0.05);
    expect(scrollPct).toBeLessThan(0.3);
  });
});

// ---------------------------------------------------------------------------
// Time-of-day modifiers
// ---------------------------------------------------------------------------

describe("SessionStateMachine — time-of-day modifiers", () => {
  it("NIGHT modifiers heavily favour AWAY from IDLE", () => {
    // At night: ACTIVE weight 60*0.4=24, AWAY 25*2.5=62.5, SCROLLING 15*0.5=7.5
    const counts: Record<string, number> = {};
    const N = 5_000;

    for (let i = 0; i < N; i++) {
      const sm = new SessionStateMachine({
        random: () => Math.random(),
        clock: fixedClock(new Date("2026-01-15T02:00:00")), // NIGHT
      });
      sm.tick();
      counts[sm.state] = (counts[sm.state] ?? 0) + 1;
    }

    // AWAY should dominate: 62.5/(24+62.5+7.5) ≈ 66%
    const awayPct = (counts["AWAY"] ?? 0) / N;
    expect(awayPct).toBeGreaterThan(0.5);
  });

  it("custom time modifier overrides defaults", () => {
    // Force NIGHT ACTIVE multiplier to 10, suppressing everything else.
    const sm = new SessionStateMachine({
      profile: {
        timeModifiers: {
          NIGHT: { ACTIVE: 10, AWAY: 0.01, SCROLLING: 0.01 },
        },
      },
      random: seededRng([0.0]),
      clock: fixedClock(new Date("2026-01-15T02:00:00")), // NIGHT
    });

    sm.tick();
    expect(sm.state).toBe("ACTIVE");
  });
});

// ---------------------------------------------------------------------------
// forceTransition
// ---------------------------------------------------------------------------

describe("SessionStateMachine — forceTransition()", () => {
  it("forces transition to specified state", () => {
    const sm = new SessionStateMachine({
      clock: advancingClock(new Date("2026-01-15T10:00:00"), 3000),
    });

    const t = sm.forceTransition("READING");
    expect(t.from).toBe("IDLE");
    expect(t.to).toBe("READING");
    expect(t.dwellMs).toBe(3000);
    expect(sm.state).toBe("READING");
  });

  it("can force transition while timer loop is running", () => {
    const sm = new SessionStateMachine({
      clock: advancingClock(new Date("2026-01-15T10:00:00"), 100),
    });
    sm.start();
    const t = sm.forceTransition("AWAY");
    expect(t.to).toBe("AWAY");
    expect(sm.state).toBe("AWAY");
    sm.stop();
  });
});

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

describe("SessionStateMachine — onTransition()", () => {
  it("fires listener on tick", () => {
    const sm = new SessionStateMachine({
      random: seededRng([0.0]),
      clock: advancingClock(new Date("2026-01-15T10:00:00"), 1000),
    });

    const transitions: StateTransition[] = [];
    sm.onTransition((t) => transitions.push(t));

    sm.tick();
    sm.tick();

    expect(transitions).toHaveLength(2);
    expect(transitions[0]!.from).toBe("IDLE");
  });

  it("fires listener on forceTransition", () => {
    const sm = new SessionStateMachine();
    const transitions: StateTransition[] = [];
    sm.onTransition((t) => transitions.push(t));

    sm.forceTransition("THINKING");

    expect(transitions).toHaveLength(1);
    expect(transitions[0]!.to).toBe("THINKING");
  });

  it("unsubscribe stops further notifications", () => {
    const sm = new SessionStateMachine({
      random: seededRng([0.0]),
      clock: advancingClock(new Date("2026-01-15T10:00:00"), 1000),
    });

    const transitions: StateTransition[] = [];
    const unsub = sm.onTransition((t) => transitions.push(t));

    sm.tick();
    unsub();
    sm.tick();

    expect(transitions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Timer loop (start/stop)
// ---------------------------------------------------------------------------

describe("SessionStateMachine — start() / stop()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("auto-transitions after dwell time elapses", () => {
    const sm = new SessionStateMachine({
      random: seededRng([0.0]),
      profile: {
        // Fix all durations to 100ms for predictability.
        durations: {
          IDLE: { minMs: 100, maxMs: 100 },
          ACTIVE: { minMs: 100, maxMs: 100 },
          READING: { minMs: 100, maxMs: 100 },
          THINKING: { minMs: 100, maxMs: 100 },
          AWAY: { minMs: 100, maxMs: 100 },
          SCROLLING: { minMs: 100, maxMs: 100 },
        },
      },
    });

    const transitions: StateTransition[] = [];
    sm.onTransition((t) => transitions.push(t));

    sm.start();
    expect(transitions).toHaveLength(0);

    vi.advanceTimersByTime(100);
    expect(transitions).toHaveLength(1);

    vi.advanceTimersByTime(100);
    expect(transitions).toHaveLength(2);

    sm.stop();

    // No more transitions after stop.
    vi.advanceTimersByTime(1000);
    expect(transitions).toHaveLength(2);
  });

  it("start() is idempotent", () => {
    const sm = new SessionStateMachine({
      profile: {
        durations: {
          IDLE: { minMs: 100, maxMs: 100 },
          ACTIVE: { minMs: 100, maxMs: 100 },
          READING: { minMs: 100, maxMs: 100 },
          THINKING: { minMs: 100, maxMs: 100 },
          AWAY: { minMs: 100, maxMs: 100 },
          SCROLLING: { minMs: 100, maxMs: 100 },
        },
      },
    });

    sm.start();
    sm.start(); // should not double-schedule

    const transitions: StateTransition[] = [];
    sm.onTransition((t) => transitions.push(t));

    vi.advanceTimersByTime(100);
    expect(transitions).toHaveLength(1);

    sm.stop();
  });

  it("stop() is idempotent", () => {
    const sm = new SessionStateMachine();
    sm.stop(); // no-op
    sm.start();
    sm.stop();
    sm.stop(); // no-op
    expect(sm.running).toBe(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Profile overrides
// ---------------------------------------------------------------------------

describe("SessionStateMachine — profile overrides", () => {
  it("custom transitions are used", () => {
    const sm = new SessionStateMachine({
      initialState: "IDLE",
      profile: {
        transitions: {
          IDLE: [{ target: "SCROLLING", weight: 100 }],
        },
      },
      random: seededRng([0.5]),
      clock: advancingClock(new Date("2026-01-15T14:00:00"), 1000),
    });

    sm.tick();
    expect(sm.state).toBe("SCROLLING");
  });

  it("custom durations are respected in timer loop", () => {
    vi.useFakeTimers();

    const sm = new SessionStateMachine({
      profile: {
        durations: {
          IDLE: { minMs: 50, maxMs: 50 },
          ACTIVE: { minMs: 50, maxMs: 50 },
          READING: { minMs: 50, maxMs: 50 },
          THINKING: { minMs: 50, maxMs: 50 },
          AWAY: { minMs: 50, maxMs: 50 },
          SCROLLING: { minMs: 50, maxMs: 50 },
        },
      },
    });

    const transitions: StateTransition[] = [];
    sm.onTransition((t) => transitions.push(t));
    sm.start();

    // At 49ms nothing should have fired.
    vi.advanceTimersByTime(49);
    expect(transitions).toHaveLength(0);

    // At 50ms the first transition fires.
    vi.advanceTimersByTime(1);
    expect(transitions).toHaveLength(1);

    sm.stop();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// dwellMs query
// ---------------------------------------------------------------------------

describe("SessionStateMachine — dwellMs", () => {
  it("reports how long the machine has been in current state", () => {
    let now = new Date("2026-01-15T10:00:00").getTime();
    const clock = () => new Date(now);

    const sm = new SessionStateMachine({ clock });

    expect(sm.dwellMs).toBe(0);

    now += 5000;
    expect(sm.dwellMs).toBe(5000);

    // Force transition resets dwell.
    sm.forceTransition("ACTIVE");
    expect(sm.dwellMs).toBe(0);

    now += 3000;
    expect(sm.dwellMs).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("SessionStateMachine — edge cases", () => {
  it("handles self-transitions if configured", () => {
    const sm = new SessionStateMachine({
      profile: {
        transitions: {
          IDLE: [{ target: "IDLE", weight: 100 }],
        },
      },
      random: seededRng([0.5]),
      clock: advancingClock(new Date("2026-01-15T10:00:00"), 1000),
    });

    const t = sm.tick();
    expect(t.from).toBe("IDLE");
    expect(t.to).toBe("IDLE");
    expect(sm.state).toBe("IDLE");
  });

  it("falls back to raw weights when all time-modified weights become zero", () => {
    const sm = new SessionStateMachine({
      profile: {
        timeModifiers: {
          NIGHT: {
            ACTIVE: 0,
            AWAY: 0,
            SCROLLING: 0,
          },
        },
      },
      random: seededRng([0.0]),
      clock: fixedClock(new Date("2026-01-15T02:00:00")), // NIGHT
      initialState: "IDLE",
    });

    // Should not throw — falls back to unmodified weights.
    const t = sm.tick();
    expect(["ACTIVE", "AWAY", "SCROLLING"]).toContain(t.to);
  });

  it("every default state has at least one outgoing transition", () => {
    const states: SessionState[] = [
      "IDLE",
      "ACTIVE",
      "READING",
      "THINKING",
      "AWAY",
      "SCROLLING",
    ];
    for (const s of states) {
      expect(DEFAULT_TRANSITIONS[s].length).toBeGreaterThan(0);
    }
  });

  it("every default state has valid duration ranges", () => {
    const states: SessionState[] = [
      "IDLE",
      "ACTIVE",
      "READING",
      "THINKING",
      "AWAY",
      "SCROLLING",
    ];
    for (const s of states) {
      const d = DEFAULT_DURATIONS[s];
      expect(d.minMs).toBeGreaterThanOrEqual(0);
      expect(d.maxMs).toBeGreaterThanOrEqual(d.minMs);
    }
  });

  it("DEFAULT_TIME_MODIFIERS covers all four periods", () => {
    expect(DEFAULT_TIME_MODIFIERS).toHaveProperty("MORNING");
    expect(DEFAULT_TIME_MODIFIERS).toHaveProperty("AFTERNOON");
    expect(DEFAULT_TIME_MODIFIERS).toHaveProperty("EVENING");
    expect(DEFAULT_TIME_MODIFIERS).toHaveProperty("NIGHT");
  });
});

// ---------------------------------------------------------------------------
// Transition graph reachability
// ---------------------------------------------------------------------------

describe("SessionStateMachine — reachability", () => {
  it("all states are reachable from IDLE within 100 ticks", () => {
    const visited = new Set<SessionState>();
    // Run multiple trials to handle probabilistic nature.
    for (let trial = 0; trial < 50; trial++) {
      const sm = new SessionStateMachine({
        clock: advancingClock(new Date("2026-01-15T10:00:00"), 1000),
      });
      visited.add(sm.state);
      for (let i = 0; i < 100; i++) {
        sm.tick();
        visited.add(sm.state);
      }
    }

    expect(visited.size).toBe(6);
    expect(visited.has("IDLE")).toBe(true);
    expect(visited.has("ACTIVE")).toBe(true);
    expect(visited.has("READING")).toBe(true);
    expect(visited.has("THINKING")).toBe(true);
    expect(visited.has("AWAY")).toBe(true);
    expect(visited.has("SCROLLING")).toBe(true);
  });
});
