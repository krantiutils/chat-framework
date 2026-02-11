# Python ML Packages API Reference

WGAN-GP LSTM models for generating realistic mouse trajectories and keystroke timings. Two packages share the same architecture pattern: Generator (LSTM autoregressive) + Discriminator (bidirectional LSTM) trained with Wasserstein loss and gradient penalty.

**Package**: `chat-framework-gan` (v0.1.0)

---

## Mouse Trajectory GAN

### TrajectoryGenerator

High-level inference API. Load from checkpoint and generate trajectories between two screen coordinates.

**Source**: `mouse_trajectory_gan/inference.py`

```python
from mouse_trajectory_gan.inference import TrajectoryGenerator

gen = TrajectoryGenerator.from_checkpoint('checkpoints/mouse_best.pt')
trajectories = gen.generate(start=(100, 500), end=(800, 300), num_samples=5)
```

#### `TrajectoryGenerator.from_checkpoint(checkpoint_path, device=None)`

Load generator from a `.pt` checkpoint file. Auto-detects CUDA/MPS/CPU if `device` is None.

**Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `checkpoint_path` | `str` | required | Path to `.pt` file |
| `device` | `str \| None` | `None` | `'cuda'`, `'cpu'`, `'mps'`, or auto-detect |

**Returns**: `TrajectoryGenerator`

#### `TrajectoryGenerator.generate(start, end, num_samples=1)`

Generate mouse trajectories between two pixel coordinates.

**Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `start` | `tuple[float, float]` | required | (x, y) start pixel position |
| `end` | `tuple[float, float]` | required | (x, y) target pixel position |
| `num_samples` | `int` | `1` | Number of trajectory variations |

**Returns**: `list[Trajectory]`

### Trajectory

```python
@dataclass
class Trajectory:
    positions: np.ndarray      # (N, 2) absolute pixel positions
    timestamps: np.ndarray     # (N,) cumulative time in seconds
    num_points: int            # total point count
```

### Generator (nn.Module)

Low-level PyTorch model. LSTM autoregressive, conditioned on start/end points and a latent noise vector.

**Source**: `mouse_trajectory_gan/models/generator.py`

