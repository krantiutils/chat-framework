"""LSTM-based generator for mouse trajectory sequences."""

from typing import Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

from mouse_trajectory_gan.config import Config


class Generator(nn.Module):
    """
    LSTM-based generator for mouse trajectories.

    Generates sequences of (dx, dy, dt) conditioned on start/end points
    and a latent noise vector. Uses autoregressive decoding during inference
    with dynamic features that track remaining distance to target.
    """

    def __init__(self, config: Config):
        super().__init__()
        self.config = config

        # Conditioning encoder: (start_x, start_y, end_x, end_y, distance, angle) + z
        condition_dim = 6
        self.condition_encoder = nn.Sequential(
            nn.Linear(condition_dim + config.latent_dim, config.generator_hidden_dim),
            nn.LayerNorm(config.generator_hidden_dim),
            nn.LeakyReLU(0.2),
            nn.Linear(config.generator_hidden_dim, config.generator_hidden_dim),
            nn.LayerNorm(config.generator_hidden_dim),
            nn.LeakyReLU(0.2),
        )

        # LSTM: input = (dx, dy, dt) + condition + dynamic features
        # Dynamic features: remaining_dx, remaining_dy, remaining_dist, remaining_angle
        self.lstm = nn.LSTM(
            input_size=3 + config.generator_hidden_dim + 4,
            hidden_size=config.generator_hidden_dim,
            num_layers=config.generator_num_layers,
            batch_first=True,
            dropout=0.1 if config.generator_num_layers > 1 else 0,
        )

        # Output projection: hidden -> (dx, dy, dt)
        self.output_layer = nn.Sequential(
            nn.Linear(config.generator_hidden_dim, config.generator_hidden_dim // 2),
            nn.LeakyReLU(0.2),
            nn.Linear(config.generator_hidden_dim // 2, 3),
        )

        # Learnable initial input token
        self.initial_input = nn.Parameter(torch.zeros(1, 1, 3))

    def _compute_condition(
        self,
        start: torch.Tensor,
        end: torch.Tensor,
        z: torch.Tensor,
    ) -> torch.Tensor:
        """Compute conditioning vector from start, end, and noise."""
        diff = end - start
        distance = torch.sqrt((diff**2).sum(dim=-1, keepdim=True) + 1e-8)
        angle = torch.atan2(diff[:, 1:2], diff[:, 0:1])
        condition_input = torch.cat([start, end, distance, angle, z], dim=-1)
        return self.condition_encoder(condition_input)

    def _compute_dynamic_features(
        self,
        current_pos: torch.Tensor,
        end: torch.Tensor,
    ) -> torch.Tensor:
        """
        Compute dynamic features based on current position relative to target.

        Returns (batch, 4): [remaining_dx, remaining_dy, remaining_distance, remaining_angle]
        """
        remaining = end - current_pos
        remaining_dist = torch.sqrt((remaining**2).sum(dim=-1, keepdim=True) + 1e-8)
        remaining_angle = torch.atan2(remaining[:, 1:2], remaining[:, 0:1])
        return torch.cat([remaining, remaining_dist, remaining_angle], dim=-1)

    def forward(
        self,
        start: torch.Tensor,
        end: torch.Tensor,
        z: torch.Tensor,
        target_sequences: Optional[torch.Tensor] = None,
        target_lengths: Optional[torch.Tensor] = None,
        teacher_forcing_ratio: float = 0.0,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Forward pass for training.

        Args:
            start: (batch, 2) start positions (normalized 0-1)
            end: (batch, 2) end positions (normalized 0-1)
            z: (batch, latent_dim) noise vector
            target_sequences: (batch, max_len, 3) target (dx, dy, dt) for teacher forcing
            target_lengths: (batch,) actual sequence lengths
            teacher_forcing_ratio: probability of using ground-truth input at each step

        Returns:
            outputs: (batch, max_len, 3) generated sequences
            lengths: (batch,) sequence lengths
        """
        batch_size = start.shape[0]
        device = start.device

        condition = self._compute_condition(start, end, z)

        if target_sequences is not None:
            max_len = target_sequences.shape[1]
        else:
            max_len = self.config.max_generation_steps

        h = torch.zeros(
            self.config.generator_num_layers,
            batch_size,
            self.config.generator_hidden_dim,
            device=device,
        )
        c = torch.zeros_like(h)

        outputs = []
        current_input = self.initial_input.expand(batch_size, 1, 3)
        current_pos = start.clone()

        for t in range(max_len):
            dynamic_feat = self._compute_dynamic_features(current_pos, end)

            lstm_input = torch.cat(
                [current_input, condition.unsqueeze(1), dynamic_feat.unsqueeze(1)],
                dim=-1,
            )

            lstm_out, (h, c) = self.lstm(lstm_input, (h, c))

            output = self.output_layer(lstm_out)
            # Ensure positive dt via softplus with minimum 1ms
            output = torch.cat(
                [output[:, :, :2], F.softplus(output[:, :, 2:3]) + 0.001],
                dim=-1,
            )

            outputs.append(output)
            current_pos = current_pos + output[:, 0, :2]

            if (
                target_sequences is not None
                and torch.rand(1).item() < teacher_forcing_ratio
            ):
                current_input = target_sequences[:, t : t + 1, :]
                # Recompute position from teacher-forced trajectory
                current_pos = start.clone()
                for i in range(t + 1):
                    current_pos = current_pos + target_sequences[:, i, :2]
            else:
                current_input = output

        outputs = torch.cat(outputs, dim=1)

        if target_lengths is not None:
            lengths = target_lengths
        else:
            lengths = torch.full((batch_size,), max_len, device=device)

        return outputs, lengths

    def generate(
        self,
        start: torch.Tensor,
        end: torch.Tensor,
        z: Optional[torch.Tensor] = None,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Generate trajectories with early stopping.

        Stops each sequence when accumulated position is within
        config.distance_threshold of the target endpoint.

        Args:
            start: (batch, 2) start positions (normalized 0-1)
            end: (batch, 2) end positions (normalized 0-1)
            z: (batch, latent_dim) noise vector, sampled randomly if None

        Returns:
            outputs: (batch, num_steps, 3) generated (dx, dy, dt) sequences
            lengths: (batch,) number of valid steps per sequence
        """
        batch_size = start.shape[0]
        device = start.device

        if z is None:
            z = torch.randn(batch_size, self.config.latent_dim, device=device)

        condition = self._compute_condition(start, end, z)

        h = torch.zeros(
            self.config.generator_num_layers,
            batch_size,
            self.config.generator_hidden_dim,
            device=device,
        )
        c = torch.zeros_like(h)

        outputs = []
        current_input = self.initial_input.expand(batch_size, 1, 3)
        current_pos = start.clone()

        done = torch.zeros(batch_size, dtype=torch.bool, device=device)
        lengths = torch.zeros(batch_size, dtype=torch.long, device=device)

        for t in range(self.config.max_generation_steps):
            dynamic_feat = self._compute_dynamic_features(current_pos, end)

            lstm_input = torch.cat(
                [current_input, condition.unsqueeze(1), dynamic_feat.unsqueeze(1)],
                dim=-1,
            )

            lstm_out, (h, c) = self.lstm(lstm_input, (h, c))

            output = self.output_layer(lstm_out)
            output = torch.cat(
                [output[:, :, :2], F.softplus(output[:, :, 2:3]) + 0.001],
                dim=-1,
            )

            outputs.append(output)
            current_input = output
            current_pos = current_pos + output[:, 0, :2]

            distance_to_end = torch.sqrt(((current_pos - end) ** 2).sum(dim=-1))
            newly_done = distance_to_end < self.config.distance_threshold

            lengths = torch.where(
                newly_done & ~done,
                torch.tensor(t + 1, device=device),
                lengths,
            )
            done = done | newly_done

            if done.all():
                break

        # Set lengths for sequences that didn't reach the threshold
        lengths = torch.where(
            lengths == 0, torch.tensor(t + 1, device=device), lengths
        )

        outputs = torch.cat(outputs, dim=1)
        return outputs, lengths
