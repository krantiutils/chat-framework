"""Loss functions for WGAN-GP training."""

import torch

from keyboard_dynamics_gan.models.discriminator import Discriminator


def compute_gradient_penalty(
    discriminator: Discriminator,
    char_ids: torch.Tensor,
    real_timings: torch.Tensor,
    fake_timings: torch.Tensor,
    lengths: torch.Tensor,
    device: torch.device,
) -> torch.Tensor:
    """
    Compute gradient penalty for WGAN-GP.

    Interpolates between real and fake *timings* (the continuous inputs),
    keeping ``char_ids`` fixed.  Penalises discriminator gradient norms that
    deviate from 1.

    Args:
        discriminator: The critic network.
        char_ids: (batch, seq_len) integer character IDs (shared by real/fake).
        real_timings: (batch, seq_len, 2) real [hold, flight].
        fake_timings: (batch, seq_len, 2) generated [hold, flight].
        lengths: (batch,) sequence lengths.
        device: Torch device.

    Returns:
        Scalar gradient penalty loss.
    """
    batch_size = real_timings.shape[0]

    # Truncate to common sequence length
    min_len = min(real_timings.shape[1], fake_timings.shape[1])
    real_timings = real_timings[:, :min_len]
    fake_timings = fake_timings[:, :min_len]
    char_ids = char_ids[:, :min_len]
    lengths = lengths.clamp(max=min_len)

    alpha = torch.rand(batch_size, 1, 1, device=device)

    interpolated = alpha * real_timings + (1 - alpha) * fake_timings
    interpolated.requires_grad_(True)

    # Disable CuDNN for RNNs to allow double backward (required for GP)
    if device.type == "cuda":
        with torch.backends.cudnn.flags(enabled=False):
            d_interpolated = discriminator(char_ids, interpolated, lengths)
    else:
        d_interpolated = discriminator(char_ids, interpolated, lengths)

    gradients = torch.autograd.grad(
        outputs=d_interpolated,
        inputs=interpolated,
        grad_outputs=torch.ones_like(d_interpolated),
        create_graph=True,
        retain_graph=True,
    )[0]

    gradients = gradients.reshape(batch_size, -1)
    gradient_norm = gradients.norm(2, dim=1)
    gradient_penalty = ((gradient_norm - 1) ** 2).mean()

    return gradient_penalty
