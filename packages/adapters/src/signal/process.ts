/**
 * Manages the signal-cli subprocess running in JSON-RPC mode.
 *
 * signal-cli supports a `jsonRpc` command that reads JSON-RPC requests from
 * stdin and writes responses/notifications to stdout, one JSON object per line.
 *
 * This module handles:
 * - Spawning and monitoring the subprocess
 * - Sending JSON-RPC requests and matching responses by id
 * - Dispatching incoming notification envelopes to a callback
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  SignalAdapterConfig,
  SignalEnvelope,
} from "./types.js";

/** Callback for incoming envelopes from signal-cli. */
export type EnvelopeCallback = (envelope: SignalEnvelope) => void;

/** Callback for process errors. */
export type ErrorCallback = (error: Error) => void;

/** Pending RPC request waiting for a response. */
interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Wraps a signal-cli subprocess in JSON-RPC mode.
 *
 * Lifecycle:
 * 1. Call `start()` to spawn the subprocess
 * 2. Use `request()` to send JSON-RPC methods
 * 3. Register `onEnvelope` to receive incoming messages
 * 4. Call `stop()` to terminate
 */
export class SignalCliProcess {
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private envelopeCallback: EnvelopeCallback | null = null;
  private errorCallback: ErrorCallback | null = null;
  private readonly config: Required<
    Pick<SignalAdapterConfig, "phoneNumber" | "signalCliBin" | "requestTimeoutMs">
  > & Pick<SignalAdapterConfig, "dataDir">;

  constructor(config: SignalAdapterConfig) {
    this.config = {
      phoneNumber: config.phoneNumber,
      signalCliBin: config.signalCliBin ?? "signal-cli",
      dataDir: config.dataDir,
      requestTimeoutMs: config.requestTimeoutMs ?? 30_000,
    };
  }

  /** Register a callback for incoming message envelopes. */
  onEnvelope(callback: EnvelopeCallback): void {
    this.envelopeCallback = callback;
  }

  /** Register a callback for process-level errors. */
  onError(callback: ErrorCallback): void {
    this.errorCallback = callback;
  }

  /** Whether the subprocess is currently running. */
  get running(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  /**
   * Spawn the signal-cli process in JSON-RPC mode.
   * Throws if the process fails to start.
   */
  start(): void {
    if (this.process) {
      throw new Error("SignalCliProcess already started");
    }

    const args: string[] = [];
    if (this.config.dataDir) {
      args.push("--config", this.config.dataDir);
    }
    args.push("-a", this.config.phoneNumber, "jsonRpc");

    this.process = spawn(this.config.signalCliBin, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.on("error", (err) => {
      this.emitError(
        new Error(`signal-cli process error: ${err.message}`),
      );
    });

    this.process.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        this.emitError(
          new Error(
            `signal-cli exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`,
          ),
        );
      }
      this.cleanup();
    });

    // stderr → error callback
    if (this.process.stderr) {
      const stderrRl = createInterface({ input: this.process.stderr });
      stderrRl.on("line", (line) => {
        // signal-cli emits log lines on stderr; only surface actual errors
        if (line.toLowerCase().includes("error") || line.toLowerCase().includes("exception")) {
          this.emitError(new Error(`signal-cli stderr: ${line}`));
        }
      });
    }

    // stdout → JSON-RPC responses and notification envelopes
    if (this.process.stdout) {
      this.readline = createInterface({ input: this.process.stdout });
      this.readline.on("line", (line) => this.handleLine(line));
    }
  }

  /**
   * Send a JSON-RPC request and wait for the corresponding response.
   * Rejects if the process isn't running, the request times out, or
   * signal-cli returns an error.
   */
  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.process?.stdin || !this.running) {
      throw new Error("signal-cli process is not running");
    }

    const id = this.nextId++;
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      ...(params && { params }),
      id,
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`signal-cli RPC timeout for method "${method}" (id=${id})`));
      }, this.config.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      const line = JSON.stringify(req) + "\n";
      this.process!.stdin!.write(line, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new Error(`Failed to write to signal-cli stdin: ${err.message}`));
        }
      });
    });
  }

  /**
   * Gracefully stop the subprocess.
   * Sends SIGTERM and waits up to 5 seconds, then SIGKILL.
   */
  async stop(): Promise<void> {
    if (!this.process) return;

    // If already exited, just clean up
    if (this.process.exitCode !== null) {
      this.cleanup();
      return;
    }

    return new Promise<void>((resolve) => {
      const forceKillTimer = setTimeout(() => {
        this.process?.kill("SIGKILL");
      }, 5_000);

      this.process!.once("exit", () => {
        clearTimeout(forceKillTimer);
        this.cleanup();
        resolve();
      });

      this.process!.kill("SIGTERM");
    });
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private handleLine(raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Non-JSON output from signal-cli (startup messages, etc.) — ignore
      return;
    }

    if (typeof parsed !== "object" || parsed === null) return;

    const obj = parsed as Record<string, unknown>;

    // JSON-RPC response (has both "jsonrpc" and numeric "id" fields)
    if ("jsonrpc" in obj && "id" in obj && typeof obj.id === "number") {
      this.handleResponse(obj as unknown as JsonRpcResponse);
      return;
    }

    // Notification envelope (no "id", has "method" and "params")
    if ("method" in obj && obj.method === "receive" && "params" in obj) {
      const envelope = obj.params as SignalEnvelope;
      this.envelopeCallback?.(envelope);
      return;
    }

    // Envelope may also arrive as a bare object with envelope fields
    if ("envelope" in obj) {
      const envelope = (obj as { envelope: SignalEnvelope }).envelope;
      this.envelopeCallback?.(envelope);
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(response.id);

    if ("error" in response) {
      pending.reject(
        new Error(
          `signal-cli RPC error (${response.error.code}): ${response.error.message}`,
        ),
      );
    } else {
      pending.resolve(response.result);
    }
  }

  private emitError(error: Error): void {
    this.errorCallback?.(error);
  }

  private cleanup(): void {
    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("signal-cli process terminated"));
      this.pending.delete(id);
    }

    this.readline?.close();
    this.readline = null;
    this.process = null;
  }
}
