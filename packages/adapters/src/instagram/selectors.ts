/**
 * Instagram DOM selectors — isolated in a single file for easy updates
 * when Instagram changes its UI.
 *
 * Instagram uses dynamically generated class names (CSS modules / obfuscation),
 * so selectors rely on:
 * - ARIA attributes (role, aria-label) — most stable
 * - data-* attributes — somewhat stable
 * - Structural patterns (tag nesting) — last resort
 *
 * When Instagram changes its UI, update ONLY this file. The self-healing
 * system (PRD §5) will eventually automate these updates.
 *
 * Last verified: 2026-02-11
 */

export const SELECTORS = {
  // ── Login page ──────────────────────────────────────────────
  login: {
    /** Username input field. */
    usernameInput: 'input[name="username"]',
    /** Password input field. */
    passwordInput: 'input[name="password"]',
    /** Login submit button. */
    submitButton: 'button[type="submit"]',
    /** "Save Your Login Info?" dialog — dismiss button. */
    saveLoginDismiss: 'button:has-text("Not Now")',
    /** "Turn on Notifications?" dialog — dismiss button. */
    notificationsDismiss: 'button:has-text("Not Now")',
    /** Two-factor auth code input. */
    twoFactorInput: 'input[name="verificationCode"]',
    /** Two-factor confirm button. */
    twoFactorConfirm: 'button:has-text("Confirm")',
    /** Error message on failed login. */
    loginError: '#slfErrorAlert',
    /** Indicates the main app has loaded (logged in). */
    appLoaded: 'svg[aria-label="Home"]',
  },

  // ── Navigation ──────────────────────────────────────────────
  nav: {
    /** DM inbox link in the nav bar. */
    dmInboxLink: 'a[href="/direct/inbox/"]',
    /** Alternative: the messenger icon SVG. */
    messengerIcon: 'svg[aria-label="Messenger"]',
  },

  // ── DM Inbox ────────────────────────────────────────────────
  inbox: {
    /** Container for the thread list. */
    threadListContainer: '[role="list"]',
    /** Individual thread item. Uses structural selector as fallback. */
    threadItem: '[role="listitem"]',
    /** Unread indicator on a thread (bold text or dot). */
    unreadIndicator: '[data-visualcompletion="loading-state"]',
    /** Thread participant name text. */
    threadName: '[role="listitem"] span[dir="auto"]',
    /** Thread last message preview. */
    threadPreview: '[role="listitem"] span[dir="auto"]:last-of-type',
    /** "New message" / compose button. */
    newMessageButton: 'svg[aria-label="New message"]',
    /** Search input in the "New message" dialog. */
    recipientSearchInput: 'input[name="queryBox"]',
    /** Search result item in the recipient picker. */
    recipientResult: '[role="listbox"] button',
    /** "Chat" / "Next" button after selecting recipient. */
    recipientNextButton: 'div[role="dialog"] button:has-text("Chat")',
  },

  // ── Conversation view ───────────────────────────────────────
  conversation: {
    /** The message input textarea / contenteditable. */
    messageInput: 'div[role="textbox"][contenteditable="true"]',
    /** Alternative: message input by aria-label. */
    messageInputAlt: '[aria-label="Message"], [aria-label="Message..."]',
    /** Send button (appears after typing). */
    sendButton: 'div[role="button"]:has-text("Send")',
    /** Alternative send button selector. */
    sendButtonAlt: 'button:has-text("Send")',
    /** Container for all messages in the conversation. */
    messageContainer: '[role="grid"]',
    /** Alternative message container. */
    messageContainerAlt: 'div[style*="flex-direction: column"]',
    /** Individual message row. */
    messageRow: '[role="row"]',
    /** Message text content within a row. */
    messageText: '[role="row"] div[dir="auto"]',
    /** Timestamp on hover / visible timestamp. */
    messageTimestamp: 'time',
    /** The conversation header (participant name). */
    headerName: 'header span[dir="auto"]',
    /** Emoji reaction button (appears on hover over a message). */
    reactionButton: 'svg[aria-label="React"]',
    /** Emoji picker container. */
    emojiPicker: '[role="dialog"] [role="grid"]',
    /** Like button (heart — quick reaction). */
    likeButton: 'svg[aria-label="Like"]',
    /** Image message. */
    messageImage: '[role="row"] img[src*="cdninstagram"]',
    /** Voice message. */
    voiceMessage: '[role="row"] audio',
  },

  // ── General / shared ────────────────────────────────────────
  general: {
    /** Loading spinner. */
    spinner: '[role="progressbar"]',
    /** Generic close/dismiss button. */
    closeButton: 'svg[aria-label="Close"]',
    /** Confirm dialog button. */
    confirmButton: 'button[tabindex="0"]',
  },
} as const;

export type SelectorCategory = keyof typeof SELECTORS;
