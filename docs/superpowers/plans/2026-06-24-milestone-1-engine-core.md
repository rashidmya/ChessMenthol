# Milestone 1 — Engine + Chess Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the engine + chess-logic core of ChessMenthol — a UCI engine manager (Stockfish / Stockfish Lite), multi-PV analysis types, move classification, and a CLI that ties them together — with no UI or computer vision yet.

**Architecture:** A small Python package `chessmenthol`. The `engine` sub-package wraps `python-chess`'s UCI support behind a typed `EngineManager` with a two-entry engine registry. The `analysis` sub-package contains a pure `classify_move` function plus an opening-book lookup. A thin `cli` module drives them so the milestone is runnable and testable end-to-end (`chessmenthol-analyze --fen ...`).

**Tech Stack:** Python 3.11+, `python-chess` (PyPI package `chess`), `pytest`, Stockfish binary (system-installed for dev/test; bundled later).

---

## Prerequisites

Stockfish is **downloaded and bundled** by this project — not installed from the system. Task 1
creates `scripts/fetch_engines.py` and runs it to download the correct official Stockfish build for
your OS/arch into `chessmenthol/engines/stockfish/`. The binary is git-ignored (fetched on demand).

Integration tests (marked `@pytest.mark.engine`) use that bundled binary. They auto-skip if no engine
is present, so the rest of the suite runs regardless. A system `stockfish` on PATH is accepted only as
a developer fallback. The download needs network access (GitHub).

## File Structure

```
chessmenthol/
  __init__.py
  engines/          # downloaded Stockfish binaries (git-ignored, produced by fetch_engines.py)
  engine/
    __init__.py
    types.py        # Eval, Line, AnalysisInfo  (pure data, no engine process)
    spec.py         # EngineSpec, binary resolution, default_registry()
    manager.py      # EngineManager  (owns the UCI subprocess)
  analysis/
    __init__.py
    book.py         # BookLookup protocol, NoBook, PolyglotBook
    classify.py     # MoveClass, Thresholds, is_sacrifice, classify_move
  cli.py            # argparse + format_report + run()/main()
scripts/
  __init__.py
  fetch_engines.py  # downloads + bundles the host Stockfish build
tests/
  __init__.py
  conftest.py       # skips @pytest.mark.engine when no bundled/system Stockfish
  test_fetch_engines.py   # hermetic: asset-selection logic (no network)
  engine/
    test_types.py
    test_spec.py
    test_manager.py
  analysis/
    test_book.py
    test_classify.py
  test_cli.py
pyproject.toml
.gitignore
```

Each file has one responsibility: data types never touch the subprocess; the subprocess lives only in `manager.py`; classification is a pure function over `AnalysisInfo` so it can be golden-tested without an engine.

---

### Task 1: Project scaffolding + git

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `chessmenthol/__init__.py`, `chessmenthol/engine/__init__.py`, `chessmenthol/analysis/__init__.py`, `tests/__init__.py`, `tests/engine/__init__.py`, `tests/analysis/__init__.py`, `tests/conftest.py`

- [ ] **Step 1: Initialize git**

Run:
```bash
cd /home/buga/Dev/ChessMenthol
git init
```
Expected: `Initialized empty Git repository ...`

- [ ] **Step 2: Create `.gitignore`**

```gitignore
__pycache__/
*.py[cod]
.venv/
venv/
*.egg-info/
.pytest_cache/
dist/
build/
.superpowers/
chessmenthol/engines/
```

- [ ] **Step 3: Create `pyproject.toml`**

```toml
[project]
name = "chessmenthol"
version = "0.1.0"
description = "Cross-platform desktop chess assistant (engine + vision)."
requires-python = ">=3.11"
dependencies = ["chess>=1.11"]

[project.optional-dependencies]
dev = ["pytest>=8"]

[project.scripts]
chessmenthol-analyze = "chessmenthol.cli:main"

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
include = ["chessmenthol*"]

[tool.pytest.ini_options]
markers = ["engine: requires a real Stockfish binary"]
```

- [ ] **Step 4: Create empty package + test `__init__.py` files**

Create these as empty files:
`chessmenthol/__init__.py`, `chessmenthol/engine/__init__.py`, `chessmenthol/analysis/__init__.py`, `scripts/__init__.py`, `tests/__init__.py`, `tests/engine/__init__.py`, `tests/analysis/__init__.py`

- [ ] **Step 5: Create `tests/conftest.py`**

```python
import os
import shutil
from pathlib import Path

import pytest

_BUNDLED = Path(__file__).resolve().parent.parent / "chessmenthol" / "engines" / "stockfish"


def _stockfish_available() -> bool:
    if os.environ.get("CHESSMENTHOL_STOCKFISH"):
        return True
    if (_BUNDLED / "stockfish").exists() or (_BUNDLED / "stockfish.exe").exists():
        return True
    return shutil.which("stockfish") is not None


def pytest_collection_modifyitems(config, items):
    if _stockfish_available():
        return
    skip = pytest.mark.skip(reason="Stockfish not installed")
    for item in items:
        if "engine" in item.keywords:
            item.add_marker(skip)
```

- [ ] **Step 6: Create `scripts/fetch_engines.py`**

```python
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
```

- [ ] **Step 7: Create `tests/test_fetch_engines.py` (hermetic, no network)**

