# Architecture

## Main boundaries

| Area | Responsibility | Main files |
| --- | --- | --- |
| UI | planning, route comparison, navigation HUD, community reports | `app/page.tsx`, `components/phase43/`, `app/globals.css` |
| GPS and progress | fix fusion, deviation evidence, route progress, marker motion | `lib/navigation-fix-processor.ts`, `lib/route-progress.ts`, `lib/marker-motion.ts`, `lib/navigation-state.ts` |
| Guidance | manoeuvres, voice, upcoming-surface warnings | `lib/navigation-instructions.ts`, `lib/voice-guidance.ts`, `lib/pave-warnings.ts`, `lib/rough-sections.ts` |
| Routing | candidate generation, provider adapters, equivalence, selection, reroute objective | `app/api/routes/route.ts`, `lib/routing-providers.ts`, `lib/route-candidates.ts`, `lib/route-optimization.ts`, `lib/reroute-objective.ts` |
| Surfaces | compiled OSM surface tiles, spatial matching, unknown coverage | `data/surfaces/`, `lib/spatial-road-store.ts`, `lib/road-intelligence-scoring.ts` |
| Access | OSM access and conditional rules, Milan ZTL areas | `lib/access-conditions.ts`, `lib/ztl-access.ts`, `data/features/milan-ztl-areas.json` |
| Road features | traffic signals, stop and give-way signs | `lib/road-features.ts`, `data/features/milan-road-features.json` |
| Areas | Milan, Roccella Ionica, experimental Rome: bounds, geocoding, datasets | `lib/pilot-areas.ts`, `lib/*-tile-index.ts`, `lib/rome-*.ts` |
| Reports | validation, privacy, persistence, export | `app/api/reports/`, `lib/reporting.ts`, `db/` |
| Map | MapLibre rendering and GeoJSON sources | `app/page.tsx`, `lib/map-route-style.ts`, `lib/map-appearance.ts` |
| Hosting | Cloudflare Worker, D1, pilot deployment | `worker/index.ts`, `deploy/pilot.json`, `scripts/deploy-pilot.mjs`, `drizzle/` |

`app/page.tsx` remains the main coordinator. The directions sheet and community panel receive
explicit data and callbacks and do not depend directly on MapLibre.

## Route flow

1. The client sends an origin, destination, travel mode and avoidance level. It may also send
   an extra-minute limit, the ZTL areas the person is authorised for, and, during navigation,
   the journey's objective.
2. The API collects candidates: provider alternatives, a surface-aware Valhalla search where
   rough ways cost more, detour waypoints around rough stretches, and refinement (planning
   only).
3. Each candidate is matched against the compiled surface tiles: confirmed, probable, unpaved
   and unknown metres. Access and ZTL rules are checked at the departure time (Europe/Rome).
   A blocked route gets one regenerated variant that excludes only the blocked stretch.
4. Selection keeps the Pareto frontier of time, rough surface and unknown surface. It then
   applies the level's time ceiling and value of time, the minimum useful reduction and the
   person's extra-minute limit. It records the rule that decided each candidate.
5. The API returns the fastest route and, when one is genuinely distinct and better, the
   anti-pavé alternative. Otherwise it returns a status that says why there is none. The
   response also carries rough sections, road features, access notes and diagnostics.
6. The selected Lastrico route remains the primary experience. External map applications
   are fallbacks and calculate their own route.

Cars, motorcycles, and bicycles use mode-specific provider behaviour. A car route must not
be silently returned as a substitute when a legal bicycle or motorcycle route is
unavailable. Surface data is one routing signal; it does not certify the safety, legality,
or current condition of a route.

## Community report flow

1. An explicit action enables start and end selection on the map.
2. The form sends only the selected segment and completed fields.
3. The server applies size and rate limits, rejects recent duplicates, validates coverage,
   length, and content, and saves the report as `pending`.
4. Public APIs and CSV exports expose only `verified` records. Moderation notes and
   nicknames are not published.
5. Unverified reports do not alter routing automatically.

## Geographic coverage

The product identity does not depend on any city. Each area is a pilot-area entry
(`lib/pilot-areas.ts`) with:
- its own bounds;
- geocoding limits;
- surface tiles with source checksums;
- validation evidence.

Coverage today:
- **Milan:** citywide surfaces; ZTL and central traffic signals.
- **Roccella Ionica:** a small pilot.
- **Rome:** experimental and local only. It has never been deployed, and it is not advertised as
  supported until its mobile and production evidence exists.

These entries are a first step towards a future region adapter. That adapter would also own
provider settings, attribution, mode-specific validation scenarios and the release evidence
for routing, GPS, mobile behaviour and production smoke tests. It is a documented direction,
not yet implemented.

See [engineering status](ENGINEERING_STATUS.md).

## Privacy

Lastrico does not store a continuous GPS history. Coordinates used for routing may be sent
to the external providers disclosed in the interface. Do not add location telemetry,
persistent identifiers, or personal data without an explicit, documented decision and an
appropriate privacy review.

## Local hardening boundaries

Provider adapters reject malformed candidate metrics, geometry and manoeuvres before scoring.
Serialized Valhalla/geocoding waits include cancellation and request deadlines; throttling
remains per Worker isolate, not a global service quota. Deduplication compares route geometry
in both directions, preserves endpoint orientation and retains the fastest equivalent route
as the reference for the user's hard extra-time limit. Existing mode-specific detour policies
are unchanged. Extra detour calls are skipped when the fastest route has insufficient known
exposure to meet the existing minimum-reduction threshold.

All local surface ways remain available to scoring even if a candidate leaves the smaller
live-query rectangle. Unmatched distance is unknown; category weighting is distinct from
verification/freshness confidence. See [surface model](COBBLESTONE_DATA_MODEL.md).

Geocoding and report input boundaries are independently tested in `lib/geocoding.ts` and
`lib/report-request.ts`. Reports remain pending and cannot affect routing before verification.
The public JSON route fields remain compatible; coverage fields are additive.
