"""Bidirectional LSTM discriminator with kinematic feature extraction."""

import torch
import torch.nn as nn
from torch.nn.utils import spectral_norm
from torch.nn.utils.rnn import pack_padded_sequence

from mouse_trajectory_gan.config import Config
from mouse_trajectory_gan.models.kinematics import compute_kinematics


class Discriminator(nn.Module):
    """
    Bidirectional LSTM discriminator (Wasserstein critic).

    Takes trajectory positions and time deltas, computes 9 kinematic features
    (x, y, dx, dy, dt, velocity, acceleration, jerk, curvature), and outputs
    a scalar Wasserstein critic score (no sigmoid).
    """

    def __init__(self, config: Config):
        super().__init__()
        self.config = config

        input_dim = 9  # kinematic features

        self.feature_encoder = nn.Sequential(
            spectral_norm(nn.Linear(input_dim, config.discriminator_hidden_dim)),
            nn.LeakyReLU(0.2),
            spectral_norm(
                nn.Linear(
                    config.discriminator_hidden_dim, config.discriminator_hidden_dim
                )
            ),
            nn.LeakyReLU(0.2),
        )

        self.lstm = nn.LSTM(
            input_size=config.discriminator_hidden_dim,
            hidden_size=config.discriminator_hidden_dim,
            num_layers=config.discriminator_num_layers,
            batch_first=True,
            bidirectional=True,
            dropout=0.1 if config.discriminator_num_layers > 1 else 0,
        )

        self.output_layers = nn.Sequential(
            spectral_norm(
                nn.Linear(
                    config.discriminator_hidden_dim * 2, config.discriminator_hidden_dim
                )
            ),
            nn.LeakyReLU(0.2),
            nn.Dropout(0.3),
            spectral_norm(
                nn.Linear(
                    config.discriminator_hidden_dim,
                    config.discriminator_hidden_dim // 2,
                )
            ),
            nn.LeakyReLU(0.2),
            spectral_norm(nn.Linear(config.discriminator_hidden_dim // 2, 1)),
        )

    def forward(
        self,
        trajectories: torch.Tensor,
        dts: torch.Tensor,
        lengths: torch.Tensor,
    ) -> torch.Tensor:
        """
        Forward pass.

        Args:
            trajectories: (batch, seq_len, 2) absolute positions
            dts: (batch, seq_len) time deltas
            lengths: (batch,) actual sequence lengths

        Returns:
            scores: (batch, 1) Wasserstein critic scores
        """
        features = compute_kinematics(trajectories, dts)

        encoded = self.feature_encoder(features)

        packed = pack_padded_sequence(
            encoded,
            lengths.cpu().clamp(min=1),
            batch_first=True,
            enforce_sorted=False,
        )

        _, (h, _) = self.lstm(packed)

        # Concatenate forward and backward final hidden states
        h_forward = h[-2]
        h_backward = h[-1]
        h_combined = torch.cat([h_forward, h_backward], dim=-1)

        return self.output_layers(h_combined)