```python
from scripts.fetch_engines import select_asset

LINUX = [
    "stockfish-ubuntu-x86-64.tar",
    "stockfish-ubuntu-x86-64-sse41-popcnt.tar",
    "stockfish-ubuntu-x86-64-avx2.tar",
    "stockfish-ubuntu-x86-64-bmi2.tar",
]
WINDOWS = ["stockfish-windows-x86-64.zip", "stockfish-windows-x86-64-avx2.zip"]
MAC = ["stockfish-macos-x86-64-avx2.tar", "stockfish-macos-m1-apple-silicon.tar"]


def test_linux_prefers_avx2_by_default():
    assert select_asset(LINUX, "Linux", "x86_64") == "stockfish-ubuntu-x86-64-avx2.tar"


def test_variant_override_is_honored():
    assert select_asset(LINUX, "Linux", "x86_64", variant="bmi2") == \
        "stockfish-ubuntu-x86-64-bmi2.tar"


def test_falls_back_down_the_ladder_when_variant_missing():
    names = ["stockfish-ubuntu-x86-64.tar", "stockfish-ubuntu-x86-64-sse41-popcnt.tar"]
    assert select_asset(names, "Linux", "x86_64") == "stockfish-ubuntu-x86-64-sse41-popcnt.tar"


def test_macos_apple_silicon_gets_dedicated_build():
    assert select_asset(MAC, "Darwin", "arm64") == "stockfish-macos-m1-apple-silicon.tar"


def test_windows_avx2():
    assert select_asset(WINDOWS, "Windows", "AMD64") == "stockfish-windows-x86-64-avx2.zip"
```

- [ ] **Step 8: Create and activate a virtualenv, install deps**

Run:
```bash
cd /home/buga/Dev/ChessMenthol
python -m venv .venv
.venv/bin/pip install -e ".[dev]"
```
Expected: installs `chess` and `pytest` without error.

- [ ] **Step 9: Run the hermetic fetch test**

Run: `.venv/bin/pytest tests/test_fetch_engines.py -q`
Expected: PASS (5 passed) — asset-selection logic verified without any download.

- [ ] **Step 10: Download + bundle Stockfish**

Run: `.venv/bin/python scripts/fetch_engines.py`
Expected: prints `Downloading stockfish-ubuntu-x86-64-...` then `Bundled Stockfish -> .../chessmenthol/engines/stockfish/stockfish`.

Verify it runs:
```bash
printf 'uci\nquit\n' | ./chessmenthol/engines/stockfish/stockfish | grep -m1 "uciok"
```
Expected: prints `uciok`.

- [ ] **Step 11: Verify the suite collects**

Run: `.venv/bin/pytest -q`
Expected: the 5 fetch tests pass; no other tests yet. No failures.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold package, test harness, and Stockfish fetch/bundle script"
```

---

### Task 2: `Eval` value type

**Files:**
- Create: `chessmenthol/engine/types.py`
- Test: `tests/engine/test_types.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/engine/test_types.py
import chess
import chess.engine

from chessmenthol.engine.types import Eval


def test_eval_from_cp_pov_score_is_white_relative():
    pov = chess.engine.PovScore(chess.engine.Cp(50), chess.WHITE)
    ev = Eval.from_pov_score(pov)
    assert ev.cp == 50
    assert ev.mate is None


def test_eval_from_black_cp_is_negated_to_white_pov():
    # +120 for the side to move (Black) -> -120 from White's POV
    pov = chess.engine.PovScore(chess.engine.Cp(120), chess.BLACK)
    ev = Eval.from_pov_score(pov)
    assert ev.cp == -120


def test_eval_from_mate():
    pov = chess.engine.PovScore(chess.engine.Mate(3), chess.WHITE)
    ev = Eval.from_pov_score(pov)
    assert ev.mate == 3
    assert ev.cp is None


def test_scalar_maps_mate_near_mate_value():
    assert Eval(mate=3).scalar() == 100_000 - 3
    assert Eval(mate=-2).scalar() == -(100_000 - 2)
    assert Eval(cp=-45).scalar() == -45


def test_pov_flips_for_black_to_move():
    assert Eval(cp=80).pov(white_to_move=True) == 80
    assert Eval(cp=80).pov(white_to_move=False) == -80


def test_format_white():
    assert Eval(cp=140).format_white() == "+1.40"
    assert Eval(cp=-30).format_white() == "-0.30"
    assert Eval(mate=4).format_white() == "#4"
    assert Eval(mate=-1).format_white() == "#-1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/engine/test_types.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'chessmenthol.engine.types'`

- [ ] **Step 3: Write minimal implementation**

```python
# chessmenthol/engine/types.py
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

import chess
import chess.engine


@dataclass(frozen=True)
class Eval:
    """A position evaluation, always from White's point of view."""

    cp: Optional[int] = None    # centipawns (None when it is a forced mate)
    mate: Optional[int] = None  # mate-in-N; positive = White mates

    @classmethod
    def from_pov_score(cls, pov: "chess.engine.PovScore") -> "Eval":
        white = pov.white()
        if white.is_mate():
            return cls(cp=None, mate=white.mate())
        return cls(cp=white.score(), mate=None)

    def scalar(self, mate_value: int = 100_000) -> int:
        """White-POV centipawn scalar; mate mapped near +/- mate_value."""
        if self.mate is not None:
            base = mate_value - abs(self.mate)
            return base if self.mate > 0 else -base
        return self.cp if self.cp is not None else 0

    def pov(self, white_to_move: bool, mate_value: int = 100_000) -> int:
        """Scalar from the perspective of the side to move."""
        s = self.scalar(mate_value)
        return s if white_to_move else -s

    def format_white(self) -> str:
        if self.mate is not None:
            return f"#{self.mate}"
        return f"{(self.cp or 0) / 100:+.2f}"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/engine/test_types.py -q`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/engine/types.py tests/engine/test_types.py
git commit -m "feat(engine): add Eval value type"
```

---

### Task 3: `Line` and `AnalysisInfo` types

**Files:**
- Modify: `chessmenthol/engine/types.py` (append)
- Test: `tests/engine/test_types.py` (append)

- [ ] **Step 1: Write the failing test (append)**

```python
# tests/engine/test_types.py  (append)
from chessmenthol.engine.types import Line, AnalysisInfo


def _info(multipv, score, pv, depth=20):
    return {"multipv": multipv, "score": score, "pv": pv, "depth": depth}


def test_line_move_is_first_pv_move():
    mv = chess.Move.from_uci("e2e4")
    line = Line(multipv=1, eval=Eval(cp=30), depth=20, pv=[mv])
    assert line.move == mv


def test_line_move_is_none_when_pv_empty():
    assert Line(multipv=1, eval=Eval(cp=0), depth=1, pv=[]).move is None


