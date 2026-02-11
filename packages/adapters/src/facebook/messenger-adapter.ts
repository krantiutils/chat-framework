import type { Page, KeyInput } from "puppeteer";
import {
  SessionStateMachine,
  ActionOrchestrator,
  FallbackMouseProvider,
  FallbackKeyboardProvider,
} from "@chat-framework/core";
import type {
  MessagingClient,
  MessagingEvent,
  MessagingEventMap,
  Conversation,
  Message,
  MessageContent,
  User,
} from "@chat-framework/core";
import {
  StealthBrowser,
  FingerprintManager,
} from "@chat-framework/browser";
import type { StealthBrowserInstance, BrowserProfile } from "@chat-framework/browser";

import type { FacebookMessengerConfig } from "./types.js";
import { resolveSelectors } from "./selectors.js";
import { PuppeteerActionExecutor } from "./page-executor.js";
import { MessengerAuth } from "./auth.js";
import { MessengerDomParser } from "./dom-parser.js";

/** Messenger base URL. */
const MESSENGER_URL = "https://www.messenger.com";

/** Default timeout for element waits (ms). */
const DEFAULT_ELEMENT_TIMEOUT = 30_000;

/** Default polling interval for new messages (ms). */
const DEFAULT_POLL_INTERVAL = 2_000;

/**
 * Facebook Messenger adapter implementing the unified MessagingClient interface.
 *
 * This is a Tier C adapter: it uses browser automation (Puppeteer) with full
 * Human Simulation Engine integration to interact with messenger.com while
 * evading bot detection.
 *
 * Architecture:
 * ```
 * FacebookMessengerAdapter
 *   ├── StealthBrowser (fingerprint + proxy + stealth evasions)
 *   ├── ActionOrchestrator (human-like mouse + keyboard sequencing)
 *   │   ├── SessionStateMachine (behavioral state: idle/active/reading/etc.)
 *   │   ├── FallbackMouseProvider (Bezier trajectories + jitter + overshoot)
 *   │   └── FallbackKeyboardProvider (WPM timing + digraphs + typos)
 *   ├── MessengerAuth (login flow with human-like credential entry)
 *   └── MessengerDomParser (DOM → Message parsing with deduplication)
 * ```
 *
 * Usage:
 * ```ts
 * const adapter = new FacebookMessengerAdapter({
 *   credentials: { email: "user@example.com", password: "..." },
 *   userDataDir: "/path/to/session",
 *   headless: true,
 * });
 *
 * adapter.on("message", (msg) => {
 *   console.log(`${msg.sender.displayName}: ${msg.content.text}`);
 * });
 *
 * await adapter.connect();
 * ```
 */
export class FacebookMessengerAdapter implements MessagingClient {
  private readonly _config: FacebookMessengerConfig;
  private readonly _selectors: ReturnType<typeof resolveSelectors>;
  private readonly _timeoutMs: number;
  private readonly _pollIntervalMs: number;

  private _browser: StealthBrowser | null = null;
  private _instance: StealthBrowserInstance | null = null;
  private _orchestrator: ActionOrchestrator | null = null;
  private _auth: MessengerAuth | null = null;
  private _domParser: MessengerDomParser | null = null;
  private _stateMachine: SessionStateMachine | null = null;
  private _connected = false;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _currentConversation: Conversation | null = null;
  private _selfUser: User | null = null;

  /** Event listeners keyed by event name. */
  private readonly _listeners: Map<string, Set<(...args: unknown[]) => void>> =
    new Map();

  constructor(config: FacebookMessengerConfig) {
    this._config = config;
    this._selectors = resolveSelectors(config.selectorOverrides);
    this._timeoutMs = config.elementTimeoutMs ?? DEFAULT_ELEMENT_TIMEOUT;
    this._pollIntervalMs =
      config.messagePollingIntervalMs ?? DEFAULT_POLL_INTERVAL;
  }

