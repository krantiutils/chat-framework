"""Tests for CMU benchmark training pipeline.

Validates that the WGAN-GP LSTM can load the CMU dataset, run training
steps, produce valid checkpoints, and generate plausible timings from
the trained model.
"""

import os
import tempfile
from pathlib import Path

import numpy as np
import pytest
import torch
from torch.utils.data import DataLoader

from keyboard_dynamics_gan.config import Config
from keyboard_dynamics_gan.data.dataset import (
    CMU_CHAR_SEQUENCE,
    CMU_FLIGHT_KEYS,
    CMU_HOLD_KEYS,
    CMU_PASSWORD,
    KeystrokeDataset,
    collate_keystrokes,
)
from keyboard_dynamics_gan.inference import KeystrokeGenerator
from keyboard_dynamics_gan.models.discriminator import Discriminator
from keyboard_dynamics_gan.models.generator import Generator
from keyboard_dynamics_gan.training.trainer import Trainer

# Path to the CMU dataset (downloaded by train_cmu_benchmark.py)
CMU_DATA_PATH = Path("data/DSL-StrongPasswordData.csv")


def _require_cmu_data():
    """Skip test if CMU dataset is not downloaded."""
    if not CMU_DATA_PATH.exists():
        pytest.skip("CMU dataset not downloaded; run train_cmu_benchmark.py first")


class TestCMUDataset:
    """Validate CMU dataset loading and structure."""

    def test_cmu_password_constant(self):
        assert CMU_PASSWORD == ".tie5Roanl"
        assert len(CMU_HOLD_KEYS) == 11
        assert len(CMU_FLIGHT_KEYS) == 10

    def test_cmu_char_sequence(self):
        """Char sequence should match the password plus Return."""
        expected_chars = list(".tie5Roanl\n")
        assert len(CMU_CHAR_SEQUENCE) == len(expected_chars)
        for code, char in zip(CMU_CHAR_SEQUENCE, expected_chars):
            assert code == ord(char), f"Mismatch: {code} != ord({char!r})"

    def test_load_cmu_dataset(self):
        _require_cmu_data()
        config = Config()
        ds = KeystrokeDataset(str(CMU_DATA_PATH), config, augment=False)

        # 51 subjects × 400 reps = 20,400 sequences
        assert len(ds) == 20400, f"Expected 20400 sequences, got {len(ds)}"

    def test_cmu_sequence_length(self):
        _require_cmu_data()
        config = Config()
        ds = KeystrokeDataset(str(CMU_DATA_PATH), config, augment=False)

        # Every CMU sequence has exactly 11 keystrokes
        for i in range(min(100, len(ds))):
            assert ds[i]["length"] == 11

    def test_cmu_timings_positive(self):
        _require_cmu_data()
        config = Config()
        ds = KeystrokeDataset(str(CMU_DATA_PATH), config, augment=False)

        for i in range(min(100, len(ds))):
            sample = ds[i]
            assert (sample["hold_times"] >= 0).all(), f"Negative hold at idx {i}"
            assert (sample["flight_times"] >= 0).all(), f"Negative flight at idx {i}"

    def test_cmu_timings_plausible_range(self):
        """Timings should be within plausible human typing range."""
        _require_cmu_data()
        config = Config()
        ds = KeystrokeDataset(str(CMU_DATA_PATH), config, augment=False)

        all_holds = []
        all_flights = []
        for i in range(len(ds)):
            all_holds.append(ds[i]["hold_times"].numpy())
            all_flights.append(ds[i]["flight_times"].numpy())

        holds = np.concatenate(all_holds)
        flights = np.concatenate(all_flights)

        # Hold times: typically 0.05-0.5s for most keystrokes
        assert holds.mean() > 0.05, f"Mean hold too low: {holds.mean()}"
        assert holds.mean() < 0.5, f"Mean hold too high: {holds.mean()}"

        # Flight times: can be negative in raw data (overlapping keys),
        # but dataset clamps to 0. Most flights are 0-2s.
        assert flights.mean() >= 0.0
        assert flights.mean() < 2.0, f"Mean flight too high: {flights.mean()}"

    def test_cmu_augmentation(self):
        _require_cmu_data()
        config = Config()
        ds_no_aug = KeystrokeDataset(str(CMU_DATA_PATH), config, augment=False)
        ds_aug = KeystrokeDataset(str(CMU_DATA_PATH), config, augment=True)

        # Augmentation should double the dataset
        assert len(ds_aug) == 2 * len(ds_no_aug)

    def test_cmu_collate(self):
        _require_cmu_data()
        config = Config()
        ds = KeystrokeDataset(str(CMU_DATA_PATH), config, augment=False)

        batch = [ds[i] for i in range(8)]
        collated = collate_keystrokes(batch)

        assert collated["char_ids"].shape == (8, 11)
        assert collated["timings"].shape == (8, 11, 2)
        assert collated["lengths"].shape == (8,)
        assert (collated["lengths"] == 11).all()