def test_analysis_from_engine_sorts_by_multipv_and_picks_best():
    e4 = chess.Move.from_uci("e2e4")
    d4 = chess.Move.from_uci("d2d4")
    infos = [
        _info(2, chess.engine.PovScore(chess.engine.Cp(10), chess.WHITE), [d4], 18),
        _info(1, chess.engine.PovScore(chess.engine.Cp(30), chess.WHITE), [e4], 20),
    ]
    analysis = AnalysisInfo.from_engine(chess.Board().fen(), infos)
    assert [l.multipv for l in analysis.lines] == [1, 2]
    assert analysis.best.move == e4
    assert analysis.depth == 20


def test_analysis_best_is_none_when_no_lines():
    assert AnalysisInfo(fen="x", depth=0, lines=[]).best is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/engine/test_types.py -q`
Expected: FAIL — `ImportError: cannot import name 'Line'`

- [ ] **Step 3: Write minimal implementation (append to `types.py`)**

```python
# chessmenthol/engine/types.py  (append)
@dataclass(frozen=True)
class Line:
    """One principal variation from a multi-PV analysis."""

    multipv: int            # 1-based rank; 1 == best line
    eval: Eval
    depth: int
    pv: List[chess.Move]

    @property
    def move(self) -> Optional[chess.Move]:
        return self.pv[0] if self.pv else None


@dataclass(frozen=True)
class AnalysisInfo:
    """A full analysis snapshot of one position."""

    fen: str
    depth: int
    lines: List[Line]       # sorted ascending by multipv (lines[0] == best)

    @property
    def best(self) -> Optional[Line]:
        return self.lines[0] if self.lines else None

    @classmethod
    def from_engine(cls, fen: str, infos) -> "AnalysisInfo":
        lines: List[Line] = []
        for info in infos:
            lines.append(
                Line(
                    multipv=info.get("multipv", 1),
                    eval=Eval.from_pov_score(info["score"]),
                    depth=info.get("depth", 0),
                    pv=list(info.get("pv", [])),
                )
            )
        lines.sort(key=lambda l: l.multipv)
        depth = max((l.depth for l in lines), default=0)
        return cls(fen=fen, depth=depth, lines=lines)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/engine/test_types.py -q`
Expected: PASS (10 passed)

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/engine/types.py tests/engine/test_types.py
git commit -m "feat(engine): add Line and AnalysisInfo types"
```

---

### Task 4: `EngineSpec` + binary resolution

**Files:**
- Create: `chessmenthol/engine/spec.py`
- Test: `tests/engine/test_spec.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/engine/test_spec.py
from pathlib import Path

import pytest

from chessmenthol.engine.spec import EngineSpec, default_registry, _resolve_binary


def test_resolve_binary_prefers_env(monkeypatch, tmp_path):
    fake = tmp_path / "sf"
    fake.write_text("")
    monkeypatch.setenv("CHESSMENTHOL_STOCKFISH", str(fake))
    assert _resolve_binary() == fake


def test_resolve_binary_falls_back_to_path(monkeypatch):
    monkeypatch.delenv("CHESSMENTHOL_STOCKFISH", raising=False)
    monkeypatch.setattr("chessmenthol.engine.spec.shutil.which", lambda name: "/usr/bin/stockfish")
    # ensure bundled path does not exist during this test
    monkeypatch.setattr("chessmenthol.engine.spec.Path.exists", lambda self: False)
    assert _resolve_binary() == Path("/usr/bin/stockfish")


def test_resolve_binary_raises_when_missing(monkeypatch):
    monkeypatch.delenv("CHESSMENTHOL_STOCKFISH", raising=False)
    monkeypatch.setattr("chessmenthol.engine.spec.shutil.which", lambda name: None)
    monkeypatch.setattr("chessmenthol.engine.spec.Path.exists", lambda self: False)
    with pytest.raises(FileNotFoundError):
        _resolve_binary()


def test_default_registry_has_both_engines(monkeypatch, tmp_path):
    fake = tmp_path / "sf"
    fake.write_text("")
    monkeypatch.setenv("CHESSMENTHOL_STOCKFISH", str(fake))
    reg = default_registry()
    assert set(reg) == {"stockfish", "stockfish_lite"}
    assert isinstance(reg["stockfish"], EngineSpec)
    assert reg["stockfish_lite"].default_options["Threads"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/engine/test_spec.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'chessmenthol.engine.spec'`

- [ ] **Step 3: Write minimal implementation**

```python
# chessmenthol/engine/spec.py
from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict


@dataclass(frozen=True)
class EngineSpec:
    id: str
    name: str
    binary: Path
    default_options: Dict[str, object] = field(default_factory=dict)


def _resolve_binary() -> Path:
    env = os.environ.get("CHESSMENTHOL_STOCKFISH")
    if env:
        return Path(env)
    bundled_dir = Path(__file__).resolve().parent.parent / "engines" / "stockfish"
    for exe in ("stockfish", "stockfish.exe"):
        candidate = bundled_dir / exe
        if candidate.exists():
            return candidate
    found = shutil.which("stockfish")
    if found:
        return Path(found)
    raise FileNotFoundError(
        "Stockfish binary not found. Run `python scripts/fetch_engines.py` to download it, "
        "set CHESSMENTHOL_STOCKFISH, or install stockfish on PATH."
    )


def default_registry() -> Dict[str, EngineSpec]:
    """Two bundled presets sharing one binary in dev; Lite gets its own net later."""
    binary = _resolve_binary()
    return {
        "stockfish": EngineSpec(
            id="stockfish",
            name="Stockfish",
            binary=binary,
            default_options={"Threads": 2, "Hash": 256},
        ),
        "stockfish_lite": EngineSpec(
            id="stockfish_lite",
            name="Stockfish Lite",
            binary=binary,
            default_options={"Threads": 1, "Hash": 64},
        ),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/engine/test_spec.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/engine/spec.py tests/engine/test_spec.py
git commit -m "feat(engine): add EngineSpec and binary resolution"
```

