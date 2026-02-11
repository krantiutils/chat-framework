import type { MessengerSelectors } from "./types.js";

/**
 * Default DOM selectors for Facebook Messenger (messenger.com).
 *
 * Facebook uses a React SPA with obfuscated class names that change on every
 * deployment. These selectors prioritize stable attributes:
 *
 * 1. ARIA roles and labels (accessibility-mandated, rarely change)
 * 2. data-testid attributes (Facebook's test infra, moderately stable)
 * 3. Structural patterns (tag nesting, contenteditable)
 * 4. URL patterns (most stable)
 *
 * When Facebook breaks these selectors, pass `selectorOverrides` in
 * the adapter config to patch individual selectors without code changes.
 *
 * Last verified: N/A (initial implementation)
 */
export const DEFAULT_SELECTORS: MessengerSelectors = {
  // ── Login (facebook.com/login) ──────────────────────────────────────────────
  loginEmailInput: '#email, input[name="email"], input[type="email"]',
  loginPasswordInput: '#pass, input[name="pass"], input[type="password"]',
  loginButton: 'button[name="login"], button[type="submit"], #loginbutton',
  loginTwoFactorInput: 'input[name="approvals_code"], input#approvals_code',
  loginTwoFactorSubmit: '#checkpointSubmitButton, button[type="submit"]',

  // ── Conversation List (sidebar) ─────────────────────────────────────────────
  conversationList: '[role="navigation"] [role="list"], [aria-label="Chats"] [role="list"]',
  conversationListItem: '[role="listitem"], [role="row"]',
  conversationLink: '[role="listitem"] a[href*="/t/"], [role="row"] a[href*="/t/"]',

  // ── Message Compose ─────────────────────────────────────────────────────────
  messageInput:
    '[role="textbox"][contenteditable="true"], ' +
    'div[contenteditable="true"][aria-label*="message" i], ' +
    'div[contenteditable="true"][aria-label*="Message" i]',
  sendButton:
    '[aria-label="Send" i], ' +
    '[aria-label="Press enter to send" i], ' +
    '[data-testid="send-button"]',
  fileInput: 'input[type="file"]',
  attachmentButton:
    '[aria-label="Attach a file" i], ' +
    '[aria-label="Add files" i], ' +
    '[data-testid="attachment-button"]',

  // ── Messages ────────────────────────────────────────────────────────────────
  messageContainer:
    '[role="main"] [role="list"], ' +
    '[role="main"] [role="grid"], ' +
    '[data-testid="message-container"]',
  messageRow:
    '[role="row"], ' +
    '[data-testid="message-row"]',
  messageText:
    '[dir="auto"], ' +
    '[data-testid="message-text"]',
  messageSenderName:
    '[data-testid="message-sender"], ' +
    'span[dir="auto"]',
  messageTimestamp:
    '[data-testid="message-timestamp"], ' +
    'time, [datetime]',

  // ── Reactions ───────────────────────────────────────────────────────────────
  reactionTrigger:
    '[aria-label*="React" i], ' +
    '[data-testid="reaction-trigger"]',
  reactionPicker:
    '[role="dialog"][aria-label*="React" i], ' +
    '[data-testid="reaction-picker"]',
  reactionEmoji:
    '[role="button"][aria-label]',

  // ── Presence ────────────────────────────────────────────────────────────────
  onlineIndicator:
    '[data-testid="online-indicator"], ' +
    '[aria-label*="Active now" i]',
};

/**
 * Merge user-provided selector overrides with defaults.
 */
export function resolveSelectors(
  overrides?: Partial<MessengerSelectors>,
): MessengerSelectors {
  if (!overrides) return DEFAULT_SELECTORS;
  return { ...DEFAULT_SELECTORS, ...overrides };
}
