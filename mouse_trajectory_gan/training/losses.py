"""Loss functions for WGAN-GP training."""

import torch

from mouse_trajectory_gan.models.discriminator import Discriminator


def compute_gradient_penalty(
    discriminator: Discriminator,
    real_trajectories: torch.Tensor,
    fake_trajectories: torch.Tensor,
    real_dts: torch.Tensor,
    fake_dts: torch.Tensor,
    lengths: torch.Tensor,
    device: torch.device,
) -> torch.Tensor:
    """
    Compute gradient penalty for WGAN-GP.

    Interpolates between real and fake trajectories, computes the discriminator
    output on the interpolation, and penalizes gradient norms that deviate from 1.

    Args:
        discriminator: The critic network.
        real_trajectories: (batch, seq_len, 2) real absolute positions.
        fake_trajectories: (batch, seq_len, 2) generated absolute positions.
        real_dts: (batch, seq_len) real time deltas.
        fake_dts: (batch, seq_len) generated time deltas.
        lengths: (batch,) sequence lengths.
        device: Torch device.

    Returns:
        Scalar gradient penalty loss.
    """
    batch_size = real_trajectories.shape[0]

    # Truncate to common sequence length
    min_len = min(real_trajectories.shape[1], fake_trajectories.shape[1])
    real_trajectories = real_trajectories[:, :min_len]
    fake_trajectories = fake_trajectories[:, :min_len]
    real_dts = real_dts[:, :min_len]
    fake_dts = fake_dts[:, :min_len]
    lengths = lengths.clamp(max=min_len)

    alpha = torch.rand(batch_size, 1, 1, device=device)
    alpha_dt = alpha.squeeze(-1)

    interpolated = alpha * real_trajectories + (1 - alpha) * fake_trajectories
    interpolated_dts = alpha_dt * real_dts + (1 - alpha_dt) * fake_dts
    interpolated.requires_grad_(True)

    # Disable CuDNN for RNNs to allow double backward (required for GP)
    if device.type == "cuda":
        with torch.backends.cudnn.flags(enabled=False):
            d_interpolated = discriminator(interpolated, interpolated_dts, lengths)
    else:
        d_interpolated = discriminator(interpolated, interpolated_dts, lengths)

    gradients = torch.autograd.grad(
        outputs=d_interpolated,
        inputs=interpolated,
        grad_outputs=torch.ones_like(d_interpolated),
        create_graph=True,
        retain_graph=True,
    )[0]

    gradients = gradients.view(batch_size, -1)
    gradient_norm = gradients.norm(2, dim=1)
    gradient_penalty = ((gradient_norm - 1) ** 2).mean()

    return gradient_penalty
