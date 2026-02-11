#!/usr/bin/env python3
"""CLI script for generating mouse trajectories from a trained model."""

import argparse
import logging
import sys

import matplotlib.pyplot as plt
import numpy as np

from mouse_trajectory_gan.inference import TrajectoryGenerator


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate mouse trajectories from a trained WGAN-GP model"
    )

    parser.add_argument(
        "--checkpoint",
        type=str,
        required=True,
        help="Path to trained model checkpoint",
    )
    parser.add_argument(
        "--start",
        type=str,
        default="100,500",
        help='Start point as "x,y" pixel coordinates',
    )
    parser.add_argument(
        "--end",
        type=str,
        default="800,300",
        help='End point as "x,y" pixel coordinates',
    )
    parser.add_argument("--num_samples", type=int, default=5)
    parser.add_argument("--output", type=str, default="generated_trajectory.png")
    parser.add_argument("--device", type=str, default=None)

    return parser.parse_args()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    args = parse_args()

    try:
        start = tuple(float(x) for x in args.start.split(","))
        end = tuple(float(x) for x in args.end.split(","))
    except ValueError:
        logging.error("Invalid coordinate format. Use 'x,y' (e.g., '100,500')")
        sys.exit(1)

    if len(start) != 2 or len(end) != 2:
        logging.error("Coordinates must be 2D (x,y)")
        sys.exit(1)

    gen = TrajectoryGenerator.from_checkpoint(args.checkpoint, device=args.device)

    logging.info("Generating %d trajectories from %s to %s", args.num_samples, start, end)

    trajectories = gen.generate(start=start, end=end, num_samples=args.num_samples)

    for i, traj in enumerate(trajectories):
        total_time = traj.timestamps[-1] if traj.num_points > 1 else 0.0
        logging.info(
            "Trajectory %d: %d points, %.3fs total time, "
            "start=(%.1f, %.1f), end=(%.1f, %.1f)",
            i + 1,
            traj.num_points,
            total_time,
            traj.positions[0, 0],
            traj.positions[0, 1],
            traj.positions[-1, 0],
            traj.positions[-1, 1],
        )

    # Visualize all trajectories
    fig, ax = plt.subplots(figsize=(10, 6))

    colors = plt.cm.viridis(np.linspace(0, 1, len(trajectories)))
    for i, traj in enumerate(trajectories):
        ax.plot(
            traj.positions[:, 0],
            traj.positions[:, 1],
            color=colors[i],
            linewidth=1.5,
            alpha=0.7,
            label=f"Sample {i + 1}",
        )

    ax.scatter([start[0]], [start[1]], c="green", s=100, marker="o", label="Start", zorder=5)
    ax.scatter([end[0]], [end[1]], c="red", s=100, marker="x", label="End", zorder=5)
    ax.legend()
    ax.set_title("Generated Mouse Trajectories")
    ax.set_xlabel("X")
    ax.set_ylabel("Y")
    ax.invert_yaxis()
    ax.set_xlim(0, gen.config.screen_width)
    ax.set_ylim(gen.config.screen_height, 0)

    plt.tight_layout()
    plt.savefig(args.output, dpi=150, bbox_inches="tight")
    logging.info("Saved visualization to %s", args.output)
    plt.close()


if __name__ == "__main__":
    main()
