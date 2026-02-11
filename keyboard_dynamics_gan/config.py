"""Hyperparameters and configuration for the keyboard dynamics GAN."""

from dataclasses import dataclass
from typing import Tuple


@dataclass
class Config:
    """Hyperparameters and configuration."""

    # Character encoding
    vocab_size: int = 128  # ASCII range
    char_embedding_dim: int = 32

    # Sequence constraints
    min_sequence_length: int = 5
    max_sequence_length: int = 200

    # Model
    latent_dim: int = 64
    generator_hidden_dim: int = 256
    generator_num_layers: int = 2
    discriminator_hidden_dim: int = 128
    discriminator_num_layers: int = 2

    # Training
    batch_size: int = 32
    learning_rate: float = 1e-4
    betas: Tuple[float, float] = (0.5, 0.9)
    n_critic: int = 1
    gradient_penalty_weight: float = 10.0
    gp_every_n: int = 4
    gp_batch_frac: float = 0.25
    use_amp: bool = True
    epochs: int = 1000

    # DataLoader
    num_workers: int = 4
    pin_memory: bool = True

    # Early stopping and scheduling
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
