# Execution prompt — Small Milan-area coverage expansion

## Objective

Extend the current Lastrico beta only slightly beyond Milan through one contiguous,
versioned service zone named `MIL_EAST_V1`. People must be able to search, plan, navigate,
reroute, and report roads in Milan, Vimodrone, Segrate, and Pioltello.

This is not a nationwide rollout. The implementation must establish a reusable geographic
architecture that can later support Rome and other municipalities without renaming the
product or duplicating city-specific logic.

## Product principles

- Keep MapLibre and OpenFreeMap as the primary basemap; the basemap already has global
  coverage.
- Treat basemap availability, routing availability, and road-surface data coverage as
  separate concepts.
- Unknown road surface never means smooth, asphalt, or safe.
- Keep the fastest route available when surface coverage is insufficient.
- Show a road-condition-aware alternative only when the comparison is supported by enough
  data.
- Continue navigation across the old Milan boundary without presenting a coverage issue as
  weak GPS.
- Do not promise accident prevention, guaranteed safety, or complete road-surface coverage.

## Scope

1. Create one versioned service-area configuration shared by client, geocoding, routing,
   GPS, and reporting.
2. Define the advertised endpoint and reporting area as the union of the administrative
   polygons of Milan, Vimodrone, Segrate, and Pioltello, taken from a reproducible,
   versioned snapshot.
3. Define the routing and GPS technical envelope as that municipal union plus a 1.5 km
   buffer. The buffer prevents edge failures but does not expand the advertised area.
4. Generate road-condition data for the municipal union plus a 500 m halo so roads near
   administrative boundaries can be matched consistently.
5. Use the approximate bounds `west 9.04 / south 45.38 / east 9.40 / north 45.57` only as
   the geocoder viewbox or bias. Never use this rectangle as proof of service-area or
   road-condition coverage.
6. Remove duplicated hardcoded Milan bounds from product logic.
7. Allow address searches that preserve municipality and postcode and correctly distinguish
   streets with the same name.
8. Generate a reproducible offline OpenStreetMap road-condition snapshot for the pilot
   area.
9. Return route-level surface coverage as `full`, `partial`, or `none`.
10. Keep planning and GPS rerouting on the same dataset version.
11. Update user messages so “outside surface coverage” is distinct from “outside service
   area”, “weak GPS”, and “routing provider unavailable”.
12. Allow moderated road reports inside the pilot municipal union.

## Out of scope

- Full Metropolitan City, Lombardy, Rome, or nationwide data rollout.
- A single national JSON dataset.
- Dependence on live Overpass during a user request.
- Traffic-aware routing or safety certification.
- Motorcycle routing.
- Any silent bicycle-to-car fallback.

## Technical design

Create a central module such as `lib/service-area.ts` containing:

- stable zone ID, version, and public label;
- endpoint search area;
- routing/GPS envelope and technical buffer;
- reporting area;
- road-condition coverage polygons or tiles;
- geocoder bias bounds;
- `containsEndpoint`;
- `containsReport`;
- `intersectsRoute`;
- `coverageForRoute`.

Rename city-specific geographic types to generic names. All APIs and UI validation must
derive from this module.

The surface snapshot must include a manifest with schema version, dataset version,
generation timestamp, OSM timestamp/sequence, extraction area, query or generator version,
SHA-256, feature counts, ODbL attribution, and validation results.

The dataset model must support road-condition evidence beyond cobblestones, including rough
or irregular paving, unpaved or damaged surfaces, confirmed smooth surfaces, and unknown
conditions. Keep the source evidence, matching confidence, and geographic completeness as
separate values.

Measure a small single-snapshot implementation against tiled data. If a single pilot file
is used, keep the loader interface tile-ready. Future regional and national expansion must
use spatial tiles or equivalent partitioning.

## Required route response

For each route candidate expose:

- distance and duration;
- transport mode;
- known road-condition risk metres and percentage;
- confirmed and probable metres;
- unknown or unassessed metres;
- deviation from the fastest candidate;
- `surfaceCoverage: "full" | "partial" | "none"`;
- route coverage percentage or documented interval;
- match confidence, separate from coverage completeness;
- dataset version;
- provider and profile;
- internal timing diagnostics without coordinates or addresses.

Do not prefer a candidate simply because a larger part of it is unknown.

## Required tests

- Search `Pioltello` and `Via Roma 1, Pioltello`.
- Distinguish same-name streets in Milan and Pioltello.
- Verify one clearly inside point for each municipality, points just inside and outside the
  service boundary, and a point inside the geocoder viewbox but outside the municipal
  union. Reuse these fixtures across geocoding, routing, GPS, and reporting.
- Benchmark at least 20 routes, including Pioltello → Milan, Milan → Pioltello, Pioltello →
  Segrate, Segrate → Vimodrone, local routes in every pilot municipality, routes crossing
  the former `9.31` eastern bound, and routes with partial road-condition coverage.
- Test every representative route with car and bicycle profiles and verify that bicycle
  never falls back silently to car.
- Current position and simulated GPS trace starting in Pioltello.
- Crossing the former east bound without camera, ETA, instruction, or reroute failure.
- Full, partial, and missing surface coverage.
- Offline and provider timeout while preserving the previous route.
- Road report inside Pioltello and rejection just outside the pilot.
- Shared inside/outside boundary fixtures across every endpoint.
- Desktop, 393×852, 360×640, and 568×320.
- Long navigation simulation and production smoke test.

## Performance gates

Benchmark at least 20 representative routes and report:

- geocoding and routing p50/p95;
- candidate generation and surface scoring;
- dataset load and cold-start memory;
- loaded tile count and bytes, when tiled;
- provider timeout/error rate;
- map source update time;
- build-size change.

Live Overpass must not block planning or rerouting.

Do not release if routing p95 latency or cold-start memory regresses by more than 20% without
an investigated and documented reason. If the pilot JSON exceeds 1 MB uncompressed or
materially affects cold start, partition it into versioned geographic tiles.

## Rollout

1. Implement `MIL_EAST_V1` behind a beta configuration.
2. Validate the snapshot, automated tests, and route matrix locally.
3. Run limited testing in Milan, Vimodrone, Segrate, and Pioltello.
4. Review missing evidence, false matches, and moderated user reports.
5. Enable `MIL_EAST_V1` by default only after every release gate passes.
6. Add future municipalities or cities only as separately versioned zones. Rome remains
   outside this release.

## Release conditions

- Pioltello works as origin and destination.
- Car and bicycle routing work without silent profile substitution.
- GPS and rerouting work from Pioltello.
- Crossing the former `9.31` eastern bound does not interrupt navigation.
- Route, GPS, rerouting, and reporting use the same service-area policy.
- Surface coverage is always visible and understandable.
- No unknown surface is presented as asphalt, smooth, safe, or risk-free.
- The fast route remains usable when surface comparison is not meaningful.
- All automated and mobile tests pass.
- The prolonged navigation simulation passes.
- Dataset provenance, version, generation timestamp, checksum, and limitations are
  documented.
- Routing p95 latency and cold-start memory satisfy the performance gate.
- No location history, personal addresses, secrets, or production dumps are committed.
- If deployment is separately authorized, the published beta passes a production smoke
  test.
- No merge, pull request, or production deployment occurs without explicit authorization.

## Stop condition

Do not release the expansion if routing beyond Milan works but the interface or route API
cannot distinguish assessed, partially assessed, and unassessed road sections. Preserve the
current beta and report the blocking data or interface gap instead of overstating coverage.
