import type { KeystrokeEvent, KeystrokeTimingProvider } from "./types.js";
import type { RandomFn } from "../session/machine.js";

/**
 * Common English digraph frequencies. Pairs that frequently occur together
 * are typed faster (shorter flight time) because of muscle memory.
 * Values are relative frequency multipliers (lower = faster flight time).
 */
const FAST_DIGRAPHS = new Set([
  "th", "he", "in", "er", "an", "re", "on", "at", "en", "nd",
  "ti", "es", "or", "te", "of", "ed", "is", "it", "al", "ar",
  "st", "to", "nt", "ng", "se", "ha", "as", "ou", "io", "le",
  "ve", "co", "me", "de", "hi", "ri", "ro", "ic", "ne", "ea",
  "ra", "ce", "li", "ch", "ll", "be", "ma", "si", "om", "ur",
]);

/**
 * Keys that require a finger stretch (further from home row),
 * resulting in longer hold times and flight times.
 */
const REACH_KEYS = new Set([
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
  "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/",
  "!", "@", "#", "$", "%", "^", "&", "*", "(", ")",
  "_", "+", "{", "}", "|", ":", '"', "<", ">", "?",
  "q", "z", "p",
]);

/**
 * Map of characters that require Shift to be held.
 */
const SHIFT_CHARS = new Set(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ~!@#$%^&*()_+{}|:"<>?'.split(""),
);

/**
 * Characters that can be confused during fast typing (typo candidates).
 * Maps a character to its likely mistypes (adjacent keys on QWERTY).
 */
const ADJACENT_KEYS: Record<string, string[]> = {
  a: ["s", "q", "w", "z"],
  b: ["v", "n", "g", "h"],
  c: ["x", "v", "d", "f"],
  d: ["s", "f", "e", "r", "c", "x"],
  e: ["w", "r", "d", "s"],
  f: ["d", "g", "r", "t", "v", "c"],
  g: ["f", "h", "t", "y", "b", "v"],
  h: ["g", "j", "y", "u", "n", "b"],
  i: ["u", "o", "k", "j"],
  j: ["h", "k", "u", "i", "n", "m"],
  k: ["j", "l", "i", "o", "m"],
  l: ["k", "o", "p"],
  m: ["n", "j", "k"],
  n: ["b", "m", "h", "j"],
  o: ["i", "p", "l", "k"],
  p: ["o", "l"],
  q: ["w", "a"],
  r: ["e", "t", "f", "d"],
  s: ["a", "d", "w", "e", "x", "z"],
  t: ["r", "y", "g", "f"],
  u: ["y", "i", "j", "h"],
  v: ["c", "b", "f", "g"],
  w: ["q", "e", "a", "s"],
  x: ["z", "c", "s", "d"],
  y: ["t", "u", "h", "g"],
  z: ["a", "x", "s"],
  " ": [],
};

/**
 * Fallback keyboard timing provider using statistical heuristics.
 *
 * Generates keystroke events with timing modeled after human typing patterns:
 * - Base WPM: 45-75 (sampled once per text block)
 * - Hold times: 60-130ms with per-key variation
 * - Flight times: based on digraph frequency and finger distance
 * - Typo injection: 2-4% rate with backspace correction
 * - Word boundary pauses: longer flight time before/after spaces
 * - Shift key handling: extra modifier key timing
 */
export class FallbackKeyboardProvider implements KeystrokeTimingProvider {
  private readonly _random: RandomFn;

  constructor(random?: RandomFn) {
    this._random = random ?? Math.random;
  }

