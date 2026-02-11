"""Dataset for mouse trajectory data from multiple sources.

Supports:
- Rust collector CSV format (position_x, position_y, time_between_movements, total_duration)
- Kaggle JSON format (sameelarif/mouse-movement-between-ui-elements)
- IOGraphica PNG images (prashantmudgal/mouse-movement) via trajectory extraction
"""

import csv
import json
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

    Automatically detects the input format based on file extension:
    - .csv: Rust collector format (segmented on total_duration == 0)
    - .json: Kaggle JSON format (list of {start, end, path: [{x, y, timestamp}]})
    - .png: IOGraphica images (trajectory extraction via skeletonization)
    - directory: loads all supported files within

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
            self._load_file(data_path)
        elif data_path.is_dir():
            self._load_directory(data_path)
        else:
            raise FileNotFoundError(f"Data path does not exist: {data_path}")

        base_count = len(self.trajectories)

        if base_count == 0:
            raise ValueError(f"No valid trajectories loaded from {data_path}")

        if self.augment:
            self._augment_trajectories()

        logger.info("Loaded %d base trajectories", base_count)
        if self.augment:
            logger.info(
                "After augmentation: %d trajectories (4x via mirroring)",
                len(self.trajectories),
            )

    def _load_directory(self, dir_path: Path) -> None:
        """Load all supported files from a directory (recursively)."""
        supported = {".csv", ".json", ".png"}
        files = sorted(
            f for f in dir_path.rglob("*") if f.is_file() and f.suffix.lower() in supported
        )
        if not files:
            raise FileNotFoundError(
                f"No supported files (.csv, .json, .png) found in {dir_path}"
            )
        for f in files:
            self._load_file(f)

    def _load_file(self, file_path: Path) -> None:
        """Dispatch to the correct loader based on file extension."""
        suffix = file_path.suffix.lower()
        if suffix == ".csv":
            self._load_csv(file_path)
        elif suffix == ".json":
            self._load_kaggle_json(file_path)
        elif suffix == ".png":
            self._load_iographica(file_path)
        else:
            logger.warning("Unsupported file format: %s", file_path)

    def _load_csv(self, csv_path: Path) -> None:
        """Load and segment trajectories from a Rust collector CSV file."""
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

    def _load_kaggle_json(self, json_path: Path) -> None:
        """
        Load trajectories from the Kaggle mouse movement JSON format.

        Expected format: list of objects with:
        - start: {x, y, timestamp}
        - end: {x, y, timestamp}
        - path: [{x, y, timestamp}, ...]

        Timestamps are in milliseconds. Converted to seconds for dt values.

        Auto-detects screen resolution from coordinate bounds to ensure
        normalization maps all coordinates to [0, 1].
        """
        with open(json_path, "r") as f:
            data = json.load(f)

        if not isinstance(data, list):
            raise ValueError(f"Expected JSON array, got {type(data).__name__} in {json_path}")

        # First pass: detect coordinate bounds for proper normalization
        max_x = 0.0
        max_y = 0.0
        for item in data:
            path = item.get("path")
            if not path or not isinstance(path, list):
                continue
            for p in path:
                max_x = max(max_x, float(p["x"]))
                max_y = max(max_y, float(p["y"]))

        # Expand screen dimensions if data exceeds configured resolution
        if max_x > self.config.screen_width:
            logger.info(
                "Kaggle data max X (%.0f) exceeds screen_width (%.0f), adjusting",
                max_x,
                self.config.screen_width,
            )
            self.config.screen_width = float(max_x)
        if max_y > self.config.screen_height:
            logger.info(
                "Kaggle data max Y (%.0f) exceeds screen_height (%.0f), adjusting",
                max_y,
                self.config.screen_height,
            )
            self.config.screen_height = float(max_y)

        # Second pass: load trajectories
        loaded = 0
        skipped = 0
        for item in data:
            path = item.get("path")
            if not path or not isinstance(path, list):
                skipped += 1
                continue

            points = []
            prev_ts = None
            for p in path:
                ts = p["timestamp"]
                if prev_ts is None:
                    dt = 0.0
                else:
                    dt = (ts - prev_ts) / 1000.0  # ms -> seconds
                prev_ts = ts
                points.append({"x": float(p["x"]), "y": float(p["y"]), "dt": dt})

            self._process_trajectory(points)
            loaded += 1

        logger.info(
            "Loaded %d trajectories from Kaggle JSON (%d skipped): %s",
            loaded,
            skipped,
            json_path.name,
        )

    def _load_iographica(self, image_path: Path) -> None:
        """
        Extract trajectories from IOGraphica visualization images.

        IOGraphica renders mouse paths as colored lines on a black background
        with colored dots at pause points. This method:
        1. Thresholds to isolate non-black path pixels
        2. Skeletonizes to single-pixel-wide paths
        3. Traces connected components as ordered point sequences
        4. Synthesizes timing from inter-point distances

        The extracted trajectories are approximate since temporal ordering
        is lost in the visualization, but spatial path shapes are preserved.
        """
        try:
            from PIL import Image
            from scipy import ndimage
            from skimage.morphology import skeletonize
        except ImportError as e:
            logger.warning(
                "Cannot load IOGraphica images: missing dependency %s. "
                "Install with: pip install scikit-image scipy Pillow",
                e.name,
            )
            return

        img = Image.open(image_path).convert("RGB")

        # Downscale large images for performance (skeletonization is O(n*m))
        max_dim = 1024
        if max(img.size) > max_dim:
            scale = max_dim / max(img.size)
            new_size = (int(img.size[0] * scale), int(img.size[1] * scale))
            img = img.resize(new_size, Image.LANCZOS)

        img_array = np.array(img)

        # Convert to grayscale intensity (max channel to catch all colored lines)
        intensity = img_array.max(axis=2)

        # Threshold: anything above 30/255 is considered a path pixel
        binary = intensity > 30

        if binary.sum() < 50:
            logger.debug("Skipping near-empty image: %s", image_path.name)
            return

        # Skeletonize to get single-pixel-wide paths
        skeleton = skeletonize(binary)

        # Label connected components in the skeleton
        labeled, num_components = ndimage.label(skeleton)

        # Precompute neighbor map once for the entire skeleton (vectorized)
        neighbor_map = self._count_skeleton_neighbors(skeleton)

        img_h, img_w = skeleton.shape
        extracted = 0

        # Max points per component to trace (larger components are too
        # tangled from overlapping paths and too slow for O(n²) tracing)
        max_component_points = 500

        # Get all skeleton pixel locations at once (avoids repeated per-component
        # mask comparison which is the main bottleneck)
        all_ys, all_xs = np.where(skeleton)
        all_labels = labeled[all_ys, all_xs]

        # Group pixels by component label using argsort
        sort_idx = np.argsort(all_labels)
        sorted_labels = all_labels[sort_idx]
        sorted_xs = all_xs[sort_idx]
        sorted_ys = all_ys[sort_idx]

        # Find boundaries between components
        label_changes = np.where(np.diff(sorted_labels))[0] + 1
        boundaries = np.concatenate([[0], label_changes, [len(sorted_labels)]])

        for comp_idx in range(len(boundaries) - 1):
            start_i = boundaries[comp_idx]
            end_i = boundaries[comp_idx + 1]
            component_size = end_i - start_i

            if component_size < self.config.min_trajectory_length:
                continue
            if component_size > max_component_points:
                continue

            comp_xs = sorted_xs[start_i:end_i]
            comp_ys = sorted_ys[start_i:end_i]

            # Build per-component mask from the points
            component_mask = np.zeros_like(skeleton)
            component_mask[comp_ys, comp_xs] = True

            # Order points by tracing from one endpoint
            points_xy = np.column_stack([comp_xs, comp_ys]).astype(np.float32)
            ordered = self._trace_skeleton_path(
                points_xy, component_mask, neighbor_map
            )

            if len(ordered) < self.config.min_trajectory_length:
                continue

            # Synthesize timing: assume constant mouse polling at ~8ms between
            # points, adjusted by inter-point pixel distance
            distances = np.sqrt(np.sum(np.diff(ordered, axis=0) ** 2, axis=1))
            # Scale: 1 pixel distance ~ 1ms, clamped to realistic range
            dts = np.clip(distances * 0.001, 1e-4, 0.1)

            points = []
            for pt_idx, (x, y) in enumerate(ordered):
                # Scale image coordinates to screen resolution
                screen_x = (x / img_w) * self.config.screen_width
                screen_y = (y / img_h) * self.config.screen_height
                dt = 0.0 if pt_idx == 0 else float(dts[pt_idx - 1])
                points.append({"x": screen_x, "y": screen_y, "dt": dt})

            self._process_trajectory(points)
            extracted += 1

        logger.info(
            "Extracted %d trajectories from IOGraphica image: %s",
            extracted,
            image_path.name,
        )

    @staticmethod
    def _count_skeleton_neighbors(mask: np.ndarray) -> np.ndarray:
        """
        Count 8-connected skeleton neighbors for each pixel using convolution.

        Returns a 2D array where each skeleton pixel has its neighbor count.
        Non-skeleton pixels are 0.
        """
        from scipy.signal import convolve2d

        kernel = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], dtype=np.int32)
        neighbor_map = convolve2d(
            mask.astype(np.int32), kernel, mode="same", boundary="fill", fillvalue=0
        )
        # Zero out non-skeleton pixels
        neighbor_map[~mask] = 0
        return neighbor_map

    @staticmethod
    def _trace_skeleton_path(
        points: np.ndarray,
        mask: np.ndarray,
        neighbor_map: np.ndarray = None,
    ) -> np.ndarray:
        """
        Order skeleton points by tracing the path from one endpoint.

        Uses nearest-neighbor traversal starting from the point with
        the fewest skeleton neighbors (an endpoint). This produces a
        reasonable ordering even for complex paths.

        Args:
            points: (N, 2) array of (x, y) coordinates
            mask: 2D boolean skeleton mask
            neighbor_map: precomputed neighbor counts (optional, for performance)

        Returns:
            Ordered (M, 2) array of (x, y) coordinates
        """
        if len(points) <= 2:
            return points

        n = len(points)

        # Look up neighbor counts from precomputed map (vectorized)
        if neighbor_map is not None:
            xs = points[:, 0].astype(int)
            ys = points[:, 1].astype(int)
            neighbor_counts = neighbor_map[ys, xs]
        else:
            from scipy.signal import convolve2d

            kernel = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], dtype=np.int32)
            nmap = convolve2d(
                mask.astype(np.int32), kernel, mode="same", boundary="fill", fillvalue=0
            )
            xs = points[:, 0].astype(int)
            ys = points[:, 1].astype(int)
            neighbor_counts = nmap[ys, xs]

        # Start from a point with exactly 1 neighbor (endpoint), or minimum
        endpoints = np.where(neighbor_counts == 1)[0]
        if len(endpoints) > 0:
            start_idx = endpoints[0]
        else:
            start_idx = np.argmin(neighbor_counts)

        # Greedy nearest-neighbor traversal
        visited = np.zeros(n, dtype=bool)
        order = [start_idx]
        visited[start_idx] = True

        current = start_idx
        for _ in range(n - 1):
            dists = np.sum((points - points[current]) ** 2, axis=1)
            dists[visited] = np.inf
            nearest = np.argmin(dists)
            if dists[nearest] == np.inf:
                break
            # Stop if the nearest unvisited point is too far (disconnected jump)
            if dists[nearest] > 8.0:  # sqrt(8) ~ 2.8 pixels
                break
            order.append(nearest)
            visited[nearest] = True
            current = nearest

        return points[order]

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
