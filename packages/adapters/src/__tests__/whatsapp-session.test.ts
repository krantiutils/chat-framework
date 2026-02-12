import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  AuthenticatedEvent,
  ConnectedEvent,
  DisconnectedEvent,
  QRCodeEvent,
  ReconnectingEvent,
  SessionExpiredEvent,
  WhatsAppSessionConfig,
} from "../whatsapp/types.js";

/**
 * Tests for WhatsAppSessionManager.
 *
 * Mocks the Baileys socket, auth state store, and fetchLatestBaileysVersion
 * to test session lifecycle without an actual WhatsApp connection.
 */

// ── Shared mock state ────────────────────────────────────────────────────────

type EventHandler = (...args: unknown[]) => void;

/** Tracks ev.on() registrations so tests can fire events. */
const eventHandlers = new Map<string, Set<EventHandler>>();

/** Mock auth state returned by loadState. */
const mockAuthState = {
  creds: { registered: false, me: undefined } as Record<string, unknown>,
  keys: {
    get: vi.fn(async () => ({})),
    set: vi.fn(async () => {}),
  },
};

const mockSaveCreds = vi.fn(async () => {});
const mockClearState = vi.fn(async () => {});
const mockHasExistingState = vi.fn(async () => false);
const mockLoadState = vi.fn(async () => mockAuthState);

function createMockAuthStore() {
  return {
    loadState: mockLoadState,
    saveCreds: mockSaveCreds,
    clearState: mockClearState,
    hasExistingState: mockHasExistingState,
  };
}

/** Mock socket returned by makeWASocket. */
let mockSocket: Record<string, unknown>;
let mockSocketEnd: ReturnType<typeof vi.fn>;
let mockSocketLogout: ReturnType<typeof vi.fn>;
let mockRequestPairingCode: ReturnType<typeof vi.fn>;

function resetMockSocket() {
  eventHandlers.clear();
  mockSocketEnd = vi.fn();
  mockSocketLogout = vi.fn(async () => {});
  mockRequestPairingCode = vi.fn(async () => "1234-5678");

  mockSocket = {
    ev: {
      on(event: string, handler: EventHandler) {
        let set = eventHandlers.get(event);
        if (!set) {
          set = new Set();
          eventHandlers.set(event, set);
        }
        set.add(handler);
      },
      off(event: string, handler: EventHandler) {
        eventHandlers.get(event)?.delete(handler);
      },
    },
    authState: mockAuthState,
    user: { id: "1234567890@s.whatsapp.net", name: "Test" },
    end: mockSocketEnd,
    logout: mockSocketLogout,
    requestPairingCode: mockRequestPairingCode,
  };
}

/** Fire a mock event as if Baileys emitted it. */
function fireEvent(event: string, data: unknown) {
  const handlers = eventHandlers.get(event);
  if (handlers) {
    for (const h of handlers) {
      h(data);
    }
  }
}

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@whiskeysockets/baileys", () => ({
  makeWASocket: vi.fn(() => {
    // Each socket gets a fresh event emitter (like real Baileys).
    // Clear handlers so old socket callbacks don't leak into new sockets.
    eventHandlers.clear();
    resetMockSocket();
    return mockSocket;
  }),
  fetchLatestBaileysVersion: vi.fn(async () => ({
    version: [2, 3000, 1015901307],
    isLatest: true,
  })),
  DisconnectReason: {
    connectionClosed: 428,
    connectionLost: 408,
    connectionReplaced: 440,
    timedOut: 408,
    loggedOut: 401,
    badSession: 500,
    restartRequired: 515,
    multideviceMismatch: 411,
    forbidden: 403,
    unavailableService: 503,
  },
  makeCacheableSignalKeyStore: vi.fn((keys: unknown) => keys),
  useMultiFileAuthState: vi.fn(async () => ({
    state: mockAuthState,
    saveCreds: vi.fn(async () => {}),
  })),
}));

