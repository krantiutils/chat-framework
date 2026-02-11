"""Tests for Generator and Discriminator models."""

import torch

from mouse_trajectory_gan.config import Config
from mouse_trajectory_gan.models.generator import Generator
from mouse_trajectory_gan.models.discriminator import Discriminator
from mouse_trajectory_gan.models.kinematics import compute_kinematics, trajectory_to_absolute


def _make_config() -> Config:
    config = Config()
    config.max_generation_steps = 20  # smaller for fast tests
    return config


class TestGenerator:
    def test_forward_shape(self):
        config = _make_config()
        gen = Generator(config)

        batch = 4
        seq_len = 15
        start = torch.rand(batch, 2)
        end = torch.rand(batch, 2)
        z = torch.randn(batch, config.latent_dim)
        target = torch.randn(batch, seq_len, 3)
        target[:, :, 2] = torch.abs(target[:, :, 2]) + 0.001  # positive dt
        lengths = torch.full((batch,), seq_len)

        outputs, out_lengths = gen(
            start, end, z,
            target_sequences=target,
            target_lengths=lengths,
            teacher_forcing_ratio=0.5,
        )

        assert outputs.shape == (batch, seq_len, 3)
        assert out_lengths.shape == (batch,)
        # dt must be positive
        assert (outputs[:, :, 2] > 0).all()

    def test_generate_shape(self):
        config = _make_config()
        gen = Generator(config)

        batch = 2
        start = torch.rand(batch, 2)
        end = torch.rand(batch, 2)

        with torch.no_grad():
            outputs, lengths = gen.generate(start, end)

        assert outputs.shape[0] == batch
        assert outputs.shape[2] == 3
        assert outputs.shape[1] <= config.max_generation_steps
        assert lengths.shape == (batch,)
        assert (lengths > 0).all()
        assert (lengths <= config.max_generation_steps).all()

    def test_generate_with_explicit_z(self):
        config = _make_config()
        gen = Generator(config)

        batch = 2
        start = torch.rand(batch, 2)
        end = torch.rand(batch, 2)
        z = torch.randn(batch, config.latent_dim)

        with torch.no_grad():
            outputs, lengths = gen.generate(start, end, z)

        assert outputs.shape[0] == batch


class TestDiscriminator:
    def test_forward_shape(self):
        config = _make_config()
        disc = Discriminator(config)

        batch = 4
        seq_len = 10
        trajectories = torch.rand(batch, seq_len, 2)
        dts = torch.rand(batch, seq_len) * 0.1 + 0.001
        lengths = torch.full((batch,), seq_len)

        scores = disc(trajectories, dts, lengths)

        assert scores.shape == (batch, 1)

    def test_variable_lengths(self):
        config = _make_config()
        disc = Discriminator(config)

        batch = 3
        max_len = 15
        trajectories = torch.rand(batch, max_len, 2)
        dts = torch.rand(batch, max_len) * 0.1 + 0.001
        lengths = torch.tensor([15, 10, 5])

        scores = disc(trajectories, dts, lengths)
        assert scores.shape == (batch, 1)


class TestKinematics:
    def test_compute_kinematics_shape(self):
        batch = 3
        seq_len = 10
        positions = torch.rand(batch, seq_len, 2)
        dts = torch.rand(batch, seq_len) * 0.1 + 0.001

        features = compute_kinematics(positions, dts)
        assert features.shape == (batch, seq_len, 9)

    def test_trajectory_to_absolute(self):
        start = torch.tensor([[0.1, 0.2]])
        deltas = torch.tensor([[[0.05, 0.03], [0.02, -0.01], [-0.01, 0.04]]])

        positions = trajectory_to_absolute(start, deltas)

        assert positions.shape == (1, 4, 2)  # 3 deltas + 1 start = 4 points
        # First point should be start
        torch.testing.assert_close(positions[0, 0], start[0])
        # Last point = start + cumsum(deltas)
        expected_end = start[0] + deltas[0].sum(dim=0)
        torch.testing.assert_close(positions[0, -1], expected_end)
