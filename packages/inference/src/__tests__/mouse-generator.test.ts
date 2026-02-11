import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../session.js", () => ({
  OnnxSession: {
    create: vi.fn(),
  },
}));

import { OnnxSession } from "../session.js";
import { TrajectoryGenerator } from "../mouse-generator.js";
import { InputValidationError } from "../errors.js";

function createMockSession(opts?: {
  inputNames?: string[];
  outputNames?: string[];
  sequencesData?: Float32Array;
}) {
  const maxSteps = 200;
  const defaultSequences = new Float32Array(maxSteps * 3);
  // Constant small movement toward (0.9, 0.9)
  for (let i = 0; i < maxSteps; i++) {
    defaultSequences[i * 3] = 0.004;     // dx
    defaultSequences[i * 3 + 1] = 0.004; // dy
    defaultSequences[i * 3 + 2] = 0.008; // dt = 8ms
  }

  return {
    inputNames: opts?.inputNames ?? ["start", "end", "z"],
    outputNames: opts?.outputNames ?? ["sequences"],
    run: vi.fn().mockResolvedValue({
      sequences: {
        data: opts?.sequencesData ?? defaultSequences,
        dims: [1, maxSteps, 3],
      },
    }),
    dispose: vi.fn().mockResolvedValue(undefined),
    modelPath: "/mock/mouse.onnx",
  };
}

