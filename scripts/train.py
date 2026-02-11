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


def download_kaggle_data(target_dir: str) -> str:
    """Download Kaggle mouse movement datasets via kagglehub.

    Downloads both:
    - sameelarif/mouse-movement-between-ui-elements (raw JSON trajectories)
    - prashantmudgal/mouse-movement (IOGraphica images)

    Returns the target directory path.
    """
    import shutil
    from pathlib import Path

    import kagglehub

    target = Path(target_dir)
    target.mkdir(parents=True, exist_ok=True)

    # Download raw trajectory data (JSON)
    json_dest = target / "main.data.json"
    if not json_dest.exists():
        logging.info("Downloading sameelarif/mouse-movement-between-ui-elements...")
        path = kagglehub.dataset_download("sameelarif/mouse-movement-between-ui-elements")
        src = Path(path) / "main.data.json"
        if src.exists():
            shutil.copy2(src, json_dest)
            logging.info("Saved raw trajectory JSON to %s", json_dest)
        else:
            raise FileNotFoundError(f"Expected main.data.json in {path}")
    else:
        logging.info("Raw trajectory JSON already exists at %s", json_dest)

    # Download IOGraphica images
    img_dir = target / "iographica"
    if not img_dir.exists():
        logging.info("Downloading prashantmudgal/mouse-movement...")
        path = kagglehub.dataset_download("prashantmudgal/mouse-movement")
        src = Path(path) / "Mouse Movement"
        if src.exists():
            shutil.copytree(src, img_dir)
            logging.info("Saved IOGraphica images to %s", img_dir)
        else:
            raise FileNotFoundError(f"Expected 'Mouse Movement' directory in {path}")
    else:
        logging.info("IOGraphica images already exist at %s", img_dir)

    return str(target)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train the WGAN-GP LSTM mouse trajectory generator"
    )

    parser.add_argument(
        "--data_path",
        type=str,
        default=None,
        help="Path to training data (directory, CSV, JSON, or PNG file)",
    )
    parser.add_argument(
        "--download_kaggle",
        action="store_true",
        help="Download Kaggle mouse movement datasets before training",
    )
    parser.add_argument(
        "--kaggle_data_dir",
        type=str,
        default="data/kaggle_mouse",
        help="Directory for downloaded Kaggle data (default: data/kaggle_mouse)",
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

    if args.download_kaggle:
        data_path = download_kaggle_data(args.kaggle_data_dir)
        if args.data_path is None:
            args.data_path = data_path
        logging.info("Kaggle data available at: %s", data_path)

    if args.data_path is None:
        logging.error("No data path specified. Use --data_path or --download_kaggle")
        sys.exit(1)

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
