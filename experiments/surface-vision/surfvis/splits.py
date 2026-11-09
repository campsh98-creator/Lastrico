"""Geographic group splits — never a random image-level split.

Design (predeclared, see README):
1. TEST = the dataset's own held-out geography (StreetSurfaceVis ``train=False``:
   five German cities excluded from training by the dataset authors).
2. Every image is assigned to a lat/lon grid cell (default 0.5° x 0.5°).
   Cells that contain any test image are removed from the train/calibration pool
   entirely ("test-cell purge").
3. CALIBRATION = whole cells chosen deterministically by SHA-256 hash order of the
   cell id (salted), added until the target fraction is reached and every class
   has at least ``min_per_class`` calibration images (labels are used only for
   class presence, never for performance).
4. TRAIN = remaining cells, minus any image within ``buffer_km`` of a calibration
   or test image (boundary purge).
Leakage diagnostics: shared cells, shared image ids, minimum cross-split distance,
and shared contributors (reported, not enforced).
"""

from __future__ import annotations

import hashlib
from collections import Counter

import numpy as np

EARTH_RADIUS_KM = 6371.0088


def cell_ids(lat, lon, cell_deg: float = 0.5) -> list[str]:
    lat = np.asarray(lat, dtype=np.float64)
    lon = np.asarray(lon, dtype=np.float64)
    iy = np.floor(lat / cell_deg).astype(np.int64)
    ix = np.floor(lon / cell_deg).astype(np.int64)
    return [f"{cell_deg}:{a}:{b}" for a, b in zip(iy.tolist(), ix.tolist())]


def _hash_key(cell: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}|{cell}".encode()).hexdigest()


def haversine_min_km(lat_a, lon_a, lat_b, lon_b, chunk: int = 2048) -> np.ndarray:
    """For every point in A, the great-circle distance (km) to its nearest point in B."""
    lat_a, lon_a = np.radians(np.asarray(lat_a, float)), np.radians(np.asarray(lon_a, float))
    lat_b, lon_b = np.radians(np.asarray(lat_b, float)), np.radians(np.asarray(lon_b, float))
    out = np.full(lat_a.shape, np.inf)
    if lat_b.size == 0 or lat_a.size == 0:
        return out
    cos_b = np.cos(lat_b)
    for s in range(0, lat_a.size, chunk):
        la, lo = lat_a[s:s + chunk, None], lon_a[s:s + chunk, None]
        h = np.sin((lat_b[None, :] - la) / 2) ** 2 + np.cos(la) * cos_b[None, :] * np.sin((lon_b[None, :] - lo) / 2) ** 2
        d = 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(h, 0.0, 1.0)))
        out[s:s + chunk] = d.min(axis=1)
    return out


