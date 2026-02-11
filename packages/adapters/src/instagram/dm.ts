/**
 * Instagram DM operations — send/receive messages via DOM interaction.
 *
 * All actions go through the HumanSimulator for realistic behavior.
 * Selectors are isolated in selectors.ts for easy self-healing updates.
 */

import type { Page, ElementHandle } from "puppeteer";

import type { HumanSimulator } from "./human-simulator.js";
import { SELECTORS } from "./selectors.js";
import type { RawInstagramMessage, RawInstagramThread } from "./types.js";

const INSTAGRAM_DM_THREAD = "https://www.instagram.com/direct/t/";

/**
 * Handles Instagram Direct Message operations.
 */
export class InstagramDM {
  private readonly page: Page;
  private readonly sim: HumanSimulator;
  private readonly navigationTimeoutMs: number;

  /** Track last seen message IDs per thread to detect new messages. */
  private readonly lastSeenMessageIds = new Map<string, Set<string>>();

  constructor(
    page: Page,
    sim: HumanSimulator,
    navigationTimeoutMs: number = 30_000,
  ) {
    this.page = page;
    this.sim = sim;
    this.navigationTimeoutMs = navigationTimeoutMs;
  }

  /**
   * List threads in the DM inbox.
   * Assumes the page is already on /direct/inbox/.
   */
  async listThreads(): Promise<RawInstagramThread[]> {
    await this.ensureInboxLoaded();

    return this.page.evaluate((sel) => {
      const items = document.querySelectorAll(sel.inbox.threadItem);
      const threads: RawInstagramThread[] = [];

      items.forEach((item, index) => {
        const nameEl = item.querySelector('span[dir="auto"]');
        const previewEls = item.querySelectorAll('span[dir="auto"]');
        const linkEl = item.querySelector("a[href*='/direct/t/']");

        // Extract thread ID from href
        const href = linkEl?.getAttribute("href") ?? "";
        const threadIdMatch = href.match(/\/direct\/t\/(\d+)/);

        threads.push({
          id: threadIdMatch?.[1] ?? `thread-${index}`,
          participantName: nameEl?.textContent?.trim() ?? "Unknown",
          lastMessagePreview:
            previewEls.length > 1
              ? previewEls[previewEls.length - 1]?.textContent?.trim() ?? ""
              : "",
          hasUnread: item.querySelector('[style*="font-weight: 600"]') !== null,
        });
      });

      return threads;
    }, SELECTORS);
  }

  /**
   * Open a specific DM thread by ID.
   */
  async openThread(threadId: string): Promise<void> {
    const currentUrl = this.page.url();
    const targetUrl = `${INSTAGRAM_DM_THREAD}${threadId}/`;

    if (!currentUrl.includes(`/direct/t/${threadId}`)) {
      await this.page.goto(targetUrl, {
        waitUntil: "networkidle2",
        timeout: this.navigationTimeoutMs,
      });
    }

    // Wait for the message input to confirm the thread loaded
    await this.waitForMessageInput();
  }

  /**
   * Open or create a DM thread with a specific user by username.
   * Uses the "New message" flow.
   */
  async openThreadByUsername(username: string): Promise<string> {
    // Click "New message" button
    const newMsgBtn = await this.sim.waitForSelector(
      SELECTORS.inbox.newMessageButton,
      this.navigationTimeoutMs,
    );
    await this.sim.click(newMsgBtn);

    await this.sim.stateAwareDelay();

    // Type the username in the search box
    const searchInput = await this.sim.waitForSelector(
      SELECTORS.inbox.recipientSearchInput,
    );
    await this.sim.click(searchInput);
    await this.sim.type(username);

    // Wait for search results and click the first match
    await new Promise((r) => setTimeout(r, 2000)); // Wait for search API
    const result = await this.sim.waitForSelector(
      SELECTORS.inbox.recipientResult,
    );
    await this.sim.click(result);

    await this.sim.stateAwareDelay();

    // Click "Chat" / "Next" to open the thread
    const chatBtn = await this.sim.waitForSelector(
      SELECTORS.inbox.recipientNextButton,
    );
    await this.sim.click(chatBtn);

    // Wait for the thread to load
    await this.waitForMessageInput();

    // Extract thread ID from URL
    const url = this.page.url();
    const match = url.match(/\/direct\/t\/(\d+)/);
    return match?.[1] ?? "";
  }

  /**
   * Send a text message in the currently open thread.
   * Returns a constructed message ID.
   */
  async sendMessage(text: string): Promise<string> {
    const input = await this.waitForMessageInput();

    // Click the input to focus it
    await this.sim.click(input);

    // Type with realistic keystroke timing
    await this.sim.type(text);

    // Small pause before sending (human behavior)
    await this.sim.stateAwareDelay();

    // Press Enter to send (more human-like than clicking Send button)
    await this.page.keyboard.press("Enter");

    // Wait for the message to appear in the conversation
    await new Promise((r) => setTimeout(r, 1000));

    // Construct an ID from timestamp + hash
    return `ig-sent-${Date.now()}-${this.simpleHash(text)}`;
  }

