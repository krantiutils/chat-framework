"""Tests for Config dataclass."""

from mouse_trajectory_gan.config import Config


def test_config_defaults():
    config = Config()
    assert config.screen_width == 1920.0
    assert config.screen_height == 1080.0
    assert config.latent_dim == 64
    assert config.generator_hidden_dim == 256
    assert config.discriminator_hidden_dim == 128
    assert config.batch_size == 32
    assert config.learning_rate == 1e-4
    assert config.betas == (0.5, 0.9)
    assert config.gradient_penalty_weight == 10.0
    assert config.distance_threshold == 0.02
    assert config.max_generation_steps == 200
    assert config.endpoint_loss_weight == 50.0
    assert config.direction_loss_weight == 10.0


def test_config_override():
    config = Config()
    config.latent_dim = 128
    config.batch_size = 64
    assert config.latent_dim == 128
    assert config.batch_size == 64
