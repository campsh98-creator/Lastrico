# Road Intelligence Dashboard (internal developer tool)

A local, offline, developer-only map of what Lastrico knows about road surfaces in Milan and Roccella Ionica.
It shows coverage, the five surface categories, data provenance and the areas where a field survey would
reduce routing uncertainty the most. It exports the per-area summary and the survey-priority list as CSV/JSON.

It is **not** part of the consumer app, the Worker bundle, `public/` or production routing, and it is never
deployed. It loads no external tiles, fonts, CDNs or telemetry. Prototype: Phase 4.20 (`experiments/road-dashboard/`,
now a pointer). Maintained tool since Phase 4.21.

Data © OpenStreetMap contributors, ODbL-1.0.

> **"Confirmed" means an explicit OSM `surface` tag** in Lastrico's production dataset. It is **not** a field
> survey: tag accuracy and freshness are not independently checked. The dashboard says this next to the totals,
> in the legend, in every category definition and in the exports.

## Commands (run from the repository root)

```sh
node tools/road-dashboard/build.mjs                 # build tools/road-dashboard/dist/ (~2.5–3.5 s)
node tools/road-dashboard/serve.mjs                 # http://127.0.0.1:8810/  (Ctrl+C to stop; PORT=0 for a random port)
node --test tools/road-dashboard/test/              # the tool's full suite (36 tests)
node --test tests/road-dashboard.test.mjs           # the focused check that runs inside `npm test`
node tools/road-dashboard/measure.mjs               # rebuild ×3, run the suite, headless Chrome check,
                                                    # screenshots → results.json and screenshots/
node tools/road-dashboard/measure.mjs --no-browser  # same, without the headless check
```

Node 24 and nothing else: no `npm install`, no dependency. The tool imports only `node:` built-ins and its own
files (a main-suite test enforces it). The headless check uses the Google Chrome already installed on the machine
(`CHROME_PATH` overrides it) through the DevTools protocol and Node's built-in `WebSocket`. It serves the dashboard
on `127.0.0.1:8810` (`DASHBOARD_PORT` overrides) and gives Chrome a DevTools port in 9800–9899 (`CDP_PORT`
overrides, but must stay in that range).

Build options: `--out <dir>` (must be inside `tools/road-dashboard/`), `--no-predictions` (leaves out the
experimental layer; verified files and exports stay byte-identical), `--json` (machine-readable summary on stdout),
`--top N` (hotspots per area, default 25).

## The five categories

The partition uses the production categories exactly (`scripts/osm/config.mjs` `SURFACE_CATEGORY_MAP`, `K_ENUM`
order for decoding). The dashboard shows them in this order:

| Dashboard label | Production category | Evidence | OSM surface (normalised) |
|---|---|---|---|
| Liscio confermato (tag OSM) | `confirmed_smooth` | explicit OSM tag | asphalt, concrete (`paved` is NOT here) |
| Pavé confermato (tag OSM) | `confirmed_rough` | explicit OSM tag | sett, cobblestone, unhewn_cobblestone (raw: sett, cobblestone:flattened*, milanese_paving*, pebblestone…) |
| Pavé probabile (paving_stones) | `probable_rough` | weak tag evidence, never called confirmed | paving_stones (roughness weight 0.65, confidence 0.65) |
| Sterrato / sciolto (tag OSM) | `unpaved_loose` | explicit OSM tag | unpaved, compacted, gravel, fine_gravel, ground, dirt, earth |
| Sconosciuto | `unknown` | none | missing, generic `paved`, `other`, unsupported values. Never assumed smooth. |

"Known" covers the first four, as `matchedCoveragePercent` does in `scoreRoadIntelligence()`. Every segment
falls in exactly one category, so the five always sum to the total (tested per area, cell, class, source, tile
and mode). A material audit compares each stored category with the production mapping: 0 inconsistencies.

### Totals (datasets osm-milan-citywide-2026-11-04 and osm-api-roccella-2026-10-29)

| Area | Network | Smooth (tag) | Pavé (tag) | Probable pavé | Unpaved (tag) | Unknown | Known |
|---|---:|---:|---:|---:|---:|---:|---:|
| Milan | 1,644.7 km | 1,169.3 km | 70.7 km | 68.1 km | 60.9 km | 275.8 km | 83.2% (main network 90.3%) |
| Roccella Ionica | 176.5 km | 30.9 km | 0.0 km | 0.4 km | 8.2 km | 137.1 km | 22.4% (main network 28.7%) |

## Geographic coverage

The "Copertura geografica" panel and the map layers "Tile 0,01°" and "Celle 250 m" (both off by default) show:

- **Milan:** 117 production runtime tiles (0.01°), all 117 identical to the compact dataset and all with road
  length; 1,233 cells of 250 m. 61 tiles are at least 90% known, 4 are below 50%.
