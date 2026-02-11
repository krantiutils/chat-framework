# AstroChat Example

Astrology chatbot demonstrating the chat framework. Shows how `@chat-framework/core` and `@chat-framework/browser` work together to build a cross-platform messaging bot with human-like behavior.

## What This Demonstrates

1. **Session state machine** driving realistic idle/active/thinking patterns
2. **Stealth browser** with fingerprint consistency for Tier C platforms
3. **Proxy management** with sticky sessions and health checking
4. **Human simulation** integration pattern (typing delays, read pauses)

## Running

```bash
# From the repo root
pnpm install
pnpm build

# Run the example
npx tsx examples/astrochat/index.ts
```

The example runs a simulation loop — no real platform connections required. It demonstrates the behavioral patterns the framework produces.

## Architecture

```
AstroChat Bot
    │
    ├── SessionStateMachine (behavioral state)
    │       tick() ──> IDLE / ACTIVE / READING / THINKING / AWAY / SCROLLING
    │
    ├── StealthBrowser + FingerprintManager (identity)
    │       Consistent fingerprint per profile ID
    │
    ├── ProxyManager (network identity)
    │       Sticky sessions per profile
    │
    └── Message Handler (your application logic)
            Respond to messages with astrology readings
            Respect state machine pauses
```

## Files

- `index.ts` — Main entry point, simulation loop
- `astro-bot.ts` — Bot logic, message handling with human-like delays
