import { describe, it, expect } from "vitest";

import {
  ALL_CAPABILITIES,
  createCapabilities,
  PLATFORM_CAPABILITIES,
  supportsCapability,
  unsupportedCapabilities,
} from "../capabilities/index.js";
import { ALL_PLATFORMS } from "../types/platform.js";

describe("capabilities", () => {
  describe("ALL_CAPABILITIES", () => {
    it("contains all expected capability names", () => {
      expect(ALL_CAPABILITIES).toContain("text");
      expect(ALL_CAPABILITIES).toContain("images");
      expect(ALL_CAPABILITIES).toContain("video");
      expect(ALL_CAPABILITIES).toContain("audio");
      expect(ALL_CAPABILITIES).toContain("voiceNotes");
      expect(ALL_CAPABILITIES).toContain("files");
      expect(ALL_CAPABILITIES).toContain("location");
      expect(ALL_CAPABILITIES).toContain("reactions");
      expect(ALL_CAPABILITIES).toContain("replies");
      expect(ALL_CAPABILITIES).toContain("forward");
      expect(ALL_CAPABILITIES).toContain("delete");
      expect(ALL_CAPABILITIES).toContain("typingIndicator");
      expect(ALL_CAPABILITIES).toContain("readReceipts");
      expect(ALL_CAPABILITIES).toContain("inlineKeyboards");
      expect(ALL_CAPABILITIES).toContain("payments");
      expect(ALL_CAPABILITIES).toContain("voiceCalls");
    });

    it("has 16 entries", () => {
      expect(ALL_CAPABILITIES).toHaveLength(16);
    });
  });

  describe("createCapabilities", () => {
    it("returns all-false when called with empty overrides", () => {
      const caps = createCapabilities({});
      for (const key of ALL_CAPABILITIES) {
        expect(caps[key]).toBe(false);
      }
    });

    it("applies overrides correctly", () => {
      const caps = createCapabilities({ text: true, reactions: true });
      expect(caps.text).toBe(true);
      expect(caps.reactions).toBe(true);
      expect(caps.images).toBe(false);
      expect(caps.payments).toBe(false);
    });

    it("returns a frozen-shape object (all keys present)", () => {
      const caps = createCapabilities({ text: true });
      for (const key of ALL_CAPABILITIES) {
        expect(key in caps).toBe(true);
      }
    });
  });

  describe("PLATFORM_CAPABILITIES", () => {
    it("has an entry for every known platform", () => {
      for (const platform of ALL_PLATFORMS) {
        expect(PLATFORM_CAPABILITIES[platform]).toBeDefined();
      }
    });

    it("every platform supports text", () => {
      for (const platform of ALL_PLATFORMS) {
        expect(PLATFORM_CAPABILITIES[platform].text).toBe(true);
      }
    });

    it("every platform supports images, video, audio", () => {
      for (const platform of ALL_PLATFORMS) {
        const caps = PLATFORM_CAPABILITIES[platform];
        expect(caps.images).toBe(true);
        expect(caps.video).toBe(true);
        expect(caps.audio).toBe(true);
      }
    });

    // PRD 4.3 specific assertions
    describe("telegram (Tier A)", () => {
      const caps = PLATFORM_CAPABILITIES.telegram;

      it("supports all messaging features", () => {
        expect(caps.voiceNotes).toBe(true);
        expect(caps.files).toBe(true);
        expect(caps.location).toBe(true);
        expect(caps.reactions).toBe(true);
        expect(caps.replies).toBe(true);
        expect(caps.typingIndicator).toBe(true);
        expect(caps.readReceipts).toBe(true);
      });

      it("supports inline keyboards and payments", () => {
        expect(caps.inlineKeyboards).toBe(true);
        expect(caps.payments).toBe(true);
      });

      it("does not support voice calls", () => {
        expect(caps.voiceCalls).toBe(false);
      });
    });

    describe("discord (Tier A)", () => {
      const caps = PLATFORM_CAPABILITIES.discord;

      it("does not support voice notes", () => {
        expect(caps.voiceNotes).toBe(false);
      });

      it("does not support location", () => {
        expect(caps.location).toBe(false);
      });

      it("does not support read receipts", () => {
        expect(caps.readReceipts).toBe(false);
      });

      it("supports voice calls", () => {
        expect(caps.voiceCalls).toBe(true);
      });

      it("supports inline keyboards", () => {
        expect(caps.inlineKeyboards).toBe(true);
      });
    });

    describe("whatsapp (Tier B)", () => {
      const caps = PLATFORM_CAPABILITIES.whatsapp;

      it("supports voice notes", () => {
        expect(caps.voiceNotes).toBe(true);
      });

      it("supports inline keyboards (limited)", () => {
        expect(caps.inlineKeyboards).toBe(true);
      });

      it("does not support payments or voice calls", () => {
        expect(caps.payments).toBe(false);
        expect(caps.voiceCalls).toBe(false);
      });
    });

    describe("instagram (Tier C)", () => {
      const caps = PLATFORM_CAPABILITIES.instagram;

      it("does not support files", () => {
        expect(caps.files).toBe(false);
      });

      it("does not support location", () => {
        expect(caps.location).toBe(false);
      });

      it("does not support inline keyboards", () => {
        expect(caps.inlineKeyboards).toBe(false);
      });
    });

    describe("signal (Tier D)", () => {
      const caps = PLATFORM_CAPABILITIES.signal;

      it("supports voice notes and files", () => {
        expect(caps.voiceNotes).toBe(true);
        expect(caps.files).toBe(true);
      });

      it("does not support inline keyboards or payments", () => {
        expect(caps.inlineKeyboards).toBe(false);
        expect(caps.payments).toBe(false);
      });
    });
  });

  describe("supportsCapability", () => {
    it("returns true for supported capabilities", () => {
      expect(supportsCapability("telegram", "text")).toBe(true);
      expect(supportsCapability("telegram", "payments")).toBe(true);
      expect(supportsCapability("discord", "voiceCalls")).toBe(true);
    });

    it("returns false for unsupported capabilities", () => {
      expect(supportsCapability("discord", "voiceNotes")).toBe(false);
      expect(supportsCapability("signal", "payments")).toBe(false);
      expect(supportsCapability("instagram", "files")).toBe(false);
    });
  });

  describe("unsupportedCapabilities", () => {
    it("returns empty array when all required caps are supported", () => {
      const missing = unsupportedCapabilities("telegram", ["text", "images", "reactions"]);
      expect(missing).toEqual([]);
    });

    it("returns the unsupported capabilities", () => {
      const missing = unsupportedCapabilities("discord", [
        "text",
        "voiceNotes",
        "location",
        "readReceipts",
      ]);
      expect(missing).toEqual(["voiceNotes", "location", "readReceipts"]);
    });

    it("returns empty for empty required list", () => {
      expect(unsupportedCapabilities("signal", [])).toEqual([]);
    });
  });
});
