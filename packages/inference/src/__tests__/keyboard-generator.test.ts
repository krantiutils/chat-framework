import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../session.js", () => ({
  OnnxSession: {
    create: vi.fn(),
  },
}));

import { OnnxSession } from "../session.js";
import { KeystrokeGenerator } from "../keyboard-generator.js";
import { InputValidationError } from "../errors.js";

function createMockSession(opts?: {
  inputNames?: string[];
  outputNames?: string[];
  timingsData?: Float32Array;
}) {
  const maxSeqLen = 200;
  const defaultTimings = new Float32Array(maxSeqLen * 2);
  // Fill with plausible timing values
  for (let i = 0; i < maxSeqLen; i++) {
    defaultTimings[i * 2] = 0.08;     // hold ~ 80ms
    defaultTimings[i * 2 + 1] = 0.05; // flight ~ 50ms
  }

  return {
    inputNames: opts?.inputNames ?? ["char_ids", "z"],
    outputNames: opts?.outputNames ?? ["timings"],
    run: vi.fn().mockResolvedValue({
      timings: {
        data: opts?.timingsData ?? defaultTimings,
        dims: [1, maxSeqLen, 2],
      },
    }),
    dispose: vi.fn().mockResolvedValue(undefined),
    modelPath: "/mock/keyboard.onnx",
  };
}

describe("KeystrokeGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create()", () => {
    it("creates generator with valid model", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await KeystrokeGenerator.create({
        modelPath: "/mock/keyboard.onnx",
      });

      expect(gen).toBeDefined();
      // Warmup should have run (1 call)
      expect(mock.run).toHaveBeenCalledTimes(1);

      await gen.dispose();
    });

    it("skips warmup when configured", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await KeystrokeGenerator.create({
        modelPath: "/mock/keyboard.onnx",
        skipWarmup: true,
      });

      expect(mock.run).not.toHaveBeenCalled();
      await gen.dispose();
    });

    it("rejects model missing char_ids input", async () => {
      const mock = createMockSession({ inputNames: ["z"] });
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      await expect(
        KeystrokeGenerator.create({ modelPath: "/mock/bad.onnx" }),
      ).rejects.toThrow('missing expected input "char_ids"');

      expect(mock.dispose).toHaveBeenCalled();
    });

    it("rejects model missing timings output", async () => {
      const mock = createMockSession({ outputNames: ["wrong"] });
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      await expect(
        KeystrokeGenerator.create({ modelPath: "/mock/bad.onnx" }),
      ).rejects.toThrow('missing expected output "timings"');
    });
  });

  describe("generate()", () => {
    it("generates keystroke sequence for text", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await KeystrokeGenerator.create({
        modelPath: "/mock/keyboard.onnx",
      });

      const seq = await gen.generate("hello");

      expect(seq.characters).toBe("hello");
      expect(seq.numKeystrokes).toBe(5);
      expect(seq.holdTimes.length).toBe(5);
      expect(seq.flightTimes.length).toBe(5);
      expect(seq.timestamps.length).toBe(5);
      expect(seq.timestamps[0]).toBe(0);

      // run called: 1 warmup + 1 generate
      expect(mock.run).toHaveBeenCalledTimes(2);

      await gen.dispose();
    });

    it("passes char_ids and z to session", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await KeystrokeGenerator.create({
        modelPath: "/mock/keyboard.onnx",
        skipWarmup: true,
      });

      await gen.generate("ab");

      const callArgs = mock.run.mock.calls[0][0];
      expect(callArgs.char_ids.dims).toEqual([1, 200]);
      expect(callArgs.z.dims).toEqual([1, 64]);

      // Check char IDs for 'a' and 'b'
      expect(callArgs.char_ids.data[0]).toBe(97n); // 'a'
      expect(callArgs.char_ids.data[1]).toBe(98n); // 'b'

      await gen.dispose();
    });

    it("uses provided z vector", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await KeystrokeGenerator.create({
        modelPath: "/mock/keyboard.onnx",
        skipWarmup: true,
      });

      const customZ = new Float32Array(64).fill(0.5);
      await gen.generate("a", { z: customZ });

      const callArgs = mock.run.mock.calls[0][0];
      expect(callArgs.z.data).toBe(customZ);

      await gen.dispose();
    });

    it("rejects empty text", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await KeystrokeGenerator.create({
        modelPath: "/mock/keyboard.onnx",
        skipWarmup: true,
      });

      await expect(gen.generate("")).rejects.toThrow(InputValidationError);

      await gen.dispose();
    });

    it("rejects text exceeding max sequence length", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await KeystrokeGenerator.create({
        modelPath: "/mock/keyboard.onnx",
        maxSequenceLength: 5,
        skipWarmup: true,
      });

      await expect(gen.generate("toolong")).rejects.toThrow("exceeds maximum");

      await gen.dispose();
    });

    it("rejects z vector with wrong dimension", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await KeystrokeGenerator.create({
        modelPath: "/mock/keyboard.onnx",
        skipWarmup: true,
      });

      const wrongZ = new Float32Array(32);
      await expect(gen.generate("a", { z: wrongZ })).rejects.toThrow(
        "dimension mismatch",
      );

      await gen.dispose();
    });

    it("returns correct timing values from model output", async () => {
      const timings = new Float32Array(200 * 2);
      timings[0] = 0.1;  // hold[0]
      timings[1] = 0.05; // flight[0]
      timings[2] = 0.12; // hold[1]
      timings[3] = 0.04; // flight[1]

      const mock = createMockSession({ timingsData: timings });
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await KeystrokeGenerator.create({
        modelPath: "/mock/keyboard.onnx",
        skipWarmup: true,
      });

      const seq = await gen.generate("ab");

      expect(seq.holdTimes[0]).toBeCloseTo(0.1);
      expect(seq.holdTimes[1]).toBeCloseTo(0.12);
      expect(seq.flightTimes[0]).toBeCloseTo(0.05);
      expect(seq.flightTimes[1]).toBeCloseTo(0.04);
      expect(seq.timestamps[0]).toBe(0);
      expect(seq.timestamps[1]).toBeCloseTo(0.15); // 0 + 0.1 + 0.05

      await gen.dispose();
    });
  });

  describe("runRaw()", () => {
    it("passes tensors directly to session", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await KeystrokeGenerator.create({
        modelPath: "/mock/keyboard.onnx",
        skipWarmup: true,
      });

      const charIds = new BigInt64Array(200);
      const z = new Float32Array(64);
      const result = await gen.runRaw(charIds, z, 1);

      expect(result).toBeInstanceOf(Float32Array);
      expect(mock.run).toHaveBeenCalledWith({
        char_ids: { data: charIds, dims: [1, 200] },
        z: { data: z, dims: [1, 64] },
      });

      await gen.dispose();
    });
  });

  describe("dispose()", () => {
    it("delegates to session dispose", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await KeystrokeGenerator.create({
        modelPath: "/mock/keyboard.onnx",
        skipWarmup: true,
      });

      await gen.dispose();
      expect(mock.dispose).toHaveBeenCalledTimes(1);
    });
  });
});
