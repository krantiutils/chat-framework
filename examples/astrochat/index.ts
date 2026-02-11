/**
 * AstroChat — Example application demonstrating the chat framework.
 *
 * This script simulates a conversation with the AstroBot to show how the
 * session state machine drives human-like response timing. No real platform
 * connections are needed — it uses simulated messages.
 *
 * Run:
 *   npx tsx examples/astrochat/index.ts
 *
 * What it demonstrates:
 * 1. SessionStateMachine controlling response pacing
 * 2. FingerprintManager creating a consistent browser identity
 * 3. ProxyManager with sticky sessions
 * 4. Human-like behavioral patterns (idle, reading, thinking, typing)
 */

import { SessionState } from "@chat-framework/core";
import {
  FingerprintManager,
  ProxyManager,
} from "@chat-framework/browser";
import type { ProxyConfig } from "@chat-framework/browser";

import { AstroBot } from "./astro-bot.js";
import type { ChatMessage } from "./astro-bot.js";

// --- Browser identity setup ---

function setupIdentity() {
  const fingerprints = new FingerprintManager();
  const profileId = fingerprints.generateProfileId();
  const fingerprint = fingerprints.generate(profileId, {
    platform: "win32",
    locale: "en-US",
  });

  console.log("Browser identity created:");
  console.log(`  Profile ID: ${profileId}`);
  console.log(`  User Agent: ${fingerprint.userAgent}`);
  console.log(
    `  Screen: ${fingerprint.screen.width}x${fingerprint.screen.height}`
  );
  console.log(`  WebGL: ${fingerprint.webgl.renderer.slice(0, 60)}...`);
  console.log(`  Timezone: ${fingerprint.timezone}`);
  console.log(`  Canvas noise seed: ${fingerprint.canvas.noiseSeed}`);
  console.log();

  return { profileId, fingerprint };
}

// --- Proxy pool setup ---

function setupProxies() {
  const demoProxies: ProxyConfig[] = [
    { host: "proxy-us-east.example.com", port: 8080, protocol: "http" },
    { host: "proxy-us-west.example.com", port: 8080, protocol: "http" },
    { host: "proxy-eu-west.example.com", port: 8080, protocol: "http" },
  ];

  const proxies = new ProxyManager({
    proxies: demoProxies,
    maxConsecutiveFailures: 3,
    healthCheckTimeoutMs: 5000,
  });

  console.log(`Proxy pool: ${proxies.totalCount} proxies, ${proxies.healthyCount} healthy`);
  console.log();

  return proxies;
}

// --- Simulated conversation ---

const SIMULATED_MESSAGES: Array<{ delay: number; from: string; text: string }> =
  [
    { delay: 0, from: "alice", text: "Hey there!" },
    { delay: 3000, from: "alice", text: "What's in store for Leo today?" },
    { delay: 8000, from: "bob", text: "Scorpio here, give me a reading" },
    {
      delay: 12000,
      from: "alice",
      text: "That's interesting! What about Pisces?",
    },
    { delay: 18000, from: "charlie", text: "help" },
  ];

// --- Main ---

async function main() {
  console.log("=== AstroChat Example ===");
  console.log();

  // Set up browser identity and proxy pool
  const { profileId } = setupIdentity();
  const proxies = setupProxies();

  // Get a sticky proxy for this profile
  const proxy = proxies.getProxy(profileId);
  console.log(
    `Sticky proxy for ${profileId.slice(0, 8)}...: ${proxy ? `${proxy.host}:${proxy.port}` : "none"}`
  );
  console.log();

  // Create the bot
  const bot = new AstroBot();
  console.log("Bot created. Starting simulation...");
  console.log();

  // Schedule simulated messages
  const startTime = Date.now();
  const messageTimers: ReturnType<typeof setTimeout>[] = [];

  for (const msg of SIMULATED_MESSAGES) {
    const timer = setTimeout(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[${elapsed}s] Incoming message:`);
      const chatMsg: ChatMessage = {
        from: msg.from,
        text: msg.text,
        timestamp: Date.now(),
      };
      bot.receiveMessage(chatMsg);
    }, msg.delay);
    messageTimers.push(timer);
  }

  // Main tick loop — drives the state machine
  let tickCount = 0;
  const maxTicks = 100;
  const tickInterval = 300; // ms

  const loop = setInterval(() => {
    tickCount++;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const snap = bot.machine.tick();

    // Only log state periodically to reduce noise
    if (tickCount % 5 === 0) {
      const remaining = bot.machine.remaining();
      console.log(
        `[${elapsed}s] State: ${snap.state} | Period: ${snap.timePeriod} | Remaining: ${Math.max(0, remaining)}ms | Transitions: ${snap.transitionCount}`
      );
    }

    // Process any ready responses
    const responses = bot.tick();
    for (const resp of responses) {
      console.log(
        `[${elapsed}s] >>> SENDING to ${resp.to}: "${resp.text}" (after ${resp.typingDurationMs}ms typing delay)`
      );
    }

    // Stop after max ticks
    if (tickCount >= maxTicks) {
      clearInterval(loop);
      for (const timer of messageTimers) clearTimeout(timer);

      console.log();
      console.log("=== Simulation Complete ===");
      console.log(`Total ticks: ${tickCount}`);
      console.log(`Total transitions: ${snap.transitionCount}`);
      console.log(`Final state: ${snap.state}`);

      // Clean up proxy manager
      proxies.stopHealthChecks();
    }
  }, tickInterval);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