---

### Task 5: `EngineManager` select + analyze

**Files:**
- Create: `chessmenthol/engine/manager.py`
- Test: `tests/engine/test_manager.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/engine/test_manager.py
import chess
import pytest

from chessmenthol.engine.manager import EngineManager


@pytest.mark.engine
def test_select_then_analyze_returns_requested_lines():
    with EngineManager() as em:
        em.select("stockfish")
        assert em.active_id == "stockfish"
        info = em.analyze(chess.Board(), depth=12, multipv=3)
    assert len(info.lines) == 3
    assert info.best is not None and info.best.move is not None
    assert info.depth >= 1


@pytest.mark.engine
def test_analyze_without_selecting_raises():
    em = EngineManager()
    with pytest.raises(RuntimeError):
        em.analyze(chess.Board(), depth=4)


def test_select_unknown_engine_raises(monkeypatch, tmp_path):
    fake = tmp_path / "sf"
    fake.write_text("")
    monkeypatch.setenv("CHESSMENTHOL_STOCKFISH", str(fake))
    em = EngineManager()
    with pytest.raises(KeyError):
        em.select("komodo")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/engine/test_manager.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'chessmenthol.engine.manager'`

- [ ] **Step 3: Write minimal implementation**

```python
# chessmenthol/engine/manager.py
from __future__ import annotations

from typing import Dict, Optional

import chess
import chess.engine

from .spec import EngineSpec, default_registry
from .types import AnalysisInfo


class EngineManager:
    """Owns a single UCI engine subprocess. One engine is active at a time."""

    def __init__(self, registry: Optional[Dict[str, EngineSpec]] = None):
        self._registry = registry if registry is not None else default_registry()
        self._engine: Optional[chess.engine.SimpleEngine] = None
        self._active_id: Optional[str] = None
        self._multipv = 3

    @property
    def active_id(self) -> Optional[str]:
        return self._active_id

    def select(self, engine_id: str) -> None:
        if engine_id not in self._registry:
            raise KeyError(f"Unknown engine: {engine_id}")
        if self._active_id == engine_id and self._engine is not None:
            return
        self._start(engine_id)

    def _start(self, engine_id: str) -> None:
        self.close()
        spec = self._registry[engine_id]
        self._engine = chess.engine.SimpleEngine.popen_uci(str(spec.binary))
        if spec.default_options:
            self._engine.configure(dict(spec.default_options))
        self._active_id = engine_id

    def configure(self, *, threads: Optional[int] = None,
                  hash_mb: Optional[int] = None,
                  multipv: Optional[int] = None) -> None:
        if multipv is not None:
            self._multipv = multipv
        opts: Dict[str, object] = {}
        if threads is not None:
            opts["Threads"] = threads
        if hash_mb is not None:
            opts["Hash"] = hash_mb
        if opts:
            self._require().configure(opts)

    def analyze(self, board: chess.Board, *,
                depth: Optional[int] = None,
                time: Optional[float] = None,
                multipv: Optional[int] = None) -> AnalysisInfo:
        mpv = multipv if multipv is not None else self._multipv
        if depth is None and time is None:
            depth = 18
        limit = chess.engine.Limit(depth=depth, time=time)
        try:
            infos = self._require().analyse(board, limit, multipv=mpv)
        except chess.engine.EngineError:
            self._restart()
            infos = self._require().analyse(board, limit, multipv=mpv)
        if isinstance(infos, dict):
            infos = [infos]
        return AnalysisInfo.from_engine(board.fen(), infos)

    def _restart(self) -> None:
        if self._active_id is not None:
            self._start(self._active_id)

    def _require(self) -> chess.engine.SimpleEngine:
        if self._engine is None:
            raise RuntimeError("No engine selected; call select() first.")
        return self._engine

    def close(self) -> None:
        if self._engine is not None:
            try:
                self._engine.quit()
            except Exception:
                pass
            self._engine = None

    def __enter__(self) -> "EngineManager":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/engine/test_manager.py -q`
Expected: PASS (3 passed; the 2 engine tests run if Stockfish is installed, otherwise skip)

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/engine/manager.py tests/engine/test_manager.py
git commit -m "feat(engine): add EngineManager select and analyze"
```

---

### Task 6: `EngineManager` switch + crash-retry

**Files:**
- Test: `tests/engine/test_manager.py` (append)

(The implementation from Task 5 already supports switching and retry; these tests lock that behavior in.)

- [ ] **Step 1: Write the failing test (append)**

```python
# tests/engine/test_manager.py  (append)
import chess.engine


@pytest.mark.engine
def test_switching_engine_changes_active_id():
    with EngineManager() as em:
        em.select("stockfish")
        assert em.active_id == "stockfish"
        em.select("stockfish_lite")
        assert em.active_id == "stockfish_lite"
        info = em.analyze(chess.Board(), depth=8, multipv=1)
    assert info.best is not None


@pytest.mark.engine
def test_analyze_retries_after_engine_error(monkeypatch):
    with EngineManager() as em:
        em.select("stockfish")
        first = em._engine
        state = {"raised": False}
        original = first.analyse

        def flaky(*args, **kwargs):
            if not state["raised"]:
                state["raised"] = True
                raise chess.engine.EngineError("simulated crash")
            return original(*args, **kwargs)

        monkeypatch.setattr(first, "analyse", flaky)
        info = em.analyze(chess.Board(), depth=8, multipv=1)
    assert state["raised"] is True
    assert info.best is not None
