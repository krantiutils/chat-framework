"""Rhythm feature computation for keystroke dynamics."""

import torch


def compute_rhythm_features(
    hold_times: torch.Tensor,
    flight_times: torch.Tensor,
    eps: float = 1e-8,
) -> torch.Tensor:
    """
    Compute rhythm features from keystroke timings.

    Args:
        hold_times: (batch, seq_len) key press durations in seconds.
        flight_times: (batch, seq_len) inter-key intervals in seconds.
        eps: small value to avoid division by zero.

    Returns:
        features: (batch, seq_len, 7) tensor with:
            [hold_time, flight_time, digraph_time, typing_speed,
             speed_change, hold_ratio, typing_jerk]
    """
    # Digraph time: total time for one keystroke cycle
    digraph_time = hold_times + flight_times

    # Typing speed: inverse of digraph time (keystrokes per second)
    typing_speed = 1.0 / (digraph_time + eps)

    # Speed change: acceleration in typing speed
    speed_change = torch.zeros_like(typing_speed)
    speed_change[:, 1:] = typing_speed[:, 1:] - typing_speed[:, :-1]

    # Hold ratio: fraction of digraph spent pressing key
    hold_ratio = hold_times / (digraph_time + eps)

    # Typing jerk: rate of change of speed_change
    typing_jerk = torch.zeros_like(speed_change)
    typing_jerk[:, 2:] = speed_change[:, 2:] - speed_change[:, 1:-1]

    # Clamp extreme values
    typing_speed = torch.clamp(typing_speed, 0, 100)
    speed_change = torch.clamp(speed_change, -100, 100)
    typing_jerk = torch.clamp(typing_jerk, -1000, 1000)
    hold_ratio = torch.clamp(hold_ratio, 0, 1)

    features = torch.stack(
        [
            hold_times,
            flight_times,
            digraph_time,
            typing_speed,
            speed_change,
            hold_ratio,
            typing_jerk,
        ],
        dim=-1,
    )

    return features
