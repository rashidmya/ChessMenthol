"""Download and bundle Stockfish into chessmenthol/engines/stockfish/.

Usage:
    python scripts/fetch_engines.py [--variant avx2] [--tag sf_18]

Downloads the official Stockfish release asset for this OS/arch, extracts the
binary, and copies it to chessmenthol/engines/stockfish/stockfish[.exe].
select_asset() does no network I/O, so it is unit-testable.
"""
from __future__ import annotations

import argparse
import io
import json
import platform
import stat
import tarfile
import urllib.request
import zipfile
from pathlib import Path
from typing import List, Optional

DEFAULT_TAG = "sf_18"
RELEASE_API = "https://api.github.com/repos/official-stockfish/Stockfish/releases/tags/{tag}"
ENGINES_DIR = Path(__file__).resolve().parent.parent / "chessmenthol" / "engines" / "stockfish"


def _platform_token(system: str) -> str:
    system = system.lower()
    if system.startswith("win"):
        return "windows"
    if system == "darwin":
        return "macos"
    return "ubuntu"  # linux


def select_asset(asset_names: List[str], system: str, machine: str,
                 variant: Optional[str] = None) -> str:
    """Pick the best Stockfish asset filename for this host. Pure (no network)."""
    token = _platform_token(system)
    machine = machine.lower()
    is_arm = machine in {"arm64", "aarch64"} or machine.startswith("armv8")

    if token == "macos" and is_arm:
        for name in asset_names:
            if "m1-apple-silicon" in name:
                return name

    if token == "windows" and is_arm:
        for suffix in ("armv8-dotprod", "armv8"):
            for name in asset_names:
                if name.startswith(f"stockfish-{token}-{suffix}"):
                    return name

    ladder = [variant] if variant else []
    ladder += ["avx2", "sse41-popcnt", ""]  # "" == plain x86-64 (most compatible)
    for v in ladder:
        if v is None:
            continue
        target = f"stockfish-{token}-x86-64" + (f"-{v}" if v else "")
        for name in asset_names:
            base = name.rsplit(".", 1)[0]  # strip .zip / .tar
            if base == target:
                return name
    raise RuntimeError(f"No suitable Stockfish asset for {system}/{machine} in {asset_names}")


def _binary_member(names: List[str]) -> str:
    for n in names:
        if "/" not in n or n.endswith("/"):
            continue
        leaf = n.rsplit("/", 1)[1]
        if leaf.startswith("stockfish") and not leaf.endswith((".txt", ".md", ".nnue")):
            return n
    raise RuntimeError(f"No stockfish binary in archive members: {names}")


def _extract_binary(archive_bytes: bytes, asset_name: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    is_zip = asset_name.endswith(".zip")
    out = dest_dir / ("stockfish.exe" if is_zip else "stockfish")
    if is_zip:
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as zf:
            member = _binary_member(zf.namelist())
            with zf.open(member) as src, open(out, "wb") as dst:
                dst.write(src.read())
    else:
        with tarfile.open(fileobj=io.BytesIO(archive_bytes)) as tf:
            member = _binary_member(tf.getnames())
            src = tf.extractfile(member)
            with open(out, "wb") as dst:
                dst.write(src.read())
        out.chmod(out.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return out


def _fetch_release_assets(tag: str) -> list:
    url = RELEASE_API.format(tag=tag)
    req = urllib.request.Request(
        url, headers={"Accept": "application/vnd.github+json",
                      "User-Agent": "chessmenthol-fetch"})
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)["assets"]


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Download and bundle Stockfish.")
    parser.add_argument("--tag", default=DEFAULT_TAG)
    parser.add_argument("--variant", default=None,
                        help="x86-64 variant: avx2, bmi2, sse41-popcnt; omit for auto.")
    args = parser.parse_args(argv)

    assets = _fetch_release_assets(args.tag)
    names = [a["name"] for a in assets]
    chosen = select_asset(names, platform.system(), platform.machine(), args.variant)
    url = next(a["browser_download_url"] for a in assets if a["name"] == chosen)
    print(f"Downloading {chosen} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "chessmenthol-fetch"})
    with urllib.request.urlopen(req) as resp:
        blob = resp.read()
    out = _extract_binary(blob, chosen, ENGINES_DIR)
    print(f"Bundled Stockfish -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
