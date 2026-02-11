"""High-level inference API for generating mouse trajectories."""

import logging
from dataclasses import dataclass
from typing import List, Optional

import numpy as np
import torch

from mouse_trajectory_gan.config import Config
from mouse_trajectory_gan.models.generator import Generator
from mouse_trajectory_gan.models.kinematics import trajectory_to_absolute

logger = logging.getLogger(__name__)


@dataclass
class Trajectory:
    """A generated mouse trajectory with positions and timing."""

    positions: np.ndarray  # (N, 2) absolute pixel positions
    timestamps: np.ndarray  # (N,) cumulative time in seconds
    num_points: int


class TrajectoryGenerator:
    """
    High-level API for generating realistic mouse trajectories.

    Loads a trained generator checkpoint and provides a simple interface
    for generating trajectories between screen coordinates.

    Example::

        gen = TrajectoryGenerator.from_checkpoint("checkpoint_best.pt")
        trajectory = gen.generate(start=(100, 500), end=(800, 300))
        # trajectory.positions: (N, 2) pixel coordinates
        # trajectory.timestamps: (N,) cumulative seconds
    """

    def __init__(
        self,
        generator: Generator,
        config: Config,
        device: torch.device,
    ):
        self.generator = generator
        self.config = config
        self.device = device
        self.generator.eval()

    @classmethod
    def from_checkpoint(
        cls,
        checkpoint_path: str,
        device: Optional[str] = None,
    ) -> "TrajectoryGenerator":
        """
        Load a TrajectoryGenerator from a training checkpoint.

        Args:
            checkpoint_path: Path to a .pt checkpoint file.
            device: Device string ('cuda', 'cpu', 'mps'). Auto-detected if None.

        Returns:
            A ready-to-use TrajectoryGenerator.
        """
        if device is None:
            if torch.cuda.is_available():
                device = "cuda"
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"

        torch_device = torch.device(device)

        checkpoint = torch.load(
            checkpoint_path, map_location=torch_device, weights_only=False
        )

        config = checkpoint.get("config")
        if config is None:
            logger.warning(
                "No config in checkpoint, using defaults. "
                "Model dimensions may not match."
            )
            config = Config()

        generator = Generator(config)
        generator.load_state_dict(checkpoint["generator_state_dict"])
        generator.to(torch_device)

        logger.info(
            "Loaded generator from epoch %d (device=%s)",
            checkpoint.get("epoch", -1),
            device,
        )

        return cls(generator, config, torch_device)

    def generate(
        self,
        start: tuple,
        end: tuple,
        num_samples: int = 1,
    ) -> List[Trajectory]:
        """
        Generate mouse trajectories between two screen points.

        Args:
            start: (x, y) pixel coordinates of the starting position.
            end: (x, y) pixel coordinates of the target position.
            num_samples: Number of trajectory variations to generate.

        Returns:
            List of Trajectory objects.
        """
        screen = np.array(
            [self.config.screen_width, self.config.screen_height], dtype=np.float32
        )

        start_norm = torch.tensor(
            [start[0] / screen[0], start[1] / screen[1]],
            dtype=torch.float32,
            device=self.device,
        ).unsqueeze(0).expand(num_samples, -1)

        end_norm = torch.tensor(
            [end[0] / screen[0], end[1] / screen[1]],
            dtype=torch.float32,
            device=self.device,
        ).unsqueeze(0).expand(num_samples, -1)

        with torch.no_grad():
            z = torch.randn(
                num_samples, self.config.latent_dim, device=self.device
            )
            sequences, lengths = self.generator.generate(start_norm, end_norm, z)

        results = []
        for i in range(num_samples):
            length = lengths[i].item()
            deltas = sequences[i, :length, :2].unsqueeze(0)
            dts = sequences[i, :length, 2].cpu().numpy()

            positions = trajectory_to_absolute(
                start_norm[i : i + 1], deltas
            )
            positions = positions[0, : length + 1].cpu().numpy() * screen

            timestamps = np.zeros(length + 1, dtype=np.float32)
            timestamps[1:] = np.cumsum(dts)

            results.append(
                Trajectory(
                    positions=positions,
                    timestamps=timestamps,
                    num_points=length + 1,
                )
            )

        return results
