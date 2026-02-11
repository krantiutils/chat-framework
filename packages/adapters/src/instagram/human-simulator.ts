/**
 * HumanSimulator — wraps a Puppeteer Page with human-like interaction patterns.
 *
 * Integrates with the SessionStateMachine for state-aware delays and uses
 * realistic mouse movement (cubic Bezier + jitter) and per-character typing
 * delays to avoid bot detection.
 *
 * Design: Methods accept optional MouseProvider / KeyboardProvider interfaces
 * so GAN-based generators can be plugged in later without changing call sites.
 */

import type { Page, ElementHandle, CDPSession, KeyInput } from "puppeteer";

import {
  SessionStateMachine,
  SessionState,
  ActivityType,
} from "@chat-framework/core";

// ── Pluggable generator interfaces ──────────────────────────

/** A point on the screen. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Generates a mouse trajectory between two points.
 * Default implementation uses cubic Bezier + jitter.
 * Swap in the GAN-based generator when ONNX serving is ready.
 */
export interface MouseTrajectoryProvider {
  generate(from: Point, to: Point): Point[];
}

/**
 * Generates per-character timing for a string.
 * Returns hold times and flight times in ms.
 * Default implementation uses statistical distributions.
 * Swap in the GAN-based generator when ONNX serving is ready.
 */
export interface KeystrokeTimingProvider {
  generate(text: string): KeystrokeTiming[];
}

export interface KeystrokeTiming {
  char: string;
  holdMs: number;
  flightMs: number;
}

// ── Default providers ───────────────────────────────────────

/**
 * Cubic-Bezier mouse trajectory with micro-jitter and optional overshoot.
 * Not GAN-quality, but well above linear interpolation.
 */
export class DefaultMouseProvider implements MouseTrajectoryProvider {
  private readonly jitterPx: number;
  private readonly overshootProbability: number;

  constructor(opts?: { jitterPx?: number; overshootProbability?: number }) {
    this.jitterPx = opts?.jitterPx ?? 2;
    this.overshootProbability = opts?.overshootProbability ?? 0.15;
  }

  generate(from: Point, to: Point): Point[] {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);

    // Already at target — no movement needed
    if (dist < 1) {
      return [{ x: from.x, y: from.y }];
    }

    // More points for longer distances (Fitts' Law influence)
    const steps = Math.max(10, Math.min(80, Math.round(dist / 8)));

    // Random control points for cubic Bezier
    const cp1 = this.randomControlPoint(from, to, 0.25);
    const cp2 = this.randomControlPoint(from, to, 0.75);

    const points: Point[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const base = this.cubicBezier(from, cp1, cp2, to, t);
      // Add micro-jitter (diminishes near endpoints)
      const jitterScale = Math.sin(t * Math.PI); // 0 at edges, 1 at center
      points.push({
        x: base.x + (Math.random() - 0.5) * this.jitterPx * jitterScale,
        y: base.y + (Math.random() - 0.5) * this.jitterPx * jitterScale,
      });
    }

    // Optional overshoot: go past target, then correct back
    if (Math.random() < this.overshootProbability && dist > 50) {
      const overshootDist = 3 + Math.random() * 8;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const overshoot: Point = {
        x: to.x + (dx / len) * overshootDist,
        y: to.y + (dy / len) * overshootDist,
      };
      // Remove last point, add overshoot, then correction back to target
      points.pop();
      points.push(overshoot);
      // Small correction arc
      const correctionSteps = 3 + Math.floor(Math.random() * 3);
      for (let i = 1; i <= correctionSteps; i++) {
        const ct = i / correctionSteps;
        points.push({
          x: overshoot.x + (to.x - overshoot.x) * ct,
          y: overshoot.y + (to.y - overshoot.y) * ct,
        });
      }
    }

    return points;
  }

  private randomControlPoint(
    from: Point,
    to: Point,
    tBias: number,
  ): Point {
    const mx = from.x + (to.x - from.x) * tBias;
    const my = from.y + (to.y - from.y) * tBias;
    const spread = Math.hypot(to.x - from.x, to.y - from.y) * 0.3;
    return {
      x: mx + (Math.random() - 0.5) * spread,
      y: my + (Math.random() - 0.5) * spread,
    };
  }

  private cubicBezier(
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
}

