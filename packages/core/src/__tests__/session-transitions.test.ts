import { describe, it, expect } from "vitest";
import {
  SessionState,
  ALL_STATES,
  TimePeriod,
  ActivityType,
  getTimePeriod,
  buildTransitionMatrix,
  normalizeRow,
  sampleTransition,
  DEFAULT_SESSION_PROFILE,
} from "../session/index.js";
import type { TransitionRow } from "../session/index.js";

describe("transitions", () => {
  describe("getTimePeriod", () => {
    it("returns PEAK for 9am-12pm", () => {
      expect(getTimePeriod(9)).toBe(TimePeriod.PEAK);
      expect(getTimePeriod(10)).toBe(TimePeriod.PEAK);
      expect(getTimePeriod(11)).toBe(TimePeriod.PEAK);
    });

    it("returns PEAK for 2pm-6pm", () => {
      expect(getTimePeriod(14)).toBe(TimePeriod.PEAK);
      expect(getTimePeriod(15)).toBe(TimePeriod.PEAK);
      expect(getTimePeriod(17)).toBe(TimePeriod.PEAK);
    });

    it("returns NORMAL for 12pm-2pm", () => {
      expect(getTimePeriod(12)).toBe(TimePeriod.NORMAL);
      expect(getTimePeriod(13)).toBe(TimePeriod.NORMAL);
    });

    it("returns NORMAL for 6pm-9pm", () => {
      expect(getTimePeriod(18)).toBe(TimePeriod.NORMAL);
      expect(getTimePeriod(19)).toBe(TimePeriod.NORMAL);
      expect(getTimePeriod(20)).toBe(TimePeriod.NORMAL);
    });

    it("returns LOW for 9pm-1am", () => {
      expect(getTimePeriod(21)).toBe(TimePeriod.LOW);
      expect(getTimePeriod(22)).toBe(TimePeriod.LOW);
      expect(getTimePeriod(23)).toBe(TimePeriod.LOW);
      expect(getTimePeriod(0)).toBe(TimePeriod.LOW);
    });

    it("returns DORMANT for 1am-9am", () => {
      expect(getTimePeriod(1)).toBe(TimePeriod.DORMANT);
      expect(getTimePeriod(4)).toBe(TimePeriod.DORMANT);
      expect(getTimePeriod(8)).toBe(TimePeriod.DORMANT);
    });
  });

  describe("normalizeRow", () => {
    it("normalizes probabilities to sum to 1", () => {
      const row: TransitionRow = {
        [SessionState.IDLE]: 2,
        [SessionState.ACTIVE]: 3,
        [SessionState.READING]: 0,
        [SessionState.THINKING]: 0,
        [SessionState.AWAY]: 5,
        [SessionState.SCROLLING]: 0,
      };
      const normalized = normalizeRow(row, SessionState.THINKING);
      const sum = ALL_STATES.reduce((s, st) => s + normalized[st], 0);
      expect(sum).toBeCloseTo(1.0, 10);
      expect(normalized[SessionState.IDLE]).toBeCloseTo(0.2, 10);
      expect(normalized[SessionState.ACTIVE]).toBeCloseTo(0.3, 10);
      expect(normalized[SessionState.AWAY]).toBeCloseTo(0.5, 10);
    });

    it("handles all-zero row with uniform fallback", () => {
      const row: TransitionRow = {
        [SessionState.IDLE]: 0,
        [SessionState.ACTIVE]: 0,
        [SessionState.READING]: 0,
        [SessionState.THINKING]: 0,
        [SessionState.AWAY]: 0,
        [SessionState.SCROLLING]: 0,
      };
      const normalized = normalizeRow(row, SessionState.IDLE);
      const sum = ALL_STATES.reduce((s, st) => s + normalized[st], 0);
      expect(sum).toBeCloseTo(1.0, 10);
      expect(normalized[SessionState.IDLE]).toBe(0); // self-transition excluded
    });
  });

  describe("buildTransitionMatrix", () => {
    it("produces a valid stochastic matrix for every time period", () => {
      for (const period of Object.values(TimePeriod)) {
        const matrix = buildTransitionMatrix(period, DEFAULT_SESSION_PROFILE);
        for (const fromState of ALL_STATES) {
          const row = matrix[fromState];
          const sum = ALL_STATES.reduce((s, st) => s + row[st], 0);
          expect(sum).toBeCloseTo(1.0, 6);
          // All probabilities non-negative
          for (const st of ALL_STATES) {
            expect(row[st]).toBeGreaterThanOrEqual(0);
          }
        }
      }
    });

    it("AWAY always transitions to IDLE", () => {
      for (const period of Object.values(TimePeriod)) {
        const matrix = buildTransitionMatrix(period, DEFAULT_SESSION_PROFILE);
        expect(matrix[SessionState.AWAY][SessionState.IDLE]).toBeCloseTo(1.0, 6);
      }
    });

    it("DORMANT increases AWAY probability from IDLE", () => {
      const normal = buildTransitionMatrix(TimePeriod.NORMAL, DEFAULT_SESSION_PROFILE);
      const dormant = buildTransitionMatrix(TimePeriod.DORMANT, DEFAULT_SESSION_PROFILE);
      expect(dormant[SessionState.IDLE][SessionState.AWAY]).toBeGreaterThan(
        normal[SessionState.IDLE][SessionState.AWAY],
      );
    });

    it("PEAK decreases AWAY probability from IDLE", () => {
      const normal = buildTransitionMatrix(TimePeriod.NORMAL, DEFAULT_SESSION_PROFILE);
      const peak = buildTransitionMatrix(TimePeriod.PEAK, DEFAULT_SESSION_PROFILE);
      expect(peak[SessionState.IDLE][SessionState.AWAY]).toBeLessThan(
        normal[SessionState.IDLE][SessionState.AWAY],
      );
    });

    it("high afkProneness increases AWAY transitions", () => {
      const lowAfk = buildTransitionMatrix(TimePeriod.NORMAL, {
        ...DEFAULT_SESSION_PROFILE,
        afkProneness: 0.1,
      });
      const highAfk = buildTransitionMatrix(TimePeriod.NORMAL, {
        ...DEFAULT_SESSION_PROFILE,
        afkProneness: 0.9,
      });
      // IDLE → AWAY should be higher for high AFK
      expect(highAfk[SessionState.IDLE][SessionState.AWAY]).toBeGreaterThan(
        lowAfk[SessionState.IDLE][SessionState.AWAY],
      );
    });

    it("TYPING activity biases ACTIVE→READING higher than BROWSING", () => {
      const typing = buildTransitionMatrix(
        TimePeriod.NORMAL,
        DEFAULT_SESSION_PROFILE,
        ActivityType.TYPING,
      );
      const browsing = buildTransitionMatrix(
        TimePeriod.NORMAL,
        DEFAULT_SESSION_PROFILE,
        ActivityType.BROWSING,
      );
      expect(typing[SessionState.ACTIVE][SessionState.READING]).toBeGreaterThan(
        browsing[SessionState.ACTIVE][SessionState.READING],
      );
    });

    it("WAITING activity biases IDLE→ACTIVE lower than BROWSING", () => {
      const waiting = buildTransitionMatrix(
        TimePeriod.NORMAL,
        DEFAULT_SESSION_PROFILE,
        ActivityType.WAITING,
      );
      const browsing = buildTransitionMatrix(
        TimePeriod.NORMAL,
        DEFAULT_SESSION_PROFILE,
        ActivityType.BROWSING,
      );
      expect(waiting[SessionState.IDLE][SessionState.ACTIVE]).toBeLessThan(
        browsing[SessionState.IDLE][SessionState.ACTIVE],
      );
    });

    it("activity type produces valid stochastic matrix", () => {
      for (const activity of Object.values(ActivityType)) {
        const matrix = buildTransitionMatrix(TimePeriod.NORMAL, DEFAULT_SESSION_PROFILE, activity);
        for (const fromState of ALL_STATES) {
          const row = matrix[fromState];
          const sum = ALL_STATES.reduce((s, st) => s + row[st], 0);
          expect(sum).toBeCloseTo(1.0, 6);
        }
      }
    });
  });

  describe("sampleTransition", () => {
    it("returns first non-zero state for random=0", () => {
      const row: TransitionRow = {
        [SessionState.IDLE]: 0,
        [SessionState.ACTIVE]: 0.5,
        [SessionState.READING]: 0.5,
        [SessionState.THINKING]: 0,
        [SessionState.AWAY]: 0,
        [SessionState.SCROLLING]: 0,
      };
      expect(sampleTransition(row, 0)).toBe(SessionState.ACTIVE);
    });

    it("returns last state for random approaching 1", () => {
      const row: TransitionRow = {
        [SessionState.IDLE]: 0,
        [SessionState.ACTIVE]: 0.5,
        [SessionState.READING]: 0,
        [SessionState.THINKING]: 0,
        [SessionState.AWAY]: 0,
        [SessionState.SCROLLING]: 0.5,
      };
      expect(sampleTransition(row, 0.99)).toBe(SessionState.SCROLLING);
    });

    it("respects cumulative distribution", () => {
      const row: TransitionRow = {
        [SessionState.IDLE]: 0.1,
        [SessionState.ACTIVE]: 0.2,
        [SessionState.READING]: 0.3,
        [SessionState.THINKING]: 0.15,
        [SessionState.AWAY]: 0.15,
        [SessionState.SCROLLING]: 0.1,
      };
      // random=0.05 → IDLE (cumulative 0.1)
      expect(sampleTransition(row, 0.05)).toBe(SessionState.IDLE);
      // random=0.15 → ACTIVE (cumulative 0.3)
      expect(sampleTransition(row, 0.15)).toBe(SessionState.ACTIVE);
      // random=0.55 → READING (cumulative 0.6)
      expect(sampleTransition(row, 0.55)).toBe(SessionState.READING);
    });
  });
});
