import { describe, it, expect } from "vitest";
import { DEFAULT_SELECTORS, resolveSelectors } from "../../src/facebook/selectors.js";
import type { MessengerSelectors } from "../../src/facebook/types.js";

describe("DEFAULT_SELECTORS", () => {
  it("has all required selector keys", () => {
    const requiredKeys: (keyof MessengerSelectors)[] = [
      "loginEmailInput",
      "loginPasswordInput",
      "loginButton",
      "loginTwoFactorInput",
      "loginTwoFactorSubmit",
      "conversationList",
      "conversationListItem",
      "conversationLink",
      "messageInput",
      "sendButton",
      "fileInput",
      "attachmentButton",
      "messageContainer",
      "messageRow",
      "messageText",
      "messageSenderName",
      "messageTimestamp",
      "reactionTrigger",
      "reactionPicker",
      "reactionEmoji",
      "onlineIndicator",
    ];

    for (const key of requiredKeys) {
      expect(DEFAULT_SELECTORS[key]).toBeDefined();
      expect(typeof DEFAULT_SELECTORS[key]).toBe("string");
      expect(DEFAULT_SELECTORS[key].length).toBeGreaterThan(0);
    }
  });

  it("uses stable selector strategies (aria, role, data-testid)", () => {
    // Selectors should prefer stable attributes over CSS class names
    const stablePatterns = [
      /\[role=/,
      /\[aria-label/,
      /\[data-testid/,
      /\[contenteditable/,
      /\[type=/,
      /#\w/, // ID selectors
      /input/,
      /a\[href/,
    ];

    // Every selector should contain at least one stable pattern
    for (const [key, selector] of Object.entries(DEFAULT_SELECTORS)) {
      const hasStablePattern = stablePatterns.some((pattern) =>
        pattern.test(selector),
      );
      expect(hasStablePattern).toBe(true);
    }
  });

  it("message input targets contenteditable div", () => {
    expect(DEFAULT_SELECTORS.messageInput).toContain("contenteditable");
  });

  it("login selectors cover common Facebook patterns", () => {
    // Should match both email and pass by name attribute
    expect(DEFAULT_SELECTORS.loginEmailInput).toContain('name="email"');
    expect(DEFAULT_SELECTORS.loginPasswordInput).toContain('name="pass"');
  });
});

describe("resolveSelectors", () => {
  it("returns defaults when no overrides given", () => {
    const selectors = resolveSelectors();
    expect(selectors).toEqual(DEFAULT_SELECTORS);
  });

  it("returns defaults when undefined passed", () => {
    const selectors = resolveSelectors(undefined);
    expect(selectors).toEqual(DEFAULT_SELECTORS);
  });

  it("overrides specific selectors while keeping defaults", () => {
    const overrides: Partial<MessengerSelectors> = {
      messageInput: '[data-custom="input"]',
      sendButton: '[data-custom="send"]',
    };

    const selectors = resolveSelectors(overrides);

    // Overridden keys should use the custom values
    expect(selectors.messageInput).toBe('[data-custom="input"]');
    expect(selectors.sendButton).toBe('[data-custom="send"]');

    // Non-overridden keys should keep defaults
    expect(selectors.loginEmailInput).toBe(DEFAULT_SELECTORS.loginEmailInput);
    expect(selectors.messageRow).toBe(DEFAULT_SELECTORS.messageRow);
    expect(selectors.reactionTrigger).toBe(DEFAULT_SELECTORS.reactionTrigger);
  });

  it("allows overriding all selectors", () => {
    const allOverrides: MessengerSelectors = {
      loginEmailInput: "a",
      loginPasswordInput: "b",
      loginButton: "c",
      loginTwoFactorInput: "d",
      loginTwoFactorSubmit: "e",
      conversationList: "f",
      conversationListItem: "g",
      conversationLink: "h",
      messageInput: "i",
      sendButton: "j",
      fileInput: "k",
      attachmentButton: "l",
      messageContainer: "m",
      messageRow: "n",
      messageText: "o",
      messageSenderName: "p",
      messageTimestamp: "q",
      reactionTrigger: "r",
      reactionPicker: "s",
      reactionEmoji: "t",
      onlineIndicator: "u",
    };

    const selectors = resolveSelectors(allOverrides);
    expect(selectors).toEqual(allOverrides);
  });
});
