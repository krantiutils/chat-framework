/**
 * Base error for all inference-related failures.
 */
export class InferenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InferenceError";
  }
}

/**
 * Thrown when a model file cannot be loaded.
 */
export class ModelLoadError extends InferenceError {
  readonly modelPath: string;

  constructor(modelPath: string, cause?: unknown) {
    super(
      `Failed to load ONNX model from: ${modelPath}`,
      cause instanceof Error ? { cause } : undefined,
    );
    this.name = "ModelLoadError";
    this.modelPath = modelPath;
  }
}

/**
 * Thrown when input validation fails.
 */
export class InputValidationError extends InferenceError {
  constructor(message: string) {
    super(message);
    this.name = "InputValidationError";
  }
}
