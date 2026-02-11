import { OnnxSession } from "./session.js";
import type {
  TrajectoryGeneratorConfig,
  Trajectory,
  Point,
  ScreenDimensions,
  TrajectoryGenerateOptions,
} from "./types.js";
import { InputValidationError } from "./errors.js";
import {
  normalizeCoords,
  sampleLatentVector,
  validateLatentVector,
  validatePoint,
} from "./preprocessing.js";
import { processTrajectoryOutput } from "./postprocessing.js";

const DEFAULT_MAX_STEPS = 200;
const DEFAULT_LATENT_DIM = 64;
const DEFAULT_DISTANCE_THRESHOLD = 0.02;
const DEFAULT_SCREEN: ScreenDimensions = { width: 1920, height: 1080 };

/**
 * ONNX-backed mouse trajectory generator.
 *
 * Loads a mouse trajectory ONNX model and generates realistic
 * cursor paths between screen coordinates.
 *
 * ```ts
 * const gen = await TrajectoryGenerator.create({
 *   modelPath: "/path/to/mouse_trajectory.onnx",
 * });
 * const traj = await gen.generate({ x: 100, y: 500 }, { x: 800, y: 300 });
 * await gen.dispose();
 * ```
 */
export class TrajectoryGenerator {
  private readonly maxGenerationSteps: number;
  private readonly latentDim: number;
  private readonly distanceThreshold: number;
  private readonly defaultScreen: ScreenDimensions;

  private constructor(
    private readonly session: OnnxSession,
    config: TrajectoryGeneratorConfig,
  ) {
    this.maxGenerationSteps = config.maxGenerationSteps ?? DEFAULT_MAX_STEPS;
    this.latentDim = config.latentDim ?? DEFAULT_LATENT_DIM;
    this.distanceThreshold = config.distanceThreshold ?? DEFAULT_DISTANCE_THRESHOLD;
    this.defaultScreen = config.screenDimensions ?? DEFAULT_SCREEN;
  }

  /**
   * Create a TrajectoryGenerator from an ONNX model file.
   * Runs a warmup inference by default.
   */
  static async create(
    config: TrajectoryGeneratorConfig,
  ): Promise<TrajectoryGenerator> {
    const session = await OnnxSession.create(config.modelPath);

    for (const name of ["start", "end", "z"]) {
      if (!session.inputNames.includes(name)) {
        await session.dispose();
        throw new InputValidationError(
          `Model missing expected input "${name}". Found: [${session.inputNames.join(", ")}]`,
        );
      }
    }
    if (!session.outputNames.includes("sequences")) {
      await session.dispose();
      throw new InputValidationError(
        `Model missing expected output "sequences". Found: [${session.outputNames.join(", ")}]`,
      );
    }

    const generator = new TrajectoryGenerator(session, config);

    if (!config.skipWarmup) {
      await generator.warmup();
    }

    return generator;
  }

  /**
   * Generate a mouse trajectory between two screen points.
   */
  async generate(
    start: Point,
    end: Point,
    options: TrajectoryGenerateOptions = {},
  ): Promise<Trajectory> {
    validatePoint(start.x, start.y, "start");
    validatePoint(end.x, end.y, "end");

    const screen = options.screenDimensions ?? this.defaultScreen;
    const startNorm = normalizeCoords(start.x, start.y, screen.width, screen.height);
    const endNorm = normalizeCoords(end.x, end.y, screen.width, screen.height);

    let z: Float32Array;
    if (options.z) {
      validateLatentVector(options.z, this.latentDim);
      z = options.z;
    } else {
      z = sampleLatentVector(this.latentDim);
    }

    const output = await this.session.run({
      start: { data: new Float32Array(startNorm), dims: [1, 2] },
      end: { data: new Float32Array(endNorm), dims: [1, 2] },
      z: { data: z, dims: [1, this.latentDim] },
    });

    return processTrajectoryOutput(
      output["sequences"].data,
      startNorm,
      endNorm,
      this.maxGenerationSteps,
      this.distanceThreshold,
      screen,
    );
  }

  /**
   * Run raw inference with pre-built tensors for batched usage.
   *
   * @param start Float32Array of shape (batch, 2) normalized
   * @param end Float32Array of shape (batch, 2) normalized
   * @param z Float32Array of shape (batch, latentDim)
   * @param batchSize Number of items in the batch
   * @returns Float32Array of shape (batch, maxGenerationSteps, 3)
   */
  async runRaw(
    start: Float32Array,
    end: Float32Array,
    z: Float32Array,
    batchSize: number,
  ): Promise<Float32Array> {
    const output = await this.session.run({
      start: { data: start, dims: [batchSize, 2] },
      end: { data: end, dims: [batchSize, 2] },
      z: { data: z, dims: [batchSize, this.latentDim] },
    });
    return output["sequences"].data;
  }

  async warmup(): Promise<void> {
    const dummyStart = new Float32Array([0.1, 0.1]);
    const dummyEnd = new Float32Array([0.9, 0.9]);
    const dummyZ = new Float32Array(this.latentDim);
    await this.session.run({
      start: { data: dummyStart, dims: [1, 2] },
      end: { data: dummyEnd, dims: [1, 2] },
      z: { data: dummyZ, dims: [1, this.latentDim] },
    });
  }

  async dispose(): Promise<void> {
    await this.session.dispose();
  }
}
