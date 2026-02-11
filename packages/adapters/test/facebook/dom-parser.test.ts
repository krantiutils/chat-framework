import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessengerDomParser } from "../../src/facebook/dom-parser.js";
import { DEFAULT_SELECTORS } from "../../src/facebook/selectors.js";
import type { Page } from "puppeteer";
import type { Conversation, User } from "@chat-framework/core";

function createMockPage(evaluateResult: unknown[] = []) {
  return {
    evaluate: vi.fn(async () => evaluateResult),
  } as unknown as Page;
}

const TEST_CONVERSATION: Conversation = {
  id: "123456",
  platform: "facebook",
  participants: [],
  type: "dm",
  metadata: {},
};

const SELF_USER: User = {
  id: "me@example.com",
  platform: "facebook",
  displayName: "Test User",
};

describe("MessengerDomParser", () => {
  describe("parseVisibleMessages", () => {
    it("returns empty array when no messages in DOM", async () => {
      const page = createMockPage([]);
      const parser = new MessengerDomParser(page, DEFAULT_SELECTORS);

      const messages = await parser.parseVisibleMessages(
        TEST_CONVERSATION,
        SELF_USER,
      );

      expect(messages).toEqual([]);
      expect(page.evaluate).toHaveBeenCalledOnce();
    });

    it("converts raw DOM data to Message objects", async () => {
      const rawMessages = [
        {
          elementId: "msg-0-12-Hello world!",
          text: "Hello world!",
          senderName: "Alice",
          timestampRaw: "2026-02-11T12:00:00Z",
          isOwnMessage: false,
          imageUrls: [],
        },
        {
          elementId: "msg-1-5-Hi!",
          text: "Hi!",
          isOwnMessage: true,
          imageUrls: [],
        },
      ];

      const page = createMockPage(rawMessages);
      const parser = new MessengerDomParser(page, DEFAULT_SELECTORS);

      const messages = await parser.parseVisibleMessages(
        TEST_CONVERSATION,
        SELF_USER,
      );

      expect(messages).toHaveLength(2);

      // First message: from Alice
      expect(messages[0].id).toBe("msg-0-12-Hello world!");
      expect(messages[0].sender.displayName).toBe("Alice");
      expect(messages[0].content).toEqual({
        type: "text",
        text: "Hello world!",
      });
      expect(messages[0].conversation).toBe(TEST_CONVERSATION);

      // Second message: from self
      expect(messages[1].sender).toBe(SELF_USER);
      expect(messages[1].content).toEqual({ type: "text", text: "Hi!" });
    });

    it("handles image-only messages", async () => {
      const rawMessages = [
        {
          elementId: "msg-0-img",
          isOwnMessage: false,
          imageUrls: ["https://example.com/photo.jpg"],
        },
      ];

      const page = createMockPage(rawMessages);
      const parser = new MessengerDomParser(page, DEFAULT_SELECTORS);

      const messages = await parser.parseVisibleMessages(
        TEST_CONVERSATION,
        SELF_USER,
      );

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toEqual({
        type: "image",
        url: "https://example.com/photo.jpg",
      });
    });

    it("prefers text content over images when both present", async () => {
      const rawMessages = [
        {
          elementId: "msg-0-both",
          text: "Check this out",
          isOwnMessage: false,
          imageUrls: ["https://example.com/photo.jpg"],
        },
      ];

      const page = createMockPage(rawMessages);
      const parser = new MessengerDomParser(page, DEFAULT_SELECTORS);

      const messages = await parser.parseVisibleMessages(
        TEST_CONVERSATION,
        SELF_USER,
      );

      expect(messages[0].content).toEqual({
        type: "text",
        text: "Check this out",
      });
    });

    it("uses 'unknown' sender when name not available", async () => {
      const rawMessages = [
        {
          elementId: "msg-0-unknown",
          text: "Mystery message",
          isOwnMessage: false,
          imageUrls: [],
        },
      ];

      const page = createMockPage(rawMessages);
      const parser = new MessengerDomParser(page, DEFAULT_SELECTORS);

      const messages = await parser.parseVisibleMessages(
        TEST_CONVERSATION,
        SELF_USER,
      );

      expect(messages[0].sender.id).toBe("unknown");
      expect(messages[0].sender.platform).toBe("facebook");
    });

    it("parses timestamp from raw string", async () => {
      const rawMessages = [
        {
          elementId: "msg-0-ts",
          text: "Timed message",
          timestampRaw: "2026-02-11T15:30:00Z",
          isOwnMessage: false,
          imageUrls: [],
        },
      ];

      const page = createMockPage(rawMessages);
      const parser = new MessengerDomParser(page, DEFAULT_SELECTORS);

      const messages = await parser.parseVisibleMessages(
        TEST_CONVERSATION,
        SELF_USER,
      );

      expect(messages[0].timestamp).toEqual(new Date("2026-02-11T15:30:00Z"));
    });
  });

  describe("parseNewMessages (incremental)", () => {
    it("returns only unseen messages", async () => {
      const batch1 = [
        {
          elementId: "msg-0",
          text: "First",
          isOwnMessage: false,
          imageUrls: [],
        },
      ];
      const batch2 = [
        {
          elementId: "msg-0",
          text: "First",
          isOwnMessage: false,
          imageUrls: [],
        },
        {
          elementId: "msg-1",
          text: "Second",
          isOwnMessage: false,
          imageUrls: [],
        },
      ];

      const page = createMockPage(batch1);
      const parser = new MessengerDomParser(page, DEFAULT_SELECTORS);

      // First call: returns all messages
      const first = await parser.parseNewMessages(
        TEST_CONVERSATION,
        SELF_USER,
      );
      expect(first).toHaveLength(1);

      // Second call: with one new message
      (page.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue(batch2);
      const second = await parser.parseNewMessages(
        TEST_CONVERSATION,
        SELF_USER,
      );
      expect(second).toHaveLength(1);
      expect(second[0].id).toBe("msg-1");
    });

    it("returns empty array when no new messages", async () => {
      const messages = [
        {
          elementId: "msg-0",
          text: "Only one",
          isOwnMessage: false,
          imageUrls: [],
        },
      ];

      const page = createMockPage(messages);
      const parser = new MessengerDomParser(page, DEFAULT_SELECTORS);

      await parser.parseNewMessages(TEST_CONVERSATION, SELF_USER);
      const second = await parser.parseNewMessages(
        TEST_CONVERSATION,
        SELF_USER,
      );

      expect(second).toHaveLength(0);
    });
  });

  describe("markAllAsSeen", () => {
    it("prevents already-visible messages from appearing as new", async () => {
      const messages = [
        {
          elementId: "msg-0",
          text: "Existing",
          isOwnMessage: false,
          imageUrls: [],
        },
        {
          elementId: "msg-1",
          text: "Also existing",
          isOwnMessage: false,
          imageUrls: [],
        },
      ];

      const page = createMockPage(messages);
      const parser = new MessengerDomParser(page, DEFAULT_SELECTORS);

      await parser.markAllAsSeen();

      const newMessages = await parser.parseNewMessages(
        TEST_CONVERSATION,
        SELF_USER,
      );
      expect(newMessages).toHaveLength(0);
    });
  });

  describe("resetSeen", () => {
    it("clears seen tracking so all messages appear new", async () => {
      const messages = [
        {
          elementId: "msg-0",
          text: "Hello",
          isOwnMessage: false,
          imageUrls: [],
        },
      ];

      const page = createMockPage(messages);
      const parser = new MessengerDomParser(page, DEFAULT_SELECTORS);

      // Mark as seen
      await parser.markAllAsSeen();
      expect(
        await parser.parseNewMessages(TEST_CONVERSATION, SELF_USER),
      ).toHaveLength(0);

      // Reset
      parser.resetSeen();

      // Now they should appear as new again
      const newMessages = await parser.parseNewMessages(
        TEST_CONVERSATION,
        SELF_USER,
      );
      expect(newMessages).toHaveLength(1);
    });
  });
});
