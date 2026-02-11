import * as ort from "onnxruntime-node";

import { ModelLoadError, InferenceError } from "./errors.js";

export interface OnnxSessionOptions {
  readonly graphOptimizationLevel?: "disabled" | "basic" | "extended" | "all";
  readonly enableCpuMemArena?: boolean;
  readonly enableMemPattern?: boolean;
  readonly intraOpNumThreads?: number;
  readonly interOpNumThreads?: number;
}

type GraphOptLevel = "disabled" | "basic" | "extended" | "all";

const OPT_LEVEL_MAP: Record<string, GraphOptLevel> = {
  disabled: "disabled",
  basic: "basic",
  extended: "extended",
  all: "all",
};

/**
 * Thin wrapper around ort.InferenceSession that handles lifecycle,
 * error wrapping, and tensor construction.
 *
 * This is the only module that directly imports onnxruntime-node.
 */
export class OnnxSession {
  private constructor(
    private readonly session: ort.InferenceSession,
    readonly modelPath: string,
    readonly inputNames: readonly string[],
    readonly outputNames: readonly string[],
  ) {}

  static async create(
    modelPath: string,
    options: OnnxSessionOptions = {},
  ): Promise<OnnxSession> {
    const sessionOptions: ort.InferenceSession.SessionOptions = {
      graphOptimizationLevel: OPT_LEVEL_MAP[options.graphOptimizationLevel ?? "all"],
      enableCpuMemArena: options.enableCpuMemArena ?? true,
      enableMemPattern: options.enableMemPattern ?? true,
      intraOpNumThreads: options.intraOpNumThreads ?? 0,
      interOpNumThreads: options.interOpNumThreads ?? 0,
      executionProviders: ["cpu"],
    };

    let session: ort.InferenceSession;
    try {
      session = await ort.InferenceSession.create(modelPath, sessionOptions);
    } catch (err: unknown) {
      throw new ModelLoadError(modelPath, err);
    }

    return new OnnxSession(
      session,
      modelPath,
      session.inputNames,
      session.outputNames,
    );
  }

  /**
   * Run inference with named feeds.
   * Returns a map of output name -> { data: Float32Array, dims: number[] }.
   *
   * Output data is copied out of ORT tensors immediately to prevent
   * native memory leaks.
   */
  async run(
    feeds: Record<string, { data: Float32Array | BigInt64Array; dims: number[] }>,
  ): Promise<Record<string, { data: Float32Array; dims: number[] }>> {
    const ortFeeds: Record<string, ort.Tensor> = {};
    for (const [name, feed] of Object.entries(feeds)) {
      ortFeeds[name] = new ort.Tensor(
        feed.data instanceof BigInt64Array ? "int64" : "float32",
        feed.data,
        feed.dims,
      );
    }

    let results: ort.InferenceSession.OnnxValueMapType;
    try {
      results = await this.session.run(ortFeeds);
    } catch (err: unknown) {
      throw new InferenceError(
        `Inference failed on model ${this.modelPath}: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? { cause: err } : undefined,
      );
    }

    const output: Record<string, { data: Float32Array; dims: number[] }> = {};
    for (const name of this.outputNames) {
      const tensor = results[name];
      output[name] = {
        data: new Float32Array(tensor.data as Float32Array),
        dims: [...tensor.dims],
      };
    }

    return output;
  }

  async dispose(): Promise<void> {
    await this.session.release();
  }
}
