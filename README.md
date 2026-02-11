# Chat Framework

Unified messaging platform with ML-powered human behavior simulation. Build applications on WhatsApp, Telegram, Signal, Instagram, Facebook, and Discord with realistic anti-detection.

## Architecture

```
YOUR APPLICATION (AstroChat, Commerce Bot, Support Agent)
    │
    ▼
UNIFIED MESSAGE BUS ─── send() / receive() / media() / typing()
    │
    ▼
PLATFORM ADAPTERS
    ├── Telegram (API, Tier A)
    ├── Discord  (API, Tier A)
    ├── WhatsApp (Web protocol, Tier B)
    ├── Instagram (Browser automation, Tier C)
    ├── Facebook  (Browser automation, Tier C)
    └── Signal    (CLI, Tier D)
            │
            ▼
    HUMAN SIMULATION ENGINE
    ├── Mouse Trajectory GAN (WGAN-GP LSTM)
    ├── Keyboard Dynamics GAN (WGAN-GP LSTM)
    └── Session State Machine (probabilistic)
            │
            ▼
    BROWSER AUTOMATION (Puppeteer + stealth + fingerprinting)
```

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`@chat-framework/core`](docs/api/core.md) | Session state machine, profiles, transitions | Implemented |
| [`@chat-framework/browser`](docs/api/browser.md) | Stealth browser, fingerprinting, proxy management | Implemented |
| [`@chat-framework/adapters`](packages/adapters/) | Platform adapters (Telegram, Discord, etc.) | Planned |
| [`chat-framework-gan`](docs/api/python-ml.md) | Mouse & keyboard WGAN-GP models (Python) | Implemented |

## Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 10.28.2
- **Python** >= 3.10 (for ML models)
- **PyTorch** >= 2.0.0 (for training/inference)

## Installation

### TypeScript packages

```bash
git clone <repo-url> chat-framework
cd chat-framework
pnpm install
pnpm build
```

### Python ML packages

```bash
pip install -e .                  # Core dependencies
pip install -e ".[export]"        # + ONNX export support
pip install -e ".[dev]"           # + pytest
```

## Quick Start

### Session State Machine

The core module provides a probabilistic state machine that simulates realistic user session behavior — idle periods, active bursts, reading pauses, thinking delays, scrolling, and AFK intervals. It's pull-based (no internal timers), deterministic when seeded, and drives the human simulation engine.

```typescript
import {
  SessionStateMachine,
  SessionState,
  ActivityType,
} from '@chat-framework/core';

// Create with default "average" profile
const machine = new SessionStateMachine();

// Or with a custom behavioral profile
const machine = new SessionStateMachine({
  profile: {
    idleTendency: 0.3,    // Impatient — short idles
    afkProneness: 0.2,    // Rarely goes AFK
    readingSpeed: 0.8,    // Fast reader
    scrollTendency: 0.4,  // Moderate scrolling
    deliberation: 0.6,    // Thinks before acting
    activityLevel: 0.7,   // Active user
  },
});

// Listen for state transitions
const unsubscribe = machine.onTransition((event) => {
  console.log(`${event.from} → ${event.to} after ${event.dwellTime}ms`);
});

// Drive the machine from your loop
setInterval(() => {
  const snapshot = machine.tick();

  if (snapshot.state === SessionState.ACTIVE) {
    // Perform actions (send messages, click buttons, etc.)
  }
}, 500);

// Tell the machine what kind of activity is happening
machine.setActivityType(ActivityType.TYPING);
```

### Stealth Browser with Fingerprinting

The browser package launches Puppeteer instances with stealth evasion, consistent fingerprints, and proxy management. Each "identity" has a deterministic fingerprint — same profile ID always produces the same user agent, screen size, WebGL renderer, canvas noise, fonts, and timezone.

