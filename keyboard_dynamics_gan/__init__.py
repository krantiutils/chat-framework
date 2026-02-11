"""
Keyboard Dynamics GAN - WGAN-GP LSTM for realistic keystroke timing generation.

Generates realistic hold times and flight times for arbitrary text,
conditioned on a latent user-profile vector for consistent typing personality.
"""

from keyboard_dynamics_gan.config import Config
from keyboard_dynamics_gan.inference import KeystrokeGenerator
from keyboard_dynamics_gan.models.generator import Generator
from keyboard_dynamics_gan.models.discriminator import Discriminator

__version__ = "0.1.0"
__all__ = ["Config", "KeystrokeGenerator", "Generator", "Discriminator"]
