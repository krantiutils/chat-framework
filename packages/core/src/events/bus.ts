import type { MessagingClient, MessagingClientEvents, MessagingEventName } from "../types/client.js";
import type { Platform } from "../types/platform.js";

/**
 * Metadata attached to every event forwarded through the EventBus.
 *
 * Consumers receive this alongside the original event arguments so they
 * know which platform and client the event originated from.
 */
export interface EventOrigin {
  readonly platform: Platform;
  readonly client: MessagingClient;
}

/**
 * Handler signature for EventBus events. Receives the same arguments as
 * the underlying MessagingClientEvents handler, plus an EventOrigin as
 * the final argument.
 */
export type BusHandler<E extends MessagingEventName> = (
  ...args: [...Parameters<MessagingClientEvents[E]>, EventOrigin]
) => void;

/** Options for subscribing to bus events. */
export interface BusSubscribeOptions {
  /**
   * Only receive events from these platforms.
   * If omitted, events from all attached clients are forwarded.
   */
  readonly platforms?: readonly Platform[];
}

/** Internal bookkeeping for an attached client. */
interface AttachedClient {
  readonly platform: Platform;
  readonly client: MessagingClient;
  /** The bound handlers we registered on the client, keyed by event name. */
  readonly boundHandlers: Map<MessagingEventName, (...args: unknown[]) => void>;
}

/**
 * Multi-adapter event aggregation bus.
 *
 * Attach multiple MessagingClient instances and subscribe to events across
 * all of them through a single interface. Each event is forwarded with an
 * {@link EventOrigin} so handlers know which platform it came from.
 *
 * @example
 * ```typescript
 * const bus = new EventBus();
 * bus.attach("signal", signalClient);
 * bus.attach("telegram", telegramClient);
 *
 * bus.on("message", (msg, origin) => {
 *   console.log(`[${origin.platform}] ${msg.content}`);
 * });
 *
 * // Only listen to Signal messages:
 * bus.on("message", handler, { platforms: ["signal"] });
 * ```
 */
export class EventBus {
  private readonly attached = new Map<Platform, AttachedClient>();

  private readonly subscribers = new Map<
    MessagingEventName,
    Set<{ handler: (...args: unknown[]) => void; platforms?: ReadonlySet<Platform> }>
  >();

  /**
   * Attach a MessagingClient to the bus. Events emitted by the client
   * will be forwarded to all matching subscribers.
   *
   * @throws Error if a client is already attached for this platform.
   */
  attach(platform: Platform, client: MessagingClient): void {
    if (this.attached.has(platform)) {
      throw new Error(
        `A client is already attached for platform "${platform}". ` +
          `Call detach("${platform}") first to replace it.`,
      );
    }

    const boundHandlers = new Map<MessagingEventName, (...args: unknown[]) => void>();
    const events: MessagingEventName[] = [
      "message",
      "reaction",
      "typing",
      "read",
      "presence",
      "error",
    ];

    for (const event of events) {
      const handler = (...args: unknown[]) => {
        this.forward(event, platform, client, args);
      };
      boundHandlers.set(event, handler);
      client.on(event, handler as MessagingClientEvents[typeof event]);
    }

    this.attached.set(platform, { platform, client, boundHandlers });
  }

  /**
   * Detach a client from the bus, removing all event listeners that the
   * bus registered on it.
   *
   * @returns `true` if the client was attached and removed.
   */
  detach(platform: Platform): boolean {
    const entry = this.attached.get(platform);
    if (!entry) return false;

    for (const [event, handler] of entry.boundHandlers) {
      entry.client.off(event, handler as MessagingClientEvents[typeof event]);
    }

    this.attached.delete(platform);
    return true;
  }

  /**
   * Subscribe to an event across all (or a subset of) attached clients.
   *
   * The handler receives the same arguments as the underlying
   * MessagingClientEvents handler, with an additional {@link EventOrigin}
   * appended as the last argument.
   */
  on<E extends MessagingEventName>(
    event: E,
    handler: BusHandler<E>,
    options?: BusSubscribeOptions,
  ): void {
    let set = this.subscribers.get(event);
    if (!set) {
      set = new Set();
      this.subscribers.set(event, set);
    }

    const platforms = options?.platforms
      ? new Set(options.platforms)
      : undefined;

    set.add({
      handler: handler as (...args: unknown[]) => void,
      platforms: platforms as ReadonlySet<Platform> | undefined,
    });
  }

  /**
   * Remove a previously registered handler.
   */
  off<E extends MessagingEventName>(
    event: E,
    handler: BusHandler<E>,
  ): void {
    const set = this.subscribers.get(event);
    if (!set) return;

    for (const entry of set) {
      if (entry.handler === (handler as (...args: unknown[]) => void)) {
        set.delete(entry);
        return;
      }
    }
  }

  /** List all currently attached platforms. */
  platforms(): readonly Platform[] {
    return [...this.attached.keys()];
  }

  /** Get the attached client for a platform, or undefined. */
  getClient(platform: Platform): MessagingClient | undefined {
    return this.attached.get(platform)?.client;
  }

  /** Number of attached clients. */
  get size(): number {
    return this.attached.size;
  }

  /**
   * Detach all clients and remove all subscribers. After calling destroy(),
   * the bus is empty but still usable (you can attach new clients).
   */
  destroy(): void {
    for (const platform of [...this.attached.keys()]) {
      this.detach(platform);
    }
    this.subscribers.clear();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private forward(
    event: MessagingEventName,
    platform: Platform,
    client: MessagingClient,
    args: unknown[],
  ): void {
    const set = this.subscribers.get(event);
    if (!set) return;

    const origin: EventOrigin = { platform, client };

    for (const entry of set) {
      // Skip if the subscriber is filtering by platform and this isn't a match
      if (entry.platforms && !entry.platforms.has(platform)) continue;

      try {
        entry.handler(...args, origin);
      } catch (err) {
        // Forward handler errors to the "error" event, unless we're already
        // forwarding an error event (avoid infinite recursion).
        if (event !== "error") {
          this.forward(
            "error",
            platform,
            client,
            [err instanceof Error ? err : new Error(String(err))],
          );
        }
        // If we're in the error path, swallow to prevent cascade.
      }
    }
  }
}
