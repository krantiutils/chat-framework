"""
Mouse Trajectory GAN - WGAN-GP LSTM for realistic mouse trajectory generation.

Adapted from https://github.com/jrcalgo/generative-mouse-trajectories
"""

from mouse_trajectory_gan.config import Config
from mouse_trajectory_gan.inference import TrajectoryGenerator
from mouse_trajectory_gan.models.generator import Generator
from mouse_trajectory_gan.models.discriminator import Discriminator

__version__ = "0.1.0"
__all__ = ["Config", "TrajectoryGenerator", "Generator", "Discriminator"]