  /**
   * Read messages from the currently open thread.
   * Returns all visible messages in the conversation view.
   */
  async readMessages(): Promise<RawInstagramMessage[]> {
    return this.page.evaluate((sel) => {
      const rows = document.querySelectorAll(sel.conversation.messageRow);
      const messages: RawInstagramMessage[] = [];

      rows.forEach((row, index) => {
        const textEl = row.querySelector('div[dir="auto"]');
        const timeEl = row.querySelector("time");
        const text = textEl?.textContent?.trim();

        if (!text) return; // Skip non-text rows (date dividers, etc.)

        // Determine if outgoing by checking alignment/positioning
        // Instagram typically aligns sent messages to the right
        const container = row.querySelector("div[class]");
        const style = container ? window.getComputedStyle(container) : null;
        const isOutgoing =
          style?.justifyContent === "flex-end" ||
          style?.alignSelf === "flex-end" ||
          row.querySelector('[data-testid="outgoing-message"]') !== null;

        messages.push({
          id: timeEl?.getAttribute("datetime") ?? `msg-${index}-${Date.now()}`,
          senderUsername: isOutgoing ? "__self__" : "",
          text,
          timestampRaw: timeEl?.getAttribute("datetime") ?? "",
          isOutgoing,
        });
      });

      return messages;
    }, SELECTORS);
  }

  /**
   * Poll for new messages in the currently open thread.
   * Compares against previously seen message IDs.
   */
  async pollNewMessages(threadId: string): Promise<RawInstagramMessage[]> {
    const allMessages = await this.readMessages();

    const seen = this.lastSeenMessageIds.get(threadId) ?? new Set<string>();
    const newMessages = allMessages.filter((msg) => !seen.has(msg.id));

    // Update seen set
    const updatedSeen = new Set(allMessages.map((m) => m.id));
    this.lastSeenMessageIds.set(threadId, updatedSeen);

    return newMessages;
  }

  /**
   * React to a message with an emoji.
   * Hovers over the message to reveal the reaction button, then selects the emoji.
   */
  async reactToMessage(
    messageIndex: number,
    emoji: string,
  ): Promise<void> {
    const rows = await this.page.$$(SELECTORS.conversation.messageRow);

    if (messageIndex < 0 || messageIndex >= rows.length) {
      throw new Error(
        `Message index ${messageIndex} out of range (0-${rows.length - 1})`,
      );
    }

    const targetRow = rows[messageIndex];

    // Hover over the message to reveal reaction options
    await this.sim.moveTo(targetRow);
    await new Promise((r) => setTimeout(r, 500));

    // Double-click for quick "like" reaction
    if (emoji === "❤️" || emoji === "heart") {
      await this.sim.click(targetRow);
      await new Promise((r) => setTimeout(r, 100));
      await this.sim.click(targetRow);
      return;
    }

    // For other emojis, click the reaction button
    const reactionBtn = await targetRow.$(SELECTORS.conversation.reactionButton);
    if (!reactionBtn) {
      throw new Error("Reaction button not found. UI may have changed.");
    }

    await this.sim.click(reactionBtn);
    await new Promise((r) => setTimeout(r, 500));

    // Find and click the emoji in the picker
    // This is fragile and depends on the emoji picker structure
    const emojiButton = await this.page.evaluateHandle(
      (targetEmoji: string) => {
        const buttons = document.querySelectorAll('button[role="gridcell"]');
        for (const btn of buttons) {
          if (btn.textContent?.includes(targetEmoji)) {
            return btn;
          }
        }
        return null;
      },
      emoji,
    );

    if (emojiButton.asElement()) {
      await this.sim.click(emojiButton.asElement() as ElementHandle);
    }
  }

  /**
   * Scroll up in the conversation to load older messages.
   */
  async scrollToLoadMore(): Promise<void> {
    const container = await this.page.$(SELECTORS.conversation.messageContainer)
      ?? await this.page.$(SELECTORS.conversation.messageContainerAlt);

    if (container) {
      await this.sim.moveTo(container);
      await this.sim.scroll(-500);
      // Wait for content to load
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  /**
   * Wait for the message input to be ready.
   */
  private async waitForMessageInput(): Promise<ElementHandle> {
    try {
      return await this.sim.waitForSelector(
        SELECTORS.conversation.messageInput,
        this.navigationTimeoutMs,
      );
    } catch (err) {
      // Only try fallback on timeout/not-found. Re-throw other errors.
      const msg = err instanceof Error ? err.message : "";
      if (!msg.includes("not found") && !msg.includes("Timeout") && !msg.includes("waiting")) {
        throw err;
      }
      // Try alternative selector
      return await this.sim.waitForSelector(
        SELECTORS.conversation.messageInputAlt,
        this.navigationTimeoutMs,
      );
    }
  }

  /**
   * Ensure we're on the inbox page and the thread list is loaded.
   */
  private async ensureInboxLoaded(): Promise<void> {
    try {
      await this.page.waitForSelector(SELECTORS.inbox.threadListContainer, {
        timeout: 5000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // Only navigate on timeout/not-found. Re-throw crashes.
      if (!msg.includes("Timeout") && !msg.includes("waiting")) {
        throw err;
      }
      // Navigate to inbox if not there
      await this.page.goto("https://www.instagram.com/direct/inbox/", {
        waitUntil: "networkidle2",
        timeout: this.navigationTimeoutMs,
      });
      await this.page.waitForSelector(SELECTORS.inbox.threadListContainer, {
        timeout: this.navigationTimeoutMs,
      });
    }
  }

  /** Simple string hash for constructing message IDs. */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash).toString(36);
  }
}
