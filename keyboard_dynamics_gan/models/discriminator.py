"""Bidirectional LSTM discriminator with rhythm analysis."""

import torch
import torch.nn as nn
from torch.nn.utils import spectral_norm
from torch.nn.utils.rnn import pack_padded_sequence

from keyboard_dynamics_gan.config import Config
from keyboard_dynamics_gan.models.rhythm import compute_rhythm_features


class Discriminator(nn.Module):
    """
    Bidirectional LSTM discriminator (Wasserstein critic).

    Takes character IDs with keystroke timings, computes 7 rhythm features
    (hold, flight, digraph, speed, speed_change, hold_ratio, jerk),
    concatenates with character embeddings, and outputs a scalar Wasserstein
    critic score (no sigmoid).
    """

    def __init__(self, config: Config):
        super().__init__()
        self.config = config

        self.char_embedding = nn.Embedding(
            config.vocab_size, config.char_embedding_dim
        )

        # 7 rhythm features + char_embedding_dim
        input_dim = 7 + config.char_embedding_dim

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
                    config.discriminator_hidden_dim * 2,
                    config.discriminator_hidden_dim,
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
        char_ids: torch.Tensor,
        timings: torch.Tensor,
        lengths: torch.Tensor,
    ) -> torch.Tensor:
        """
        Forward pass.

        Args:
            char_ids: (batch, seq_len) integer character IDs.
            timings: (batch, seq_len, 2) keystroke timings [hold, flight].
            lengths: (batch,) actual sequence lengths.

        Returns:
            scores: (batch, 1) Wasserstein critic scores.
        """
        hold_times = timings[:, :, 0]
        flight_times = timings[:, :, 1]

        rhythm_feats = compute_rhythm_features(hold_times, flight_times)
        char_embeds = self.char_embedding(char_ids)

        combined = torch.cat([char_embeds, rhythm_feats], dim=-1)
        encoded = self.feature_encoder(combined)

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
