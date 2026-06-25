from __future__ import annotations

import json
import pathlib

import cv2
import pytest

from chessmenthol.vision.detect import detect
from chessmenthol.vision.types import Frame, Region
from tests.vision.helpers import iou

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
GROUND_TRUTH = FIXTURES / "ground_truth.json"


def _cases():
    if not GROUND_TRUTH.exists():
        return []
    return sorted(json.loads(GROUND_TRUTH.read_text()).items())


@pytest.mark.parametrize("name,box", _cases())
def test_detect_on_realistic_fixture(name, box):
    image = cv2.imread(str(FIXTURES / name))
    assert image is not None, f"missing fixture {name}"
    loc = detect(Frame(image))
    assert loc is not None, f"no board detected in {name}"
    truth = Region(box["left"], box["top"], box["width"], box["height"])
    assert iou(loc.bbox, truth) > 0.9, f"low IoU on {name}: {iou(loc.bbox, truth):.3f}"
