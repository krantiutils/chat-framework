"""Tests for the high-level inference API."""

import os
import tempfile

import torch

from mouse_trajectory_gan.config import Config
from mouse_trajectory_gan.models.generator import Generator
from mouse_trajectory_gan.models.discriminator import Discriminator
from mouse_trajectory_gan.inference import TrajectoryGenerator


def _create_dummy_checkpoint(path: str) -> Config:
    """Create a minimal checkpoint file for testing."""
    config = Config()
    config.max_generation_steps = 20

    gen = Generator(config)
    disc = Discriminator(config)

    checkpoint = {
        "epoch": 0,
        "generator_state_dict": gen.state_dict(),
        "discriminator_state_dict": disc.state_dict(),
        "g_optimizer_state_dict": {},
        "d_optimizer_state_dict": {},
        "config": config,
        "best_loss": float("inf"),
    }
    torch.save(checkpoint, path)
    return config


def test_from_checkpoint():
    with tempfile.NamedTemporaryFile(suffix=".pt", delete=False) as f:
        ckpt_path = f.name

    try:
        _create_dummy_checkpoint(ckpt_path)
        gen = TrajectoryGenerator.from_checkpoint(ckpt_path, device="cpu")
        assert gen.device == torch.device("cpu")
    finally:
        os.unlink(ckpt_path)


def test_generate_single():
    with tempfile.NamedTemporaryFile(suffix=".pt", delete=False) as f:
        ckpt_path = f.name

    try:
        _create_dummy_checkpoint(ckpt_path)
        gen = TrajectoryGenerator.from_checkpoint(ckpt_path, device="cpu")

        results = gen.generate(start=(100, 500), end=(800, 300), num_samples=1)

        assert len(results) == 1
        traj = results[0]
        assert traj.num_points >= 2
        assert traj.positions.shape == (traj.num_points, 2)
        assert traj.timestamps.shape == (traj.num_points,)
        assert traj.timestamps[0] == 0.0
        # timestamps should be monotonically increasing
        assert (traj.timestamps[1:] >= traj.timestamps[:-1]).all()
    finally:
        os.unlink(ckpt_path)


def test_generate_multiple():
    with tempfile.NamedTemporaryFile(suffix=".pt", delete=False) as f:
        ckpt_path = f.name

    try:
        _create_dummy_checkpoint(ckpt_path)
        gen = TrajectoryGenerator.from_checkpoint(ckpt_path, device="cpu")

        results = gen.generate(start=(50, 50), end=(1000, 800), num_samples=3)

        assert len(results) == 3
        for traj in results:
            assert traj.num_points >= 2
            assert traj.positions.shape[1] == 2
    finally:
        os.unlink(ckpt_path)
