# Phase 4.36 — Surface Intelligence Layer (SIL): architecture, policies and bounded prototype (Agent 5)

Baseline `main` @ `3e31da9`, today 2026-11-14. **Design and an isolated offline prototype only**: nothing in `lib/ app/ components/ worker/ public/ data/ deploy/ db/ drizzle/ tests/`
was edited, nothing was deployed, Rome (`rome-*`) was not touched, no Git write. Labels: **VERIFIED** (seen in a named file/response/run), **STRONGLY SUPPORTED**, **PLAUSIBLE**,
**UNVERIFIED**. Everything labelled "prototype" is **design feasibility, not product validation**. No coordinate from the GPS trace is used; origin and destination are never named
(public names only). Evidence: `evidence/surface-intelligence-design/` (EV/ below). Scripts: `experiments/phase436-surface-intelligence/scripts/si-*.mjs`. Inputs cited: Agent 2 `osm-data-audit.md`
(defects D1–D16), Agent 1 `routing-forensics.md` (R1–R12), Agent 3 `external-data-audit.md` + `evidence/external-data-audit/schemas.json`.

## 1. Verdict in eight decisions

| # | Decision | Label |
|---|---|---|
| 1 | Build the SIL as a **hybrid**: a Git-tracked evidence ledger + a deterministic offline Node resolver produce a **sidecar overlay keyed by the existing tile tuple index**; the runtime reads **static, versioned, bundled tiles only**. D1 is the intake/review queue, never read on the routing path. Score 63/65 vs 60 (offline only), 41 (tiles only), 32 (D1 at request time) (§4). | VERIFIED (limits, counts) / PLAUSIBLE (scores) |
| 2 | **Evidence is never merged into one number.** Material, roughness, rails (presence/sharing/embedding/service/alignment), crossings, direction, kind, source, observation date, spatial precision, verification, confidence band, conflicts, freshness, version and licence are separate fields (§5, `sil.schema.json`). Unknown is a first-class state. | VERIFIED (schema validates the real fixture) |
| 3 | **Precedence is not "newest wins"**: rules by evidence kind, verification, coverage (spatial precision), age and *what the claim is about* (§7). Contradictions are kept and flagged; the resolved view records why. | VERIFIED (47/47 tests) |
| 4 | **Rails are infrastructure, not roughness.** A separate topic and separate overlay bits; DBT 2020 `EL_TRV_POS=02` + polygon containment feeds it offline. The join reproduces Agent 3's box numbers, finds tracks on 17 of the 18 Corso Lodi NW-arm ways (2 tracks on 16, 1 on one) and on none of the 9 ring/Papi ways (§6, §12). | VERIFIED (box only) / UNVERIFIED (physical rails) |
| 5 | **Segment identity = OSM way id + linear-referenced interval + way version + two anchor node ids**; tile tuple indices are a derived join key guarded by a base-tile hash (fail-open). Splits/merges/deletions have a tested re-anchoring policy (§5.3). | VERIFIED (tests) |
| 6 | **The overlay costs almost nothing on Workers Free**: ≈ 0.19 MB (central) to 0.28 MB (worst plausible) uncompressed = 2.2–3.1 % of the 8.83 MB base tiles, 1.4–2.0 % of the 13.4 MiB Worker, 0 extra subrequests, ≈ 2 MiB parsed (2.6 % of the 76 MiB hydrated base) (§12). | MODELLED from real counts |
| 7 | **Default policy P-A does not change a single routing category**; it adds flags and review tasks (shadow-safe). Weighted stone on the 69.1 m ring traversal: P-A 25.0 m; P-A with `surface_bike` read for every mode (Agent 4's layer La) 45.2 m; conservative P-B (any applicable weak dissent contests) 53.7 m. That choice is the owner's (§7.3, §15). | VERIFIED (prototype) / OWNER DECISION |
| 8 | **Phase 4.37 = data plumbing + shadow diagnostics**, not new ranking: re-extraction with version/timestamp, DBT rails join, ledger + resolver + overlay + manifest, additive `diagnostics.sil` and dataset version in response/trace; the scorer reads one flag word and adds counters, ranking untouched. Ranking changes wait for Agent 4's calibration and the owner (§13). | PLAUSIBLE |

## 2. What the runtime consumes today (the adapter must fit this)

| Item | Fact | Where | Label |
|---|---|---|---|
| Tile tuple (slim) | `[wayId, nameId, [lon1,lat1,lon2,lat2], kId, rw, svId, flags, mdBits, maBits, hcId, tagSetId]`; **one segment = one vertex pair**; no node ids, no OSM version/timestamp, raw tags dropped except access/direction keys | `lib/spatial-road-store.ts:97-109`, `scripts/osm/compile-compact-tiles.mjs:58-75,139-153` | VERIFIED |
| Segment identity today | `osmWayId` + the coordinate string (`segmentHash` of a slim tuple is `lon,lat->lon,lat`) | `spatial-road-store.ts:265` | VERIFIED |
| What ranking reads | `surfaceCategory`, `roughnessWeight`, `surface.value` (names in warnings), `modeAccess`, `modeDirections`, access tags, `osmWayId`; `embeddedRails` is **counted but has no reader**; `smoothness` is never read | `road-intelligence-scoring.ts:598-614,739-766`; Agent 2 D6/D7 | VERIFIED |
| Provenance today | `observedAt: null` always, one `sourceGeneratedAt` stamped on every segment, confidence derived from the category | `spatial-road-store.ts:294-307`; D12 | VERIFIED |
| Hydration | lazy per tuple (`getHydratedSegment`), ≤ 64 hydrated tiles | `spatial-road-store.ts:398,541-558` | VERIFIED |
| D1 | used **only** by `road_reports` (`db/schema.ts`, `app/api/reports/route.ts`); binding `DB` in `deploy/pilot.json`; a test forbids `app/api/routes/route.ts` from touching it | `tests/phase434-diagnostics.test.mjs:263` | VERIFIED |
| Worker | `/api/routes` runs in the `RouteEngine` Durable Object (8 shards), not in the 10 ms Worker; bundle 13,379.79 KiB (gzip 3,358.41 KiB) with 117 Milan tile modules (8.83 MB JSON + 0.11 MB metadata) and Roccella (1.27 MB) | `worker/route-engine.ts:17,66-88`; Phase 4.35 report §1; `du` | VERIFIED |
| Free-plan limits | CPU 10 ms/request; memory 128 MB/isolate; 50 external subrequests; Worker 64 MiB **uncompressed, no compressed limit** (the repo comment "3 MB gzipped" in `compile-compact-tiles.mjs:336` is obsolete; Phase 4.35 shipped 3,358 KiB gzip); 100k requests/day; static assets 20,000 files, 25 MiB each. D1 Free: 5 M rows read/day, 100 k rows written/day, 50 queries/invocation (a batch counts once), 100 bound parameters, 500 MB/DB | EV/cloudflare-limits-request-log.json (4 of 6 allowed requests, fetched 2026-11-14 through a summarising fetch) | VERIFIED (page) / DO limits cited from Phase 4.33 |
| Measured costs | DO route CPU median 156 ms, max 314 ms (Free test Worker); 76 MB at 64 hydrated tiles, 107 MB with all 117, isolate 128 MB | `outputs/phase433-milan-workers-free-reliability-report.md` §6 bis; `phase430-worker-reliability-report.md` §2 | VERIFIED |
| Shared-file risk | the Milan-only release copy strips Rome from 6–7 shared files by three-way merge; touching `lib/spatial-road-store.ts` must pass that copy's tests | Phase 4.33 §3.5, Phase 4.35 §1 | VERIFIED |

Consequence: **anything a new layer wants the ranking to feel must be expressible as `surfaceCategory`/`roughnessWeight`/`modeDirections` (no engine change) or as one small flag word (a separate Phase 4.37 scorer change).**

## 3. Required concepts and where each lives (kept separate)

| Concept | SIL field | Notes |
|---|---|---|
| Road geometry | not stored: OSM geometry + compiled tiles | SIL never rewrites geometry |
| Segment identity | `refs[]`: `wayId`, `fromM`, `toM`, `wayVersion`, `wayLengthM`, `anchorNodeIds[2]` | §5.3 |
| Direction / carriageway | `refs[].direction`, `refs[].carriageway`; topic `direction` (`oneway` + basis) | turn restrictions: topic reserved, provider keeps authority |
| Surface material | topic `surface_material`, attribute `material` (+`rawValue`, `scope`) | same vocabulary as `SurfaceMaterial` (tested) |
| Observed physical roughness | topic `physical_roughness`, `level` (+`basis`, optional `measure{metric,value,unit,speedKph,vehicleClass,windowM}`) | OSM `smoothness` maps here; never to material |
| Presence of rails | topic `rails_presence`: `presence`, `railType`, `sharing`, `embedding`, `service`, `alignment`, `trackCount` | each attribute resolved independently |
| Actual rail crossings | topic `rail_crossing`: `atM`, `crossingAngleDeg`, `trackCount` | point feature, carried, not resolved in v0 |
| Vehicle-mode applicability | `modes[]` on every evidence; resolver runs per mode | a bicycle-lane tag is not car evidence |
| Evidence source | `kind` (tagged / measured / reported / derived / inferred) + `sourceId` → `sources[]` | |
| Observation date | `observedAt` (nullable), `observedAtPrecision`, `observedAtBasis`, `recordedAt` | null stays null; period start used for age |
| Spatial precision | `spatialPrecisionM` + per-ref `coverage` (exact / partial / coarse / adjacent) | |
| Verification | `verification` (unverified / machine_checked / human_verified / field_verified / rejected) + `verifierRole` | |
| Confidence estimate | evidence: `sourceConfidence` exactly as the source states it; view: ordinal `band` (none/low/medium/high), `basis: rule_prior_v0`, `value: null` | not a probability; never merged with the category weight |
| Conflicting evidence | view `candidates[]`, `supportingIds`, `dissentingIds`, `ignored[]`, `weakDissent`, `reasons[]` | |
| Freshness | view `freshness{state, oldestObservedAt, newestObservedAt}` | state = fresh / aging / stale / unknown_age |
| Dataset version | manifest `datasetVersion`, `ledgerSha256`, `baseTilesSha256`, `policyVersion`, `resolverVersion`, per-tile overlay hashes | §9 |
| Licence + attribution | `sources[].licenceId`, `attribution`, `licenceNote`; manifest lists them | §10 |

## 4. Architecture comparison

Options: **O1** versioned static spatial tiles only (hand-maintained sidecars); **O2** offline deterministic Node build from sources + Git ledger → static tiles; **O3** D1 curated evidence queried at request time;
**O4** hybrid = O2 + D1 as intake/review queue only. Score 0–5 (5 best), my judgement from the evidence column.

| Criterion | O1 | O2 | O3 | O4 | Evidence |
|---|---|---|---|---|---|
| Reproducibility | 3 | 5 | 1 | 5 | O3: a response depends on mutable rows; today's pilot already records no graph/candidate version (R11) |
| Build determinism | 2 | 5 | 1 | 5 | prototype: fixture, views, overlay, DBT join byte-identical over two full runs (EV/checksums.sha256) |
| Spatial matching | 3 | 5 | 2 | 5 | O2/O4: join by way id + interval + node anchors offline; DBT→OSM 99.3 % of car-way metres within 12 m (Agent 3); O3: way-id rows only, ≤ 100 params/statement, no verified spatial index (UNVERIFIED) |
| Memory | 5 | 5 | 4 | 5 | overlay ≈ 2 MiB parsed (0.11 MiB typed) vs 76 MiB hydrated base |
| Query performance on Free limits | 5 | 5 | 2 | 5 | O3: ≥ 1 D1 batch per route, 69 ways on route 0 → 150–400 rows/request → ceiling 12.5 k–33 k routes/day from rows-read alone (ANALYTICAL), latency UNVERIFIED |
| Regional portability | 3 | 5 | 3 | 5 | per-area ledger/manifest/overlay beside `*-tile-index.ts`; absent overlay = OSM-only; Rome not touched |
| Observability (stale/contradicted) | 1 | 4 | 3 | 5 | O4: build report + view states in `diagnostics.sil` + D1 task queue |
| Provenance | 1 | 5 | 3 | 5 | every flag traces to ledger ids → source → licence |
| Privacy | 5 | 4 | 2 | 4 | O3 puts user-linked rows in the routing path; O4 keeps coarse aggregates outside it |
| Cost | 5 | 5 | 3 | 4 | O3/O4 use free D1 quotas (5 M reads, 100 k writes/day); no Paid plan needed for O4 |
| Ingest new evidence without rewriting the engine | 3 | 5 | 2 | 5 | O3 needs an async lookup in the scorer hot path |
| Rollback | 4 | 5 | 2 | 5 | O4: redeploy previous overlay or `mode: off`; O3: DB state (Time Travel 7 days on Free) |
| Evidence intake and verification workflow | 1 | 2 | 4 | 5 | existing `road_reports` already has pending/verified/rejected moderation |
| **Total (max 65)** | **41** | **60** | **32** | **63** | |

**Recommendation: O4.** Rationale: the field failures came from data the engine cannot see (D1–D8, D12–D14), not from compute; the Durable Object has 30 s of CPU, so the binding constraints
are reproducibility, bundle/memory and privacy, where static tiles win. D1 earns its place only where mutation is the point: moderated reports and the verification queue.

## 5. Experimental schema

Files: `sil.schema.json` (JSON Schema 2020-12; documents `ledger`, `resolvedViews`, `overlayTile`, `manifest`), `sil-types.ts` (erasable TypeScript, 16 unions checked against the schema), `sil-d1.sql`
(runs on SQLite via `node:sqlite` in the tests), `policy.v0.json` (all thresholds, versioned). A tiny validator (`si-lib.mjs`, no install) validates the real fixture; 8 negative tests reject
missing verification, bad enums, a claim of the wrong shape for its topic, extra properties, malformed dates, a user report without consent, a single numeric confidence field, bad overlay entries.

### 5.1 Evidence record (one claim about one topic on one or more segment refs)
```
{ id, refs:[{wayId, fromM, toM, wayVersion, wayLengthM, anchorNodeIds:[a,b], coverage}], topic, claim:{...topic-specific...}, modes:[car|motorcycle|bicycle],
  kind, sourceId, sourceRef:{...native pointers: way version, timestamp, changeset, photo id, DBT segment ids...},
  observedAt|null, observedAtPrecision, observedAtBasis, recordedAt, spatialPrecisionM, verification, verifierRole, sourceConfidence?, consent?, notes }
```
A `reported` record **requires** `consent{version, aggregated}`. No image, no user id, no trace is representable.

### 5.2 Views and overlay
Resolved view per (segment, topic, **attribute**, mode, policy variant): `state` (unknown / known / contested), `value`, `candidates`, `confidence` (band), `freshness`, `weakDissent`, `reasons[]`
(`R1…R10`), `supportingIds`, `dissentingIds`, `ignored[{id,reason}]`, `reviewTasks[{reason,priority}]`, `explanation`. Overlay entry: `[tupleIndex, flags, categoryOverride, roughnessWeightOverride, mdBitsOverride]`;
flag bits in `policy.v0.json`: rails mapped / shared carriageway / contested; surface contested / weak dissent / unknown-by-evidence; confidence band (2 bits); freshness (2 bits); direction override; needs review; rail crossing.

### 5.3 Identity across OSM edits (way splits, merges, deletions)
- Identity is the ref, not the tile tuple. The interval is in metres along the way with the scorer's metric; anchors are the node ids at both ends of the interval (node ids survive way edits).
- **Unchanged version** → exact. **Merge/renumber** (both anchors in one new way) → interval recomputed from cumulative metres, `needsReview`. **Split** (anchors now in two ways) → one ref per way, both flagged for review,
  `verification` of physical claims is not upgraded. **Deleted/anchors gone** → status `orphaned`: the record is **kept**, excluded from views, queued; tagged/derived claims are simply re-derived from the new extract.
- Tile join: an overlay entry is valid only while `baseTileSha8` equals the base tile's hash; on mismatch the overlay is ignored (fail-open to OSM-only). The overlay is rebuilt in the same step as the tiles.
- Prototype check (VERIFIED): all 36 fixture ways have the same length in the raw archive and in the committed tiles (max |diff| 0.0 m, `fixture-checks.json`); intervals map to tuples by exact vertex pair; 4 tests cover split/merge/delete.

## 6. Ingestion per source

| Source | Design | Prototype / measured |
|---|---|---|
| **OSM re-extraction** (`scripts/osm/expand-milan-citywide.mjs` successor) | keep per way: id, **version, timestamp, changeset** (no user names), **node id list**, an allow-list of raw keys (`surface*`, `smoothness`, `surface_bike`, `check_date*`, `survey:date`, `source:surface`, `railway`, `tram`, `embedded_rails*`, `lanes:*`, `junction`, `oneway*`, access family, `layer/bridge/tunnel`); add `way["railway"~"^(tram|light_rail)$"]` (D1/D3); keep node ids/versions instead of the fabricated `version: 1` (D2); record `osm3s.timestamp_osm_base` per sector and the query hash (7 of 8 sectors have it, `n-east` is null: Agent 2); one OSM snapshot date per segment, not one per dataset (D11/D12). Tag-level survey dates only through the history API for ways in the review queue (Agent 2 needed 1 call per way); `source=survey` is the mapper's declaration, UNVERIFIED as quality. | `si-build-fixture.mjs` reads version/timestamp/tags/node ids for 36 ways from the **existing** archives (≈ 5–6 s to load the 19 Milan gzip archives, 24.9 MB for the whole `data/sources`): the data are already there, only the compiler drops them (D12/D13). `observedAt` is set only where Agent 2's history lookup proved a survey changeset: 8 of the 36 tagged claims (4 surface, 4 smoothness); the other 28 stay `null`. |
| **DBT 2020 rails** (offline Node) | range-extract `EL_TRV`, `AC_VEI`, `SD_FER` from the 596,533,009 B zip (Agent 3 method), EPSG:7791 → WGS84 with `lib/utm.mjs` (0.000 m vs the server), classify by spec code `POS` (**not** the Comune's swapped `_d` labels) + polygon containment, join to compiled segments (axis within 5 m and 30°, ≥ 50 % of the segment; crossings: ≤ 3 m and ≥ 60°), emit **derived** evidence per way run with the zip hash, licence, survey 2020-03. `EL_STR_FON` is registered `nonDiscriminatingFor` material and never ingested at scale. | `si-dbt-join.mjs` on Agent 3's cached box (36 axes, 2,367 compiled segments, 39,565 m): **112 segments / 2,264 m flagged, 59 crossing events, ≈ 1.6 s**. Cross-check vs Agent 3: pos02 shared-carriageway 2,073 m (Agent 3 2,059), pos01 own right-of-way 1,435 m (1,435), axis total 3,514 m (3,514); 82.5 % of axis metres lie within 5 m of a compiled segment. 17 of 18 Corso Lodi NW-arm ways get rails (2 tracks on 16, 1 on one; 456.1 m of two-way sett way × 2 = 912 m, Agent 3: 898 m); ring 7/7 and Papi 2/2 none; Via Friuli two ways, 58.8 m (Agent 3: 60 m). Outside the box nothing is claimed. |
| **ATM ds538** | derived `service` only (never presence): ≤ 12 m from a line vertex; absence of a line is `no_scheduled_line`, not removal | 18 Corso Lodi ways: `no_scheduled_line` (file 2026-07-24); 2 Via Friuli ways: `in_service` |
| **KartaView / Panoramax / Mapillary** | **verification queue, never automatic evidence**: a task lists candidate image references (provider, id, date, heading, licence) whose view cone covers the interval; a human (or model-assisted, then human) review writes a `measured`, `human_verified` record with the image **reference**; pixels are never stored; no model labels before a Milan labelled sample exists (Phase 4.20 NO-GO, Agent 3 sizing ≈ 250 positives/class) | one real photo (2016-06-15, GPS ±5 m, heading 339°) recorded as `measured`/`unverified`/`agent_visual`: `exact` on 1 ring way, `partial` on 2, `adjacent` on 2 (outside the view cone) |
| **User field reports** | public flow → moderation (`pending/verified/rejected`, exists) → snap script to way + 25 m bucket, week precision, enumerated values only, drop note/nickname/route summary/6-decimal coordinates → `sil_report_intake` → aggregate → export at k ≥ 3 verified reports per bucket. The on-device CSV export (`LocalFieldFeedback.tsx`) carries route from/to and notes and must be stripped the same way. | `sil-d1.sql`: 5 tables, privacy test (no lat/lng/ip/nick/note/device/user column), CHECKs reject non-25 m buckets and day-precision dates |
| **Phone sensors (Agent 6, opt-in)** | `measured` roughness: `measure{metric,value,unit,speedKph,vehicleClass,windowM,samples}` aggregated per way + 25 m bucket + speed band + vehicle class, k ≥ 5 contributors enforced by a CHECK; no trace table exists | schema and D1 table reserved only; no sensor data in 4.36 |
| **Works / maintenance** (ds925, press) | **review trigger only** (§8); never changes a value | 0 hits on the landmarks (Agent 3) |

## 7. Conflict-resolution policy

### 7.1 Rules (resolver `si-resolver-0.1.0`, per segment × topic × attribute × mode)
| Rule | Content |
|---|---|
| Applicability | evidence whose `modes` lack the target mode is **informational** (e.g. `surface_bike` for a car); `coverage: adjacent` is a **review trigger, never a vote**; `inferred` never votes in v0; non-discriminating sources (DBT `FON`) are kept and ignored; `rejected` is ignored. |
| Level | **decisive** = human/field-verified measured/reported with a known date, exact/partial coverage, not stale. **supporting** = tagged; derived from a source authoritative for that attribute; unverified measured that is fresh/aging. **weak** = unverified reports, non-authoritative derived, coarse coverage (precision > 2× the interval), stale non-tagged evidence, absence claims from a source not declared complete. |
| R1/R1X | one decisive value → known; two decisive values → contested, no winner. |
| R2/R3 | one supporting value, no dissent → known (single source / agreeing sources). |
| R4 | ≥ 2 supporting values → contested; or one supporting value with weak dissent from **≥ `contestedMinDissentKinds` distinct kinds** (P-A: 2, P-B: 1) → contested. |
| R5 | otherwise weak dissent is kept: known + `weakDissent` + review task P2. |
| R6/R6X | only weak evidence: agreement → known (band low); disagreement → contested. |
| R7 | no voting evidence → **unknown**, value null, band none. Nothing infers a material from neighbours. |
| R9 | adjacent evidence → task P2. R10 topic isolation: rails never set material or roughness; roughness never sets material (tested by removing whole topics). |
| Bands | high = decisive + fresh; medium = decisive aging, or supporting with a known fresh/aging date, or ≥ 2 independent sources agree incl. a supporting one; low = unknown age, stale, weak-only, contested, weak dissent; none = unknown. Unverified evidence never exceeds medium. |

Precedence is therefore a function of (kind, verification, coverage, age, topic/attribute), never of recency alone. Tested: an **older** field-verified observation beats a **newer** unverified report
and keeps the report as dissent; two field-verified observations that disagree are contested.

### 7.2 Worked examples on the real field cases (`resolved-views.txt`, `variant-comparison.json`; asOf 2026-11-14)
Car view under P-A (default), P-B (conservative), and bicycle P-A. Format: state value [band/freshness].

| Case (way, length) | Evidence in the ledger | P-A car | P-B car | P-A bicycle |
|---|---|---|---|---|
| Ring #1 `287070936` (25.0 m) | tagged sett (changeset 2023-09-05, survey), smoothness bad; owner report sett (coarse) | known sett [medium/fresh], rests on 2 sources | same | same |
| Ring #2 `111768010` (31.0 m) | tagged asphalt (2023-09-05, survey) + smoothness excellent; `surface_bike=milanese_paving` (bicycle-only, 2013); owner report sett (±35 m); 2016 photo = **adjacent** (67.6 m, outside the cone) | **known asphalt + weak dissent [low]**; dissent = the report only; `surface_bike` informational for car; photo → trigger. Tasks P2 ×2 | **contested** | **contested** (surface_bike + report = 2 kinds) |
| Ring #3 `111767966` (13.1 m) | tagged asphalt (2019-02-20, survey), good; owner report sett; photo adjacent | known asphalt + weak dissent [low/aging] | contested | known asphalt + weak dissent |
| Way ahead of the 2016 photo `713165251` (8.2 m) | tagged asphalt (no date); photo `exact` but **stale** (10.4 y) and unverified; `surface_bike` | known asphalt + weak dissent (photo) [low/unknown age] | contested | contested |
| Corso Lodi two-way sett `305989915` (86.1 m) | tagged sett (no date); DBT 2020 tracks ×2 shared carriageway; ATM no line; owner rails report (±150 m) | material known sett [low/unknown age]; **presence known present [medium]** (DBT supporting + report weak); sharing shared_carriageway [medium]; **service = no_scheduled_line + weak dissent** (ATM 2026-07 supporting; DBT 2020 `in_service` stale, kept); **embedding: no record = unknown** | service contested | same |
| Via Lazzaro Papi `164940303` (25 m sett) | rails: DBT absence (weak: DBT not declared complete) vs coarse owner report present (weak) | presence **contested** [low], task P1 | contested | contested |
| Via Fra Cristoforo ×5 (259.6 m, untagged) | DBT `FON=01` (ignored: constant on 55,554/55,554 segments); neighbour-asphalt inference (never votes) | **unknown**, value null, band none, tasks P3 | same | same |
| Ring `713165261` (10.3 m, no `oneway`, compiled two-way) | provider graph (Agent 1 V9) says one-way, probe 2026-11-14; topology inference informational | direction known forward [medium] → overlay `mdBits` car forward (existing field) | same | unknown (provider evidence is car/motorcycle only) |

One explanation as stored (ring #2, P-A, car): *"known = asphalt [band low; fresh] | rests on: ev-osm-surface-111768010[asphalt; tagged/unverified; supporting; fresh 1166d; cov exact] |
dissent: ev-owner-report-ring[sett; reported/unverified; weak; age unknown; cov coarse] | adjacent (review trigger only, never a vote): ev-kartaview-2203776 | ignored:
ev-osm-surfacebike-111768010 (MODE_NOT_APPLICABLE(bicycle!=car)) | why: R2_SINGLE_SOURCE, R5_WEAK_DISSENT(reported), R9_ADJACENT_ONLY"*.

### 7.3 What the ring example shows (honestly)
- With the default rule the resolver does **not** by itself repair the field failure: one coarse, unverified report cannot overturn two survey edits; it is **kept, flagged and queued** (P2). The decisive step is the 5-minute field check with photo.
- Under P-B the 44.1 m of ring ways #2/#3 become `probable_rough` (weight 0.65): **weighted stone on the traversal 25.0 → 53.7 m** (arithmetic: 25 + 0.65 × 44.1; `variant-comparison.json`). At Agent 1's "strong" exchange rate (1 m confirmed stone ≈ 1.2 s) that is
  ≈ +34 s of burden on route 0 (derived arithmetic). Whether to accept more false positives (asphalt treated as probable stone) to avoid false negatives (stone shown as smooth) is a product decision.
- **Variant P-A+bikeWide** (the same default rule, but the non-standard `surface_bike` key read as applying to every mode, which is what Agent 4's layer La assumes): ring #2 (31.0 m) becomes contested for the car (surface_bike + report = 2 kinds), ring #3 stays flagged: confirmed 25.0 + probable 31.0 + flagged 13.1 m, **weighted 45.2 m**. So the three outcomes (25.0 / 45.2 / 53.7 m) differ by one owner-level assumption each: how far a coarse report counts, and whether a bicycle-lane tag describes the car lane.
- Not newest-wins: the only recent evidence (2026 report) does not override a 2023 survey, and the oldest (2016 photo) is not discarded for being old; it is down-weighted by policy and kept.

## 8. Staleness and re-verification (`policy.v0.json`, **PLAUSIBLE defaults, owner-adjustable**)
Age = asOf − start of the observed period (conservative); `asOf` is a build input, never the clock (tested: reading the ring #1 tag in 2034 gives `stale` + a P3 task, value unchanged). Null date → `unknown_age`.

| Kind × topic | fresh ≤ | aging ≤ | stale beyond → effect |
|---|---|---|---|
| tagged (any topic) | 5 y | 10 y | no expiry: flag + P3 re-verification; unknown_age when no survey date |
| measured, surface (imagery/field) | 2 y | 5 y | capped to weak (the 2016 photo is 10.4 y) |
| measured, roughness (sensor) | 1 y | 3 y | capped to weak |
| reported | 90 d | 365 d | capped to weak; expire from export after 730 d unless corroborated |
| derived, rails presence (DBT 2020 = 6.7 y: fresh) | 10 y | 15 y | rails are permanent infrastructure; source is never updated → refresh when a new DBT exists |
| derived, rails `service` / direction | 1 y | 2 y | capped to weak (DBT 2020 `in_service` is stale; ATM 2026-07 is fresh) |
| inferred | n/a | n/a | never votes |
Works/maintenance feeds (ds925 "Avvisi di manomissione", Comune notices, press reports on pavé removal), OSM way version changes since the ledger, DBT/ATM refreshes: **review triggers only**
(task P2/P3, expire in 60 days); they open verification, they do not change a value. Re-verification cadence: P1 in the next field round, P2 within the release cycle, P3 on the next source refresh.

## 9. Versioning, rollback, observability
- **Dataset version** `sil-<area>-<YYYY-MM-DD>.<n>` in the manifest with `baseTilesSha256` (Merkle of per-tile hashes; today only a monolith `compactTilesSha256` exists), `ledgerSha256`, `policyVersion`, `resolverVersion`,
  `osmBase[]`, per-tile overlay hashes, sources + licences, `previousDatasetVersion`. Prototype manifest validates; two builds of each overlay variant are byte-identical.
- **Every route response and GPS trace carries** `silDatasetVersion` + `mode` (and the provider `tileset_last_modified`, closing R11): additive field, plus a response header next to `x-lastrico-route-engine`.
- **Modes**: `off` (overlay not loaded), `shadow` (flags counted in diagnostics, scoring unchanged; the 4.37 default), `on` (categories/direction overrides applied). A Worker variable switches modes without a code change.
- **Rollback**: set `off` (variable) or redeploy the previous overlay (static files); an overlay whose `baseTileSha8` mismatches self-disables. Remember Phase 4.33: a Cloudflare rollback after Durable Object creation needs the prepared rollback build.
- **Regions**: one ledger, policy variant, manifest and overlay directory per area (`data/sil/<area>/`, loaders mirroring `milan-tile-index.ts`/`roccella-tile-index.ts`); the manifest `area` is checked against the store's area. Milan first. Roccella (22.4 % known surface, 176.5 km) would start from OSM + field records only: no municipal rails source was looked at (UNVERIFIED), and its verification queue is long. Rome: `area: rome` is reserved in the schema, **no Rome file, loader, data or test is created or edited**, and the Milan-only release method (Phase 4.33) keeps Rome out; an absent overlay means OSM-only behaviour.
- **Observability without telemetry** (architecture.md forbids location telemetry): `diagnostics.sil` per response holds **counts only**: metres by view state, rails-mapped / contested / weak-dissent / unknown-by-evidence / stale metres, overlay misses, base-hash mismatch. No way id lists, no coordinates.
  Staleness and contradictions are detected **offline**: each build writes a report (views by state, tasks by priority, ways whose OSM version changed since the ledger, orphaned refs, DBT/ATM disagreements) and diffs it with the previous version; corpus replays (Agent 4's benchmark) rank ways by exposure, like `tools/road-dashboard`.

## 10. Licensing and attribution (reading of texts, **not legal advice**; Agent 3's analysis)
| Component | Licence | May be combined / redistributed |
|---|---|---|
| OSM tags, geometry, anchors, compiled tiles | ODbL 1.0 (© OpenStreetMap contributors) | the compiled tiles are a Derivative Database; share-alike applies if the database is **publicly used/conveyed**; routes and warnings are Produced Works (attribution only) |
| DBT 2020 derived rails flags, ATM `service` | CC BY (CKAN `cc-by`; "4.0" per portal, version not re-verified) | attribution "Comune di Milano, CC BY" + indication of changes; **keep as a separate, labelled layer with its own provenance**; never write DBT-derived facts into OSM |
| Imagery references (KartaView, Panoramax, Mapillary) | CC BY-SA 4.0 (+ Mapillary API terms) | store references only; viewing and human review are free of conflict; model-derived labels may be adaptations: images/weights stay out of the repo |
| User/field reports | **no terms exist yet** (`PROJECT-CONTRIBUTION-TBD`) | needs a contribution licence and a consent text before any export or publication |
| Orthophotos AGEA, Google Street View | institutional only / contractual limits | **not usable** |
Each overlay flag bit is traceable to a source and licence through the ledger; the manifest lists attribution strings. **Legal questions for the owner** (§15): whether one merged tile file may be offered under ODbL while containing CC BY-derived flags; whether a fact read from a CC BY-SA photo is an adaptation;
contribution licence for reports; whether DBT's licence is CC BY 4.0 exactly.

## 11. Adapter surface (what Phase 4.37 would change; **not part of this design's implementation**)
1. **Data loading** (`lib/spatial-road-store.ts`): per tile, an optional `import()` of `data/sil/milan/<tile>.sil.json` next to the tile loader; keep `Map<tupleIndex, entry>`; check `baseTileSha8`; absent/mismatched = no overlay.
2. **Hydration** (`hydrateTuple`, which already receives the tuple; `getHydratedSegment` knows `idx`): apply `categoryOverride`→`kId`, `roughnessWeightOverride`→`rw`, `mdBitsOverride`→`mdBits` **before** hydration, and attach `silFlags?: number` to the record. With `mode: shadow` the overrides are skipped.
3. **Scorer** (`scoreRoadIntelligence`, next to `embeddedRailsMeters` at `:763`): accumulate `railsMappedMeters`, `railsSharedMeters`, `contestedMeters`, `weakDissentMeters`, `lowConfidenceKnownMeters`, `staleMeters` from `best.silFlags`; return them additively.
   No change to matching, `selectOptimizedRoute` or ranking in 4.37.
4. **Warnings** (`rough-sections.ts`): rails need their own section builder (`buildRailSections`), not the rough-section path (rails ≠ roughness); wording "binari tram (dati 2020, non verificato)"; a contested section gets a different phrase. Product decision per mode (§15).
5. **Response/trace**: `diagnostics.sil` + `silDatasetVersion`.
What the scorer reads for **rails** = bit RAILS_MAPPED/SHARED; for **uncertainty** = the CONF and FRESH bits plus SURFACE_CONTESTED / WEAK_DISSENT. Everything else the ranking already consumes through existing categories and `modeDirections` (the ring one-way fix needs no scorer change).
Limit: v0 overlay is **car/motorcycle**; the scorer's categories are mode-independent, so a bicycle overlay waits for mode-specific categories (4.38). Via Friuli carries 58.8 m of shared tram track (§6): a naive rails penalty would penalise exactly the shorter return alternative (Agent 3) — hence shadow first.

## 12. Prototype and measurements (design feasibility)
`node si-dbt-join.mjs && node si-build-fixture.mjs && node si-resolve.mjs && node si-overlay-compile.mjs && node si-size-estimate.mjs && node si-tests.mjs` (repo root, Node 26, no install).
- Fixture: **94 evidence records** (36 tagged, 53 derived, 2 reported, 1 measured, 2 inferred), 9 sources, 36 ways, 105 KB; **73 resolved views** (way × topic). Attribute states: surface material 23 known + 5 known with weak dissent + 5 unknown; roughness 8 known; rails presence 29 known + 2 contested (both Papi ways); rails service 18 known with weak dissent + 3 known; direction 1 known.
- **Tests 47/47** (`test-results.txt`): schema (8 negative), TS parity, determinism, order independence, topic isolation, unknown never smooth, adjacent never votes, mode applicability, synthetic precedence, staleness by `asOf`, re-anchoring, overlay hash/shadow-safety, D1 DDL + privacy, scope (no Rome path).
- **Overlay on the real tiles**: 100 flagged tuples in 5 tiles (4.7 KB with manifest, 18.9 B/entry); P-A overrides 0 categories, 4 `mdBits` (ring `713165261`: two-way → forward for car/motorcycle via the existing field), 38 rails-mapped, 7 rails-contested, 33 weak-dissent (entries, a tuple on a tile boundary counts once per tile); P-B overrides 33 tuples to `probable_rough`/0.65; known views never disagree with the base category (0 mismatches).

| Quantity | Value | Basis |
|---|---|---|
| Base: segments / ways / tiles / bytes | 102,028 / 28,146 / 117 / 8,828,888 B (+112,766 B metadata); gzip per tile 2.20 MB; 87 B per segment | **real** |
| Overlay entries Milan, rails only | central ≈ 9,600 (5,000–14,000) | **modelled**: box flagged 112 × (3,096 citywide tram axis records / 36 in the box); central dense box may overstate |
| Overlay entries, all plausible layers | ≈ 10,800 (S2) to ≈ 14,000 (S3 incl. 1,184 `surface_bike`, 2,000 report/sensor aggregates) | modelled (Agent 2 D4: 370 ways, 19.0 km) |
| Overlay bytes (uncompressed / gzip) | central 189 KiB / ≈ 40 KiB; S3 270 KiB / ≈ 57 KiB; = 2.2–3.1 % of base tiles | modelled × measured 18.9 B/entry |
| Worker bundle | +1.4 % (central) to +2.0 % (S3) of 13.4 MiB; limit 64 MiB uncompressed, ≈ 50.9 MiB free; 0 extra subrequests, 0 extra requests | cited limits + modelled |
| Resident memory | parsed JSON arrays 1.96 MiB for 9,632 entries (213 B/entry) = 2.6 % of 76 MiB; typed arrays 0.11 MiB | measured heap delta (forced GC) |
| Request-time CPU | `Map.has` 54–258 ns per lookup (two noisy Node runs); lookups only for tuples actually hydrated (hundreds–low thousands per route) → tens of µs; DO route CPU is 156 ms median | measured microbenchmark, not workerd |
| Build time | archives 4.8–6.0 s, tiles 0.5 s, DBT box join ≈ 1.6 s, resolve + compile < 0.2 s; full fixture build ≈ 14 s; synthetic city-scale join (3,096 seeded pseudo axes × 102,028 segments, 869 k samples) 0.4–1.0 s, +4.6 MiB heap | measured; **real citywide SHP parsing of the DBT zip not run** (UNVERIFIED, a few minutes at most is PLAUSIBLE) |
| D1 at request time (rejected) | 69 ways on route 0 (measured, Agent 2); 150–400 rows per request assumed → 12.5 k–33 k routes/day ceiling from the 5 M rows-read quota | analytical; latency UNVERIFIED |

## 13. Phased plan

| Phase | Scope | Acceptance tests | Rollback | Measurable benefit |
|---|---|---|---|---|
| **4.37 minimal** | (a) re-extraction with version/timestamp/node ids/raw keys/tram ways + `osmBase`; (b) DBT rails join citywide (Milan only) → ledger; (c) resolver + overlay + manifest with per-tile and base hashes; (d) `mode: shadow`: `diagnostics.sil`, `silDatasetVersion` in response/trace, scorer counters; (e) curated records for ring/Corso Lodi/Papi/Fra Cristoforo; (f) review-task report | two builds byte-identical; overlay valid or self-disabled on hash mismatch; **route payloads byte-identical with `off` and `shadow`** (Phase 4.33 style 354/354 replay); unknown never counted as smooth; DBT `FON` never smooth; rails never in pavé metres; DBT join reproduces Agent 3's box numbers; Worker bundle +≤ 0.5 MiB; DO CPU +≤ 5 %; Milan-only release copy test passes; no Rome file differs | `SIL_MODE=off` or redeploy previous overlay; additive fields are ignorable | 0 → X metres of mapped rails per benchmark route (X from Agent 4's corpus; Agent 4, `routing-experiments.md` §3.3: 799.5 of 1,311.9 km (61 %) of shown-route length lies outside the only area with railway ways, i.e. rails unknown; 450.6 km none in the covered area, 52.8 km next to a mapped tram way, 8.9 km tagged); contested/weak-dissent/unknown-by-evidence metres per corridor; every candidate carries a dataset version |
| **4.38** | verification workflow (local `tools/sil-review`, queue from the build report, imagery candidates, field round on the P1/P2 ways); moderated report → intake/aggregate/export; `mode: on` for the policy the owner picks; rails warning (wording, per-mode weight) after Agent 4; bicycle overlay; staleness triggers (ds925); Roccella ledger (OSM + field only) | field-verified records change views as designed; k ≥ 3 / consent tests; warning copy reviewed; regression benchmark vs 4.37 | mode `off`; per-record `rejected` | resolved contested ways; share of known surface with a date; fewer wrong "no pavé" claims on verified ways |
| **Later** | opt-in sensor aggregates (Agent 6), model-assisted imagery review after a labelled Milan sample, direction/turn relations, per-lane carriageways, calibrated confidence, Rome adapter only after an owner decision | calibration on held-out field samples | per feature flag | calibrated bands |

**What NOT to build:** automatic imagery ingestion or ML surface inference to fill unknown; D1 in the routing path; live telemetry or any GPS-trace storage; DBT/imagery facts written into OSM; mapping DBT `FON` or any `paved` to smooth; one merged "confidence/roughness" number;
inferring a material from neighbouring ways; treating a tram line as rough; treating a works feed as a value; commercial road-condition data; per-user personalisation; real-time rails alerts.

## 14. Risks
| Risk | Mitigation |
|---|---|
| Rails over-warning (Via Friuli shortcut carries 58.8 m shared track) | shadow first; per-mode weights decided with Agent 4; wording "mapped 2020, unverified" |
| DBT never updated (2020); tracks "in esercizio" vs ATM no line | presence kept, `service` separate; refresh trigger |
| Overlay drifts from tiles after a recompile | `baseTileSha8` guard, same-step build, fail-open |
| Shared-file merge conflicts with Rome | minimal edits to `spatial-road-store.ts`/scorer; release-copy test is an acceptance gate |
| Policy thresholds are guesses | versioned policy, P-A/P-B shown, calibration with field data in 4.38 |
| Contested/low bands misread as "unsafe" | band is internal; UI wording is a separate decision |
| Report privacy (existing `road_reports` stores 6-decimal start/end, note, nickname) | SIL ingests only snapped/coarse/enumerated rows; retention review of the raw table |
| Non-standard `surface_bike` semantics (could describe a cycle lane) | bicycle-only, informational for car; unverified |
| Box-only DBT result generalised to the city | explicit; 4.37 acceptance includes a citywide count |

## 15. Open decisions for the owner
1. **Contested policy**: P-A (flag), P-A+bikeWide (`surface_bike` read for every mode, Agent 4's La) or P-B (any applicable dissent → `probable_rough` 0.65) for the car view of the ring and the 370 `surface_bike` ways (19.0 km); or a hybrid (P-B only on high-exposure junctions).
2. Rails: warn? per mode (motorcycle/bicycle vs car), wording, and whether rails ever enter ranking; the Via Friuli trade-off.
3. Staleness thresholds (imagery 5 y, reports 90 d/1 y, tagged 5/10 y) and review cadence.
4. Legal review: merged ODbL/CC BY tile distribution; image-derived facts under CC BY-SA; contribution licence and consent text for reports; exact DBT licence version.
5. Who performs the 5-minute field checks (ring #2/#3 first) and the photo-contribution route (Panoramax/KartaView).
6. Retention/minimisation of the existing `road_reports` raw coordinates and the on-device CSV.
7. Re-extraction cadence and ownership; whether imagery near the destination end may be queried for the 285 m of untagged Via Fra Cristoforo ways (Agent 3 deliberately did not).
8. Whether `contested`/`weak dissent` ever appears in the UI.

## 16. To reconcile with the routing experiments (Agent 4) and the principal agent
- **Agent 4's data layers** (`routing-experiments.md` §3.2): **La** = `surface_bike=milanese_paving` on asphalt → probable rough 0.65 for all modes (370 ways, 19.0 km; own-layer +3.7 % avoided stone, 28 of 298 picks changed; "car use is an assumption", recommended behind a shadow flag). In SIL terms La = `surface_bike` applicable to every mode **and** a single derived dissent allowed to contest (P-B for that key); my default keeps it bicycle-only. Same data, different assumption: pick one explicitly (§15.1) and run it in `shadow`.
  **Lb** (ring #2/#3 as sett) never fires in the 298-case corpus (ring ways are on no corpus route), so the ring case is decided by data and generation, not by weights: consistent with SIL's "verify the ring" task. **Lc** (smoothness weights) is a hypothesis; SIL keeps `smoothness` as a separate roughness topic with no ranking consumer until a field trial exists.
- **Weighted stone on the ring** under the three policies: 25.0 / 45.2 / 53.7 m (§7.3). **Slice threshold (R2)**: the ring slice is 24.99 m today; under P-B the rough run on the ring grows to ≈ 69 m and would pass the 25 m penalised-search minimum (assuming probable metres count toward slices; I did not check the slice builder); the data fix and Agent 4's generation fix (minimum ≤ 20/15 m) are independent and should be evaluated separately.
- **Rails**: Agent 4 carries rails as a separate "unknown / mapped adjacent" attribute, never as stone (agrees with SIL). Their rail classes (tagged, mapped-adjacent, none-in-covered-area, unknown-outside-coverage) come from OSM tram ways inside the pilot box only; the SIL citywide DBT join would turn most of "unknown-outside-coverage" into DBT-mapped or DBT-absent (weak, DBT is not declared complete). Definitions of "covered" must be aligned before any shadow comparison.
- **Unknown stays unknown**: no experiment layer should fill the 17,160 unknown segments (275 km) from neighbours; SIL ignores `inferred`.
- Cited, not re-run: R1–R12 (Agent 1), D1–D16 (Agent 2), DBT/ATM/imagery facts (Agent 3). Mapping of defects to SIL: D12/D13/D2 → re-extraction + manifest; D4 → derived bicycle-only evidence; D6 → separate roughness topic (no consumer yet);
  D7/D1/D3 → rails topic + railway ways; D8/D14 → direction topic (provider graph evidence) and reserved `turn_restriction`; D9/D10 (compile filters) not addressed.

## 17. Reproduce and limits of this work
Run the six commands in §12 from the repository root (outputs overwrite `evidence/surface-intelligence-design/`; hashes in `checksums.sha256`; timings in `size-estimates.json` vary by run). Inputs read-only: `data/sources` archives, `data/surfaces/milan-tiles`, Agent 3's cached DBT box (`experiments/.../data/external/dbt-box-{19,39,45}-wgs.json`).
Limits: DBT join only inside Agent 3's 1.2 × 1.3 km box; physical rails, ring #2/#3 surface and the 285 m untagged stretch remain UNVERIFIED; the one photo reading is Agent 3's own; Cloudflare limits were read through a summarising fetch (4 requests logged); D1 latency, workerd timings and citywide SHP parsing were not measured.
