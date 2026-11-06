"""Reproducible offline surface experiment. No network, no production writes."""
import os
for _key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ[_key] = "1"

import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import platform
import resource
import subprocess
import time

import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, confusion_matrix, log_loss, precision_recall_curve, precision_recall_fscore_support
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

ROOT = Path(__file__).resolve().parents[2]
CENTER = (9.185, 45.465)
BUFFER_M = 200
SECTORS = ("SW", "SE", "NW", "NE")
SEED = 417
TAG_FEATURES = ("highway", "service", "junction", "bridge", "tunnel", "oneway", "lanes", "maxspeed", "lit", "sidewalk", "cycleway", "bicycle", "access")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def xy(coordinates):
    points = np.asarray(coordinates, dtype=float)
    return np.column_stack(((points[:, 0] - CENTER[0]) * 111320 * math.cos(math.radians(CENTER[1])), (points[:, 1] - CENTER[1]) * 111320))


def geographic_sector(row, buffer=BUFFER_M):
    if row["area"] != "milan":
        return None
    points = xy(row["coordinates"])
    west, east = np.all(points[:, 0] < -buffer), np.all(points[:, 0] > buffer)
    south, north = np.all(points[:, 1] < -buffer), np.all(points[:, 1] > buffer)
    return (("S" if south else "N") + ("W" if west else "E")) if (west or east) and (south or north) else None


def features(row):
    # Strict allowlist: evidence/labels/ID cannot enter the design matrix.
    result = {key: row["features"].get(key, "missing") for key in TAG_FEATURES}
    points = xy(row["coordinates"])
    delta = points[-1] - points[0]
    direct = float(np.linalg.norm(delta))
    result.update({"x_km": float(points[:, 0].mean() / 1000), "y_km": float(points[:, 1].mean() / 1000),
                   "log_length_m": math.log1p(row["length_m"]),
                   "sinuosity": min(10., row["length_m"] / max(1., direct)),
                   "axis_x": float(abs(delta[0]) / max(1., direct)),
                   "axis_y": float(abs(delta[1]) / max(1., direct))})
    return result


def metrics(y, p, weights=None, threshold=.5):
    y, p = np.asarray(y, dtype=int), np.asarray(p, dtype=float)
    if not len(y):
        return {"n": 0, "precision": None, "recall": None, "f1": None}
    assert np.all(np.isfinite(p)) and np.all((p >= 0) & (p <= 1))
    w = np.ones(len(y)) if weights is None else np.asarray(weights, dtype=float)
    precision, recall, f1, _ = precision_recall_fscore_support(y, p >= threshold, average="binary", sample_weight=w, zero_division=0)
    bins, ece = [], 0.
    for index in range(10):
        subset = (np.minimum((p * 10).astype(int), 9) == index)
        if not subset.any():
            continue
        mean_p = float(np.average(p[subset], weights=w[subset]))
        observed = float(np.average(y[subset], weights=w[subset]))
        mass = float(w[subset].sum())
        ece += mass / w.sum() * abs(mean_p - observed)
        bins.append({"lower": index / 10, "upper": (index + 1) / 10, "n": int(subset.sum()), "weight": mass, "mean_probability": mean_p, "observed_pave_fraction": observed})
    low, high = p <= .1, p >= .9
    return {"n": len(y), "positives": int(y.sum()), "threshold": threshold, "precision": float(precision),
            "recall": float(recall) if y.sum() else None, "f1": float(f1) if y.sum() else None,
            "confusion_matrix_tn_fp_fn_tp": confusion_matrix(y, p >= threshold, labels=[0, 1], sample_weight=w).tolist(),
            "average_precision": float(average_precision_score(y, p, sample_weight=w)) if y.sum() else None,
            "brier": float(brier_score_loss(y, p, sample_weight=w)),
            "log_loss": float(log_loss(y, np.column_stack([1-p, p]), labels=[0, 1], sample_weight=w)),
            "ece_10_bins": ece, "reliability_bins": bins,
            "low_pave_probability_count": int(low.sum()), "hidden_pave_in_low_probability_count": int(y[low].sum()),
            "high_pave_probability_count": int(high.sum()), "non_pave_in_high_probability_count": int((1-y[high]).sum())}


def logit(p):
    p = np.clip(p, 1e-6, 1-1e-6)
    return np.log(p / (1-p)).reshape(-1, 1)


