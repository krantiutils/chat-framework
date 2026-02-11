"""Dataset for mouse trajectory data from the Rust collector CSV format."""

import csv
import logging
from pathlib import Path
from typing import Dict, List

import numpy as np
import torch
from torch.nn.utils.rnn import pad_sequence
from torch.utils.data import Dataset

from mouse_trajectory_gan.config import Config

logger = logging.getLogger(__name__)


class MouseTrajectoryDataset(Dataset):
    """
    Dataset for mouse trajectory data.

    Parses CSV files produced by the Rust mouse-telemetry collector.
    Segments trajectories on total_duration == 0 resets and extracts
    (dx, dy, dt) sequences with start/end points.

    Supports 4x data augmentation via mirroring (horizontal, vertical, both).
    """

    def __init__(
        self,
        data_path: str,
        config: Config,
        normalize: bool = True,
        augment: bool = True,
    ):
        self.config = config
        self.normalize = normalize
        self.augment = augment
        self.trajectories: List[Dict] = []

        data_path = Path(data_path)
        if data_path.is_file():
            csv_files = [data_path]
        else:
            csv_files = sorted(data_path.glob("*.csv"))

        if not csv_files:
            raise FileNotFoundError(f"No CSV files found at {data_path}")

        for csv_file in csv_files:
            self._load_csv(csv_file)

        base_count = len(self.trajectories)

        if self.augment:
            self._augment_trajectories()

        logger.info(
            "Loaded %d base trajectories from %d files", base_count, len(csv_files)
        )
        if self.augment:
            logger.info(
                "After augmentation: %d trajectories (4x via mirroring)",
                len(self.trajectories),
            )

    def _load_csv(self, csv_path: Path) -> None:
        """Load and segment trajectories from a CSV file."""
        with open(csv_path, "r") as f:
            reader = csv.DictReader(f)

            current_trajectory: List[Dict] = []

            for row in reader:
                total_duration = float(row["total_duration"])

                # total_duration resets to 0 at the start of each batch
                if total_duration == 0 and len(current_trajectory) > 0:
                    self._process_trajectory(current_trajectory)
                    current_trajectory = []

                current_trajectory.append(
                    {
                        "x": float(row["position_x"]),
                        "y": float(row["position_y"]),
                        "dt": float(row["time_between_movements"]),
                    }
                )

            if len(current_trajectory) > 0:
                self._process_trajectory(current_trajectory)

    def _process_trajectory(self, points: List[Dict]) -> None:
        """Process a raw trajectory into training format (dx, dy, dt)."""
        if len(points) < self.config.min_trajectory_length:
            return
        if len(points) > self.config.max_trajectory_length:
            points = points[: self.config.max_trajectory_length]

        positions = np.array([[p["x"], p["y"]] for p in points], dtype=np.float32)
        dts = np.array([p["dt"] for p in points], dtype=np.float32)

        # Deltas between consecutive points
        deltas = np.diff(positions, axis=0)
        dts = dts[1:]  # dt[i] = time to move from point i-1 to point i
        dts = np.maximum(dts, 1e-6)

        if self.normalize:
            screen = np.array(
                [self.config.screen_width, self.config.screen_height],
                dtype=np.float32,
            )
            start = positions[0] / screen
            end = positions[-1] / screen
            deltas = deltas / screen
        else:
            start = positions[0]
            end = positions[-1]

        self.trajectories.append(
            {
                "start": torch.tensor(start, dtype=torch.float32),
                "end": torch.tensor(end, dtype=torch.float32),
                "deltas": torch.tensor(deltas, dtype=torch.float32),
                "dts": torch.tensor(dts, dtype=torch.float32),
                "length": len(deltas),
            }
        )

    def _augment_trajectories(self) -> None:
        """
        Augment via mirroring to cover all movement directions.

        Creates 3 additional versions of each trajectory:
        1. Horizontal flip (mirror across vertical axis)
        2. Vertical flip (mirror across horizontal axis)
        3. Both flips (180-degree rotation)
        """
        augmented = []

        for traj in self.trajectories:
            start = traj["start"]
            end = traj["end"]
            deltas = traj["deltas"]
            dts = traj["dts"]
            length = traj["length"]

            # Horizontal flip: negate x, mirror start/end x = 1 - x
            h_start = torch.tensor([1.0 - start[0].item(), start[1].item()])
            h_end = torch.tensor([1.0 - end[0].item(), end[1].item()])
            h_deltas = deltas.clone()
            h_deltas[:, 0] = -h_deltas[:, 0]
            augmented.append(
                {
                    "start": h_start,
                    "end": h_end,
                    "deltas": h_deltas,
                    "dts": dts.clone(),
                    "length": length,
                }
            )

            # Vertical flip: negate y, mirror start/end y = 1 - y
            v_start = torch.tensor([start[0].item(), 1.0 - start[1].item()])
            v_end = torch.tensor([end[0].item(), 1.0 - end[1].item()])
            v_deltas = deltas.clone()
            v_deltas[:, 1] = -v_deltas[:, 1]
            augmented.append(
                {
                    "start": v_start,
                    "end": v_end,
                    "deltas": v_deltas,
                    "dts": dts.clone(),
                    "length": length,
                }
            )

            # Both flips: negate both dx and dy
            b_start = torch.tensor(
                [1.0 - start[0].item(), 1.0 - start[1].item()]
            )
            b_end = torch.tensor([1.0 - end[0].item(), 1.0 - end[1].item()])
            augmented.append(
                {
                    "start": b_start,
                    "end": b_end,
                    "deltas": -deltas.clone(),
                    "dts": dts.clone(),
                    "length": length,
                }
            )

        self.trajectories.extend(augmented)

    def __len__(self) -> int:
        return len(self.trajectories)

    def __getitem__(self, idx: int) -> Dict:
        return self.trajectories[idx]


def collate_trajectories(batch: List[Dict]) -> Dict:
    """
    Collate variable-length trajectories into padded batches.

    Sorts by length (descending) for efficient pack_padded_sequence usage.
    Combines deltas and dts into (dx, dy, dt) sequences.
    """
    batch = sorted(batch, key=lambda x: x["length"], reverse=True)

    starts = torch.stack([item["start"] for item in batch])
    ends = torch.stack([item["end"] for item in batch])
    lengths = torch.tensor([item["length"] for item in batch])

    sequences = []
    for item in batch:
        seq = torch.cat([item["deltas"], item["dts"].unsqueeze(-1)], dim=-1)
        sequences.append(seq)

    padded_sequences = pad_sequence(sequences, batch_first=True, padding_value=0.0)

    return {
        "starts": starts,
        "ends": ends,
        "sequences": padded_sequences,
        "lengths": lengths,
    }
