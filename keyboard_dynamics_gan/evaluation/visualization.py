"""Visualization utilities for keystroke dynamics."""

from typing import Optional

import matplotlib.pyplot as plt
import numpy as np


def plot_timing_comparison(
    real_hold: np.ndarray,
    real_flight: np.ndarray,
    gen_hold: np.ndarray,
    gen_flight: np.ndarray,
    title: str = "Keystroke Timing Comparison",
    save_path: Optional[str] = None,
) -> plt.Figure:
    """
    Plot real vs generated keystroke timings side by side.

    Args:
        real_hold: (N,) real hold times.
        real_flight: (N,) real flight times.
        gen_hold: (N,) generated hold times.
        gen_flight: (N,) generated flight times.
        title: Plot title.
        save_path: If given, saves the figure to this path.

    Returns:
        The matplotlib Figure.
    """
    n = len(real_hold)
    x = np.arange(n)

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 6), sharex=True)

    ax1.bar(x - 0.15, real_hold, width=0.3, label="Real", alpha=0.7, color="steelblue")
    ax1.bar(x + 0.15, gen_hold, width=0.3, label="Generated", alpha=0.7, color="salmon")
    ax1.set_ylabel("Hold time (s)")
    ax1.legend()
    ax1.set_title(title)

    ax2.bar(
        x - 0.15, real_flight, width=0.3, label="Real", alpha=0.7, color="steelblue"
    )
    ax2.bar(
        x + 0.15, gen_flight, width=0.3, label="Generated", alpha=0.7, color="salmon"
    )
    ax2.set_ylabel("Flight time (s)")
    ax2.set_xlabel("Keystroke index")
    ax2.legend()

    plt.tight_layout()

    if save_path:
        fig.savefig(save_path, dpi=150, bbox_inches="tight")

    return fig


def plot_speed_profile(
    hold_times: np.ndarray,
    flight_times: np.ndarray,
    title: str = "Typing Speed Profile",
    save_path: Optional[str] = None,
) -> plt.Figure:
    """
    Plot the instantaneous typing speed over a keystroke sequence.

    Args:
        hold_times: (N,) hold durations in seconds.
        flight_times: (N,) flight durations in seconds.
        title: Plot title.
        save_path: If given, saves the figure to this path.

    Returns:
        The matplotlib Figure.
    """
    digraph = hold_times + flight_times
    speed = 1.0 / (digraph + 1e-8)

    fig, ax = plt.subplots(figsize=(12, 4))
    ax.plot(speed, marker="o", markersize=3, linewidth=1.2, color="steelblue")
    ax.set_ylabel("Keystrokes / sec")
    ax.set_xlabel("Keystroke index")
    ax.set_title(title)
    ax.grid(True, alpha=0.3)

    plt.tight_layout()

    if save_path:
        fig.savefig(save_path, dpi=150, bbox_inches="tight")

    return fig
