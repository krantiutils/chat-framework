/**
 * Auth state persistence for WhatsApp sessions.
 *
 * Provides a file-system-backed implementation of {@link AuthStateStore}
 * suitable for development and single-instance deployments.
 *
 * For production (multi-instance, database-backed), implement the
 * {@link AuthStateStore} interface directly against your storage layer.
 */
import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";

import type {
  AuthenticationCreds,
  AuthenticationState,
  AuthStateStore,
} from "./types.js";

/** Path to the credentials file within the auth state directory. */
const CREDS_FILENAME = "creds.json";

/**
 * File-system-backed auth state store.
 *
 * Wraps Baileys' `useMultiFileAuthState` for credential and key persistence.
 * All state is stored under a single directory as JSON files.
 *
 * This store is suitable for development, testing, and single-instance
 * deployments. It is NOT recommended for multi-instance production use
 * because file-level locking is insufficient for concurrent access.
 *
 * @example
 * ```typescript
 * const store = new FileAuthStateStore("./auth_data/my-account");
 * const sessionManager = new WhatsAppSessionManager({ authStore: store });
 * await sessionManager.connect();
 * ```
 */
export class FileAuthStateStore implements AuthStateStore {
  private readonly folder: string;
  private baileysState: AuthenticationState | null = null;
  private saveFn: (() => Promise<void>) | null = null;

  /**
   * @param folder - Directory path where auth state files will be stored.
   *                 Created automatically if it doesn't exist.
   */
  constructor(folder: string) {
    if (!folder || folder.trim().length === 0) {
      throw new Error("FileAuthStateStore: folder path must not be empty");
    }
    this.folder = folder;
  }

  async loadState(): Promise<AuthenticationState> {
    const { state, saveCreds } = await useMultiFileAuthState(this.folder);
    this.baileysState = state;
    this.saveFn = saveCreds;

    // Wrap the key store with Baileys' caching layer
    // to reduce file I/O on hot paths (message encrypt/decrypt).
    return {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async saveCreds(creds: AuthenticationCreds): Promise<void> {
    if (!this.saveFn) {
      throw new Error(
        "FileAuthStateStore: loadState() must be called before saveCreds()",
      );
    }
    // Baileys' saveCreds writes the current creds object (mutated in-place
    // by the socket) to disk. The `creds` parameter from the session manager
    // is the full merged state — Baileys has already merged partial updates
    // into state.creds by the time this callback fires.
    await this.saveFn();
  }

  async clearState(): Promise<void> {
    this.baileysState = null;
    this.saveFn = null;

    try {
      await rm(this.folder, { recursive: true, force: true });
    } catch (err) {
      // If the directory doesn't exist, that's fine — already cleared.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  async hasExistingState(): Promise<boolean> {
    try {
      await access(join(this.folder, CREDS_FILENAME));

      // File exists — check if it's a valid creds file with registered=true.
      const raw = await readFile(join(this.folder, CREDS_FILENAME), "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return parsed.registered === true;
    } catch {
      return false;
    }
  }
}