// Import after mocks
const { WhatsAppSessionManager, classifyDisconnect } = await import(
  "../whatsapp/session.js"
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function createConfig(
  overrides: Partial<WhatsAppSessionConfig> = {},
): WhatsAppSessionConfig {
  return {
    authStore: createMockAuthStore(),
    maxReconnectAttempts: 3,
    baseReconnectDelayMs: 10,
    maxReconnectDelayMs: 100,
    qrTimeoutMs: 5000,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("WhatsAppSessionManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockSocket();
    mockLoadState.mockClear();
    mockSaveCreds.mockClear();
    mockClearState.mockClear();
    mockHasExistingState.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("connection lifecycle", () => {
    it("starts in disconnected state", () => {
      const session = new WhatsAppSessionManager(createConfig());
      expect(session.sessionState).toBe("disconnected");
      expect(session.socket).toBeNull();
    });

    it("transitions to connecting on connect()", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      await session.connect();
      // After connect, we're in connecting state (socket created,
      // waiting for connection.update). The mock doesn't fire open
      // automatically, so we're either connecting or waiting_for_qr.
      expect(["connecting", "waiting_for_qr"]).toContain(session.sessionState);
    });

    it("throws when connecting while already connecting", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      await session.connect();
      await expect(session.connect()).rejects.toThrow("cannot connect");
    });

    it("transitions to connected on connection.update open", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      const connectedEvents: ConnectedEvent[] = [];
      session.on("connected", (e: ConnectedEvent) => connectedEvents.push(e));

      await session.connect();
      fireEvent("connection.update", { connection: "open" });

      expect(session.sessionState).toBe("connected");
      expect(connectedEvents).toHaveLength(1);
      expect(connectedEvents[0].jid).toBe("1234567890@s.whatsapp.net");
    });

    it("throws when connecting while connected", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      await session.connect();
      fireEvent("connection.update", { connection: "open" });
      await expect(session.connect()).rejects.toThrow("cannot connect");
    });

    it("disconnects gracefully", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      await session.connect();
      fireEvent("connection.update", { connection: "open" });

      await session.disconnect();
      expect(session.sessionState).toBe("disconnected");
      expect(session.socket).toBeNull();
    });

    it("disconnect is safe when already disconnected", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      await session.disconnect(); // should not throw
      expect(session.sessionState).toBe("disconnected");
    });

    it("loads auth state on connect", async () => {
      const config = createConfig();
      const session = new WhatsAppSessionManager(config);
      await session.connect();
      expect(config.authStore.loadState).toHaveBeenCalledOnce();
    });
  });

  describe("QR code flow", () => {
    it("emits qr event when QR code is available", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      const qrEvents: QRCodeEvent[] = [];
      session.on("qr", (e: QRCodeEvent) => qrEvents.push(e));

      await session.connect();
      fireEvent("connection.update", { qr: "ref1,noise,identity,adv" });

      expect(qrEvents).toHaveLength(1);
      expect(qrEvents[0].qr).toBe("ref1,noise,identity,adv");
      expect(qrEvents[0].attempt).toBe(1);
      expect(session.sessionState).toBe("waiting_for_qr");
    });

    it("increments QR attempt counter", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      const qrEvents: QRCodeEvent[] = [];
      session.on("qr", (e: QRCodeEvent) => qrEvents.push(e));

      await session.connect();
      fireEvent("connection.update", { qr: "qr1" });
      fireEvent("connection.update", { qr: "qr2" });
      fireEvent("connection.update", { qr: "qr3" });

      expect(qrEvents).toHaveLength(3);
      expect(qrEvents[0].attempt).toBe(1);
      expect(qrEvents[1].attempt).toBe(2);
      expect(qrEvents[2].attempt).toBe(3);
    });

    it("emits authenticated event on new login", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      const authEvents: AuthenticatedEvent[] = [];
      session.on("authenticated", (e: AuthenticatedEvent) =>
        authEvents.push(e),
      );

      await session.connect();
      fireEvent("connection.update", { isNewLogin: true });

      expect(authEvents).toHaveLength(1);
      expect(authEvents[0].isNewLogin).toBe(true);
    });

    it("emits authenticated(isNewLogin=false) on session restore", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      const authEvents: AuthenticatedEvent[] = [];
      session.on("authenticated", (e: AuthenticatedEvent) =>
        authEvents.push(e),
      );

      await session.connect();
      // Session restore: connection opens without isNewLogin
      fireEvent("connection.update", { connection: "open" });

      expect(authEvents).toHaveLength(1);
      expect(authEvents[0].isNewLogin).toBe(false);
    });

    it("resets QR counter on successful connection", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      const qrEvents: QRCodeEvent[] = [];
      session.on("qr", (e: QRCodeEvent) => qrEvents.push(e));

      await session.connect();
      fireEvent("connection.update", { qr: "qr1" });
      fireEvent("connection.update", { qr: "qr2" });
      fireEvent("connection.update", { connection: "open" });

      // Simulate disconnect and reconnect
      fireEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: Object.assign(new Error("lost"), {
            output: { statusCode: 515 },
          }),
          date: new Date(),
        },
      });

      // Advance past reconnect delay
      await vi.advanceTimersByTimeAsync(200);

      // New QR after reconnect should start at 1 again
      fireEvent("connection.update", { qr: "qr-after-reconnect" });
      const lastQr = qrEvents[qrEvents.length - 1];
      expect(lastQr.attempt).toBe(1);
    });
  });

  describe("pairing code", () => {
    it("delegates to socket.requestPairingCode", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      await session.connect();

      const code = await session.requestPairingCode("12025551234");
      expect(code).toBe("1234-5678");
      expect(mockRequestPairingCode).toHaveBeenCalledWith("12025551234");
    });

    it("throws if no socket is active", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      await expect(session.requestPairingCode("12025551234")).rejects.toThrow(
        "no active socket",
      );
    });
  });

  describe("disconnect handling", () => {
    it("emits disconnected event on close", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      const events: DisconnectedEvent[] = [];
      session.on("disconnected", (e: DisconnectedEvent) => events.push(e));

      await session.connect();
      fireEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: Object.assign(new Error("connection lost"), {
            output: { statusCode: 408 },
          }),
          date: new Date(),
        },
      });

      expect(events).toHaveLength(1);
      expect(events[0].reason.category).toBe("connection_lost");
      expect(events[0].reason.shouldReconnect).toBe(true);
    });

    it("emits session-expired on logout (401)", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      const expiredEvents: SessionExpiredEvent[] = [];
      session.on("session-expired", (e: SessionExpiredEvent) =>
        expiredEvents.push(e),
      );

      await session.connect();
      fireEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: Object.assign(new Error("logged out"), {
            output: { statusCode: 401 },
          }),
          date: new Date(),
        },
      });

      expect(expiredEvents).toHaveLength(1);
      expect(expiredEvents[0].reason).toBe("logged_out");
    });

    it("emits session-expired on bad session (500)", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      const expiredEvents: SessionExpiredEvent[] = [];
      session.on("session-expired", (e: SessionExpiredEvent) =>
        expiredEvents.push(e),
      );

      await session.connect();
      fireEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: Object.assign(new Error("bad session"), {
            output: { statusCode: 500 },
          }),
          date: new Date(),
        },
      });

      expect(expiredEvents).toHaveLength(1);
      expect(expiredEvents[0].reason).toBe("bad_session");
    });

    it("emits session-expired on banned (403)", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      const expiredEvents: SessionExpiredEvent[] = [];
      session.on("session-expired", (e: SessionExpiredEvent) =>
        expiredEvents.push(e),
      );

      await session.connect();
      fireEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: Object.assign(new Error("forbidden"), {
            output: { statusCode: 403 },
          }),
          date: new Date(),
        },
      });

      expect(expiredEvents).toHaveLength(1);
      expect(expiredEvents[0].reason).toBe("banned");
    });

    it("clears session state on permanent failure", async () => {
      const config = createConfig();
      const session = new WhatsAppSessionManager(config);

      await session.connect();
      fireEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: Object.assign(new Error("logged out"), {
            output: { statusCode: 401 },
          }),
          date: new Date(),
        },
      });

      // clearState is called asynchronously
      await vi.advanceTimersByTimeAsync(0);
      expect(config.authStore.clearState).toHaveBeenCalledOnce();
    });

    it("does not reconnect on intentional disconnect", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      const reconnectEvents: ReconnectingEvent[] = [];
      session.on("reconnecting", (e: ReconnectingEvent) =>
        reconnectEvents.push(e),
      );

      await session.connect();
      fireEvent("connection.update", { connection: "open" });
      await session.disconnect();

      expect(reconnectEvents).toHaveLength(0);
    });

    it("does not reconnect on connection replaced (440)", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      const reconnectEvents: ReconnectingEvent[] = [];
      session.on("reconnecting", (e: ReconnectingEvent) =>
        reconnectEvents.push(e),
      );

      await session.connect();
      fireEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: Object.assign(new Error("replaced"), {
            output: { statusCode: 440 },
          }),
          date: new Date(),
        },
      });

      await vi.advanceTimersByTimeAsync(5000);
      expect(reconnectEvents).toHaveLength(0);
    });
  });

  describe("automatic reconnection", () => {
    it("schedules reconnect on transient failure", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      const reconnectEvents: ReconnectingEvent[] = [];
      session.on("reconnecting", (e: ReconnectingEvent) =>
        reconnectEvents.push(e),
      );

      await session.connect();
      fireEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: Object.assign(new Error("connection lost"), {
            output: { statusCode: 428 },
          }),
          date: new Date(),
        },
      });

      expect(reconnectEvents).toHaveLength(1);
      expect(reconnectEvents[0].attempt).toBe(1);
      expect(reconnectEvents[0].maxAttempts).toBe(3);
    });

    it("uses exponential backoff", async () => {
      const session = new WhatsAppSessionManager(
        createConfig({
          baseReconnectDelayMs: 100,
          maxReconnectDelayMs: 10000,
        }),
      );
      const reconnectEvents: ReconnectingEvent[] = [];
      session.on("reconnecting", (e: ReconnectingEvent) =>
        reconnectEvents.push(e),
      );

      await session.connect();

      // First disconnect
      fireEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: Object.assign(new Error("lost"), {
            output: { statusCode: 428 },
          }),
          date: new Date(),
        },
      });

      // First reconnect fires, advance timer to trigger it
      await vi.advanceTimersByTimeAsync(200);

      // Second disconnect
      fireEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: Object.assign(new Error("lost"), {
            output: { statusCode: 428 },
          }),
          date: new Date(),
        },
      });

      // Delays should increase (with jitter)
      expect(reconnectEvents.length).toBeGreaterThanOrEqual(2);
      // Second delay should be larger than first (base * 2^1 vs base * 2^0)
      // Account for ±25% jitter
      expect(reconnectEvents[1].delayMs).toBeGreaterThan(
        reconnectEvents[0].delayMs * 0.5,
      );
    });

    it("stops reconnecting after max attempts", async () => {
      const config = createConfig({ maxReconnectAttempts: 2 });
      const session = new WhatsAppSessionManager(config);
      const reconnectEvents: ReconnectingEvent[] = [];
      session.on("reconnecting", (e: ReconnectingEvent) =>
        reconnectEvents.push(e),
      );

      await session.connect();

      // First disconnect + reconnect
      fireEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: Object.assign(new Error("lost"), {
            output: { statusCode: 428 },
          }),
          date: new Date(),
        },
      });
      await vi.advanceTimersByTimeAsync(200);

      // Second disconnect + reconnect
      fireEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: Object.assign(new Error("lost"), {
            output: { statusCode: 428 },
          }),
          date: new Date(),
        },
      });
      await vi.advanceTimersByTimeAsync(500);

      // Third disconnect — should NOT reconnect (max=2)
      fireEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: Object.assign(new Error("lost"), {
            output: { statusCode: 428 },
          }),
          date: new Date(),
        },
      });

      // Only 2 reconnect events (not 3)
      expect(reconnectEvents).toHaveLength(2);
    });

    it("resets reconnect counter on successful connection", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      await session.connect();

      // Disconnect and reconnect once
      fireEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: Object.assign(new Error("lost"), {
            output: { statusCode: 428 },
          }),
          date: new Date(),
        },
      });

      expect(session.currentReconnectAttempt).toBe(1);
      await vi.advanceTimersByTimeAsync(200);

      // Successful reconnection
      fireEvent("connection.update", { connection: "open" });
      expect(session.currentReconnectAttempt).toBe(0);
    });

    it("respects maxReconnectAttempts=0 (disabled)", async () => {
      const session = new WhatsAppSessionManager(
        createConfig({ maxReconnectAttempts: 0 }),
      );
      const reconnectEvents: ReconnectingEvent[] = [];
      session.on("reconnecting", (e: ReconnectingEvent) =>
        reconnectEvents.push(e),
      );

      await session.connect();
      fireEvent("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: Object.assign(new Error("lost"), {
            output: { statusCode: 428 },
          }),
          date: new Date(),
        },
      });

      await vi.advanceTimersByTimeAsync(5000);
      expect(reconnectEvents).toHaveLength(0);
    });
  });

  describe("credential persistence", () => {
    it("saves credentials on creds.update event", async () => {
      const config = createConfig();
      const session = new WhatsAppSessionManager(config);

      await session.connect();
      fireEvent("creds.update", { registered: true });

      // saveCreds is async, give it a tick
      await vi.advanceTimersByTimeAsync(0);
      expect(config.authStore.saveCreds).toHaveBeenCalled();
    });
  });

  describe("event listener management", () => {
    it("supports on/off", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      const events: QRCodeEvent[] = [];
      const handler = (e: QRCodeEvent) => events.push(e);

      session.on("qr", handler);
      await session.connect();
      fireEvent("connection.update", { qr: "qr1" });

      session.off("qr", handler);
      fireEvent("connection.update", { qr: "qr2" });

      expect(events).toHaveLength(1);
    });

    it("swallows listener errors without breaking session", async () => {
      const session = new WhatsAppSessionManager(createConfig());
      session.on("connected", () => {
        throw new Error("bad listener");
      });

      await session.connect();
      // This should not throw
      fireEvent("connection.update", { connection: "open" });
      expect(session.sessionState).toBe("connected");
    });
  });

  describe("clearSession", () => {
    it("delegates to authStore.clearState", async () => {
      const config = createConfig();
      const session = new WhatsAppSessionManager(config);
      await session.clearSession();
      expect(config.authStore.clearState).toHaveBeenCalledOnce();
    });
  });
});

