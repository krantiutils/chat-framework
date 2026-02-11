"""Tests for Config dataclass."""

from keyboard_dynamics_gan.config import Config


def test_config_defaults():
    config = Config()
    assert config.vocab_size == 128
    assert config.char_embedding_dim == 32
    assert config.latent_dim == 64
    assert config.generator_hidden_dim == 256
    assert config.discriminator_hidden_dim == 128
    assert config.batch_size == 32
    assert config.learning_rate == 1e-4
    assert config.betas == (0.5, 0.9)
    assert config.gradient_penalty_weight == 10.0
    assert config.min_sequence_length == 5
    assert config.max_sequence_length == 200
    assert config.timing_loss_weight == 20.0
    assert config.rhythm_loss_weight == 10.0


def test_config_override():
    config = Config()
    config.latent_dim = 128
    config.batch_size = 64
    assert config.latent_dim == 128
    assert config.batch_size == 64
