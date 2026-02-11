"""Tests for keyboard dynamics Generator and Discriminator models."""

import torch

from keyboard_dynamics_gan.config import Config
from keyboard_dynamics_gan.models.generator import Generator
from keyboard_dynamics_gan.models.discriminator import Discriminator
from keyboard_dynamics_gan.models.rhythm import compute_rhythm_features


def _make_config() -> Config:
    config = Config()
    config.max_sequence_length = 20  # smaller for fast tests
    return config


class TestGenerator:
    def test_forward_shape(self):
        config = _make_config()
        gen = Generator(config)

        batch = 4
        seq_len = 15
        char_ids = torch.randint(0, config.vocab_size, (batch, seq_len))
        z = torch.randn(batch, config.latent_dim)
        target_timings = torch.rand(batch, seq_len, 2) * 0.2 + 0.01
        lengths = torch.full((batch,), seq_len)

        outputs, out_lengths = gen(
            char_ids, z,
            target_timings=target_timings,
            lengths=lengths,
            teacher_forcing_ratio=0.5,
        )

        assert outputs.shape == (batch, seq_len, 2)
        assert out_lengths.shape == (batch,)
        # Both hold and flight must be positive
        assert (outputs[:, :, 0] > 0).all(), "Hold times must be positive"
        assert (outputs[:, :, 1] > 0).all(), "Flight times must be positive"

    def test_forward_no_teacher_forcing(self):
        config = _make_config()
        gen = Generator(config)

        batch = 2
        seq_len = 10
        char_ids = torch.randint(0, config.vocab_size, (batch, seq_len))
        z = torch.randn(batch, config.latent_dim)
        lengths = torch.full((batch,), seq_len)

        outputs, out_lengths = gen(
            char_ids, z, lengths=lengths
        )

        assert outputs.shape == (batch, seq_len, 2)
        assert (out_lengths == seq_len).all()

    def test_generate_shape(self):
        config = _make_config()
        gen = Generator(config)

        batch = 2
        seq_len = 12
        char_ids = torch.randint(0, config.vocab_size, (batch, seq_len))
        lengths = torch.tensor([12, 8])

        with torch.no_grad():
            outputs, out_lengths = gen.generate(char_ids, lengths)

        assert outputs.shape == (batch, seq_len, 2)
        assert (out_lengths == lengths).all()
        assert (outputs > 0).all()

    def test_generate_with_explicit_z(self):
        config = _make_config()
        gen = Generator(config)

        batch = 3
        seq_len = 10
        char_ids = torch.randint(0, config.vocab_size, (batch, seq_len))
        lengths = torch.full((batch,), seq_len)
        z = torch.randn(batch, config.latent_dim)

        with torch.no_grad():
            outputs, _ = gen.generate(char_ids, lengths, z)

        assert outputs.shape == (batch, seq_len, 2)

    def test_different_z_produces_different_output(self):
        config = _make_config()
        gen = Generator(config)

        seq_len = 10
        char_ids = torch.randint(0, config.vocab_size, (1, seq_len))
        lengths = torch.tensor([seq_len])

        z1 = torch.randn(1, config.latent_dim)
        z2 = torch.randn(1, config.latent_dim)

        with torch.no_grad():
            out1, _ = gen.generate(char_ids, lengths, z1)
            out2, _ = gen.generate(char_ids, lengths, z2)

        # Different z should produce different timings
        assert not torch.allclose(out1, out2, atol=1e-4)


class TestDiscriminator:
    def test_forward_shape(self):
        config = _make_config()
        disc = Discriminator(config)

        batch = 4
        seq_len = 10
        char_ids = torch.randint(0, config.vocab_size, (batch, seq_len))
        timings = torch.rand(batch, seq_len, 2) * 0.2 + 0.01
        lengths = torch.full((batch,), seq_len)

        scores = disc(char_ids, timings, lengths)

        assert scores.shape == (batch, 1)

    def test_variable_lengths(self):
        config = _make_config()
        disc = Discriminator(config)

        batch = 3
        max_len = 15
        char_ids = torch.randint(0, config.vocab_size, (batch, max_len))
        timings = torch.rand(batch, max_len, 2) * 0.2 + 0.01
        lengths = torch.tensor([15, 10, 5])

        scores = disc(char_ids, timings, lengths)
        assert scores.shape == (batch, 1)

    def test_gradient_flows(self):
        config = _make_config()
        disc = Discriminator(config)

        batch = 2
        seq_len = 8
        char_ids = torch.randint(0, config.vocab_size, (batch, seq_len))
        timings = (torch.rand(batch, seq_len, 2) * 0.2 + 0.01).requires_grad_(True)
        lengths = torch.full((batch,), seq_len)

        scores = disc(char_ids, timings, lengths)
        scores.sum().backward()

        assert timings.grad is not None
        assert timings.grad.shape == timings.shape


class TestRhythm:
    def test_compute_rhythm_features_shape(self):
        batch = 3
        seq_len = 10
        hold_times = torch.rand(batch, seq_len) * 0.2 + 0.01
        flight_times = torch.rand(batch, seq_len) * 0.3 + 0.01

        features = compute_rhythm_features(hold_times, flight_times)
        assert features.shape == (batch, seq_len, 7)

    def test_rhythm_features_values(self):
        batch = 1
        seq_len = 5
        hold = torch.tensor([[0.1, 0.08, 0.12, 0.09, 0.11]])
        flight = torch.tensor([[0.05, 0.06, 0.04, 0.07, 0.03]])

        features = compute_rhythm_features(hold, flight)

        # Feature 0 is hold_time
        torch.testing.assert_close(features[0, :, 0], hold[0])
        # Feature 1 is flight_time
        torch.testing.assert_close(features[0, :, 1], flight[0])
        # Feature 2 is digraph_time = hold + flight
        expected_digraph = hold + flight
        torch.testing.assert_close(features[0, :, 2], expected_digraph[0])
        # Feature 5 is hold_ratio = hold / digraph
        expected_ratio = hold / (expected_digraph + 1e-8)
        torch.testing.assert_close(features[0, :, 5], expected_ratio[0])
