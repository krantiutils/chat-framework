"""Kinematic feature computation for mouse trajectories."""

import torch


def compute_kinematics(
    positions: torch.Tensor,
    dts: torch.Tensor,
    eps: float = 1e-8,
) -> torch.Tensor:
    """
    Compute kinematic features from trajectory positions.

    Args:
        positions: (batch, seq_len, 2) absolute x,y positions
        dts: (batch, seq_len) time deltas
        eps: small value to avoid division by zero

    Returns:
        features: (batch, seq_len, 9) tensor with:
            [x, y, dx, dy, dt, velocity, acceleration, jerk, curvature]
    """
    batch_size, seq_len, _ = positions.shape

    # Compute deltas
    dx = torch.zeros_like(positions[:, :, 0])
    dy = torch.zeros_like(positions[:, :, 1])
    dx[:, 1:] = positions[:, 1:, 0] - positions[:, :-1, 0]
    dy[:, 1:] = positions[:, 1:, 1] - positions[:, :-1, 1]

    # Velocity magnitude
    displacement = torch.sqrt(dx**2 + dy**2 + eps)
    velocity = displacement / (dts + eps)

    # Velocity components for curvature
    vx = dx / (dts + eps)
    vy = dy / (dts + eps)

    # Acceleration (dv/dt)
    acceleration = torch.zeros_like(velocity)
    dv = velocity[:, 1:] - velocity[:, :-1]
    dt_mid = (dts[:, 1:] + dts[:, :-1]) / 2 + eps
    acceleration[:, 1:] = dv / dt_mid

    # Jerk (da/dt)
    jerk = torch.zeros_like(acceleration)
    da = acceleration[:, 2:] - acceleration[:, 1:-1]
    jerk[:, 2:] = da / (dt_mid[:, 1:] + eps)

    # Curvature: |v x a| / |v|^3
    ax = torch.zeros_like(vx)
    ay = torch.zeros_like(vy)
    ax[:, 1:] = (vx[:, 1:] - vx[:, :-1]) / dt_mid
    ay[:, 1:] = (vy[:, 1:] - vy[:, :-1]) / dt_mid

    cross = torch.abs(vx * ay - vy * ax)
    speed_cubed = (vx**2 + vy**2 + eps) ** 1.5
    curvature = cross / speed_cubed

    # Clamp extreme values
    velocity = torch.clamp(velocity, 0, 100)
    acceleration = torch.clamp(acceleration, -1000, 1000)
    jerk = torch.clamp(jerk, -10000, 10000)
    curvature = torch.clamp(curvature, 0, 100)

    features = torch.stack(
        [
            positions[:, :, 0],
            positions[:, :, 1],
            dx,
            dy,
            dts,
            velocity,
            acceleration,
            jerk,
            curvature,
        ],
        dim=-1,
    )

    return features


def trajectory_to_absolute(
    start: torch.Tensor,
    deltas: torch.Tensor,
) -> torch.Tensor:
    """
    Convert relative deltas to absolute positions.

    Args:
        start: (batch, 2) starting positions
        deltas: (batch, seq_len, 2) relative displacements

    Returns:
        positions: (batch, seq_len+1, 2) absolute positions including start
    """
    cumsum = torch.cumsum(deltas, dim=1)
    positions = cumsum + start.unsqueeze(1)
    positions = torch.cat([start.unsqueeze(1), positions], dim=1)
    return positions
