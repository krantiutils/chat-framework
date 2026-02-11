"""Training manager with logging, checkpointing, and early stopping."""

import logging
import math
import os
from contextlib import nullcontext
from datetime import datetime
from typing import Dict

import matplotlib.pyplot as plt
import numpy as np
import torch
import torch.nn.functional as F
from torch.optim.lr_scheduler import ReduceLROnPlateau
from torch.utils.data import DataLoader
from torch.utils.tensorboard import SummaryWriter

from mouse_trajectory_gan.config import Config
from mouse_trajectory_gan.models.discriminator import Discriminator
from mouse_trajectory_gan.models.generator import Generator
from mouse_trajectory_gan.models.kinematics import trajectory_to_absolute
from mouse_trajectory_gan.training.losses import compute_gradient_penalty

logger = logging.getLogger(__name__)


class Trainer:
    """Training manager with logging, checkpointing, and early stopping."""

    def __init__(
        self,
        generator: Generator,
        discriminator: Discriminator,
        config: Config,
        device: torch.device,
        log_dir: str = "runs",
    ):
        self.generator = generator.to(device)
        self.discriminator = discriminator.to(device)
        self.config = config
        self.device = device
        self.use_amp = bool(config.use_amp and device.type == "cuda")
        self.scaler = torch.amp.GradScaler("cuda") if self.use_amp else None

        self.g_optimizer = torch.optim.Adam(
            generator.parameters(), lr=config.learning_rate, betas=config.betas
        )
        self.d_optimizer = torch.optim.Adam(
            discriminator.parameters(), lr=config.learning_rate, betas=config.betas
        )

        self.g_scheduler = ReduceLROnPlateau(
            self.g_optimizer,
            mode="min",
            factor=config.lr_factor,
            patience=config.lr_patience,
            min_lr=config.min_lr,
        )
        self.d_scheduler = ReduceLROnPlateau(
            self.d_optimizer,
            mode="min",
            factor=config.lr_factor,
            patience=config.lr_patience,
            min_lr=config.min_lr,
        )

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.writer = SummaryWriter(
            os.path.join(log_dir, f"trajectory_gan_{timestamp}")
        )

        self.best_loss = float("inf")
        self.patience_counter = 0
        self.epoch = 0
        self.d_step = 0

    def get_teacher_forcing_ratio(self) -> float:
        """Compute teacher forcing ratio with linear decay."""
        if self.epoch >= self.config.teacher_forcing_decay_epochs:
            return self.config.teacher_forcing_end
        progress = self.epoch / self.config.teacher_forcing_decay_epochs
        return self.config.teacher_forcing_start - progress * (
            self.config.teacher_forcing_start - self.config.teacher_forcing_end
        )

    def train_discriminator_step(self, real_batch: Dict) -> Dict[str, float]:
        """Single discriminator training step."""
        self.d_optimizer.zero_grad()

        batch_size = real_batch["starts"].shape[0]

        starts = real_batch["starts"].to(self.device)
        ends = real_batch["ends"].to(self.device)
        sequences = real_batch["sequences"].to(self.device)
        lengths = real_batch["lengths"].to(self.device)

        # Real data: convert deltas to absolute positions for discriminator
        real_deltas = sequences[:, :, :2]
        real_dts = sequences[:, :, 2]
        real_trajectories = trajectory_to_absolute(starts, real_deltas)
        real_dts_padded = F.pad(real_dts, (1, 0), value=0.001)

        # Generate fake data (no gradients through generator for D step)
        z = torch.randn(batch_size, self.config.latent_dim, device=self.device)
        with torch.no_grad():
            fake_sequences, fake_lengths = self.generator(
                starts,
                ends,
                z,
                target_sequences=sequences,
                target_lengths=lengths,
                teacher_forcing_ratio=0.0,
            )

        fake_deltas = fake_sequences[:, :, :2]
        fake_dts = fake_sequences[:, :, 2]
        fake_trajectories = trajectory_to_absolute(starts, fake_deltas)
        fake_dts_padded = F.pad(fake_dts, (1, 0), value=0.001)

        lengths_plus_one = lengths + 1
        fake_lengths_plus_one = fake_lengths + 1

        autocast_ctx = (
            torch.amp.autocast(device_type="cuda") if self.use_amp else nullcontext()
        )
        with autocast_ctx:
            real_score = self.discriminator(
                real_trajectories, real_dts_padded, lengths_plus_one
            )
            fake_score = self.discriminator(
                fake_trajectories, fake_dts_padded, fake_lengths_plus_one
            )
            d_loss = fake_score.mean() - real_score.mean()

        # Gradient penalty (amortized: every N steps on a batch subset)
        gp = torch.tensor(0.0, device=self.device)
        gp_every_n = max(1, self.config.gp_every_n)
        do_gp = self.d_step % gp_every_n == 0
        self.d_step += 1

        if do_gp:
            gp_batch_frac = min(max(self.config.gp_batch_frac, 0.0), 1.0)
            gp_batch_size = max(1, int(math.ceil(batch_size * gp_batch_frac)))

            if gp_batch_size < batch_size:
                idx = torch.randperm(batch_size, device=self.device)[:gp_batch_size]
                gp_real = real_trajectories.index_select(0, idx)
                gp_fake = fake_trajectories.index_select(0, idx)
                gp_real_dts = real_dts_padded.index_select(0, idx)
                gp_fake_dts = fake_dts_padded.index_select(0, idx)
                gp_lengths = lengths_plus_one.index_select(0, idx)
            else:
                gp_real = real_trajectories
                gp_fake = fake_trajectories
                gp_real_dts = real_dts_padded
                gp_fake_dts = fake_dts_padded
                gp_lengths = lengths_plus_one

            if self.use_amp:
                with torch.amp.autocast(device_type="cuda", enabled=False):
                    gp = compute_gradient_penalty(
                        self.discriminator,
                        gp_real,
                        gp_fake,
                        gp_real_dts,
                        gp_fake_dts,
                        gp_lengths,
                        self.device,
                    )
            else:
                gp = compute_gradient_penalty(
                    self.discriminator,
                    gp_real,
                    gp_fake,
                    gp_real_dts,
                    gp_fake_dts,
                    gp_lengths,
                    self.device,
                )

        total_loss = d_loss + self.config.gradient_penalty_weight * gp

        if self.use_amp:
            self.scaler.scale(total_loss).backward()
            self.scaler.step(self.d_optimizer)
            self.scaler.update()
        else:
            total_loss.backward()
            self.d_optimizer.step()

        return {
            "d_loss": d_loss.item(),
            "d_gp": gp.item(),
            "d_real_score": real_score.mean().item(),
            "d_fake_score": fake_score.mean().item(),
        }

    def train_generator_step(self, real_batch: Dict) -> Dict[str, float]:
        """Single generator training step."""
        self.g_optimizer.zero_grad()

        batch_size = real_batch["starts"].shape[0]

        starts = real_batch["starts"].to(self.device)
        ends = real_batch["ends"].to(self.device)
        sequences = real_batch["sequences"].to(self.device)
        lengths = real_batch["lengths"].to(self.device)

        z = torch.randn(batch_size, self.config.latent_dim, device=self.device)
        tf_ratio = self.get_teacher_forcing_ratio()

        autocast_ctx = (
            torch.amp.autocast(device_type="cuda") if self.use_amp else nullcontext()
        )
        with autocast_ctx:
            fake_sequences, fake_lengths = self.generator(
                starts,
                ends,
                z,
                target_sequences=sequences,
                target_lengths=lengths,
                teacher_forcing_ratio=tf_ratio,
            )

            fake_deltas = fake_sequences[:, :, :2]
            fake_dts = fake_sequences[:, :, 2]
            fake_trajectories = trajectory_to_absolute(starts, fake_deltas)
            fake_dts_padded = F.pad(fake_dts, (1, 0), value=0.001)

            fake_score = self.discriminator(
                fake_trajectories, fake_dts_padded, fake_lengths + 1
            )

            g_loss = -fake_score.mean()

            # Endpoint loss: encourage reaching target
            final_pos = fake_trajectories[
                torch.arange(batch_size, device=self.device), fake_lengths
            ]
            endpoint_loss = F.mse_loss(final_pos, ends)

            # Direction consistency loss
            target_direction = ends - starts
            target_direction = target_direction / (
                torch.sqrt((target_direction**2).sum(dim=-1, keepdim=True)) + 1e-8
            )

            movement_norms = torch.sqrt(
                (fake_deltas**2).sum(dim=-1, keepdim=True) + 1e-8
            )
            movement_directions = fake_deltas / movement_norms

            target_direction_expanded = target_direction.unsqueeze(1)
            cosine_sim = (movement_directions * target_direction_expanded).sum(dim=-1)

            max_len = fake_deltas.shape[1]
            mask = (
                torch.arange(max_len, device=self.device).unsqueeze(0)
                < fake_lengths.unsqueeze(1)
            )
            direction_loss = ((1 - cosine_sim) * mask.float()).sum() / mask.float().sum()

            total_loss = (
                g_loss
                + self.config.endpoint_loss_weight * endpoint_loss
                + self.config.direction_loss_weight * direction_loss
            )

        if self.use_amp:
            self.scaler.scale(total_loss).backward()
            self.scaler.step(self.g_optimizer)
            self.scaler.update()
        else:
            total_loss.backward()
            self.g_optimizer.step()

        return {
            "g_loss": g_loss.item(),
            "g_endpoint_loss": endpoint_loss.item(),
            "g_direction_loss": direction_loss.item(),
            "g_fake_score": fake_score.mean().item(),
            "teacher_forcing_ratio": tf_ratio,
        }

    def train_epoch(self, dataloader: DataLoader) -> Dict[str, float]:
        """Train for one epoch."""
        self.generator.train()
        self.discriminator.train()

        epoch_metrics: Dict[str, list] = {
            "d_loss": [],
            "d_gp": [],
            "d_real_score": [],
            "d_fake_score": [],
            "g_loss": [],
            "g_endpoint_loss": [],
            "g_direction_loss": [],
            "g_fake_score": [],
        }

        for batch in dataloader:
            for _ in range(self.config.n_critic):
                d_metrics = self.train_discriminator_step(batch)
                for k, v in d_metrics.items():
                    if k in epoch_metrics:
                        epoch_metrics[k].append(v)

            g_metrics = self.train_generator_step(batch)
            for k, v in g_metrics.items():
                if k in epoch_metrics:
                    epoch_metrics[k].append(v)

        avg_metrics = {k: np.mean(v) for k, v in epoch_metrics.items() if v}
        avg_metrics["teacher_forcing_ratio"] = self.get_teacher_forcing_ratio()
        return avg_metrics

    def log_metrics(self, metrics: Dict[str, float], step: int) -> None:
        """Log metrics to TensorBoard."""
        for name, value in metrics.items():
            self.writer.add_scalar(f"train/{name}", value, step)
        self.writer.add_scalar(
            "train/g_lr", self.g_optimizer.param_groups[0]["lr"], step
        )
        self.writer.add_scalar(
            "train/d_lr", self.d_optimizer.param_groups[0]["lr"], step
        )

    def log_trajectories(self, dataloader: DataLoader, step: int) -> None:
        """Log sample trajectory visualizations to TensorBoard."""
        self.generator.eval()

        with torch.no_grad():
            batch = next(iter(dataloader))
            starts = batch["starts"][:4].to(self.device)
            ends = batch["ends"][:4].to(self.device)
            real_sequences = batch["sequences"][:4].to(self.device)
            lengths = batch["lengths"][:4]

            z = torch.randn(4, self.config.latent_dim, device=self.device)
            fake_sequences, fake_lengths = self.generator.generate(starts, ends, z)

            real_traj = trajectory_to_absolute(starts, real_sequences[:, :, :2])
            fake_traj = trajectory_to_absolute(starts, fake_sequences[:, :, :2])

            fig, axes = plt.subplots(2, 2, figsize=(10, 10))
            for i, ax in enumerate(axes.flat):
                if i < 4:
                    real_len = lengths[i].item() + 1
                    fake_len = fake_lengths[i].item() + 1

                    real_np = real_traj[i, :real_len].cpu().numpy()
                    fake_np = fake_traj[i, :fake_len].cpu().numpy()

                    ax.plot(real_np[:, 0], real_np[:, 1], "b-", label="Real", alpha=0.7)
                    ax.plot(
                        fake_np[:, 0],
                        fake_np[:, 1],
                        "r--",
                        label="Generated",
                        alpha=0.7,
                    )
                    ax.scatter(
                        [starts[i, 0].cpu()],
                        [starts[i, 1].cpu()],
                        c="green",
                        s=100,
                        marker="o",
                        label="Start",
                    )
                    ax.scatter(
                        [ends[i, 0].cpu()],
                        [ends[i, 1].cpu()],
                        c="red",
                        s=100,
                        marker="x",
                        label="End",
                    )
                    ax.legend()
                    ax.set_title(f"Trajectory {i + 1}")
                    ax.set_xlim(0, 1)
                    ax.set_ylim(0, 1)
                    ax.invert_yaxis()

            plt.tight_layout()
            self.writer.add_figure("trajectories/comparison", fig, step)
            plt.close(fig)

        self.generator.train()

    def save_checkpoint(self, path: str, is_best: bool = False) -> None:
        """Save model checkpoint."""
        checkpoint = {
            "epoch": self.epoch,
            "generator_state_dict": self.generator.state_dict(),
            "discriminator_state_dict": self.discriminator.state_dict(),
            "g_optimizer_state_dict": self.g_optimizer.state_dict(),
            "d_optimizer_state_dict": self.d_optimizer.state_dict(),
            "config": self.config,
            "best_loss": self.best_loss,
        }
        torch.save(checkpoint, path)

        if is_best:
            best_path = path.replace(".pt", "_best.pt")
            torch.save(checkpoint, best_path)

    def load_checkpoint(self, path: str) -> None:
        """Load model checkpoint."""
        checkpoint = torch.load(path, map_location=self.device, weights_only=False)

        self.epoch = checkpoint["epoch"]
        self.generator.load_state_dict(checkpoint["generator_state_dict"])
        self.discriminator.load_state_dict(checkpoint["discriminator_state_dict"])
        self.g_optimizer.load_state_dict(checkpoint["g_optimizer_state_dict"])
        self.d_optimizer.load_state_dict(checkpoint["d_optimizer_state_dict"])
        self.best_loss = checkpoint.get("best_loss", float("inf"))

        logger.info("Loaded checkpoint from epoch %d", self.epoch)

    def train(
        self,
        dataloader: DataLoader,
        num_epochs: int,
        checkpoint_dir: str = "checkpoints",
    ) -> None:
        """Full training loop with early stopping."""
        os.makedirs(checkpoint_dir, exist_ok=True)

        logger.info("Starting training for %d epochs on %s", num_epochs, self.device)
        logger.info("Batch size: %d, Dataset size: %d", self.config.batch_size, len(dataloader.dataset))

        for epoch in range(self.epoch, num_epochs):
            self.epoch = epoch

            metrics = self.train_epoch(dataloader)
            self.log_metrics(metrics, epoch)

            if epoch % 10 == 0:
                self.log_trajectories(dataloader, epoch)

            combined_loss = metrics["d_loss"] + metrics["g_loss"]
            self.g_scheduler.step(metrics["g_loss"])
            self.d_scheduler.step(metrics["d_loss"])

            if combined_loss < self.best_loss:
                self.best_loss = combined_loss
                self.patience_counter = 0
                is_best = True
            else:
                self.patience_counter += 1
                is_best = False

            if epoch % 10 == 0 or is_best:
                checkpoint_path = os.path.join(
                    checkpoint_dir, f"checkpoint_epoch_{epoch}.pt"
                )
                self.save_checkpoint(checkpoint_path, is_best)

            logger.info(
                "Epoch %d/%d | D Loss: %.4f | G Loss: %.4f | Endpoint: %.4f | TF: %.2f",
                epoch,
                num_epochs,
                metrics["d_loss"],
                metrics["g_loss"],
                metrics["g_endpoint_loss"],
                metrics["teacher_forcing_ratio"],
            )

            if self.patience_counter >= self.config.patience:
                logger.info("Early stopping at epoch %d", epoch)
                break

        self.writer.close()
        logger.info("Training complete!")
