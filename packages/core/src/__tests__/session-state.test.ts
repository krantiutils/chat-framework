import { describe, it, expect } from "vitest";
import {
  SessionState,
  ALL_STATES,
  BASE_DURATION_RANGES,
} from "../session/state.js";

describe("SessionState", () => {
  it("has exactly 6 states", () => {
    expect(ALL_STATES).toHaveLength(6);
  });

  it("contains all expected states", () => {
    expect(ALL_STATES).toContain(SessionState.IDLE);
    expect(ALL_STATES).toContain(SessionState.ACTIVE);
    expect(ALL_STATES).toContain(SessionState.READING);
    expect(ALL_STATES).toContain(SessionState.THINKING);
    expect(ALL_STATES).toContain(SessionState.AWAY);
    expect(ALL_STATES).toContain(SessionState.SCROLLING);
  });

  it("has duration ranges for every state", () => {
    for (const state of ALL_STATES) {
      const range = BASE_DURATION_RANGES[state];
      expect(range).toBeDefined();
      expect(range.min).toBeGreaterThan(0);
      expect(range.max).toBeGreaterThan(range.min);
    }
  });

  it("IDLE duration is 2-30 seconds", () => {
    expect(BASE_DURATION_RANGES[SessionState.IDLE].min).toBe(2_000);
    expect(BASE_DURATION_RANGES[SessionState.IDLE].max).toBe(30_000);
  });

  it("AWAY duration is 5-30 minutes", () => {
    expect(BASE_DURATION_RANGES[SessionState.AWAY].min).toBe(300_000);
    expect(BASE_DURATION_RANGES[SessionState.AWAY].max).toBe(1_800_000);
  });
});
