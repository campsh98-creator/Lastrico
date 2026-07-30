# Architecture

## Main boundaries

| Area | Responsibility | Main files |
| --- | --- | --- |
| UI | planning, routes, navigation, community | `app/page.tsx`, `components/` |
| GPS state | reading filters, heading, off-route state, simulation | `lib/navigation-state.ts` |
| Instructions | manoeuvre types and pure helpers | `lib/navigation-instructions.ts` |
| Routing | alternatives, providers, road-surface scoring | `app/api/routes/route.ts` |
| Surfaces | bundled OSM dataset and classification | `data/milan-pave-central.json`, `app/api/routes/route.ts` |
| Reports | validation, privacy, persistence, export | `app/api/reports/`, `lib/reporting.ts`, `db/` |
| Map | MapLibre rendering and GeoJSON sources | `app/page.tsx` |
| Hosting | Worker, D1, and Sites configuration | `.openai/hosting.json`, `db/`, `drizzle/` |

`app/page.tsx` remains the main coordinator. The directions sheet and community panel receive
explicit data and callbacks and do not depend directly on MapLibre.

## Route flow

1. The client sends an origin, destination, travel mode, and avoidance level.
2. The API requests alternatives from compatible routing engines.
3. Route geometries are compared with known rough-surface coverage.
4. The API returns the fastest route, a lower-exposure alternative when genuinely distinct,
   diagnostics, and manoeuvres.
5. The selected Lastrico route remains the primary experience. External map applications
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

Lastrico is city-independent in product identity, but the current implementation contains
Milan-specific geocoding bounds, GPS bounds, report validation, and a bundled Milan
road-surface dataset. These are current beta constraints, not evidence of support elsewhere.

A future region adapter should own:

- a stable region identifier and human-readable coverage statement;
- geocoding, GPS, routing, and report-validation boundaries;
- one or more surface datasets with source, licence, generation date, and confidence;
- provider settings, attribution, and mode-specific validation scenarios;
- release evidence for routing, GPS, mobile behaviour, and production smoke tests.

This adapter is a documented direction and is not yet implemented. A region such as Rome
must not be advertised as supported until its adapter and release evidence exist.

## Privacy

Lastrico does not store a continuous GPS history. Coordinates used for routing may be sent
to the external providers disclosed in the interface. Do not add location telemetry,
persistent identifiers, or personal data without an explicit, documented decision and an
appropriate privacy review.
