# Road intelligence experiment: rails as a separate routing dimension (local, 18 November 2026)

**Status: local experiment, off by default, not deployed.** It runs only with `LASTRICO_SIL_EXPERIMENT=rails` and a locally
generated layer set (`data/surfaces/sil-layers/`, git-ignored). The layers mix OSM, Comune di Milano DBT 2020 and ATM data
whose licences are not settled (see `ROAD_INTELLIGENCE_LICENSING.md`): they stay on the machine and are not published.

## What was built

- `lib/sil-rail-experiment.ts`: after the normal selection, for bicycle and motorcycle planner requests in Milan, the legal
  candidates are read against the layers. A candidate replaces the shown route only if it cuts the metres on a carriageway
  shared with mapped tram rails by at least 50 m, costs at most 120 s or 10 % over the fastest route (or the request's own extra
  time), and has no more pavé **and** no more surface risk than the route it replaces. Rails never enter the pavé score.
- Cars and navigation (reroute) requests are never touched. Outside the layers' coverage nothing changes.
- `scripts/sil/sil-benefit.mjs`: compares the same recorded cases with and without the chooser.
  `node scripts/benchmark-milan-routing.mjs --label=<x> --no-stability --sil-layers=<dir> [--sil-rails]`.

## Measured (264 recorded Milan cases, 175 two-wheeler cases, same provider answers, departure Mon 9 Nov 12:00)

| Measure | Result |
| --- | --- |
| Two-wheeler cases read against the layers | 168 of 175 (7 only partly covered, unchanged) |
| Cases whose normal route runs on mapped rails sharing the carriageway | 132 of 168 |
| Cases where a better route existed in the candidate pool and was shown | 9 |
| Rail exposure on those 9 | 4,301 m to 540 m (-87 %) |
| Time cost on those 9 | +470 s in total, median +33 s, max +101 s |
| Pavé or surface risk worse | 0 cases (confirmed + probable 132 m to 117 m) |
| Rail exposure over all 168 cases | 71.5 km to 67.8 km (-5 %) |
| Evaluation time | median 2.1 ms, max 13.8 ms per request (Node, warm); wall time unchanged within noise |

Reading: the gain is real but small in coverage because the candidate pool is built to avoid stone, not rails. Most journeys
stay on tram corridors because the alternatives the provider returns do too. A generation step that targets rails would reach
more cases and has not been built.

## Sources compared (Milan, 102,009 compiled road segments)

- DBT maps rails on 6,458 segments (5,583 on a shared carriageway); OSM flags 2,621; both agree on 2,479 segments in the box.
- DBT-only: 469 segments where OSM was asked and mapped nothing, 3,510 where OSM was not asked. OSM-only: 142.
- Rails whose absence in one source contradicts the other: 229 (OSM absent, DBT present) and 91 (DBT absent, OSM present).
- 74 contested segments and 962 weak dissents are listed as review tasks. Confidence bands of the fused overlay: 0 high,
  6,098 medium, 668 low (the overlay never claims "high").
- ATM service runs within 12 m of 2,561 mapped-rail segments and not of 789.
- None of the three sources describes pavement material, so they do not raise surface coverage or surface confidence.
  Rails are infrastructure evidence, never roughness.

## Not claimed

That rails are present or rough today, that a tram-free route is smoother, or any gain measured on a physical road or on
Cloudflare. The time cost and exposure are from recorded routing answers. CPU on the Worker and the bundle effect of the
experiment (one small module) were not measured.