```typescript
import {
  StealthBrowser,
  FingerprintManager,
  ProxyManager,
} from '@chat-framework/browser';

// Generate a persistent identity
const fingerprints = new FingerprintManager();
const profileId = fingerprints.generateProfileId();
const fingerprint = fingerprints.generate(profileId, {
  platform: 'win32',
  locale: 'en-US',
});

// Set up proxy pool
const proxies = new ProxyManager({
  proxies: [
    { host: '1.2.3.4', port: 8080, protocol: 'http', username: 'u', password: 'p' },
    { host: '5.6.7.8', port: 8080, protocol: 'http', username: 'u', password: 'p' },
  ],
});
proxies.startHealthChecks();

// Launch stealth browser
const browser = new StealthBrowser();
const instance = await browser.launch({
  profile: {
    id: profileId,
    fingerprint,
    proxy: proxies.getProxy(profileId) ?? undefined,
    createdAt: new Date().toISOString(),
  },
  headless: true,
});

// Use the page — all fingerprints are injected
await instance.page.goto('https://example.com');

// Clean up
await instance.close();
proxies.stopHealthChecks();
```

### ML Models — Generating Human-Like Behavior

Train and run the WGAN-GP LSTM models that generate realistic mouse trajectories and keystroke timings.

```bash
# Train mouse trajectory model
mouse-gan-train --data_path ./data/mouse_movements.csv --epochs 500

# Train keyboard dynamics model
keyboard-gan-train --data ./data/keystrokes.csv --epochs 500

# Generate mouse trajectories
mouse-gan-generate --checkpoint checkpoints/mouse_best.pt \
  --start 100,500 --end 800,300 --num_samples 5

# Generate keystroke timings
keyboard-gan-generate --checkpoint checkpoints/keyboard_best.pt \
  --text "Hello, how are you?" --samples 3
```

```python
from mouse_trajectory_gan.inference import TrajectoryGenerator
from keyboard_dynamics_gan.inference import KeystrokeGenerator

# Mouse trajectories
mouse = TrajectoryGenerator.from_checkpoint('checkpoints/mouse_best.pt')
trajectories = mouse.generate(start=(100, 500), end=(800, 300), num_samples=5)
for t in trajectories:
    print(f"{t.num_points} points, {t.timestamps[-1]:.3f}s total")

# Keystroke timings
keyboard = KeystrokeGenerator.from_checkpoint('checkpoints/keyboard_best.pt')
sequences = keyboard.generate(text="Hello, how are you?", num_samples=3)
for seq in sequences:
    wpm = len(seq.characters) / (seq.timestamps[-1] / 60) * (60 / 5)
    print(f"WPM: {wpm:.0f}, total: {seq.timestamps[-1]:.2f}s")
```

### ONNX Export for Production

Export trained models to ONNX format for deployment in Node.js via `onnxruntime-node`:

```python
from mouse_trajectory_gan.export import export_onnx as export_mouse
from keyboard_dynamics_gan.export import export_onnx as export_keyboard

export_mouse('checkpoints/mouse_best.pt', 'models/mouse-gan.onnx')
export_keyboard('checkpoints/keyboard_best.pt', 'models/keyboard-gan.onnx')
```

## Testing

```bash
# TypeScript tests
pnpm test

# Python tests
pytest

# Type checking
pnpm typecheck
```

## Project Structure

```
chat-framework/
├── packages/
│   ├── core/                 # Session state machine (@chat-framework/core)
│   ├── browser/              # Stealth browser (@chat-framework/browser)
│   └── adapters/             # Platform adapters (WIP)
├── keyboard_dynamics_gan/    # Keystroke timing WGAN-GP (Python)
├── mouse_trajectory_gan/     # Mouse trajectory WGAN-GP (Python)
├── scripts/                  # CLI training & generation scripts
├── tests/                    # Python test suite
├── examples/
│   └── astrochat/            # Example: astrology chatbot
├── docs/
│   └── api/                  # API reference docs
│       ├── core.md
│       ├── browser.md
│       └── python-ml.md
├── PRD.md                    # Product requirements document
├── package.json              # pnpm workspace root
└── pyproject.toml            # Python project config
```

## API Reference

- [`@chat-framework/core`](docs/api/core.md) — Session state machine, profiles, transitions
- [`@chat-framework/browser`](docs/api/browser.md) — Stealth browser, fingerprints, proxies
- [Python ML packages](docs/api/python-ml.md) — Mouse & keyboard GAN models

## Example Applications

- [AstroChat](examples/astrochat/) — Astrology chatbot demonstrating the full framework
