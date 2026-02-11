import { describe, it, expect } from "vitest";

import { SELECTORS } from "../instagram/selectors.js";

/**
 * Structural tests for the selectors module.
 * Ensures all required selector categories and keys exist.
 * Actual DOM matching is tested via integration/E2E tests.
 */
describe("SELECTORS", () => {
  it("has all required top-level categories", () => {
    expect(SELECTORS).toHaveProperty("login");
    expect(SELECTORS).toHaveProperty("nav");
    expect(SELECTORS).toHaveProperty("inbox");
    expect(SELECTORS).toHaveProperty("conversation");
    expect(SELECTORS).toHaveProperty("general");
  });

  it("login selectors include username, password, and submit", () => {
    expect(SELECTORS.login.usernameInput).toContain("username");
    expect(SELECTORS.login.passwordInput).toContain("password");
    expect(SELECTORS.login.submitButton).toContain("submit");
  });

  it("conversation selectors include message input and send button", () => {
    expect(SELECTORS.conversation.messageInput).toBeTruthy();
    expect(SELECTORS.conversation.sendButton).toBeTruthy();
    expect(SELECTORS.conversation.messageRow).toBeTruthy();
  });

  it("inbox selectors include thread list and new message", () => {
    expect(SELECTORS.inbox.threadListContainer).toBeTruthy();
    expect(SELECTORS.inbox.threadItem).toBeTruthy();
    expect(SELECTORS.inbox.newMessageButton).toBeTruthy();
  });

  it("all selector values are non-empty strings", () => {
    const checkSelectors = (obj: Record<string, unknown>, path: string) => {
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === "object" && value !== null) {
          checkSelectors(value as Record<string, unknown>, `${path}.${key}`);
        } else {
          expect(typeof value).toBe("string");
          expect((value as string).length).toBeGreaterThan(0);
        }
      }
    };
    checkSelectors(SELECTORS as unknown as Record<string, unknown>, "SELECTORS");
  });
});