describe("TrajectoryGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create()", () => {
    it("creates generator with valid model", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await TrajectoryGenerator.create({
        modelPath: "/mock/mouse.onnx",
      });

      expect(gen).toBeDefined();
      expect(mock.run).toHaveBeenCalledTimes(1); // warmup
      await gen.dispose();
    });

    it("skips warmup when configured", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await TrajectoryGenerator.create({
        modelPath: "/mock/mouse.onnx",
        skipWarmup: true,
      });

      expect(mock.run).not.toHaveBeenCalled();
      await gen.dispose();
    });

    it("rejects model missing start input", async () => {
      const mock = createMockSession({ inputNames: ["end", "z"] });
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      await expect(
        TrajectoryGenerator.create({ modelPath: "/mock/bad.onnx" }),
      ).rejects.toThrow('missing expected input "start"');

      expect(mock.dispose).toHaveBeenCalled();
    });

    it("rejects model missing sequences output", async () => {
      const mock = createMockSession({ outputNames: ["wrong"] });
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      await expect(
        TrajectoryGenerator.create({ modelPath: "/mock/bad.onnx" }),
      ).rejects.toThrow('missing expected output "sequences"');
    });
  });

  describe("generate()", () => {
    it("generates trajectory between two points", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await TrajectoryGenerator.create({
        modelPath: "/mock/mouse.onnx",
        skipWarmup: true,
      });

      const traj = await gen.generate(
        { x: 100, y: 200 },
        { x: 800, y: 600 },
      );

      expect(traj.numPoints).toBeGreaterThan(0);
      expect(traj.positions.length).toBe(traj.numPoints * 2);
      expect(traj.timestamps.length).toBe(traj.numPoints);
      expect(traj.timestamps[0]).toBe(0);

      await gen.dispose();
    });

    it("passes normalized coordinates to session", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await TrajectoryGenerator.create({
        modelPath: "/mock/mouse.onnx",
        skipWarmup: true,
      });

      await gen.generate({ x: 960, y: 540 }, { x: 1920, y: 1080 });

      const callArgs = mock.run.mock.calls[0][0];
      // start = (960/1920, 540/1080) = (0.5, 0.5)
      expect(callArgs.start.data[0]).toBeCloseTo(0.5);
      expect(callArgs.start.data[1]).toBeCloseTo(0.5);
      // end = (1920/1920, 1080/1080) = (1.0, 1.0)
      expect(callArgs.end.data[0]).toBeCloseTo(1.0);
      expect(callArgs.end.data[1]).toBeCloseTo(1.0);

      await gen.dispose();
    });

    it("uses provided z vector", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await TrajectoryGenerator.create({
        modelPath: "/mock/mouse.onnx",
        skipWarmup: true,
      });

      const customZ = new Float32Array(64).fill(0.42);
      await gen.generate({ x: 0, y: 0 }, { x: 100, y: 100 }, { z: customZ });

      const callArgs = mock.run.mock.calls[0][0];
      expect(callArgs.z.data).toBe(customZ);

      await gen.dispose();
    });

    it("overrides screen dimensions per call", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await TrajectoryGenerator.create({
        modelPath: "/mock/mouse.onnx",
        skipWarmup: true,
      });

      await gen.generate(
        { x: 50, y: 100 },
        { x: 50, y: 100 },
        { screenDimensions: { width: 100, height: 200 } },
      );

      const callArgs = mock.run.mock.calls[0][0];
      // start = (50/100, 100/200) = (0.5, 0.5)
      expect(callArgs.start.data[0]).toBeCloseTo(0.5);
      expect(callArgs.start.data[1]).toBeCloseTo(0.5);

      await gen.dispose();
    });

    it("rejects NaN coordinates", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await TrajectoryGenerator.create({
        modelPath: "/mock/mouse.onnx",
        skipWarmup: true,
      });

      await expect(
        gen.generate({ x: NaN, y: 0 }, { x: 100, y: 100 }),
      ).rejects.toThrow(InputValidationError);

      await gen.dispose();
    });

    it("rejects negative coordinates", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await TrajectoryGenerator.create({
        modelPath: "/mock/mouse.onnx",
        skipWarmup: true,
      });

      await expect(
        gen.generate({ x: -1, y: 0 }, { x: 100, y: 100 }),
      ).rejects.toThrow(InputValidationError);

      await gen.dispose();
    });

    it("rejects z vector with wrong dimension", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await TrajectoryGenerator.create({
        modelPath: "/mock/mouse.onnx",
        skipWarmup: true,
      });

      const wrongZ = new Float32Array(10);
      await expect(
        gen.generate({ x: 0, y: 0 }, { x: 100, y: 100 }, { z: wrongZ }),
      ).rejects.toThrow("dimension mismatch");

      await gen.dispose();
    });

    it("start position appears in pixel coordinates", async () => {
      // Custom output: single step far from endpoint
      const seq = new Float32Array(200 * 3);
      seq[0] = 0.1;  // dx
      seq[1] = 0.05; // dy
      seq[2] = 0.01; // dt

      const mock = createMockSession({ sequencesData: seq });
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await TrajectoryGenerator.create({
        modelPath: "/mock/mouse.onnx",
        skipWarmup: true,
      });

      const traj = await gen.generate({ x: 192, y: 108 }, { x: 1920, y: 1080 });

      // Start position: (192, 108) pixels
      expect(traj.positions[0]).toBeCloseTo(192);
      expect(traj.positions[1]).toBeCloseTo(108);

      await gen.dispose();
    });
  });

  describe("runRaw()", () => {
    it("passes tensors directly to session", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await TrajectoryGenerator.create({
        modelPath: "/mock/mouse.onnx",
        skipWarmup: true,
      });

      const start = new Float32Array([0.1, 0.1]);
      const end = new Float32Array([0.9, 0.9]);
      const z = new Float32Array(64);

      const result = await gen.runRaw(start, end, z, 1);

      expect(result).toBeInstanceOf(Float32Array);
      expect(mock.run).toHaveBeenCalledWith({
        start: { data: start, dims: [1, 2] },
        end: { data: end, dims: [1, 2] },
        z: { data: z, dims: [1, 64] },
      });

      await gen.dispose();
    });
  });

  describe("dispose()", () => {
    it("delegates to session dispose", async () => {
      const mock = createMockSession();
      vi.mocked(OnnxSession.create).mockResolvedValue(mock as unknown as OnnxSession);

      const gen = await TrajectoryGenerator.create({
        modelPath: "/mock/mouse.onnx",
        skipWarmup: true,
      });

      await gen.dispose();
      expect(mock.dispose).toHaveBeenCalledTimes(1);
    });
  });
});
