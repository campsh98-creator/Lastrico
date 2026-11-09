# Phase 4.20 — Parallel Multi-Agent Research Lab (execution prompt)

Owner: Lead Orchestrator (release owner for this phase). Date: 2026-11-05.
Branch: `fix/mobile-navigation-stability` (no commits, branches, worktrees, pushes, merges or deployments in this phase).

## Purpose

Run four independent, offline, developer-only experiments and decide, with evidence, which deserve future product integration. Nothing in this phase is integrated into the consumer app, the Worker, production routing or the Cloudflare pilot (`https://lastrico-pilot.campsh.workers.dev` must not be redeployed).

## Baseline state preserved

- `git status` at start: modified `app/globals.css`, `components/phase43/phase43.css` (Phase 4.18 UI work); untracked `experiments/surface-ml/`, `outputs/phase417/`, `outputs/phase418-ui-artifacts/`, `outputs/prompt-phase417-surface-ml.md`, `outputs/prompt-phase418-premium-navigation-ui-2.md`. All must remain byte-identical at the end of this phase.
- Phase 4.17 (OSM-tag surface ML) ended NO-GO; its artefacts are read-only inputs.

## Ownership (exclusive write access)

| Agent | Directory | Scope |
|---|---|---|
| A — Intelligent Route Ranking | `experiments/route-ranking/` | Explainable multicriteria ranker (confirmed pavé, probable pavé, unknown surface, time, distance, configurable preferences) benchmarked against the current production selection on genuine recorded routes. |
| B — Road Surface Computer Vision | `experiments/surface-vision/` | Legal/quality survey of reusable road-image datasets; lightweight offline classifier only with trustworthy labels; per-class precision/recall, geographic generalisation, uncertainty. |
| C — Road Roughness Sensors | `experiments/roughness-sensors/` | Opt-in smartphone accelerometer/gyroscope recording prototype, local vibration analysis, deterministic synthetic tests, iOS browser permission investigation. |
| D — Road Intelligence Dashboard | `experiments/road-dashboard/` | Local developer-only geospatial dashboard from existing surface data: known / probable / unknown, coverage, uncertainty hotspots, research metrics; experimental predictions separated from verified evidence. |

The orchestrator writes only this prompt, the final report `outputs/phase420-research-lab-report.md`, and notes in the shared side-session notes folder.

## Limitations (all agents)

- Read-only everywhere outside the owned directory: `app/`, `components/`, `lib/`, `worker/`, `tests/`, `data/`, `outputs/`, `dist/`, `.wrangler/`, `package*.json`, `node_modules/`, other experiments.
- No `npm install`, no `npm run build`, no dependency changes to the app. Experiment-only Python dependencies are pinned inside the owned directory and installed into a venv in the session scratchpad.
- No paid APIs, no upload of personal or location data, no telemetry, no external tiles in dashboards.
- Public providers (FOSSGIS Valhalla, Nominatim) only via the already-built local server, at most one route request per 10 s, coordinates only.
- Dataset downloads require the owner's explicit approval of the exact file, source and size (disk free ≈ 13 GB).
- Never fabricate data or metrics. Synthetic data is labelled synthetic. Predictions are never presented as verified evidence. No real-world accuracy claims without physical ground truth.

## Acceptance criteria per experiment

1. `README.md` with reproducible commands; `report.md` (Italian) with results, limitations and a GO/NO-GO recommendation; machine-readable `results.json`.
2. Automated tests (Node `node --test` or Python `unittest`) that pass from the repository root and are deterministic.
3. Results compared against an explicit baseline (production selection, majority/prevalence classifier, threshold rule, or raw source totals as appropriate).
4. Evidence quality, sample sizes, provenance (SHA-256 of inputs) and limitations stated.
5. Runtime/performance and maintenance cost measured or estimated.

## Verification by the orchestrator

- Re-run every agent's test suite and main pipeline independently; recompute at least one headline metric per experiment from raw outputs.
- Confirm `git status` and the diff of pre-existing modified files are unchanged; confirm no writes outside owned directories.

## Release conditions

This phase releases a decision, not a feature. A GO means "worth a dedicated integration phase with its own execution prompt, tests, mobile E2E, deployment and smoke tests" — never direct integration. Final consolidated report in Italian, nontechnical, with a ranking by demonstrated product value, implementation risk and feasibility.
