"""Train the keyboard dynamics GAN on the CMU Keystroke Dynamics Benchmark.

Downloads the dataset if not present, then trains the WGAN-GP LSTM model
with hyperparameters tuned for the CMU benchmark (51 subjects, 400
repetitions each, fixed 11-character password ".tie5Roanl").

Usage:
    python scripts/train_cmu_benchmark.py [--epochs 200] [--batch-size 64]
        [--checkpoint-dir checkpoints] [--data data/DSL-StrongPasswordData.csv]
"""

import argparse
import logging
import os
import urllib.request
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from keyboard_dynamics_gan.config import Config
from keyboard_dynamics_gan.data.dataset import KeystrokeDataset, collate_keystrokes
from keyboard_dynamics_gan.models.discriminator import Discriminator
from keyboard_dynamics_gan.models.generator import Generator
from keyboard_dynamics_gan.training.trainer import Trainer

logger = logging.getLogger(__name__)

CMU_DATASET_URL = (
    "https://www.cs.cmu.edu/~keystroke/DSL-StrongPasswordData.csv"
)
DEFAULT_DATA_PATH = "data/DSL-StrongPasswordData.csv"


def download_cmu_dataset(dest: str) -> None:
    """Download the CMU Keystroke Dynamics Benchmark CSV if missing."""
    dest_path = Path(dest)
    if dest_path.exists():
        logger.info("Dataset already present at %s", dest)
        return

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    logger.info("Downloading CMU Keystroke Dynamics Benchmark to %s ...", dest)
    urllib.request.urlretrieve(CMU_DATASET_URL, dest)
    logger.info("Download complete (%d bytes)", dest_path.stat().st_size)


def build_cmu_config(
    epochs: int = 200,
    batch_size: int = 64,
    learning_rate: float = 2e-4,
    latent_dim: int = 64,
) -> Config:
    """Build a Config tuned for the CMU benchmark dataset.

    The CMU dataset has 20,400 samples of a fixed 11-char password, so:
    - Larger batch size (64) for stable gradient estimates on short sequences
    - Slightly higher learning rate (2e-4) since the task is simpler
    - 200 epochs (the dataset is large and sequences are short, so
      convergence is fast)
    - n_critic=1 (default) to keep training fast; GP amortization
      already stabilises the critic
    - Teacher forcing decays over first 50 epochs (sequences are short)
    """
    config = Config()
    config.epochs = epochs
    config.batch_size = batch_size
    config.learning_rate = learning_rate
    config.latent_dim = latent_dim

    # CMU sequences are exactly 11 chars; relax min length
    config.min_sequence_length = 5
    config.max_sequence_length = 200

    # WGAN-GP training schedule
    config.n_critic = 1
    config.gradient_penalty_weight = 10.0
    config.gp_every_n = 4
    config.gp_batch_frac = 0.25

    # Teacher forcing: faster decay for short sequences
    config.teacher_forcing_start = 1.0
    config.teacher_forcing_end = 0.0
    config.teacher_forcing_decay_epochs = 50

    # Early stopping / scheduling
    config.patience = 30
    config.lr_patience = 15
    config.lr_factor = 0.5
    config.min_lr = 1e-6

    # DataLoader
    config.num_workers = 4
    config.pin_memory = True

    return config


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train keyboard dynamics GAN on CMU benchmark."
    )
    parser.add_argument(
        "--data",
        type=str,
        default=DEFAULT_DATA_PATH,
        help="Path to CMU CSV (downloaded automatically if missing).",
    )
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--latent-dim", type=int, default=64)
    parser.add_argument("--checkpoint-dir", type=str, default="checkpoints")
    parser.add_argument("--log-dir", type=str, default="runs")
    parser.add_argument(
        "--resume",
        type=str,
        default=None,
        help="Path to checkpoint to resume from.",
    )
    parser.add_argument(
        "--device",
        type=str,
        default=None,
        help="Device (cuda/cpu/mps). Auto-detected if omitted.",
    )
    parser.add_argument(
        "--no-augment",
        action="store_true",
        help="Disable data augmentation.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
    )

    # Download dataset if needed
    download_cmu_dataset(args.data)

    config = build_cmu_config(
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        latent_dim=args.latent_dim,
    )

    if args.device:
        device = torch.device(args.device)
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")

    logger.info("Using device: %s", device)

    dataset = KeystrokeDataset(
        args.data, config, augment=not args.no_augment
    )
    logger.info(
        "Dataset: %d sequences (%s augmentation)",
        len(dataset),
        "with" if not args.no_augment else "without",
    )

    dataloader = DataLoader(
        dataset,
        batch_size=config.batch_size,
        shuffle=True,
        num_workers=config.num_workers,
        pin_memory=config.pin_memory,
        collate_fn=collate_keystrokes,
        drop_last=True,
    )

    generator = Generator(config)
    discriminator = Discriminator(config)

    g_params = sum(p.numel() for p in generator.parameters())
    d_params = sum(p.numel() for p in discriminator.parameters())
    logger.info(
        "Generator params: %d, Discriminator params: %d", g_params, d_params
    )

    trainer = Trainer(generator, discriminator, config, device, args.log_dir)

    if args.resume:
        trainer.load_checkpoint(args.resume)

    trainer.train(dataloader, config.epochs, args.checkpoint_dir)


if __name__ == "__main__":
    main()
