import type { Page } from "puppeteer";
import type { ActionOrchestrator } from "@chat-framework/core";
import type { MessengerSelectors } from "./types.js";

/** URL patterns used for login flow detection. */
const MESSENGER_URL = "https://www.messenger.com";
const FACEBOOK_LOGIN_URL = "https://www.facebook.com/login";
const MESSENGER_LOGIN_PATH = "/login";
const TWO_FACTOR_INDICATORS = [
  "approvals_code",
  "two-factor",
  "checkpoint",
];

/** Possible outcomes of a login attempt. */
export type LoginResult =
  | { readonly status: "success" }
  | { readonly status: "two_factor_required" }
  | { readonly status: "failed"; readonly reason: string };

/**
 * Manages Facebook Messenger authentication.
 *
 * The login flow:
 * 1. Navigate to messenger.com
 * 2. If already authenticated (session cookies), detect and skip login
 * 3. If redirected to login, fill credentials using human-like typing
 * 4. Handle 2FA if prompted
 * 5. Wait for successful redirect to messenger.com conversations
 *
 * Session persistence is handled via Puppeteer's userDataDir. If a valid
 * userDataDir is provided with existing session cookies, step 2 will
 * succeed and no credentials are needed.
 */
export class MessengerAuth {
  private readonly _page: Page;
  private readonly _orchestrator: ActionOrchestrator;
  private readonly _selectors: MessengerSelectors;
  private readonly _timeoutMs: number;

  constructor(
    page: Page,
    orchestrator: ActionOrchestrator,
    selectors: MessengerSelectors,
    timeoutMs: number,
  ) {
    this._page = page;
    this._orchestrator = orchestrator;
    this._selectors = selectors;
    this._timeoutMs = timeoutMs;
  }

  /**
   * Check if the current page state indicates an authenticated session.
   */
  async isAuthenticated(): Promise<boolean> {
    const url = this._page.url();

    // If we're on messenger.com and NOT on the login page, we're authenticated
    if (url.startsWith(MESSENGER_URL) && !url.includes(MESSENGER_LOGIN_PATH)) {
      // Double-check by looking for the conversation list or message input
      try {
        await this._page.waitForSelector(this._selectors.conversationList, {
          timeout: 5000,
        });
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Navigate to Messenger and check if session is still valid.
   * Returns true if already authenticated, false if login is needed.
   */
  async navigateAndCheckSession(): Promise<boolean> {
    await this._page.goto(MESSENGER_URL, {
      waitUntil: "networkidle2",
      timeout: this._timeoutMs,
    });

    return this.isAuthenticated();
  }

  /**
   * Perform the login flow with human-like interaction.
   */
  async login(email: string, password: string): Promise<LoginResult> {
    const url = this._page.url();

    // Navigate to login if not already there
    if (!url.includes("login") && !url.includes("checkpoint")) {
      await this._page.goto(MESSENGER_URL, {
        waitUntil: "networkidle2",
        timeout: this._timeoutMs,
      });
    }

    // Wait for email input
    const emailInput = await this._waitForSelector(
      this._selectors.loginEmailInput,
    );
    if (!emailInput) {
      return { status: "failed", reason: "Email input not found" };
    }

    // Get email input position and click it
    const emailBox = await emailInput.boundingBox();
    if (!emailBox) {
      return { status: "failed", reason: "Email input not visible" };
    }

    // Click the email field and type email with human-like timing
    await this._orchestrator.execute({
      type: "click",
      target: {
        x: emailBox.x + emailBox.width / 2,
        y: emailBox.y + emailBox.height / 2,
      },
    });
    await this._orchestrator.execute({
      type: "type",
      text: email,
      clearFirst: true,
    });

    // Tab to or click the password field
    const passwordInput = await this._waitForSelector(
      this._selectors.loginPasswordInput,
    );
    if (!passwordInput) {
      return { status: "failed", reason: "Password input not found" };
    }

    const passBox = await passwordInput.boundingBox();
    if (!passBox) {
      return { status: "failed", reason: "Password input not visible" };
    }

    await this._orchestrator.execute({
      type: "click",
      target: {
        x: passBox.x + passBox.width / 2,
        y: passBox.y + passBox.height / 2,
      },
    });
    await this._orchestrator.execute({
      type: "type",
      text: password,
      clearFirst: true,
    });

    // Click login button
    const loginButton = await this._waitForSelector(
      this._selectors.loginButton,
    );
    if (!loginButton) {
      return { status: "failed", reason: "Login button not found" };
    }

    const loginBox = await loginButton.boundingBox();
    if (!loginBox) {
      return { status: "failed", reason: "Login button not visible" };
    }

    await this._orchestrator.execute({
      type: "click",
      target: {
        x: loginBox.x + loginBox.width / 2,
        y: loginBox.y + loginBox.height / 2,
      },
    });

    // Wait for navigation after login
    try {
      await this._page.waitForNavigation({
        waitUntil: "networkidle2",
        timeout: this._timeoutMs,
      });
    } catch {
      // Navigation may already have completed
    }

    // Check outcome
    const postLoginUrl = this._page.url();

    // 2FA check
    if (this._isTwoFactorPage(postLoginUrl)) {
      return { status: "two_factor_required" };
    }

    // Check if we landed on messenger
    if (await this.isAuthenticated()) {
      return { status: "success" };
    }

    // Check for error indicators
    const pageContent = await this._page.content();
    if (pageContent.includes("incorrect") || pageContent.includes("wrong password")) {
      return { status: "failed", reason: "Invalid credentials" };
    }

    return { status: "failed", reason: `Unexpected post-login state: ${postLoginUrl}` };
  }

  /**
   * Submit a 2FA code.
   */
  async submitTwoFactorCode(code: string): Promise<LoginResult> {
    const codeInput = await this._waitForSelector(
      this._selectors.loginTwoFactorInput,
    );
    if (!codeInput) {
      return { status: "failed", reason: "2FA code input not found" };
    }

    const codeBox = await codeInput.boundingBox();
    if (!codeBox) {
      return { status: "failed", reason: "2FA code input not visible" };
    }

    await this._orchestrator.execute({
      type: "click",
      target: {
        x: codeBox.x + codeBox.width / 2,
        y: codeBox.y + codeBox.height / 2,
      },
    });
    await this._orchestrator.execute({
      type: "type",
      text: code,
      clearFirst: true,
    });

    // Submit
    const submitBtn = await this._waitForSelector(
      this._selectors.loginTwoFactorSubmit,
    );
    if (submitBtn) {
      const btnBox = await submitBtn.boundingBox();
      if (btnBox) {
        await this._orchestrator.execute({
          type: "click",
          target: {
            x: btnBox.x + btnBox.width / 2,
            y: btnBox.y + btnBox.height / 2,
          },
        });
      }
    }

    try {
      await this._page.waitForNavigation({
        waitUntil: "networkidle2",
        timeout: this._timeoutMs,
      });
    } catch {
      // May already have navigated
    }

    if (await this.isAuthenticated()) {
      return { status: "success" };
    }

    return { status: "failed", reason: "2FA submission did not result in authentication" };
  }

  private _isTwoFactorPage(url: string): boolean {
    return TWO_FACTOR_INDICATORS.some((indicator) => url.includes(indicator));
  }

  private async _waitForSelector(selector: string) {
    try {
      return await this._page.waitForSelector(selector, {
        timeout: this._timeoutMs,
        visible: true,
      });
    } catch {
      return null;
    }
  }
}