describe("classifyDisconnect", () => {
  function makeError(statusCode: number, message = "test"): Error {
    return Object.assign(new Error(message), {
      output: { statusCode },
    });
  }

  it("classifies loggedOut (401) as permanent", () => {
    const result = classifyDisconnect(makeError(401));
    expect(result.category).toBe("logged_out");
    expect(result.shouldReconnect).toBe(false);
    expect(result.shouldClearSession).toBe(true);
  });

  it("classifies badSession (500) as permanent", () => {
    const result = classifyDisconnect(makeError(500));
    expect(result.category).toBe("bad_session");
    expect(result.shouldReconnect).toBe(false);
    expect(result.shouldClearSession).toBe(true);
  });

  it("classifies forbidden (403) as permanent", () => {
    const result = classifyDisconnect(makeError(403));
    expect(result.category).toBe("banned");
    expect(result.shouldReconnect).toBe(false);
    expect(result.shouldClearSession).toBe(true);
  });

  it("classifies connectionClosed (428) as transient", () => {
    const result = classifyDisconnect(makeError(428));
    expect(result.category).toBe("connection_closed");
    expect(result.shouldReconnect).toBe(true);
    expect(result.shouldClearSession).toBe(false);
  });

  it("classifies connectionReplaced (440) as no-reconnect", () => {
    const result = classifyDisconnect(makeError(440));
    expect(result.category).toBe("connection_replaced");
    expect(result.shouldReconnect).toBe(false);
    expect(result.shouldClearSession).toBe(false);
  });

  it("classifies restartRequired (515) as transient", () => {
    const result = classifyDisconnect(makeError(515));
    expect(result.category).toBe("restart_required");
    expect(result.shouldReconnect).toBe(true);
  });

  it("classifies unavailableService (503) as transient", () => {
    const result = classifyDisconnect(makeError(503));
    expect(result.category).toBe("service_unavailable");
    expect(result.shouldReconnect).toBe(true);
  });

  it("classifies multideviceMismatch (411) as no-reconnect", () => {
    const result = classifyDisconnect(makeError(411));
    expect(result.category).toBe("multidevice_mismatch");
    expect(result.shouldReconnect).toBe(false);
  });

  it("disambiguates 408 as connection_lost", () => {
    const result = classifyDisconnect(makeError(408, "connection lost"));
    expect(result.category).toBe("connection_lost");
    expect(result.shouldReconnect).toBe(true);
  });

  it("disambiguates 408 as timed_out for QR", () => {
    const result = classifyDisconnect(makeError(408, "QR refs attempts ended"));
    expect(result.category).toBe("timed_out");
    expect(result.shouldReconnect).toBe(false);
  });

  it("handles undefined error", () => {
    const result = classifyDisconnect(undefined);
    expect(result.category).toBe("unknown");
    expect(result.shouldReconnect).toBe(true);
    expect(result.shouldClearSession).toBe(false);
  });

  it("handles error without status code", () => {
    const result = classifyDisconnect(new Error("random error"));
    expect(result.category).toBe("unknown");
    expect(result.shouldReconnect).toBe(true);
  });
});
