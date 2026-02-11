"""Fitts' Law compliance evaluation for generated trajectories."""

from typing import Dict

import numpy as np
import torch


def evaluate_fitts_compliance(
    trajectories: torch.Tensor,
    dts: torch.Tensor,
    starts: torch.Tensor,
    ends: torch.Tensor,
    target_width: float = 0.02,
) -> Dict[str, float]:
    """
    Evaluate Fitts' Law compliance of trajectories.

    Fitts' Law: MT = a + b * log2(D/W + 1)

    A high correlation between index of difficulty and movement time
    indicates the generated trajectories exhibit realistic human motor behavior.

    Args:
        trajectories: (batch, seq_len, 2) absolute positions.
        dts: (batch, seq_len) time deltas.
        starts: (batch, 2) start positions.
        ends: (batch, 2) end positions.
        target_width: Width of the target area (normalized).

    Returns:
        Dict with fitts_correlation, mean_movement_time, mean_distance, mean_id.
    """
    movement_times = dts.sum(dim=-1).cpu().numpy()
    distances = torch.sqrt(((ends - starts) ** 2).sum(dim=-1)).cpu().numpy()
    index_of_difficulty = np.log2(distances / target_width + 1)

    if len(movement_times) < 2:
        correlation = 0.0
    else:
        correlation = float(np.corrcoef(index_of_difficulty, movement_times)[0, 1])
        if np.isnan(correlation):
            correlation = 0.0

    return {
        "fitts_correlation": correlation,
        "mean_movement_time": float(movement_times.mean()),
        "mean_distance": float(distances.mean()),
        "mean_id": float(index_of_difficulty.mean()),
    }
