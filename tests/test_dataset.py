"""Tests for MouseTrajectoryDataset with multiple data formats."""

import json
import os
import tempfile

import numpy as np
import pytest
import torch

from mouse_trajectory_gan.config import Config
from mouse_trajectory_gan.data.dataset import (
    MouseTrajectoryDataset,
    collate_trajectories,
)


def _make_config() -> Config:
    config = Config()
    config.min_trajectory_length = 5
    config.max_trajectory_length = 200
    config.screen_width = 1920.0
    config.screen_height = 1080.0
    return config


def _make_rust_csv(path: str, num_trajectories: int = 3) -> None:
    """Create a sample Rust collector CSV file."""
    with open(path, "w") as f:
        f.write("position_x,position_y,time_between_movements,total_duration\n")
        for traj_idx in range(num_trajectories):
            base_x = 100.0 + traj_idx * 200
            base_y = 100.0 + traj_idx * 100
            total = 0.0
            for i in range(20):
                dt = 0.01 if i > 0 else 0.0
                total += dt
                x = base_x + i * 10.0
                y = base_y + i * 5.0
                f.write(f"{x},{y},{dt},{total}\n")
            # Reset marker for next trajectory
            if traj_idx < num_trajectories - 1:
                f.write(f"{base_x + 200},{base_y + 100},0.0,0.0\n")


def _make_kaggle_json(path: str, num_trajectories: int = 5) -> None:
    """Create a sample Kaggle JSON file mimicking the real format."""
    data = []
    for traj_idx in range(num_trajectories):
        base_ts = 1730225180000 + traj_idx * 10000
        base_x = 100 + traj_idx * 50
        base_y = 200 + traj_idx * 30
        path_points = []
        for i in range(15):
            path_points.append({
                "x": base_x + i * 10,
                "y": base_y + int(i * 5 * np.sin(i * 0.5)),
                "timestamp": base_ts + i * 8,  # ~8ms between points
            })
        data.append({
            "_id": {"$oid": f"672124{traj_idx:04d}"},
            "start": path_points[0],
            "end": path_points[-1],
            "path": path_points,
        })
    with open(path, "w") as f:
        json.dump(data, f)


