"""End-to-end experiment: features -> geographic split -> models -> metrics.

``run_experiment`` is deterministic given the feature matrix; timings are kept
out of its result so results.json can be compared byte-for-byte across runs.
"""

from __future__ import annotations

import hashlib
import time
from pathlib import Path

import numpy as np

from . import CLASSES, FEATURE_VERSION, PAVE_CLASS, WORK_SIZE
from . import features as F
from . import metrics as M
from . import models as MD
from . import splits as S
from .data import ImageReader
from .imageio import load_focal_rgb

DEFAULT_CONFIG = {
    "cell_deg": 0.5,
    "cal_fraction": 0.2,
    "min_per_class": 10,
    "buffer_km": 2.0,
    "salt": "lastrico-phase420-sv",
    "seed": 420,
    "abstention_target_accuracy": 0.90,
    "abstention_min_accepted": 20,
    "pave_target_precision": 0.80,
    "pave_min_predicted": 10,
}

# Predeclared phase-2 success criteria (written before any real data is seen).
PREDECLARED_CRITERIA = {
    "primary_model": MD.PRIMARY_MODEL,
    "evaluated_on": "official StreetSurfaceVis test cities (train=False), never used for fitting, calibration or thresholds",
    "criteria": [
        "sett recall >= 0.70 at argmax decision on test, with Wilson 95% lower bound reported",
        "sett precision >= 0.70 at argmax decision on test, with Wilson 95% lower bound reported",
        "macro-F1 of primary model exceeds colour-only baseline by >= 0.10",
        "top-label ECE <= 0.10 after calibration",
        "zero image-level and cell-level leakage between train, calibration and test",
    ],
    "interpretation": "Meeting all criteria only justifies an Italian human-labelled evaluation; it never justifies product integration.",
}


