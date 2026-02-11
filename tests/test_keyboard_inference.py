"""Tests for the high-level inference API."""

import os
import tempfile

import torch

from keyboard_dynamics_gan.config import Config
from keyboard_dynamics_gan.models.generator import Generator
from keyboard_dynamics_gan.models.discriminator import Discriminator
from keyboard_dynamics_gan.inference import KeystrokeGenerator


def _create_dummy_checkpoint(path: str) -> Config:
    """Create a minimal checkpoint file for testing."""
    config = Config()
    config.max_sequence_length = 20

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
        gen = KeystrokeGenerator.from_checkpoint(ckpt_path, device="cpu")
        assert gen.device == torch.device("cpu")
    finally:
        os.unlink(ckpt_path)


def test_generate_single():
    with tempfile.NamedTemporaryFile(suffix=".pt", delete=False) as f:
        ckpt_path = f.name

    try:
        _create_dummy_checkpoint(ckpt_path)
        gen = KeystrokeGenerator.from_checkpoint(ckpt_path, device="cpu")

        results = gen.generate(text="hello", num_samples=1)

        assert len(results) == 1
        seq = results[0]
        assert seq.num_keystrokes == 5
        assert seq.hold_times.shape == (5,)
        assert seq.flight_times.shape == (5,)
        assert seq.timestamps.shape == (5,)
        assert seq.characters == "hello"
        assert seq.timestamps[0] == 0.0
        # Timestamps should be monotonically increasing
        assert (seq.timestamps[1:] >= seq.timestamps[:-1]).all()
        # All timings positive
        assert (seq.hold_times > 0).all()
        assert (seq.flight_times > 0).all()
    finally:
        os.unlink(ckpt_path)


def test_generate_multiple():
    with tempfile.NamedTemporaryFile(suffix=".pt", delete=False) as f:
        ckpt_path = f.name

    try:
        _create_dummy_checkpoint(ckpt_path)
        gen = KeystrokeGenerator.from_checkpoint(ckpt_path, device="cpu")

        results = gen.generate(text="test input", num_samples=3)

        assert len(results) == 3
        for seq in results:
            assert seq.num_keystrokes == 10  # "test input" = 10 chars
            assert seq.hold_times.shape == (10,)
            assert seq.flight_times.shape == (10,)
    finally:
        os.unlink(ckpt_path)


def test_generate_consistent_user():
    """Same z vector should produce same timing pattern."""
    with tempfile.NamedTemporaryFile(suffix=".pt", delete=False) as f:
        ckpt_path = f.name

    try:
        _create_dummy_checkpoint(ckpt_path)
        gen = KeystrokeGenerator.from_checkpoint(ckpt_path, device="cpu")

        # Two separate generate calls with different random z
        r1 = gen.generate(text="abc", num_samples=1)
        r2 = gen.generate(text="abc", num_samples=1)

        # Different random z should yield different timings
        assert not (r1[0].hold_times == r2[0].hold_times).all()
    finally:
        os.unlink(ckpt_path)