def calibration_threshold(y_calibration, p_calibration):
    """Secondary sensitivity only: maximize calibration F1; ties favor precision/threshold."""
    precision, recall, thresholds = precision_recall_curve(y_calibration, p_calibration)
    f1 = 2 * precision[:-1] * recall[:-1] / np.maximum(precision[:-1] + recall[:-1], 1e-12)
    index = max(range(len(thresholds)), key=lambda i: (f1[i], precision[i], thresholds[i]))
    return float(thresholds[index])


def data_summary(rows, areas):
    result = {}
    for area in ("milan", "roccella"):
        subset = [r for r in rows if r["area"] == area]
        lengths = defaultdict(float)
        counts = Counter()
        for row in subset:
            key = "explicit_pave" if row["label"] == 1 else "explicit_non_pave" if row["label"] == 0 else "genuinely_unknown" if row["unknown"] else "ambiguous_or_auxiliary_evidence"
            lengths[key] += row["length_m"]
            counts[key] += 1
        total = sum(lengths.values())
        result[area] = {**areas[area], "ways": len(subset), "edges": sum(len(r["edges"]) for r in subset),
                        "length_m": total, "class_counts": dict(counts), "class_length_m": dict(lengths),
                        "class_length_percent": {k: 100*v/total for k, v in lengths.items()},
                        "materials": dict(sorted(Counter(r["material"] or "missing" for r in subset).items())),
                        "feature_missing_fraction": {key: sum(r["features"][key] == "missing" for r in subset) / len(subset) for key in TAG_FEATURES},
                        "highway_labeled_vs_unknown": {kind: dict(Counter(r["features"]["highway"] for r in subset if (r["label"] is not None if kind == "labeled" else r["unknown"]))) for kind in ("labeled", "unknown")}}
    return result


def dump(path, data):
    path.write_text(json.dumps(data, indent=2, allow_nan=False) + "\n")


def write_gzip_json(path, data):
    # Stable gzip header permits byte-for-byte reproducibility.
    path.write_bytes(gzip.compress(json.dumps(data, separators=(",", ":"), allow_nan=False).encode(), mtime=0))