def _hash_array(a: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()


def extract_features(records, progress_every: int = 0):
    """Return (X, names, colour_mask, ok_index, failures, seconds)."""
    names, colour_mask = F.feature_names()
    rows, ok, failures = [], [], []
    t0 = time.perf_counter()
    with ImageReader() as reader:
        for i, rec in enumerate(records):
            try:
                src = reader.read(rec)
                rgb = load_focal_rgb(src, WORK_SIZE)
                v, n, _ = F.extract(rgb)
                if n != names:
                    raise RuntimeError("feature name drift")
                rows.append(v)
                ok.append(i)
            except Exception as exc:  # recorded, never silently dropped
                failures.append({"image_id": rec.image_id, "error": f"{type(exc).__name__}: {exc}"[:300]})
            if progress_every and (i + 1) % progress_every == 0:
                print(f"  features {i + 1}/{len(records)} ({time.perf_counter() - t0:.1f}s)", flush=True)
    X = np.vstack(rows) if rows else np.zeros((0, len(names)))
    return X, names, colour_mask, np.asarray(ok, dtype=np.int64), failures, time.perf_counter() - t0


def load_or_extract(records, cache_path: Path | None, progress_every: int = 0):
    key = hashlib.sha256(("|".join(r.image_id for r in records) + FEATURE_VERSION + str(WORK_SIZE)).encode()).hexdigest()
    if cache_path is not None and cache_path.exists():
        z = np.load(cache_path, allow_pickle=False)
        if str(z["key"]) == key:
            return (z["X"], [str(x) for x in z["names"]], z["colour_mask"], z["ok"],
                    [{"image_id": a, "error": b} for a, b in zip(z["fail_ids"].tolist(), z["fail_err"].tolist())], 0.0, True)
    X, names, cmask, ok, failures, secs = extract_features(records, progress_every)
    if cache_path is not None:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(cache_path, key=key, X=X, names=np.asarray(names), colour_mask=cmask, ok=ok,
                            fail_ids=np.asarray([f["image_id"] for f in failures], dtype=str),
                            fail_err=np.asarray([f["error"] for f in failures], dtype=str))
    return X, names, cmask, ok, failures, secs, False


def _sett_binary(proba, y, threshold):
    k = CLASSES.index(PAVE_CLASS)
    return M.binary_report(proba[:, k], (y == k).astype(np.int64), threshold)


def run_experiment(records, X, names, colour_mask, config=None, dataset_label="unknown"):
    cfg = dict(DEFAULT_CONFIG, **(config or {}))
    timings = {}
    n_classes = len(CLASSES)
    y = np.asarray([CLASSES.index(r.label) for r in records], dtype=np.int64)
    lat = np.asarray([r.lat for r in records])
    lon = np.asarray([r.lon for r in records])
    is_test = np.asarray([r.is_test for r in records], dtype=bool)
    ids = [r.image_id for r in records]
    contrib = [r.contributor for r in records]

    split = S.geographic_split(lat, lon, y, is_test, cell_deg=cfg["cell_deg"], cal_fraction=cfg["cal_fraction"],
                               min_per_class=cfg["min_per_class"], buffer_km=cfg["buffer_km"], salt=cfg["salt"])
    leak = S.leakage_report(split, lat, lon, ids, contrib)
    tr, ca, te = split["train"], split["calibration"], split["test"]
    if tr.size == 0 or ca.size == 0 or te.size == 0:
        raise ValueError(f"empty split: train={tr.size} cal={ca.size} test={te.size}")

    k_sett = CLASSES.index(PAVE_CLASS)
    seen_users = set(np.asarray(contrib)[tr].tolist())
    unseen_mask = np.asarray([contrib[i] not in seen_users for i in te])
    test_cells = np.asarray(split["cells"])[te]
    test_quality = np.asarray([records[i].quality for i in te])

    models_out = {}
    for name in MD.model_specs(cfg["seed"]):
        t0 = time.perf_counter()
        model = MD.fit_and_calibrate(name, X[tr], y[tr], X[ca], y[ca], colour_mask, seed=cfg["seed"])
        timings[f"fit_{name}_s"] = time.perf_counter() - t0
        p_cal = MD.predict(model, X[ca], n_classes)
        p_te = MD.predict(model, X[te], n_classes)
        pred_cal, conf_cal = M.top_label(p_cal)
        abst = M.select_abstention_threshold(conf_cal, (pred_cal == y[ca]).astype(float),
                                             cfg["abstention_target_accuracy"], cfg["abstention_min_accepted"])
        pave_thr = M.select_precision_threshold(p_cal[:, k_sett], (y[ca] == k_sett).astype(int),
                                                cfg["pave_target_precision"], cfg["pave_min_predicted"])
        entry = {
            "calibrated": model["calibrated"],
            "n_features": int(model["cols"].sum()),
            "calibration_split": M.multiclass_report(p_cal, y[ca], CLASSES),
            "test": M.multiclass_report(p_te, y[te], CLASSES, abstain_threshold=abst["threshold"]),
            "abstention_selection_on_calibration": abst,
            "sett_vs_rest_test_argmax_equivalent": None,
            "sett_vs_rest_test_p050": _sett_binary(p_te, y[te], 0.5),
            "sett_threshold_selection_on_calibration": pave_thr,
            "sett_vs_rest_test_at_calibration_threshold": (
                _sett_binary(p_te, y[te], pave_thr["threshold"]) if pave_thr["reached"] else None),
        }
        # argmax decision for sett (what the 5-class model actually outputs)
        pred_te = p_te.argmax(axis=1)
        cm_b = M.confusion_matrix((y[te] == k_sett).astype(int), (pred_te == k_sett).astype(int), 2)
        tn, fp, fn, tp = (int(v) for v in cm_b.ravel())
        entry["sett_vs_rest_test_argmax_equivalent"] = {
            "tn": tn, "fp": fp, "fn": fn, "tp": tp,
            "precision": tp / (tp + fp) if tp + fp else 0.0, "recall": tp / (tp + fn) if tp + fn else 0.0,
            "precision_wilson95": M.wilson_interval(tp, tp + fp), "recall_wilson95": M.wilson_interval(tp, tp + fn),
        }
        if name == MD.PRIMARY_MODEL:
            per_cell = {}
            for c in sorted(set(test_cells.tolist())):
                m = test_cells == c
                yy, pp = y[te][m], pred_te[m]
                s_m = yy == k_sett
                per_cell[c] = {"n": int(m.sum()), "accuracy": float(np.mean(yy == pp)),
                               "sett_support": int(s_m.sum()),
                               "sett_recall": float(np.mean(pp[s_m] == k_sett)) if s_m.any() else None}
            entry["test_per_cell"] = per_cell
            if unseen_mask.any():
                entry["test_contributors_unseen_in_train"] = M.multiclass_report(
                    p_te[unseen_mask], y[te][unseen_mask], CLASSES)
                for drop in ("coverage_accuracy_curve", "reliability_bins"):
                    entry["test_contributors_unseen_in_train"].pop(drop, None)
            entry["sett_recall_by_quality_test"] = {
                q: {"n": int(((y[te] == k_sett) & (test_quality == q)).sum()),
                    "recall": float(np.mean(pred_te[(y[te] == k_sett) & (test_quality == q)] == k_sett))}
                for q in sorted(set(test_quality[y[te] == k_sett].tolist()))
            }
        models_out[name] = entry

    result = {
        "kind": dataset_label,
        "classes": list(CLASSES),
        "pave_class": PAVE_CLASS,
        "feature_version": FEATURE_VERSION,
        "work_size_wh": list(WORK_SIZE),
        "n_features": len(names),
        "n_colour_features": int(np.sum(colour_mask)),
        "feature_matrix_sha256": _hash_array(X),
        "config": cfg,
        "predeclared_criteria": PREDECLARED_CRITERIA,
        "split": split["summary"],
        "leakage": leak,
        "test_contributor_unseen_fraction": float(unseen_mask.mean()),
        "models": models_out,
    }
    result["criteria_check"] = criteria_check(result)
    return result, timings


def criteria_check(result) -> dict:
    prim = result["models"][MD.PRIMARY_MODEL]
    base = result["models"]["colour_logistic"]
    sett = prim["sett_vs_rest_test_argmax_equivalent"]
    checks = {
        "sett_recall_ge_0.70": sett["recall"] >= 0.70,
        "sett_precision_ge_0.70": sett["precision"] >= 0.70,
        "macro_f1_gain_vs_colour_ge_0.10": prim["test"]["macro_f1"] - base["test"]["macro_f1"] >= 0.10,
        "ece_le_0.10": prim["test"]["ece_top_label"] <= 0.10,
        "zero_leakage": result["leakage"]["image_level_leakage_total"] == 0
        and result["leakage"]["cell_level_leakage_total"] == 0,
    }
    checks["all_met"] = all(checks.values())
    return checks
