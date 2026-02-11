"""Training pipeline for the WGAN-GP trajectory model."""

from mouse_trajectory_gan.training.losses import compute_gradient_penalty
from mouse_trajectory_gan.training.trainer import Trainer

__all__ = ["compute_gradient_penalty", "Trainer"]
