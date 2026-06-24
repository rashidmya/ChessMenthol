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