  // ── Connection ──────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this._connected) {
      throw new Error("FacebookMessengerAdapter: already connected");
    }

    // 1. Resolve or generate browser profile
    const profile = this._config.browserProfile ?? this._generateProfile();

    // 2. Launch stealth browser
    this._browser = new StealthBrowser();
    this._instance = await this._browser.launch({
      profile,
      headless: this._config.headless ?? true,
      userDataDir: this._config.userDataDir,
    });

    const page = this._instance.page;

    // 3. Set up Human Simulation Engine
    this._stateMachine = new SessionStateMachine({
      profile: this._config.sessionProfile,
    });

    const executor = new PuppeteerActionExecutor(page);
    const mouseProvider = new FallbackMouseProvider();
    const keyboardProvider = new FallbackKeyboardProvider();

    this._orchestrator = new ActionOrchestrator({
      stateMachine: this._stateMachine,
      executor,
      mouseProvider,
      keyboardProvider,
    });

    // 4. Authenticate
    this._auth = new MessengerAuth(
      page,
      this._orchestrator,
      this._selectors,
      this._timeoutMs,
    );

    const alreadyAuth = await this._auth.navigateAndCheckSession();
    if (!alreadyAuth) {
      const result = await this._auth.login(
        this._config.credentials.email,
        this._config.credentials.password,
      );

      if (result.status === "two_factor_required") {
        throw new Error(
          "FacebookMessengerAdapter: Two-factor authentication required. " +
            "Use submitTwoFactorCode() or provide a session directory with an " +
            "already-authenticated session via userDataDir.",
        );
      }

      if (result.status === "failed") {
        await this._cleanup();
        throw new Error(
          `FacebookMessengerAdapter: Login failed: ${result.reason}`,
        );
      }
    }

    // 5. Initialize DOM parser and build self-user
    this._domParser = new MessengerDomParser(page, this._selectors);
    this._selfUser = await this._extractSelfUser(page);

    // 6. Mark existing messages as seen (don't re-emit old messages)
    await this._domParser.markAllAsSeen();

    // 7. Start message polling
    this._startPolling();

    this._connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;

    this._stopPolling();

    if (this._orchestrator) {
      this._orchestrator.abort();
    }

    await this._cleanup();
    this._connected = false;
  }

  isConnected(): boolean {
    return this._connected;
  }

  // ── Sending ─────────────────────────────────────────────────────────────────

  async sendText(conversation: Conversation, text: string): Promise<Message> {
    this._ensureConnected();

    await this._navigateToConversation(conversation);

    const page = this._getPage();

    // Find and click the message input
    const inputEl = await page.waitForSelector(this._selectors.messageInput, {
      timeout: this._timeoutMs,
      visible: true,
    });

    if (!inputEl) {
      throw new Error("FacebookMessengerAdapter: Message input not found");
    }

    const inputBox = await inputEl.boundingBox();
    if (!inputBox) {
      throw new Error("FacebookMessengerAdapter: Message input not visible");
    }

    // Click input with human sim
    await this._getOrchestrator().execute({
      type: "click",
      target: {
        x: inputBox.x + inputBox.width / 2,
        y: inputBox.y + inputBox.height / 2,
      },
    });

    // Type message with human sim
    await this._getOrchestrator().execute({
      type: "type",
      text,
    });

    // Brief pause before sending (human reads what they typed)
    await this._getOrchestrator().execute({
      type: "wait",
      minMs: 200,
      maxMs: 800,
    });

    // Press Enter to send
    await page.keyboard.press("Enter");

    // Wait for message to appear in the DOM
    await this._sleep(1000);

    // Construct the sent message
    const message: Message = {
      id: `sent-${Date.now()}`,
      conversation,
      sender: this._getSelfUser(),
      timestamp: new Date(),
      content: { type: "text", text },
    };

    return message;
  }

  async sendImage(
    conversation: Conversation,
    image: string,
    caption?: string,
  ): Promise<Message> {
    this._ensureConnected();

    await this._navigateToConversation(conversation);

    const page = this._getPage();

    // Find the file input element (hidden, but functional)
    const fileInput = await page.$(this._selectors.fileInput);
    if (!fileInput) {
      // Try clicking the attachment button to reveal the file input
      const attachBtn = await page.waitForSelector(
        this._selectors.attachmentButton,
        { timeout: this._timeoutMs, visible: true },
      );

      if (attachBtn) {
        const btnBox = await attachBtn.boundingBox();
        if (btnBox) {
          await this._getOrchestrator().execute({
            type: "click",
            target: {
              x: btnBox.x + btnBox.width / 2,
              y: btnBox.y + btnBox.height / 2,
            },
          });
          await this._sleep(500);
        }
      }
    }

    // Upload the file via the input element
    const input = await page.$(this._selectors.fileInput);
    if (!input) {
      throw new Error("FacebookMessengerAdapter: File input not found");
    }

    await (input as unknown as { uploadFile(path: string): Promise<void> }).uploadFile(image);

    // Wait for upload to process
    await this._sleep(2000);

    // Add caption if provided
    if (caption) {
      const inputEl = await page.waitForSelector(this._selectors.messageInput, {
        timeout: this._timeoutMs,
        visible: true,
      });
      if (inputEl) {
        const box = await inputEl.boundingBox();
        if (box) {
          await this._getOrchestrator().execute({
            type: "click",
            target: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          });
          await this._getOrchestrator().execute({
            type: "type",
            text: caption,
          });
        }
      }
    }

    // Send
    await page.keyboard.press("Enter");
    await this._sleep(1000);

    return {
      id: `sent-img-${Date.now()}`,
      conversation,
      sender: this._getSelfUser(),
      timestamp: new Date(),
      content: { type: "image", url: image, caption },
    };
  }

  async sendFile(
    conversation: Conversation,
    file: string,
    filename: string,
  ): Promise<Message> {
    this._ensureConnected();

    await this._navigateToConversation(conversation);

    const page = this._getPage();

    // Click attachment button
    const attachBtn = await page.waitForSelector(
      this._selectors.attachmentButton,
      { timeout: this._timeoutMs, visible: true },
    );
    if (attachBtn) {
      const btnBox = await attachBtn.boundingBox();
      if (btnBox) {
        await this._getOrchestrator().execute({
          type: "click",
          target: {
            x: btnBox.x + btnBox.width / 2,
            y: btnBox.y + btnBox.height / 2,
          },
        });
        await this._sleep(500);
      }
    }

    const input = await page.$(this._selectors.fileInput);
    if (!input) {
      throw new Error("FacebookMessengerAdapter: File input not found");
    }

    await (input as unknown as { uploadFile(path: string): Promise<void> }).uploadFile(file);
    await this._sleep(2000);

    await page.keyboard.press("Enter");
    await this._sleep(1000);

    return {
      id: `sent-file-${Date.now()}`,
      conversation,
      sender: this._getSelfUser(),
      timestamp: new Date(),
      content: { type: "file", url: file, filename, size: 0 },
    };
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  on<E extends MessagingEvent>(
    event: E,
    handler: MessagingEventMap[E],
  ): () => void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    const listeners = this._listeners.get(event)!;
    const wrappedHandler = handler as (...args: unknown[]) => void;
    listeners.add(wrappedHandler);

    return () => {
      listeners.delete(wrappedHandler);
    };
  }

  // ── Interactions ────────────────────────────────────────────────────────────

  async react(message: Message, emoji: string): Promise<void> {
    this._ensureConnected();

    await this._navigateToConversation(message.conversation);

    const page = this._getPage();

    // Find the message element and hover to reveal reaction trigger
    const messageRows = await page.$$(this._selectors.messageRow);

    // Find the row matching our message (by text content match)
    for (const row of messageRows) {
      const text = await row.evaluate((el: Element) => el.textContent);
      if (
        message.content.type === "text" &&
        text?.includes(message.content.text)
      ) {
        // Hover over the message to reveal reaction button
        const box = await row.boundingBox();
        if (box) {
          await this._getOrchestrator().execute({
            type: "hover",
            target: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          });
          await this._sleep(500);
        }
        break;
      }
    }

    // Click reaction trigger
    const reactionTrigger = await page.waitForSelector(
      this._selectors.reactionTrigger,
      { timeout: 5000, visible: true },
    );
    if (reactionTrigger) {
      const triggerBox = await reactionTrigger.boundingBox();
      if (triggerBox) {
        await this._getOrchestrator().execute({
          type: "click",
          target: {
            x: triggerBox.x + triggerBox.width / 2,
            y: triggerBox.y + triggerBox.height / 2,
          },
        });
        await this._sleep(500);
      }
    }

    // Find and click the emoji in the reaction picker
    const emojiButtons = await page.$$(this._selectors.reactionEmoji);
    for (const btn of emojiButtons) {
      const label = await btn.evaluate((el: Element) => el.getAttribute("aria-label"));
      if (label?.includes(emoji)) {
        const emojiBox = await btn.boundingBox();
        if (emojiBox) {
          await this._getOrchestrator().execute({
            type: "click",
            target: {
              x: emojiBox.x + emojiBox.width / 2,
              y: emojiBox.y + emojiBox.height / 2,
            },
          });
        }
        break;
      }
    }
  }

  async reply(message: Message, content: MessageContent): Promise<Message> {
    this._ensureConnected();

    if (content.type !== "text") {
      throw new Error(
        `FacebookMessengerAdapter: Reply with ${content.type} not yet supported`,
      );
    }

    // For now, reply is implemented as sending a text message to the same
    // conversation. Full reply-threading support (hovering reply arrow, etc.)
    // would require additional DOM interaction.
    return this.sendText(message.conversation, content.text);
  }

  async delete(message: Message): Promise<void> {
    this._ensureConnected();

    // Message deletion on Messenger requires a specific interaction flow:
    // hover message → click "..." menu → click "Remove" → confirm
    // This is fragile and not critical for initial implementation.
    throw new Error(
      "FacebookMessengerAdapter: Message deletion not yet implemented",
    );
  }

  // ── Presence ────────────────────────────────────────────────────────────────

  async setTyping(
    conversation: Conversation,
    durationMs?: number,
  ): Promise<void> {
    this._ensureConnected();

    await this._navigateToConversation(conversation);

    const page = this._getPage();
    const inputEl = await page.waitForSelector(this._selectors.messageInput, {
      timeout: this._timeoutMs,
      visible: true,
    });
    if (!inputEl) return;

    const box = await inputEl.boundingBox();
    if (!box) return;

    // Click into the input to focus it
    await this._getOrchestrator().execute({
      type: "click",
      target: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    });

    // Type a few characters and delete them to trigger typing indicator
    // This is a common pattern for simulating "typing" without sending
    const dummyText = "...";
    for (const char of dummyText) {
      await page.keyboard.press(char as KeyInput);
      await this._sleep(100);
    }

    // Wait the requested duration
    await this._sleep(durationMs ?? 2000);

    // Delete the dummy text
    for (let i = 0; i < dummyText.length; i++) {
      await page.keyboard.press("Backspace" as KeyInput);
      await this._sleep(50);
    }
  }

  async markRead(message: Message): Promise<void> {
    this._ensureConnected();

    // Navigating to the conversation and scrolling to the message
    // automatically marks it as read in Messenger
    await this._navigateToConversation(message.conversation);

    // Brief interaction to trigger read receipt
    await this._sleep(500);
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  async getConversations(): Promise<Conversation[]> {
    this._ensureConnected();

    const page = this._getPage();

    // Ensure we're on the main messenger page
    if (!page.url().startsWith(MESSENGER_URL)) {
      await page.goto(MESSENGER_URL, {
        waitUntil: "networkidle2",
        timeout: this._timeoutMs,
      });
    }

    // Wait for conversation list
    await page.waitForSelector(this._selectors.conversationList, {
      timeout: this._timeoutMs,
    });

    // Extract conversation data from the sidebar
    const convLinks = await page.$$(this._selectors.conversationLink);
    const conversations: Conversation[] = [];

    for (const link of convLinks) {
      const href = await link.evaluate((el: Element) => el.getAttribute("href"));
      const text = await link.evaluate(
        (el: Element) => el.textContent?.trim() ?? "",
      );

      if (href) {
        // Extract conversation ID from URL: /t/123456789
        const match = href.match(/\/t\/(\d+)/);
        const id = match ? match[1] : href;

        conversations.push({
          id,
          platform: "facebook",
          participants: [],
          type: "dm",
          metadata: { href, displayName: text },
        });
      }
    }

    return conversations;
  }

  async getMessages(
    conversation: Conversation,
    limit?: number,
    _before?: Date,
  ): Promise<Message[]> {
    this._ensureConnected();

    await this._navigateToConversation(conversation);

    const parser = this._getDomParser();
    const messages = await parser.parseVisibleMessages(
      conversation,
      this._getSelfUser(),
    );

    if (limit !== undefined) {
      return messages.slice(-limit);
    }

    return messages;
  }

  // ── Facebook-specific methods ───────────────────────────────────────────────

  /**
   * Submit a 2FA code after receiving a two_factor_required error.
   * Call this, then call connect() again.
   */
  async submitTwoFactorCode(code: string): Promise<void> {
    if (!this._auth) {
      throw new Error(
        "FacebookMessengerAdapter: Must attempt connect() before submitting 2FA",
      );
    }

    const result = await this._auth.submitTwoFactorCode(code);
    if (result.status === "failed") {
      throw new Error(
        `FacebookMessengerAdapter: 2FA failed: ${result.reason}`,
      );
    }
  }

  /**
   * Access the underlying page for advanced use cases.
   * Use with caution — direct page manipulation may interfere with
   * the adapter's state tracking.
   */
  getPage(): Page | null {
    return this._instance?.page ?? null;
  }

  // ── Private Helpers ─────────────────────────────────────────────────────────

  private _generateProfile(): BrowserProfile {
    const fpManager = new FingerprintManager();
    const profileId = fpManager.generateProfileId();
    return {
      id: profileId,
      fingerprint: fpManager.generate(profileId),
      proxy: this._config.proxy,
      createdAt: new Date().toISOString(),
    };
  }

  private async _navigateToConversation(
    conversation: Conversation,
  ): Promise<void> {
    // Skip if already on this conversation
    if (this._currentConversation?.id === conversation.id) {
      return;
    }

    const page = this._getPage();
    const convUrl = `${MESSENGER_URL}/t/${conversation.id}`;

    await page.goto(convUrl, {
      waitUntil: "networkidle2",
      timeout: this._timeoutMs,
    });

    // Wait for message input to be available (indicates conversation loaded)
    await page.waitForSelector(this._selectors.messageInput, {
      timeout: this._timeoutMs,
    });

    // Reset DOM parser seen messages for the new conversation
    this._getDomParser().resetSeen();
    await this._getDomParser().markAllAsSeen();

    this._currentConversation = conversation;
  }

  private async _extractSelfUser(page: Page): Promise<User> {
    // Try to extract the logged-in user's info from the page
    const userName = await page.evaluate(() => {
      // Facebook stores user info in various places. Try common patterns:
      // 1. Profile link in navigation
      const profileLink = document.querySelector(
        'a[href*="/me"], a[aria-label*="Profile"]',
      );
      if (profileLink) {
        return profileLink.textContent?.trim() ?? null;
      }
      // 2. Account settings area
      const accountEl = document.querySelector(
        '[data-testid="user-menu"], [aria-label="Account"]',
      );
      if (accountEl) {
        return accountEl.textContent?.trim() ?? null;
      }
      return null;
    });

    return {
      id: this._config.credentials.email,
      platform: "facebook",
      displayName: userName ?? this._config.credentials.email,
    };
  }

  private _startPolling(): void {
    if (this._pollTimer) return;

    this._pollTimer = setInterval(() => {
      this._pollNewMessages().catch((err) => {
        console.error("FacebookMessengerAdapter: polling error:", err);
      });
    }, this._pollIntervalMs);
  }

  private _stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private async _pollNewMessages(): Promise<void> {
    if (!this._connected || !this._currentConversation) return;

    const parser = this._getDomParser();
    const newMessages = await parser.parseNewMessages(
      this._currentConversation,
      this._getSelfUser(),
    );

    for (const msg of newMessages) {
      // Don't emit our own sent messages
      if (msg.sender.id === this._getSelfUser().id) continue;
      this._emit("message", msg);
    }
  }

  private _emit(event: string, ...args: unknown[]): void {
    const listeners = this._listeners.get(event);
    if (!listeners) return;

    for (const listener of listeners) {
      try {
        listener(...args);
      } catch (err) {
        console.error(
          `FacebookMessengerAdapter: listener error on "${event}":`,
          err,
        );
      }
    }
  }

  private async _cleanup(): Promise<void> {
    this._stopPolling();
    if (this._instance) {
      try {
        await this._instance.close();
      } catch {
        // Best effort cleanup
      }
      this._instance = null;
    }
    this._browser = null;
    this._orchestrator = null;
    this._auth = null;
    this._domParser = null;
    this._stateMachine = null;
    this._currentConversation = null;
    this._selfUser = null;
  }

  private _ensureConnected(): void {
    if (!this._connected) {
      throw new Error("FacebookMessengerAdapter: not connected");
    }
  }

  private _getPage(): Page {
    if (!this._instance) {
      throw new Error("FacebookMessengerAdapter: no browser instance");
    }
    return this._instance.page;
  }

  private _getOrchestrator(): ActionOrchestrator {
    if (!this._orchestrator) {
      throw new Error("FacebookMessengerAdapter: no orchestrator");
    }
    return this._orchestrator;
  }

  private _getDomParser(): MessengerDomParser {
    if (!this._domParser) {
      throw new Error("FacebookMessengerAdapter: no DOM parser");
    }
    return this._domParser;
  }

  private _getSelfUser(): User {
    if (!this._selfUser) {
      throw new Error("FacebookMessengerAdapter: self user not initialized");
    }
    return this._selfUser;
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