```

- [ ] **Step 2: Run test to verify it fails (or skips without Stockfish)**

Run: `.venv/bin/pytest tests/engine/test_manager.py -q`
Expected: With Stockfish installed, both new tests PASS. (If the implementation were missing retry, `test_analyze_retries_after_engine_error` would error out instead of passing.)

- [ ] **Step 3: Implementation**

No code change needed — Task 5's `analyze` already retries via `_restart()` and `select` already switches engines. If either test fails, fix `manager.py` to match the behavior described in Task 5 Step 3.

- [ ] **Step 4: Run the full engine suite**

Run: `.venv/bin/pytest tests/engine -q`
Expected: PASS (all type tests pass; engine-marked tests pass or skip)

- [ ] **Step 5: Commit**

```bash
git add tests/engine/test_manager.py
git commit -m "test(engine): cover engine switching and crash-retry"
```

---

### Task 7: Opening-book lookup

**Files:**
- Create: `chessmenthol/analysis/book.py`
- Test: `tests/analysis/test_book.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/analysis/test_book.py
import chess

from chessmenthol.analysis.book import NoBook, PolyglotBook


def test_nobook_never_contains():
    assert NoBook().contains_move(chess.Board(), chess.Move.from_uci("e2e4")) is False


def test_polyglot_missing_file_returns_false(tmp_path):
    book = PolyglotBook(tmp_path / "does-not-exist.bin")
    assert book.contains_move(chess.Board(), chess.Move.from_uci("e2e4")) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/analysis/test_book.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'chessmenthol.analysis.book'`

- [ ] **Step 3: Write minimal implementation**

```python
# chessmenthol/analysis/book.py
from __future__ import annotations

from pathlib import Path
from typing import Protocol

import chess
import chess.polyglot


class BookLookup(Protocol):
    def contains_move(self, board: chess.Board, move: chess.Move) -> bool: ...


class NoBook:
    """Null book: nothing is ever a book move."""

    def contains_move(self, board: chess.Board, move: chess.Move) -> bool:
        return False


class PolyglotBook:
    """Looks moves up in a Polyglot (.bin) opening book."""

    def __init__(self, path: Path):
        self._path = Path(path)

    def contains_move(self, board: chess.Board, move: chess.Move) -> bool:
        try:
            with chess.polyglot.open_reader(self._path) as reader:
                return any(entry.move == move for entry in reader.find_all(board))
        except (FileNotFoundError, IndexError, OSError):
            return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/analysis/test_book.py -q`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/analysis/book.py tests/analysis/test_book.py
git commit -m "feat(analysis): add opening-book lookup"
```

---

### Task 8: Classification types, thresholds, sacrifice detection

**Files:**
- Create: `chessmenthol/analysis/classify.py`
- Test: `tests/analysis/test_classify.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/analysis/test_classify.py
import chess

from chessmenthol.analysis.classify import (
    MoveClass,
    Thresholds,
    is_sacrifice,
)


def test_moveclass_values_are_stable_strings():
    assert MoveClass.BRILLIANT.value == "brilliant"
    assert MoveClass.BLUNDER.value == "blunder"


def test_thresholds_have_sane_defaults():
    t = Thresholds()
    assert t.excellent_max < t.good_max < t.inaccuracy_max < t.mistake_max


def test_is_sacrifice_true_when_queen_moves_to_pawn_attacked_square():
    # Black pawn on g6 attacks f5 and h5. White queen d1 -> h5 (no capture).
    board = chess.Board("k7/8/6p1/8/8/8/8/3QK3 w - - 0 1")
    move = chess.Move.from_uci("d1h5")
    assert is_sacrifice(board, move) is True


def test_is_sacrifice_false_for_safe_queen_move():
    board = chess.Board("k7/8/6p1/8/8/8/8/3QK3 w - - 0 1")
    move = chess.Move.from_uci("d1d5")  # d5 not attacked
    assert is_sacrifice(board, move) is False


def test_is_sacrifice_false_for_equal_capture():
    # White queen captures a defended queen on h5: gain ~ risk, not a sac.
    board = chess.Board("k7/8/6p1/7q/8/8/8/3QK3 w - - 0 1")
    move = chess.Move.from_uci("d1h5")  # Qxh5, h5 attacked by g6 pawn
    assert is_sacrifice(board, move) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/analysis/test_classify.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'chessmenthol.analysis.classify'`

- [ ] **Step 3: Write minimal implementation**

```python
# chessmenthol/analysis/classify.py
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import chess


class MoveClass(str, Enum):
    BRILLIANT = "brilliant"
    GREAT = "great"
    BEST = "best"
    EXCELLENT = "excellent"
    GOOD = "good"
    BOOK = "book"
    INACCURACY = "inaccuracy"
    MISTAKE = "mistake"
    BLUNDER = "blunder"
    MISS = "miss"


@dataclass(frozen=True)
class Thresholds:
    excellent_max: int = 20       # cpl <= => excellent
    good_max: int = 50            # cpl <= => good
    inaccuracy_max: int = 100     # cpl <= => inaccuracy
    mistake_max: int = 250        # cpl <= => mistake (else blunder)
    great_gap: int = 150          # best better than 2nd-best by this => only-move
    brilliant_max_cpl: int = 30   # near-best ceiling to still be brilliant
    brilliant_keep: int = -50     # mover-POV eval after move must stay >= this
    sacrifice_min: int = 200      # (risked - gained) material to count as a sac
    miss_win: int = 200           # had at least this (mover POV) => was winning
    miss_keep: int = 100          # dropped below this => threw the win


PIECE_VALUE = {
    chess.PAWN: 100,
    chess.KNIGHT: 300,
    chess.BISHOP: 300,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 0,
}


def is_sacrifice(board_before: chess.Board, move: chess.Move,
                 thresholds: Thresholds | None = None) -> bool:
    """Heuristic: did the move offer material on its destination square?

    v1 approximation: the moved piece lands on a square attacked by the
    opponent, and (value risked - value captured) is at least one minor piece.
    Does not run a full static-exchange evaluation; tunable via sacrifice_min.
    """
    t = thresholds or Thresholds()
    mover = board_before.turn
    captured = board_before.piece_type_at(move.to_square)
    gain = PIECE_VALUE[captured] if captured else 0
    after = board_before.copy()
    after.push(move)
    moved_pt = after.piece_type_at(move.to_square)
    if moved_pt is None:
        return False
    risked = PIECE_VALUE[moved_pt]
    if after.is_attacked_by(not mover, move.to_square):
        return (risked - gain) >= t.sacrifice_min
    return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/analysis/test_classify.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/analysis/classify.py tests/analysis/test_classify.py
git commit -m "feat(analysis): add classification types and sacrifice heuristic"
```