def run(out):
    started = time.perf_counter()
    export_path = ROOT / "experiments/surface-ml/export.mjs"
    data = json.loads(subprocess.check_output(["node", str(export_path)], cwd=ROOT))
    rows = data.pop("rows")
    for row in rows:
        row["sector"] = geographic_sector(row)
    # Immutable feature dictionaries and split assignments are retained for audit.
    all_features = {r["id"]: features(r) for r in rows}
    labeled = [r for r in rows if r["label"] is not None and r["sector"]]
    external = [r for r in rows if r["label"] is not None and r["area"] == "roccella"]
    unknown = [r for r in rows if r["unknown"]]
    predictions = defaultdict(dict)
    sensitivity_decisions = defaultdict(dict)
    unknown_ensemble, external_ensemble = [], []
    folds, timings = [], []
    for test_index, sector in enumerate(SECTORS):
        calibration_sector = SECTORS[(test_index+1) % len(SECTORS)]
        train = [r for r in labeled if r["sector"] not in (sector, calibration_sector)]
        calibration = [r for r in labeled if r["sector"] == calibration_sector]
        test = [r for r in labeled if r["sector"] == sector]
        assert len({r["id"] for r in train+calibration+test}) == len(labeled)
        assert set(r["label"] for r in train) == {0, 1} and set(r["label"] for r in calibration) == {0, 1}
        y_train, y_cal, y_test = (np.array([r["label"] for r in subset]) for subset in (train, calibration, test))
        vectorizer = DictVectorizer(sparse=False, dtype=np.float64)
        x_train = vectorizer.fit_transform([all_features[r["id"]] for r in train])
        scaler = StandardScaler().fit(x_train)
        x_train = scaler.transform(x_train)
        def transform(subset):
            return scaler.transform(vectorizer.transform([all_features[r["id"]] for r in subset]))
        x_cal, x_test = transform(calibration), transform(test)
        prevalence = float(y_train.mean())
        fold = {"test_sector": sector, "calibration_sector": calibration_sector,
                "train_sectors": sorted(set(r["sector"] for r in train)),
                "train_ways": len(train), "calibration_ways": len(calibration), "test_ways": len(test),
                "train_positives": int(y_train.sum()), "calibration_positives": int(y_cal.sum()), "test_positives": int(y_test.sum()), "models": {}}
        by_class = defaultdict(list)
        for row in train:
            by_class[row["features"]["highway"]].append(row["label"])
        context_prob = {k: (sum(v) + 20*prevalence) / (len(v) + 20) for k, v in by_class.items()}
        baseline_probs = {"prevalence": np.full(len(test), prevalence),
                          "highway_frequency": np.array([context_prob.get(r["features"]["highway"], prevalence) for r in test])}
        for name, p in baseline_probs.items():
            fold["models"][name] = metrics(y_test, p)
            predictions[name].update(zip((r["id"] for r in test), p.tolist()))
            cal_p = np.full(len(calibration), prevalence) if name == "prevalence" else np.array([context_prob.get(r["features"]["highway"], prevalence) for r in calibration])
            threshold = calibration_threshold(y_cal, cal_p)
            fold["models"][name+"_calibration_f1_threshold"] = metrics(y_test, p, threshold=threshold)
            sensitivity_decisions[name].update(zip((r["id"] for r in test), (p >= threshold).astype(int).tolist()))
        # Existing rule system abstains without evidence; decision metrics are not probabilities.
        rule = np.array([int(r["rule_pave_masked"]) for r in test])
        rule_metrics = metrics(y_test, rule)
        fold["masked_current_rules"] = {k: rule_metrics[k] for k in ("n", "positives", "precision", "recall", "f1", "confusion_matrix_tn_fp_fn_tp")}
        fold["masked_current_rules"]["abstention_fraction"] = sum(r["rule_abstains_masked"] for r in test) / len(test)
        fold["masked_current_rules"]["probability_metrics"] = "not applicable: abstention is not a calibrated negative"
        for name, model in (
            ("logistic", LogisticRegression(C=1, max_iter=1000, random_state=SEED)),
            ("hist_gradient_boosting", HistGradientBoostingClassifier(max_iter=100, learning_rate=.08, max_leaf_nodes=15, min_samples_leaf=30, l2_regularization=1, early_stopping=False, random_state=SEED)),
        ):
            tick = time.perf_counter()
            model.fit(x_train, y_train)
            calibrator = LogisticRegression(C=1, max_iter=1000, random_state=SEED).fit(logit(model.predict_proba(x_cal)[:, 1]), y_cal)
            raw = model.predict_proba(x_test)[:, 1]
            p = calibrator.predict_proba(logit(raw))[:, 1]
            cal_prob = calibrator.predict_proba(logit(model.predict_proba(x_cal)[:, 1]))[:, 1]
            threshold = calibration_threshold(y_cal, cal_prob)
            timings.append({"model": name, "test_sector": sector, "fit_calibrate_evaluate_seconds": time.perf_counter()-tick})
            fold["models"][name] = metrics(y_test, p)
            fold["models"][name+"_uncalibrated"] = metrics(y_test, raw)
            fold["models"][name+"_calibration_f1_threshold"] = metrics(y_test, p, threshold=threshold)
            predictions[name].update(zip((r["id"] for r in test), p.tolist()))
            predictions[name+"_uncalibrated"].update(zip((r["id"] for r in test), raw.tolist()))
            sensitivity_decisions[name].update(zip((r["id"] for r in test), (p >= threshold).astype(int).tolist()))
            if name == "hist_gradient_boosting":
                # Model fixed in advance for the exploratory ranking. No selection on test metrics.
                unknown_ensemble.append(calibrator.predict_proba(logit(model.predict_proba(transform(unknown))[:, 1]))[:, 1])
                external_ensemble.append(calibrator.predict_proba(logit(model.predict_proba(transform(external))[:, 1]))[:, 1])
        folds.append(fold)
        print(f"Evaluated held-out {sector}: {len(test)} ways, {int(y_test.sum())} pavé", flush=True)
    aggregate = {}
    for name, values in predictions.items():
        y = [r["label"] for r in labeled]
        p = [values[r["id"]] for r in labeled]
        aggregate[name] = {"way_weighted": metrics(y, p), "length_weighted": metrics(y, p, [r["length_m"] for r in labeled])}
    sensitivity = {}
    for name, decisions in sensitivity_decisions.items():
        m = metrics([r["label"] for r in labeled], [decisions[r["id"]] for r in labeled])
        sensitivity[name] = {k: m[k] for k in ("n", "positives", "precision", "recall", "f1", "confusion_matrix_tn_fp_fn_tp")}
    prob_matrix = np.array(unknown_ensemble)
    unknown_p = prob_matrix.mean(axis=0)
    unknown_probs = dict(zip((r["id"] for r in unknown), unknown_p.tolist()))
    unknown_records = [{"id": r["id"], "area": r["area"], "evidence_state": "unknown", "prediction_state": "experimental_unverified", "p_pave": float(p),
                        "fold_probability_std": float(s), "length_m": r["length_m"], "edge_count": len(r["edges"]),
                        "out_of_city_training_distribution": r["area"] != "milan"} for r, p, s in zip(unknown, unknown_p, prob_matrix.std(axis=0))]
    assert all(r["unknown"] and r["label"] is None for r in unknown)
    from routing import analyze_routes
    routing = analyze_routes(rows, predictions["hist_gradient_boosting"], unknown_probs, ROOT)
    # Source integrity also detects concurrent edits; never silently publish mismatched results.
    assert all(sha(ROOT/path) == value for path, value in data["inputs"].items()), "Input changed during experiment"
    experiment_hashes = {str(p.relative_to(ROOT)): sha(p) for p in sorted(export_path.parent.glob('*')) if p.suffix in ('.py', '.mjs', '.txt')}
    report = {"schema": 1, "recommendation": "NO-GO for runtime integration: no validated unknown-road routing truth or positive Roccella transfer evidence",
              "base_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "environment": {"python": platform.python_version(), "node": subprocess.check_output(["node", "--version"], text=True).strip(), "sklearn": sklearn.__version__, "numpy": np.__version__, "seed": SEED, "threads": 1},
              "attribution": data["attribution"], "input_sha256": data["inputs"], "experiment_sha256": experiment_hashes,
              "dataset": data_summary(rows, data["areas"]),
              "features": {"tag_allowlist": TAG_FEATURES, "geometry": [k for k, v in features(rows[0]).items() if not isinstance(v, str)], "excluded": ["surface and all namespaces", "smoothness", "tracktype", "material", "roughness", "name", "OSM ID", "version", "timestamp", "neighbor surface labels", "confidence/provenance"]},
              "split": {"center_lon_lat": CENTER, "boundary_exclusion_each_side_m": BUFFER_M, "minimum_between_sector_gap_m": BUFFER_M*2,
                        "unit": "whole OSM way, every geometry vertex must lie inside buffered sector",
                        "evaluation_ways": len(labeled), "excluded_boundary_labeled_ways": sum(r["area"] == "milan" and r["label"] is not None and not r["sector"] for r in rows),
                        "calibration": "Platt sigmoid on one geographically separate sector; fit two sectors, test fourth; fixed hyperparameters, threshold 0.5"},
              "folds": folds, "aggregate": aggregate, "calibration_f1_threshold_sensitivity": sensitivity,
              "roccella_external": metrics([r["label"] for r in external], np.mean(external_ensemble, axis=0)),
              "unknown_predictions": {"ways": len(unknown), "edges": sum(len(r["edges"]) for r in unknown), "model": "predeclared HGB, equal ensemble of four geographic models", "truth_available": False,
                                      "low_pave_probability": int((unknown_p <= .1).sum()), "high_pave_probability": int((unknown_p >= .9).sum()), "pave_probability_not_smoothness": True},
              "routing": routing,
              "limitations": ["OSM explicit tags, not independently surveyed truth; missing labels are not random.",
                              "Primary target is explicit cobblestone/sett; paving_stones, paved and auxiliary-only labels are excluded, not called smooth.",
                              "All highway classes included; way-level metrics are not modal or lane-kilometre accuracy.",
                              "Non-atomic source snapshots and full ways beyond source bounding boxes; experiment coverage is not runtime tile coverage.",
                              "Four large coordinate sectors are geographic holdouts, not named neighborhood boundaries or independent city replications.",
                              "No Roccella positive labels: recall and F1 undefined, city transfer unproven.",
                              "Low pavé probability is never proof of asphalt/smoothness; ensemble dispersion is not an uncertainty guarantee.",
                              "Route matching and OSM labels are partial, no physical road truth; small recorded candidate set cannot prove live routing benefit."]}
    out.mkdir(parents=True, exist_ok=True)
    write_gzip_json(out / "dataset.json.gz", [{k: v for k, v in row.items() if k not in ("edges",)} | {"model_features": all_features[row["id"]]} for row in rows])
    write_gzip_json(out / "unknown-predictions.json.gz", unknown_records)
    write_gzip_json(out / "heldout-evaluation.json.gz", [{"id": r["id"], "sector": r["sector"], "label": r["label"], "length_m": r["length_m"], "evaluation_only": True, "probabilities": {k: v[r["id"]] for k, v in predictions.items()}} for r in labeled])
    dump(out / "results.json", report)
    from visual import write_map
    write_map(out / "map.html", rows, unknown_probs)
    write_report(out, report)
    dump(out / "timings.json", {"elapsed_seconds": time.perf_counter()-started, "model_timings": timings,
                                "python_peak_rss_mib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024*1024 if platform.system() == "Darwin" else 1024),
                                "memory_scope": "Python process only; does not measure Node exporter child peak or Cloudflare Worker"})
    print(json.dumps({"aggregate": {k: {m: v["way_weighted"][m] for m in ("precision", "recall", "f1", "brier")} for k, v in aggregate.items()}, "recommendation": report["recommendation"]}, indent=2))


