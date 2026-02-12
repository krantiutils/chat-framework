import type { PlatformCapabilities } from "../capabilities/types.js";
import type { MessagingClient } from "../types/client.js";
import type { Platform } from "../types/platform.js";
import type { AdapterFactory, AdapterRegistration } from "./types.js";

/**
 * Central registry for platform adapter factories.
 *
 * The registry decouples adapter construction from adapter usage: consumers
 * register factories once (typically at startup), then create client instances
 * on demand via `create()`. Each platform can have at most one registered
 * factory at a time.
 *
 * @example
 * ```typescript
 * const registry = new AdapterRegistry();
 * registry.register("signal", (cfg) => new SignalAdapter(cfg), SIGNAL_CAPS);
 *
 * const client = registry.create<SignalAdapterConfig>("signal", {
 *   phoneNumber: "+1234567890",
 * });
 * await client.connect();
 * ```
 */
export class AdapterRegistry {
  private readonly registrations = new Map<Platform, AdapterRegistration>();

  /**
   * Register an adapter factory for a platform.
   *
   * @throws Error if the platform is already registered. Call `unregister()`
   *         first if you need to replace an existing registration.
   */
  register<C>(
    platform: Platform,
    factory: AdapterFactory<C>,
    capabilities: PlatformCapabilities,
  ): void {
    if (this.registrations.has(platform)) {
      throw new Error(
        `Adapter already registered for platform "${platform}". ` +
          `Call unregister("${platform}") first to replace it.`,
      );
    }

    this.registrations.set(platform, {
      platform,
      factory: factory as AdapterFactory,
      capabilities,
    });
  }

  /**
   * Remove a registered adapter factory.
   *
   * @returns `true` if the platform was registered and removed, `false` if
   *          it was not registered.
   */
  unregister(platform: Platform): boolean {
    return this.registrations.delete(platform);
  }

  /**
   * Create a new MessagingClient instance for the given platform.
   *
   * The returned client is constructed but NOT connected — the caller must
   * call `client.connect()` when ready.
   *
   * @throws Error if no adapter is registered for the platform.
   */
  create<C = unknown>(platform: Platform, config: C): MessagingClient {
    const registration = this.registrations.get(platform);
    if (!registration) {
      throw new Error(
        `No adapter registered for platform "${platform}". ` +
          `Registered platforms: [${this.platforms().join(", ")}]`,
      );
    }

    return (registration.factory as AdapterFactory<C>)(config);
  }

  /**
   * Get the declared capabilities for a registered platform.
   *
   * @throws Error if no adapter is registered for the platform.
   */
  getCapabilities(platform: Platform): PlatformCapabilities {
    const registration = this.registrations.get(platform);
    if (!registration) {
      throw new Error(
        `No adapter registered for platform "${platform}". ` +
          `Cannot query capabilities for an unregistered platform.`,
      );
    }

    return registration.capabilities;
  }

  /** Whether an adapter is registered for the given platform. */
  has(platform: Platform): boolean {
    return this.registrations.has(platform);
  }

  /** List all platforms that have a registered adapter. */
  platforms(): readonly Platform[] {
    return [...this.registrations.keys()];
  }

  /** Number of registered adapters. */
  get size(): number {
    return this.registrations.size;
  }

  /** Remove all registrations. */
  clear(): void {
    this.registrations.clear();
  }
}
