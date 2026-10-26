# Lastrico Phase 2: Road Intelligence Foundation — Execution Plan

## Scope and authority

Transform Lastrico's existing Milan surface dataset into an extensible, production-oriented Road Intelligence foundation.
Build a versioned, typed schema with attribute provenance, a reproducible offline OSM ingestion workflow with cryptographic manifests, conservative integration of Milan cycling open data, and backward-compatible scoring improvements.
All Phase 1 improvements (hard budgets, provider validation, uncertainty semantics, car-only fallback, monotonic progress) are strictly preserved.
Phase 2 changes remain local and uncommitted; no production resources are modified.

## Baseline (2026-10-26)

- Branch: `fix/mobile-navigation-stability`.
- Phase 1 committed: `5ae75b7 fix(routing): harden provider validation, route budgets and surface uncertainty`.
- Working tree: clean.
- Required checks passing: `npm run lint`, `npx tsc --noEmit`, `npm test` (105 tests), `git diff --check`.

## Architecture and File Ownership

1. `lib/road-intelligence-types.ts`:
   - Typed schema for road attributes: `SurfaceMaterial`, `SurfaceSmoothness`, `SurfaceCategory`, `HighwayClassification`, `CyclingInfrastructure`.
   - Explicit `AttributeProvenance<T>`: state (`known`, `unknown`, `conflicting`, `inferred`, `partial`), `sourceId`, `authority`, `observedAt` (strictly null if unrecorded), `ingestedAt`, and `confidence`.
   - Deterministic 64-bit segment hashing and canonical edge representation.

2. `scripts/osm/`:
   - `config.mjs`: Milan boundary coordinates, surface weight maps, highway whitelists.
   - `normalize.mjs`: Pure tag normalization, material classification, smoothness parsing, cycleway/railway tagging.
   - `validate.mjs`: Coordinate bounds, finite checks, minimum vertex count, jump detection.
   - `manifest.mjs`: Manifest generation with SHA-256 hashes, statistics, ODbL 1.0 license attribution.
   - `ingest.mjs`: CLI workflow rebuilding the dataset deterministically from source extract.
   - `quality-report.mjs`: Length-weighted coverage metrics by functional road class and surface certainty.

3. `lib/adapters/milan-cycling-adapter.ts`:
   - Adapter for Comune di Milano *Itinerari ciclabili* (CC BY 4.0, EPSG:4326 GeoJSON).
   - Normalizes cycling infrastructure typology and traffic flow direction without fabricating surface or smoothness data.

4. `lib/cobblestone-scoring.ts` & `app/api/routes/route.ts`:
   - Additive road intelligence scoring: computes `smoothMeters`, `confirmedMeters`, `probableMeters`, `paveMeters`, and `unknownMeters`.
   - Unidirectional heading alignment for directed segments (`cos θ >= 0.70`) to eliminate dual-carriageway snapping.
   - Memoized spatial index at module scope to eliminate per-request index reconstruction on Cloudflare Workers.
   - 100% backward compatibility for all existing API response fields.

5. `tests/`:
   - `tests/road-intelligence-schema.test.mjs`: Schema validation, provenance invariants, no fabricated timestamps.
   - `tests/osm-ingestion-manifest.test.mjs`: Checksum verification, manifest statistics, deterministic regeneration.
   - `tests/geospatial-matching.test.mjs`: Dual-carriageway rejection, sidewalk discrimination, tram track handling.
   - `tests/milan-cycling-adapter.test.mjs`: Municipal cycling data normalization and conservative spatial association.
   - `tests/quality-metrics.test.mjs`: Length-weighted coverage by functional class.

## Stopping and Release Conditions

- All automated tests pass (`npm test`).
- Zero TypeScript compile errors (`npx tsc --noEmit`).
- Code style and hygiene checks pass (`npm run lint`, `git diff --check`).
- Phase 2 changes remain uncommitted and local.
