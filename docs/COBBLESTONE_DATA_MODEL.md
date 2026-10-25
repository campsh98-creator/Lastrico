# Road-surface data model

## Current dataset

`data/milan-pave-central.json` is a local OpenStreetMap geometry extract used as a resilient
fallback when Overpass is unavailable. The filename describes the current snapshot, not the
long-term product identity.

Baseline on July 30, 2026:

- 1,530 ways with unique IDs;
- 6,948 coordinates;
- no geometry with fewer than two points;
- 942 `sett`;
- 521 `paving_stones`;
- 52 `cobblestone`;
- 15 `unhewn_cobblestone`;
- approximately 71.07 km of geometry;
- 210 unnamed ways;
- no duplicate ID, exact segment, or exact geometry;
- no invalid coordinate outside the current dataset checks.

Each record currently contains `id`, `name`, `surface`, and `coordinates`. The ID is the OSM
way ID. Missing names are normalised to an unnamed-road label.

Six geometries close a loop. OSM way `313266346` repeats an internal coordinate without
closing, and way `4011978` contains a jump of about 331 metres. These require source
verification and are not corrected automatically.

## Proposed classification

| State | Meaning | Routing use |
| --- | --- | --- |
| `confirmed_rough` | explicit `sett`, `cobblestone`, or `unhewn_cobblestone` evidence | full configured weight |
| `probable_rough` | `paving_stones` or another heterogeneous surface | weighted exposure |
| `confirmed_smooth` | a verified source identifies a smooth surface | no rough-surface weight |
| `unknown` | missing or uninterpretable evidence | no invented weight; lower coverage |

`unknown` must never be automatically converted to rough, smooth, asphalt, or safe.

## Confidence

Confidence is separate from the class:

- `high`: valid geometry and an explicitly verified classification;
- `medium`: explicit OSM classification that may still vary in practice;
- `low`: an unverified community report or estimate;
- `unknown`: no available evidence.

The current local dataset does not contain extraction time, schema version, or a per-way
verification date. Until a traceable regeneration exists, `sett`, `cobblestone`, and
`unhewn_cobblestone` are medium-confidence confirmed evidence; `paving_stones` is probable
evidence at medium confidence. No update dates are invented.

The implemented numeric `classificationConfidence` is the distance-weighted category weight
among matched rough segments (`1` for explicit cobblestone classes, `0.65` for
`paving_stones`). It describes the classification used by the ranking model, not the
probability that the route is correctly mapped, current, smooth, or safe. The existing
`confidence` score and API `surfaceConfidence` remain compatibility aliases for this value.
`dataConfidence` is `null`: the available verification and freshness metadata do not support
a numeric reliability estimate. A category weight of `1` must not be displayed as 100%
route-data reliability.

## Implemented matching and uncertainty

The scorer samples route geometry in pieces no longer than approximately 12 metres. For
each midpoint it chooses the nearest aligned supported surface segment within the existing
mode-specific tolerance (car: 12 m, motorcycle: 11 m, bicycle: 9 m). Equal-distance matches
use the larger category weight. Each sample contributes at most once, including when source
geometries overlap. This prevents a rougher parallel road from overriding a directly matched
road merely because its category has a higher weight.

The alignment threshold remains an absolute direction cosine of `0.58`. Geometry alone
cannot distinguish an isolated nearby parallel road within the tolerance, or establish legal
access to that road. Tightening tolerances without ground-truth comparison could instead
drop valid matches; road identity and topology matching remain separate work.

`unknownMeters` is the rounded route-geometry length minus estimated matched rough metres.
`matchedCoveragePercent` reports the matched fraction of that geometry. Because the current
index contains only rough-surface classes, this percentage equals `pavePercent`; it does not
measure regional OSM completeness. Unsupported surface classes are not assessed by this
scorer. With no matching evidence, the entire route remains unknown, even when known rough
exposure is zero. Empty or stationary geometry produces zero distance and zero coverage,
with data reliability still unknown.

The API exposes these metrics as `unknownSurfaceMeters`, `surfaceCoveragePercent`,
`surfaceClassificationConfidence`, and `surfaceDataConfidence`, alongside existing fields.
Malformed coordinates, unsupported classes, and invalid feature IDs are excluded before
indexing; invalid grid sizes are rejected. Coordinate validation does not establish the
accuracy or freshness of otherwise valid source geometry.

## Required validation

- finite coordinates inside the declared extraction area;
- at least two distinct points per geometry;
- unique OSM IDs;
- surface in the normalised set;
- non-zero segments and flagged geographic jumps;
- geometric duplicates distinct from ID duplicates;
- schema version and provenance on the next generation;
- confidence and route coverage reported separately.

## Routing metrics

Each candidate should expose:

- distance and duration;
- estimated known rough-surface metres and percentage;
- deviation from the fastest candidate;
- assessed, partially assessed, and unknown distance;
- aggregated match confidence;
- dataset version;
- provider and profile.

Percentages are estimates derived by matching router geometry with OSM geometry. Zero known
exposure does not mean a hazard-free route or a fully assessed surface.

## Updates and contributions

Overpass may enrich ways in memory during planning but does not alter the local file.
Community reports remain separate and do not automatically change route classification
before verification. A future generation pipeline must store its query, timestamp,
replication sequence, counts, validation report, licence attribution, and dataset hash.
