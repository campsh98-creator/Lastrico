"""Evaluation metrics implemented explicitly so they can be checked by hand.

Conventions (documented in README):
* Undefined precision/recall/F1 (0/0) are reported as 0.0 with ``defined=False``.
* Multiclass Brier = mean over samples of sum_k (p_k - y_k)^2 (range 0..2).
* ECE = top-label expected calibration error with equal-width bins on [0, 1];
  a confidence of exactly 1.0 falls in the last bin.
* The abstention threshold is selected on the calibration split only.
"""

from __future__ import annotations

import math

import numpy as np


def confusion_matrix(y_true, y_pred, n_classes: int) -> np.ndarray:
    y_true = np.asarray(y_true, dtype=np.int64)
    y_pred = np.asarray(y_pred, dtype=np.int64)
    if y_true.shape != y_pred.shape:
        raise ValueError("shape mismatch")
    if y_true.size and (y_true.min() < 0 or y_pred.min() < 0 or y_true.max() >= n_classes or y_pred.max() >= n_classes):
        raise ValueError("label out of range")
    cm = np.bincount(y_true * n_classes + y_pred, minlength=n_classes * n_classes)
    return cm.reshape(n_classes, n_classes)


def per_class_prf(cm: np.ndarray, class_names=None) -> list[dict]:
    cm = np.asarray(cm, dtype=np.float64)
    n = cm.shape[0]
    out = []
    for k in range(n):
        tp = cm[k, k]
        pred_pos = cm[:, k].sum()
        support = cm[k, :].sum()
        p_def, r_def = pred_pos > 0, support > 0
        p = tp / pred_pos if p_def else 0.0
        r = tp / support if r_def else 0.0
        f_def = p_def and r_def and (p + r) > 0
        f = 2 * p * r / (p + r) if f_def else 0.0
        out.append({
            "class": class_names[k] if class_names is not None else k,
            "precision": float(p), "recall": float(r), "f1": float(f),
            "support": int(support), "predicted": int(pred_pos), "tp": int(tp),
            "precision_defined": bool(p_def), "recall_defined": bool(r_def),
        })
    return out


def macro_f1(cm: np.ndarray, only_present: bool = True) -> float:
    rows = per_class_prf(cm)
    if only_present:
        rows = [r for r in rows if r["support"] > 0]
    return float(np.mean([r["f1"] for r in rows])) if rows else 0.0


def accuracy(cm: np.ndarray) -> float:
    cm = np.asarray(cm, dtype=np.float64)
    tot = cm.sum()
    return float(np.trace(cm) / tot) if tot > 0 else 0.0


def one_hot(y, n_classes: int) -> np.ndarray:
    y = np.asarray(y, dtype=np.int64)
    out = np.zeros((y.size, n_classes), dtype=np.float64)
    out[np.arange(y.size), y] = 1.0
    return out


def brier_multiclass(proba, y_true) -> float:
    proba = np.asarray(proba, dtype=np.float64)
    if proba.ndim != 2:
        raise ValueError("proba must be 2-D")
    y = one_hot(y_true, proba.shape[1])
    return float(np.mean(np.sum((proba - y) ** 2, axis=1)))


def brier_binary(p, y) -> float:
    p = np.asarray(p, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    return float(np.mean((p - y) ** 2))


def reliability(confidence, correct, n_bins: int = 10) -> dict:
    """Equal-width reliability bins and ECE for (confidence, correctness) pairs."""
    c = np.asarray(confidence, dtype=np.float64)
    ok = np.asarray(correct, dtype=np.float64)
    if c.size == 0:
        return {"ece": 0.0, "mce": 0.0, "n": 0, "bins": []}
    idx = np.minimum(np.floor(c * n_bins).astype(np.int64), n_bins - 1)
    idx = np.maximum(idx, 0)
    bins, ece, mce = [], 0.0, 0.0
    for b in range(n_bins):
        m = idx == b
        cnt = int(m.sum())
        if cnt == 0:
            bins.append({"lo": b / n_bins, "hi": (b + 1) / n_bins, "count": 0,
                         "mean_confidence": None, "accuracy": None})
            continue
        mc, acc = float(c[m].mean()), float(ok[m].mean())
        gap = abs(mc - acc)
        ece += cnt / c.size * gap
        mce = max(mce, gap)
        bins.append({"lo": b / n_bins, "hi": (b + 1) / n_bins, "count": cnt,
                     "mean_confidence": mc, "accuracy": acc})
    return {"ece": float(ece), "mce": float(mce), "n": int(c.size), "bins": bins}


def top_label(proba):
    proba = np.asarray(proba, dtype=np.float64)
    return proba.argmax(axis=1), proba.max(axis=1)


def select_abstention_threshold(confidence, correct, target_accuracy: float = 0.9,
                                min_accepted: int = 20, grid=None) -> dict:
    """Smallest threshold t such that accepted (conf >= t) accuracy >= target.

    Must be called on CALIBRATION data only. If no threshold reaches the target
    with at least ``min_accepted`` accepted samples, returns t = 1.0 + eps
    (abstain on everything) and ``reached=False``.
    """
    c = np.asarray(confidence, dtype=np.float64)
    ok = np.asarray(correct, dtype=np.float64)
    if grid is None:
        grid = np.round(np.arange(0.0, 1.0001, 0.01), 2)
    for t in grid:
        m = c >= t
        n = int(m.sum())
        if n < min_accepted:
            continue
        acc = float(ok[m].mean())
        if acc >= target_accuracy:
            return {"threshold": float(t), "reached": True, "calibration_accuracy": acc,
                    "calibration_coverage": float(n / c.size), "calibration_accepted": n,
                    "target_accuracy": target_accuracy, "min_accepted": min_accepted}
    return {"threshold": 1.0 + 1e-9, "reached": False, "calibration_accuracy": None,
            "calibration_coverage": 0.0, "calibration_accepted": 0,
            "target_accuracy": target_accuracy, "min_accepted": min_accepted}


def select_precision_threshold(p_pos, y_bin, target_precision: float = 0.8, min_predicted: int = 10,
                               grid=None) -> dict:
    """Smallest threshold on p(positive) whose CALIBRATION precision >= target."""
    p = np.asarray(p_pos, dtype=np.float64)
    y = np.asarray(y_bin, dtype=np.int64)
    if grid is None:
        grid = np.round(np.arange(0.05, 1.0001, 0.01), 2)
    for t in grid:
        m = p >= t
        n = int(m.sum())
        if n < min_predicted:
            continue
        prec = float(y[m].mean())
        if prec >= target_precision:
            return {"threshold": float(t), "reached": True, "calibration_precision": prec,
                    "calibration_recall": float(y[m].sum() / max(int(y.sum()), 1)),
                    "calibration_predicted": n, "target_precision": target_precision}
    return {"threshold": None, "reached": False, "target_precision": target_precision,
            "min_predicted": min_predicted}


def coverage_accuracy_curve(confidence, correct, thresholds=None) -> list[dict]:
    """Descriptive curve; never used to select anything on test data."""
    c = np.asarray(confidence, dtype=np.float64)
    ok = np.asarray(correct, dtype=np.float64)
    if thresholds is None:
        thresholds = np.round(np.arange(0.0, 1.0001, 0.05), 2)
    out = []
    for t in thresholds:
        m = c >= t
        n = int(m.sum())
        out.append({"threshold": float(t), "coverage": float(n / c.size) if c.size else 0.0,
                    "accepted": n, "accuracy": float(ok[m].mean()) if n else None})
    return out


def wilson_interval(k: int, n: int, z: float = 1.959963984540054):
    if n <= 0:
        return (None, None)
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0.0, centre - half), min(1.0, centre + half))


