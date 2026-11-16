# Phase 4.36 — shared context for every specialist (read this first)

Phase 4.36 is **investigation and feasibility**, not implementation. The product is Lastrico, a Milan-first
surface-aware navigation system (cars, motorcycles, bicycles). Baseline: `main` at `3e31da9` (Phase 4.35).
Repository root: `<repository root>`. Read `AGENTS.md` and
`experiments/README.md` (research rules) once.

## Hard rules (violating any of them fails the phase)

- No Cloudflare deployments, no production routing changes, no changes to `lib/`, `app/`, `components/`,
  `worker/`, `public/`, `data/`, `deploy/`, `db/`, `drizzle/`, `package.json`, `tests/` (read them, never edit).
  Rome (`rome-*`) is untouchable.
- No `git add/commit/push`, no PRs, no destructive Git commands. The principal agent owns Git state.
- No paid purchases, no account registration, no API keys, no large dependency installs (Node built-ins only;
  Node 26 is installed and runs `.mjs` and `.ts` directly; there is no Python venv — do not create one in the repo).
- Write only to: `outputs/phase436-surface-intelligence/` (reports, compact evidence) and
  `experiments/phase436-surface-intelligence/` (scripts, bounded caches; downloaded reference data goes to
  `experiments/phase436-surface-intelligence/cache/`, which is git-ignored by the existing `/experiments/*/data/`
  rule only for `data/` — so name the folder `data/`, i.e. `experiments/phase436-surface-intelligence/data/`).
- Label every claim **VERIFIED** (you saw it in a file/dataset/response you can name), **STRONGLY SUPPORTED**,
  **PLAUSIBLE** or **UNVERIFIED**. Never equate missing surface data with smooth asphalt; never equate a tram
  line with a rough surface; never claim a source has pavement attributes without inspecting its real schema.
- Reports are English markdown (only `final-decision-report.md` is Italian, written by the principal agent).
  Use file:line references, exact commands that reproduce each number, retrieval dates, checksums when useful,
  coordinate systems.
- Reuse before creating: archived provider responses (`outputs/phase425-benchmark/provider-responses.tar.gz`,
  `outputs/phase431/`, `outputs/phase32-benchmark/`, `tests/fixtures/`), the Milan benchmark
  (`scripts/benchmark-milan-routing.mjs`, `outputs/phase425-benchmark/`), earlier field-case reports
  (`outputs/phase431-*-report.md`, `docs/phase431-routing-decision-review.md`), research verdicts in
  `experiments/README.md`. Do not re-derive what earlier phases already established; cite it.

## Privacy — the GPS trace

The supplied trace (return journey, 2026-11-13) is at
`<local path>\lastrico-gps-trace-2026-11-13-18-26.json` (317,624 bytes,
SHA-256 `2aa69324cfdb2247323917c8aebe5f99891ae98418a4776f71f57bff07e4bffa`). It is real location history.
- Read it only locally. Never copy it into the repository, never paste raw coordinate lists, never include
  the origin or destination street/address in any report (call them "origin" and "destination", redacted).
- In reports use relative times, counts, 3-decimal-rounded coordinates, and names of public roads/junctions on
  the shared corridor only.
- **No network request may contain any coordinate that comes from the trace** (origin, destination, fixes).
  For routing experiments use public landmark coordinates the task itself names (Piazzale Lodi, Corso Lodi,
  Via Lazzaro Papi, Via Friuli, Viale Filippetti / Porta Romana, Naviglio Pavese junctions found in OSM data),
  archived responses, or the local road graph. Existing helper: `scripts/replay-gps-trace.mjs <trace> --text`.
- A redacted, aggregate summary already exists: `outputs/phase436-surface-intelligence/evidence/gps-trace-summary.redacted.json`
  (script: `experiments/phase436-surface-intelligence/scripts/gps-trace-forensics.mjs`).

## What the return trace already shows (VERIFIED from the file; principal agent's work)

