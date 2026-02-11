import { describe, it, expect, vi, beforeEach } from "vitest";
import { PuppeteerActionExecutor } from "../../src/facebook/page-executor.js";
import type { Page } from "puppeteer";

/**
 * Creates a mock Puppeteer Page with tracked calls for mouse, keyboard,
 * and evaluation methods.
 */
function createMockPage() {
  const mouseCalls: Array<{ method: string; args: unknown[] }> = [];
  const keyboardCalls: Array<{ method: string; args: unknown[] }> = [];

  const mockPage = {
    mouse: {
      move: vi.fn(async (x: number, y: number) => {
        mouseCalls.push({ method: "move", args: [x, y] });
      }),
      down: vi.fn(async (opts?: { button?: string }) => {
        mouseCalls.push({ method: "down", args: [opts] });
      }),
      up: vi.fn(async (opts?: { button?: string }) => {
        mouseCalls.push({ method: "up", args: [opts] });
      }),
      wheel: vi.fn(async (opts?: { deltaX?: number; deltaY?: number }) => {
        mouseCalls.push({ method: "wheel", args: [opts] });
      }),
    },
    keyboard: {
      down: vi.fn(async (key: string) => {
        keyboardCalls.push({ method: "down", args: [key] });
      }),
      up: vi.fn(async (key: string) => {
        keyboardCalls.push({ method: "up", args: [key] });
      }),
    },
    viewport: vi.fn(() => ({ width: 1920, height: 1080 })),
    evaluate: vi.fn(async (fn: () => unknown) => fn()),
  };

  return { mockPage: mockPage as unknown as Page, mouseCalls, keyboardCalls };
}

describe("PuppeteerActionExecutor", () => {
  let mockPage: Page;
  let mouseCalls: Array<{ method: string; args: unknown[] }>;
  let keyboardCalls: Array<{ method: string; args: unknown[] }>;
  let executor: PuppeteerActionExecutor;

  beforeEach(() => {
    ({ mockPage, mouseCalls, keyboardCalls } = createMockPage());
    executor = new PuppeteerActionExecutor(mockPage);
  });

  describe("mouseMove", () => {
    it("moves mouse to coordinates", async () => {
      await executor.mouseMove(100, 200);

      expect(mouseCalls).toHaveLength(1);
      expect(mouseCalls[0]).toEqual({ method: "move", args: [100, 200] });
    });

    it("updates tracked position", async () => {
      await executor.mouseMove(500, 300);
      const pos = await executor.getMousePosition();

      expect(pos).toEqual({ x: 500, y: 300 });
    });
  });

  describe("mouseDown / mouseUp", () => {
    it("presses left button by default", async () => {
      await executor.mouseDown();
      await executor.mouseUp();

      expect(mouseCalls).toHaveLength(2);
      expect(mouseCalls[0]).toEqual({
        method: "down",
        args: [{ button: "left" }],
      });
      expect(mouseCalls[1]).toEqual({
        method: "up",
        args: [{ button: "left" }],
      });
    });

    it("supports right button", async () => {
      await executor.mouseDown("right");
      await executor.mouseUp("right");

      expect(mouseCalls[0]).toEqual({
        method: "down",
        args: [{ button: "right" }],
      });
      expect(mouseCalls[1]).toEqual({
        method: "up",
        args: [{ button: "right" }],
      });
    });

    it("supports middle button", async () => {
      await executor.mouseDown("middle");

      expect(mouseCalls[0]).toEqual({
        method: "down",
        args: [{ button: "middle" }],
      });
    });
  });

  describe("keyDown / keyUp", () => {
    it("dispatches key events", async () => {
      await executor.keyDown("a");
      await executor.keyUp("a");

      expect(keyboardCalls).toHaveLength(2);
      expect(keyboardCalls[0]).toEqual({ method: "down", args: ["a"] });
      expect(keyboardCalls[1]).toEqual({ method: "up", args: ["a"] });
    });

    it("handles modifier keys", async () => {
      await executor.keyDown("Shift");
      await executor.keyDown("A");
      await executor.keyUp("A");
      await executor.keyUp("Shift");

      expect(keyboardCalls).toHaveLength(4);
      expect(keyboardCalls[0].args[0]).toBe("Shift");
      expect(keyboardCalls[3].args[0]).toBe("Shift");
    });
  });

  describe("scroll", () => {
    it("dispatches wheel event with deltas", async () => {
      await executor.scroll(0, 300);

      expect(mouseCalls).toHaveLength(1);
      expect(mouseCalls[0]).toEqual({
        method: "wheel",
        args: [{ deltaX: 0, deltaY: 300 }],
      });
    });

    it("supports horizontal scrolling", async () => {
      await executor.scroll(100, 0);

      expect(mouseCalls[0]).toEqual({
        method: "wheel",
        args: [{ deltaX: 100, deltaY: 0 }],
      });
    });
  });

  describe("getMousePosition", () => {
    it("returns (0,0) initially", async () => {
      const pos = await executor.getMousePosition();
      expect(pos).toEqual({ x: 0, y: 0 });
    });

    it("tracks position through multiple moves", async () => {
      await executor.mouseMove(100, 200);
      await executor.mouseMove(300, 400);

      const pos = await executor.getMousePosition();
      expect(pos).toEqual({ x: 300, y: 400 });
    });
  });

  describe("getViewportSize", () => {
    it("returns viewport from page", async () => {
      const size = await executor.getViewportSize();
      expect(size).toEqual({ width: 1920, height: 1080 });
    });

    it("falls back to page.evaluate when viewport is null", async () => {
      (mockPage.viewport as ReturnType<typeof vi.fn>).mockReturnValue(null);
      // The evaluate call will try to access window.innerWidth/Height
      // In our mock, evaluate just calls the function, but window isn't defined.
      // We need to mock evaluate properly for this case.
      (mockPage.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue({
        width: 1366,
        height: 768,
      });

      const size = await executor.getViewportSize();
      expect(size).toEqual({ width: 1366, height: 768 });
    });
  });
});
