# Phase 4.36 — Forensic routing audit, multi-source surface intelligence and experimental roadmap

Status: **complete** (all six workstreams delivered; final report in Italian). This phase is investigation and
feasibility. No production code, data, deployment configuration or Rome file is changed; nothing is committed, pushed or
deployed. The working tree holds only the two untracked Phase 4.36 folders. Start with `final-decision-report.md`.

- Baseline: `main` at `3e31da9` (Phase 4.35), clean working tree at start (verified with `git status` on 2026-11-14).
- Scope: why Lastrico sometimes recommends uncomfortable or inefficient routes in Milan; whether the cause is road data,
  map matching, candidate generation, ranking or navigation; what to build next in Phase 4.37 and what to leave out.
- Language: reports are English; `final-decision-report.md` is Italian.
- Evidence labels: **VERIFIED** (seen in a named file, dataset or response), **STRONGLY SUPPORTED**, **PLAUSIBLE**,
  **UNVERIFIED**.

## Inputs

| Input | Location | Handling |
|---|---|---|
| Return-journey GPS trace, 13 Nov 2026 | `Downloads\lastrico-gps-trace-2026-11-13-18-26.json` (317,624 bytes, SHA-256 `2aa69324…bffa`) | Read locally from its original path. **Not copied into the repository, not committed, not sent anywhere.** Only the redacted aggregate `evidence/gps-trace-summary.redacted.json` is stored. |
| Outbound journey | user's observations and screenshots only | **No GPS recorded.** Never inferred from the return trace. |
| Existing archived provider responses | `outputs/phase425-benchmark/provider-responses.tar.gz` (SHA-256 in `PROVIDER_ARCHIVE.md`) | Reused before any live call. |
| Archived OSM extracts and compiled surface tiles | `data/sources/`, `data/surfaces/` | Read only. |

The attachment pasted into the conversation was too large to be shown in full; the full file was read from disk by local
tools. Raw coordinates of the trace are not in any report; origin and destination are redacted.

## Reports

| File | Content | Owner |
|---|---|---|
| `gps-trace-forensics.md` | timestamped events, plan vs trajectory, reroute explanation, GPS quality, warnings (return leg only) | principal |
| `routing-forensics.md` | candidate generation vs ranking vs navigation | Agent 1 |
| `osm-data-audit.md` | OSM tags vs compiled data vs matching | Agent 2 |
| `external-data-audit.md` | DBT 2020, ATM, Lombardia, Mapillary, others | Agent 3 |
| `routing-experiments.md` | controlled scoring and candidate experiments | Agent 4 |
| `surface-intelligence-design.md` | versioned Surface Intelligence Layer | Agent 5 |
| `smartphone-sensor-feasibility.md` | sensing feasibility and field protocol | Agent 6 |
| `final-decision-report.md` | Italian decision report | principal |
| `evidence/` | compact evidence (redacted trace summary, shared context, prices, per-agent evidence) | all |

Research scripts live in `experiments/phase436-surface-intelligence/` (isolated; never imported by runtime code; bulk
downloads go to its git-ignored `data/` folder).

## Reproduce

```sh
# GPS forensics (local only; pass the path to the trace)
node experiments/phase436-surface-intelligence/scripts/gps-trace-forensics.mjs <trace.json> --out=<summary.json>
node scripts/replay-gps-trace.mjs <trace.json> --text
# Baseline of unit tests that do not need node_modules (no dependency installation was performed)
node --test tests/navigation-fix-processor.test.mjs
```

Further commands are in each report next to the number they reproduce.

## Safety record

See the last section of `final-decision-report.md` (Git status, forbidden-path check, privacy check) — written at the end
of the phase.
