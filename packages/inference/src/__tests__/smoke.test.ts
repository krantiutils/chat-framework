import { describe, it, expect } from "vitest";

describe("@chat-framework/inference", () => {
  it("package is importable", async () => {
    const mod = await import("../../src/index.js");
    expect(mod).toBeDefined();
    expect(mod.KeystrokeGenerator).toBeDefined();
    expect(mod.TrajectoryGenerator).toBeDefined();
    expect(mod.InferenceError).toBeDefined();
    expect(mod.ModelLoadError).toBeDefined();
    expect(mod.InputValidationError).toBeDefined();
    expect(mod.encodeCharIds).toBeDefined();
    expect(mod.sampleLatentVector).toBeDefined();
    expect(mod.normalizeCoords).toBeDefined();
    expect(mod.computeKeystrokeTimestamps).toBeDefined();
    expect(mod.extractKeystrokeTimings).toBeDefined();
    expect(mod.processTrajectoryOutput).toBeDefined();
  });
});