def write_report(out, report):
    lines = ["# Phase 4.17 — esperimento offline", "", "**NO-GO per l’integrazione nel navigatore.** Nessuna modifica al pilot o alle etichette OSM.", "", "## Dati e metodo", "", "Archivi OSM verificati con SHA-256; © OpenStreetMap contributors, ODbL-1.0. Un campione per way, segmenti conservati per geometria e routing. Nessuna suddivisione casuale. Sett/ciottolato esplicito è positivo; asfalto, cemento e materiali sciolti espliciti sono negativi per il solo target pavé. Paving stones, paved e informazioni ausiliarie sono escluse dal target.", "", "| Area | Way | Pavé esplicito | Non pavé esplicito | Senza evidenza ausiliaria | km totali |", "|---|---:|---:|---:|---:|---:|"]
    for area, d in report["dataset"].items():
        c = d["class_counts"]
        lines.append(f"| {area} | {d['ways']} | {c.get('explicit_pave', 0)} | {c.get('explicit_non_pave', 0)} | {c.get('genuinely_unknown', 0)} | {d['length_m']/1000:.2f} |")
    lines += ["", "Sono lunghezze di way complete degli archivi, anche oltre i bbox di acquisizione: non la copertura delle tile runtime, né km-corsia. Le classi intermedie restano escluse. Le etichette mancanti non sono un campione casuale; le osservazioni OSM non sono rilievi indipendenti sul campo."]
    for area, d in report["dataset"].items():
        p = d["class_length_percent"]
        lines.append(f"{area}: {p.get('explicit_pave', 0)+p.get('explicit_non_pave', 0):.2f}% della lunghezza ha un’etichetta binaria utilizzabile; {p.get('genuinely_unknown', 0):.2f}% è privo anche di evidenza ausiliaria.")
    lines += ["", "Copertura e distribuzioni per lunghezza, materiale e tipo di strada: `results.json`. Quattro settori geografici di Milano, fascia esclusa di 200 m per lato, way che attraversano i confini escluse interamente. Due settori per training, uno per calibrazione sigmoidale, uno per test. Parametri e soglia 0,5 fissi. Le probabilità di test non provengono da modelli addestrati o calibrati nel relativo settore.", "", "Feature: highway, service, junction, bridge, tunnel, oneway, lanes, maxspeed, lit, sidewalk, cycleway, bicycle, access; posizione, lunghezza, sinuosità e orientamento. Esclusi surface e derivati, smoothness, tracktype, nomi, ID, date e materiali dei vicini. Preprocessing addestrato solo sul training.", "", "## Risultati geografici fuori campione", "", "| Modello | Precisione | Recall | F1 | Brier | ECE |", "|---|---:|---:|---:|---:|---:|"]
    for name, d in report["aggregate"].items():
        m = d["way_weighted"]
        lines.append(f"| {name} | {m['precision']:.3f} | {m['recall']:.3f} | {m['f1']:.3f} | {m['brier']:.4f} | {m['ece_10_bins']:.4f} |")
    lines += ["", "Sensibilità aggiuntiva: soglia che massimizza F1 scelta esclusivamente sul settore di calibrazione, senza ottimizzare sul test. Queste soglie non attivano routing o nuove etichette:", "", "| Modello | Precisione | Recall | F1 |", "|---|---:|---:|---:|"]
    for name, m in report["calibration_f1_threshold_sensitivity"].items():
        lines.append(f"| {name} | {m['precision']:.3f} | {m['recall']:.3f} | {m['f1']:.3f} |")
    hgb = report["aggregate"]["hist_gradient_boosting"]["way_weighted"]
    base = report["aggregate"]["highway_frequency"]["way_weighted"]
    sensitivity = report["calibration_f1_threshold_sensitivity"]["hist_gradient_boosting"]
    lines += ["", f"HGB migliora average precision da {base['average_precision']:.3f} a {hgb['average_precision']:.3f}; il vantaggio non basta per l’integrazione. Con soglie scelte in calibrazione, la matrice HGB [[TN, FP], [FN, TP]] è {sensitivity['confusion_matrix_tn_fp_fn_tp']}: la maggior parte delle segnalazioni è falsa. Tra {hgb['low_pave_probability_count']} way con p≤0,1, {hgb['hidden_pave_in_low_probability_count']} sono pavé OSM: una probabilità bassa non giustifica dichiarazioni di fondo liscio."]
    lines += ["", "Il normalizzatore corrente, privato dei tag di materiale, non riconosce pavé: F1=0; l’astensione non è una previsione sicura di fondo liscio. Il confronto con frequenze per highway è più informativo. Matrici di confusione, curve di affidabilità, metriche per lunghezza e risultati non calibrati sono in `results.json`.", "", "| Settore di test | Positivi | Precisione HGB | Recall HGB | F1 HGB |", "|---|---:|---:|---:|---:|"]
    for f in report["folds"]:
        m = f["models"]["hist_gradient_boosting"]
        lines.append(f"| {f['test_sector']} | {f['test_positives']} | {m['precision']:.3f} | {m['recall']:.3f} | {m['f1']:.3f} |")
    ext = report["roccella_external"]
    lines += ["", f"Roccella: {ext['n']} etichette valutabili, nessun pavé positivo; recall/F1 non stimabili. Falsi positivi alla soglia 0,5: {ext['confusion_matrix_tn_fp_fn_tp'][0][1]:.0f}.", "", "## Routing e limiti", "", "Vedi `results.json:routing`: confronto limitato alle geometrie reali registrate, con controllo di prossimità/direzione e budget. Le predizioni sui tratti davvero sconosciuti non hanno verità verificabile. L’esperimento con etichette mascherate è una sensibilità offline, non una prova su strada. Nessun miglioramento reale di evitamento pavé è certificato.", "", "**Predizioni separate:** `unknown-predictions.json.gz` contiene solo way prive di evidenza di superficie o proxy diretti. `heldout-evaluation.json.gz` contiene esclusivamente predizioni di valutazione su etichette trattenute, mai nuove superfici confermate. Nessuna probabilità bassa autorizza a dichiarare fondo liscio.", "", "La mappa `map.html` è locale, senza tile esterne o telemetria, separata dall’interfaccia consumer. Non è un navigatore.", "", "Prima di considerare GO: rilievi indipendenti su un campione geografico di strade sconosciute, positivi a Roccella, migliore precisione/calibrazione per settore, corpus con più alternative e verifica di deviazioni/benefici su verità esterna. Mantenere l’incertezza nel routing.", "", "Riferimenti metodologici: [calibrazione scikit-learn](https://scikit-learn.org/stable/modules/calibration.html), [HistGradientBoostingClassifier](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.HistGradientBoostingClassifier.html). Brier misura sia calibrazione sia discriminazione: leggere anche i bin di affidabilità.", "", "Comandi riproducibili e test: `experiments/surface-ml/README.md`. Tempi variabili separati in `timings.json`; tutti gli altri risultati sono deterministici nell’ambiente fissato."]
    routing = report["routing"]["summary"]
    route_metrics = Counter()
    for scenario in report["routing"]["scenarios"]:
        for candidate in scenario["candidates"]:
            route_metrics.update(candidate["metrics"])
    lines += ["", f"Misure routing: {routing['scenarios']} scenari, {routing['with_distinct_candidates']} con alternative distinte; {routing['changed_due_to_ml_penalty']} cambi causati dalla penalità ML, {routing['masked_improved']} miglioramenti e {routing['masked_worsened']} peggioramenti nel confronto mascherato; {routing['masked_detours_without_heldout_benefit']} deviazioni aggiuntive senza beneficio misurato. Questo non prova l’assenza di errori su strade sconosciute.",
              f"Sui passaggi dei candidati registrati (strade ripetute contano più volte): {route_metrics['matched_m']/route_metrics['total_m']*100:.1f}% abbinato, {route_metrics['ambiguous_m']/route_metrics['total_m']*100:.1f}% ambiguo. Nei tratti OOF con p≤0,1, {route_metrics['heldout_false_low_probability_m']:.1f} m erano pavé OSM su {route_metrics['heldout_low_probability_m']:.1f} m. Sono falsi segnali di bassa probabilità, non nuove superfici lisce verificate."]
    (out / "report.md").write_text("\n".join(lines)+"\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "outputs/phase417")
    args = parser.parse_args()
    with threadpool_limits(limits=1):
        run(args.output)
