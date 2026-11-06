"""Phase 4.20 / Agent B — road-surface vision experiment entry point.

Phase 1 (no downloads):
    python -I experiments/surface-vision/run.py --synthetic-smoke --output <dir>
Phase 2 (ONLY after the owner approved the exact files):
    python -I experiments/surface-vision/run.py --data-dir <scratch>/data --fetch --variant 1024

Run with ``python -I`` (isolated mode); this script adds only its own directory
to ``sys.path``. Downloaded data stays in ``--data-dir`` (outside the repo) and is
read in place; nothing from it is executed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True  # -I ignores PYTHONDONTWRITEBYTECODE; keep the repo free of .pyc
HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from surfvis import data as D  # noqa: E402
from surfvis import pipeline as P  # noqa: E402
from surfvis.synthetic import synthetic_records  # noqa: E402

SYNTH_LABEL = "SYNTHETIC_CODE_TEST_NOT_ACCURACY"


def code_hashes() -> dict:
    files = sorted([HERE / "run.py", *(HERE / "surfvis").glob("*.py")])
    return {str(p.relative_to(HERE)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")


def run_synthetic(output: Path) -> dict:
    t0 = time.perf_counter()
    records = synthetic_records()
    X, names, cmask, ok, failures, feat_s = P.extract_features(records)
    if failures:
        raise RuntimeError(f"synthetic feature failures: {failures[:3]}")
    result, timings = P.run_experiment(records, X, names, cmask, config={"min_per_class": 5},
                                       dataset_label=SYNTH_LABEL)
    result["warning"] = ("Procedurally generated textures. These numbers test code paths only and are "
                         "not, and must never be reported as, road-surface accuracy.")
    result["criteria_check"] = {"applicable": False, "reason": "synthetic code test; criteria apply to phase-2 real data only",
                                "code_path_output": result["criteria_check"]}
    result["n_records"] = len(records)
    result["code_sha256"] = code_hashes()
    timings.update({"feature_extraction_s": feat_s, "total_s": time.perf_counter() - t0,
                    "per_image_feature_ms": 1000 * feat_s / max(len(records), 1)})
    write_json(output / "synthetic-smoke-results.json", result)
    write_json(output / "synthetic-smoke-timings.json", timings)
    return result


def run_real(data_dir: Path, variant: str, fetch: bool, output: Path, progress_every: int) -> dict:
    t0 = time.perf_counter()
    data_dir = data_dir.resolve()
    if fetch:
        provenance = D.fetch_approved(data_dir, variant)
    else:
        provenance = []
        for key in ("csv", variant):
            spec = D.STREETSURFACEVIS_FILES[key]
            provenance.append(D.verify_file(data_dir / spec["name"], spec["size"], spec["md5"]))
    csv_path = data_dir / D.STREETSURFACEVIS_FILES["csv"]["name"]
    zip_path = data_dir / D.STREETSURFACEVIS_FILES[variant]["name"]
    records, info = D.load_streetsurfacevis(csv_path, zip_path)
    cache = data_dir / f"features-s{variant}-{P.FEATURE_VERSION}.npz"
    X, names, cmask, ok, failures, feat_s, cached = P.load_or_extract(records, cache, progress_every)
    kept = [records[i] for i in ok.tolist()]
    write_json(data_dir / "feature-failures.json", failures)  # contains image ids: scratch only
    result, timings = P.run_experiment(kept, X, names, cmask, dataset_label=f"streetsurfacevis_v1.0_s{variant}")
    result.update({
        "dataset": {"name": "StreetSurfaceVis", "version": "V1.0", "doi": D.ZENODO_DOI, "licence": "CC-BY-SA-4.0",
                    "variant": variant, "load_info": info, "feature_failures": len(failures),
                    "feature_failure_details": "kept outside the repo in <data-dir>/feature-failures.json"},
        "provenance": provenance,
        "code_sha256": code_hashes(),
        "evidence_status": "Experimental predictions on German test cities. Not verified evidence about any road in Italy.",
    })
    timings.update({"feature_extraction_s": feat_s, "features_from_cache": cached,
                    "per_image_feature_ms": None if cached else 1000 * feat_s / max(len(records), 1),
                    "total_s": time.perf_counter() - t0})
    write_json(output / "results.json", result)
    write_json(output / "timings.json", timings)
    return result


def summarise(result: dict) -> str:
    lines = [f"kind: {result['kind']}", f"split: {json.dumps(result['split']['class_counts'])}",
             f"leakage image/cell: {result['leakage']['image_level_leakage_total']}/{result['leakage']['cell_level_leakage_total']}"]
    for name, m in result["models"].items():
        s = m["sett_vs_rest_test_argmax_equivalent"]
        lines.append(f"{name:17s} acc={m['test']['accuracy']:.3f} macroF1={m['test']['macro_f1']:.3f} "
                     f"ECE={m['test']['ece_top_label']:.3f} sett P={s['precision']:.3f} R={s['recall']:.3f}")
    lines.append(f"criteria: {json.dumps(result['criteria_check'])}")
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--synthetic-smoke", action="store_true", help="run the full pipeline on synthetic textures")
    ap.add_argument("--data-dir", type=Path, help="directory (outside the repo) holding/receiving the dataset")
    ap.add_argument("--variant", default="1024", choices=D.ALLOWED_FETCH_VARIANTS)
    ap.add_argument("--fetch", action="store_true", help="download approved files (phase 2 only)")
    ap.add_argument("--output", type=Path, default=HERE / "phase2")
    ap.add_argument("--progress-every", type=int, default=500)
    a = ap.parse_args(argv)
    if a.synthetic_smoke:
        res = run_synthetic(a.output)
    else:
        if a.data_dir is None:
            ap.error("--data-dir is required unless --synthetic-smoke")
        res = run_real(a.data_dir, a.variant, a.fetch, a.output, a.progress_every)
    print(summarise(res))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
