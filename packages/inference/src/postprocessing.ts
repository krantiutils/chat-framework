import type { ScreenDimensions } from "./types.js";

/**
 * Compute cumulative timestamps from hold and flight times.
 *
 * timestamps[0] = 0
 * timestamps[k] = timestamps[k-1] + hold[k-1] + flight[k-1]
 *
 * Matches keyboard_dynamics_gan/inference.py:145-147.
 */
export function computeKeystrokeTimestamps(
  holdTimes: Float32Array,
  flightTimes: Float32Array,
): Float32Array {
  const len = holdTimes.length;
  const timestamps = new Float32Array(len);
  for (let k = 1; k < len; k++) {
    timestamps[k] = timestamps[k - 1] + holdTimes[k - 1] + flightTimes[k - 1];
  }
  return timestamps;
}

/**
 * Extract hold/flight timing channels from flat ONNX output.
 *
 * The ONNX model outputs shape (1, maxSeqLen, 2).
 * Extracts [0:textLength, 0] for hold and [0:textLength, 1] for flight.
 *
 * @param rawOutput Flat Float32Array from ONNX, shape (1, maxSeqLen, 2)
 * @param textLength Actual number of characters
 */
export function extractKeystrokeTimings(
  rawOutput: Float32Array,
  textLength: number,
): { holdTimes: Float32Array; flightTimes: Float32Array } {
  const holdTimes = new Float32Array(textLength);
  const flightTimes = new Float32Array(textLength);

  for (let i = 0; i < textLength; i++) {
    const baseIdx = i * 2;
    holdTimes[i] = rawOutput[baseIdx];
    flightTimes[i] = rawOutput[baseIdx + 1];
  }

  return { holdTimes, flightTimes };
}

/**
 * Convert mouse trajectory deltas to absolute pixel positions and
 * determine trajectory length by distance-to-endpoint thresholding.
 *
 * Mirrors mouse_trajectory_gan/inference.py:142-163 and
 * models/kinematics.py:84-101 (trajectory_to_absolute).
 *
 * @param rawOutput Flat Float32Array from ONNX, shape (1, maxSteps, 3) = [dx, dy, dt]
 * @param startNorm Normalized start position [x, y] in [0,1]
 * @param endNorm Normalized end position [x, y] in [0,1]
 * @param maxSteps Maximum generation steps
 * @param distanceThreshold Normalized distance threshold for trimming
 * @param screen Screen dimensions for de-normalization
 */
export function processTrajectoryOutput(
  rawOutput: Float32Array,
  startNorm: [number, number],
  endNorm: [number, number],
  maxSteps: number,
  distanceThreshold: number,
  screen: ScreenDimensions,
): { positions: Float32Array; timestamps: Float32Array; numPoints: number } {
  let curX = startNorm[0];
  let curY = startNorm[1];
  let length = maxSteps;

  for (let i = 0; i < maxSteps; i++) {
    const baseIdx = i * 3;
    curX += rawOutput[baseIdx];
    curY += rawOutput[baseIdx + 1];

    const remainX = endNorm[0] - curX;
    const remainY = endNorm[1] - curY;
    const dist = Math.sqrt(remainX * remainX + remainY * remainY);
    if (dist < distanceThreshold) {
      length = i + 1;
      break;
    }
  }

  const numPoints = length + 1;
  const positions = new Float32Array(numPoints * 2);

  // Start position in pixels
  positions[0] = startNorm[0] * screen.width;
  positions[1] = startNorm[1] * screen.height;

  let accumX = startNorm[0];
  let accumY = startNorm[1];

  for (let i = 0; i < length; i++) {
    const baseIdx = i * 3;
    accumX += rawOutput[baseIdx];
    accumY += rawOutput[baseIdx + 1];
    positions[(i + 1) * 2] = accumX * screen.width;
    positions[(i + 1) * 2 + 1] = accumY * screen.height;
  }

  // Cumulative timestamps from dt
  const timestamps = new Float32Array(numPoints);
  for (let i = 0; i < length; i++) {
    timestamps[i + 1] = timestamps[i] + rawOutput[i * 3 + 2];
  }

  return { positions, timestamps, numPoints };
}
