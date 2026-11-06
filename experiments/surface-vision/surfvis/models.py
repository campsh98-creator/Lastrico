"""Baselines and the predeclared classifier. Hyper-parameters are fixed in code;
there is no search, no test-set tuning and no model selection on test data.

* ``majority``        — training class priors (DummyClassifier 'prior'); not recalibrated.
* ``colour_logistic`` — multinomial logistic regression on colour features only.
* ``texture_logistic``— the same model on all features (secondary).
* ``texture_hgb``     — HistGradientBoosting on all features (PRIMARY, predeclared).
All non-majority models are calibrated on the calibration split with one-vs-rest
sigmoid calibration on top of the frozen fitted estimator.
"""

from __future__ import annotations

import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.frozen import FrozenEstimator
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

PRIMARY_MODEL = "texture_hgb"
# sklearn CalibratedClassifierCV (default cv=5) checks >= 5 examples per class even for a
# FrozenEstimator, whose calibrator is then fitted on all calibration predictions.
MIN_CAL_PER_CLASS = 5


def model_specs(seed: int = 420):
    """name -> (feature subset key, estimator factory, calibrate?)"""
    return {
        "majority": ("all", lambda: DummyClassifier(strategy="prior"), False),
        "colour_logistic": ("colour", lambda: make_pipeline(
            StandardScaler(), LogisticRegression(C=1.0, class_weight="balanced", max_iter=5000)), True),
        "texture_logistic": ("all", lambda: make_pipeline(
            StandardScaler(), LogisticRegression(C=0.5, class_weight="balanced", max_iter=5000)), True),
        "texture_hgb": ("all", lambda: HistGradientBoostingClassifier(
            learning_rate=0.05, max_iter=300, max_leaf_nodes=31, min_samples_leaf=20,
            l2_regularization=1.0, class_weight="balanced", early_stopping=False,
            random_state=seed), True),
    }


def full_proba(estimator, X, n_classes: int) -> np.ndarray:
    """predict_proba aligned to class indices 0..n_classes-1 (missing classes -> 0)."""
    p = estimator.predict_proba(X)
    out = np.zeros((X.shape[0], n_classes), dtype=np.float64)
    out[:, np.asarray(estimator.classes_, dtype=np.int64)] = p
    s = out.sum(axis=1, keepdims=True)
    return out / np.where(s > 0, s, 1.0)


def fit_and_calibrate(name, X_train, y_train, X_cal, y_cal, colour_mask, seed: int = 420):
    subset, factory, calibrate = model_specs(seed)[name]
    cols = colour_mask if subset == "colour" else np.ones(X_train.shape[1], dtype=bool)
    est = factory().fit(X_train[:, cols], y_train)
    raw = est
    if calibrate:
        counts = np.bincount(np.asarray(y_cal, dtype=np.int64), minlength=len(raw.classes_))
        if np.any(counts[np.asarray(raw.classes_, dtype=np.int64)] < MIN_CAL_PER_CLASS):
            raise ValueError(f"calibration split needs >= {MIN_CAL_PER_CLASS} images per class, got {counts.tolist()}")
        est = CalibratedClassifierCV(FrozenEstimator(raw), method="sigmoid").fit(X_cal[:, cols], y_cal)
    return {"estimator": est, "raw": raw, "cols": cols, "calibrated": calibrate}


def predict(model, X, n_classes: int, which: str = "estimator") -> np.ndarray:
    return full_proba(model[which], X[:, model["cols"]], n_classes)
