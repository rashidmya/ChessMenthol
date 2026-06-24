import io
import tarfile

import pytest

from scripts.fetch_engines import _binary_member, _extract_binary, select_asset

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


def test_binary_member_finds_top_level_entry():
    assert _binary_member(["stockfish"]) == "stockfish"


def test_binary_member_finds_nested_entry():
    names = ["stockfish/", "stockfish/stockfish-ubuntu-x86-64-avx2"]
    assert _binary_member(names) == "stockfish/stockfish-ubuntu-x86-64-avx2"


def test_select_asset_raises_when_nothing_matches():
    with pytest.raises(RuntimeError, match="No suitable"):
        select_asset(["unrelated-file.tar"], "Linux", "x86_64")


def test_extract_binary_from_tar_writes_executable(tmp_path):
    data = b"#!/bin/sh\necho sf\n"
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        info = tarfile.TarInfo("stockfish/stockfish-ubuntu-x86-64-avx2")
        info.size = len(data)
        tf.addfile(info, io.BytesIO(data))
    out = _extract_binary(buf.getvalue(), "stockfish-ubuntu-x86-64-avx2.tar", tmp_path)
    assert out.name == "stockfish"
    assert out.read_bytes() == data
    assert out.stat().st_mode & 0o111  # executable bit set
