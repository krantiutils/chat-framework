#!/usr/bin/env python3
"""CLI script for training the mouse trajectory GAN."""

import argparse
import logging
import sys

import torch
from torch.utils.data import DataLoader

from mouse_trajectory_gan.config import Config
from mouse_trajectory_gan.data.dataset import MouseTrajectoryDataset, collate_trajectories
from mouse_trajectory_gan.models.discriminator import Discriminator
from mouse_trajectory_gan.models.generator import Generator
from mouse_trajectory_gan.training.trainer import Trainer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train the WGAN-GP LSTM mouse trajectory generator"
    )

    parser.add_argument(
        "--data_path",
        type=str,
        required=True,
        help="Path to training data directory or CSV file",
    )
    parser.add_argument("--epochs", type=int, default=1000)
    parser.add_argument("--batch_size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--checkpoint", type=str, default=None, help="Resume from checkpoint")
    parser.add_argument("--checkpoint_dir", type=str, default="checkpoints")
    parser.add_argument("--log_dir", type=str, default="runs")
    parser.add_argument("--latent_dim", type=int, default=64)
    parser.add_argument("--hidden_dim", type=int, default=256)

    return parser.parse_args()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    args = parse_args()

    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    logging.info("Using device: %s", device)

    config = Config()
    config.batch_size = args.batch_size
    config.learning_rate = args.lr
    config.epochs = args.epochs
    config.latent_dim = args.latent_dim
    config.generator_hidden_dim = args.hidden_dim

    dataset = MouseTrajectoryDataset(args.data_path, config)
    if len(dataset) == 0:
        logging.error("No trajectories loaded. Check data path: %s", args.data_path)
        sys.exit(1)

    num_workers = config.num_workers
    pin_memory = config.pin_memory and device.type == "cuda"
    dataloader = DataLoader(
        dataset,
        batch_size=config.batch_size,
        shuffle=True,
        collate_fn=collate_trajectories,
        num_workers=num_workers,
        pin_memory=pin_memory,
        persistent_workers=num_workers > 0,
        drop_last=True,
    )

    generator = Generator(config)
    discriminator = Discriminator(config)

    g_params = sum(p.numel() for p in generator.parameters())
    d_params = sum(p.numel() for p in discriminator.parameters())
    logging.info("Generator parameters: %s", f"{g_params:,}")
    logging.info("Discriminator parameters: %s", f"{d_params:,}")

    trainer = Trainer(generator, discriminator, config, device, args.log_dir)

    if args.checkpoint:
        trainer.load_checkpoint(args.checkpoint)

    trainer.train(dataloader, config.epochs, args.checkpoint_dir)


if __name__ == "__main__":
    main()