def geographic_split(lat, lon, labels, is_test, *, cell_deg: float = 0.5, cal_fraction: float = 0.2,
                     min_per_class: int = 10, buffer_km: float = 2.0, salt: str = "lastrico-phase420-sv") -> dict:
    """Return dict with integer index arrays ``train``, ``calibration``, ``test``,
    ``purged`` and a ``summary``. ``labels`` are class indices or names."""
    lat = np.asarray(lat, dtype=np.float64)
    lon = np.asarray(lon, dtype=np.float64)
    labels = np.asarray(labels)
    is_test = np.asarray(is_test, dtype=bool)
    n = lat.size
    if not (lon.size == labels.size == is_test.size == n):
        raise ValueError("length mismatch")
    if not np.all(np.isfinite(lat)) or not np.all(np.isfinite(lon)):
        raise ValueError("non-finite coordinates")
    cells = np.asarray(cell_ids(lat, lon, cell_deg))
    test_idx = np.flatnonzero(is_test)
    test_cells = set(cells[test_idx].tolist())
    pool = np.flatnonzero(~is_test)
    purged_test_cell = pool[np.isin(cells[pool], list(test_cells))]
    pool = pool[~np.isin(cells[pool], list(test_cells))]

    pool_cells = sorted(set(cells[pool].tolist()), key=lambda c: _hash_key(c, salt))
    classes = sorted(set(labels.tolist()))
    target = cal_fraction * pool.size
    cal_cells: list[str] = []
    cal_count = 0
    class_counts: Counter = Counter()
    by_cell = {c: pool[cells[pool] == c] for c in pool_cells}

    def need_more() -> bool:
        if cal_count < target:
            return True
        return any(class_counts[c] < min_per_class for c in classes)

    remaining = list(pool_cells)
    while remaining and need_more():
        if cal_count >= target:
            # only class presence is missing: take the next hashed cell that adds a missing class
            missing = {c for c in classes if class_counts[c] < min_per_class}
            pick = next((c for c in remaining if missing & set(labels[by_cell[c]].tolist())), None)
            if pick is None:
                break
        else:
            pick = remaining[0]
        remaining.remove(pick)
        # never let calibration swallow the whole pool
        if len(remaining) == 0 and cal_cells:
            remaining.append(pick)
            break
        cal_cells.append(pick)
        idx = by_cell[pick]
        cal_count += idx.size
        class_counts.update(labels[idx].tolist())

    cal_mask = np.isin(cells, cal_cells) & ~is_test
    cal_idx = np.flatnonzero(cal_mask)
    train_candidates = np.setdiff1d(pool, cal_idx)

    # boundary purge: drop train images close to calibration or test images
    held = np.concatenate([cal_idx, test_idx])
    d_train = haversine_min_km(lat[train_candidates], lon[train_candidates], lat[held], lon[held])
    keep = d_train >= buffer_km
    train_idx = train_candidates[keep]
    purged_buffer_train = train_candidates[~keep]
    # calibration images too close to test images are also purged
    d_cal = haversine_min_km(lat[cal_idx], lon[cal_idx], lat[test_idx], lon[test_idx])
    purged_buffer_cal = cal_idx[d_cal < buffer_km]
    cal_idx = cal_idx[d_cal >= buffer_km]

    purged = np.concatenate([purged_test_cell, purged_buffer_train, purged_buffer_cal]).astype(np.int64)
    split = {
        "train": np.sort(train_idx).astype(np.int64),
        "calibration": np.sort(cal_idx).astype(np.int64),
        "test": np.sort(test_idx).astype(np.int64),
        "purged": np.sort(purged),
        "cells": cells,
    }
    split["summary"] = {
        "cell_deg": cell_deg, "cal_fraction_target": cal_fraction, "min_per_class": min_per_class,
        "buffer_km": buffer_km, "salt": salt,
        "n_total": int(n), "n_train": int(train_idx.size), "n_calibration": int(cal_idx.size),
        "n_test": int(test_idx.size), "n_purged_test_cells": int(purged_test_cell.size),
        "n_purged_buffer_train": int(purged_buffer_train.size),
        "n_purged_buffer_calibration": int(purged_buffer_cal.size),
        "n_cells_train": len(set(cells[train_idx].tolist())),
        "n_cells_calibration": len(set(cells[cal_idx].tolist())),
        "n_cells_test": len(test_cells),
        "class_counts": {
            part: {str(k): int(v) for k, v in sorted(Counter(labels[split[part]].tolist()).items())}
            for part in ("train", "calibration", "test")
        },
    }
    return split


def leakage_report(split: dict, lat, lon, image_ids, contributors=None) -> dict:
    """Cross-split leakage diagnostics. Cells/ids/distances must be zero/clean."""
    lat = np.asarray(lat, dtype=np.float64)
    lon = np.asarray(lon, dtype=np.float64)
    ids = np.asarray(image_ids).astype(str)
    cells = np.asarray(split["cells"])
    parts = ("train", "calibration", "test")
    rep = {}
    for i, a in enumerate(parts):
        for b in parts[i + 1:]:
            ia, ib = split[a], split[b]
            shared_cells = set(cells[ia].tolist()) & set(cells[ib].tolist())
            shared_ids = set(ids[ia].tolist()) & set(ids[ib].tolist())
            dmin = haversine_min_km(lat[ia], lon[ia], lat[ib], lon[ib])
            entry = {
                "shared_cells": len(shared_cells),
                "shared_image_ids": len(shared_ids),
                "shared_indices": int(np.intersect1d(ia, ib).size),
                "min_distance_km": None if dmin.size == 0 or not np.isfinite(dmin.min()) else float(dmin.min()),
            }
            if contributors is not None:
                cu = np.asarray(contributors).astype(str)
                shared_users = set(cu[ia].tolist()) & set(cu[ib].tolist())
                entry["shared_contributors"] = len(shared_users)
                entry[f"fraction_{b}_images_by_contributor_seen_in_{a}"] = (
                    float(np.mean(np.isin(cu[ib], list(shared_users)))) if ib.size else None)
            rep[f"{a}__{b}"] = entry
    rep["image_level_leakage_total"] = int(sum(v["shared_image_ids"] + v["shared_indices"] for v in rep.values()
                                               if isinstance(v, dict)))
    rep["cell_level_leakage_total"] = int(sum(v["shared_cells"] for v in rep.values() if isinstance(v, dict)))
    return rep