- **Roccella:** 40 runtime tiles, of which 31 have their own road length. The other 9 (the northern row at
  38.35° and one tile at 16.44° E) only hold segments touching their edge (less than 1 m of their own length).
  324 cells. No tile reaches 90% known; 28 of 31 are below 50%.

### Coverage caveats shown in the dashboard

Caveats are computed from the data and shown as warning boxes at the top of the area panel and in the coverage
panel. They are also part of `exports/area-summary.json`.

- **Milan outer ring looks better covered than it is.** Outside the central pilot the production compiler
  dropped unknown footways, paths, steps and tracks without cycling infrastructure, unnamed service roads and
  segments no Lastrico mode can use. The raw known share is therefore 87.1% in the citywide ring against 74.1% in
  the pilot. On the main network alone, which the filter did not touch, the comparison reverses: pilot 96.1%,
  ring 89.5%. The dashboard prints both comparisons.
- **Roccella has low coverage** (22.4%). Its unknown length stays unknown and must not be read as smooth.
- **Runtime tiles without their own length** (Roccella), as above.
- **What length measures:** OSM centreline length, not lane-km. Separate carriageways count separately and mapped
  sidewalks are included. Coverage is a share of length, not of traffic.

## Where more surface verification would help most

Each area lists its top 25 cells of 250 m ranked by an explainable uncertainty score H. H is a survey priority,
**not** a pavé prediction, and it never uses the Phase 4.17 model.

```
H(c) = U(c) × (1 + A(c)) + 0.5 × Q(c)
U = Σ unknown length × w(class)          over segments usable by at least one Lastrico mode
Q = Σ probable-pavé length × w(class)    (weak evidence, counts half)
A = min(1, R3 / 300 m), R3 = confirmed-pavé metres in c and its 8 neighbours
```

**The class weights and the parameters (300 m, 0.5, 3×3) are chosen by hand** as a proxy for how likely a
through route is to use a class. They are not validated against real route usage, and the ranking can change if
they change. The dashboard states this in the "Metodo e pesi scelti a mano" block, the hotspot export and
`exports/LEGGIMI.txt`.

| Class | w |
|---|---|
| motorway, trunk, primary | 1.0 |
| secondary | 0.9 |
| tertiary | 0.8 |
| unclassified, cycleway | 0.6 |
| residential | 0.5 |
| living_street | 0.4 |
| pedestrian, unknown | 0.3 |
| service, track | 0.2 |
| footway, path | 0.1 |
| steps | 0 |

H does not decrease when U, Q, R3 or w grow. Confirmed smooth or unpaved length never raises it, and a survey
that turns unknown length into known evidence lowers it. Hand-made fixtures test these properties. Each hotspot
lists its components, its share of the area total, the main unknown streets and Italian "why" sentences.

## Research summaries and exports

The "Sintesi ed esportazioni" panel shows plain-language findings per area, generated at build time from the
numbers above. The build also writes these offline exports (both areas, OSM-tag evidence only):

| File | Contents |
|---|---|
| `dist/exports/area-summary.csv` / `.json` | Metres per category and known share by scope: `area`, `main_network`, `source`, `source_main_network`, `mode`, `highway_class`, `tile`. The JSON adds coverage, caveats and the findings. Rows of one scope sum to the area total. |
| `dist/exports/hotspots.csv` / `.json` | The 25 survey priorities per area with centre, bounds, H, U, Q, A, R3, cell totals per category, unknown streets and reasons. The JSON adds the method and the weights. |
| `dist/exports/LEGGIMI.txt` | Column meanings, method, licence and attribution. |

CSV is RFC 4180, UTF-8, comma-separated, CRLF line ends. Text cells starting with `=`, `+`, `-` or `@` get a
leading apostrophe so that street names can never run as spreadsheet formulas. Total exports: about 140 KB.

## Provenance and checksums

The build recomputes and compares every checksum declared in `data/sources/*.source.json` and the surface
manifests (57 checks, all matching), checks that every runtime tile in `data/surfaces/<area>-tiles/` equals the
compact dataset, and traces every Milan segment to the archive it came from (pilot, representative network or
citywide Overpass expansion). Mismatches are reported, never repaired. The area panel shows a one-line summary
("57/57 checksum dichiarati corrispondono…"), and the "Provenienza e checksum" panel shows every archive, check and
reconciliation. The footer shows the build fingerprint.

## Experimental predictions (Phase 4.17): separate, off by default, unverified

`dist/data/experimental-predictions.json` has `status: "experimental_unverified"`. The UI loads it only when the
user turns on the layer "Previsione sperimentale — non verificata" (dotted violet with a white casing, a hatched
banner and a dashed panel). It is off by default. Predictions:

