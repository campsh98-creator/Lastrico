# Research register

Everything under `experiments/` is offline, developer-only research. Nothing here, and nothing under
`tools/`, is imported by `app/`, `lib/`, `components/`, `worker/`, `public/` or the deploy scripts, and
none of it reaches the Worker bundle. `tests/experiments-isolation.test.mjs` enforces this. It runs as
part of `npm test`, or on its own with `node --test tests/experiments-isolation.test.mjs`.

Italian summaries and verdicts are in `outputs/phase420-research-lab-report.md` (Phase 4.20) and
`outputs/phase417/report.md` (Phase 4.17). Run every command below from the repository root.

| Folder | Phase | Question | Verdict |
|---|---|---|---|
| `surface-ml/` | 4.17 | Can road context, without surface tags, predict pavé on untagged OSM ways? | **NO-GO** |
| `route-ranking/` | 4.20 | Can a transparent, configurable rule reproduce and explain the app's route choice? | **Conditional GO** (explanation and preferences only); stays here |
| `road-dashboard/` → `tools/road-dashboard/` | 4.20 → 4.21 | Where is the surface known, probable or unknown, and where would a survey help most? | **GO, internal only** |
| `roughness-sensors/` | 4.20 | Can phone motion sensors in the browser tell pavé from asphalt? | **NO-GO** for the app; field trial only |
| `surface-vision/` | 4.20 | Can a lightweight image model recognise sett in street photos? | **NO-GO** |

## surface-ml — Phase 4.17

- **Verdict.** NO-GO. At the fixed 0.5 threshold the calibrated gradient-boosting model reaches F1 0.000
  on geographically held-out Milan sectors. Average precision rises only from 0.078 to 0.115. Roccella has
  no positive labels, and there is no ground truth for unknown roads.
- **Evidence.** `outputs/phase417/`: `report.md`, `results.json` (splits, metrics and the SHA-256 of 29
  inputs and 7 scripts), `validation.json` and `timings.json`, plus generated files: `dataset.json.gz`,
  `heldout-evaluation.json.gz`, `unknown-predictions.json.gz` and `map.html`. Plan:
  `outputs/prompt-phase417-surface-ml.md`.
- **Reproduce.** `VENV` and `OUT` are any folders outside the repository.

  ```sh
  python3.13 -m venv "$VENV"
  "$VENV/bin/python" -m pip install -r experiments/surface-ml/requirements.txt
  PYTHONDONTWRITEBYTECODE=1 "$VENV/bin/python" -m unittest discover -s experiments/surface-ml -p 'test_*.py'  # 14 tests
  PYTHONDONTWRITEBYTECODE=1 "$VENV/bin/python" experiments/surface-ml/run.py --output "$OUT"  # default output: outputs/phase417
  ```

  A rerun reproduces all six outputs byte for byte (checked 2026-11-06). The only exception:
  `results.json` stores `base_commit`, so after a new commit it differs in that field.
- **Seeds and splits.** Seed 417. Four fixed geographic sectors of Milan with a 200 m buffer, one record
  per OSM way. Roccella is an external transfer check.
- **Data and licence.** Archived OSM extracts already in Git (`data/sources/`), © OpenStreetMap
  contributors, ODbL-1.0. Nothing new is downloaded.
- **Runtime and dependencies.** Python 3.13.2 with the pinned `requirements.txt` (scikit-learn 1.7.2,
  numpy 2.5.4, scipy 1.18.1). Node 24 runs the exporter. A run takes about 32 s and peaks at about
  730 MiB. Only `pip install` needs the network.
- **Consumers.** `tools/road-dashboard/build.mjs` reads `unknown-predictions.json.gz` and `results.json`
  for its experimental layer, which is off by default.

## route-ranking — Phase 4.20 (owned by Agent 1 in Phase 4.21)

- **Verdict.** Conditional GO, as an explanation and preference engine only. It picked the app's route in
  34 of 34 live Milan requests and in 399 of 400 comparisons overall. Its proven value is transparency,
  not better routes. Before any use it needs a silent side-by-side comparison with at least 95%
  agreement and 0 dominated choices. Presenting it as "better routes" is NO-GO.
- **Evidence.** `README.md`, `report.md` (Italian), `results.json` and `corpus/`: a manifest with SHA-256
  values, `scenarios.json`, and 36 live responses from 2026-11-05 with their request log.
- **Reproduce.**

  ```sh
  node --test experiments/route-ranking/test/       # 25 tests, < 2 s
  node experiments/route-ranking/build-corpus.mjs   # rebuilds corpus/manifest.json and scenarios.json (offline)
  node experiments/route-ranking/benchmark.mjs      # rewrites results.json and report.md (offline)
  ```

  The live capture (`collect-live.mjs`) was done once. Do not repeat it without a reason, because it
  calls public providers through a local server.
- **Data and licence.** Valhalla route responses (route data © OpenStreetMap contributors, ODbL-1.0)
  archived in `outputs/phase32-benchmark/`, `outputs/phase42-validation/`, `tests/fixtures/` and the
  live corpus. All requests run between fixed landmarks; there are no personal GPS traces.
- **Runtime and dependencies.** Node 24 or later, no dependencies, about 5 µs per decision.
- **Phase 4.21.** The folder stays here. Runtime code must not import it. Any integration is a reviewed
  reimplementation under `lib/` with its own tests.

## road-dashboard — Phase 4.20, now `tools/road-dashboard/`

- **Status.** Phase 4.21 moves it to `tools/road-dashboard/` as a maintained internal tool (Agent 2).
  `experiments/road-dashboard/README.md` only points there. The Phase 4.20 evidence is in
  `tools/road-dashboard/evidence/phase420/`.
