# Phase 4.17 — offline road-surface experiment

## Scope and ownership
Create an isolated, reproducible Python experiment in `experiments/surface-ml/`, with results in `outputs/phase417/`. Read archived authentic OSM sources, verify their SHA-256 against existing acquisition manifests, deduplicate ways, and preserve source attribution. No consumer UI, runtime data, Worker dependency, deployment configuration, branch, commit, push or deployment changes. Existing work must be preserved. Independent methodological review is read-only.

## Method and limitations
- Predict explicit cobblestone/sett versus explicit non-cobblestone materials. Broad `paved`, paving stones, absent, unsupported and compound surface values are not negatives. Paving stones remain ambiguous for this strict target, not proof of smoothness.
- Use an explicit feature allowlist of road context and geometry. Exclude surface and all surface derivatives, smoothness, tracktype, names/identifiers, edit metadata, provenance/confidence and neighbouring surface labels. IDs remain join keys only.
- Split Milan into deterministic spatial sectors, with geographic buffers and whole-way exclusion across boundaries. Train preprocessing on training ways only. Never randomly split segments of one way. Fit one row per OSM way to avoid pseudo-replication; retain original edge geometries for predictions and route matching.
- Compare prevalence baseline, existing normalizer with material tags masked, logistic regression and histogram gradient boosting. Fixed hyperparameters; no test tuning. Report precision/recall/F1, confusion matrices, Brier/log loss/reliability bins, geographic folds and imbalance/coverage. Roccella is an external transfer check, not assumed to contain positive examples.
- Generate deployment-like predictions only for genuinely unknown ways, separately from evidence. Held-out labelled-way predictions are evaluation records only. Probabilities are experimental, not verified surfaces; no inference in production.
- Use recorded provider routes only. Report matching ambiguity and incomplete ground truth. Compare recorded selection to experimental unknown-risk ranking with fixed time budget and preserved candidate geometry/mode. Also run explicitly labelled masked-evidence sensitivity checks with out-of-area predictions. Do not equate recorded or partially labelled outcomes with proven real-world avoidance.

## Acceptance, tests and release gate
Run focused tests for feature leakage, geographic/way separation and buffer, unknown-only output, archive checksums, probability/calibration metrics, directional/proximity matching and detour constraints. Repeat experiment to verify deterministic substantive outputs. All source/input hashes must remain unchanged. No live provider requests or external data uploads.

GO requires meaningful improvement on geographically held-out pavé, adequate positive support across multiple areas, acceptable calibration, and demonstrable routing benefit without false confidence or avoidable detours. Otherwise report NO-GO; do not enable ML routing. The optional developer-only map must be local and distinguish known, unknown and predicted data, with no external assets/telemetry. Physical iPhone and production checks are outside this offline experiment and are not claimed.

## Recorded methodological extension
After the first fixed-threshold run, add an explicitly secondary sensitivity: choose maximum-F1 threshold solely on each separate calibration sector, then report test performance unchanged. This tests whether poor recall is only a 0.5-threshold artifact; it is not test-set threshold tuning, changes no features/hyperparameters and cannot authorize integration. Preserve the primary fixed-threshold and uncalibrated results.