---

### Task 9: `classify_move` — base categories

**Files:**
- Modify: `chessmenthol/analysis/classify.py` (append)
- Test: `tests/analysis/test_classify.py` (append)

- [ ] **Step 1: Write the failing test (append)**

```python
# tests/analysis/test_classify.py  (append)
from chessmenthol.analysis.classify import Classification, classify_move
from chessmenthol.engine.types import AnalysisInfo, Eval, Line


def mk_analysis(fen, lines, depth=20):
    """lines: list of (Eval, [moves]) in best-first order."""
    objs = [Line(multipv=i + 1, eval=ev, depth=depth, pv=pv)
            for i, (ev, pv) in enumerate(lines)]
    return AnalysisInfo(fen=fen, depth=depth, lines=objs)


def _white_startpos_move(uci):
    board = chess.Board()
    move = chess.Move.from_uci(uci)
    after = board.copy()
    after.push(move)
    return board, move, after


def test_best_move_is_classified_best():
    board, e4, after = _white_startpos_move("e2e4")
    d4 = chess.Move.from_uci("d2d4")
    before = mk_analysis(board.fen(), [(Eval(cp=30), [e4]), (Eval(cp=15), [d4])])
    after_a = mk_analysis(after.fen(), [(Eval(cp=30), [chess.Move.from_uci("e7e5")])])
    result = classify_move(board, e4, before, after_a)
    assert result.label == MoveClass.BEST
    assert result.is_best is True
    assert result.cpl == 0


def test_blunder_when_eval_collapses():
    board, e4, after = _white_startpos_move("e2e4")
    best = chess.Move.from_uci("d2d4")
    before = mk_analysis(board.fen(), [(Eval(cp=50), [best]), (Eval(cp=20), [e4])])
    after_a = mk_analysis(after.fen(), [(Eval(cp=-300), [chess.Move.from_uci("e7e5")])])
    result = classify_move(board, e4, before, after_a)
    assert result.label == MoveClass.BLUNDER
    assert result.is_best is False
    assert result.cpl == 350


def test_inaccuracy_band():
    board, e4, after = _white_startpos_move("e2e4")
    best = chess.Move.from_uci("d2d4")
    before = mk_analysis(board.fen(), [(Eval(cp=90), [best]), (Eval(cp=20), [e4])])
    after_a = mk_analysis(after.fen(), [(Eval(cp=10), [chess.Move.from_uci("e7e5")])])
    result = classify_move(board, e4, before, after_a)  # cpl = 80
    assert result.label == MoveClass.INACCURACY


def test_book_move_short_circuits():
    board, e4, after = _white_startpos_move("e2e4")
    before = mk_analysis(board.fen(), [(Eval(cp=30), [e4])])
    after_a = mk_analysis(after.fen(), [(Eval(cp=30), [chess.Move.from_uci("e7e5")])])

    class AlwaysBook:
        def contains_move(self, b, m):
            return True

    result = classify_move(board, e4, before, after_a, book=AlwaysBook())
    assert result.label == MoveClass.BOOK
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/analysis/test_classify.py -q`
Expected: FAIL — `ImportError: cannot import name 'classify_move'`

- [ ] **Step 3: Write minimal implementation (append to `classify.py`)**

```python
# chessmenthol/analysis/classify.py  (append)
from typing import Optional

from ..engine.types import AnalysisInfo
from .book import BookLookup, NoBook


@dataclass(frozen=True)
class Classification:
    label: MoveClass
    cpl: int            # centipawn loss vs best move, mover POV, >= 0
    is_best: bool


def classify_move(board_before: chess.Board, move: chess.Move,
                  analysis_before: AnalysisInfo, analysis_after: AnalysisInfo,
                  book: Optional[BookLookup] = None,
                  thresholds: Optional[Thresholds] = None) -> Classification:
    t = thresholds or Thresholds()
    bk = book or NoBook()
    mover_white = board_before.turn == chess.WHITE

    best_line = analysis_before.best
    if best_line is None or best_line.move is None:
        raise ValueError("analysis_before must contain at least one line with a move")
    best_move = best_line.move
    best_mover = best_line.eval.pov(mover_white)

    after_best = analysis_after.best
    if after_best is None:
        raise ValueError("analysis_after must contain at least one line")
    played_mover = after_best.eval.pov(mover_white)

    cpl = max(0, best_mover - played_mover)
    is_best = move == best_move

    if bk.contains_move(board_before, move):
        return Classification(MoveClass.BOOK, cpl, is_best)

    if is_best:
        return Classification(MoveClass.BEST, cpl, is_best)

    if cpl <= t.excellent_max:
        return Classification(MoveClass.EXCELLENT, cpl, is_best)
    if cpl <= t.good_max:
        return Classification(MoveClass.GOOD, cpl, is_best)
    if cpl <= t.inaccuracy_max:
        return Classification(MoveClass.INACCURACY, cpl, is_best)
    if cpl <= t.mistake_max:
        return Classification(MoveClass.MISTAKE, cpl, is_best)
    return Classification(MoveClass.BLUNDER, cpl, is_best)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/analysis/test_classify.py -q`
Expected: PASS (9 passed)

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/analysis/classify.py tests/analysis/test_classify.py
git commit -m "feat(analysis): classify_move base categories"
```

---

### Task 10: `classify_move` — brilliant, great, miss

**Files:**
- Modify: `chessmenthol/analysis/classify.py` (replace `classify_move`)
- Test: `tests/analysis/test_classify.py` (append)

- [ ] **Step 1: Write the failing test (append)**

```python
# tests/analysis/test_classify.py  (append)
def test_great_move_is_only_move():
    board, e4, after = _white_startpos_move("e2e4")
    d4 = chess.Move.from_uci("d2d4")
    # e4 is best AND second-best is far worse -> only move
    before = mk_analysis(board.fen(), [(Eval(cp=50), [e4]), (Eval(cp=-150), [d4])])
    after_a = mk_analysis(after.fen(), [(Eval(cp=50), [chess.Move.from_uci("e7e5")])])
    result = classify_move(board, e4, before, after_a)
    assert result.label == MoveClass.GREAT