def _make_iographica_png(path: str) -> None:
    """Create a simple test IOGraphica-like image with drawn paths."""
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (800, 600), (0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Draw a simple line trajectory
    points = [(50 + i * 10, 300 + int(50 * np.sin(i * 0.3))) for i in range(50)]
    draw.line(points, fill=(0, 255, 0), width=2)
    # Draw another trajectory
    points2 = [(400 + i * 5, 100 + i * 8) for i in range(40)]
    draw.line(points2, fill=(255, 0, 255), width=2)
    img.save(path)


class TestKaggleJsonLoading:
    def test_load_kaggle_json_basic(self):
        config = _make_config()
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
            _make_kaggle_json(f.name, num_trajectories=5)
            tmp_path = f.name

        try:
            dataset = MouseTrajectoryDataset(tmp_path, config, augment=False)
            assert len(dataset) == 5
        finally:
            os.unlink(tmp_path)

    def test_load_kaggle_json_with_augmentation(self):
        config = _make_config()
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
            _make_kaggle_json(f.name, num_trajectories=5)
            tmp_path = f.name

        try:
            dataset = MouseTrajectoryDataset(tmp_path, config, augment=True)
            # 5 base + 3*5 augmented = 20
            assert len(dataset) == 20
        finally:
            os.unlink(tmp_path)

    def test_kaggle_json_trajectory_format(self):
        config = _make_config()
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
            _make_kaggle_json(f.name, num_trajectories=1)
            tmp_path = f.name

        try:
            dataset = MouseTrajectoryDataset(tmp_path, config, augment=False)
            item = dataset[0]

            assert "start" in item
            assert "end" in item
            assert "deltas" in item
            assert "dts" in item
            assert "length" in item

            assert item["start"].shape == (2,)
            assert item["end"].shape == (2,)
            assert item["deltas"].shape[1] == 2
            assert item["dts"].shape[0] == item["deltas"].shape[0]
            assert item["length"] == item["deltas"].shape[0]

            # All dts should be positive
            assert (item["dts"] > 0).all()
        finally:
            os.unlink(tmp_path)

    def test_kaggle_json_normalization(self):
        config = _make_config()
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
            _make_kaggle_json(f.name, num_trajectories=1)
            tmp_path = f.name

        try:
            dataset = MouseTrajectoryDataset(tmp_path, config, normalize=True, augment=False)
            item = dataset[0]

            # Normalized coordinates should be in [0, 1] range
            assert item["start"][0] >= 0 and item["start"][0] <= 1
            assert item["start"][1] >= 0 and item["start"][1] <= 1
        finally:
            os.unlink(tmp_path)

    def test_kaggle_json_timestamp_conversion(self):
        """Verify timestamps are correctly converted from ms to seconds."""
        config = _make_config()
        # Create JSON with known timestamps
        data = [{
            "_id": {"$oid": "test"},
            "start": {"x": 100, "y": 200, "timestamp": 1000},
            "end": {"x": 200, "y": 300, "timestamp": 1100},
            "path": [
                {"x": 100, "y": 200, "timestamp": 1000},
                {"x": 110, "y": 210, "timestamp": 1010},
                {"x": 120, "y": 220, "timestamp": 1020},
                {"x": 130, "y": 230, "timestamp": 1030},
                {"x": 140, "y": 240, "timestamp": 1040},
                {"x": 150, "y": 250, "timestamp": 1050},
                {"x": 160, "y": 260, "timestamp": 1060},
            ],
        }]
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
            json.dump(data, f)
            tmp_path = f.name

        try:
            dataset = MouseTrajectoryDataset(
                tmp_path, config, normalize=False, augment=False
            )
            item = dataset[0]
            # dt should be 10ms = 0.01s between each point
            expected_dt = 0.01
            for dt_val in item["dts"]:
                assert abs(dt_val.item() - expected_dt) < 1e-5
        finally:
            os.unlink(tmp_path)

    def test_kaggle_json_skips_invalid_entries(self):
        """Entries without path or with empty path should be skipped."""
        config = _make_config()
        data = [
            {"_id": {"$oid": "no_path"}},  # Missing path
            {"_id": {"$oid": "empty_path"}, "path": []},  # Empty path
            {  # Valid
                "_id": {"$oid": "valid"},
                "start": {"x": 0, "y": 0, "timestamp": 0},
                "end": {"x": 100, "y": 100, "timestamp": 100},
                "path": [
                    {"x": i * 10, "y": i * 10, "timestamp": i * 10}
                    for i in range(10)
                ],
            },
        ]
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
            json.dump(data, f)
            tmp_path = f.name

        try:
            dataset = MouseTrajectoryDataset(tmp_path, config, augment=False)
            assert len(dataset) == 1
        finally:
            os.unlink(tmp_path)


class TestRustCsvLoading:
    def test_load_csv_basic(self):
        config = _make_config()
        with tempfile.NamedTemporaryFile(suffix=".csv", mode="w", delete=False) as f:
            _make_rust_csv(f.name, num_trajectories=3)
            tmp_path = f.name

        try:
            dataset = MouseTrajectoryDataset(tmp_path, config, augment=False)
            assert len(dataset) == 3
        finally:
            os.unlink(tmp_path)

    def test_load_csv_with_augmentation(self):
        config = _make_config()
        with tempfile.NamedTemporaryFile(suffix=".csv", mode="w", delete=False) as f:
            _make_rust_csv(f.name, num_trajectories=2)
            tmp_path = f.name

        try:
            dataset = MouseTrajectoryDataset(tmp_path, config, augment=True)
            assert len(dataset) == 8  # 2 * 4
        finally:
            os.unlink(tmp_path)


class TestIOGraphicaLoading:
    def test_load_iographica_basic(self):
        config = _make_config()
        config.min_trajectory_length = 3  # Lower for small test images
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            _make_iographica_png(f.name)
            tmp_path = f.name

        try:
            dataset = MouseTrajectoryDataset(tmp_path, config, augment=False)
            # Should extract at least 1 trajectory from the test image
            assert len(dataset) >= 1
        finally:
            os.unlink(tmp_path)

    def test_iographica_trajectory_format(self):
        config = _make_config()
        config.min_trajectory_length = 3
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            _make_iographica_png(f.name)
            tmp_path = f.name

        try:
            dataset = MouseTrajectoryDataset(tmp_path, config, augment=False)
            if len(dataset) > 0:
                item = dataset[0]
                assert "start" in item
                assert "end" in item
                assert "deltas" in item
                assert "dts" in item
                assert item["start"].shape == (2,)
                assert item["deltas"].shape[1] == 2
                assert (item["dts"] > 0).all()
        finally:
            os.unlink(tmp_path)


class TestDirectoryLoading:
    def test_load_mixed_directory(self):
        config = _make_config()
        with tempfile.TemporaryDirectory() as tmpdir:
            _make_rust_csv(os.path.join(tmpdir, "data.csv"), num_trajectories=2)
            _make_kaggle_json(os.path.join(tmpdir, "kaggle.json"), num_trajectories=3)

            dataset = MouseTrajectoryDataset(tmpdir, config, augment=False)
            assert len(dataset) == 5  # 2 CSV + 3 JSON

    def test_empty_directory_raises(self):
        config = _make_config()
        with tempfile.TemporaryDirectory() as tmpdir:
            with pytest.raises(FileNotFoundError, match="No supported files"):
                MouseTrajectoryDataset(tmpdir, config)

    def test_nonexistent_path_raises(self):
        config = _make_config()
        with pytest.raises(FileNotFoundError, match="does not exist"):
            MouseTrajectoryDataset("/nonexistent/path", config)


class TestAugmentation:
    def test_augmentation_preserves_trajectory_properties(self):
        config = _make_config()
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
            _make_kaggle_json(f.name, num_trajectories=1)
            tmp_path = f.name

        try:
            dataset = MouseTrajectoryDataset(tmp_path, config, augment=True)
            # 1 original + 3 augmented = 4
            assert len(dataset) == 4

            original = dataset[0]
            h_flip = dataset[1]
            v_flip = dataset[2]
            both_flip = dataset[3]

            # All should have same length
            assert original["length"] == h_flip["length"]
            assert original["length"] == v_flip["length"]
            assert original["length"] == both_flip["length"]

            # All dts should be identical (flipping doesn't change timing)
            torch.testing.assert_close(original["dts"], h_flip["dts"])
            torch.testing.assert_close(original["dts"], v_flip["dts"])
            torch.testing.assert_close(original["dts"], both_flip["dts"])

            # Horizontal flip: x negated, y unchanged
            torch.testing.assert_close(h_flip["deltas"][:, 0], -original["deltas"][:, 0])
            torch.testing.assert_close(h_flip["deltas"][:, 1], original["deltas"][:, 1])

            # Vertical flip: x unchanged, y negated
            torch.testing.assert_close(v_flip["deltas"][:, 0], original["deltas"][:, 0])
            torch.testing.assert_close(v_flip["deltas"][:, 1], -original["deltas"][:, 1])

            # Both flip: both negated
            torch.testing.assert_close(both_flip["deltas"], -original["deltas"])
        finally:
            os.unlink(tmp_path)


class TestCollation:
    def test_collate_trajectories(self):
        config = _make_config()
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
            _make_kaggle_json(f.name, num_trajectories=4)
            tmp_path = f.name

        try:
            dataset = MouseTrajectoryDataset(tmp_path, config, augment=False)
            batch = [dataset[i] for i in range(min(4, len(dataset)))]
            collated = collate_trajectories(batch)

            assert "starts" in collated
            assert "ends" in collated
            assert "sequences" in collated
            assert "lengths" in collated

            batch_size = len(batch)
            assert collated["starts"].shape == (batch_size, 2)
            assert collated["ends"].shape == (batch_size, 2)
            assert collated["sequences"].shape[0] == batch_size
            assert collated["sequences"].shape[2] == 3  # (dx, dy, dt)
            assert collated["lengths"].shape == (batch_size,)

            # Sorted by length descending
            for i in range(batch_size - 1):
                assert collated["lengths"][i] >= collated["lengths"][i + 1]
        finally:
            os.unlink(tmp_path)


class TestTraceSkeletonPath:
    def test_simple_line(self):
        """A straight line of points should be traced in order."""
        # Create a simple horizontal line
        mask = np.zeros((10, 100), dtype=bool)
        mask[5, 10:60] = True

        ys, xs = np.where(mask)
        points = np.column_stack([xs, ys]).astype(np.float32)

        ordered = MouseTrajectoryDataset._trace_skeleton_path(points, mask)
        assert len(ordered) == 50

        # Points should be mostly consecutive (within 2 pixels)
        dists = np.sqrt(np.sum(np.diff(ordered, axis=0) ** 2, axis=1))
        assert np.all(dists <= 2.0)

    def test_short_path(self):
        """Paths with 2 or fewer points should be returned as-is."""
        mask = np.zeros((10, 10), dtype=bool)
        points = np.array([[3.0, 4.0], [5.0, 6.0]])
        result = MouseTrajectoryDataset._trace_skeleton_path(points, mask)
        assert len(result) == 2
