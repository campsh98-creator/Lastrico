# Lastrico — Phase 3.13 Execution Prompt: Expanded Network Validation

## 1. Objective & Scope
1. **Data Quality & Reconciliation (23 Tiles):**
   - Verify source provenance manifests across all 11 raw OSM responses (`data/sources/*.osm.json.gz`).
   - Reconcile mathematical difference between 37,106 normalized segments in `milan-central.json` vs 37,844 segments in `milan-compact-tiles.json`.
   - Audit actual road coverage, known/unknown surface metrics, tile boundaries, and modal restriction bitmasks on the four expansion corridors:
     - `cadorna-darsena` (Western Cerchia dei Navigli)
     - `moscova-porta-venezia` (Northern Cerchia dei Bastioni / Giardini Pubblici)
     - `sempione-porta-romana` (North-West to South-East diagonal)
     - `magenta-missori` (Western historical axis)

2. **Routing Quality & Alternative Discovery:**
   - Multi-modal benchmarking across `car`, `motorcycle`, and `bicycle`.
   - Compare old 12-tile baseline vs new 23-tile expanded dataset on identical routes and candidate generators.
   - Measure pave exposure reduction, surface certainty improvement, Pareto alternative discovery, and end-to-end compute latency.
   - Identify any route anomalies, legal violations, or missed avoidance opportunities.

3. **Runtime Resource Profiling (23-Tile Scale):**
   - Profile cold/warm memory footprint under the full 23-tile network.
   - Test concurrent request bursts and LRU eviction under expanded data volume.
   - Confirm strict adherence to the Cloudflare Workers 128 MB isolate limit.

4. **Integration, Tests, & Verification:**
   - Add focused regression tests in `tests/` for the 23-tile dataset.
   - Verify 100% test pass rate (`npm test`).
   - Clean TypeScript check (`npx tsc --noEmit`).
   - Clean ESLint check (`npm run lint`).
   - Clean build check (`npm run build`).

## 2. Limitations & Operational Rules
- No new downloads: work with already-acquired 23-tile dataset.
- No fabricated data or synthetic surface inference: honest product behavior.
- External maps are fallbacks; in-app routing remains primary.
- No commit, push, or deploy.

## 3. Acceptance Criteria
- Exact segment count reconciliation (37,106 vs 37,844) documented.
- Actual road coverage and surface certainty gains quantified per corridor.
- Routing improvements (rough stone reduction, certainty, latency) verified across modes.
- Isolate memory verified safely under 128 MB (with >50% headroom).
- All 199+ automated tests passing with zero regressions.
- Concise Italian delivery report.
