# Phase 4.36 — OSM and geospatial data audit (Agent 2)

Read-only investigation. Baseline `main` @ `3e31da9`. Today = 2026-11-14. Labels: **VERIFIED** (seen in a named file or response),
**STRONGLY SUPPORTED**, **PLAUSIBLE**, **UNVERIFIED**. Origin and destination streets are redacted ("origin street", "destination
street"); their way ids are withheld. Coordinates are rounded or omitted. No coordinate from the GPS trace was sent over the network
(request log: `evidence/osm-data-audit/request-log.jsonl`). CRLF note: text files in `data/` are CRLF in this checkout; I compared **parsed
data**, not byte checksums; all 19 `.osm.json.gz` archives were SHA-256-checked on their uncompressed bytes against their manifests (all match).

## 1. Headline findings

| # | Finding | Label |
|---|---|---|
| 1 | The "25 m confirmed pavé" is **one OSM way**: ring way **287070936**, `surface=sett`, 25.0 m, the first of three ring ways route 0 uses. The other two (**111768010**, 31.0 m; **111767966**, 13.1 m = 44.1 m) are tagged `surface=asphalt`. Roundabout traversal = 69.1 m = 25.0 + 31.0 + 13.1. | VERIFIED |
| 2 | Lastrico's number is a faithful readout of its data. App-reported 25 / 0 / 285 m, Lastrico's own scorer run offline on the committed tiles, and my independent computation from the raw extracts agree **to 0.0 m on every one of 69 ways** of route 0, and likewise for route 1. Matching, geometry, distance and compilation are **not** the cause here. | VERIFIED |
| 3 | The discrepancy is therefore a **data-vs-reality** question that OSM alone cannot settle: either the two asphalt-tagged ring ways are incomplete/incorrect, or the surface differs by lane/carriageway, or the driver generalised from the 25 m. OSM's history shows deliberate 2023 surveys (StreetComplete, `source=survey`) that split the ring into sett (25 m) and asphalt (rest); `surface_bike=milanese_paving` is on 7 of 12 ring ways (160.9 of 252.7 m) but is ignored by the compiler when `surface` exists. | VERIFIED (data) / UNVERIFIED (physical) |
| 4 | The 285 m of unknown surface on both routes is **0 % outside tiles, 0 % odd tag values: 100 % untagged ways** — five Via Fra Cristoforo ways (259.6 m) + one Alzaia Naviglio Pavese way (8.8 m) + the destination-end way (16.7 m). All unchanged in current OSM (2026-11-14). Both routes share them because both share the last ~85 % of the path. | VERIFIED |
| 5 | **Tram rails are structurally invisible to Lastrico.** The compiler keeps only ways with a `highway` tag, so `railway=tram` ways are dropped; the 8 citywide extracts contain **0** railway ways (Overpass `way["highway"]`); the 11 pilot extracts contain 661 tram ways (44.1 km) of which only 9.2 % of track length runs next to a highway way carrying a tram tag. Near Corso Lodi / Via Lazzaro Papi **current OSM has no `railway=tram` way within 30 m** (Overpass 2026-11-14), and `embeddedRailsMeters` is computed but read by no ranking or warning code. | VERIFIED |
| 6 | Corso Lodi **does** carry stone in OSM: the NW arm leaving Piazzale Lodi is ≈ 70–74 % `surface=sett` (480–499 m of ≈ 680 m) in either direction; Via Lazzaro Papi has 45.5 m of one-way sett (two ways). A 25 m outbound figure therefore means the outbound route did **not** run on that arm (STRONGLY SUPPORTED by arithmetic; the outbound geometry is unknown). | VERIFIED (OSM) / STRONGLY SUPPORTED (inference) |
| 7 | The return-trip junction origin street → Via Friuli is **legal and connected** in OSM, archived and current (details: `evidence/osm-data-audit/junction-via-friuli.md`). No restriction relation touches it. | VERIFIED |
| 8 | Structural gaps: **no turn-restriction relations at all in the citywide archive** (0 relations), no node tags (barriers, stops, signals, crossings) outside the 2026-10 pilot box, fabricated node `version: 1`, `junction=circular` ring ways lose their implied one-way (51 ways Milan-wide; ring way **713165261** has no `oneway` and is compiled two-way — a lead for the "questionable U-turn"). | VERIFIED / PLAUSIBLE (U-turn link) |

## 2. Archive provenance and freshness

| Source | Retrieved (UTC) | Age on 2026-11-14 | Content |
|---|---|---|---|
| `milan-pilot-{sw,se,nw,ne}` | 2026-10-26 00:44 | 19 d | OSM API `map.json`: all elements incl. relations, node tags, non-highway ways |
| `milan-pilot-{w-sw,w-nw,n-nw,n-ne,e-nw,s-sw,s-se}` | 2026-10-28 23:03 | 17 d | same; pilot box lon 9.169–9.206, lat 45.45–45.48 |
| `milan-citywide-*` (8 sectors) | 2026-11-04 11:40–11:54 | 10 d | Overpass `way["highway"](bbox);out meta;>;out skel qt;` then sanitised (`scripts/osm/expand-milan-citywide.mjs:177,88-110`): ways with tags, nodes with id/lat/lon only, **no relations, no node tags, no railway ways** |
| `milan-street-names` | 2026-11-12 15:39 | 2 d | named highways, names only (no surface) |
| Compiled tiles | `sourceGeneratedAt 2026-10-28T23:03Z` | 17 d | stamped on **every** segment, including those from the 2026-11-04 sectors (`compile-compact-tiles.mjs:374`, `lib/spatial-road-store.ts:300`) |

- **Segments inside the pilot source boxes come from the October snapshot, not November** (`compile-compact-tiles.mjs:331`). The ring and both junctions are outside the pilot box (lon > 9.206), so they come from the 2026-11-04 Overpass sector.
- **Freshness check against current OSM (Overpass named queries 2026-11-14T13:43Z and T13:49Z; osm_base shown in the cache files):** all **121** highway ways of Piazzale Lodi, its touching ways, all Corso Lodi and all Via Lazzaro Papi ways are identical to the archive in `version`, tags and node list (0 changed); the 4 junction ways at Via Friuli and the 6 Via Fra Cristoforo ways queried by id are also unchanged. **VERIFIED: staleness does not explain any field failure analysed here.**
- The surface tags in question are old enough to matter the other way: ring `surface=asphalt` was applied on 2019-02-20 (changeset 67401242, `AddRoadSurface`, `source=survey`) and re-set / differentiated on 2023-09-05 (changeset 140859948, `SurfaceOverlay`, 122 changes, `source=survey`); smoothness on 2023-09-06/07 (140880308, 140949023, `AddRoadSmoothness`). `source=survey` is the mapper's own declaration (UNVERIFIED as to quality).

## 3. Piazzale Lodi — the roundabout

### 3.1 Every ring way (12 ways, 252.7 m, anticlockwise one-way order starting at the route's entry)
`junction=circular`, `highway=primary`, `name=Piazzale Lodi`, `maxspeed=50`, `electrified=contact_line` + `trolley_wire=yes` (trolleybus overhead wire, not rails; routes 90/91/92 in the current relations) on 11 of 12 (not on 287070935). No `access`/`vehicle` tags. Full table: `evidence/osm-data-audit/piazzale-lodi-ring.csv` (+ `.json`).

| order | way id | length m | surface | smoothness | `surface_bike` | oneway | route 0 uses | compiled | version / last edit |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **287070936** | 25.0 | **sett** | bad | milanese_paving | yes | **25.0 m (390.0–415.0)** | confirmed_rough, w 1.0, 10 segs = 25.0 m | v17, 2025-11-07 |
| 2 | **111768010** | 31.0 | asphalt | excellent | milanese_paving | yes | **31.1 m (415–446)** | confirmed_smooth | v19, 2025-11-07 |
| 3 | **111767966** | 13.1 | asphalt | good | – | yes | **13.0 m (446–459)** | confirmed_smooth | v17, 2025-11-07 |
| 4 | 702135495 | 7.3 | asphalt | excellent | – | yes | – | smooth | v8 |
| 5 | 4858617 | 47.0 | asphalt | – | – | yes | – | smooth | v38, 2026-01-31 |
| 6 | 111767965 | 8.1 | asphalt | good | – | yes | – | smooth | v20 |
| 7 | 111767978 | 41.6 | asphalt | excellent | milanese_paving | yes | – | smooth | v19 |
| 8 | 111767984 | 21.1 | asphalt | – | milanese_paving | yes | – | smooth | v17 |
| 9 | 287070933 | 23.8 | asphalt | – | milanese_paving | yes | – | smooth | v15 |
| 10 | 713165251 | 8.2 | asphalt | – | milanese_paving | yes | – | smooth | v7 |
| 11 | 287070935 | 16.3 | asphalt | – | – | yes | – | smooth | v16 |
| 12 | **713165261** | 10.3 | asphalt | – | milanese_paving | **none** | – | smooth, **two-way (mdBits 0)** | v6, 2026-01-31 |

Approaches used by route 0: **289749136** Viale Umbria (64.2 m, asphalt, one-way, ends at the ring entry at 390.0 m) and **288900525** Viale Isonzo (207 m, asphalt). Other arms (Corso Lodi ways 161606045, 529556308, 290523325, 161606037, 290523327; Via Sannio 111768026, 265879312; Viale Umbria/Isonzo service ways carrying trolley wire) are listed in the CSV. Ring-adjacent cycle tracks (`highway=cycleway`, `name=Piazzale Lodi`: 37039790 asphalt, 401156731 and 529556307 `paving_stones`, 1156699180) are not car-usable and never matched.

### 3.2 Where the 25 m comes from, and the segment-by-segment diff (metres)
Route 0 = 242 vertices, 4,692.9 m (scorer metric). Rough section reported: 391–416 m, `Piazzale Lodi`, `sett`, 25 m confirmed.

| way | raw OSM length | route 0 metres, independent (nearest aligned car-usable way, 1 m steps) | route 0 metres, Lastrico scorer on compiled tiles | app reported | diff |
|---|---|---|---|---|---|
| 289749136 Viale Umbria | 64.2 | 64.2 | 64.2 | smooth | 0.0 |
| **287070936 ring #1 (sett)** | 25.0 | **25.0** | **25.0** | **confirmed 25 (section 391–416)** | **0.0** |
| 111768010 ring #2 (asphalt) | 31.0 | 31.1 | 31.1 | smooth | 0.0 |
| 111767966 ring #3 (asphalt) | 13.1 | 13.0 | 13.0 | smooth | 0.0 |
| 288900525 Viale Isonzo | 207.0 | 207.0 | 207.0 | smooth | 0.0 |
| **whole route 0** | – | rough 25.0 / smooth 4382.9 / unknown 285.0 / no-match 0 | pave 25 / smooth 4383 / unknown 285 / unpaved 0 | 25 / 0 / 285 | **0.0 on all 69 ways** |

Per-way table for the whole route: `evidence/osm-data-audit/route0-per-way.csv` (route 1: `route1-per-way.csv`). VERIFIED. Route 1: independent 0 / 4041 / 285, Lastrico 0 / 4041 / 285, app 0 / 285.

### 3.3 Cause classification for "setts across ≈ 69 m traversed, app says 25 m"
| Hypothesis | Verdict | Evidence |
|---|---|---|
| Incomplete OSM tagging | **PLAUSIBLE** | 44.1 m of the traversal is asphalt-tagged; ring ways carry `surface_bike=milanese_paving` (160.9 m of 252.7 m), incl. #2 (31 m). Lane-level or partial stone is representable only via that non-standard key, which the compiler ignores when `surface` is set (`normalize.mjs:60-63`; 370 Milan car ways / 19.0 km are in that situation). |
| Incorrect OSM tagging | **UNVERIFIED** | Two independent survey edits (2019, 2023) say asphalt for #2/#3; contrary evidence is only the driver's observation. |
| Different roundabout subsegments / carriageways | **VERIFIED as structure** | three ways, three different tag sets; one centreline per direction, no parallel carriageway. |
| Route-to-surface matching error | **REFUTED** | independent vs Lastrico diff 0.0 m on every way; all 28 route vertices over the traversal lie 0.0 m from the three ring ways (2.3–3.1 m spacing). |
| Geometry simplification | **REFUTED** | compiled ring segments equal raw nodes; compiled length = raw length for all 12 ring ways. |
| Incorrect distance measurement | **REFUTED (magnitude)** | 69.1 m scorer vs "≈ 69 m" plan. Minor inconsistency: the scorer measures with 110,540 m/° (`road-intelligence-scoring.ts:92-98`), the warning sections with haversine R = 6,371 km (`rough-sections.ts:33-39`): 390.03 vs 390.85 m at the ring entry (+0.22 %), which is why 390.0–415.0 is reported as 391–416. |
| Compilation defect | **REFUTED for these ways, and for the whole city** | `compile-fidelity.mjs`: re-running `collectMilanSegments()` yields 102,028 segments; committed tiles hold the same 102,028 unique segments; 0 missing, 0 extra, 0 differing category/flags/direction. |
| Stale data | **REFUTED** | no tag or node change since the archive; edits date from 2019/2023. |
| Different physical surface (driver right, OSM wrong/incomplete) | **UNVERIFIED** | needs street-level imagery or a survey of ring ways #2 and #3. |

### 3.4 The 285 m of unknown surface (both routes)
All 285 m are matched segments whose OSM way has **no `surface` tag** (`why = "no surface tag"`; 0 m "paved/other value", 0 m "no segment matched").

| way | name | highway | oneway | length m | route-0 along (m) | version (archive = current) |
|---|---|---|---|---|---|---|
| 137158656 | Via Fra Cristoforo | unclassified | yes | 29.4 | 3988–4018 | 8 |
| 1236292178 | Via Fra Cristoforo | unclassified | yes | 7.6 | 4018–4025 | 1 |
| 273258718 | Via Fra Cristoforo | unclassified | no | 21.5 | 4025–4047 | 2 |
| 273258717 | Via Fra Cristoforo | unclassified | no | 84.2 | 4047–4131 | 4 |
| 273258719 | Via Fra Cristoforo | unclassified | no | 116.9 | 4252–4369 | 3 |
| 1452931018 | Alzaia Naviglio Pavese | residential | yes | 8.8 | 4513–4522 | 1 |
| destination-end way | (redacted) | service | – | 16.7 | 4676–4693 | 1 |

(Route 1 along-values are 367 m smaller.) Neighbour 273258720 (Via Fra Cristoforo, 121.1 m) is tagged `asphalt`. Unknown ≠ smooth: Lastrico does not count it as smooth (`unknownMeters`), which is correct, but nothing in the app says *where* it is. This stretch is 6.1 % of the route and 100 % of the unknown on both routes.

## 4. Corso Lodi and Via Lazzaro Papi

### 4.1 What OSM says (archive = current OSM; 88 ways unchanged)
- **Corso Lodi**: 84 highway ways, 5,099.7 m of centreline (several carriageways counted separately), in two connected components. NW of Piazzale Lodi (43 ways, 2,012 m): one **two-way `secondary` carriageway** (`oneway=no`: sett 456.1 m, asphalt 159.7 m), one-way `secondary` pairs near the ring (outbound 161606045 + 529556308 + 290523325; inbound 161606037 + 290523327), parallel one-way `residential` side lanes (concrete:plates 499.5, asphalt, sett 73 m), cycle tracks. SE of the ring (41 ways, 3,088 m): dual one-way `primary` carriageways (headings ≈ 311° vs 129°): asphalt 1,865.9 m, **sett 683.1 m**, paving_stones 57.5 m, plus cycleways.
- **Car-legal path along the NW arm (ring → far NW end, one-way aware):** NW-bound 675.3 m, **sett 499.0 m (73.9 %)**; SE-bound 681.7 m, **sett 480.5 m (70.5 %)**. Ways and order: `evidence/osm-data-audit/corso-lodi-papi.json`.
- **Via Lazzaro Papi**: 4 ways, 273.9 m: **164940302** (sett, 20.5 m, one-way, v10), **164940303** (sett, `smoothness=bad`, `lanes=1`, one-way, 25.0 m, v12; history: `cobblestone` 2012 → `sett` 2023-09-05 cs 140859948, `bad` 2023-09-14), **164940304** (asphalt, 97.1 m, two-way, lanes 2), **264363555** (asphalt, 131.3 m, two-way). Compiled: the two sett ways `confirmed_rough`, the other two smooth.
- **Rails:** no `railway`, `tram`, `embedded_rails`, `lanes:tram` or similar tag on any Corso Lodi or Papi way (0 of 88). **No `railway=tram` way within 30 m of any of them and none within 80 m of Piazzale Lodi in current OSM** (Overpass 2026-11-14T13:49Z); the only railway ways returned are the M3 subway tunnel (layer −2), its sidings, and the RFI Cintura sud. In the archive, the nearest mapped tram way to a Corso Lodi way is 42.9 m away (the pilot box stops at lon 9.206; the citywide extracts contain no railway ways at all, so the archive cannot answer for the SE arm or Papi). `trolley_wire`/`electrified` on the ring and on Viale Umbria/Isonzo service ways are trolleybus wires.
- **Compiled data:** every one of the 88 ways is compiled; the embedded-rails flag is set on none (0 of 88). Whole-city flagged segments: 401 (6.7 km of 1,638 km).

### 4.2 Interpretation (do not equate a tram line with a rough road)
- **Surface (stone):** exists in OSM and in Lastrico on Corso Lodi and on 45.5 m of Papi. VERIFIED. If an outbound route had run on the NW arm, the app would have reported ≈ 480–500 m, not 25–30 m → the outbound route did not use that arm (STRONGLY SUPPORTED). The stone the driver felt "around" these streets could be on adjacent ways the route did use, or on the arm but with a different route than assumed: **UNVERIFIED without the outbound geometry**.
- **Rails:** not represented spatially anywhere near these streets (neither as `railway=tram` ways nor as tags on the carriageway). Whether rails physically exist is **UNVERIFIED** (OSM absence is not evidence of absence; the 2026-11-14 Overpass query only searched 30 m). Even where tram ways exist (pilot box), 90.8 % of the mapped track (`tram-coverage.json`) has no tram tag on the adjacent highway way, so even there Lastrico mostly cannot see it. Rails are never scored: `embeddedRailsMeters` (`road-intelligence-scoring.ts:763-765`) has no reader (grep of `lib/ app/ components/ worker/`), and `smoothness` is read by no scoring or ranking code either (grep). The only tram term in user-facing code is the feedback category "Rotaie tram sporgenti" (`components/phase43/LocalFieldFeedback.tsx:163`).
- **Which carriageway:** on the NW arm the two-way carriageway is the same physical road in both directions; near the ring the direction fixes the one-way way; SE of the ring each direction has its own carriageway. The scorer already selects by travel direction (`road-intelligence-scoring.ts:598-608`, forward-cosine ≥ 0.70 on one-way ways). VERIFIED mechanism, no field check.
- **Evidence needed to say a stretch is uncomfortable:** the outbound route polyline (or screenshot with metres) and the time-stamped moments of discomfort; street-level imagery per way (Mapillary/KartaView) for surface and rail type (embedded flush, protruding, segregated); ATM network data for rail alignment per street; phone-IMU roughness at known speed and lane position (field trial; the `experiments/roughness-sensors` verdict is NO-GO for the app, usable for a controlled trial); driver vehicle type and speed; works notices from the Comune (stone is being replaced in the centre per `outputs/phase424-data-quality/public-datasets.md`).

## 5. Junction origin street → Via Friuli (summary; full file: `evidence/osm-data-audit/junction-via-friuli.md`)
Node J is 65.4 m along route 0 and a vertex of route 0. Four ways meet: origin street one-way inbound (heading 111°) and outbound (113°), **Via Friuli 264363540** inbound (v6, one-way, 210.6°) and **264363537** outbound (v6, one-way, 209.1°, 28.7 m, `lanes=2`, asphalt). Signed turn +97.8° = right turn onto the **start** of 264363537, i.e. the permitted direction. No `access`/`motor_vehicle`/`vehicle`/`barrier`/`traffic_calming`/conditional tags; no restriction relation touches J (current OSM: only relation 3123413 in the Via Friuli neighbourhood, unrelated). Current tagged nodes within 100 m: crossings, two `highway=stop`, kerbs — none obstructs cars (absent from the archive because node tags were dropped). Compiled: both Via Friuli ways car-allowed, forward, smooth. **Legal and connected, VERIFIED.**

## 6. Segment-level data-quality table (ways established by the two field cases)
Verdicts: **FAITHFUL** = Lastrico equals OSM and nothing contradicts OSM; **CONTESTED** = Lastrico equals OSM, driver observation contradicts it (UNVERIFIED which is right); **GAP** = no data; **DEFECT** = data-model error.

| way id | name | highway | surface | smoothness | tram/rails | oneway / access | m | compiled | provenance | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 289749136 | Viale Umbria | primary | asphalt | – | none | yes / – | 64.2 | smooth | v14 | FAITHFUL |
| 287070936 | Piazzale Lodi | primary (circular) | sett | bad | wire only | yes / – | 25.0 | rough 1.0 | v17; sett 2023-09-05 cs 140859948 survey | FAITHFUL; the only stone on the traversal |
| 111768010 | Piazzale Lodi | primary (circular) | asphalt | excellent | wire only | yes / – | 31.0 | smooth | asphalt 2023-09-05 same changeset; `surface_bike=milanese_paving` since 2013 | **CONTESTED** |
| 111767966 | Piazzale Lodi | primary (circular) | asphalt | good | wire only | yes / – | 13.1 | smooth | asphalt 2019-02-20 cs 67401242 survey | **CONTESTED** |
| 713165261 | Piazzale Lodi | primary (circular) | asphalt | – | wire only | **none** / – | 10.3 | smooth, two-way | `roundabout`→`circular` 2022-03-01 cs 117969748 dropped the implied one-way | **DEFECT** (not on route 0) |
| 288900525 | Viale Isonzo | primary | asphalt | – | none | yes / – | 207.0 | smooth | v10 | FAITHFUL |
| 137158656, 1236292178, 273258718, 273258717, 273258719 | Via Fra Cristoforo | unclassified | **none** | – | none | yes/no / – | 259.6 | unknown | v8, v1, v2, v4, v3 | GAP |
| 1452931018 | Alzaia Naviglio Pavese | residential | **none** | – | none | yes / – | 8.8 | unknown | v1 | GAP |
| destination-end way | (redacted) | service | **none** | – | none | – | 16.7 | unknown | v1 | GAP |
| 264363540 / 264363537 | Via Friuli | residential | asphalt | – | none | yes / – | 181 / 28.7 | smooth, forward | v6 / v6 | FAITHFUL; legal turn from origin street |
| 164940302 | Via Lazzaro Papi | residential | sett | – | none | yes / – | 20.5 | rough | v10 | FAITHFUL (rails UNVERIFIED) |
| 164940303 | Via Lazzaro Papi | residential | sett | bad | none | yes / – | 25.0 | rough | v12 | FAITHFUL (rails UNVERIFIED) |
| 164940304, 264363555 | Via Lazzaro Papi | residential | asphalt | – | none | no / – | 97.1, 131.3 | smooth | v8, v5 | FAITHFUL |
| Corso Lodi NW arm, 18 ways (161606045 … 1184663891) | Corso Lodi | secondary | sett 70–74 % / asphalt | some `bad`/`intermediate` | none within 30 m | mostly no (two-way) / – | ≈ 680 | rough/smooth per way | various; unchanged since archive | FAITHFUL for stone; rails **GAP/UNVERIFIED** |
| Corso Lodi SE, primary pairs | Corso Lodi | primary | asphalt 1,866 m, sett 683 m, paving_stones 57.5 m | partly | none | yes / – | 2,606 | per way | various | FAITHFUL for stone; rails GAP |

## 7. Pipeline and matching defects (file:line)

| # | Defect | Where | Effect | Label |
|---|---|---|---|---|
| D1 | Citywide query `way["highway"]…;>;out skel qt;` returns no relations, no non-highway ways | `scripts/osm/expand-milan-citywide.mjs:177,252` | no `type=restriction`, no `railway=tram` ways, no tram stops outside the pilot box | VERIFIED |
| D2 | Sanitiser keeps only id/lat/lon/version/timestamp per node and defaults `version ?? 1` | `expand-milan-citywide.mjs:88-110` (95) | **0 tagged nodes** in the citywide extracts vs 28,443 in the pilot; 153,563 nodes carry fabricated `version:1` and no timestamp (J is v5 in current OSM) | VERIFIED |
| D3 | Only `node`/`way` elements are read; ways filtered on `typeof tags.highway === "string"` | `scripts/osm/build-representative-network.mjs:30-35` | relations (1,628 unique, 220 restrictions in the pilot) and 661 tram ways are never compiled | VERIFIED |
| D4 | `surface_bike` (and `cycleway:/footway:surface`) is read only when `surface` is empty | `scripts/osm/normalize.mjs:60-66` | stone evidence for bicycles on asphalt-tagged car roads is discarded: 370 ways, 19.0 km (incl. the Piazzale Lodi ring) | VERIFIED |
| D5 | Asphalt/concrete with `smoothness` bad or worse → category `unknown`, weight 0 | `normalize.mjs:106-113` | known-bad asphalt gets no penalty and no smooth credit (only 8 ways / 243 m in Milan, so small) | VERIFIED |
| D6 | `smoothness` never influences scoring or warnings | grep `lib/road-intelligence-scoring.ts`, `lib/rough-sections.ts`, `app/api/routes/route.ts` | `smoothness=bad` on sett 287070936 is inert | VERIFIED |
| D7 | `embeddedRails` derived only from tags on a highway way; counter computed, no consumer | `normalize.mjs:276-288`; `road-intelligence-scoring.ts:763-765,803`; `spatial-road-store.ts:293` | 401 flagged segments (6.7 km) for 44 km of mapped tram; never scored or warned | VERIFIED |
| D8 | `junction=circular` does not imply one-way (only `roundabout` does) | `normalize.mjs:173` | 51 circular ways (994 m) without `oneway` compiled two-way, incl. ring way 713165261 | VERIFIED |
| D9 | Any `*:conditional` access tag → car access false; the expansion ring then drops the segment | `normalize.mjs:182`; `compile-compact-tiles.mjs:337-340` | real roads with time windows leave the surface index (e.g. a 37 m tertiary piece of Viale Bligny) | VERIFIED |
| D10 | Expansion ring drops unnamed `service` ways and footway/path/track with unknown surface | `compile-compact-tiles.mjs:341-344` | 4,203 unnamed service ways (230 km) and 481 other car-usable ways (≈ 36.5 km; the examples inspected are `access=private/no` or conditional) have no segment → "no match" | VERIFIED |
| D11 | Pilot-box precedence: October segments override November ones | `compile-compact-tiles.mjs:331` | 9-day-older data inside the pilot box | VERIFIED |
| D12 | `ingestedAt`/`sourceGeneratedAt` = pilot manifest time for all segments; no OSM version/timestamp survives in tiles; `observedAt` always null | `compile-compact-tiles.mjs:374,417`; `spatial-road-store.ts:294-301` | cannot tell the age of a tag at runtime; manifest says `datasetVersion …2026-11-04` but `generatedAt 2026-10-28` | VERIFIED |
| D13 | `extractRelevantTags` keeps only access/direction/layer tags (+ smoothness, foot) | `compile-compact-tiles.mjs:58-75` | raw `surface`, `surface_bike`, `railway`, `tram`, `trolley_wire` are not recoverable from the runtime tiles | VERIFIED |
| D14 | Turn restrictions and conditional access "stay with the provider"; the scorer only checks one-way/access *along* a returned polyline | `road-intelligence-scoring.ts:49-50,456-490`; provider `valhalla1.openstreetmap.de` (`lib/routing-providers.ts:79`) with OSRM fallback | restrictions are consumed by the provider's own OSM extract; Lastrico cannot verify a maneuver | VERIFIED |
| D15 | Rough warning only for sections ≥ 15 m, merging gaps ≤ 25 m; sections measured in haversine metres | `lib/rough-sections.ts:30-31,86-88,33-39` | a rough stretch under 15 m never produces a warning; 0.2–0.6 % metric mismatch vs the scorer | VERIFIED |
| D16 | Road features (signals, stops, give-way) cover only the 11 pilot boxes | `scripts/osm/extract-road-features.mjs:1-12` (header), `data/features/milan-road-features.json` | already documented; Piazzale Lodi and the Via Friuli junction are outside | VERIFIED |

**Not defects (checked):** matching tolerance 12 m (`app/api/routes/route.ts:85`) with 12 m sampling, heading gate |cos| ≥ 0.58 two-way / ≥ 0.70 one-way, nearest-wins, 2 m on-route fallback (`scoring.ts:362,577-669`) behaves correctly on the checked corridors (0 m diff); 29 ambiguous samples on route 0 sit at way joins. `compile-fidelity.mjs`: only 3 raw ways differ in length from their pipeline segments by > 1 m (sum 349.9 m).

## 8. Restrictions, relations, node tags — who consumes what
- Citywide archive: **0 relations** → no turn restrictions, no route relations, no `restriction:conditional`. VERIFIED. Pilot archive: 2,281 relation records (1,628 unique; 220 restrictions) are present but **unused by any Lastrico code**.
- Lastrico does not read `type=restriction`; **the routing provider does** (Valhalla FOSSGIS or OSRM public) from its own OSM extract, whose date is unknown to Lastrico (UNVERIFIED; Agent 1 should capture it from a response header or status endpoint).
- Node-level facts (stops, signals, barriers, `railway=tram_crossing`) exist only inside the pilot box (`road-features` documents this).

## 9. Missing observations / needs external verification
1. Physical surface of Piazzale Lodi ring ways **111768010** and **111767966** (and 287070936's exact extent, lanes): imagery or survey. (External-data agent: Mapillary/KartaView coverage dates.)
2. Presence, type and alignment of tram rails near Corso Lodi and Via Lazzaro Papi (ATM network map, imagery); whether OSM lacks them.
3. Surface of Via Fra Cristoforo (5 ways, 259.6 m), Alzaia Naviglio Pavese way 1452931018, and the destination-end way.
4. Outbound route geometry (polyline or screenshot with distances) and the time of each discomfort; origin and destination of the outbound leg.
5. Provider-side: its OSM extract date, whether ring way **713165261** is two-way in its graph (possible origin of the "U-turn" instruction), and whether the origin-street → Via Friuli turn exists.
6. Municipal works affecting stone (Corso Lodi, Piazzale Lodi): Comune di Milano works feed, as a review flag only.

## 10. To reconcile with Agent 1 (routing forensics)
- At J the right turn is legal/connected in OSM; absence of a Via Friuli candidate cannot be blamed on Lastrico's data (compiled data agree). Remaining suspects are provider-side.
- The 25 m / 285 m numbers and the 391–416 section are exactly reproducible from data; route-choice differences must come from candidates/ranking, not from surface matching.
- Ring way 713165261 (10.3 m, directly before the ring entry node of way 287070936) has no one-way rule since 2022-03-01: PLAUSIBLE contributor to an odd U-turn maneuver if the provider reads it as two-way. UNVERIFIED.
- Warning logic: sections shorter than 15 m are suppressed; the progress metric differs between scorer and sections by ≈ 0.2 % (1 m at 459 m).

## 11. Reproduce (repo root; Node 26; Node built-ins only; set `TRACE` to the local trace path)
```
node experiments/phase436-surface-intelligence/scripts/junction-via-friuli.mjs "$TRACE"              # junction audit
node experiments/phase436-surface-intelligence/scripts/route-surface-diff.mjs "$TRACE" --route=0     # A/B/C diff + unknown runs (also --route=1)
node experiments/phase436-surface-intelligence/scripts/piazzale-lodi-ring.mjs "$TRACE"               # ring table
node experiments/phase436-surface-intelligence/scripts/corso-lodi-papi.mjs                           # Corso Lodi / Papi, directed corridor, tram evidence
node experiments/phase436-surface-intelligence/scripts/tram-coverage.mjs --out=outputs/phase436-surface-intelligence/evidence/osm-data-audit/tram-coverage.json
node experiments/phase436-surface-intelligence/scripts/archive-stats.mjs --out=outputs/phase436-surface-intelligence/evidence/osm-data-audit/archive-stats.json
node experiments/phase436-surface-intelligence/scripts/compile-fidelity.mjs --out=outputs/phase436-surface-intelligence/evidence/osm-data-audit/compile-fidelity.json
# network (named-feature queries; logged; budget 15 API + 5 Overpass, used 10 + 5 incl. 3 failed attempts)
node experiments/phase436-surface-intelligence/scripts/osm-fetch.mjs overpass q1-via-friuli experiments/phase436-surface-intelligence/scripts/queries/q1-via-friuli.overpassql
node experiments/phase436-surface-intelligence/scripts/osm-fetch.mjs overpass q2-piazzale-lodi-corso-lodi-papi experiments/phase436-surface-intelligence/scripts/queries/q2-piazzale-lodi-corso-lodi-papi.overpassql
node experiments/phase436-surface-intelligence/scripts/osm-fetch.mjs api way/287070936/history.json    # also 111768010, 111767966, 4858617, 164940303, 713165261; changeset/140859948 | 140949023 | 67401242; ways.json?ways=<6 Via Fra Cristoforo ids>
```
Scripts: `experiments/phase436-surface-intelligence/scripts/` (`osm-archive.mjs` shared loader). Evidence: `outputs/phase436-surface-intelligence/evidence/osm-data-audit/` (`request-log.jsonl`, `route{0,1}-per-way.csv`, `route{0,1}-summary.json`, `piazzale-lodi-ring.{csv,json}`, `corso-lodi-papi.{csv,json}`, `junction-via-friuli.{md,json}`, `tram-coverage.json`, `archive-stats.json`, `compile-fidelity.json`). Cached current-OSM responses: `experiments/phase436-surface-intelligence/data/osm-current/` (git-ignored, not committed).
Overpass attempts: 2026-11-14T13:44:04Z 502 (overpass-api.de) and 403 (maps.mail.ru); T13:49:21Z 502 (a first Q2 variant, merged afterwards); the two successful queries are `q1` and `q2`.
