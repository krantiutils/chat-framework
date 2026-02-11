# Unified Messaging Platform with Human Simulation

> Build apps on any chat platform with ML-powered anti-detection

## Vision

A unified abstraction layer for WhatsApp, Telegram, Signal, Instagram, Facebook, Discord that enables building full applications (commerce, support, AI agents) on top of chat platforms. For platforms without official APIs, we use browser automation with ML-powered human behavior simulation to evade detection.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Platform Adapters](#2-platform-adapters)
3. [Human Simulation Engine](#3-human-simulation-engine)
4. [Unified Message API](#4-unified-message-api)
5. [Self-Healing System](#5-self-healing-system)
6. [Data & Training](#6-data--training)
7. [Implementation Plan](#7-implementation-plan)
8. [Open Questions](#8-open-questions)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              YOUR APPLICATION                                │
│                    (AstroChat, Commerce Bot, Support Agent)                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                           UNIFIED MESSAGE BUS                                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │  send() │ │receive()│ │ media() │ │payment()│ │ react() │ │ typing()│   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│                          PLATFORM ADAPTERS                                   │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐       │
│  │ Telegram │ Discord  │ WhatsApp │Instagram │ Facebook │  Signal  │       │
│  │  (API)   │  (API)   │  (Web)   │ (Scrape) │ (Scrape) │  (CLI)   │       │
│  │  Tier A  │  Tier A  │  Tier B  │  Tier C  │  Tier C  │  Tier D  │       │
│  └──────────┴──────────┴────┬─────┴────┬─────┴────┬─────┴──────────┘       │
│                              │          │          │                        │
│                              └──────────┼──────────┘                        │
│                                         │                                   │
│                          ┌──────────────▼──────────────┐                   │
│                          │   HUMAN SIMULATION ENGINE   │                   │
│                          │  (Mouse GAN + Keyboard GAN) │                   │
│                          └──────────────┬──────────────┘                   │
│                                         │                                   │
│                          ┌──────────────▼──────────────┐                   │
│                          │    BROWSER AUTOMATION       │                   │
│                          │  (Puppeteer + Stealth)      │                   │
│                          └─────────────────────────────┘                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                          SELF-HEALING SYSTEM                                │
│                    (Monitor → Diagnose → Fix → Deploy)                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Platform Tiers

| Tier | Platforms | Approach | Stability | Human Sim Required |
|------|-----------|----------|-----------|-------------------|
| **A** | Telegram, Discord | Official Bot APIs | Rock solid | No |
| **B** | WhatsApp | WhatsApp Web protocol (Baileys) | Good | Minimal |
| **C** | Instagram, Facebook | Browser automation + scraping | Fragile | **Yes - Full** |
| **D** | Signal | signal-cli / libsignal | Moderate | No |

---

## 2. Platform Adapters

### 2.1 Tier A: Official API Platforms

#### Telegram
- **Library**: `telegraf` or `node-telegram-bot-api`
- **Auth**: Bot token from @BotFather
- **Capabilities**: Full (text, media, inline keyboards, payments, voice)
- **Rate Limits**: 30 msg/sec to same chat, 1 msg/sec to same user

#### Discord
- **Library**: `discord.js`
- **Auth**: Bot token from Developer Portal
- **Capabilities**: Full (text, embeds, reactions, voice channels, slash commands)
- **Rate Limits**: 50 requests/sec global

### 2.2 Tier B: Reverse-Engineered Protocol

#### WhatsApp
- **Library**: `@whiskeysockets/baileys` (recommended) or `whatsapp-web.js`
- **Auth**: QR code scan (links to phone)
- **Capabilities**: Text, media, voice notes, location, contacts, reactions
- **Risks**: Account ban if detected as bot, occasional protocol breaks
- **Human Sim**: Light touch - realistic typing indicators, read delays

### 2.3 Tier C: Browser Automation (Full Human Simulation)

#### Instagram
- **Approach**: Puppeteer + stealth plugins + Human Simulation Engine
- **Auth**: Username/password login (store session)
- **Capabilities**: DMs (text, media, voice), stories view, reactions
- **Risks**: HIGH - aggressive bot detection, frequent UI changes
- **Human Sim**: **FULL** - mouse movements, typing dynamics, session behavior

#### Facebook Messenger
- **Approach**: Puppeteer + stealth plugins + Human Simulation Engine
- **Auth**: Username/password login (store session)
- **Capabilities**: Messages, media, reactions
- **Risks**: HIGH - similar to Instagram (same company)
- **Human Sim**: **FULL**

### 2.4 Tier D: CLI/Library Based

#### Signal
- **Library**: `signal-cli` or `libsignal-protocol`
- **Auth**: Phone number registration
- **Capabilities**: Text, media, reactions, groups
- **Risks**: Moderate - Signal may block unofficial clients

---

## 3. Human Simulation Engine

The core anti-detection system using ML-generated human behavior.

### 3.1 Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        HUMAN SIMULATION ENGINE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐ │
│  │    MOUSE GAN        │  │   KEYBOARD GAN      │  │   SESSION STATE     │ │
│  │   (WGAN-GP LSTM)    │  │   (WGAN-GP LSTM)    │  │     MACHINE         │ │
│  │                     │  │                     │  │                     │ │
│  │ Input:              │  │ Input:              │  │ States:             │ │
│  │ - Start (x,y)       │  │ - Text to type      │  │ - IDLE (2-30s)      │ │
│  │ - End (x,y)         │  │ - User profile z    │  │ - ACTIVE            │ │
│  │ - User profile z    │  │                     │  │ - READING (3-15s)   │ │
│  │                     │  │ Output:             │  │ - THINKING (1-5s)   │ │
│  │ Output:             │  │ - Hold times        │  │ - AWAY (5-30min)    │ │
│  │ - Trajectory points │  │ - Flight times      │  │ - SCROLLING         │ │
│  │ - Timestamps        │  │ - Typos + fixes     │  │                     │ │
│  │                     │  │ - Think pauses      │  │ Transitions:        │ │
│  │ Features:           │  │                     │  │ - Probabilistic     │ │
│  │ - Bezier + noise    │  │ Features:           │  │ - Time-of-day aware │ │
│  │ - Overshoot         │  │ - Digraph patterns  │  │ - Activity-based    │ │
│  │ - Micro-corrections │  │ - WPM variance      │  │                     │ │
│  │ - Velocity curves   │  │ - Fatigue modeling  │  │                     │ │
│  └──────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘ │
│             │                        │                        │             │
│             └────────────────────────┼────────────────────────┘             │
│                                      │                                      │
│                        ┌─────────────▼─────────────┐                       │
│                        │    ACTION ORCHESTRATOR    │                       │
│                        │                           │                       │
│                        │ - Sequences actions       │                       │
│                        │ - Adds realistic delays   │                       │
│                        │ - Interleaves mouse/key   │                       │
│                        │ - Respects state machine  │                       │
│                        └─────────────┬─────────────┘                       │
│                                      │                                      │
│                        ┌─────────────▼─────────────┐                       │
│                        │    BROWSER INTERFACE      │                       │
│                        │                           │                       │
│                        │ - CDP mouse events        │                       │
│                        │ - CDP keyboard events     │                       │
│                        │ - Scroll simulation       │                       │
│                        │ - Click with hover        │                       │
│                        └───────────────────────────┘                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Mouse Trajectory Generator (WGAN-GP)

Based on [generative-mouse-trajectories](https://github.com/jrcalgo/generative-mouse-trajectories).

#### Model Architecture
- **Generator**: LSTM autoregressive, conditioned on start/end points
- **Discriminator**: Bidirectional LSTM with kinematic feature extraction
- **Loss**: Wasserstein with gradient penalty (WGAN-GP)
- **Latent dim**: 64

#### Training Data
- **Primary**: [Kaggle Mouse Movement Dataset](https://www.kaggle.com/datasets/prashantmudgal/mouse-movement)
- **Secondary**: Self-collected data via Rust collector tool
- **Augmentation**: 4x via mirroring (horizontal, vertical, both)

#### Features Generated
| Feature | Description |
|---------|-------------|
| Position (x, y) | Absolute coordinates |
| Delta (dx, dy) | Movement per step |
| Timestamp (dt) | Time between points |
| Velocity | Speed at each point |
| Acceleration | Rate of velocity change |
| Jerk | Rate of acceleration change |
| Curvature | Path bending |

#### Realistic Behaviors
- **Overshoot**: Cursor goes past target, corrects back
- **Micro-jitter**: Small random movements while hovering
- **Bezier noise**: Natural curve variations
- **Fitts' Law compliance**: Movement time ~ log2(distance/target_width + 1)

### 3.3 Keyboard Dynamics Generator (WGAN-GP)

New model to build, similar architecture to mouse GAN.

#### Model Architecture
- **Generator**: LSTM conditioned on character sequence + user profile
- **Discriminator**: Bidirectional LSTM with rhythm analysis
- **Loss**: WGAN-GP

#### Training Data
- **Primary**: [CMU Keystroke Dynamics Benchmark](https://www.cs.cmu.edu/~keystroke/)
  - 51 subjects, 400 samples each
  - Hold time (H), Keydown-Keydown (DD), Keyup-Keydown (UD)
  - +/-200 microsecond precision
- **Secondary**: [Kaggle Keystroke Dynamics](https://www.kaggle.com/code/kartik2112/keystroke-dynamics-analysis-and-prediction-w-xgb)

#### Features Generated
| Feature | Description |
|---------|-------------|
| Hold time (H) | Duration key is pressed |
| Flight time (UD) | Gap between key release and next press |
| Digraph time (DD) | Key-to-key timing |
| WPM | Overall typing speed |
| Error rate | Typo frequency |

#### Realistic Behaviors
- **Digraph patterns**: Common pairs (th, er, ing) typed faster
- **Hand alternation**: Faster when switching hands
- **Finger reach**: Further keys = longer flight time
- **Fatigue**: Speed decreases over long sessions
- **Typos + corrections**: 2-5% error rate with realistic backspace
- **Think pauses**: Longer gaps between words/sentences (500-3000ms)
- **Burst typing**: Fast-slow-fast rhythm patterns

### 3.4 Session State Machine

```
                    ┌─────────────────┐
                    │     START       │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
         ┌─────────►│      IDLE       │◄─────────┐
         │          │   (2-30 sec)    │          │
         │          └────────┬────────┘          │
         │                   │                   │
         │          ┌────────▼────────┐          │
         │          │     ACTIVE      │──────────┤
         │          │  (doing tasks)  │          │
         │          └────────┬────────┘          │
         │                   │                   │
    ┌────┴────┐     ┌────────▼────────┐    ┌────┴────┐
    │  AWAY   │     │    READING      │    │SCROLLING│
    │(5-30min)│     │   (3-15 sec)    │    │ (random)│
    └─────────┘     └────────┬────────┘    └─────────┘
                             │
                    ┌────────▼────────┐
                    │    THINKING     │
                    │   (1-5 sec)     │
                    └─────────────────┘
```

#### State Transitions
- Probabilistic based on current activity
- Time-of-day awareness (less active at night)
- Activity type awareness (typing vs browsing)

### 3.5 User Profile (Latent Space)

Each simulated "user" has a persistent profile vector `z` that controls:
- Typing speed (WPM range)
- Mouse movement style (fast/precise vs slow/casual)
- Error rate
- Pause patterns
- Session behavior

**Key Decision**: Same `z` vector shared between mouse and keyboard models for consistent personality.

### 3.6 Anti-Detection Layers

#### Browser Fingerprint Consistency
- Canvas fingerprint (consistent per profile)
- WebGL renderer info
- Fonts list
- Screen resolution
- Timezone + language
- Plugin list

#### Network Layer
- **Residential proxies**: Sticky sessions per account
- **TLS fingerprint**: Match real browser
- **Request timing**: Human-like patterns

#### Automation Evasion
- Remove `navigator.webdriver`
- Patch CDP detection
- Randomize execution order
- Avoid headless markers

---

## 4. Unified Message API

### 4.1 Core Types

```typescript
// Platform identifier
type Platform = 'telegram' | 'discord' | 'whatsapp' | 'instagram' | 'facebook' | 'signal';

// Unified conversation reference
interface Conversation {
  id: string;
  platform: Platform;
  participants: User[];
  type: 'dm' | 'group' | 'channel';
  metadata: PlatformMetadata;
}

// Unified user reference
interface User {
  id: string;
  platform: Platform;
  username?: string;
  displayName?: string;
  avatar?: string;
}

// Unified message
interface Message {
  id: string;
  conversation: Conversation;
  sender: User;
  timestamp: Date;
  content: MessageContent;
  replyTo?: Message;
  reactions?: Reaction[];
}

// Message content types
type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; caption?: string }
  | { type: 'video'; url: string; caption?: string }
  | { type: 'audio'; url: string; duration: number }
  | { type: 'voice'; url: string; duration: number }
  | { type: 'file'; url: string; filename: string; size: number }
  | { type: 'location'; lat: number; lng: number; name?: string }
  | { type: 'contact'; name: string; phone: string }
  | { type: 'sticker'; id: string; url: string }
  | { type: 'link'; url: string; preview?: LinkPreview };

// Reaction
interface Reaction {
  emoji: string;
  user: User;
  timestamp: Date;
}
```

### 4.2 Core API

```typescript
interface MessagingClient {
  // Connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Sending
  sendText(conversation: Conversation, text: string): Promise<Message>;
  sendImage(conversation: Conversation, image: Buffer | string, caption?: string): Promise<Message>;
  sendAudio(conversation: Conversation, audio: Buffer | string): Promise<Message>;
  sendVoice(conversation: Conversation, voice: Buffer | string): Promise<Message>;
  sendFile(conversation: Conversation, file: Buffer | string, filename: string): Promise<Message>;
  sendLocation(conversation: Conversation, lat: number, lng: number): Promise<Message>;

  // Receiving (event-based)
  on(event: 'message', handler: (msg: Message) => void): void;
  on(event: 'reaction', handler: (reaction: Reaction, msg: Message) => void): void;
  on(event: 'typing', handler: (user: User, conversation: Conversation) => void): void;
  on(event: 'read', handler: (user: User, msg: Message) => void): void;
  on(event: 'presence', handler: (user: User, status: 'online' | 'offline') => void): void;

  // Interactions
  react(message: Message, emoji: string): Promise<void>;
  reply(message: Message, content: MessageContent): Promise<Message>;
  forward(message: Message, to: Conversation): Promise<Message>;
  delete(message: Message): Promise<void>;

  // Presence
  setTyping(conversation: Conversation, duration?: number): Promise<void>;
  markRead(message: Message): Promise<void>;

  // Conversations
  getConversations(): Promise<Conversation[]>;
  getMessages(conversation: Conversation, limit?: number, before?: Date): Promise<Message[]>;
}
```

### 4.3 Platform Capability Matrix

| Capability | Telegram | Discord | WhatsApp | Instagram | Facebook | Signal |
|------------|:--------:|:-------:|:--------:|:---------:|:--------:|:------:|
| Text | Yes | Yes | Yes | Yes | Yes | Yes |
| Images | Yes | Yes | Yes | Yes | Yes | Yes |
| Video | Yes | Yes | Yes | Yes | Yes | Yes |
| Audio | Yes | Yes | Yes | Yes | Yes | Yes |
| Voice notes | Yes | No | Yes | Yes | Yes | Yes |
| Files | Yes | Yes | Yes | No | Yes | Yes |
| Location | Yes | No | Yes | No | Yes | Yes |
| Reactions | Yes | Yes | Yes | Yes | Yes | Yes |
| Replies | Yes | Yes | Yes | Yes | Yes | Yes |
| Typing indicator | Yes | Yes | Yes | Yes | Yes | Yes |
| Read receipts | Yes | No | Yes | Yes | Yes | Yes |
| Inline keyboards | Yes | Yes | Yes* | No | No | No |
| Payments | Yes | No | No | No | No | No |
| Voice calls | No | Yes | No | No | No | No |

*WhatsApp has list messages and buttons but limited

---

## 5. Self-Healing System

Automated detection and fixing of scraper breakages.

### 5.1 Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SELF-HEALING SYSTEM                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │    MONITOR      │───►│    DIAGNOSE     │───►│      FIX        │         │
│  │                 │    │                 │    │                 │         │
│  │ - Health checks │    │ - Error parsing │    │ - Claude API    │         │
│  │ - Error rates   │    │ - DOM diffing   │    │ - Code gen      │         │
│  │ - Latency       │    │ - Screenshot    │    │ - Test fix      │         │
│  │ - Success rate  │    │ - Network logs  │    │ - PR creation   │         │
│  └─────────────────┘    └─────────────────┘    └────────┬────────┘         │
│                                                          │                  │
│                                                 ┌────────▼────────┐         │
│                                                 │     DEPLOY      │         │
│                                                 │                 │         │
│                                                 │ - Auto if tests │         │
│                                                 │   pass          │         │
│                                                 │ - Manual review │         │
│                                                 │   option        │         │
│                                                 └─────────────────┘         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Monitoring

```typescript
interface HealthMetrics {
  platform: Platform;
  timestamp: Date;

  // Availability
  connected: boolean;
  lastSuccessfulAction: Date;

  // Performance
  avgLatencyMs: number;
  p99LatencyMs: number;

  // Reliability
  successRate: number;  // 0-1
  errorRate: number;    // 0-1
  errorTypes: Map<string, number>;

  // Detection
  suspectedDetection: boolean;
  captchaEncountered: boolean;
  rateLimited: boolean;
}
```

### 5.3 Diagnosis Pipeline

1. **Error Classification**
   - Selector not found -> UI changed
   - Timeout -> Performance issue or blocking
   - Auth error -> Session expired or detection
   - Network error -> Connectivity or blocking

2. **Context Gathering**
   - Screenshot of current state
   - DOM snapshot
   - Network requests log
   - Console errors
   - Recent successful state for comparison

3. **Root Cause Analysis**
   - Compare current DOM to last working version
   - Identify changed selectors
   - Detect new detection mechanisms
   - Check for A/B tests

### 5.4 Fix Generation (Claude-powered)

```typescript
interface FixRequest {
  error: Error;
  context: {
    screenshot: Buffer;
    dom: string;
    networkLogs: NetworkLog[];
    lastWorkingCode: string;
    recentChanges: DOMDiff;
  };
  platform: Platform;
  affectedFunction: string;
}

interface FixResponse {
  diagnosis: string;
  confidence: number;  // 0-1
  suggestedFix: CodePatch;
  testCases: TestCase[];
  rollbackPlan: string;
}
```

### 5.5 Deployment Strategy

- **Auto-deploy**: If fix passes all tests and confidence > 0.8
- **Staged rollout**: Deploy to 10% -> 50% -> 100%
- **Instant rollback**: If error rate increases
- **Human review**: For low-confidence fixes or structural changes

---

## 6. Data & Training

### 6.1 Mouse Movement Data

#### Primary Dataset
- **Source**: [Kaggle Mouse Movement](https://www.kaggle.com/datasets/prashantmudgal/mouse-movement)
- **Processing**: Convert to format compatible with generative-mouse-trajectories

#### Self-Collection Tool
- Use Rust collector from generative-mouse-trajectories repo
- Collect from team members (diverse typing styles)
- Target: 10+ users, 1000+ trajectories each

### 6.2 Keystroke Dynamics Data

#### Primary Dataset
- **Source**: [CMU Keystroke Dynamics Benchmark](https://www.cs.cmu.edu/~keystroke/)
- **Format**: CSV with H (hold), DD (keydown-keydown), UD (keyup-keydown)
- **Size**: 51 subjects x 400 samples = 20,400 samples

#### Data Augmentation
- Speed scaling (faster/slower versions)
- Noise injection
- User interpolation in latent space

### 6.3 Training Pipeline

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Raw Data   │───>│  Preprocess │───>│   Train     │───>│   Export    │
│             │    │             │    │   GAN       │    │   Model     │
│ - Kaggle    │    │ - Normalize │    │             │    │             │
│ - CMU       │    │ - Segment   │    │ - WGAN-GP   │    │ - ONNX      │
│ - Collected │    │ - Augment   │    │ - 1000 eps  │    │ - TorchScript│
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

### 6.4 Model Serving

- **Format**: ONNX or TorchScript for production
- **Inference**: CPU-only (no GPU required)
- **Latency target**: <10ms per trajectory generation

---

## 7. Implementation Plan

### Phase 1: Foundation (Week 1-2)
- [ ] Project structure setup
- [ ] Core types and interfaces
- [ ] Telegram adapter (Tier A reference)
- [ ] Discord adapter (Tier A reference)
- [ ] Basic unified API

### Phase 2: WhatsApp Integration (Week 3)
- [ ] Baileys integration
- [ ] Session management
- [ ] Basic human simulation (typing delays)
- [ ] Message mapping

### Phase 3: Human Simulation Engine (Week 4-6)
- [ ] Fork/adapt generative-mouse-trajectories
- [ ] Train on Kaggle mouse data
- [ ] Build keyboard dynamics GAN
- [ ] Train on CMU keystroke data
- [ ] Session state machine
- [ ] Action orchestrator

### Phase 4: Browser Automation (Week 7-8)
- [ ] Puppeteer setup with stealth
- [ ] Instagram adapter
- [ ] Facebook adapter
- [ ] Integration with Human Simulation Engine

### Phase 5: Self-Healing (Week 9-10)
- [ ] Monitoring infrastructure
- [ ] Error classification
- [ ] Claude integration for fix generation
- [ ] Test and deploy pipeline

### Phase 6: Polish & Production (Week 11-12)
- [ ] Signal adapter
- [ ] Performance optimization
- [ ] Documentation
- [ ] Example applications

---

## 8. Open Questions

### Technical Decisions Needed

1. **Language Choice**
   - TypeScript: Best WhatsApp/browser libs, unified stack
   - Python: Best ML ecosystem, may need for GAN training
   - **Recommendation**: TypeScript for main system, Python for ML training

2. **Proxy Strategy**
   - Residential rotating (cheap, less consistent)
   - Residential sticky (more $, better for sessions)
   - Mobile proxies (highest trust, highest cost)
   - **Recommendation**: Start with residential sticky, upgrade to mobile if needed

3. **Model Serving**
   - Python server with FastAPI
   - ONNX runtime in Node.js
   - **Recommendation**: ONNX in Node for lower latency and simpler deployment

4. **Account Management**
   - How many accounts per platform?
   - Account warming strategy?
   - Burn rate tolerance?

5. **Self-Healing Autonomy**
   - Fully automatic deployment?
   - Require human approval?
   - **Recommendation**: Auto for high-confidence, human review for structural changes

### Business Questions

1. **Platform Priority**
   - Which platforms are must-have vs nice-to-have?
   - Where do target users live?

2. **Scale Requirements**
   - Messages per day?
   - Concurrent conversations?
   - Geographic distribution?

3. **Compliance**
   - Terms of service implications
   - Data retention requirements
   - User consent mechanisms

---

## Appendix A: Resources

### Libraries
- [Baileys (WhatsApp)](https://github.com/WhiskeySockets/Baileys)
- [Telegraf (Telegram)](https://github.com/telegraf/telegraf)
- [Discord.js](https://github.com/discordjs/discord.js)
- [Puppeteer](https://github.com/puppeteer/puppeteer)
- [puppeteer-extra-plugin-stealth](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth)

### ML References
- [generative-mouse-trajectories](https://github.com/jrcalgo/generative-mouse-trajectories)
- [CMU Keystroke Dataset](https://www.cs.cmu.edu/~keystroke/)
- [Kaggle Mouse Movement](https://www.kaggle.com/datasets/prashantmudgal/mouse-movement)

### Papers
- "Comparing Anomaly-Detection Algorithms for Keystroke Dynamics" (DSN-2009)
- "Mobile Keystroke Biometrics Using Transformers" (2022)
- Fitts' Law for mouse movement validation

---

## Appendix B: Example Use Case - AstroChat

```typescript
import { UnifiedClient, Platform } from 'unified-messaging';

const client = new UnifiedClient({
  platforms: {
    whatsapp: { /* config */ },
    telegram: { /* config */ },
    instagram: { /* config */ },
  },
  humanSimulation: {
    enabled: true,
    mouseModel: './models/mouse-gan.onnx',
    keyboardModel: './models/keyboard-gan.onnx',
  }
});

client.on('message', async (msg) => {
  // AI processes message
  const response = await astroAI.getReading(msg.content.text);

  // Send with human-like delays
  await client.setTyping(msg.conversation, response.length * 50); // ~50ms per char
  await client.sendText(msg.conversation, response);

  // Offer payment if reading complete
  if (response.includes('full reading')) {
    await client.sendPaymentRequest(msg.conversation, {
      amount: 9.99,
      currency: 'USD',
      description: 'Full Astrological Reading',
      qrCode: await generatePaymentQR(),
    });
  }
});

await client.connect();
```
