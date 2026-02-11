import { describe, it, expect } from "vitest";
import {
  encodeCharIds,
  sampleLatentVector,
  normalizeCoords,
  validateLatentVector,
  validatePoint,
} from "../preprocessing.js";
import { InputValidationError } from "../errors.js";

describe("encodeCharIds", () => {
  it("encodes ASCII characters correctly", () => {
    const ids = encodeCharIds("abc", 10, 128);
    expect(ids[0]).toBe(97n); // 'a'
    expect(ids[1]).toBe(98n); // 'b'
    expect(ids[2]).toBe(99n); // 'c'
  });

  it("pads with zeros beyond text length", () => {
    const ids = encodeCharIds("ab", 5, 128);
    expect(ids[2]).toBe(0n);
    expect(ids[3]).toBe(0n);
    expect(ids[4]).toBe(0n);
  });

  it("applies modulo for vocabSize", () => {
    // char code 200 % 128 = 72
    const text = String.fromCharCode(200);
    const ids = encodeCharIds(text, 5, 128);
    expect(ids[0]).toBe(72n);
  });

  it("throws on empty text", () => {
    expect(() => encodeCharIds("", 10, 128)).toThrow(InputValidationError);
    expect(() => encodeCharIds("", 10, 128)).toThrow("Text must not be empty");
  });

  it("throws when text exceeds maxLength", () => {
    expect(() => encodeCharIds("abcdef", 3, 128)).toThrow(InputValidationError);
    expect(() => encodeCharIds("abcdef", 3, 128)).toThrow("exceeds maximum");
  });

  it("handles text at exactly maxLength", () => {
    const ids = encodeCharIds("abc", 3, 128);
    expect(ids.length).toBe(3);
    expect(ids[0]).toBe(97n);
  });

  it("returns BigInt64Array", () => {
    const ids = encodeCharIds("a", 5, 128);
    expect(ids).toBeInstanceOf(BigInt64Array);
  });
});

describe("sampleLatentVector", () => {
  it("returns Float32Array of correct dimension", () => {
    const z = sampleLatentVector(64);
    expect(z).toBeInstanceOf(Float32Array);
    expect(z.length).toBe(64);
  });

  it("returns finite values", () => {
    const z = sampleLatentVector(64);
    for (let i = 0; i < z.length; i++) {
      expect(Number.isFinite(z[i])).toBe(true);
    }
  });

  it("produces roughly standard normal distribution", () => {
    // Sample large vector and check mean/variance are reasonable
    const z = sampleLatentVector(10000);
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < z.length; i++) {
      sum += z[i];
      sumSq += z[i] * z[i];
    }
    const mean = sum / z.length;
    const variance = sumSq / z.length - mean * mean;

    expect(Math.abs(mean)).toBeLessThan(0.1);
    expect(Math.abs(variance - 1.0)).toBeLessThan(0.2);
  });

  it("handles odd dimensions", () => {
    const z = sampleLatentVector(7);
    expect(z.length).toBe(7);
    for (let i = 0; i < z.length; i++) {
      expect(Number.isFinite(z[i])).toBe(true);
    }
  });
});

describe("normalizeCoords", () => {
  it("normalizes to [0,1] range", () => {
    const [nx, ny] = normalizeCoords(960, 540, 1920, 1080);
    expect(nx).toBeCloseTo(0.5);
    expect(ny).toBeCloseTo(0.5);
  });

  it("handles origin", () => {
    const [nx, ny] = normalizeCoords(0, 0, 1920, 1080);
    expect(nx).toBe(0);
    expect(ny).toBe(0);
  });

  it("handles maximum coords", () => {
    const [nx, ny] = normalizeCoords(1920, 1080, 1920, 1080);
    expect(nx).toBeCloseTo(1.0);
    expect(ny).toBeCloseTo(1.0);
  });
});

describe("validateLatentVector", () => {
  it("accepts valid vector", () => {
    const z = new Float32Array(64);
    expect(() => validateLatentVector(z, 64)).not.toThrow();
  });

  it("throws on dimension mismatch", () => {
    const z = new Float32Array(32);
    expect(() => validateLatentVector(z, 64)).toThrow(InputValidationError);
    expect(() => validateLatentVector(z, 64)).toThrow("dimension mismatch");
  });

  it("throws on NaN values", () => {
    const z = new Float32Array(64);
    z[10] = NaN;
    expect(() => validateLatentVector(z, 64)).toThrow(InputValidationError);
    expect(() => validateLatentVector(z, 64)).toThrow("non-finite");
  });

  it("throws on Infinity values", () => {
    const z = new Float32Array(64);
    z[0] = Infinity;
    expect(() => validateLatentVector(z, 64)).toThrow("non-finite");
  });
});

describe("validatePoint", () => {
  it("accepts valid coordinates", () => {
    expect(() => validatePoint(100, 200, "test")).not.toThrow();
  });

  it("accepts zero coordinates", () => {
    expect(() => validatePoint(0, 0, "test")).not.toThrow();
  });

  it("throws on NaN", () => {
    expect(() => validatePoint(NaN, 100, "start")).toThrow(InputValidationError);
    expect(() => validatePoint(NaN, 100, "start")).toThrow("finite numbers");
  });

  it("throws on negative coordinates", () => {
    expect(() => validatePoint(-1, 100, "start")).toThrow(InputValidationError);
    expect(() => validatePoint(-1, 100, "start")).toThrow("non-negative");
  });

  it("includes label in error message", () => {
    expect(() => validatePoint(-1, 100, "end")).toThrow("end");
  });
});
