"""LSTM-based generator for keystroke timing sequences."""

from typing import Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

from keyboard_dynamics_gan.config import Config


class Generator(nn.Module):
    """
    LSTM-based generator for keystroke dynamics.

    Given a character sequence and a latent user-profile vector z, generates
    realistic (hold_time, flight_time) pairs for each keystroke.  Uses
    autoregressive decoding: each step consumes the previous timing output
    alongside the current character embedding and a conditioning vector
    derived from z.
    """

    def __init__(self, config: Config):
        super().__init__()
        self.config = config

        self.char_embedding = nn.Embedding(
            config.vocab_size, config.char_embedding_dim
        )

        # Condition encoder: z -> condition vector
        self.condition_encoder = nn.Sequential(
            nn.Linear(config.latent_dim, config.generator_hidden_dim),
            nn.LayerNorm(config.generator_hidden_dim),
            nn.LeakyReLU(0.2),
            nn.Linear(config.generator_hidden_dim, config.generator_hidden_dim),
            nn.LayerNorm(config.generator_hidden_dim),
            nn.LeakyReLU(0.2),
        )

        # LSTM input: char_embedding + condition + previous timing (hold, flight)
        lstm_input_size = (
            config.char_embedding_dim + config.generator_hidden_dim + 2
        )
        self.lstm = nn.LSTM(
            input_size=lstm_input_size,
            hidden_size=config.generator_hidden_dim,
            num_layers=config.generator_num_layers,
            batch_first=True,
            dropout=0.1 if config.generator_num_layers > 1 else 0,
        )

        # Output projection: hidden -> (hold_time, flight_time)
        self.output_layer = nn.Sequential(
            nn.Linear(config.generator_hidden_dim, config.generator_hidden_dim // 2),
            nn.LeakyReLU(0.2),
            nn.Linear(config.generator_hidden_dim // 2, 2),
        )

        # Learnable initial timing token (hold, flight)
        self.initial_timing = nn.Parameter(torch.zeros(1, 1, 2))

    def forward(
        self,
        char_ids: torch.Tensor,
        z: torch.Tensor,
        target_timings: Optional[torch.Tensor] = None,
        lengths: Optional[torch.Tensor] = None,
        teacher_forcing_ratio: float = 0.0,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Forward pass for training.

        Args:
            char_ids: (batch, max_seq_len) integer character IDs (padded).
            z: (batch, latent_dim) noise / user-profile vector.
            target_timings: (batch, max_seq_len, 2) ground-truth
                [hold_time, flight_time] for teacher forcing.
            lengths: (batch,) actual sequence lengths.
            teacher_forcing_ratio: probability of using ground-truth input
                at each step.

        Returns:
            outputs: (batch, max_seq_len, 2) generated timings.
            lengths: (batch,) sequence lengths (unchanged from input).
        """
        batch_size, max_len = char_ids.shape
        device = char_ids.device

        condition = self.condition_encoder(z)
        char_embeds = self.char_embedding(char_ids)

        h = torch.zeros(
            self.config.generator_num_layers,
            batch_size,
            self.config.generator_hidden_dim,
            device=device,
        )
        c = torch.zeros_like(h)

        outputs = []
        prev_timing = self.initial_timing.expand(batch_size, 1, 2)

        for t in range(max_len):
            char_t = char_embeds[:, t : t + 1, :]

            lstm_input = torch.cat(
                [char_t, condition.unsqueeze(1), prev_timing],
                dim=-1,
            )

            lstm_out, (h, c) = self.lstm(lstm_input, (h, c))

            output = self.output_layer(lstm_out)
            # Ensure positive timings via softplus with minimum floor
            output = F.softplus(output) + 0.005

            outputs.append(output)

            if (
                target_timings is not None
                and torch.rand(1).item() < teacher_forcing_ratio
            ):
                prev_timing = target_timings[:, t : t + 1, :]
            else:
                prev_timing = output

        outputs = torch.cat(outputs, dim=1)

        if lengths is None:
            lengths = torch.full(
                (batch_size,), max_len, dtype=torch.long, device=device
            )

        return outputs, lengths

    def generate(
        self,
        char_ids: torch.Tensor,
        lengths: torch.Tensor,
        z: Optional[torch.Tensor] = None,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Generate keystroke timings for a character sequence.

        Args:
            char_ids: (batch, max_seq_len) integer character IDs (padded).
            lengths: (batch,) actual sequence lengths.
            z: (batch, latent_dim) user-profile vector; sampled randomly
               if None.

        Returns:
            timings: (batch, max_seq_len, 2) generated [hold, flight].
            lengths: (batch,) sequence lengths (unchanged from input).
        """
        batch_size = char_ids.shape[0]
        device = char_ids.device

        if z is None:
            z = torch.randn(batch_size, self.config.latent_dim, device=device)

        with torch.no_grad():
            timings, lengths = self.forward(
                char_ids, z, target_timings=None, lengths=lengths
            )

        return timings, lengths
