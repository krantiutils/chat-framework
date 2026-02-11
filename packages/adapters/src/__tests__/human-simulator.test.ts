import { describe, it, expect } from "vitest";

import {
  DefaultMouseProvider,
  DefaultKeystrokeProvider,
} from "../instagram/human-simulator.js";
import type { Point } from "../instagram/human-simulator.js";

describe("DefaultMouseProvider", () => {
  const provider = new DefaultMouseProvider({ overshootProbability: 0 });

  it("generates a trajectory from start to end", () => {
    const from: Point = { x: 100, y: 100 };
    const to: Point = { x: 500, y: 300 };
    const trajectory = provider.generate(from, to);

    expect(trajectory.length).toBeGreaterThan(5);

    // First point should be near start
    expect(trajectory[0].x).toBeCloseTo(from.x, -1);
    expect(trajectory[0].y).toBeCloseTo(from.y, -1);

    // Last point should be near end
    const last = trajectory[trajectory.length - 1];
    expect(Math.abs(last.x - to.x)).toBeLessThan(20);
    expect(Math.abs(last.y - to.y)).toBeLessThan(20);
  });

  it("generates more points for longer distances", () => {
    const short = provider.generate({ x: 0, y: 0 }, { x: 50, y: 50 });
    const long = provider.generate({ x: 0, y: 0 }, { x: 800, y: 600 });

    expect(long.length).toBeGreaterThan(short.length);
  });

  it("applies cubic Bezier (not linear)", () => {
    const from: Point = { x: 0, y: 0 };
    const to: Point = { x: 400, y: 0 };
    const trajectory = provider.generate(from, to);

    // If linear, all y values would be ~0. With Bezier + jitter, at least
    // some midpoints should deviate from the line.
    const midpoints = trajectory.slice(
      Math.floor(trajectory.length * 0.25),
      Math.floor(trajectory.length * 0.75),
    );
    const yDeviations = midpoints.map((p) => Math.abs(p.y));
    const maxDeviation = Math.max(...yDeviations);

    // With a horizontal line, any y deviation > 0.5 indicates Bezier curve
    expect(maxDeviation).toBeGreaterThan(0.5);
  });

  it("includes overshoot when probability is 1", () => {
    const overshootProvider = new DefaultMouseProvider({
      overshootProbability: 1,
    });
    const from: Point = { x: 0, y: 0 };
    const to: Point = { x: 300, y: 0 };
    const trajectory = overshootProvider.generate(from, to);

    // With overshoot, some points should go past the target x
    const pastTarget = trajectory.filter((p) => p.x > to.x);
    expect(pastTarget.length).toBeGreaterThan(0);
  });
});

describe("DefaultKeystrokeProvider", () => {
  const provider = new DefaultKeystrokeProvider({ baseWpm: 60 });

  it("generates timings for each character", () => {
    const text = "hello world";
    const timings = provider.generate(text);

    expect(timings).toHaveLength(text.length);
    timings.forEach((t, i) => {
      expect(t.char).toBe(text[i]);
    });
  });

  it("generates positive hold and flight times", () => {
    const timings = provider.generate("test message");

    timings.forEach((t) => {
      expect(t.holdMs).toBeGreaterThan(0);
      expect(t.flightMs).toBeGreaterThan(0);
    });
  });

  it("makes hold times realistic (50-130ms range)", () => {
    const timings = provider.generate("this is a test");

    timings.forEach((t) => {
      expect(t.holdMs).toBeGreaterThanOrEqual(50);
      expect(t.holdMs).toBeLessThanOrEqual(130);
    });
  });

  it("applies digraph speedup for common pairs", () => {
    // Run multiple trials and check average — "th" should be faster than "zx"
    const trials = 50;
    let thTotal = 0;
    let zxTotal = 0;

    for (let i = 0; i < trials; i++) {
      const thTimings = provider.generate("th");
      const zxTimings = provider.generate("zx");
      // Flight time of the second character (the one affected by digraph)
      thTotal += thTimings[1].flightMs;
      zxTotal += zxTimings[1].flightMs;
    }

    // On average, "th" second char should have shorter flight time
    expect(thTotal / trials).toBeLessThan(zxTotal / trials);
  });
});
