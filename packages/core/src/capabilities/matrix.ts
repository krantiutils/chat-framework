import type { Platform } from "../types/platform.js";
import type { Capability, PlatformCapabilities } from "./types.js";

/**
 * Default capabilities: everything false.
 * Used as the base when constructing per-platform declarations.
 */
const DEFAULTS: PlatformCapabilities = {
  text: false,
  images: false,
  video: false,
  audio: false,
  voiceNotes: false,
  files: false,
  location: false,
  reactions: false,
  replies: false,
  forward: false,
  delete: false,
  typingIndicator: false,
  readReceipts: false,
  inlineKeyboards: false,
  payments: false,
  voiceCalls: false,
};

/**
 * Create a PlatformCapabilities object from a partial override.
 * Any capability not specified defaults to `false`.
 */
export function createCapabilities(
  overrides: Partial<PlatformCapabilities>,
): PlatformCapabilities {
  return { ...DEFAULTS, ...overrides };
}

/**
 * Pre-defined capability matrix per platform, as specified in PRD section 4.3.
 *
 * Forward and delete are assumed supported on all platforms that have message
 * manipulation (the PRD matrix doesn't explicitly list them, but they are part
 * of the MessagingClient interface and all reference adapters implement them).
 */
export const PLATFORM_CAPABILITIES: Readonly<
  Record<Platform, PlatformCapabilities>
> = {
  telegram: createCapabilities({
    text: true,
    images: true,
    video: true,
    audio: true,
    voiceNotes: true,
    files: true,
    location: true,
    reactions: true,
    replies: true,
    forward: true,
    delete: true,
    typingIndicator: true,
    readReceipts: true,
    inlineKeyboards: true,
    payments: true,
    voiceCalls: false,
  }),

  discord: createCapabilities({
    text: true,
    images: true,
    video: true,
    audio: true,
    voiceNotes: false,
    files: true,
    location: false,
    reactions: true,
    replies: true,
    forward: true,
    delete: true,
    typingIndicator: true,
    readReceipts: false,
    inlineKeyboards: true,
    payments: false,
    voiceCalls: true,
  }),

  whatsapp: createCapabilities({
    text: true,
    images: true,
    video: true,
    audio: true,
    voiceNotes: true,
    files: true,
    location: true,
    reactions: true,
    replies: true,
    forward: true,
    delete: true,
    typingIndicator: true,
    readReceipts: true,
    inlineKeyboards: true, // limited: list messages and buttons
    payments: false,
    voiceCalls: false,
  }),

  instagram: createCapabilities({
    text: true,
    images: true,
    video: true,
    audio: true,
    voiceNotes: true,
    files: false,
    location: false,
    reactions: true,
    replies: true,
    forward: true,
    delete: true,
    typingIndicator: true,
    readReceipts: true,
    inlineKeyboards: false,
    payments: false,
    voiceCalls: false,
  }),

  facebook: createCapabilities({
    text: true,
    images: true,
    video: true,
    audio: true,
    voiceNotes: true,
    files: true,
    location: true,
    reactions: true,
    replies: true,
    forward: true,
    delete: true,
    typingIndicator: true,
    readReceipts: true,
    inlineKeyboards: false,
    payments: false,
    voiceCalls: false,
  }),

  signal: createCapabilities({
    text: true,
    images: true,
    video: true,
    audio: true,
    voiceNotes: true,
    files: true,
    location: true,
    reactions: true,
    replies: true,
    forward: true,
    delete: true,
    typingIndicator: true,
    readReceipts: true,
    inlineKeyboards: false,
    payments: false,
    voiceCalls: false,
  }),
};

/**
 * Check whether a platform supports a specific capability.
 *
 * Uses the built-in PLATFORM_CAPABILITIES matrix. For custom/overridden
 * capabilities, query the AdapterRegistry instead.
 */
export function supportsCapability(
  platform: Platform,
  capability: Capability,
): boolean {
  const caps = PLATFORM_CAPABILITIES[platform];
  return caps[capability];
}

/**
 * Return an array of capabilities that a platform does NOT support.
 * Useful for generating user-facing warnings or fallback decisions.
 */
export function unsupportedCapabilities(
  platform: Platform,
  required: readonly Capability[],
): Capability[] {
  const caps = PLATFORM_CAPABILITIES[platform];
  return required.filter((c) => !caps[c]);
}
