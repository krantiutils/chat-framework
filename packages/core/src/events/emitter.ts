/**
 * Generic, strictly-typed event emitter.
 *
 * Unlike Node's built-in EventEmitter, this provides compile-time safety
 * for event names and handler signatures. It is intended as a base class
 * for platform adapters so they don't each need to re-implement the
 * listener bookkeeping that currently lives inside SignalAdapter.
 *
 * @typeParam EventMap - An interface mapping event names to handler signatures.
 *
 * @example
 * ```typescript
 * interface ChatEvents {
 *   message: (msg: Message) => void;
 *   error: (err: Error) => void;
 * }
 *
 * class MyChatClient extends TypedEventEmitter<ChatEvents> {
 *   handleIncoming(msg: Message) {
 *     this.emit("message", msg);
 *   }
 * }
 *
 * const client = new MyChatClient();
 * client.on("message", (msg) => console.log(msg)); // fully typed
 * ```
 */

// Internal handler type — we store handlers as untyped functions and
// rely on the public API generics for compile-time safety.
type AnyHandler = (...args: unknown[]) => void;

export class TypedEventEmitter<
  EventMap extends Record<string, (...args: never[]) => void>,
> {
  private readonly listeners = new Map<keyof EventMap, Set<AnyHandler>>();

  /**
   * Register a handler for an event. The handler will be called each time
   * the event is emitted.
   */
  on<E extends keyof EventMap & string>(event: E, handler: EventMap[E]): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as unknown as AnyHandler);
  }

  /**
   * Remove a previously registered handler. If the handler was not
   * registered, this is a no-op.
   */
  off<E extends keyof EventMap & string>(event: E, handler: EventMap[E]): void {
    this.listeners.get(event)?.delete(handler as unknown as AnyHandler);
  }

  /**
   * Register a handler that fires at most once. After the first invocation
   * the handler is automatically removed.
   */
  once<E extends keyof EventMap & string>(
    event: E,
    handler: EventMap[E],
  ): void {
    const wrapper: AnyHandler = (...args: unknown[]) => {
      this.off(event, wrapper as unknown as EventMap[E]);
      (handler as unknown as AnyHandler)(...args);
    };

    this.on(event, wrapper as unknown as EventMap[E]);
  }

  /** Return the number of listeners registered for `event`. */
  listenerCount<E extends keyof EventMap & string>(event: E): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** Remove all listeners, optionally for a specific event only. */
  removeAllListeners<E extends keyof EventMap & string>(event?: E): void {
    if (event !== undefined) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Emit an event, calling all registered handlers synchronously in
   * registration order.
   *
   * If a handler throws, the error is caught and re-emitted as an "error"
   * event (if one exists in the EventMap). If the error event itself throws,
   * or there is no "error" event type, the exception propagates.
   *
   * @returns `true` if any handlers were called.
   */
  protected emit<E extends keyof EventMap & string>(
    event: E,
    ...args: Parameters<EventMap[E]>
  ): boolean {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return false;

    for (const handler of set) {
      try {
        handler(...(args as unknown[]));
      } catch (err) {
        // Avoid infinite recursion: if the error event handler itself throws,
        // let it propagate.
        if (event === "error") {
          throw err;
        }

        // If the EventMap has an "error" event, emit the error there.
        if (this.listeners.has("error" as keyof EventMap)) {
          this.emit(
            "error" as E,
            ...([err instanceof Error ? err : new Error(String(err))] as unknown as Parameters<EventMap[E]>),
          );
        } else {
          throw err;
        }
      }
    }

    return true;
  }
}
