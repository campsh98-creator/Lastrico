# Offline road-surface computer vision — Phase 4.20, Agent B

This is a developer-only research experiment. The app, the Worker and production routing never import this directory. No image dataset or model weight is stored in the repository. Predictions made here are experimental and are **never** verified surface evidence.

## Contents

| File | Purpose |
|---|---|
| `datasets.md` / `datasets.json` | Legal and quality survey of road-surface image datasets (licences, label provenance, classes, geography, coordinates, exact files and sizes). |
| `report.md` | Not created: the agent harness blocked report files. The Italian summary is section 4 of `outputs/phase420-research-lab-report.md`. |
| `results.json` | Machine-readable outcome: dataset choice, design, phase-1 smoke and the phase-2 summary and verdict. |
| `phase2/` | Real-data metrics (`results.json`, aggregate only) and timings. |
| `surfvis/` | Pipeline: `imageio` (focal crop and resize), `features` (GLCM, LBP, gradients/orientation, FFT periodicity, difference-of-box filters, colour), `splits` (geographic group splits and leakage checks), `models` (baselines and calibrated classifiers), `metrics`, `data` (StreetSurfaceVis adapter, approved-download manifest, checksums), `synthetic` (seeded synthetic textures for tests), `pipeline`. |
| `run.py` | Single entry point for the synthetic smoke run (phase 1) and the real run (phase 2). |
| `test_*.py` | `unittest` code-correctness tests on synthetic inputs only. |
| `phase1/` | Synthetic smoke output. It is a code test, **not accuracy**. |

## Setup (Python 3.13; venv outside the repository)

```sh
# Example only: any writable folder outside the repository. The 2026-11-05 run used a
# session-specific temporary scratch folder that no longer holds the dataset.
SCR="${TMPDIR:-/tmp}/lastrico-surface-vision"
python3.13 -m venv $SCR/venv
$SCR/venv/bin/python -m pip install -r experiments/surface-vision/requirements.txt
```

## Data status (2026-11-06)

