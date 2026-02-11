"""High-level inference API for generating keystroke timings."""

import logging
from dataclasses import dataclass
from typing import List, Optional

import numpy as np
import torch

from keyboard_dynamics_gan.config import Config
from keyboard_dynamics_gan.models.generator import Generator

logger = logging.getLogger(__name__)


@dataclass
class KeystrokeSequence:
    """A generated keystroke timing sequence."""

    characters: str
    hold_times: np.ndarray  # (N,) hold duration per key in seconds
    flight_times: np.ndarray  # (N,) inter-key interval in seconds
    timestamps: np.ndarray  # (N,) cumulative time in seconds
    num_keystrokes: int


class KeystrokeGenerator:
    """
    High-level API for generating realistic keystroke timings.

    Loads a trained generator checkpoint and provides a simple interface
    for generating timing sequences for arbitrary text.

    Example::

        gen = KeystrokeGenerator.from_checkpoint("checkpoint_best.pt")
        seq = gen.generate("hello world")
        # seq.hold_times: (11,) seconds per key press
        # seq.flight_times: (11,) seconds between key releases
        # seq.timestamps: (11,) cumulative time offsets
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
    ) -> "KeystrokeGenerator":
        """
        Load a KeystrokeGenerator from a training checkpoint.

        Args:
            checkpoint_path: Path to a .pt checkpoint file.
            device: Device string ('cuda', 'cpu', 'mps').  Auto-detected
                if None.

        Returns:
            A ready-to-use KeystrokeGenerator.
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
        text: str,
        num_samples: int = 1,
    ) -> List[KeystrokeSequence]:
        """
        Generate keystroke timings for a text string.

        Args:
            text: The text to generate timings for.
            num_samples: Number of timing variations to generate.

        Returns:
            List of KeystrokeSequence objects.
        """
        char_ids = [ord(c) % self.config.vocab_size for c in text]
        seq_len = len(char_ids)

        char_tensor = (
            torch.tensor(char_ids, dtype=torch.long, device=self.device)
            .unsqueeze(0)
            .expand(num_samples, -1)
        )
        lengths = torch.full(
            (num_samples,), seq_len, dtype=torch.long, device=self.device
        )

        with torch.no_grad():
            z = torch.randn(
                num_samples, self.config.latent_dim, device=self.device
            )
            timings, _ = self.generator.generate(char_tensor, lengths, z)

        results = []
        for i in range(num_samples):
            hold = timings[i, :seq_len, 0].cpu().numpy()
            flight = timings[i, :seq_len, 1].cpu().numpy()

            # Compute cumulative timestamps: each keystroke starts at
            # the end of the previous hold + flight.
            timestamps = np.zeros(seq_len, dtype=np.float32)
            for k in range(1, seq_len):
                timestamps[k] = timestamps[k - 1] + hold[k - 1] + flight[k - 1]

            results.append(
                KeystrokeSequence(
                    characters=text,
                    hold_times=hold,
                    flight_times=flight,
                    timestamps=timestamps,
                    num_keystrokes=seq_len,
                )
            )

        return results
