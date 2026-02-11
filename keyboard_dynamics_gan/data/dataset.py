"""Dataset for keystroke dynamics from the CMU Keystroke Dynamics Benchmark."""

import csv
import logging
from pathlib import Path
from typing import Dict, List

import numpy as np
import torch
from torch.nn.utils.rnn import pad_sequence
from torch.utils.data import Dataset

from keyboard_dynamics_gan.config import Config

logger = logging.getLogger(__name__)

# The fixed password in the CMU benchmark dataset.
CMU_PASSWORD = ".tie5Roanl"

# Column-name fragments used to locate hold-time and flight-time values
# in the CMU CSV header.  The benchmark records timing for each key and
# each consecutive key-pair of the password ".tie5Roanl" plus Return.
CMU_HOLD_KEYS = [
    "H.period",
    "H.t",
    "H.i",
    "H.e",
    "H.five",
    "H.Shift.r",
    "H.o",
    "H.a",
    "H.n",
    "H.l",
    "H.Return",
]

CMU_FLIGHT_KEYS = [
    "UD.period.t",
    "UD.t.i",
    "UD.i.e",
    "UD.e.five",
    "UD.five.Shift.r",
    "UD.Shift.r.o",
    "UD.o.a",
    "UD.a.n",
    "UD.n.l",
    "UD.l.Return",
]

# Characters corresponding to CMU_HOLD_KEYS (ASCII IDs used by the model).
CMU_CHAR_SEQUENCE = [
    ord("."),
    ord("t"),
    ord("i"),
    ord("e"),
    ord("5"),
    ord("R"),
    ord("o"),
    ord("a"),
    ord("n"),
    ord("l"),
    ord("\n"),
]


