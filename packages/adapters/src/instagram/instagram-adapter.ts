/**
 * Instagram adapter — Tier C browser automation with Human Simulation Engine.
 *
 * Implements the unified MessagingClient interface for Instagram DMs using
 * Puppeteer + stealth plugins + HSE (session state machine, realistic
 * mouse/keyboard simulation).
 *
 * Architecture:
 * - StealthBrowser: anti-detection browser instance
 * - SessionStateMachine: behavioral state (IDLE/ACTIVE/READING/etc.)
 * - HumanSimulator: realistic mouse/keyboard via CDP
 * - InstagramAuth: login + session persistence
 * - InstagramDM: inbox/thread DOM operations
 */

import { EventEmitter } from "node:events";
import type { Page } from "puppeteer";

import {
  SessionStateMachine,
  SessionState,
} from "@chat-framework/core";
import type {
  Conversation,
  Message,
  MessageContent,
  MessagingEvents,
  Reaction,
  User,
  PresenceStatus,
} from "@chat-framework/core";
import type { MessagingClient, EventHandler } from "@chat-framework/core";
import { UnsupportedOperationError } from "@chat-framework/core";
import {
  StealthBrowser,
  FingerprintManager,
} from "@chat-framework/browser";
import type { StealthBrowserInstance } from "@chat-framework/browser";

import { HumanSimulator } from "./human-simulator.js";
import { InstagramAuth } from "./auth.js";
import type { AuthResult } from "./auth.js";
import { InstagramDM } from "./dm.js";
import type { InstagramAdapterConfig, RawInstagramMessage } from "./types.js";

/** Instagram platform identifier. */
const PLATFORM = "instagram" as const;

/**
 * Instagram adapter implementing the unified MessagingClient interface.
 *
 * Usage:
 * ```ts
 * const ig = new InstagramAdapter({
 *   credentials: { username: 'user', password: 'pass' },
 *   userDataDir: './session-data/instagram',
 * });
 *
 * ig.on('message', (msg) => console.log(msg));
 * await ig.connect();
 * await ig.sendText(conversation, 'Hello!');
 * await ig.disconnect();
 * ```
 */
export class InstagramAdapter implements MessagingClient {
  readonly platform = PLATFORM;

  private readonly config: Required<
    Pick<InstagramAdapterConfig, "credentials" | "userDataDir">
  > & InstagramAdapterConfig;

  private readonly emitter = new EventEmitter();
  private readonly session: SessionStateMachine;
  private readonly stealthBrowser: StealthBrowser;
  private readonly fingerprintManager: FingerprintManager;

  private browserInstance: StealthBrowserInstance | null = null;
  private sim: HumanSimulator | null = null;
  private auth: InstagramAuth | null = null;
  private dm: InstagramDM | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private currentThreadId: string | null = null;

  /** Guards against concurrent page operations (polling vs. user actions). */
  private busy = false;

  /** Self user populated after login. */
  private selfUser: User | null = null;

  constructor(config: InstagramAdapterConfig) {
    this.config = config;
    this.session = new SessionStateMachine();
    this.stealthBrowser = new StealthBrowser();
    this.fingerprintManager = new FingerprintManager();
  }

  // ── Connection ──────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connected) return;

    // Generate a consistent fingerprint for this profile.
    // Same profileId always produces the same fingerprint (deterministic).
    const profileId = `ig-${this.config.credentials.username}`;
    const fingerprint = this.fingerprintManager.generate(profileId, {
      platform: "win32",
      browser: "chrome",
    });

    const profile = {
      id: profileId,
      fingerprint,
      proxy: this.config.proxy
        ? {
            host: this.config.proxy.host,
            port: this.config.proxy.port,
            protocol: this.config.proxy.protocol,
            username: this.config.proxy.username,
            password: this.config.proxy.password,
          }
        : undefined,
      createdAt: new Date().toISOString(),
    };

    // Launch stealth browser
    this.browserInstance = await this.stealthBrowser.launch({
      profile,
      headless: this.config.headless ?? true,
      userDataDir: this.config.userDataDir,
    });

    const page = this.browserInstance.page;
    page.setDefaultTimeout(this.config.navigationTimeoutMs ?? 30_000);

    // Initialize human simulator
    this.sim = new HumanSimulator({
      page,
      session: this.session,
      mouseProvider: this.config.mouseProvider,
      keystrokeProvider: this.config.keystrokeProvider,
    });
    await this.sim.init();

    // Initialize auth
    this.auth = new InstagramAuth(
      page,
      this.sim,
      this.config.credentials,
      this.config.navigationTimeoutMs ?? 30_000,
    );

    // Check for existing session or perform login
    const hasSession = await this.auth.hasValidSession();
    if (!hasSession) {
      const result = await this.auth.login();
      this.handleAuthResult(result);
    }

    // Navigate to DM inbox
    await this.auth.navigateToInbox();

    // Initialize DM module
    this.dm = new InstagramDM(
      page,
      this.sim,
      this.config.navigationTimeoutMs ?? 30_000,
    );

    // Populate self user
    this.selfUser = {
      id: this.config.credentials.username,
      platform: PLATFORM,
      username: this.config.credentials.username,
    };

