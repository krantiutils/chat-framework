import type { PlatformCapabilities } from "../capabilities/types.js";
import type { MessagingClient } from "../types/client.js";
import type { Platform } from "../types/platform.js";

/**
 * Factory function that creates a MessagingClient for a specific platform.
 *
 * The config parameter is adapter-specific (e.g., SignalAdapterConfig for
 * Signal, DiscordBotConfig for Discord). The factory is responsible for
 * constructing a fully configured — but not yet connected — client.
 */
export type AdapterFactory<C = unknown> = (config: C) => MessagingClient;

/**
 * Bundles a platform adapter's factory and declared capabilities.
 *
 * Stored internally by AdapterRegistry. The generic parameter C represents
 * the adapter-specific configuration type.
 */
export interface AdapterRegistration<C = unknown> {
  readonly platform: Platform;
  readonly factory: AdapterFactory<C>;
  readonly capabilities: PlatformCapabilities;
}
