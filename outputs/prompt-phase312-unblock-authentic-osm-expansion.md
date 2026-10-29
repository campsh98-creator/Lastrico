# Lastrico — Phase 3.12 Execution Prompt: Unblock Authentic OSM Expansion

## 1. Objective & Scope
1. **Connectivity & Acquisition Determination:**
   - Test whether execution with network access (`BypassSandbox: true`) can reach the OpenStreetMap API to download missing Milan expansion tiles.
   - If user approves network access, download genuine OSM tiles:
     - Western expansion tiles: `w-sw` (Sant'Ambrogio / Conca del Naviglio / Navigli) and `w-nw` (Cadorna / Santa Maria delle Grazie / Sempione ovest).
     - Perimeter expansion tiles: `n-nw`, `n-ne` (Moscova / Bastioni nord), `e-nw` (Porta Venezia), `s-sw`, `s-se` (Darsena / Porta Romana sud).
   - If network access cannot be obtained or is denied, provide the exact minimal Mac terminal commands and import procedure; do not claim downloads occurred.
2. **Data Validation & Ingestion:**
   - Validate downloaded tile integrity (valid JSON, OSM elements count, SHA-256 checksums).
   - Ingest new tiles into `data/sources/milan-pilot-osm.source.json`.
   - Update representative road network `data/milan-road-network-representative.json`.
   - Recompile compact store `data/surfaces/milan-compact-tiles.json`.
3. **Coverage & Multi-Modal Routing Verification:**
   - Measure actual corridor coverage gains across all four corridors.
   - Validate routing before/after across `car`, `motorcycle`, `bicycle`.
   - Ensure legal restrictions, Pareto selection, fastest-route baselines, and unknown classifications are strictly preserved.
4. **Testing & Quality Assurance:**
   - Full automated test suite passing (`npm test`).
   - Clean TypeScript check (`npx tsc --noEmit`).
   - Clean ESLint check (`npm run lint`).
   - Production build check (`npm run build`).

## 2. Limitations & Operational Rules
- Respect OpenStreetMap API usage policies (single sequential downloads, polite User-Agent, bounded bounding boxes).
- No fabricated data or synthetic surfaces: genuine OSM provenance only.
- External maps are fallbacks; Lastrico in-app navigation remains primary.
- No commit, push, or deploy.

## 3. Acceptance Criteria
- Verified download status and checksummed tile provenance.
- Updated compact store with expanded genuine OSM coverage.
- Measurable increase in coverage across Milan expansion corridors.
- 100% test pass rate with 0 regressions.
- Concise Italian summary for the user.