    this.connected = true;
    this.emitter.emit("connected");

    // Start polling for new messages
    this.startPolling();
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    this.stopPolling();

    // Clean up HumanSimulator CDP session
    if (this.sim) {
      await this.sim.dispose();
      this.sim = null;
    }

    if (this.browserInstance) {
      try {
        await this.browserInstance.close();
      } catch (err) {
        console.error("InstagramAdapter: error closing browser:", err);
      }
      this.browserInstance = null;
    }

    this.auth = null;
    this.dm = null;
    this.connected = false;
    this.currentThreadId = null;
    this.emitter.emit("disconnected");
    this.emitter.removeAllListeners();
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── Sending ─────────────────────────────────────────────────

  async sendText(conversation: Conversation, text: string): Promise<Message> {
    this.ensureConnected();
    this.busy = true;
    try {
      // Navigate to the thread if not already there
      await this.ensureThread(conversation.id);

      // HSE: simulate reading before responding
      await this.sim!.stateAwareDelay();

      const messageId = await this.dm!.sendMessage(text);

      return this.buildMessage(messageId, conversation, { type: "text", text });
    } finally {
      this.busy = false;
    }
  }

  async sendImage(
    conversation: Conversation,
    _image: Uint8Array | string,
    _caption?: string,
  ): Promise<Message> {
    this.ensureConnected();
    // Instagram DM image sending requires file upload interaction
    // which needs the file chooser dialog handling
    throw new UnsupportedOperationError(
      PLATFORM,
      "sendImage (not yet implemented — requires file upload automation)",
    );
  }

  async sendAudio(
    _conversation: Conversation,
    _audio: Uint8Array | string,
  ): Promise<Message> {
    throw new UnsupportedOperationError(PLATFORM, "sendAudio");
  }

  async sendVoice(
    _conversation: Conversation,
    _voice: Uint8Array | string,
  ): Promise<Message> {
    // Instagram supports voice messages but recording requires
    // holding the mic button which is complex to automate
    throw new UnsupportedOperationError(
      PLATFORM,
      "sendVoice (not yet implemented — requires mic button hold simulation)",
    );
  }

  async sendFile(
    _conversation: Conversation,
    _file: Uint8Array | string,
    _filename: string,
  ): Promise<Message> {
    // Instagram DMs don't support arbitrary file attachments
    throw new UnsupportedOperationError(PLATFORM, "sendFile");
  }

  async sendLocation(
    _conversation: Conversation,
    _lat: number,
    _lng: number,
  ): Promise<Message> {
    throw new UnsupportedOperationError(PLATFORM, "sendLocation");
  }

  // ── Events ──────────────────────────────────────────────────

