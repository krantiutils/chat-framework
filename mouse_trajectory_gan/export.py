"""ONNX export for deploying the generator model in Node.js via onnxruntime."""

import logging
from typing import Optional

import torch

from mouse_trajectory_gan.config import Config
from mouse_trajectory_gan.models.generator import Generator

logger = logging.getLogger(__name__)


class GeneratorWrapper(torch.nn.Module):
    """
    Wrapper that exposes the generator's generate loop as a single forward pass
    suitable for ONNX export.

    ONNX does not support dynamic control flow (early stopping), so this wrapper
    runs the full max_generation_steps and returns all outputs. The caller must
    trim based on the returned lengths.
    """

    def __init__(self, generator: Generator):
        super().__init__()
        self.generator = generator
        self.config = generator.config

    def forward(
        self,
        start: torch.Tensor,
        end: torch.Tensor,
        z: torch.Tensor,
    ) -> torch.Tensor:
        """
        Generate a full trajectory (fixed max_generation_steps).

        Args:
            start: (batch, 2) normalized start positions.
            end: (batch, 2) normalized end positions.
            z: (batch, latent_dim) noise vector.

        Returns:
            outputs: (batch, max_generation_steps, 3) generated (dx, dy, dt).
        """
        sequences, _ = self.generator(start, end, z)
        return sequences


def export_onnx(
    checkpoint_path: str,
    output_path: str,
    opset_version: int = 17,
    device: Optional[str] = None,
) -> None:
    """
    Export the generator to ONNX format.

    The exported model takes (start, end, z) tensors and returns
    (dx, dy, dt) sequences of length max_generation_steps.

    Args:
        checkpoint_path: Path to a .pt training checkpoint.
        output_path: Path to write the .onnx file.
        opset_version: ONNX opset version (default 17).
        device: Device string. Defaults to CPU for export compatibility.
    """
    if device is None:
        device = "cpu"
    torch_device = torch.device(device)

    checkpoint = torch.load(
        checkpoint_path, map_location=torch_device, weights_only=False
    )

    config = checkpoint.get("config", Config())
    generator = Generator(config)
    generator.load_state_dict(checkpoint["generator_state_dict"])
    generator.to(torch_device)
    generator.eval()

    wrapper = GeneratorWrapper(generator)
    wrapper.eval()

    batch_size = 1
    dummy_start = torch.randn(batch_size, 2, device=torch_device)
    dummy_end = torch.randn(batch_size, 2, device=torch_device)
    dummy_z = torch.randn(batch_size, config.latent_dim, device=torch_device)

    torch.onnx.export(
        wrapper,
        (dummy_start, dummy_end, dummy_z),
        output_path,
        opset_version=opset_version,
        input_names=["start", "end", "z"],
        output_names=["sequences"],
        dynamic_axes={
            "start": {0: "batch_size"},
            "end": {0: "batch_size"},
            "z": {0: "batch_size"},
            "sequences": {0: "batch_size"},
        },
    )

    logger.info("Exported ONNX model to %s", output_path)
