import type { Platform } from "./platform.js";

/** Unified user reference across platforms. */
export interface User {
  /** Platform-specific user identifier. */
  readonly id: string;
  /** Platform this user belongs to. */
  readonly platform: Platform;
  /** Platform-specific username (e.g. @handle). */
  readonly username?: string;
  /** Human-readable display name. */
  readonly displayName?: string;
  /** URL to user's avatar/profile picture. */
  readonly avatar?: string;
}
