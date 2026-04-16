#!/usr/bin/env python3
"""
Optional LoRA training worker invoked by the Electron main process.
Install stack separately, e.g. torch, transformers, peft, datasets.

This script provides a minimal, dependency-light path that records job metadata
so the app can register artifacts. Replace the body with a real training loop
when your environment has GPU packages installed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base_model", required=True)
    p.add_argument("--dataset", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)

    dataset_path = Path(args.dataset)
    line_count = 0
    if dataset_path.is_file():
        try:
            line_count = sum(1 for _ in dataset_path.open("r", encoding="utf-8"))
        except OSError:
            line_count = 0

    manifest = {
        "base_model": args.base_model,
        "dataset": args.dataset,
        "dataset_lines": line_count,
        "status": "stub",
        "note": (
            "Stub trainer: writes this manifest only. Install torch, transformers, peft (and merge to GGUF) "
            "for real LoRA; place merged.gguf in the output folder so the app can register it under models/finetunes."
        ),
    }
    (out / "adapter_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Wrote adapter_manifest.json to", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