- are never added to the confirmed/probable/unknown totals, the hotspot score or the exports;
- are drawn only on segments whose surface is unknown (0 known segments touched);
- are bounded by the unknown length (Milan 258.0 of 275.8 km unknown, Roccella 136.9 of 137.1 km), with maximum
  probabilities of 0.34 (Milan) and 0.03 (Roccella), confirming the Phase 4.17 NO-GO.

Tests check that `verified.json` and every export are byte-identical with and without predictions, that no key in
a verified structure or export is prediction-derived, and that the headless KPIs do not change when the layer is on.

## It cannot become public

- It lives in `tools/road-dashboard/`, not under `app/`, `public/`, `components/`, `lib/`, `worker/` or any route.
- Nothing in `app/`, `lib/`, `components/`, `worker/` or `public/` references it (tested in `npm test` by
  `tests/road-dashboard.test.mjs`, and by `tests/experiments-isolation.test.mjs`).
- `serve.mjs` binds to 127.0.0.1 only and serves only `dist/`, with a strict CSP.
- `dist/` and the test folders are ignored by `tools/road-dashboard/.gitignore`. The generated output is about
  1.6 MB and never needs committing. What is committed: sources, this README, `results.json`, three screenshots
  (about 1.2 MB) and the Phase 4.20 evidence.

## Tests

`node --test tools/road-dashboard/test/` runs 36 tests:

- **Partition and the five categories:** categories equal the total across area, cells, classes, sources, tiles
  and modes; labels are distinct; confirmed labels say "tag OSM"; probable pavé is never called confirmed.
- **Reconciliation:** totals match an independent recomputation from the compact files (within 0.1 m) and the
  manifests (within 1 m per category).
- **Coverage:** Milan keeps its 117 production tiles; every Roccella runtime tile is accounted for; the outer-ring
  and low-coverage caveats appear with their computed numbers.
- **Exports:** files exist and are in the manifest; CSV equals JSON; every scope partitions the area total;
  formula-like text is neutralised; no URL; small.
- **Predictions never counted:** verified files and exports byte-identical with and without predictions; no
  prediction-derived keys; layer off by default and labelled unverified.
- **Determinism:** two builds produce byte-identical output.
- **Hotspots:** monotone on fixtures; ordered and explained; method and hand-chosen weights stated.
- **HTML safety and CSP:** no external URL; strict policy; no inline script, style or handler.
- **Server:** loopback only; rejects traversal and non-GET methods; CSP headers; CSV served as a download.
- **Checksums and consistency guards.**

`tests/road-dashboard.test.mjs` (8 tests, about 5 s, no app build) runs inside `npm test`. It builds the dashboard
with and without predictions into a temporary folder in the tool and checks isolation, dependencies, Git ignore,
the 117 Milan tiles, the five-category partition, the exports and the prediction separation.

Test outputs go to `tools/road-dashboard/.test-*/` and are removed afterwards.

## Known issue: V8 Maglev miscompilation (Node 24.18.0, V8 13.6.233.17-node.50)

The determinism test found a real engine defect in Phase 4.20. When `build()` ran twice in the same process, the
Maglev-compiled `buildExperimentalLayer()` returned floating-point accumulators from the previous call.

- It reproduces with Maglev on, and not with `--no-maglev` or `--jitless`.
- `lib/jit-guard.mjs` disables Maglev at runtime and must stay the first import of `build.mjs` (tested).
- The build re-checks the affected values and aborts on any mismatch.

## Layout

```
build.mjs  serve.mjs  measure.mjs  results.json  README.md  .gitignore
lib/          geo, classify, aggregate, coverage, exports, hotspots, predictions, encode, sources, jit-guard
web/          index.html, app.js, style.css  (copied into dist/)
test/         index.js (entry), unit/build/serve tests
screenshots/  milan-overview.png, milan-experimental-on.png, roccella-coverage-hotspots.png (from measure.mjs)
evidence/phase420/  results.json and screenshot of the Phase 4.20 prototype, unchanged
dist/         build output (reproducible, ignored by Git)
```

## Limitations

- "Confirmed" means an OSM tag. The dashboard does not establish tag correctness, freshness or ride quality.
- Milan outer-ring coverage is biased upward by the compile filter (see caveats); compare sources on the main
  network only.
- Lengths are OSM centreline length, not lane-km. Mapped sidewalks are included.
- Hotspot class weights and parameters are hand-chosen and not validated against real route usage.
- Survey priorities are 250 m cells, not street-level work orders; check the listed streets on site.
- The colours are validated for colour-vision deficiency only with secondary encoding (dash and width patterns, a
  legend and tables). Light theme only. Desktop layout; not tuned for phones.
- Data refresh: rerun `measure.mjs` and review the hotspots (about half a day to a day per refresh).