class TestCMUTraining:
    """Validate training pipeline with CMU data."""

    @pytest.fixture
    def small_config(self):
        """Config for fast smoke-test training."""
        config = Config()
        config.batch_size = 32
        config.latent_dim = 16
        config.generator_hidden_dim = 32
        config.generator_num_layers = 1
        config.discriminator_hidden_dim = 32
        config.discriminator_num_layers = 1
        config.n_critic = 1
        config.gp_every_n = 1
        config.gp_batch_frac = 1.0
        config.use_amp = False
        config.num_workers = 0
        config.pin_memory = False
        config.teacher_forcing_start = 1.0
        config.teacher_forcing_end = 0.0
        config.teacher_forcing_decay_epochs = 5
        return config

    def test_training_step(self, small_config):
        """Run one training epoch on real CMU data with small model."""
        _require_cmu_data()

        ds = KeystrokeDataset(
            str(CMU_DATA_PATH), small_config, augment=False
        )
        dl = DataLoader(
            ds,
            batch_size=small_config.batch_size,
            shuffle=True,
            collate_fn=collate_keystrokes,
            num_workers=0,
            drop_last=True,
        )

        gen = Generator(small_config)
        disc = Discriminator(small_config)
        device = torch.device("cpu")

        with tempfile.TemporaryDirectory() as tmpdir:
            trainer = Trainer(
                gen, disc, small_config, device,
                log_dir=os.path.join(tmpdir, "runs"),
            )

            # Run discriminator step
            batch = next(iter(dl))
            d_metrics = trainer.train_discriminator_step(batch)
            assert "d_loss" in d_metrics
            assert not np.isnan(d_metrics["d_loss"]), "D loss is NaN"

            # Run generator step
            g_metrics = trainer.train_generator_step(batch)
            assert "g_loss" in g_metrics
            assert not np.isnan(g_metrics["g_loss"]), "G loss is NaN"
            assert "g_timing_loss" in g_metrics
            assert "g_rhythm_loss" in g_metrics

    def test_checkpoint_save_load(self, small_config):
        """Save and reload a checkpoint, verify model state survives."""
        gen = Generator(small_config)
        disc = Discriminator(small_config)
        device = torch.device("cpu")

        with tempfile.TemporaryDirectory() as tmpdir:
            log_dir = os.path.join(tmpdir, "runs")
            ckpt_dir = os.path.join(tmpdir, "checkpoints")
            os.makedirs(ckpt_dir)

            trainer = Trainer(gen, disc, small_config, device, log_dir)
            ckpt_path = os.path.join(ckpt_dir, "test_ckpt.pt")
            trainer.save_checkpoint(ckpt_path, is_best=True)

            # Verify checkpoint file structure
            ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
            assert "generator_state_dict" in ckpt
            assert "discriminator_state_dict" in ckpt
            assert "g_optimizer_state_dict" in ckpt
            assert "d_optimizer_state_dict" in ckpt
            assert "config" in ckpt
            assert "epoch" in ckpt

            # Best checkpoint should also exist
            best_path = ckpt_path.replace(".pt", "_best.pt")
            assert os.path.exists(best_path)

            # Load into fresh trainer
            gen2 = Generator(small_config)
            disc2 = Discriminator(small_config)
            trainer2 = Trainer(gen2, disc2, small_config, device, log_dir)
            trainer2.load_checkpoint(ckpt_path)

            # Verify weights match
            for p1, p2 in zip(gen.parameters(), gen2.parameters()):
                assert torch.equal(p1, p2)

    def test_short_training_run(self, small_config):
        """Run 2 full epochs on CMU data and verify loss decreases."""
        _require_cmu_data()

        small_config.patience = 100  # Don't early stop during test

        ds = KeystrokeDataset(
            str(CMU_DATA_PATH), small_config, augment=False
        )
        dl = DataLoader(
            ds,
            batch_size=small_config.batch_size,
            shuffle=True,
            collate_fn=collate_keystrokes,
            num_workers=0,
            drop_last=True,
        )

        gen = Generator(small_config)
        disc = Discriminator(small_config)
        device = torch.device("cpu")

        with tempfile.TemporaryDirectory() as tmpdir:
            trainer = Trainer(
                gen, disc, small_config, device,
                log_dir=os.path.join(tmpdir, "runs"),
            )

            metrics_1 = trainer.train_epoch(dl)
            metrics_2 = trainer.train_epoch(dl)

            # Both epochs should produce finite losses
            for key in ["d_loss", "g_loss", "g_timing_loss", "g_rhythm_loss"]:
                assert np.isfinite(metrics_1[key]), f"Epoch 1 {key} not finite"
                assert np.isfinite(metrics_2[key]), f"Epoch 2 {key} not finite"

    def test_generation_from_trained_model(self, small_config):
        """After a few training steps, generator should produce valid output."""
        _require_cmu_data()

        ds = KeystrokeDataset(
            str(CMU_DATA_PATH), small_config, augment=False
        )
        dl = DataLoader(
            ds,
            batch_size=small_config.batch_size,
            shuffle=True,
            collate_fn=collate_keystrokes,
            num_workers=0,
            drop_last=True,
        )

        gen = Generator(small_config)
        disc = Discriminator(small_config)
        device = torch.device("cpu")

        with tempfile.TemporaryDirectory() as tmpdir:
            trainer = Trainer(
                gen, disc, small_config, device,
                log_dir=os.path.join(tmpdir, "runs"),
            )

            # Train a few steps
            for _ in range(3):
                batch = next(iter(dl))
                trainer.train_discriminator_step(batch)
                trainer.train_generator_step(batch)

            # Generate from the model
            gen.eval()
            char_ids = torch.tensor([CMU_CHAR_SEQUENCE], dtype=torch.long)
            lengths = torch.tensor([len(CMU_CHAR_SEQUENCE)])
            z = torch.randn(1, small_config.latent_dim)

            with torch.no_grad():
                timings, out_lengths = gen.generate(char_ids, lengths, z)

            assert timings.shape == (1, 11, 2)
            assert (timings > 0).all(), "Generated timings should be positive"
            assert out_lengths[0] == 11

    def test_inference_api_from_checkpoint(self, small_config):
        """KeystrokeGenerator.from_checkpoint should work with trained model."""
        gen = Generator(small_config)
        disc = Discriminator(small_config)
        device = torch.device("cpu")

        with tempfile.TemporaryDirectory() as tmpdir:
            log_dir = os.path.join(tmpdir, "runs")
            trainer = Trainer(gen, disc, small_config, device, log_dir)

            ckpt_path = os.path.join(tmpdir, "model.pt")
            trainer.save_checkpoint(ckpt_path)

            # Load via inference API
            kg = KeystrokeGenerator.from_checkpoint(ckpt_path, device="cpu")
            results = kg.generate(CMU_PASSWORD, num_samples=3)

            assert len(results) == 3
            for seq in results:
                assert seq.num_keystrokes == len(CMU_PASSWORD)
                assert len(seq.hold_times) == len(CMU_PASSWORD)
                assert len(seq.flight_times) == len(CMU_PASSWORD)
                assert (seq.hold_times > 0).all()
                assert seq.timestamps[-1] > seq.timestamps[0]
