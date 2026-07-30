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
