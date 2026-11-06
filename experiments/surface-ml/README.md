# Offline surface ML — Phase 4.17

Isolated developer experiment. Nothing imports this directory into the Worker or consumer UI. No provider calls, data uploads, runtime labels, route geometry or routing rules are changed. Sources: archived OSM responses, © OpenStreetMap contributors, ODbL-1.0; checksums and original acquisition manifests remain in the repository.

From the repository root, with Python 3.13 and Node 24:

```sh
python3.13 -m venv /private/tmp/lastrico-phase417-venv
/private/tmp/lastrico-phase417-venv/bin/python -m pip install -r experiments/surface-ml/requirements.txt
PYTHONDONTWRITEBYTECODE=1 /private/tmp/lastrico-phase417-venv/bin/python -m unittest discover -s experiments/surface-ml -p 'test_*.py' -v
PYTHONDONTWRITEBYTECODE=1 /private/tmp/lastrico-phase417-venv/bin/python experiments/surface-ml/run.py
```

The `/private/tmp/...` paths are examples; any venv and output folder outside the repository work.

Reproducibility check (2026-11-06, Python 3.13.2, Node v24.18.0, HEAD `9225730`): a rerun into a temporary folder reproduced `dataset.json.gz`, `heldout-evaluation.json.gz`, `unknown-predictions.json.gz`, `results.json`, `report.md` and `map.html` byte for byte in about 32 s, and all 29 input and 7 experiment SHA-256 values in `results.json` matched. `results.json` stores `base_commit` (`git rev-parse HEAD`), so after a new commit a rerun differs in that field only. `tools/road-dashboard/build.mjs` reads `outputs/phase417/unknown-predictions.json.gz` and `results.json` for its experimental layer.

Only dependency installation needs network access. The run is offline. `--output /private/tmp/lastrico-phase417-repeat` writes a second run for comparison. Compare all artifacts except `timings.json`; gzip timestamps are fixed. A checksum mismatch or edited source during execution stops the experiment. Full dependency versions are pinned separately from npm/Worker dependencies.

Outputs in `outputs/phase417/`:

- `results.json`: dataset quality/coverage, geographical splits, all model metrics/confusion matrices/reliability bins, fixed-candidate routing and input/script hashes.
- `dataset.json.gz`: one way per record, authentic geometry, target label and explicit feature allowlist; includes purged/unlabeled ways, with geographic sector assignments. Whole ways avoid pseudo-replication from dense OSM nodes.
- `heldout-evaluation.json.gz`: geographically held-out labeled examples only, **evaluation records**, never inferred OSM evidence.
- `unknown-predictions.json.gz`: only ways with no material/surface/smoothness/tracktype evidence; probabilities and ensemble dispersion. Prediction applies to all original constituent segments of each way; IDs join to dataset geometry. Low pavé probability does not mean smooth.
- `map.html`: self-contained geometry viewer; open locally. No basemap/network requests. Explicit evidence and unknown-only predictions have different legends. No consumer controls added.
- `report.md`, `timings.json`: concise interpretation and separate nondeterministic timing data.

Target: explicit sett/cobblestone family versus explicit asphalt/concrete/unpaved materials. Broad `paved`, `paving_stones`, conflicting or unsupported values are excluded from the binary target, never assumed smooth. The classifier does not estimate all forms of roughness, lane surface, material quality or legal access. Auxiliary surface tags are excluded from the feature matrix and prevent unknown-only export.

Four fixed buffered coordinate sectors partition Milan. A way must lie entirely within its sector, at least 200 m from either boundary. Each outer test uses two sectors for training and a third for Platt calibration. All preprocessing and categorical vocabularies are fitted on training only; HGB disables random internal early-stopping validation. Hyperparameters and threshold 0.5 are fixed. No test tuning or model selection. HGB is predeclared for exploratory routing/unknown outputs; metrics may favor another model. Roccella is an untouched external transfer check, with no positive pavé labels. Confidence is not guaranteed by geographic calibration or ensemble agreement.

The current normalizer is also run after masking surface/material tags. Its abstention is **not** converted to a calibrated negative. Prevalence and highway-frequency baselines provide probabilistic comparisons. Precision/recall/F1 are way weighted; length-weighted metrics are supplementary and not independent samples. Calibration bins accompany Brier because Brier also measures discrimination. Metrics describe OSM annotation agreement, not field-survey accuracy or unbiased missing-label performance.

An explicitly secondary sensitivity selects maximum-F1 threshold on the calibration sector only (ties favor precision and higher threshold), then evaluates on the untouched test sector. This was added after observing poor fixed-0.5 recall; no test labels select thresholds, and the primary fixed-threshold results remain reported. Calibration thresholds are not used to generate or activate runtime routing.

Routing compares archived fast/safe choices with a separately named fixed-risk control and additive ML-risk ranking, with a maximum five-minute detour budget. There are few distinct archived alternatives. Geographic OOF masked-label results are a sensitivity analysis, not a clean single-area deployment trial; actual unknown-road truth is unavailable. Provider profiles/geometry are not recomputed; current route legality is not revalidated by this experiment. No integration unless held-out surface and independent routing evidence support it.
