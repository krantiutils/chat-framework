/**
 * Instagram authentication — login, session persistence, and 2FA handling.
 *
 * Session persistence works via Puppeteer's userDataDir: cookies and
 * localStorage are saved to disk automatically. On subsequent launches,
 * the adapter checks if the session is still valid before re-authenticating.
 */

import type { Page } from "puppeteer";

import type { HumanSimulator } from "./human-simulator.js";
import { SELECTORS } from "./selectors.js";
import type { InstagramCredentials } from "./types.js";

/** Possible outcomes of an authentication attempt. */
export type AuthResult =
  | { status: "success" }
  | { status: "two_factor_required" }
  | { status: "challenge_required"; challengeUrl: string }
  | { status: "error"; message: string };

const INSTAGRAM_BASE = "https://www.instagram.com";
const INSTAGRAM_LOGIN = `${INSTAGRAM_BASE}/accounts/login/`;
const INSTAGRAM_DM = `${INSTAGRAM_BASE}/direct/inbox/`;

/**
 * Handles Instagram login and session validation.
 */
export class InstagramAuth {
  private readonly page: Page;
  private readonly sim: HumanSimulator;
  private readonly credentials: InstagramCredentials;
  private readonly navigationTimeoutMs: number;

  constructor(
    page: Page,
    sim: HumanSimulator,
    credentials: InstagramCredentials,
    navigationTimeoutMs: number = 30_000,
  ) {
    this.page = page;
    this.sim = sim;
    this.credentials = credentials;
    this.navigationTimeoutMs = navigationTimeoutMs;
  }

  /**
   * Check if we have a valid session (cookies from userDataDir).
   * Navigates to Instagram and checks if the app loads without login.
   */
  async hasValidSession(): Promise<boolean> {
    try {
      await this.page.goto(INSTAGRAM_BASE, {
        waitUntil: "networkidle2",
        timeout: this.navigationTimeoutMs,
      });

      // Check if the home icon appears (= logged in)
      const homeIcon = await this.page.$(SELECTORS.login.appLoaded);
      return homeIcon !== null;
    } catch (err) {
      // Timeouts and navigation failures mean we can't determine session state.
      // Log and return false so the caller attempts a fresh login.
      console.error("InstagramAuth: session check failed:", err);
      return false;
    }
  }

  /**
   * Perform a full login flow with human-like interactions.
   */
  async login(): Promise<AuthResult> {
    // Navigate to login page
    await this.page.goto(INSTAGRAM_LOGIN, {
      waitUntil: "networkidle2",
      timeout: this.navigationTimeoutMs,
    });

    // Wait for the login form
    const usernameInput = await this.sim.waitForSelector(
      SELECTORS.login.usernameInput,
      this.navigationTimeoutMs,
    );

    // Human-like delay before starting to type
    await this.sim.stateAwareDelay();

    // Click and type username
    await this.sim.click(usernameInput);
    await this.sim.type(this.credentials.username);

    // Tab to password or click it
    await this.sim.stateAwareDelay();
    const passwordInput = await this.sim.waitForSelector(
      SELECTORS.login.passwordInput,
    );
    await this.sim.click(passwordInput);
    await this.sim.type(this.credentials.password);

    // Small pause before clicking login (humans do this)
    await this.sim.stateAwareDelay();

    // Click login button
    const submitButton = await this.sim.waitForSelector(
      SELECTORS.login.submitButton,
    );
    await this.sim.click(submitButton);

    // Wait for navigation result
    return this.handlePostLogin();
  }

  /**
   * Submit a two-factor authentication code.
   */
  async submitTwoFactorCode(code: string): Promise<AuthResult> {
    const input = await this.sim.waitForSelector(
      SELECTORS.login.twoFactorInput,
      this.navigationTimeoutMs,
    );
    await this.sim.click(input);
    await this.sim.type(code);

    await this.sim.stateAwareDelay();

    const confirmButton = await this.sim.waitForSelector(
      SELECTORS.login.twoFactorConfirm,
    );
    await this.sim.click(confirmButton);

    return this.handlePostLogin();
  }

  /**
   * Navigate to the DM inbox. Call after successful login.
   */
  async navigateToInbox(): Promise<void> {
    await this.page.goto(INSTAGRAM_DM, {
      waitUntil: "networkidle2",
      timeout: this.navigationTimeoutMs,
    });

    // Dismiss any dialogs that appear (notifications, etc.)
    await this.dismissDialogs();
  }

  /**
   * Handle the various post-login states.
   */
  private async handlePostLogin(): Promise<AuthResult> {
    // Wait for either: app loaded, 2FA prompt, error, or challenge
    try {
      const result = await Promise.race([
        this.waitForAppLoaded(),
        this.waitForTwoFactor(),
        this.waitForLoginError(),
        this.waitForChallenge(),
        this.waitForTimeout(),
      ]);
      return result;
    } catch (err) {
      return {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async waitForAppLoaded(): Promise<AuthResult> {
    await this.page.waitForSelector(SELECTORS.login.appLoaded, {
      timeout: this.navigationTimeoutMs,
    });
    // Dismiss post-login dialogs
    await this.dismissDialogs();
    return { status: "success" };
  }

  private async waitForTwoFactor(): Promise<AuthResult> {
    await this.page.waitForSelector(SELECTORS.login.twoFactorInput, {
      timeout: this.navigationTimeoutMs,
    });
    return { status: "two_factor_required" };
  }

  private async waitForLoginError(): Promise<AuthResult> {
    await this.page.waitForSelector(SELECTORS.login.loginError, {
      timeout: this.navigationTimeoutMs,
    });
    const errorEl = await this.page.$(SELECTORS.login.loginError);
    const text = errorEl
      ? await this.page.evaluate((el) => el.textContent ?? "", errorEl)
      : "Unknown login error";
    return { status: "error", message: text };
  }

  private async waitForChallenge(): Promise<AuthResult> {
    // Instagram sometimes redirects to a challenge page
    await this.page.waitForFunction(
      () => window.location.pathname.includes("/challenge/"),
      { timeout: this.navigationTimeoutMs },
    );
    return {
      status: "challenge_required",
      challengeUrl: this.page.url(),
    };
  }

  private waitForTimeout(): Promise<AuthResult> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ status: "error", message: "Login timed out" });
      }, this.navigationTimeoutMs);
    });
  }

  /**
   * Dismiss common post-login dialogs:
   * - "Save Your Login Info?"
   * - "Turn on Notifications?"
   *
   * These are not always present, so failures are silently ignored.
   */
  private async dismissDialogs(): Promise<void> {
    const dismissSelectors = [
      SELECTORS.login.saveLoginDismiss,
      SELECTORS.login.notificationsDismiss,
    ];

    for (const selector of dismissSelectors) {
      try {
        // Short timeout — dialog might not appear
        const btn = await this.page.waitForSelector(selector, {
          timeout: 3000,
          visible: true,
        });
        if (btn) {
          await this.sim.click(btn);
          // Wait for dialog to close
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch (err) {
        // Timeout is expected — dialog may not appear.
        // Log non-timeout errors for debugging.
        const msg = err instanceof Error ? err.message : "";
        if (!msg.includes("Waiting for selector") && !msg.includes("timeout")) {
          console.error(`InstagramAuth: unexpected error dismissing dialog "${selector}":`, err);
        }
      }
    }
  }
}
