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

    manifest = {
        "base_model": args.base_model,
        "dataset": args.dataset,
        "status": "stub",
        "note": "Install torch, transformers, peft to run real QLoRA/LoRA training.",
    }
    (out / "adapter_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Wrote adapter_manifest.json to", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
