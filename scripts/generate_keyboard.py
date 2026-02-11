"""Generation entry point for the keyboard dynamics GAN."""

import argparse
import json
import logging

from keyboard_dynamics_gan.inference import KeystrokeGenerator


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate realistic keystroke timings for text."
    )
    parser.add_argument(
        "--checkpoint", type=str, required=True,
        help="Path to trained .pt checkpoint.",
    )
    parser.add_argument(
        "--text", type=str, required=True,
        help="Text to generate timings for.",
    )
    parser.add_argument(
        "--samples", type=int, default=1,
        help="Number of timing variations to generate.",
    )
    parser.add_argument(
        "--device", type=str, default=None,
        help="Device (cuda/cpu/mps). Auto-detected if omitted.",
    )
    parser.add_argument(
        "--json", dest="output_json", action="store_true",
        help="Output results as JSON.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
    )

    gen = KeystrokeGenerator.from_checkpoint(
        args.checkpoint, device=args.device
    )
    results = gen.generate(text=args.text, num_samples=args.samples)

    for i, seq in enumerate(results):
        if args.output_json:
            print(
                json.dumps(
                    {
                        "sample": i,
                        "text": seq.characters,
                        "hold_times": seq.hold_times.tolist(),
                        "flight_times": seq.flight_times.tolist(),
                        "timestamps": seq.timestamps.tolist(),
                    }
                )
            )
        else:
            print(f"\n--- Sample {i + 1} ---")
            print(f"Text: {seq.characters!r}")
            total = seq.timestamps[-1] + seq.hold_times[-1]
            wpm = len(seq.characters) / 5.0 / (total / 60.0 + 1e-8)
            print(f"Total time: {total:.3f}s ({wpm:.0f} WPM)")
            print(f"Mean hold:   {seq.hold_times.mean():.4f}s")
            print(f"Mean flight: {seq.flight_times.mean():.4f}s")


if __name__ == "__main__":
    main()
