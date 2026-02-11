import type { Page } from "puppeteer";
import type {
  Message,
  Conversation,
  User,
  MessageContent,
} from "@chat-framework/core";
import type { MessengerSelectors } from "./types.js";

/**
 * Raw message data extracted from the DOM before normalization.
 * This intermediate representation decouples DOM scraping from
 * the unified Message type construction.
 */
export interface RawMessageData {
  /** Message element's unique identifier (data attribute or position-based). */
  readonly elementId: string;
  /** Extracted text content, if any. */
  readonly text?: string;
  /** Sender display name, if identifiable. */
  readonly senderName?: string;
  /** Timestamp string from the DOM (raw, unparsed). */
  readonly timestampRaw?: string;
  /** Whether this message was sent by the logged-in user. */
  readonly isOwnMessage: boolean;
  /** Image URLs found in the message. */
  readonly imageUrls: readonly string[];
}

/**
 * Parses Facebook Messenger DOM elements into structured message data.
 *
 * Facebook's DOM is heavily obfuscated with generated class names that change
 * on every deployment. This parser uses structural patterns (roles, aria
 * attributes, contenteditable, dir="auto") rather than class names.
 *
 * The parser operates in two modes:
 * 1. Batch: Parse all visible messages (for initial load / getMessages)
 * 2. Incremental: Parse newly added message elements (for live monitoring)
 */
export class MessengerDomParser {
  private readonly _page: Page;
  private readonly _selectors: MessengerSelectors;

  /** Set of already-seen element IDs to avoid duplicate event emission. */
  private readonly _seenMessageIds = new Set<string>();

  constructor(page: Page, selectors: MessengerSelectors) {
    this._page = page;
    this._selectors = selectors;
  }

  /**
   * Parse all currently visible messages in the conversation view.
   */
  async parseVisibleMessages(
    conversation: Conversation,
    selfUser: User,
  ): Promise<Message[]> {
    const rawMessages = await this._extractRawMessages();
    return rawMessages.map((raw) =>
      this._toMessage(raw, conversation, selfUser),
    );
  }

  /**
   * Parse messages and return only those not previously seen.
   * Updates the internal seen-set. Used for incremental polling.
   */
  async parseNewMessages(
    conversation: Conversation,
    selfUser: User,
  ): Promise<Message[]> {
    const rawMessages = await this._extractRawMessages();
    const newMessages: Message[] = [];

    for (const raw of rawMessages) {
      if (!this._seenMessageIds.has(raw.elementId)) {
        this._seenMessageIds.add(raw.elementId);
        newMessages.push(this._toMessage(raw, conversation, selfUser));
      }
    }

    return newMessages;
  }

  /**
   * Mark all currently visible messages as seen (for initial load).
   */
  async markAllAsSeen(): Promise<void> {
    const rawMessages = await this._extractRawMessages();
    for (const raw of rawMessages) {
      this._seenMessageIds.add(raw.elementId);
    }
  }

  /**
   * Reset the seen-message tracking (e.g., when switching conversations).
   */
  resetSeen(): void {
    this._seenMessageIds.clear();
  }

  /**
   * Extract raw message data from the DOM.
   *
   * The evaluate callback runs in the browser context and returns plain
   * JSON-serializable objects. TypeScript types are not available inside
   * the browser, so we type the return value on the Node side.
   */
  private async _extractRawMessages(): Promise<RawMessageData[]> {
    const messageRowSelector = this._selectors.messageRow;
    const textSelector = this._selectors.messageText;

    const results: RawMessageData[] = await this._page.evaluate(
      (rowSel: string, txtSel: string) => {
        const rows = document.querySelectorAll(rowSel);
        const output: Array<{
          elementId: string;
          text?: string;
          senderName?: string;
          timestampRaw?: string;
          isOwnMessage: boolean;
          imageUrls: string[];
        }> = [];

        rows.forEach((row: Element, index: number) => {
          const textEl = row.querySelector(txtSel);
          const text = textEl?.textContent?.trim() || undefined;

          // Detect own messages via alignment or data attribute
          const style = window.getComputedStyle(row);
          const isRight =
            style.justifyContent === "flex-end" ||
            style.alignSelf === "flex-end";
          const hasOwnAttr =
            row.querySelector('[data-testid="outgoing"]') !== null;
          const isOwnMessage = isRight || hasOwnAttr;

          // Extract images (skip avatars, emojis, icons)
          const images: string[] = [];
          row.querySelectorAll("img").forEach((img: HTMLImageElement) => {
            const src = img.src;
            if (
              src &&
              !src.includes("emoji") &&
              !src.includes("avatar") &&
              !src.includes("icon")
            ) {
              images.push(src);
            }
          });

          // Timestamp from time element
          const timeEl =
            row.querySelector("time") ?? row.querySelector("[datetime]");
          const timestampRaw =
            timeEl?.getAttribute("datetime") ??
            timeEl?.textContent?.trim() ??
            undefined;

          // Sender name (usually visible in group chats)
          const senderEl = row.querySelector(
            '[data-testid="message-sender"], span[dir="auto"]',
          );
          const senderName =
            senderEl && senderEl !== textEl
              ? senderEl.textContent?.trim() || undefined
              : undefined;

          // Generate content-anchored element ID (no position index — DOM reflows
          // would invalidate position-based IDs and break deduplication).
          const raw = (senderName ?? "") + "|" + (text ?? "") + "|" + images.join(",");
          let hash = 0;
          for (let ci = 0; ci < raw.length; ci++) {
            hash = ((hash << 5) - hash + raw.charCodeAt(ci)) | 0;
          }
          const elementId = `msg-${Math.abs(hash).toString(36)}-${raw.length}`;

          if (text || images.length > 0) {
            output.push({
              elementId,
              text,
              senderName,
              timestampRaw,
              isOwnMessage,
              imageUrls: images,
            });
          }
        });

        return output;
      },
      messageRowSelector,
      textSelector,
    );

    return results;
  }

  /**
   * Convert raw DOM data to a unified Message.
   */
  private _toMessage(
    raw: RawMessageData,
    conversation: Conversation,
    selfUser: User,
  ): Message {
    const sender: User = raw.isOwnMessage
      ? selfUser
      : {
          id: raw.senderName ?? "unknown",
          platform: "facebook",
          displayName: raw.senderName,
        };

    let content: MessageContent;
    if (raw.imageUrls.length > 0 && !raw.text) {
      content = { type: "image", url: raw.imageUrls[0] };
    } else {
      content = { type: "text", text: raw.text ?? "" };
    }

    // Parse timestamp, falling back to now if the raw string doesn't produce
    // a valid Date (e.g. relative strings like "2 hours ago").
    let timestamp: Date;
    if (raw.timestampRaw) {
      const parsed = new Date(raw.timestampRaw);
      timestamp = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    } else {
      timestamp = new Date();
    }

    return {
      id: raw.elementId,
      conversation,
      sender,
      timestamp,
      content,
    };
  }
}
