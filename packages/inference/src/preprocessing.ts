import { InputValidationError } from "./errors.js";

/**
 * Encode a text string to character IDs, padded to maxLength.
 *
 * Encoding: charCode % vocabSize for each character.
 * Padding: 0 for positions beyond the text length.
 *
 * @returns BigInt64Array of shape (maxLength,) for ONNX int64 input.
 */
export function encodeCharIds(
  text: string,
  maxLength: number,
  vocabSize: number,
): BigInt64Array {
  if (text.length === 0) {
    throw new InputValidationError("Text must not be empty");
  }
  if (text.length > maxLength) {
    throw new InputValidationError(
      `Text length ${text.length} exceeds maximum sequence length ${maxLength}`,
    );
  }

  const ids = new BigInt64Array(maxLength);
  for (let i = 0; i < text.length; i++) {
    ids[i] = BigInt(text.charCodeAt(i) % vocabSize);
  }
  return ids;
}

/**
 * Generate a random latent z vector from N(0,1) using Box-Muller transform.
 */
export function sampleLatentVector(dim: number): Float32Array {
  const z = new Float32Array(dim);
  for (let i = 0; i < dim; i += 2) {
    const u1 = Math.random();
    const u2 = Math.random();
    const r = Math.sqrt(-2 * Math.log(u1 || 1e-10));
    const theta = 2 * Math.PI * u2;
    z[i] = r * Math.cos(theta);
    if (i + 1 < dim) {
      z[i + 1] = r * Math.sin(theta);
    }
  }
  return z;
}

/**
 * Normalize pixel coordinates to [0,1] range.
 */
export function normalizeCoords(
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number,
): [number, number] {
  return [x / screenWidth, y / screenHeight];
}

/**
 * Validate a latent z vector has the expected dimension and finite values.
 */
export function validateLatentVector(
  z: Float32Array,
  expectedDim: number,
): void {
  if (z.length !== expectedDim) {
    throw new InputValidationError(
      `Latent vector dimension mismatch: expected ${expectedDim}, got ${z.length}`,
    );
  }
  for (let i = 0; i < z.length; i++) {
    if (!Number.isFinite(z[i])) {
      throw new InputValidationError(
        `Latent vector contains non-finite value at index ${i}: ${z[i]}`,
      );
    }
  }
}

/**
 * Validate screen coordinates are non-negative and finite.
 */
export function validatePoint(
  x: number,
  y: number,
  label: string,
): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new InputValidationError(
      `${label} coordinates must be finite numbers, got (${x}, ${y})`,
    );
  }
  if (x < 0 || y < 0) {
    throw new InputValidationError(
      `${label} coordinates must be non-negative, got (${x}, ${y})`,
    );
  }
}