- `lastrico-gps-trace` v2, app 0.5.0, area `milan`, mode `car`, 951 fixes (~1 Hz), 1013 s, 2 routes, 8 events.
- Route 0 (planned at fix 0): objective label `fast`, 4.703 km, 15.63 min, 242 vertices, 11 instructions. Pavé:
  confirmed 25 m, probable 0, unknown 285 m; one rough section "Piazzale Lodi", surface `sett`, 391–416 m along
  the route (the roundabout). Instruction list: depart SE on the origin street (219 m) → right onto Viale Umbria
  (173 m) → roundabout Piazzale Lodi, 2nd exit (68 m) → exit onto Viale Isonzo (2704 m) → left Alzaia Naviglio
  Pavese (672 m) → left, stay on Alzaia Naviglio Pavese (156 m) → right Via Fra Cristoforo (382 m) → left Via Don
  Rodrigo (145 m) → left Alzaia Naviglio Pavese (164 m) → left onto the destination street (17 m) → arrive.
- The driver left route 0 about 58–64 m after the start, at the first cross street to the right (heading ≈ 207°,
  SSW), 160 m before the planned right turn onto Viale Umbria. Lateral offset grew 44 → 66 m over 5 fixes; the
  app flagged `shouldRecalculate` at fix 104 and logged `off-route` + `reroute-start (wrong-turn)` at fix 105
  (t = 95 s); `reroute-success` at fix 106 with detail `safe:no-alternative` (the journey objective passed to
  the reroute was `safe`, i.e. anti-pavé, and no distinct alternative existed).
- Route 1 (after reroute): starts on Via Friuli 61 m off route 0, objective label `fast`, 4.334 km, 14.71 min,
  211 vertices, 8 instructions, confirmed 0 m, unknown 285 m, no rough sections. Geometrically it follows route 0
  after about 220 m: 198 of 211 vertices lie within 30 m of route 0, so the two routes differ only in the first
  ~220 m (Via Friuli side street vs. Viale Umbria + Piazzale Lodi roundabout). Both carry the same 285 m of
  unknown surface.
- The driver followed route 1 to the end of the recording: 754 fixes with accuracy ≤ 30 m, all within 10.8 m of
  route 1; no further reroute. The recording ends at 86.6 % along route 1, 141 m from the destination, arrival
  flag never set.
- The Piazzale Lodi warning was shown once at fix 0 (`pave-warning-shown 391:391`); no spoken warning; the
  nearest fix to the rough section was 129.5 m away → the driver never traversed it on the return trip.
- GPS: accuracy median 10.3 m, p90 30 m, p95 104.9 m, max 148 m; 95 fixes (10 %) worse than 30 m; two clusters
  of poor accuracy (start: fixes 6–9; ~490 m along route 1: fixes 247–289, up to 141 m); 21 fixes rejected as
  `invalid`; 31 % stationary fixes (249.5 s stopped in total); 14.1 km/h overall.
- Consequence to test: from the first junction, the Via Friuli alternative looks ≈ 250 m shorter than route 0
  (route 0 remaining 4635 m vs route 1 ≈ 4326 m + 61 m). If a legal, connectable shorter/faster route existed at
  planning time, why was it not planned? (candidate absent / illegal maneuver in the data / depart-edge snapping
  / ranking / provider). This is the open question for routing forensics.

## What the user reported about the OUTBOUND journey (NO GPS recorded; screenshots/observations only)

Anti-pavé route through Piazzale Lodi; the traversed part of the roundabout was physically stone setts while
Lastrico reported ~25–30 m of confirmed pavé; insufficient surface warnings; unnecessarily uncomfortable routing;
tram rails and rough stone paving around Corso Lodi / Via Lazzaro Papi; a questionable U-turn instruction.
Origin and destination of the outbound leg are not known precisely (do not assume it is the reverse of the
return leg unless you can show it). Do not use the return trace as evidence of outbound events.

## Output contract

Each specialist writes its deliverable into `outputs/phase436-surface-intelligence/<name>.md`, with compact
evidence under `outputs/phase436-surface-intelligence/evidence/<name>/` and scripts under
`experiments/phase436-surface-intelligence/scripts/`. End your final message with: files written, the 5–8 strongest
findings with evidence labels, blockers, and what the principal agent must reconcile with other workstreams.
