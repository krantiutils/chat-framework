import { OnnxSession } from "./session.js";
import type {
  KeystrokeGeneratorConfig,
  KeystrokeSequence,
  GenerateOptions,
} from "./types.js";
import { InputValidationError } from "./errors.js";
import {
  encodeCharIds,
  sampleLatentVector,
  validateLatentVector,
} from "./preprocessing.js";
import {
  extractKeystrokeTimings,
  computeKeystrokeTimestamps,
} from "./postprocessing.js";

const DEFAULT_MAX_SEQ_LEN = 200;
const DEFAULT_VOCAB_SIZE = 128;
const DEFAULT_LATENT_DIM = 64;

/**
 * ONNX-backed keystroke timing generator.
 *
 * Loads a keyboard dynamics ONNX model and generates realistic
 * (hold_time, flight_time) pairs for arbitrary text input.
 *
 * ```ts
 * const gen = await KeystrokeGenerator.create({
 *   modelPath: "/path/to/keyboard_dynamics.onnx",
 * });
 * const seq = await gen.generate("hello world");
 * await gen.dispose();
 * ```
 */
export class KeystrokeGenerator {
  private readonly maxSequenceLength: number;
  private readonly vocabSize: number;
  private readonly latentDim: number;

  private constructor(
    private readonly session: OnnxSession,
    config: KeystrokeGeneratorConfig,
  ) {
    this.maxSequenceLength = config.maxSequenceLength ?? DEFAULT_MAX_SEQ_LEN;
    this.vocabSize = config.vocabSize ?? DEFAULT_VOCAB_SIZE;
    this.latentDim = config.latentDim ?? DEFAULT_LATENT_DIM;
  }

  /**
   * Create a KeystrokeGenerator from an ONNX model file.
   * Runs a warmup inference by default to trigger ORT graph optimization.
   */
  static async create(
    config: KeystrokeGeneratorConfig,
  ): Promise<KeystrokeGenerator> {
    const session = await OnnxSession.create(config.modelPath);

    for (const name of ["char_ids", "z"]) {
      if (!session.inputNames.includes(name)) {
        await session.dispose();
        throw new InputValidationError(
          `Model missing expected input "${name}". Found: [${session.inputNames.join(", ")}]`,
        );
      }
    }
    if (!session.outputNames.includes("timings")) {
      await session.dispose();
      throw new InputValidationError(
        `Model missing expected output "timings". Found: [${session.outputNames.join(", ")}]`,
      );
    }

    const generator = new KeystrokeGenerator(session, config);

    if (!config.skipWarmup) {
      await generator.warmup();
    }

    return generator;
  }

  /**
   * Generate keystroke timings for a text string.
   */
  async generate(
    text: string,
    options: GenerateOptions = {},
  ): Promise<KeystrokeSequence> {
    if (text.length === 0) {
      throw new InputValidationError("Text must not be empty");
    }
    if (text.length > this.maxSequenceLength) {
      throw new InputValidationError(
        `Text length ${text.length} exceeds maximum ${this.maxSequenceLength}`,
      );
    }

    const charIds = encodeCharIds(text, this.maxSequenceLength, this.vocabSize);

    let z: Float32Array;
    if (options.z) {
      validateLatentVector(options.z, this.latentDim);
      z = options.z;
    } else {
      z = sampleLatentVector(this.latentDim);
    }

    const output = await this.session.run({
      char_ids: { data: charIds, dims: [1, this.maxSequenceLength] },
      z: { data: z, dims: [1, this.latentDim] },
    });

    const { holdTimes, flightTimes } = extractKeystrokeTimings(
      output["timings"].data,
      text.length,
    );
    const timestamps = computeKeystrokeTimestamps(holdTimes, flightTimes);

    return {
      characters: text,
      holdTimes,
      flightTimes,
      timestamps,
      numKeystrokes: text.length,
    };
  }

  /**
   * Run raw inference with pre-built tensors for batched usage.
   *
   * @param charIds BigInt64Array of shape (batch, maxSequenceLength)
   * @param z Float32Array of shape (batch, latentDim)
   * @param batchSize Number of items in the batch
   * @returns Float32Array of shape (batch, maxSequenceLength, 2)
   */
  async runRaw(
    charIds: BigInt64Array,
    z: Float32Array,
    batchSize: number,
  ): Promise<Float32Array> {
    const output = await this.session.run({
      char_ids: { data: charIds, dims: [batchSize, this.maxSequenceLength] },
      z: { data: z, dims: [batchSize, this.latentDim] },
    });
    return output["timings"].data;
  }

  /**
   * Run a warmup inference to trigger graph optimization and memory allocation.
   */
  async warmup(): Promise<void> {
    const dummyCharIds = new BigInt64Array(this.maxSequenceLength);
    const dummyZ = new Float32Array(this.latentDim);
    await this.session.run({
      char_ids: { data: dummyCharIds, dims: [1, this.maxSequenceLength] },
      z: { data: dummyZ, dims: [1, this.latentDim] },
    });
  }

  async dispose(): Promise<void> {
    await this.session.dispose();
  }
}