def average_precision(y_bin, scores) -> float | None:
    """Step-wise AP (same definition as sklearn.metrics.average_precision_score)."""
    y = np.asarray(y_bin, dtype=np.int64)
    s = np.asarray(scores, dtype=np.float64)
    pos = int(y.sum())
    if pos == 0:
        return None
    order = np.argsort(-s, kind="mergesort")
    s_sorted, y_sorted = s[order], y[order]
    # group ties: evaluate precision/recall at distinct score thresholds
    distinct = np.r_[np.flatnonzero(np.diff(s_sorted)), y.size - 1]
    tps = np.cumsum(y_sorted)[distinct]
    fps = (distinct + 1) - tps
    precision = tps / (tps + fps)
    recall = tps / pos
    recall_prev = np.r_[0.0, recall[:-1]]
    return float(np.sum((recall - recall_prev) * precision))


def binary_report(p_pos, y_bin, threshold: float = 0.5) -> dict:
    p = np.asarray(p_pos, dtype=np.float64)
    y = np.asarray(y_bin, dtype=np.int64)
    pred = (p >= threshold).astype(np.int64)
    cm = confusion_matrix(y, pred, 2)
    tn, fp, fn, tp = (int(v) for v in cm.ravel())
    prec = tp / (tp + fp) if (tp + fp) else 0.0
    rec = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
    rel = reliability(p, y, 10)  # calibration of p(positive) vs positive frequency
    return {
        "threshold": float(threshold), "tn": tn, "fp": fp, "fn": fn, "tp": tp,
        "precision": float(prec), "recall": float(rec), "f1": float(f1),
        "precision_wilson95": wilson_interval(tp, tp + fp),
        "recall_wilson95": wilson_interval(tp, tp + fn),
        "average_precision": average_precision(y, p), "prevalence": float(y.mean()) if y.size else None,
        "brier": brier_binary(p, y), "ece_positive_probability": rel["ece"],
        "reliability_bins": rel["bins"],
    }


def multiclass_report(proba, y_true, class_names, abstain_threshold: float | None = None) -> dict:
    proba = np.asarray(proba, dtype=np.float64)
    y_true = np.asarray(y_true, dtype=np.int64)
    k = len(class_names)
    pred, conf = top_label(proba)
    cm = confusion_matrix(y_true, pred, k)
    correct = (pred == y_true).astype(np.float64)
    rel = reliability(conf, correct, 10)
    rep = {
        "n": int(y_true.size),
        "accuracy": accuracy(cm),
        "macro_f1": macro_f1(cm),
        "per_class": per_class_prf(cm, class_names),
        "confusion_matrix": {"rows_true_cols_pred": cm.tolist(), "labels": list(class_names)},
        "brier_multiclass": brier_multiclass(proba, y_true),
        "ece_top_label": rel["ece"],
        "mce_top_label": rel["mce"],
        "reliability_bins": rel["bins"],
        "coverage_accuracy_curve": coverage_accuracy_curve(conf, correct),
    }
    if abstain_threshold is not None:
        m = conf >= abstain_threshold
        n_acc = int(m.sum())
        sub = {"threshold": float(abstain_threshold), "coverage": float(n_acc / y_true.size) if y_true.size else 0.0,
               "accepted": n_acc, "accuracy_accepted": float(correct[m].mean()) if n_acc else None}
        if n_acc:
            cm_a = confusion_matrix(y_true[m], pred[m], k)
            sub["per_class_accepted"] = per_class_prf(cm_a, class_names)
            sub["confusion_matrix_accepted"] = cm_a.tolist()
        rep["abstention"] = sub
    return rep
