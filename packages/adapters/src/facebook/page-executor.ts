import type { Page, KeyInput } from "puppeteer";
import type {
  ActionExecutor,
  Point,
  ViewportSize,
  MouseButton,
} from "@chat-framework/core";

/**
 * Maps our MouseButton type to Puppeteer's protocol button names.
 */
const BUTTON_MAP: Record<MouseButton, "left" | "right" | "middle"> = {
  left: "left",
  right: "right",
  middle: "middle",
};

/**
 * ActionExecutor implementation backed by a Puppeteer Page.
 *
 * Dispatches mouse and keyboard events at the CDP level through Puppeteer's
 * page API. This is what the ActionOrchestrator calls to actually move the
 * mouse, type keys, and scroll in the browser.
 */
export class PuppeteerActionExecutor implements ActionExecutor {
  private readonly _page: Page;
  private _mouseX: number;
  private _mouseY: number;

  constructor(page: Page) {
    this._page = page;
    // Initialize at viewport center (reasonable default).
    // The real position gets updated on every mouseMove call.
    this._mouseX = 0;
    this._mouseY = 0;
  }

  async mouseMove(x: number, y: number): Promise<void> {
    await this._page.mouse.move(x, y);
    this._mouseX = x;
    this._mouseY = y;
  }

  async mouseDown(button?: MouseButton): Promise<void> {
    await this._page.mouse.down({ button: BUTTON_MAP[button ?? "left"] });
  }

  async mouseUp(button?: MouseButton): Promise<void> {
    await this._page.mouse.up({ button: BUTTON_MAP[button ?? "left"] });
  }

  async keyDown(key: string): Promise<void> {
    await this._page.keyboard.down(key as KeyInput);
  }

  async keyUp(key: string): Promise<void> {
    await this._page.keyboard.up(key as KeyInput);
  }

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    // Puppeteer's mouse.wheel dispatches a wheel event at the current
    // mouse position with the given deltas.
    await this._page.mouse.wheel({ deltaX, deltaY });
  }

  async getMousePosition(): Promise<Point> {
    return { x: this._mouseX, y: this._mouseY };
  }

  async getViewportSize(): Promise<ViewportSize> {
    const viewport = this._page.viewport();
    if (!viewport) {
      // Fallback: query from page
      const size = await this._page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      return size;
    }
    return { width: viewport.width, height: viewport.height };
  }
}