class KeystrokeDataset(Dataset):
    """
    Dataset for keystroke dynamics.

    Supports two CSV layouts:

    1. **CMU format** – the CMU Keystroke Dynamics Benchmark with columns
       ``subject``, ``sessionIndex``, ``rep``, and per-key timing columns
       such as ``H.period``, ``UD.period.t``, etc.

    2. **Generic format** – a simpler columnar CSV with one row per
       keystroke: ``subject``, ``session``, ``char``, ``hold_time``,
       ``flight_time``.  Sequences are grouped by ``(subject, session)``.

    The format is auto-detected from the CSV header.
    """

    def __init__(
        self,
        data_path: str,
        config: Config,
        augment: bool = True,
    ):
        self.config = config
        self.augment = augment
        self.sequences: List[Dict] = []

        data_path = Path(data_path)
        if data_path.is_file():
            csv_files = [data_path]
        else:
            csv_files = sorted(data_path.glob("*.csv"))

        if not csv_files:
            raise FileNotFoundError(f"No CSV files found at {data_path}")

        for csv_file in csv_files:
            self._load_csv(csv_file)

        base_count = len(self.sequences)

        if self.augment:
            self._augment_sequences()

        logger.info(
            "Loaded %d base sequences from %d files", base_count, len(csv_files)
        )
        if self.augment:
            logger.info(
                "After augmentation: %d sequences (2x via speed jitter)",
                len(self.sequences),
            )

    # ------------------------------------------------------------------
    # CSV loading
    # ------------------------------------------------------------------

    def _load_csv(self, csv_path: Path) -> None:
        """Auto-detect format and load a single CSV."""
        with open(csv_path, "r") as f:
            reader = csv.DictReader(f)
            headers = reader.fieldnames or []

            if any(h.startswith("H.") for h in headers):
                self._load_cmu(reader)
            else:
                self._load_generic(reader, headers)

    def _load_cmu(self, reader: csv.DictReader) -> None:
        """Load rows in CMU Keystroke Dynamics Benchmark format."""
        for row in reader:
            hold_times = []
            for key in CMU_HOLD_KEYS:
                value = row.get(key)
                if value is None:
                    break
                hold_times.append(float(value))

            flight_times = []
            for key in CMU_FLIGHT_KEYS:
                value = row.get(key)
                if value is None:
                    break
                flight_times.append(float(value))

            if len(hold_times) != len(CMU_HOLD_KEYS):
                continue
            if len(flight_times) != len(CMU_FLIGHT_KEYS):
                continue

            # Last character has no following flight time
            flight_times.append(0.0)

            self._add_sequence(
                char_ids=CMU_CHAR_SEQUENCE,
                hold_times=hold_times,
                flight_times=flight_times,
            )

    def _load_generic(
        self, reader: csv.DictReader, headers: List[str]
    ) -> None:
        """
        Load rows in generic per-keystroke format.

        Expected columns: subject, session, char, hold_time, flight_time.
        Rows sharing the same (subject, session) form one sequence.
        """
        required = {"char", "hold_time", "flight_time"}
        if not required.issubset(headers):
            raise ValueError(
                f"Generic format requires columns {required}, got {headers}"
            )

        groups: Dict[str, List[Dict]] = {}
        for row in reader:
            key = f"{row.get('subject', '0')}_{row.get('session', '0')}"
            groups.setdefault(key, []).append(row)

        for keystrokes in groups.values():
            char_ids = [ord(ks["char"][0]) for ks in keystrokes]
            hold_times = [float(ks["hold_time"]) for ks in keystrokes]
            flight_times = [float(ks["flight_time"]) for ks in keystrokes]
            self._add_sequence(char_ids, hold_times, flight_times)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _add_sequence(
        self,
        char_ids: List[int],
        hold_times: List[float],
        flight_times: List[float],
    ) -> None:
        """Validate and store a single keystroke sequence."""
        length = len(char_ids)
        if length < self.config.min_sequence_length:
            return
        if length > self.config.max_sequence_length:
            char_ids = char_ids[: self.config.max_sequence_length]
            hold_times = hold_times[: self.config.max_sequence_length]
            flight_times = flight_times[: self.config.max_sequence_length]
            length = self.config.max_sequence_length

        hold_arr = np.array(hold_times, dtype=np.float32)
        flight_arr = np.array(flight_times, dtype=np.float32)

        # Clamp negative timings (can appear in noisy data)
        hold_arr = np.maximum(hold_arr, 0.0)
        flight_arr = np.maximum(flight_arr, 0.0)

        self.sequences.append(
            {
                "char_ids": torch.tensor(char_ids, dtype=torch.long),
                "hold_times": torch.tensor(hold_arr, dtype=torch.float32),
                "flight_times": torch.tensor(flight_arr, dtype=torch.float32),
                "length": length,
            }
        )

    def _augment_sequences(self) -> None:
        """
        Augment via global speed jitter.

        Creates one additional copy of each sequence where all timings are
        scaled by a random factor drawn from U(0.85, 1.15).  This simulates
        the same user typing slightly faster or slower.
        """
        augmented = []

        for seq in self.sequences:
            scale = 0.85 + torch.rand(1).item() * 0.30  # U(0.85, 1.15)
            augmented.append(
                {
                    "char_ids": seq["char_ids"].clone(),
                    "hold_times": seq["hold_times"] * scale,
                    "flight_times": seq["flight_times"] * scale,
                    "length": seq["length"],
                }
            )

        self.sequences.extend(augmented)

    def __len__(self) -> int:
        return len(self.sequences)

    def __getitem__(self, idx: int) -> Dict:
        return self.sequences[idx]


def collate_keystrokes(batch: List[Dict]) -> Dict:
    """
    Collate variable-length keystroke sequences into padded batches.

    Sorts by length (descending) for efficient ``pack_padded_sequence``.
    Combines hold and flight times into a ``(batch, max_len, 2)`` timings
    tensor.
    """
    batch = sorted(batch, key=lambda x: x["length"], reverse=True)

    char_ids_list = [item["char_ids"] for item in batch]
    lengths = torch.tensor([item["length"] for item in batch])

    padded_char_ids = pad_sequence(
        char_ids_list, batch_first=True, padding_value=0
    )

    timings_list = []
    for item in batch:
        timings_list.append(
            torch.stack([item["hold_times"], item["flight_times"]], dim=-1)
        )

    padded_timings = pad_sequence(
        timings_list, batch_first=True, padding_value=0.0
    )

    return {
        "char_ids": padded_char_ids,
        "timings": padded_timings,
        "lengths": lengths,
    }
