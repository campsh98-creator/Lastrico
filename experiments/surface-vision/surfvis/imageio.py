"""Image decoding, focal crop and resize.

StreetSurfaceVis labels the road in the focal area (bottom-centre of the image);
the dataset authors recommend cropping x in [0.25W, 0.75W], y in [0.5H, H]. We
follow that recommendation exactly and do not apply EXIF transposition (the
authors' reference snippet does not either).
"""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
from PIL import Image

from . import WORK_SIZE

CROP_BOX = (0.25, 0.5, 0.75, 1.0)  # fractions (left, top, right, bottom)


def _open(source) -> Image.Image:
    if isinstance(source, (bytes, bytearray, memoryview)):
        return Image.open(io.BytesIO(bytes(source)))
    if isinstance(source, (str, Path)):
        return Image.open(source)
    if isinstance(source, np.ndarray):
        return Image.fromarray(source)
    raise TypeError(f"unsupported image source: {type(source)!r}")


def load_focal_rgb(source, work_size=WORK_SIZE, crop_box=CROP_BOX) -> np.ndarray:
    """Decode an image, crop the focal road area and resize to ``work_size``.

    Returns a ``(height, width, 3)`` uint8 array. JPEG decoding uses Pillow's
    deterministic DCT-domain ``draft`` reduction when the full image is at least
    twice the needed size, which keeps phase-2 feature extraction fast.
    """
    w_out, h_out = work_size
    img = _open(source)
    fx0, fy0, fx1, fy1 = crop_box
    need_w = int(np.ceil(w_out / (fx1 - fx0)))
    need_h = int(np.ceil(h_out / (fy1 - fy0)))
    if getattr(img, "format", None) == "JPEG":
        img.draft("RGB", (need_w, need_h))
    img = img.convert("RGB")
    w, h = img.size
    box = (
        int(round(fx0 * w)),
        int(round(fy0 * h)),
        int(round(fx1 * w)),
        int(round(fy1 * h)),
    )
    if box[2] - box[0] < 8 or box[3] - box[1] < 8:
        raise ValueError(f"image too small for focal crop: {img.size}")
    img = img.crop(box).resize((w_out, h_out), Image.Resampling.BILINEAR)
    arr = np.asarray(img, dtype=np.uint8)
    if arr.shape != (h_out, w_out, 3):  # pragma: no cover - defensive
        raise ValueError(f"unexpected shape {arr.shape}")
    return arr
