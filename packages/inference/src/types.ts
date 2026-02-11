/**
 * Configuration for creating a KeystrokeGenerator.
 */
export interface KeystrokeGeneratorConfig {
  /** Absolute path to the keyboard dynamics ONNX model file. */
  readonly modelPath: string;

  /**
   * Maximum sequence length the model was exported with.
   * Must match the export-time max_seq_len. Defaults to 200.
   */
  readonly maxSequenceLength?: number;

  /**
   * Vocabulary size for character encoding.
   * Characters are encoded as charCode % vocabSize. Defaults to 128 (ASCII).
   */
  readonly vocabSize?: number;

  /** Latent dimension of the z vector. Defaults to 64. */
  readonly latentDim?: number;

  /** Skip warmup inference during creation. Defaults to false. */
  readonly skipWarmup?: boolean;
}

/**
 * A generated keystroke timing sequence.
 */
export interface KeystrokeSequence {
  /** The input text. */
  readonly characters: string;

  /** Hold duration per key in seconds. Length = characters.length. */
  readonly holdTimes: Float32Array;

  /** Inter-key flight time in seconds. Length = characters.length. */
  readonly flightTimes: Float32Array;

  /**
   * Cumulative timestamps in seconds.
   * timestamps[0] = 0, timestamps[k] = timestamps[k-1] + holdTimes[k-1] + flightTimes[k-1].
   */
  readonly timestamps: Float32Array;

  /** Number of keystrokes (= characters.length). */
  readonly numKeystrokes: number;
}

/** Screen dimensions for coordinate normalization. */
export interface ScreenDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * Configuration for creating a TrajectoryGenerator.
 */
export interface TrajectoryGeneratorConfig {
  /** Absolute path to the mouse trajectory ONNX model file. */
  readonly modelPath: string;

  /** Maximum generation steps the model was exported with. Defaults to 200. */
  readonly maxGenerationSteps?: number;

  /** Latent dimension of the z vector. Defaults to 64. */
  readonly latentDim?: number;

  /**
   * Normalized distance threshold for endpoint proximity trimming.
   * Trajectory is considered complete when accumulated position is within
   * this distance of the target in normalized [0,1] coords. Defaults to 0.02.
   */
  readonly distanceThreshold?: number;

  /**
   * Default screen dimensions for coordinate normalization.
   * Defaults to { width: 1920, height: 1080 }.
   * Can be overridden per-call in generate().
   */
  readonly screenDimensions?: ScreenDimensions;

  /** Skip warmup inference during creation. Defaults to false. */
  readonly skipWarmup?: boolean;
}

/** Pixel coordinate pair. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A generated mouse trajectory with absolute positions and timing.
 */
export interface Trajectory {
  /**
   * Absolute pixel positions stored as flat Float32Array: [x0, y0, x1, y1, ...].
   * Length = numPoints * 2.
   */
  readonly positions: Float32Array;

  /** Cumulative timestamps in seconds. Length = numPoints. */
  readonly timestamps: Float32Array;

  /** Number of trajectory points (includes start position). */
  readonly numPoints: number;
}

/** Options for the generate methods. */
export interface GenerateOptions {
  /**
   * Latent z vector for user profile conditioning.
   * If not provided, a random z is sampled from N(0,1).
   * Must have length = latentDim.
   */
  readonly z?: Float32Array;
}

/** Options for mouse trajectory generation. */
export interface TrajectoryGenerateOptions extends GenerateOptions {
  /** Override screen dimensions for this call. */
  readonly screenDimensions?: ScreenDimensions;
}
