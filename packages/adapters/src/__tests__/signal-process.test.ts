import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

/**
 * Tests for SignalCliProcess.
 *
 * Instead of trying to mock child_process.spawn (which is fragile with ESM),
 * we directly test the class's JSON-RPC parsing and dispatch logic by
 * mocking at the module level and capturing the spawned process.
 */

class MockChildProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;

  kill(_signal?: string) {
    this.exitCode = 0;
    this.emit("exit", 0, null);
  }
}

let mockProc: MockChildProcess;

vi.mock("node:child_process", () => ({
  spawn: () => {
    mockProc = new MockChildProcess();
    return mockProc;
  },
}));

// Import AFTER mock is set up
const { SignalCliProcess } = await import("../signal/process.js");

const BASE_CONFIG = {
  phoneNumber: "+15551234567",
  signalCliBin: "/usr/bin/signal-cli",
  requestTimeoutMs: 5_000,
};

describe("SignalCliProcess", () => {
  let proc: InstanceType<typeof SignalCliProcess>;

  beforeEach(() => {
    vi.useFakeTimers();
    proc = new SignalCliProcess(BASE_CONFIG);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("start/stop lifecycle", () => {
    it("reports running after start", () => {
      proc.start();
      expect(proc.running).toBe(true);
    });

    it("throws if started twice", () => {
      proc.start();
      expect(() => proc.start()).toThrow("already started");
    });

    it("reports not running before start", () => {
      expect(proc.running).toBe(false);
    });

    it("stops cleanly", async () => {
      proc.start();
      await proc.stop();
      expect(proc.running).toBe(false);
    });
  });

  describe("request/response", () => {
    it("sends JSON-RPC request and receives response", async () => {
      proc.start();

      const promise = proc.request("send", { message: "hi" });
      await vi.advanceTimersByTimeAsync(0);

      // Write response to stdout
      mockProc.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", result: { timestamp: 123 }, id: 1 }) + "\n",
      );
      await vi.advanceTimersByTimeAsync(0);

      const result = await promise;
      expect(result).toEqual({ timestamp: 123 });
    });

    it("rejects on error response", async () => {
      proc.start();

      const promise = proc.request("badMethod");
      // Attach catch handler before writing to stdout to avoid unhandled rejection
      const caught = promise.catch((err: Error) => err.message);
      await vi.advanceTimersByTimeAsync(0);

      mockProc.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32601, message: "Method not found" },
          id: 1,
        }) + "\n",
      );
      await vi.advanceTimersByTimeAsync(0);

      const msg = await caught;
      expect(msg).toContain("Method not found");
    });

    it("rejects on timeout", async () => {
      proc.start();

      const promise = proc.request("slowMethod");

      // Must catch the rejection before advancing timers
      const caught = promise.catch((err: Error) => err.message);

      await vi.advanceTimersByTimeAsync(6_000);

      const msg = await caught;
      expect(msg).toContain("timeout");
    });

    it("rejects if process not running", async () => {
      await expect(proc.request("send")).rejects.toThrow("not running");
    });
  });

  describe("envelope dispatching", () => {
    it("dispatches receive envelopes to callback", async () => {
      const envelopes: unknown[] = [];
      proc.onEnvelope((env) => envelopes.push(env));
      proc.start();

      const envelope = {
        sourceNumber: "+15559876543",
        timestamp: 1700000000000,
        dataMessage: { message: "hello" },
      };

      mockProc.stdout.write(
        JSON.stringify({ method: "receive", params: envelope }) + "\n",
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(envelopes).toHaveLength(1);
      expect(envelopes[0]).toEqual(envelope);
    });

    it("dispatches bare envelope objects", async () => {
      const envelopes: unknown[] = [];
      proc.onEnvelope((env) => envelopes.push(env));
      proc.start();

      const envelope = {
        sourceNumber: "+15559876543",
        dataMessage: { message: "test" },
      };

      mockProc.stdout.write(JSON.stringify({ envelope }) + "\n");
      await vi.advanceTimersByTimeAsync(0);

      expect(envelopes).toHaveLength(1);
    });

    it("ignores non-JSON lines", async () => {
      const envelopes: unknown[] = [];
      proc.onEnvelope((env) => envelopes.push(env));
      proc.start();

      mockProc.stdout.write("signal-cli starting up...\n");
      await vi.advanceTimersByTimeAsync(0);

      expect(envelopes).toHaveLength(0);
    });
  });

  describe("error handling", () => {
    it("emits error callback on process error", () => {
      const errors: Error[] = [];
      proc.onError((err) => errors.push(err));
      proc.start();

      mockProc.emit("error", new Error("spawn failed"));

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("spawn failed");
    });

    it("rejects pending requests when process exits", async () => {
      proc.start();

      const promise = proc.request("send", { message: "hi" });
      await vi.advanceTimersByTimeAsync(0);

      // Catch before triggering exit
      const caught = promise.catch((err: Error) => err.message);

      mockProc.exitCode = 1;
      mockProc.emit("exit", 1, null);
      await vi.advanceTimersByTimeAsync(0);

      const msg = await caught;
      expect(msg).toContain("terminated");
    });
  });
});