The two approved downloads (`streetSurfaceVis_v1_0.csv`, 967,208 B, and `s_1024.zip`,
1,283,338,088 B) were deleted from the temporary folder after their size, MD5 and SHA-256 were
re-verified against the values recorded in `surfvis/data.py` and `phase2/results.json` → `provenance`.
Nothing unique was lost: no model is ever saved, and `phase2/results.json` is byte-identical to an
independent offline rerun (SHA-256 `e8def840…d550`). To reproduce phase 2, get the owner's approval
for the 1.28 GB download again, then run the phase-2 command below with `--fetch`. Source:
StreetSurfaceVis v1.0, DOI [10.5281/zenodo.11449977](https://doi.org/10.5281/zenodo.11449977),
files at `https://zenodo.org/api/records/11449977/files/<name>/content`, licence CC BY-SA 4.0.

`phase1/synthetic-smoke-results.json` and the top-level `results.json` record the **phase-1**
`run.py` hash. `run.py` changed before phase 2, so a smoke rerun today matches those files in
every field except `code_sha256["run.py"]`. `phase2/results.json` matches the current code exactly.

## Phase 1 (no downloads), from the repository root

```sh
PYTHONDONTWRITEBYTECODE=1 $SCR/venv/bin/python -m unittest discover -s experiments/surface-vision -p 'test_*.py' -v
$SCR/venv/bin/python -I experiments/surface-vision/run.py --synthetic-smoke --output $SCR/smoke
```

The smoke run is deterministic: repeated runs produce byte-identical `synthetic-smoke-results.json`. Timings are written to a separate file. Pass `--output experiments/surface-vision/phase1` only when you mean to replace the stored phase-1 evidence.

## Phase 2 (only after the owner approves the exact files): one command

```sh
$SCR/venv/bin/python -I experiments/surface-vision/run.py --data-dir $SCR/data --fetch --variant 1024
```

What the command does:

1. **Download.** It fetches only `streetSurfaceVis_v1_0.csv` (967,208 B) and `s_1024.zip` (1,283,338,088 B) from Zenodo record 11449977. It checks free disk space first, verifies size and MD5, and records SHA-256. Re-running reuses the files once they verify. The `2048` and `original` variants are refused in code.
2. **Read in place.** Images are read straight from the zip without extraction. Files from the download are only ever decoded by Pillow; nothing from them is executed. `-I` keeps the data directory off `sys.path`.
3. **Features.** It extracts 156 features per image (30 of them colour) and caches them in `$SCR/data/features-s1024-fv1.npz`. Expected cost is about 35 ms per image, roughly 5–6 minutes in total (estimated from a synthetic 1024-px JPEG).
4. **Evaluate.** It runs the geographic split, the baselines, the calibrated models and all metrics. Results are written to `experiments/surface-vision/phase2/results.json`, with timings in `timings.json`.

Use `--variant 256` (99,052,992 B) for the cheaper, lower-resolution fallback. Without `--fetch`, the run only verifies files already present in the data directory.

## Phase 2 results (2026-11-05, StreetSurfaceVis `s_1024`, official test cities)

| Item | Value |
|---|---|
| Download check | Both files match the published size and MD5. SHA-256: CSV `add7ccdb…a8d`, zip `bdaaed22…2314`. |
| Data used | 9,122/9,122 images loaded, 0 feature failures. |
| Split | Train 6,321 / calibration 1,620 / test 776. 283 images removed from test cells, 122 more by the 2 km buffer. |
| Leakage | Images 0, cells 0. Train–test minimum distance 4.99 km. 68.7% of test images come from contributors also present in training. |

| Model (test) | Accuracy | Macro-F1 | Brier | ECE | Sett P [Wilson 95%] | Sett R [Wilson 95%] |
|---|---:|---:|---:|---:|---|---|
| majority | 0.683 | 0.162 | 0.602 | 0.274 | — (no sett predicted) | 0.000 |
| colour_logistic | 0.586 | 0.338 | 0.613 | 0.187 | 0.113 [0.068, 0.181] | 0.438 [0.282, 0.607] |
| texture_logistic | 0.841 | 0.610 | 0.302 | 0.197 | 0.581 [0.433, 0.716] | 0.781 [0.612, 0.890] |
| **texture_hgb (primary)** | **0.823** | **0.648** | **0.288** | **0.113** | **0.632 [0.473, 0.766]** | **0.750 [0.579, 0.867]** |
| Published CNN (EfficientNetV2-S), for reference | 0.91 | — | — | — | 0.88 | 0.92 |

Predeclared criteria for the primary model:
- sett recall ≥ 0.70: **pass** (0.750);
- sett precision ≥ 0.70: **fail** (0.632);
- macro-F1 gain over colour ≥ 0.10: **pass** (+0.310);
- ECE ≤ 0.10: **fail** (0.113);
- zero leakage: **pass**.

**Not all met → NO-GO.**

Further results for the primary model:
- **Abstention.** The threshold is 0.70, chosen on calibration. On test it accepts 59.5% of images with accuracy 0.931; sett on the accepted images: P 0.783, R 0.783 (n=23).
- **Sett threshold chosen on calibration** (precision ≥ 0.80 there, at t=0.42). On test it reaches only P 0.641 and R 0.781. Sett is 18.2% of calibration images but 4.1% of test images, so precision falls with the lower base rate.
- **Per test cell.** About one 0.5° cell per city. Accuracy is 0.785–0.865 on cells of n=145–165; sett support per cell is only 2–11 images.
- **Contributors never seen in training** (n=243). Accuracy 0.807, macro-F1 0.668, sett recall 0.583 (n=12).
- **Runtime.** 707 s wall clock in total. Features take 301 s (33 ms per image) and the HGB fit takes 17 s; the remaining ~390 s is download, verification, indexing and evaluation.

All metrics are in `phase2/results.json`. They are aggregate only: no image ids, predictions, weights or images are stored in the repository.

## Method (predeclared; no test-set tuning)

- **Input.** The focal crop recommended by the dataset authors (x∈[0.25W, 0.75W], y∈[0.5H, H]), resized to 256×192. JPEG decoding uses deterministic DCT `draft` reduction. No EXIF transposition is applied, matching the authors' snippet.
- **Features.** Computed on the full crop and on its bottom half (the "near" region):
  - GLCM: 16 quantile levels, distances 1 and 3, averaged over 4 directions, plus contrast anisotropy.
  - Uniform LBP: radius 1 and 2.
  - Sobel magnitude statistics and edge density at 3 thresholds.
  - A centred 8-bin orientation histogram, its entropy, structure-tensor coherence and an orthogonal-grid score.
  - Hann-windowed FFT: radial band shares, mid-band peak ratio, and angular concentration, entropy and orthogonal pair.
  - Difference-of-box energies.
  - Colour: RGB/HSV moments, saturation-weighted hue, colourfulness and chromaticity.
- **Splits.** All splits are geographic; no image is assigned at random.
  - **Test** is the dataset's own held-out five cities (`train=False`, 776 images). It is never used for fitting, calibration or thresholds.
  - Every image gets a 0.5°×0.5° grid cell. Cells that contain any test image are removed from the train/calibration pool.
  - **Calibration** is made of whole cells taken in salted SHA-256 order until it holds 20% of the pool and at least 10 images per class. Labels only guarantee class presence; they never steer performance.
  - **Train** is the remaining cells, minus every image within 2 km of a calibration or test image.
  - Leakage report: shared cells, shared image ids, minimum cross-split distance and shared contributors. Contributor overlap is reported, not enforced; a separate metric covers test contributors never seen in training.
- **Models.** Hyper-parameters are fixed in `surfvis/models.py`.
  - `majority`: training priors.
  - `colour_logistic`: colour-only baseline.
  - `texture_logistic`: secondary model.
  - `texture_hgb`: HistGradientBoosting, **primary**, predeclared.
  - Calibration: one-vs-rest sigmoid (`CalibratedClassifierCV(FrozenEstimator(...))`) fitted on the calibration split, which needs at least 5 images per class.
- **Metrics.** Per-class precision, recall and F1; confusion matrix; macro-F1; accuracy; multiclass Brier (sum over classes, range 0–2); top-label ECE and MCE with 10 equal-width reliability bins; coverage–accuracy curve.
  - **Abstention**: the smallest max-probability threshold whose *calibration* accuracy is at least 0.90 with at least 20 accepted images. It is then applied unchanged to test.
  - **Sett vs rest**: the argmax decision, p≥0.5, and a p(sett) threshold chosen on calibration for precision ≥ 0.80. Reported with Wilson 95% intervals, average precision, binary Brier and ECE.
  - Also reported: per-test-cell results and sett recall by quality level.
- **Predeclared phase-2 criteria** (`surfvis/pipeline.py`):
  - sett recall ≥ 0.70 and sett precision ≥ 0.70 on test;
  - macro-F1 at least 0.10 above the colour-only baseline;
  - ECE ≤ 0.10;
  - zero image-level and cell-level leakage.

  Meeting all of them would only justify an **Italian human-labelled evaluation**, never product integration.

## Honesty limits

- Synthetic tests check formulas, shapes, determinism, leakage checks and label alignment, including a shuffled-label negative control. They say nothing about real accuracy.
- StreetSurfaceVis is from Germany. Phase 2 can measure transfer between German cities, not performance in Milan or Roccella Ionica.
- Dataset class frequencies are steered by the selection process, so test precision does not transfer to real-world base rates.
- Licence: data CC BY-SA 4.0 (Mapillary contributors and HTW Berlin). Keep images, predictions keyed to image ids, and any weights outside this MIT repository. Only aggregate metrics are stored here.