- **Verdict.** GO as an internal tool for data quality and survey planning. NO-GO for anything
  user-visible or for routing. Experimental predictions stay in a separate layer, off by default.
- **Reproduce.** `node tools/road-dashboard/build.mjs`, `node --test tools/road-dashboard/test/` and
  `node tools/road-dashboard/serve.mjs` (127.0.0.1 only). The tool's README is authoritative.
- **Data and licence.** Runtime OSM surface data in `data/surfaces/`, ODbL-1.0. The optional layer comes
  from `outputs/phase417/`.
- **Runtime and dependencies.** Node 24, no dependencies, about 3 s per build. The generated `dist/` is
  git-ignored.

## roughness-sensors — Phase 4.20

- **Verdict.** NO-GO for the app; a field trial with the team is the only next step allowed. On 38
  synthetic trips sett precision is 0.96 and recall 0.98, but on synthetic data only. iPhone sensors
  deliver about 60 Hz, which cannot resolve the sett rhythm above about 11 km/h. In the test traces
  9 of 11 rough-asphalt sections were taken for pavé.
- **Evidence.** `README.md`, `results.json` (`provenance.deterministicSha256` =
  `0c1520460568c5ac2b625f5aaf1eee9bc696024354cdf3f0513922b1b9cb8a3c`, plus the hash of every source
  file), `ios-permissions.md` and section 3 of the lab report. The detailed field-validation protocol was
  never saved in the repository.
- **Reproduce.**

  ```sh
  node --test "experiments/roughness-sensors/test/*.test.mjs"                     # 57 tests, ~9 s
  node --expose-gc experiments/roughness-sensors/scripts/run-evaluation.mjs --no-bench  # rewrites results.json in place, ~17 s
  node experiments/roughness-sensors/serve.mjs                                    # prototype on 127.0.0.1:8820
  ```

  To compare without touching the stored evidence, run the evaluation on a copy of the folder. The
  `deterministicSha256` must match (checked 2026-11-06).
- **Seeds and data.** Every trace comes from seeded specs in `src/scenarios.mjs`. There is no external
  data and no field recording.
- **Runtime and dependencies.** Node 24 or later, no dependencies. The prototype records only after an
  explicit opt-in. Data stays in memory, the CSP sets `connect-src 'none'`, and the app never links to it.

## surface-vision — Phase 4.20

- **Verdict.** NO-GO: 3 of 5 predeclared criteria met. Sett precision is 0.632 (needs at least 0.70) and
  ECE is 0.113 (needs at most 0.10). The test set has 776 German images, 32 of them sett.
- **Evidence.** `README.md`, `results.json`, `phase2/results.json` (aggregate metrics only; SHA-256
  `e8def84032f8ee90332d4e47accfcb03461c0f753cdf3067a60d399d0a91d550`), `phase2/timings.json`,
  `phase1/` (synthetic smoke test, not accuracy) and `datasets.md` / `datasets.json` (licence survey of
  seven sources).
- **Reproduce.** `SCR` is any folder outside the repository.

  ```sh
  python3.13 -m venv "$SCR/venv"
  "$SCR/venv/bin/python" -m pip install -r experiments/surface-vision/requirements.txt
  PYTHONDONTWRITEBYTECODE=1 "$SCR/venv/bin/python" -m unittest discover -s experiments/surface-vision -p 'test_*.py'  # 57 tests
  "$SCR/venv/bin/python" -I experiments/surface-vision/run.py --synthetic-smoke --output "$SCR/smoke"
  # Phase 2 needs the owner's approval: downloads 1.28 GB and takes about 12 min.
  "$SCR/venv/bin/python" -I experiments/surface-vision/run.py --data-dir "$SCR/data" --fetch --variant 1024
  ```

- **Seeds and splits.** Seed 420, salt `lastrico-phase420-sv`. The test set is the dataset's official
  held-out cities. Calibration uses whole 0.5° cells, and a 2 km buffer separates training from the
  other splits.
- **Data and licence.** StreetSurfaceVis v1.0, DOI
  [10.5281/zenodo.11449977](https://doi.org/10.5281/zenodo.11449977), CC BY-SA 4.0 (Mapillary
  contributors and HTW Berlin). Files come from
  `https://zenodo.org/api/records/11449977/files/<name>/content`:

  | File | Bytes | MD5 | SHA-256 |
  |---|---:|---|---|
  | `streetSurfaceVis_v1_0.csv` | 967,208 | `a6ac6ab1edf7d813ebe7ffb22b922423` | `add7ccdb1c55d5c3ffd9c16426337e36a3105dfb59340596ed09666a5fc21a8d` |
  | `s_1024.zip` | 1,283,338,088 | `3a32ab4f5f2992a267c4274179717c77` | `bdaaed22719888bbd631c1779389367d516bdba626e683a06256ae70fdad2314` |

  Images, per-image predictions, feature caches and model weights never enter Git. The downloaded
  copies were deleted on 2026-11-06 after their checksums were verified again.
- **Runtime and dependencies.** Python 3.13.2 with the pinned `requirements.txt` (numpy, scipy,
  scikit-learn, Pillow 13.0.0). CPU only. Feature extraction takes 33 ms per image.

## Rules for new experiments

- Use one folder per experiment. Its README gives the question, exact commands, data source and licence.
  Its `results.json` carries input and code hashes.
- Use Node built-ins, or pinned Python packages in a venv outside the repository. Never add a dependency
  to `package.json` for research.
- Never commit datasets that cannot be redistributed, model weights, feature caches or real GPS traces.
  `outputs/field-traces/` is git-ignored.
- Runtime code never imports `experiments/` or `tools/`, and never mentions those paths, even in
  comments. To integrate research, write a reviewed reimplementation under `lib/` with its own tests.
