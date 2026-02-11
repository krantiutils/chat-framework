"""ONNX export for the keyboard dynamics generator."""

import logging

import torch
import torch.nn as nn

from keyboard_dynamics_gan.config import Config
from keyboard_dynamics_gan.models.generator import Generator

logger = logging.getLogger(__name__)


class GeneratorWrapper(nn.Module):
    """
    Thin wrapper around Generator for ONNX-friendly export.

    ONNX cannot trace the autoregressive generate() loop directly, so
    this wrapper runs the full forward pass for a fixed maximum sequence
    length and returns the raw output.  The caller must trim to the
    actual sequence length.
    """

    def __init__(self, generator: Generator, config: Config):
        super().__init__()
        self.generator = generator
        self.config = config

    def forward(
        self,
        char_ids: torch.Tensor,
        z: torch.Tensor,
    ) -> torch.Tensor:
        """
        Args:
            char_ids: (batch, max_seq_len) character IDs.
            z: (batch, latent_dim) user profile vector.

        Returns:
            timings: (batch, max_seq_len, 2) [hold, flight].
        """
        lengths = torch.full(
            (char_ids.shape[0],),
            char_ids.shape[1],
            dtype=torch.long,
            device=char_ids.device,
        )
        timings, _ = self.generator(
            char_ids, z, target_timings=None, lengths=lengths
        )
        return timings


def export_onnx(
    checkpoint_path: str,
    output_path: str,
    max_seq_len: int = 200,
    opset_version: int = 17,
) -> None:
    """
    Export a trained keyboard dynamics generator to ONNX.

    Args:
        checkpoint_path: Path to a .pt checkpoint.
        output_path: Destination .onnx file path.
        max_seq_len: Maximum sequence length to trace.
        opset_version: ONNX opset version.
    """
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    config = checkpoint.get("config", Config())

    generator = Generator(config)
    generator.load_state_dict(checkpoint["generator_state_dict"])
    generator.eval()

    wrapper = GeneratorWrapper(generator, config)

    dummy_char_ids = torch.randint(0, config.vocab_size, (1, max_seq_len))
    dummy_z = torch.randn(1, config.latent_dim)

    torch.onnx.export(
        wrapper,
        (dummy_char_ids, dummy_z),
        output_path,
        input_names=["char_ids", "z"],
        output_names=["timings"],
        dynamic_axes={
            "char_ids": {0: "batch_size"},
            "z": {0: "batch_size"},
            "timings": {0: "batch_size"},
        },
        opset_version=opset_version,
    )

    logger.info("Exported ONNX model to %s (opset %d)", output_path, opset_version)
