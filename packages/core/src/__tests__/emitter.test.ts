import { describe, it, expect, vi } from "vitest";

import { TypedEventEmitter } from "../events/emitter.js";

/** Test event map. */
interface TestEvents {
  data: (payload: string) => void;
  count: (n: number) => void;
  multi: (a: string, b: number) => void;
  error: (err: Error) => void;
}

/** Concrete class exposing emit for testing. */
class TestEmitter extends TypedEventEmitter<TestEvents> {
  public doEmit<E extends keyof TestEvents & string>(
    event: E,
    ...args: Parameters<TestEvents[E]>
  ): boolean {
    return this.emit(event, ...args);
  }
}

describe("TypedEventEmitter", () => {
  describe("on / emit", () => {
    it("calls handler when event is emitted", () => {
      const emitter = new TestEmitter();
      const handler = vi.fn();
      emitter.on("data", handler);
      emitter.doEmit("data", "hello");
      expect(handler).toHaveBeenCalledWith("hello");
    });

    it("calls multiple handlers in registration order", () => {
      const emitter = new TestEmitter();
      const order: number[] = [];
      emitter.on("data", () => order.push(1));
      emitter.on("data", () => order.push(2));
      emitter.on("data", () => order.push(3));
      emitter.doEmit("data", "test");
      expect(order).toEqual([1, 2, 3]);
    });

    it("passes all arguments to handler", () => {
      const emitter = new TestEmitter();
      const handler = vi.fn();
      emitter.on("multi", handler);
      emitter.doEmit("multi", "hello", 42);
      expect(handler).toHaveBeenCalledWith("hello", 42);
    });

    it("returns true when handlers exist", () => {
      const emitter = new TestEmitter();
      emitter.on("data", () => {});
      expect(emitter.doEmit("data", "test")).toBe(true);
    });

    it("returns false when no handlers exist", () => {
      const emitter = new TestEmitter();
      expect(emitter.doEmit("data", "test")).toBe(false);
    });

    it("does not call handlers for different events", () => {
      const emitter = new TestEmitter();
      const dataHandler = vi.fn();
      const countHandler = vi.fn();
      emitter.on("data", dataHandler);
      emitter.on("count", countHandler);
      emitter.doEmit("data", "hello");
      expect(dataHandler).toHaveBeenCalled();
      expect(countHandler).not.toHaveBeenCalled();
    });
  });

  describe("off", () => {
    it("removes a handler", () => {
      const emitter = new TestEmitter();
      const handler = vi.fn();
      emitter.on("data", handler);
      emitter.off("data", handler);
      emitter.doEmit("data", "ignored");
      expect(handler).not.toHaveBeenCalled();
    });

    it("is a no-op for unregistered handler", () => {
      const emitter = new TestEmitter();
      emitter.off("data", () => {}); // should not throw
    });

    it("only removes the specific handler", () => {
      const emitter = new TestEmitter();
      const keep = vi.fn();
      const remove = vi.fn();
      emitter.on("data", keep);
      emitter.on("data", remove);
      emitter.off("data", remove);
      emitter.doEmit("data", "test");
      expect(keep).toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    });
  });

  describe("once", () => {
    it("fires handler exactly once", () => {
      const emitter = new TestEmitter();
      const handler = vi.fn();
      emitter.once("data", handler);
      emitter.doEmit("data", "first");
      emitter.doEmit("data", "second");
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith("first");
    });

    it("can be combined with regular handlers", () => {
      const emitter = new TestEmitter();
      const always = vi.fn();
      const onceHandler = vi.fn();
      emitter.on("data", always);
      emitter.once("data", onceHandler);
      emitter.doEmit("data", "a");
      emitter.doEmit("data", "b");
      expect(always).toHaveBeenCalledTimes(2);
      expect(onceHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("listenerCount", () => {
    it("returns 0 for event with no listeners", () => {
      const emitter = new TestEmitter();
      expect(emitter.listenerCount("data")).toBe(0);
    });

    it("returns correct count", () => {
      const emitter = new TestEmitter();
      emitter.on("data", () => {});
      emitter.on("data", () => {});
      emitter.on("count", () => {});
      expect(emitter.listenerCount("data")).toBe(2);
      expect(emitter.listenerCount("count")).toBe(1);
    });

    it("updates after off", () => {
      const emitter = new TestEmitter();
      const handler = () => {};
      emitter.on("data", handler);
      expect(emitter.listenerCount("data")).toBe(1);
      emitter.off("data", handler);
      expect(emitter.listenerCount("data")).toBe(0);
    });
  });

  describe("removeAllListeners", () => {
    it("removes all listeners for a specific event", () => {
      const emitter = new TestEmitter();
      emitter.on("data", () => {});
      emitter.on("data", () => {});
      emitter.on("count", () => {});
      emitter.removeAllListeners("data");
      expect(emitter.listenerCount("data")).toBe(0);
      expect(emitter.listenerCount("count")).toBe(1);
    });

    it("removes all listeners when called without argument", () => {
      const emitter = new TestEmitter();
      emitter.on("data", () => {});
      emitter.on("count", () => {});
      emitter.removeAllListeners();
      expect(emitter.listenerCount("data")).toBe(0);
      expect(emitter.listenerCount("count")).toBe(0);
    });
  });

  describe("error handling", () => {
    it("re-emits handler errors as error events", () => {
      const emitter = new TestEmitter();
      const errorHandler = vi.fn();
      emitter.on("error", errorHandler);
      emitter.on("data", () => {
        throw new Error("handler bug");
      });
      emitter.doEmit("data", "test");
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(errorHandler.mock.calls[0][0].message).toBe("handler bug");
    });

    it("wraps non-Error throws as Error", () => {
      const emitter = new TestEmitter();
      const errorHandler = vi.fn();
      emitter.on("error", errorHandler);
      emitter.on("data", () => {
        throw "string error";
      });
      emitter.doEmit("data", "test");
      expect(errorHandler.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(errorHandler.mock.calls[0][0].message).toBe("string error");
    });

    it("propagates error if no error handler is registered", () => {
      const emitter = new TestEmitter();
      emitter.on("data", () => {
        throw new Error("no error handler");
      });
      expect(() => emitter.doEmit("data", "test")).toThrow("no error handler");
    });

    it("propagates if error handler itself throws", () => {
      const emitter = new TestEmitter();
      emitter.on("error", () => {
        throw new Error("error handler broke");
      });
      expect(() => emitter.doEmit("error", new Error("original"))).toThrow(
        "error handler broke",
      );
    });
  });
});