/**
 * Statistical keystroke timing generator.
 * Models WPM variation, digraph speedups, and occasional think pauses.
 */
export class DefaultKeystrokeProvider implements KeystrokeTimingProvider {
  private readonly baseWpm: number;
  private readonly wpmVariance: number;

  /** Common fast digraphs (pre-learned motor patterns). */
  private static readonly FAST_DIGRAPHS = new Set([
    "th", "he", "in", "er", "an", "re", "on", "at", "en", "nd",
    "ti", "es", "or", "te", "of", "ed", "is", "it", "al", "ar",
    "st", "to", "nt", "ng", "se", "ha", "as", "ou", "io", "le",
  ]);

  constructor(opts?: { baseWpm?: number; wpmVariance?: number }) {
    this.baseWpm = opts?.baseWpm ?? 65;
    this.wpmVariance = opts?.wpmVariance ?? 15;
  }

  generate(text: string): KeystrokeTiming[] {
    const timings: KeystrokeTiming[] = [];
    const effectiveWpm =
      this.baseWpm + (Math.random() - 0.5) * 2 * this.wpmVariance;
    // Average ms per character at this WPM (assuming 5 chars/word)
    const baseMsPerChar = 60_000 / (effectiveWpm * 5);

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      let flightMs = baseMsPerChar * (0.7 + Math.random() * 0.6);

      // Digraph speedup
      if (i > 0) {
        const digraph = text[i - 1] + char;
        if (DefaultKeystrokeProvider.FAST_DIGRAPHS.has(digraph.toLowerCase())) {
          flightMs *= 0.7;
        }
      }

      // Think pauses after spaces (word boundaries)
      if (char === " " && Math.random() < 0.1) {
        flightMs += 300 + Math.random() * 700; // 300-1000ms think pause
      }

      // Sentence boundary pauses
      if (i > 0 && (text[i - 1] === "." || text[i - 1] === "!" || text[i - 1] === "?") && char === " ") {
        flightMs += 500 + Math.random() * 1500;
      }

      const holdMs = 50 + Math.random() * 80; // 50-130ms key hold

      timings.push({ char, holdMs, flightMs });
    }

    return timings;
  }
}

// ── HumanSimulator ──────────────────────────────────────────

export interface HumanSimulatorConfig {
  page: Page;
  session: SessionStateMachine;
  mouseProvider?: MouseTrajectoryProvider;
  keystrokeProvider?: KeystrokeTimingProvider;
}

/**
 * Human-like interaction layer for browser automation.
 *
 * Wraps Puppeteer's Page with methods that move the mouse along realistic
 * trajectories, type with per-character timing, and respect the session
 * state machine for pacing.
 */
export class HumanSimulator {
  private readonly page: Page;
  private readonly session: SessionStateMachine;
  private readonly mouse: MouseTrajectoryProvider;
  private readonly keyboard: KeystrokeTimingProvider;
  private cdp: CDPSession | null = null;
  private cursor: Point = { x: 0, y: 0 };

  constructor(config: HumanSimulatorConfig) {
    this.page = config.page;
    this.session = config.session;
    this.mouse = config.mouseProvider ?? new DefaultMouseProvider();
    this.keyboard = config.keystrokeProvider ?? new DefaultKeystrokeProvider();
  }

  /**
   * Initialize CDP session for low-level mouse/keyboard events.
   * Must be called after page navigation.
   */
  async init(): Promise<void> {
    this.cdp = await this.page.createCDPSession();
  }

  /**
   * Clean up resources. Detaches the CDP session.
   * Must be called when the simulator is no longer needed.
   */
  async dispose(): Promise<void> {
    if (this.cdp) {
      try {
        await this.cdp.detach();
      } catch (err) {
        // CDP session may already be detached if browser closed
        console.error("HumanSimulator: error detaching CDP session:", err);
      }
      this.cdp = null;
    }
  }

