import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AuthenticationCreds } from "../whatsapp/types.js";

/**
 * Tests for FileAuthStateStore.
 *
 * Mocks the filesystem and Baileys' useMultiFileAuthState/makeCacheableSignalKeyStore
 * to test auth state persistence logic.
 */

// ── Mock state ───────────────────────────────────────────────────────────────

const mockSaveCredsFn = vi.fn(async () => {});
const mockAuthState = {
  creds: { registered: false } as Record<string, unknown>,
  keys: {
    get: vi.fn(async () => ({})),
    set: vi.fn(async () => {}),
  },
};

vi.mock("@whiskeysockets/baileys", () => ({
  useMultiFileAuthState: vi.fn(async () => ({
    state: mockAuthState,
    saveCreds: mockSaveCredsFn,
  })),
  makeCacheableSignalKeyStore: vi.fn((keys: unknown) => keys),
}));

vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () => '{"registered": true}'),
  rm: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));

const fsMock = await import("node:fs/promises");
const { FileAuthStateStore } = await import("../whatsapp/auth-state.js");

// ── Tests ────────────────────────────────────────────────────────────────────

describe("FileAuthStateStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("throws on empty folder path", () => {
      expect(() => new FileAuthStateStore("")).toThrow("must not be empty");
    });

    it("throws on whitespace-only folder path", () => {
      expect(() => new FileAuthStateStore("   ")).toThrow("must not be empty");
    });

    it("accepts a valid folder path", () => {
      expect(() => new FileAuthStateStore("/tmp/test-auth")).not.toThrow();
    });
  });

  describe("loadState", () => {
    it("delegates to useMultiFileAuthState", async () => {
      const store = new FileAuthStateStore("/tmp/test-auth");
      const state = await store.loadState();

      const baileys = await import("@whiskeysockets/baileys");
      expect(baileys.useMultiFileAuthState).toHaveBeenCalledWith(
        "/tmp/test-auth",
      );
      expect(state.creds).toBe(mockAuthState.creds);
    });

    it("wraps keys with makeCacheableSignalKeyStore", async () => {
      const store = new FileAuthStateStore("/tmp/test-auth");
      await store.loadState();

      const baileys = await import("@whiskeysockets/baileys");
      expect(baileys.makeCacheableSignalKeyStore).toHaveBeenCalledWith(
        mockAuthState.keys,
      );
    });
  });

  describe("saveCreds", () => {
    it("calls the Baileys saveCreds function", async () => {
      const store = new FileAuthStateStore("/tmp/test-auth");
      await store.loadState();
      await store.saveCreds({} as AuthenticationCreds);

      expect(mockSaveCredsFn).toHaveBeenCalledOnce();
    });

    it("throws if loadState was not called first", async () => {
      const store = new FileAuthStateStore("/tmp/test-auth");
      await expect(store.saveCreds({} as AuthenticationCreds)).rejects.toThrow(
        "loadState() must be called",
      );
    });
  });

  describe("clearState", () => {
    it("removes the auth directory recursively", async () => {
      const store = new FileAuthStateStore("/tmp/test-auth");
      await store.clearState();

      expect(fsMock.rm).toHaveBeenCalledWith("/tmp/test-auth", {
        recursive: true,
        force: true,
      });
    });

    it("ignores ENOENT errors (already cleared)", async () => {
      vi.mocked(fsMock.rm).mockRejectedValueOnce(
        Object.assign(new Error("no such file"), { code: "ENOENT" }),
      );
      const store = new FileAuthStateStore("/tmp/test-auth");
      await expect(store.clearState()).resolves.not.toThrow();
    });

    it("rethrows non-ENOENT errors", async () => {
      vi.mocked(fsMock.rm).mockRejectedValueOnce(
        Object.assign(new Error("permission denied"), { code: "EACCES" }),
      );
      const store = new FileAuthStateStore("/tmp/test-auth");
      await expect(store.clearState()).rejects.toThrow("permission denied");
    });

    it("nullifies internal state after clearing", async () => {
      const store = new FileAuthStateStore("/tmp/test-auth");
      await store.loadState();
      await store.clearState();

      // saveCreds should fail because internal state was cleared
      await expect(store.saveCreds({} as AuthenticationCreds)).rejects.toThrow(
        "loadState() must be called",
      );
    });
  });

  describe("hasExistingState", () => {
    it("returns true when creds.json exists with registered=true", async () => {
      vi.mocked(fsMock.access).mockResolvedValueOnce(undefined);
      vi.mocked(fsMock.readFile).mockResolvedValueOnce(
        '{"registered": true}',
      );

      const store = new FileAuthStateStore("/tmp/test-auth");
      expect(await store.hasExistingState()).toBe(true);
    });

    it("returns false when creds.json has registered=false", async () => {
      vi.mocked(fsMock.access).mockResolvedValueOnce(undefined);
      vi.mocked(fsMock.readFile).mockResolvedValueOnce(
        '{"registered": false}',
      );

      const store = new FileAuthStateStore("/tmp/test-auth");
      expect(await store.hasExistingState()).toBe(false);
    });

    it("returns false when creds.json does not exist", async () => {
      vi.mocked(fsMock.access).mockRejectedValueOnce(
        Object.assign(new Error("no file"), { code: "ENOENT" }),
      );

      const store = new FileAuthStateStore("/tmp/test-auth");
      expect(await store.hasExistingState()).toBe(false);
    });

    it("returns false when creds.json is invalid JSON", async () => {
      vi.mocked(fsMock.access).mockResolvedValueOnce(undefined);
      vi.mocked(fsMock.readFile).mockResolvedValueOnce("not json");

      const store = new FileAuthStateStore("/tmp/test-auth");
      expect(await store.hasExistingState()).toBe(false);
    });
  });
});
