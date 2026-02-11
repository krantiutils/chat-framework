import { describe, it, expect } from "vitest";

describe("@chat-framework/core", () => {
  it("package is importable", async () => {
    const mod = await import("../../src/index.js");
    expect(mod).toBeDefined();
  });
});