  generate(text: string): KeystrokeEvent[] {
    if (text.length === 0) return [];

    // Sample base typing speed for this text block (consistent personality)
    const baseWpm = 45 + this._random() * 30; // 45-75 WPM
    // Average inter-key interval at this WPM (5 chars/word average)
    const baseInterval = 60000 / (baseWpm * 5); // ms per character

    // Typo rate: 2-4%
    const typoRate = 0.02 + this._random() * 0.02;

    const events: KeystrokeEvent[] = [];
    let previousChar = "";

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const isFirst = i === 0;

      // Check for typo injection
      if (
        !isFirst &&
        char !== " " &&
        this._random() < typoRate &&
        ADJACENT_KEYS[char.toLowerCase()]?.length
      ) {
        // Type wrong key
        const adjacents = ADJACENT_KEYS[char.toLowerCase()];
        const wrongKey = adjacents[Math.floor(this._random() * adjacents.length)];

        events.push({
          key: wrongKey,
          holdTime: this._sampleHoldTime(wrongKey),
          preDelay: this._sampleFlightTime(previousChar, wrongKey, baseInterval),
        });

        // Pause (realize mistake): 150-400ms
        const pauseDelay = 150 + this._random() * 250;

        // Backspace
        events.push({
          key: "Backspace",
          holdTime: this._sampleHoldTime("Backspace"),
          preDelay: Math.round(pauseDelay),
        });

        previousChar = "Backspace";
      }

      // Handle Shift key for uppercase/symbols
      const needsShift = SHIFT_CHARS.has(char);
      if (needsShift) {
        // Shift down: 20-60ms before the actual key
        events.push({
          key: "Shift",
          holdTime: 0, // Shift is held through the next key; release handled implicitly
          preDelay: isFirst && events.length === 0
            ? Math.round(50 + this._random() * 200) // Initial delay
            : this._sampleFlightTime(previousChar, "Shift", baseInterval),
        });
        previousChar = "Shift";
      }

      // Actual character
      const holdTime = this._sampleHoldTime(char);
      const preDelay = isFirst && events.length === 0
        ? Math.round(50 + this._random() * 200) // Initial delay before first key
        : this._sampleFlightTime(previousChar, char, baseInterval);

      events.push({ key: char, holdTime, preDelay });
      previousChar = char;
    }

    return events;
  }

  /**
   * Sample hold time for a key press (ms).
   * Reach keys and modifiers have longer hold times.
   */
  private _sampleHoldTime(key: string): number {
    // Base hold time: normal distribution around 80-90ms
    const base = 65 + this._random() * 50 + this._random() * 20;

    if (key === "Backspace") {
      return Math.round(base * 0.8); // Backspace is fast (practiced)
    }
    if (key === "Shift") {
      return Math.round(base * 0.6); // Shift is very fast (modifier)
    }
    if (key === " ") {
      return Math.round(base * 1.1); // Space slightly longer (thumb)
    }
    if (REACH_KEYS.has(key.toLowerCase())) {
      return Math.round(base * 1.2); // Reach keys slightly longer
    }
    return Math.round(base);
  }

  /**
   * Sample flight time (key-up to next key-down) in ms.
   * Considers digraph frequency, word boundaries, and finger distance.
   */
  private _sampleFlightTime(
    prevChar: string,
    nextChar: string,
    baseInterval: number,
  ): number {
    let flight = baseInterval;

    // Word boundary: longer pause after/before space
    if (prevChar === " " || nextChar === " ") {
      flight *= 1.2 + this._random() * 0.5; // 1.2x-1.7x
    }

    // Sentence boundary: longer think pause after period/question mark
    if (prevChar === "." || prevChar === "?" || prevChar === "!") {
      flight *= 2.0 + this._random() * 2.0; // 2x-4x
    }

    // Fast digraphs: common pairs are faster.
    // Only check single-character pairs (skip modifiers like "Shift", "Backspace").
    if (prevChar.length === 1 && nextChar.length === 1) {
      const digraph = (prevChar + nextChar).toLowerCase();
      if (FAST_DIGRAPHS.has(digraph)) {
        flight *= 0.6 + this._random() * 0.2; // 0.6x-0.8x
      }
    }

    // Reach keys are slower (only applies to single characters)
    if (nextChar.length === 1 && REACH_KEYS.has(nextChar.toLowerCase())) {
      flight *= 1.15 + this._random() * 0.15;
    }

    // Add some jitter (±15%)
    flight *= 0.85 + this._random() * 0.3;

    // Floor at 20ms (impossible to type faster than this)
    return Math.round(Math.max(20, flight));
  }
}
