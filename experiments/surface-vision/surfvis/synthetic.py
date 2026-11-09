"""Deterministic SYNTHETIC textures for code tests only.

These procedurally generated pictures are not road photographs. Anything computed
on them (including classifier scores) verifies plumbing, determinism and label
alignment; it is never evidence of real-world accuracy.
"""

from __future__ import annotations

import numpy as np

from . import CLASSES
from .data import Record
from .features import box_blur

SYNTH_SHAPE = (384, 512)  # (height, width): the focal crop is then exactly 192 x 256


def _rng(seed: int) -> np.random.Generator:
    return np.random.Generator(np.random.PCG64(seed))


def _blocks(rng, h, w, bh, bw, joint, base_rgb, var, bond_offset=0.0, jitter=0):
    img = np.zeros((h, w, 3), dtype=np.float64)
    mask = np.zeros((h, w), dtype=bool)
    for row, y0 in enumerate(range(0, h, bh)):
        off = int(bond_offset * bw) if row % 2 else 0
        for x0 in range(-off, w, bw):
            jy = int(rng.integers(-jitter, jitter + 1)) if jitter else 0
            jx = int(rng.integers(-jitter, jitter + 1)) if jitter else 0
            ya, yb = max(0, y0 + jy), min(h, y0 + bh - joint + jy)
            xa, xb = max(0, x0 + jx), min(w, x0 + bw - joint + jx)
            if ya >= yb or xa >= xb:
                continue
            shade = 1.0 + rng.normal(0.0, var)
            img[ya:yb, xa:xb, :] = np.asarray(base_rgb) * shade
            mask[ya:yb, xa:xb] = True
    img[~mask] = np.asarray(base_rgb) * 0.35  # dark joints
    return img


def synth_texture(cls: str, seed: int, shape=SYNTH_SHAPE, brightness: float = 1.0) -> np.ndarray:
    if cls not in CLASSES:
        raise ValueError(cls)
    rng = _rng(seed)
    h, w = shape
    if cls == "asphalt":
        g = 0.33 + rng.normal(0.0, 0.09, (h, w))
        g = box_blur(g, 3)
        img = np.stack([g, g, g * 1.04], axis=-1)
    elif cls == "concrete":
        g = 0.66 + rng.normal(0.0, 0.03, (h, w))
        g = box_blur(g, 5)
        step = int(rng.integers(110, 140))
        g[:, ::step] *= 0.6
        img = np.stack([g, g * 0.99, g * 0.96], axis=-1)
    elif cls == "paving_stones":
        base = (0.62, 0.42, 0.36) if rng.random() < 0.5 else (0.55, 0.55, 0.53)
        img = _blocks(rng, h, w, bh=int(rng.integers(26, 32)), bw=int(rng.integers(52, 62)), joint=2,
                      base_rgb=base, var=0.04, bond_offset=0.5)
        img += rng.normal(0.0, 0.02, img.shape)
    elif cls == "sett":
        base = (0.50, 0.44, 0.44) if rng.random() < 0.5 else (0.46, 0.46, 0.47)
        s = int(rng.integers(14, 19))
        img = _blocks(rng, h, w, bh=s, bw=s + int(rng.integers(0, 4)), joint=3, base_rgb=base,
                      var=0.15, bond_offset=0.3, jitter=1)
        img += rng.normal(0.0, 0.04, img.shape)
    else:  # unpaved
        low = box_blur(rng.normal(0.0, 1.0, (h, w)), 31)
        low = low / (low.std() + 1e-9) * 0.08
        speck = rng.normal(0.0, 0.06, (h, w))
        g = 0.45 + low + speck
        img = np.stack([g, g * 0.80, g * 0.58], axis=-1)
    img = np.clip(img * brightness, 0.0, 1.0)
    return (img * 255.0 + 0.5).astype(np.uint8)


def synthetic_records(n_regions: int = 6, per_class: int = 6, test_regions=(4, 5), seed: int = 20261105):
    """Synthetic records with fake region coordinates (regions 1° apart).

    Each region has its own brightness factor to mimic a mild domain shift.
    """
    out = []
    for r in range(n_regions):
        lat0, lon0 = 45.0 + r * 1.0, 9.0 + (r % 2) * 1.0
        brightness = 0.85 + 0.06 * r
        for ci, cls in enumerate(CLASSES):
            for k in range(per_class):
                s = seed + r * 10_000 + ci * 100 + k
                rng = _rng(s)
                out.append(Record(
                    image_id=f"synthetic-{r}-{cls}-{k}", label=cls,
                    lat=lat0 + float(rng.uniform(0.0, 0.2)), lon=lon0 + float(rng.uniform(0.0, 0.2)),
                    is_test=r in test_regions, contributor=f"synthetic-user-{(r * 7 + k) % 5}",
                    source=synth_texture(cls, s, brightness=brightness),
                    extra={"synthetic": True},
                ))
    return out
