"""Training entry point for the keyboard dynamics GAN."""

import argparse
import logging

import torch
from torch.utils.data import DataLoader

from keyboard_dynamics_gan.config import Config
from keyboard_dynamics_gan.data.dataset import KeystrokeDataset, collate_keystrokes
from keyboard_dynamics_gan.models.discriminator import Discriminator
from keyboard_dynamics_gan.models.generator import Generator
from keyboard_dynamics_gan.training.trainer import Trainer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train the keyboard dynamics WGAN-GP LSTM."
    )
    parser.add_argument(
        "--data", type=str, required=True,
        help="Path to training data CSV (or directory of CSVs).",
    )
    parser.add_argument("--epochs", type=int, default=1000)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--latent-dim", type=int, default=64)
    parser.add_argument(
        "--checkpoint-dir", type=str, default="checkpoints",
    )
    parser.add_argument("--log-dir", type=str, default="runs")
    parser.add_argument(
        "--resume", type=str, default=None,
        help="Path to checkpoint to resume from.",
    )
    parser.add_argument(
        "--device", type=str, default=None,
        help="Device (cuda/cpu/mps). Auto-detected if omitted.",
    )
    parser.add_argument(
        "--no-augment", action="store_true",
        help="Disable data augmentation.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
    )

    config = Config()
    config.batch_size = args.batch_size
    config.learning_rate = args.lr
    config.latent_dim = args.latent_dim
    config.epochs = args.epochs

    if args.device:
        device = torch.device(args.device)
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")

    dataset = KeystrokeDataset(
        args.data, config, augment=not args.no_augment
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

    trainer = Trainer(generator, discriminator, config, device, args.log_dir)

    if args.resume:
        trainer.load_checkpoint(args.resume)

    trainer.train(dataloader, config.epochs, args.checkpoint_dir)


if __name__ == "__main__":
    main()
