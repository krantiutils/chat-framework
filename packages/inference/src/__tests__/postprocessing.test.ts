import { describe, it, expect } from "vitest";
import {
  computeKeystrokeTimestamps,
  extractKeystrokeTimings,
  processTrajectoryOutput,
} from "../postprocessing.js";

describe("computeKeystrokeTimestamps", () => {
  it("first timestamp is zero", () => {
    const hold = new Float32Array([0.1, 0.1, 0.1]);
    const flight = new Float32Array([0.05, 0.05, 0.05]);
    const ts = computeKeystrokeTimestamps(hold, flight);
    expect(ts[0]).toBe(0);
  });

  it("computes cumulative timestamps correctly", () => {
    // t[k] = t[k-1] + hold[k-1] + flight[k-1]
    const hold = new Float32Array([0.1, 0.2, 0.15]);
    const flight = new Float32Array([0.05, 0.03, 0.04]);
    const ts = computeKeystrokeTimestamps(hold, flight);

    expect(ts[0]).toBeCloseTo(0);
    expect(ts[1]).toBeCloseTo(0.15); // 0 + 0.1 + 0.05
    expect(ts[2]).toBeCloseTo(0.38); // 0.15 + 0.2 + 0.03
  });

  it("handles single keystroke", () => {
    const hold = new Float32Array([0.1]);
    const flight = new Float32Array([0.05]);
    const ts = computeKeystrokeTimestamps(hold, flight);
    expect(ts.length).toBe(1);
    expect(ts[0]).toBe(0);
  });
});

describe("extractKeystrokeTimings", () => {
  it("extracts hold and flight channels", () => {
    // Simulated flat output: (1, 4, 2) -> hold at even indices, flight at odd
    const raw = new Float32Array([
      0.1, 0.05, // char 0
      0.2, 0.03, // char 1
      0.15, 0.04, // char 2
      0.0, 0.0, // padding
    ]);

    const { holdTimes, flightTimes } = extractKeystrokeTimings(raw, 3);

    expect(holdTimes.length).toBe(3);
    expect(flightTimes.length).toBe(3);
    expect(holdTimes[0]).toBeCloseTo(0.1);
    expect(holdTimes[1]).toBeCloseTo(0.2);
    expect(holdTimes[2]).toBeCloseTo(0.15);
    expect(flightTimes[0]).toBeCloseTo(0.05);
    expect(flightTimes[1]).toBeCloseTo(0.03);
    expect(flightTimes[2]).toBeCloseTo(0.04);
  });

  it("trims to actual text length ignoring padding", () => {
    const raw = new Float32Array([
      0.1, 0.05,
      0.2, 0.03,
      999, 999, // padding — should not appear
    ]);

    const { holdTimes, flightTimes } = extractKeystrokeTimings(raw, 2);
    expect(holdTimes.length).toBe(2);
    expect(flightTimes.length).toBe(2);
  });
});

describe("processTrajectoryOutput", () => {
  it("accumulates deltas into absolute positions", () => {
    // 3 steps of constant movement: dx=0.1, dy=0.05, dt=0.01
    const raw = new Float32Array([
      0.1, 0.05, 0.01,
      0.1, 0.05, 0.01,
      0.1, 0.05, 0.01,
    ]);
    const startNorm: [number, number] = [0.0, 0.0];
    const endNorm: [number, number] = [0.5, 0.5]; // far away, won't trigger threshold

    const result = processTrajectoryOutput(
      raw, startNorm, endNorm, 3, 0.02,
      { width: 1920, height: 1080 },
    );

    // numPoints = 3 steps + 1 start = 4
    expect(result.numPoints).toBe(4);

    // Start position: (0, 0) in pixels
    expect(result.positions[0]).toBeCloseTo(0);
    expect(result.positions[1]).toBeCloseTo(0);

    // After step 1: (0.1*1920, 0.05*1080)
    expect(result.positions[2]).toBeCloseTo(192);
    expect(result.positions[3]).toBeCloseTo(54);

    // After step 2: (0.2*1920, 0.1*1080)
    expect(result.positions[4]).toBeCloseTo(384);
    expect(result.positions[5]).toBeCloseTo(108);
  });

  it("trims trajectory at distance threshold", () => {
    // Start at (0.1, 0.1), end at (0.2, 0.1)
    // Step 1: move dx=0.09, dy=0 -> pos=(0.19, 0.1), dist to end = 0.01 < 0.02 -> trim here
    const raw = new Float32Array([
      0.09, 0.0, 0.01,
      0.05, 0.0, 0.01, // should not be included
      0.05, 0.0, 0.01, // should not be included
    ]);

    const result = processTrajectoryOutput(
      raw,
      [0.1, 0.1],
      [0.2, 0.1],
      3,
      0.02,
      { width: 1920, height: 1080 },
    );

    // Should trim at step 1 (length=1, numPoints=2)
    expect(result.numPoints).toBe(2);
  });

  it("computes cumulative timestamps", () => {
    const raw = new Float32Array([
      0.1, 0.05, 0.016,
      0.1, 0.05, 0.012,
      0.1, 0.05, 0.008,
    ]);

    const result = processTrajectoryOutput(
      raw,
      [0.0, 0.0],
      [0.5, 0.5],
      3,
      0.02,
      { width: 1920, height: 1080 },
    );

    expect(result.timestamps[0]).toBe(0);
    expect(result.timestamps[1]).toBeCloseTo(0.016);
    expect(result.timestamps[2]).toBeCloseTo(0.028); // 0.016 + 0.012
    expect(result.timestamps[3]).toBeCloseTo(0.036); // 0.028 + 0.008
  });

  it("uses full maxSteps when endpoint is never reached", () => {
    // Large distance, small steps — never reaches threshold
    const maxSteps = 5;
    const raw = new Float32Array(maxSteps * 3);
    for (let i = 0; i < maxSteps; i++) {
      raw[i * 3] = 0.001;     // tiny dx
      raw[i * 3 + 1] = 0.001; // tiny dy
      raw[i * 3 + 2] = 0.01;  // dt
    }

    const result = processTrajectoryOutput(
      raw,
      [0.0, 0.0],
      [0.9, 0.9],
      maxSteps,
      0.02,
      { width: 1920, height: 1080 },
    );

    expect(result.numPoints).toBe(maxSteps + 1);
  });

  it("respects custom screen dimensions", () => {
    const raw = new Float32Array([0.5, 0.5, 0.01]);

    const result = processTrajectoryOutput(
      raw,
      [0.0, 0.0],
      [0.9, 0.9],
      1,
      0.02,
      { width: 100, height: 200 },
    );

    // After step: (0.5 * 100, 0.5 * 200)
    expect(result.positions[2]).toBeCloseTo(50);
    expect(result.positions[3]).toBeCloseTo(100);
  });
});
