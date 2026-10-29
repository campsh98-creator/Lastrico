# Lastrico — Phase 3.8 Execution Prompt: Memory-Efficient Road Intelligence

## 1. Objective & Scope
1. **Memory & Bundle Baseline Measurement:**
   - Quantify current Node and workerd memory footprint:
     - Bundle size of `dist/server/index.js` (raw and gzip).
     - Isolate startup and top-level JSON parse overhead (heap delta, peak memory, CPU time).
     - Request peak memory and index retained heap.
   - Establish documented Cloudflare Workers Free constraints (128 MB isolate memory limit, 10 ms CPU budget).

2. **Compact & Spatially Scoped Road Intelligence Architecture:**
   - Eliminate eager top-level parsing of the 33.3 MB `milan-central.json` on isolate cold start.
   - Design and implement compact data representation preserving all source attributes:
     - Exact geometry: microdegree precision (lossless to OSM 1e-7 deg API resolution).
     - Surface category and roughness weights.
     - Highway classification and names.
     - Modal access and directional restrictions (`car`, `motorcycle`, `bicycle`, oneway).
     - Restriction tags (`layer`, `bridge`, `tunnel`, `service`, `access`, conditional/directional keys).
     - Embedded rails and cycling infrastructure flags.
     - Complete SHA-256 source provenance and dataset integrity.
   - Implement spatially scoped access:
     - Partition spatial indexing into grid tiles / cells.
     - Load and index only the spatial segments covering active route corridors (+ safety buffer) rather than the entire metropolitan dataset.
     - Implement LRU / module-level caching for active spatial tiles.
     - Preserve full fidelity for live Overpass dynamic overlays.

3. **Routing Semantics & Quality Preservation:**
   - Verify that 100% of routing decisions, Pareto frontiers, surface scores, rough/unknown exposures, and legal restrictions match bit-for-bit before and after.
   - Maintain compatibility with existing test suites, including `tests/routes-api.test.mjs`, `tests/osm-source-integrity.test.mjs`, and `tests/rendered-html.test.mjs`.

4. **Benchmarking & Validation:**
   - Measure memory reduction (heap, bundle size, peak request).
   - Measure CPU latency impact (cold start vs warm routing request).
   - Run full regression tests (`npm test`), TypeScript check (`tsc --noEmit`), and ESLint (`npm run lint`).
   - Conclude with a definitive GO/NO-GO decision for incremental Milan data expansion.

## 2. Limitations & Operational Rules
- Sandbox runs without outbound network access.
- Preserve honest product behavior: never infer surface from highway type or generic `paved`. Missing data remains `unknown`.
- External maps are fallbacks; in-app routing remains primary.
- No commit, push, or deploy.

## 3. Acceptance Criteria
- Bundle size of `dist/server/index.js` reduced drastically (under 3 MB uncompressed, down from 27.5 MB).
- Server cold start heap and peak memory significantly below the 128 MB Worker limit.
- Zero change in routing geometry, surface scores, or legal validity for identical routes.
- Full test suite passing (`npm test`).
- Clean TypeScript compilation and ESLint.
- Comprehensive report documenting before/after memory, CPU, bundle metrics, and GO/NO-GO determination.
