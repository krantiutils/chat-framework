import type { Point, TrajectoryPoint, MouseTrajectoryProvider } from "./types.js";
import type { RandomFn } from "../session/machine.js";

/**
 * Fallback mouse trajectory provider using cubic Bezier curves with noise.
 *
 * Used when the GAN model is not available. Produces reasonably natural-looking
 * trajectories using:
 * - Cubic Bezier interpolation with randomized control points
 * - Micro-jitter noise on each point
 * - Fitts' Law-based total movement time
 * - Ease-in-out velocity profile (bell curve)
 * - Optional overshoot with correction (~25% of trajectories)
 */
export class FallbackMouseProvider implements MouseTrajectoryProvider {
  private readonly _random: RandomFn;

  constructor(random?: RandomFn) {
    this._random = random ?? Math.random;
  }

  generate(start: Point, end: Point): TrajectoryPoint[] {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Trivial case: already at target
    if (distance < 1) {
      return [{ x: end.x, y: end.y, timestamp: 0 }];
    }

    // Fitts' Law: movement time proportional to log2(distance / targetWidth + 1)
    // We use a target width of 20px (average button size) and scale factor
    const targetWidth = 20;
    const baseDuration = 200 + 150 * Math.log2(distance / targetWidth + 1);
    const durationJitter = baseDuration * (0.85 + this._random() * 0.3);
    const totalDuration = Math.round(durationJitter);

    // Number of points: roughly one per 8ms (≈125Hz mouse polling rate)
    const numPoints = Math.max(5, Math.round(totalDuration / 8));

    // Generate Bezier control points with randomized offsets
    const cp1 = this._generateControlPoint(start, end, 0.25);
    const cp2 = this._generateControlPoint(start, end, 0.75);

    // Generate main trajectory
    const points: TrajectoryPoint[] = [];

    for (let i = 0; i <= numPoints; i++) {
      // Parametric position along curve [0, 1]
      const t = i / numPoints;

      // Ease-in-out timing: acceleration at start, deceleration at end
      const easedT = this._easeInOut(t);

      // Cubic Bezier position
      const pos = this._cubicBezier(start, cp1, cp2, end, easedT);

      // Add micro-jitter (±1-3px, decreasing near endpoints)
      const jitterScale = Math.sin(t * Math.PI); // 0 at edges, 1 at middle
      const jitterX = (this._random() - 0.5) * 3 * jitterScale;
      const jitterY = (this._random() - 0.5) * 3 * jitterScale;

      // Timestamp follows ease-in-out for velocity profile
      const timestamp = Math.round(t * totalDuration);

      points.push({
        x: Math.round(pos.x + jitterX),
        y: Math.round(pos.y + jitterY),
        timestamp,
      });
    }

    // Overshoot on ~25% of trajectories
    if (this._random() < 0.25 && distance > 50) {
      this._addOvershoot(points, end, totalDuration);
    }

    // Ensure final point lands exactly on target
    const lastIdx = points.length - 1;
    points[lastIdx] = {
      x: end.x,
      y: end.y,
      timestamp: points[lastIdx].timestamp,
    };

    return points;
  }

  /**
   * Generate a Bezier control point offset perpendicular to the line.
   */
  private _generateControlPoint(
    start: Point,
    end: Point,
    t: number,
  ): Point {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Point along the straight line
    const lineX = start.x + dx * t;
    const lineY = start.y + dy * t;

    // Perpendicular offset: random magnitude, proportional to distance
    const perpMagnitude = distance * (0.05 + this._random() * 0.2);
    const perpDirection = this._random() < 0.5 ? 1 : -1;

    // Perpendicular to the line: rotate (dx, dy) by 90 degrees
    const perpX = -dy / distance;
    const perpY = dx / distance;

    return {
      x: lineX + perpX * perpMagnitude * perpDirection,
      y: lineY + perpY * perpMagnitude * perpDirection,
    };
  }

  /**
   * Evaluate a cubic Bezier curve at parameter t.
   */
  private _cubicBezier(
    p0: Point,
    p1: Point,
    p2: Point,
    p3: Point,
    t: number,
  ): Point {
    const u = 1 - t;
    const uu = u * u;
    const uuu = uu * u;
    const tt = t * t;
    const ttt = tt * t;

    return {
      x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
      y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
    };
  }

  /**
   * Ease-in-out curve (smoothstep). Produces natural acceleration/deceleration.
   */
  private _easeInOut(t: number): number {
    return t * t * (3 - 2 * t);
  }

  /**
   * Add overshoot: cursor goes past target, then corrects back.
   * Modifies the points array in place.
   */
  private _addOvershoot(
    points: TrajectoryPoint[],
    target: Point,
    _totalDuration: number,
  ): void {
    // Overshoot distance: 5-20px past the target
    const overshootDist = 5 + this._random() * 15;
    const lastReal = points[points.length - 1];

    // Direction from second-to-last point to target
    const prev = points[Math.max(0, points.length - 3)];
    const dx = target.x - prev.x;
    const dy = target.y - prev.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return;

    const dirX = dx / dist;
    const dirY = dy / dist;

    // Overshoot point
    const overshootX = Math.round(target.x + dirX * overshootDist);
    const overshootY = Math.round(target.y + dirY * overshootDist);

    // Replace last few points with overshoot + correction
    const overshootTime = lastReal.timestamp;
    const correctionTime = Math.round(overshootTime + 40 + this._random() * 80);

    // Remove the last 2 points and add overshoot sequence
    points.splice(points.length - 2, 2);
    points.push(
      { x: overshootX, y: overshootY, timestamp: overshootTime },
      { x: target.x, y: target.y, timestamp: correctionTime },
    );

    // Update total duration (correction adds time)
    // The caller doesn't use totalDuration after this, so we just
    // ensure timestamps are monotonically increasing.
  }
}