def test_brilliant_sound_sacrifice():
    # White queen d1 -> h5, offered to the g6 pawn, but eval stays winning.
    board = chess.Board("k7/8/6p1/8/8/8/8/3QK3 w - - 0 1")
    qh5 = chess.Move.from_uci("d1h5")
    after = board.copy()
    after.push(qh5)
    before = mk_analysis(board.fen(), [(Eval(cp=300), [qh5])])
    after_a = mk_analysis(after.fen(), [(Eval(cp=300), [chess.Move.from_uci("a8b8")])])
    result = classify_move(board, qh5, before, after_a)
    assert result.label == MoveClass.BRILLIANT


def test_missed_win():
    board, e4, after = _white_startpos_move("e2e4")
    best = chess.Move.from_uci("d2d4")
    # Had a winning move (+400) but e4 only keeps +30 -> threw the win
    before = mk_analysis(board.fen(), [(Eval(cp=400), [best]), (Eval(cp=60), [e4])])
    after_a = mk_analysis(after.fen(), [(Eval(cp=30), [chess.Move.from_uci("e7e5")])])
    result = classify_move(board, e4, before, after_a)
    assert result.label == MoveClass.MISS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/analysis/test_classify.py -q`
Expected: FAIL — `test_great_move_is_only_move` etc. report `MoveClass.BEST`/`MoveClass.MISTAKE` instead of `GREAT`/`MISS`.

- [ ] **Step 3: Replace `classify_move` in `classify.py`**

Replace the entire `classify_move` function from Task 9 with this version (adds the brilliant / great / miss branches in priority order):

```python
def classify_move(board_before: chess.Board, move: chess.Move,
                  analysis_before: AnalysisInfo, analysis_after: AnalysisInfo,
                  book: Optional[BookLookup] = None,
                  thresholds: Optional[Thresholds] = None) -> Classification:
    t = thresholds or Thresholds()
    bk = book or NoBook()
    mover_white = board_before.turn == chess.WHITE

    best_line = analysis_before.best
    if best_line is None or best_line.move is None:
        raise ValueError("analysis_before must contain at least one line with a move")
    best_move = best_line.move
    best_mover = best_line.eval.pov(mover_white)

    after_best = analysis_after.best
    if after_best is None:
        raise ValueError("analysis_after must contain at least one line")
    played_mover = after_best.eval.pov(mover_white)

    cpl = max(0, best_mover - played_mover)
    is_best = move == best_move

    second_gap = None
    if len(analysis_before.lines) >= 2:
        second_mover = analysis_before.lines[1].eval.pov(mover_white)
        second_gap = best_mover - second_mover

    # 1. Book moves are labelled regardless of quality.
    if bk.contains_move(board_before, move):
        return Classification(MoveClass.BOOK, cpl, is_best)

    # 2. Brilliant: near-best, a sound sacrifice, eval stays acceptable.
    near_best = cpl <= t.brilliant_max_cpl
    if (near_best
            and played_mover >= t.brilliant_keep
            and is_sacrifice(board_before, move, t)):
        return Classification(MoveClass.BRILLIANT, cpl, is_best)

    # 3. Great: the only move that holds (best by a wide margin).
    if is_best and second_gap is not None and second_gap >= t.great_gap:
        return Classification(MoveClass.GREAT, cpl, is_best)

    # 4. Plain best.
    if is_best:
        return Classification(MoveClass.BEST, cpl, is_best)

    # 5. Miss: a win was available and got thrown away.
    if best_mover >= t.miss_win and played_mover < t.miss_keep:
        return Classification(MoveClass.MISS, cpl, is_best)

    # 6. Centipawn-loss bands.
    if cpl <= t.excellent_max:
        return Classification(MoveClass.EXCELLENT, cpl, is_best)
    if cpl <= t.good_max:
        return Classification(MoveClass.GOOD, cpl, is_best)
    if cpl <= t.inaccuracy_max:
        return Classification(MoveClass.INACCURACY, cpl, is_best)
    if cpl <= t.mistake_max:
        return Classification(MoveClass.MISTAKE, cpl, is_best)
    return Classification(MoveClass.BLUNDER, cpl, is_best)
```

- [ ] **Step 4: Run the full analysis suite**

Run: `.venv/bin/pytest tests/analysis -q`
Expected: PASS (all classify + book tests, 14 total)

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/analysis/classify.py tests/analysis/test_classify.py
git commit -m "feat(analysis): add brilliant, great, and miss classifications"
```

---

### Task 11: CLI

**Files:**
- Create: `chessmenthol/cli.py`
- Test: `tests/test_cli.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_cli.py
import chess
import pytest

from chessmenthol.cli import build_parser, format_report
from chessmenthol.analysis.classify import Classification, MoveClass
from chessmenthol.engine.types import AnalysisInfo, Eval, Line


def test_parser_requires_fen():
    with pytest.raises(SystemExit):
        build_parser().parse_args([])


def test_parser_defaults():
    args = build_parser().parse_args(["--fen", chess.STARTING_FEN])
    assert args.depth == 18
    assert args.lines == 3
    assert args.engine == "stockfish"


def test_parser_rejects_unknown_engine():
    with pytest.raises(SystemExit):
        build_parser().parse_args(["--fen", chess.STARTING_FEN, "--engine", "komodo"])


def test_format_report_renders_eval_san_and_class():
    board = chess.Board()
    e4 = chess.Move.from_uci("e2e4")
    analysis = AnalysisInfo(board.fen(), 20, [Line(1, Eval(cp=30), 20, [e4])])
    classification = Classification(MoveClass.BEST, 0, True)
    text = format_report(board, analysis, classification)
    assert "+0.30" in text
    assert "e4" in text
    assert "best" in text


def test_format_report_without_classification():
    board = chess.Board()
    analysis = AnalysisInfo(board.fen(), 12, [Line(1, Eval(mate=2), 12,
                            [chess.Move.from_uci("e2e4")])])
    text = format_report(board, analysis, None)
    assert "#2" in text
    assert "Move class" not in text


@pytest.mark.engine
def test_run_end_to_end_smoke(capsys):
    from chessmenthol.cli import run
    code = run(["--fen", chess.STARTING_FEN, "--depth", "8", "--lines", "2"])
    out = capsys.readouterr().out
    assert code == 0
    assert "Lines:" in out
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_cli.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'chessmenthol.cli'`