  /**
   * Move the mouse to an element's center with a realistic trajectory.
   */
  async moveTo(element: ElementHandle): Promise<void> {
    const box = await element.boundingBox();
    if (!box) {
      throw new Error("Element has no bounding box (not visible or detached)");
    }

    // Target: random point within the element's center region (not exact center)
    const target: Point = {
      x: box.x + box.width * (0.3 + Math.random() * 0.4),
      y: box.y + box.height * (0.3 + Math.random() * 0.4),
    };

    const trajectory = this.mouse.generate(this.cursor, target);
    await this.executeTrajectory(trajectory);
    this.cursor = target;
  }

  /**
   * Move to an element and click it with realistic timing.
   * Includes hover dwell time before click.
   */
  async click(element: ElementHandle): Promise<void> {
    await this.moveTo(element);

    // Hover dwell before click: 50-200ms
    await this.delay(50 + Math.random() * 150);

    await this.page.mouse.down();
    await this.delay(40 + Math.random() * 60); // Hold click: 40-100ms
    await this.page.mouse.up();
  }

  /**
   * Type text with realistic per-character timing using CDP keyboard events.
   * Sets the session to TYPING activity type during input.
   */
  async type(text: string): Promise<void> {
    const previousActivity = this.session.activityType;
    this.session.setActivityType(ActivityType.TYPING);

    const timings = this.keyboard.generate(text);

    for (const timing of timings) {
      // Flight time (delay before pressing key)
      await this.delay(timing.flightMs);

      await this.page.keyboard.down(timing.char as KeyInput);
      await this.delay(timing.holdMs);
      await this.page.keyboard.up(timing.char as KeyInput);
    }

    this.session.setActivityType(previousActivity);
  }

  /**
   * Scroll the page by a given amount with realistic mouse wheel events.
   */
  async scroll(deltaY: number): Promise<void> {
    const steps = 3 + Math.floor(Math.random() * 5);
    const stepAmount = deltaY / steps;

    for (let i = 0; i < steps; i++) {
      await this.page.mouse.wheel({
        deltaY: stepAmount + (Math.random() - 0.5) * 20,
      });
      await this.delay(30 + Math.random() * 80);
    }
  }

  /**
   * Wait for a human-realistic duration. The delay is influenced by
   * the session state machine — longer waits when THINKING/READING.
   */
  async stateAwareDelay(): Promise<void> {
    const snapshot = this.session.tick();
    let baseMs: number;

    switch (snapshot.state) {
      case SessionState.READING:
        baseMs = 2000 + Math.random() * 5000;
        break;
      case SessionState.THINKING:
        baseMs = 800 + Math.random() * 2000;
        break;
      case SessionState.IDLE:
        baseMs = 500 + Math.random() * 2000;
        break;
      case SessionState.SCROLLING:
        baseMs = 200 + Math.random() * 800;
        break;
      case SessionState.ACTIVE:
        baseMs = 100 + Math.random() * 500;
        break;
      case SessionState.AWAY:
        // Cap AWAY delays for DM operations — don't actually wait 5-30 min.
        // Real AWAY periods are handled at the adapter scheduling level.
        baseMs = 3000 + Math.random() * 5000;
        break;
      default:
        baseMs = 500 + Math.random() * 1000;
    }

    await this.delay(baseMs);
  }

  /**
   * Wait for an element to appear and return it.
   */
  async waitForSelector(
    selector: string,
    timeoutMs: number = 10_000,
  ): Promise<ElementHandle> {
    const el = await this.page.waitForSelector(selector, {
      timeout: timeoutMs,
      visible: true,
    });
    if (!el) {
      throw new Error(`Selector "${selector}" not found within ${timeoutMs}ms`);
    }
    return el;
  }

  /**
   * Execute a mouse trajectory by dispatching CDP Input.dispatchMouseEvent.
   * Falls back to Page.mouse.move if CDP session unavailable.
   */
  private async executeTrajectory(points: Point[]): Promise<void> {
    if (this.cdp) {
      for (const point of points) {
        await this.cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: Math.round(point.x),
          y: Math.round(point.y),
        });
        // Inter-point delay: 5-15ms (60-200 Hz effective rate)
        await this.delay(5 + Math.random() * 10);
      }
    } else {
      // Fallback: use Puppeteer's high-level mouse.move with steps
      const last = points[points.length - 1];
      if (last) {
        await this.page.mouse.move(last.x, last.y, {
          steps: points.length,
        });
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(1, ms)));
  }
}