**Architecture**:
- Condition encoder: Linear(6 + latent_dim, hidden) -> ReLU -> Linear(hidden, hidden)
- LSTM: input_size=(3 + hidden_dim + 4), hidden_size=hidden, num_layers=2
- Output: Linear(hidden, hidden//2) -> ReLU -> Linear(hidden//2, 3) -> Softplus for dt

Dynamic features computed at each step: remaining distance, angle, dx, dy to target.

#### `Generator.forward(start, end, z, target_sequences=None, target_lengths=None, teacher_forcing_ratio=0.0)`

Training forward pass.

| Param | Shape | Description |
|-------|-------|-------------|
| `start` | `(B, 2)` | Normalized start positions [0, 1] |
| `end` | `(B, 2)` | Normalized end positions [0, 1] |
| `z` | `(B, latent_dim)` | Noise vector |
| `target_sequences` | `(B, T, 3)` | Ground truth (dx, dy, dt) |
| `target_lengths` | `(B,)` | Actual sequence lengths |
| `teacher_forcing_ratio` | `float` | Probability of using ground truth |

**Returns**: `(outputs: (B, T, 3), lengths: (B,))`

#### `Generator.generate(start, end, z=None)`

Inference with early stopping (stops when within `distance_threshold` of target).

| Param | Shape | Description |
|-------|-------|-------------|
| `start` | `(B, 2)` | Normalized start positions |
| `end` | `(B, 2)` | Normalized end positions |
| `z` | `(B, latent_dim) \| None` | Sampled from N(0,1) if None |

**Returns**: `(outputs: (B, T, 3), lengths: (B,))`

### Discriminator (nn.Module)

Bidirectional LSTM critic with kinematic feature extraction.

**Source**: `mouse_trajectory_gan/models/discriminator.py`

**Architecture**:
- Feature encoder: Linear(9, hidden) -> ReLU -> Linear(hidden, hidden)
- Bidirectional LSTM: hidden_size=hidden, num_layers=2
- Output: Linear(hidden*2, hidden) -> ReLU -> Linear(hidden, hidden//2) -> ReLU -> Linear(hidden//2, 1)

No sigmoid — outputs unbounded Wasserstein scores.

#### `Discriminator.forward(trajectories, dts, lengths)`

| Param | Shape | Description |
|-------|-------|-------------|
| `trajectories` | `(B, T, 2)` | Absolute positions |
| `dts` | `(B, T)` | Time deltas |
| `lengths` | `(B,)` | Actual sequence lengths |

**Returns**: `(B, 1)` — Wasserstein critic scores

### compute_kinematics

**Source**: `mouse_trajectory_gan/models/kinematics.py`

```python
def compute_kinematics(positions, dts, eps=1e-8) -> torch.Tensor:
```

Compute 9 kinematic features from trajectory positions:

| Index | Feature | Description |
|-------|---------|-------------|
| 0 | x | Absolute x position |
| 1 | y | Absolute y position |
| 2 | dx | Position delta x |
| 3 | dy | Position delta y |
| 4 | dt | Time delta |
| 5 | velocity | Speed at each point |
| 6 | acceleration | Rate of velocity change |
| 7 | jerk | Rate of acceleration change |
| 8 | curvature | Path bending |

**Input**: `positions (B, T, 2)`, `dts (B, T)` | **Output**: `(B, T, 9)`

### trajectory_to_absolute

```python
def trajectory_to_absolute(start, deltas) -> torch.Tensor:
```

Convert relative deltas to absolute positions via cumulative sum.

**Input**: `start (B, 2)`, `deltas (B, T, 2)` | **Output**: `(B, T+1, 2)`

---

## Keyboard Dynamics GAN

### KeystrokeGenerator

High-level inference API. Load from checkpoint and generate keystroke timings for any text.

**Source**: `keyboard_dynamics_gan/inference.py`

```python
from keyboard_dynamics_gan.inference import KeystrokeGenerator

gen = KeystrokeGenerator.from_checkpoint('checkpoints/keyboard_best.pt')
sequences = gen.generate(text="Hello, how are you?", num_samples=3)
```

#### `KeystrokeGenerator.from_checkpoint(checkpoint_path, device=None)`

Load generator from a `.pt` checkpoint file.

**Parameters**: Same as `TrajectoryGenerator.from_checkpoint`.

**Returns**: `KeystrokeGenerator`

#### `KeystrokeGenerator.generate(text, num_samples=1)`

Generate keystroke timings for the given text.

**Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `text` | `str` | required | Text to generate timings for |
| `num_samples` | `int` | `1` | Number of timing variations |

**Returns**: `list[KeystrokeSequence]`

### KeystrokeSequence

```python
@dataclass
class KeystrokeSequence:
    characters: str              # the text string
    hold_times: np.ndarray       # (N,) hold duration per key in seconds
    flight_times: np.ndarray     # (N,) inter-key interval in seconds
    timestamps: np.ndarray       # (N,) cumulative time in seconds
    num_keystrokes: int          # total keystroke count
```

### Generator (nn.Module)

LSTM autoregressive generator conditioned on character IDs and a latent user profile vector.

**Source**: `keyboard_dynamics_gan/models/generator.py`

**Architecture**:
- Character embedding: Embedding(128, 32)
- Condition encoder: Linear(latent_dim, hidden) -> ReLU -> Linear(hidden, hidden)
- LSTM: input_size=(char_embedding + hidden + 2), hidden_size=hidden, num_layers=2
- Output: Linear(hidden, hidden//2) -> ReLU -> Linear(hidden//2, 2) -> Softplus

The latent vector `z` serves as a user "personality" — same `z` produces consistent typing speed, error rate, and rhythm patterns.

#### `Generator.forward(char_ids, z, target_timings=None, lengths=None, teacher_forcing_ratio=0.0)`

| Param | Shape | Description |
|-------|-------|-------------|
| `char_ids` | `(B, L)` | Integer character IDs (0-127, padded) |
| `z` | `(B, latent_dim)` | User profile / noise vector |
| `target_timings` | `(B, L, 2)` | Ground truth [hold, flight] |
| `lengths` | `(B,)` | Actual sequence lengths |
| `teacher_forcing_ratio` | `float` | Probability of using ground truth |

**Returns**: `(outputs: (B, L, 2), lengths: (B,))`

#### `Generator.generate(char_ids, lengths, z=None)`

| Param | Shape | Description |
|-------|-------|-------------|
| `char_ids` | `(B, L)` | Character IDs |
| `lengths` | `(B,)` | Sequence lengths |
| `z` | `(B, latent_dim) \| None` | Sampled from N(0,1) if None |

**Returns**: `(timings: (B, L, 2), lengths: (B,))`

### Discriminator (nn.Module)

Bidirectional LSTM critic with rhythm feature analysis.

**Source**: `keyboard_dynamics_gan/models/discriminator.py`

**Architecture**:
- Character embedding: Embedding(128, 32)
- Feature encoder: Linear(7 + char_embedding, hidden) -> ReLU -> Linear(hidden, hidden)
- Bidirectional LSTM: hidden_size=hidden, num_layers=2
- Output: Linear(hidden*2, hidden) -> ReLU -> Linear(hidden, hidden//2) -> ReLU -> Linear(hidden//2, 1)

#### `Discriminator.forward(char_ids, timings, lengths)`

| Param | Shape | Description |
|-------|-------|-------------|
| `char_ids` | `(B, T)` | Character IDs |
| `timings` | `(B, T, 2)` | [hold_time, flight_time] |
| `lengths` | `(B,)` | Actual sequence lengths |

**Returns**: `(B, 1)` — Wasserstein critic scores

### compute_rhythm_features

**Source**: `keyboard_dynamics_gan/models/rhythm.py`

```python
def compute_rhythm_features(hold_times, flight_times, eps=1e-8) -> torch.Tensor:
```

Compute 7 rhythm features from keystroke timings:

| Index | Feature | Description |
|-------|---------|-------------|
| 0 | hold_time | Key press duration |
| 1 | flight_time | Inter-key interval |
| 2 | digraph_time | Key-to-key timing (hold + flight) |
| 3 | typing_speed | 1 / digraph_time |
| 4 | speed_change | Delta of typing speed (acceleration) |
| 5 | hold_ratio | hold_time / digraph_time |
| 6 | typing_jerk | Delta of speed change |

**Input**: `hold_times (B, T)`, `flight_times (B, T)` | **Output**: `(B, T, 7)`

---

## Configuration

Both models use `@dataclass` configs with sensible defaults.

### Mouse Config

**Source**: `mouse_trajectory_gan/config.py`

```python
@dataclass
class Config:
    # Screen
    screen_width: float = 1920.0
    screen_height: float = 1080.0

    # Sequence limits
    min_trajectory_length: int = 5
    max_trajectory_length: int = 200

    # Model
    latent_dim: int = 64
    generator_hidden_dim: int = 256
    generator_num_layers: int = 2
    discriminator_hidden_dim: int = 128
    discriminator_num_layers: int = 2

    # Training
    batch_size: int = 32
    learning_rate: float = 1e-4
    betas: tuple = (0.5, 0.9)
    n_critic: int = 1
    gradient_penalty_weight: float = 10.0
    gp_every_n: int = 4
    gp_batch_frac: float = 0.25
    use_amp: bool = True
    epochs: int = 1000

    # Early stopping
    patience: int = 50
    lr_patience: int = 20
    lr_factor: float = 0.5
    min_lr: float = 1e-6

    # Generation
    distance_threshold: float = 0.02
    max_generation_steps: int = 200

    # Teacher forcing
    teacher_forcing_start: float = 1.0
    teacher_forcing_end: float = 0.0
    teacher_forcing_decay_epochs: int = 100

    # Loss weights
    endpoint_loss_weight: float = 50.0
    direction_loss_weight: float = 10.0
```

### Keyboard Config

**Source**: `keyboard_dynamics_gan/config.py`

```python
@dataclass
class Config:
    # Character encoding
    vocab_size: int = 128
    char_embedding_dim: int = 32

    # Sequence limits
    min_sequence_length: int = 5
    max_sequence_length: int = 200

    # Model (same architecture dims as mouse)
    latent_dim: int = 64
    generator_hidden_dim: int = 256
    generator_num_layers: int = 2
    discriminator_hidden_dim: int = 128
    discriminator_num_layers: int = 2

    # Training (same hyperparams as mouse)
    batch_size: int = 32
    learning_rate: float = 1e-4
    betas: tuple = (0.5, 0.9)
    n_critic: int = 1
    gradient_penalty_weight: float = 10.0
    gp_every_n: int = 4
    gp_batch_frac: float = 0.25
    use_amp: bool = True
    epochs: int = 1000

    # Early stopping
    patience: int = 50
    lr_patience: int = 20
    lr_factor: float = 0.5
    min_lr: float = 1e-6

    # Teacher forcing
    teacher_forcing_start: float = 1.0
    teacher_forcing_end: float = 0.0
    teacher_forcing_decay_epochs: int = 100

    # Loss weights
    timing_loss_weight: float = 20.0
    rhythm_loss_weight: float = 10.0
```

---

## ONNX Export

Export trained generators for deployment in Node.js via `onnxruntime-node`. Wrapper classes handle the ONNX limitation of no dynamic control flow by running fixed-length generation.

### Mouse Export

**Source**: `mouse_trajectory_gan/export.py`

```python
from mouse_trajectory_gan.export import export_onnx

export_onnx(
    checkpoint_path='checkpoints/mouse_best.pt',
    output_path='models/mouse-gan.onnx',
    opset_version=17,
    device=None,  # defaults to CPU for export
)
```

**ONNX inputs**: `start (B, 2)`, `end (B, 2)`, `z (B, 64)`
**ONNX output**: `sequences (B, 200, 3)` — (dx, dy, dt) for max_generation_steps

### Keyboard Export

**Source**: `keyboard_dynamics_gan/export.py`

```python
from keyboard_dynamics_gan.export import export_onnx

export_onnx(
    checkpoint_path='checkpoints/keyboard_best.pt',
    output_path='models/keyboard-gan.onnx',
    max_seq_len=200,
    opset_version=17,
)
```

**ONNX inputs**: `char_ids (B, 200)`, `z (B, 64)`
**ONNX output**: `timings (B, 200, 2)` — [hold_time, flight_time]

---

## CLI Scripts

Installed as entry points via `pyproject.toml`.

### Training

```bash
# Mouse trajectory GAN
mouse-gan-train \
  --data_path ./data/mouse_movements.csv \
  --epochs 500 \
  --batch_size 32 \
  --lr 1e-4 \
  --latent_dim 64 \
  --hidden_dim 256 \
  --checkpoint_dir checkpoints \
  --log_dir runs \
  --checkpoint path/to/resume.pt   # optional: resume training

# Keyboard dynamics GAN
keyboard-gan-train \
  --data ./data/keystrokes.csv \
  --epochs 500 \
  --batch_size 32 \
  --lr 1e-4 \
  --latent_dim 64 \
  --checkpoint_dir checkpoints \
  --log_dir runs \
  --resume path/to/resume.pt \     # optional: resume training
  --device cuda \                   # optional: force device
  --no_augment                      # optional: disable augmentation
```

### Generation

```bash
# Mouse trajectories
mouse-gan-generate \
  --checkpoint checkpoints/mouse_best.pt \
  --start 100,500 \
  --end 800,300 \
  --num_samples 5 \
  --output generated_trajectory.png \
  --device cpu

# Keystroke timings
keyboard-gan-generate \
  --checkpoint checkpoints/keyboard_best.pt \
  --text "Hello, how are you?" \
  --samples 3 \
  --device cpu \
  --output_json                     # optional: JSON output format
```

---

## Training Data

### Mouse Trajectories

- **Primary**: [Kaggle Mouse Movement Dataset](https://www.kaggle.com/datasets/prashantmudgal/mouse-movement)
- **Augmentation**: 4x via horizontal/vertical/both mirroring
- **Format**: CSV with position + timestamp columns

### Keystroke Dynamics

- **Primary**: [CMU Keystroke Dynamics Benchmark](https://www.cs.cmu.edu/~keystroke/)
  - 51 subjects, 400 samples each
  - Hold time (H), Keydown-Keydown (DD), Keyup-Keydown (UD)
- **Augmentation**: Speed scaling, noise injection, latent interpolation