- [ ] **Step 3: Write minimal implementation**

```python
# chessmenthol/cli.py
from __future__ import annotations

import argparse
from typing import List, Optional

import chess

from .analysis.classify import Classification, classify_move
from .engine.manager import EngineManager
from .engine.types import AnalysisInfo


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="chessmenthol-analyze",
        description="Analyze a chess position with the bundled engines.",
    )
    p.add_argument("--fen", required=True, help="Position to analyze (FEN).")
    p.add_argument("--depth", type=int, default=18, help="Search depth.")
    p.add_argument("--lines", type=int, default=3, help="Number of PV lines.")
    p.add_argument("--engine", default="stockfish",
                   choices=["stockfish", "stockfish_lite"])
    p.add_argument("--prev-fen", default=None,
                   help="Position the --move was played from (enables classification).")
    p.add_argument("--move", default=None, help="UCI move played from --prev-fen.")
    return p


def format_lines(board: chess.Board, analysis: AnalysisInfo) -> str:
    rows = []
    for line in analysis.lines:
        san = board.variation_san(line.pv) if line.pv else ""
        rows.append(f"  [{line.multipv}] {line.eval.format_white():>7}  {san}")
    return "\n".join(rows)


def format_report(board: chess.Board, analysis: AnalysisInfo,
                  classification: Optional[Classification]) -> str:
    parts = [
        f"FEN: {board.fen()}",
        f"Depth: {analysis.depth}",
        "Lines:",
        format_lines(board, analysis),
    ]
    if classification is not None:
        parts.append(
            f"Move class: {classification.label.value} "
            f"(cpl={classification.cpl}, best={classification.is_best})"
        )
    return "\n".join(parts)


def run(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    board = chess.Board(args.fen)
    with EngineManager() as em:
        em.select(args.engine)
        analysis = em.analyze(board, depth=args.depth, multipv=args.lines)
        classification = None
        if args.prev_fen and args.move:
            prev = chess.Board(args.prev_fen)
            move = chess.Move.from_uci(args.move)
            after = prev.copy()
            after.push(move)
            before_a = em.analyze(prev, depth=args.depth, multipv=args.lines)
            after_a = em.analyze(after, depth=args.depth, multipv=args.lines)
            classification = classify_move(prev, move, before_a, after_a)
    print(format_report(board, analysis, classification))
    return 0


def main() -> None:
    raise SystemExit(run())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_cli.py -q`
Expected: PASS (hermetic tests pass; the `@pytest.mark.engine` smoke test passes with Stockfish or skips)

- [ ] **Step 5: Run the whole suite**

Run: `.venv/bin/pytest -q`
Expected: PASS / skipped (no failures). Engine tests run only if Stockfish is installed.

- [ ] **Step 6: Manual end-to-end check (requires Stockfish)**

Run:
```bash
.venv/bin/chessmenthol-analyze --fen "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2" --depth 14 --lines 3
```
Expected: prints `FEN:`, `Depth:`, and three evaluated `Lines:` with SAN moves.

- [ ] **Step 7: Commit**

```bash
git add chessmenthol/cli.py tests/test_cli.py
git commit -m "feat(cli): add analyze command tying engine and classification together"
```

---

## Self-Review (completed by author)

**Spec coverage (Milestone 1 scope only):**
- Engine download + bundle (§2 Goals, §6.5, §9 Packaging) → Task 1 (`scripts/fetch_engines.py` + bundled-binary resolution in Task 4). ✓
- Engine module §6.5 (two presets, single active, configure, analyze, auto-restart, switch) → Tasks 4–6. ✓
- Move classification §6.6 (full taxonomy + tunable thresholds + book) → Tasks 7–10. ✓
- Analysis types (multi-PV, eval incl. mate) → Tasks 2–3. ✓
- CLI validation of the core (build order milestone 1) → Task 11. ✓
- Out of Milestone 1 by design (future plans): capture, board_detect, piece_classify, position, FastAPI/WebSocket, frontend, packaging. These belong to Milestones 2–5 and get their own plans.

**Placeholder scan:** No TBD/TODO; every code step contains complete code. Sacrifice detection and thresholds are explicitly documented v1 heuristics, not placeholders.

**Type consistency:** `Eval`, `Line`, `AnalysisInfo` (Tasks 2–3) are used unchanged in `classify_move` (Tasks 9–10) and the CLI (Task 11). `EngineManager.analyze(...)` signature is identical in Tasks 5, 6, and 11. `Classification`/`MoveClass` names match across `classify.py`, `test_classify.py`, and `cli.py`. `BookLookup.contains_move` matches `NoBook`, `PolyglotBook`, the `AlwaysBook` test fake, and the call site in `classify_move`.

## Notes for later milestones
- Milestone 2 (frontend skeleton) will add the FastAPI + WebSocket bridge and the chessground UI, driven by `EngineManager` + `classify_move` from this milestone.
- `default_registry()` currently points both presets at one downloaded binary, differing only by UCI options (Lite = Threads 1 / Hash 64). Packaging (Milestone 5) can extend `fetch_engines.py` to also stage a distinct lighter Lite net/binary and a bundled Polyglot book for the "Book" class.
- `fetch_engines.py` is reused by the Milestone 5 packaging step (run per-OS in CI before PyInstaller) so each platform build bundles its own Stockfish.
