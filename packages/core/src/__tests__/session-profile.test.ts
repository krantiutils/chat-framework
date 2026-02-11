import { describe, it, expect } from "vitest";
import {
  DEFAULT_SESSION_PROFILE,
  clampProfileValue,
  validateProfile,
} from "../session/profile.js";

describe("SessionProfile", () => {
  describe("DEFAULT_SESSION_PROFILE", () => {
    it("has all values at 0.5", () => {
      for (const value of Object.values(DEFAULT_SESSION_PROFILE)) {
        expect(value).toBe(0.5);
      }
    });

    it("has all 6 profile dimensions", () => {
      expect(Object.keys(DEFAULT_SESSION_PROFILE)).toHaveLength(6);
    });
  });

  describe("clampProfileValue", () => {
    it("clamps values below 0", () => {
      expect(clampProfileValue(-0.5)).toBe(0);
      expect(clampProfileValue(-100)).toBe(0);
    });

    it("clamps values above 1", () => {
      expect(clampProfileValue(1.5)).toBe(1);
      expect(clampProfileValue(100)).toBe(1);
    });

    it("preserves values in [0, 1]", () => {
      expect(clampProfileValue(0)).toBe(0);
      expect(clampProfileValue(0.5)).toBe(0.5);
      expect(clampProfileValue(1)).toBe(1);
    });
  });

  describe("validateProfile", () => {
    it("passes through a valid profile", () => {
      const profile = { ...DEFAULT_SESSION_PROFILE, idleTendency: 0.8 };
      const result = validateProfile(profile);
      expect(result.idleTendency).toBe(0.8);
    });

    it("clamps out-of-range values", () => {
      const profile = { ...DEFAULT_SESSION_PROFILE, afkProneness: 1.5 };
      const result = validateProfile(profile);
      expect(result.afkProneness).toBe(1);
    });

    it("throws on NaN", () => {
      const profile = { ...DEFAULT_SESSION_PROFILE, readingSpeed: NaN };
      expect(() => validateProfile(profile)).toThrow("readingSpeed is NaN");
    });
  });
});
