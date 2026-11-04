# Execution Prompt — Phase 4.15: Large-Scale Routing Stress Test & Auto-Fix

## 1. Scope & Objectives
- Build a reproducible, authentic geographic dataset of **at least 100 distinct real locations/addresses/POIs** across **Milan** (central, north, south, east, west, suburban boundary zones, pavé streets, smooth arteries, unknown-surface streets, restricted/pedestrian areas) and **Roccella Ionica**.
- Generate and execute **at least 150 distinct origin–destination journeys** across **Auto (`car`)**, **Moto (`motorcycle`)**, and **Bici (`bicycle`)**:
  - Covering short (`< 1.5 km`), medium (`1.5–6 km`), and long (`> 6 km`) routes.
  - Covering central, northern, southern, eastern, and western Milan, city-center to suburban routes, and routes crossing spatial tile boundaries.
  - Covering streets with confirmed pavé, confirmed smooth asphalt, unpaved segments, and unknown surfaces.
  - Covering difficult geocoding (apostrophes, accents, street numbers, ambiguous names, Roccella Ionica localities), nearby destinations (`< MINIMUM_ROUTE_METERS`), and restricted/pedestrian roads.
- Validate both backend calculations (`/api/geocode`, `/api/routes`, `spatialRoadStore`, `surface-scoring`) and UI consistency (`RouteComparisonPanel`, `SurfaceBreakdown`, one-tap autocomplete, automatic route calculation, and navigation start/stop/restart).
- Immediately diagnose and fix any discovered bugs in geocoding, routing, surface accounting, or UI state management, then re-run failed scenarios and regression suites until all pass.

## 2. Provider Safety & Test Architecture
- Respect public Nominatim (`>= 1,050 ms` interval) and Valhalla/OSRM (`>= 1,100 ms` interval) usage policies; never subject public servers to uncontrolled load.
- Separate test execution clearly into three categories:
  1. **Live-Provider Validation (`24–30` scenarios)**: Representative sample across Milan and Roccella Ionica (`car`, `motorcycle`, `bicycle`, plus difficult geocoding queries), rate-limited and recorded.
  2. **Fixture-Backed Full Pipeline Stress Matrix (`150+` distinct journeys / `180+` mode scenarios)**: Exercises the real `/api/geocode` and `/api/routes` route handlers, `lib/routing-providers.ts`, `lib/spatial-road-store.ts`, `lib/surface-scoring.ts`, and React `RouteComparisonPanel` / `SurfaceBreakdown` rendering against authentic OSM road geometries and realistic provider payloads.
  3. **Browser E2E & Mobile Interaction Tests (`390×844` viewport)**: Verifies one-tap autocomplete, keyboard navigation, stale-response protection, error recovery (nearby endpoints, ambiguous queries), mode switching, and navigation start/stop/restart lifecycle.

## 3. Acceptance Criteria
- `>= 100` distinct real locations validated with authentic coordinates inside Milan and Roccella Ionica bounds.
- `>= 150` distinct origin–destination journeys executed with balanced `car`, `motorcycle`, and `bicycle` coverage.
- Every valid journey produces legal, non-empty geometry within pilot bounds, positive distance and duration, and internally consistent surface metrics (`paveMeters + smoothSurfaceMeters + unpavedSurfaceMeters + unknownSurfaceMeters ≈ surfaceTotalMeters`).
- Anti-pavé alternatives are selected only when genuinely distinct and legal within the time budget, with accurate pavé savings relative to the fastest baseline.
- Edge cases (identical/nearby start-end, out-of-bounds coordinates, apostrophe/accented queries, Roccella village/town labels) are handled cleanly without crashes, infinite loading, or misleading metrics.
- All unit tests, stress tests, `eslint`, `tsc --noEmit`, and production `vinext build` pass with `0` errors.

## 4. Constraints & Release Conditions
- Preserve all Phase 4.13 and 4.14 functionality and UI simplification.
- Fix confirmed bugs with minimal, targeted changes; no unrelated refactoring or redesign.
- No new branches, worktrees, Git push, merge, PR, or Cloudflare deployment.
