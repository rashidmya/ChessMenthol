from __future__ import annotations

import cv2
import numpy as np

from chessmenthol.vision.capture import Capturer
from chessmenthol.vision.cli import main
from chessmenthol.vision.types import Monitor
from tests.vision.fakes import FakeBackend
from tests.vision.synthetic import render_board


def test_cli_writes_overlay_for_a_board_image(tmp_path):
    img, _ = render_board(square=40, margin=24)
    src = tmp_path / "board.png"
    cv2.imwrite(str(src), img)
    out = tmp_path / "overlay.png"
    rc = main([str(src), "-o", str(out)])
    assert rc == 0
    assert out.exists()
    assert cv2.imread(str(out)) is not None


def test_cli_dumps_square_crops(tmp_path):
    img, _ = render_board(square=40, margin=24)
    src = tmp_path / "board.png"
    cv2.imwrite(str(src), img)
    squares = tmp_path / "squares"
    rc = main([str(src), "-o", str(tmp_path / "o.png"), "--squares-dir", str(squares)])
    assert rc == 0
    assert len(list(squares.glob("*.png"))) == 64


def test_cli_returns_nonzero_on_no_board(tmp_path):
    noise = np.random.default_rng(0).integers(0, 255, (300, 300, 3), dtype=np.uint8)
    src = tmp_path / "noise.png"
    cv2.imwrite(str(src), noise)
    rc = main([str(src), "-o", str(tmp_path / "o.png")])
    assert rc == 1


def test_cli_list_monitors_uses_injected_capturer(capsys):
    backend = FakeBackend([Monitor(0, 0, 0, 1920, 1080)], [np.zeros((4, 4, 3), np.uint8)])
    rc = main(["--list-monitors"], capturer=Capturer(backend=backend))
    assert rc == 0
    assert "1920" in capsys.readouterr().out