  on<K extends keyof MessagingEvents>(
    event: K,
    handler: EventHandler<K>,
  ): void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }

  off<K extends keyof MessagingEvents>(
    event: K,
    handler: EventHandler<K>,
  ): void {
    this.emitter.off(event, handler as (...args: unknown[]) => void);
  }

  // ── Interactions ────────────────────────────────────────────

  async react(message: Message, emoji: string): Promise<void> {
    this.ensureConnected();
    await this.ensureThread(message.conversation.id);

    // Find the message index by reading current messages
    const messages = await this.dm!.readMessages();
    const idx = messages.findIndex((m) => m.id === message.id);

    if (idx === -1) {
      throw new Error(`Message ${message.id} not found in current view`);
    }

    await this.dm!.reactToMessage(idx, emoji);
  }

  async reply(message: Message, content: MessageContent): Promise<Message> {
    // Instagram DM doesn't have a thread-reply UI like Telegram/Discord.
    // We just send a text message in the same conversation.
    if (content.type !== "text") {
      throw new UnsupportedOperationError(
        PLATFORM,
        `reply with content type "${content.type}"`,
      );
    }

    return this.sendText(message.conversation, content.text);
  }

  async forward(_message: Message, _to: Conversation): Promise<Message> {
    throw new UnsupportedOperationError(PLATFORM, "forward");
  }

  async delete(_message: Message): Promise<void> {
    // Instagram allows unsending messages but the UI interaction is complex
    throw new UnsupportedOperationError(
      PLATFORM,
      "delete (not yet implemented)",
    );
  }

  // ── Presence ────────────────────────────────────────────────

  async setTyping(conversation: Conversation, duration?: number): Promise<void> {
    this.ensureConnected();
    await this.ensureThread(conversation.id);

    // Focus the input and simulate typing activity
    const page = this.getPage();
    const input = await page.$('div[role="textbox"][contenteditable="true"]')
      ?? await page.$('[aria-label="Message"]');

    if (input) {
      await this.sim!.click(input);
      // Type and delete a space to trigger typing indicator
      await page.keyboard.type(" ");
      await new Promise((r) => setTimeout(r, duration ?? 2000));
      await page.keyboard.press("Backspace");
    }
  }

  async markRead(message: Message): Promise<void> {
    this.ensureConnected();
    // Opening the thread marks messages as read on Instagram
    await this.ensureThread(message.conversation.id);
  }

  // ── Conversations ───────────────────────────────────────────

  async getConversations(): Promise<Conversation[]> {
    this.ensureConnected();

    // Navigate to inbox
    await this.auth!.navigateToInbox();
    this.currentThreadId = null;

    const threads = await this.dm!.listThreads();

    return threads.map((thread) => ({
      id: thread.id,
      platform: PLATFORM,
      participants: [
        this.selfUser!,
        {
          id: thread.participantName,
          platform: PLATFORM,
          username: thread.participantName,
          displayName: thread.participantName,
        },
      ],
      type: "dm" as const,
      metadata: {
        hasUnread: thread.hasUnread,
        lastMessagePreview: thread.lastMessagePreview,
      },
    }));
  }

  async getMessages(
    conversation: Conversation,
    limit?: number,
    _before?: Date,
  ): Promise<Message[]> {
    this.ensureConnected();
    await this.ensureThread(conversation.id);

    // Scroll up to load more messages if needed
    if (limit && limit > 20) {
      const scrollTimes = Math.ceil((limit - 20) / 10);
      for (let i = 0; i < scrollTimes; i++) {
        await this.dm!.scrollToLoadMore();
      }
    }

    const raw = await this.dm!.readMessages();
    const sliced = limit ? raw.slice(-limit) : raw;

    return sliced.map((msg) =>
      this.rawToMessage(msg, conversation),
    );
  }

  // ── Internal ────────────────────────────────────────────────

  private handleAuthResult(result: AuthResult): void {
    switch (result.status) {
      case "success":
        return;
      case "two_factor_required":
        throw new Error(
          "Two-factor authentication required. " +
          "Call submitTwoFactorCode() to complete login.",
        );
      case "challenge_required":
        throw new Error(
          `Instagram challenge required: ${result.challengeUrl}. ` +
          "Manual intervention needed.",
        );
      case "error":
        throw new Error(`Instagram login failed: ${result.message}`);
    }
  }

  /**
   * Expose 2FA submission for consumers that handle it externally.
   */
  async submitTwoFactorCode(code: string): Promise<void> {
    if (!this.auth) {
      throw new Error("Auth not initialized. Call connect() first.");
    }
    const result = await this.auth.submitTwoFactorCode(code);
    this.handleAuthResult(result);
  }

  private ensureConnected(): void {
    if (!this.connected || !this.dm || !this.sim) {
      throw new Error("Instagram adapter is not connected. Call connect() first.");
    }
  }

  private getPage(): Page {
    if (!this.browserInstance) {
      throw new Error("Browser not initialized");
    }
    return this.browserInstance.page;
  }

  /**
   * Navigate to a thread if we're not already there.
   */
  private async ensureThread(threadId: string): Promise<void> {
    if (this.currentThreadId !== threadId) {
      await this.dm!.openThread(threadId);
      this.currentThreadId = threadId;
    }
  }

  /**
   * Start polling for new messages across tracked threads.
   */
  private startPolling(): void {
    const intervalMs = this.config.pollIntervalMs ?? 15_000;

    this.pollTimer = setInterval(async () => {
      // Skip this poll cycle if a user-initiated action is in progress
      if (this.busy) return;

      try {
        // Only poll the currently open thread
        if (!this.currentThreadId || !this.dm) return;

        // Tick the session state machine
        const snapshot = this.session.tick();

        // Don't poll if we're in AWAY state (simulates user being gone)
        if (snapshot.state === SessionState.AWAY) return;

        this.busy = true;
        const threadId = this.currentThreadId;
        const newMessages = await this.dm.pollNewMessages(threadId);

        for (const raw of newMessages) {
          // Skip our own outgoing messages
          if (raw.isOutgoing) continue;

          const conversation = this.buildConversation(threadId);
          const message = this.rawToMessage(raw, conversation);
          this.emitter.emit("message", message);
        }
      } catch (err) {
        this.emitter.emit(
          "error",
          err instanceof Error ? err : new Error(String(err)),
        );
      } finally {
        this.busy = false;
      }
    }, intervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private buildConversation(threadId: string, otherUsername?: string): Conversation {
    const participants: User[] = [this.selfUser!];
    if (otherUsername) {
      participants.push({
        id: otherUsername,
        platform: PLATFORM,
        username: otherUsername,
      });
    }
    return {
      id: threadId,
      platform: PLATFORM,
      participants,
      type: "dm",
      metadata: {},
    };
  }

  private buildMessage(
    id: string,
    conversation: Conversation,
    content: MessageContent,
  ): Message {
    return {
      id,
      conversation,
      sender: this.selfUser!,
      timestamp: new Date(),
      content,
    };
  }

  private rawToMessage(
    raw: RawInstagramMessage,
    conversation: Conversation,
  ): Message {
    const sender: User = raw.isOutgoing
      ? this.selfUser!
      : {
          id: raw.senderUsername || "unknown",
          platform: PLATFORM,
          username: raw.senderUsername || undefined,
        };

    return {
      id: raw.id,
      conversation,
      sender,
      timestamp: raw.timestampRaw ? new Date(raw.timestampRaw) : new Date(),
      content: { type: "text", text: raw.text },
    };
  }
}
