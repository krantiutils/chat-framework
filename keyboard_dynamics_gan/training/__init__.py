"""Training pipeline for keystroke dynamics WGAN-GP."""

from keyboard_dynamics_gan.training.trainer import Trainer
from keyboard_dynamics_gan.training.losses import compute_gradient_penalty

__all__ = ["Trainer", "compute_gradient_penalty"]
