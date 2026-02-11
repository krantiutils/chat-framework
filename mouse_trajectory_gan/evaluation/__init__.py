"""Evaluation metrics and visualization for generated trajectories."""

from mouse_trajectory_gan.evaluation.fitts import evaluate_fitts_compliance
from mouse_trajectory_gan.evaluation.visualization import visualize_trajectory

__all__ = ["evaluate_fitts_compliance", "visualize_trajectory"]
