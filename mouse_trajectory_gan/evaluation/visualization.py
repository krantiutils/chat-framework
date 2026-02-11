"""Visualization utilities for trajectory comparison."""

from typing import Optional

import matplotlib.pyplot as plt
import numpy as np


def visualize_trajectory(
    real_trajectory: np.ndarray,
    fake_trajectory: np.ndarray,
    start: np.ndarray,
    end: np.ndarray,
    save_path: Optional[str] = None,
) -> None:
    """
    Visualize real vs generated trajectory with velocity and curvature profiles.

    Args:
        real_trajectory: (N, 2) array of real positions.
        fake_trajectory: (M, 2) array of generated positions.
        start: (2,) start position.
        end: (2,) end position.
        save_path: If provided, saves the figure to this path.
    """
    fig, axes = plt.subplots(1, 3, figsize=(15, 5))

    # Trajectory plot
    ax = axes[0]
    ax.plot(real_trajectory[:, 0], real_trajectory[:, 1], "b-", label="Real", linewidth=2)
    ax.plot(
        fake_trajectory[:, 0],
        fake_trajectory[:, 1],
        "r--",
        label="Generated",
        linewidth=2,
    )
    ax.scatter([start[0]], [start[1]], c="green", s=100, marker="o", label="Start", zorder=5)
    ax.scatter([end[0]], [end[1]], c="red", s=100, marker="x", label="End", zorder=5)
    ax.legend()
    ax.set_title("Trajectory Comparison")
    ax.set_xlabel("X")
    ax.set_ylabel("Y")
    ax.invert_yaxis()

    # Velocity profile
    ax = axes[1]
    real_vel = np.sqrt(
        np.diff(real_trajectory[:, 0]) ** 2 + np.diff(real_trajectory[:, 1]) ** 2
    )
    fake_vel = np.sqrt(
        np.diff(fake_trajectory[:, 0]) ** 2 + np.diff(fake_trajectory[:, 1]) ** 2
    )
    ax.plot(real_vel, "b-", label="Real")
    ax.plot(fake_vel, "r--", label="Generated")
    ax.legend()
    ax.set_title("Velocity Profile")
    ax.set_xlabel("Time Step")
    ax.set_ylabel("Velocity")

    # Curvature profile
    ax = axes[2]

    def _compute_curvature(traj: np.ndarray) -> np.ndarray:
        if len(traj) < 3:
            return np.array([0.0])
        v = np.diff(traj, axis=0)
        a = np.diff(v, axis=0)
        cross = np.abs(v[:-1, 0] * a[:, 1] - v[:-1, 1] * a[:, 0])
        speed = np.sqrt(v[:-1, 0] ** 2 + v[:-1, 1] ** 2) + 1e-8
        return cross / speed**3

    ax.plot(_compute_curvature(real_trajectory), "b-", label="Real")
    ax.plot(_compute_curvature(fake_trajectory), "r--", label="Generated")
    ax.legend()
    ax.set_title("Curvature Profile")
    ax.set_xlabel("Time Step")
    ax.set_ylabel("Curvature")

    plt.tight_layout()

    if save_path:
        plt.savefig(save_path, dpi=150, bbox_inches="tight")
    else:
        plt.show()

    plt.close(fig)
