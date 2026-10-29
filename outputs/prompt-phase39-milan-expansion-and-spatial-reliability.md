# Lastrico — Phase 3.9 Execution Prompt: Milan Expansion & Spatial Reliability

## 1. Objective & Scope
1. **Authentic OSM Geographic Expansion:**
   - Extend Milan Road Intelligence coverage beyond the initial 4-tile city-center pilot (`[9.180, 45.455, 9.200, 45.475]`) into the four benchmark corridors evaluated in Phase 3.7:
     - `cadorna-darsena` (Western Cerchia dei Navigli)
     - `moscova-porta-venezia` (Northern Cerchia dei Bastioni / Giardini Pubblici)
     - `sempione-porta-romana` (North-West to South-East diagonal)
     - `magenta-missori` (Western historical axis)
   - Preserve 100% authentic OSM provenance:
     - Reuse genuine OSM response extracts (`data/sources/*.osm.json.gz` and unclipped raw ways in `data/milan-road-network-representative.json`).
     - Strictly no fabricated segments or synthetic surfaces.
     - Never infer surface from highway class; unrecorded surfaces remain `unknown`.
     - Maintain SHA-256 provenance manifests.
     - Preserve directional restrictions, modal access (`car`, `motorcycle`, `bicycle`), oneway, embedded rails, and cycle facilities.

2. **Compact Spatially Scoped Reliability:**
   - Validate multi-tile boundaries: ensure segments crossing tile boundaries are deduplicated cleanly without omissions or double-counting.
   - Verify corridor tile coverage for candidate generation and detour exploratory search.
   - Ensure LRU caching in `SpatialRoadIntelligenceStore` maintains bounded memory and low CPU latency across arbitrary routes.

3. **Benchmarking & Cross-Corridor Evaluation:**
   - Measure coverage gains across the four corridors.
   - Benchmark routing before/after for all transport modes (`car`, `motorcycle`, `bicycle`).
   - Validate that fastest-route baselines, Pareto optimization, uncertainty handling, and legal compliance remain intact.
   - Measure cold start and warm request memory, CPU, and bundle size on the expanded network.

4. **Verification & Delivery:**
   - Full automated test suite passing (`npm test`).
   - Clean TypeScript check (`npx tsc --noEmit`) and ESLint (`npm run lint`).
   - Deliver clear metrics and GO/NO-GO determination for subsequent phases.

## 2. Limitations & Operational Rules
- Sandbox runs without outbound network access. Do not repeatedly retry blocked network requests.
- Preserve honest product behavior: never guess surface properties.
- External maps are fallbacks; in-app routing remains primary.
- No commit, push, or deploy.

## 3. Acceptance Criteria
- Genuine OSM expansion tiles integrated and verified via SHA-256 checksums.
- Tile boundary crossings and corridor padding verified without geometry duplicates or dropouts.
- Routing across tile boundaries functions seamlessly across all 3 transport modes.
- Memory remains well below the 128 MB isolate limit and warm scoring latency below 10 ms.
- 100% test pass rate (`npm test`), 0 TypeScript errors, 0 ESLint errors.
- Concise Italian summary for the user.
