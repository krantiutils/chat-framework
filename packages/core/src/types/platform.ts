/**
 * Supported chat platforms.
 *
 * Tier classification:
 * - A: Official Bot APIs (Telegram, Discord)
 * - B: Reverse-engineered protocol (WhatsApp)
 * - C: Browser automation + scraping (Instagram, Facebook)
 * - D: CLI/library based (Signal)
 */
export type Platform =
  | "telegram"
  | "discord"
  | "whatsapp"
  | "instagram"
  | "facebook"
  | "signal";

/** All known platforms as a readonly array. */
export const ALL_PLATFORMS: readonly Platform[] = [
  "telegram",
  "discord",
  "whatsapp",
  "instagram",
  "facebook",
  "signal",
] as const;
