# Lastrico — Phase 3.11 Execution Prompt: Authentic Milan OSM Completion

## 1. Objective & Scope
1. **Coverage Inventory & Discrepancy Verification:**
   - Audit the exact segment counts: verify the 955 segments added from `milan-road-network-representative.json` vs the 622 segments residing in the 6 peripheral tiles (`917_*` and `920_*`). Account for tile boundary crossings and spatial distribution.
2. **Authentic OSM Acquisition Pipeline:**
   - Probe the acquisition pipeline (`scripts/osm/expand-milan-network.mjs`).
   - If network access is available (or can be run), acquire genuine OSM tiles covering the 4 corridors (`w-sw`, `w-nw`, etc.).
   - If network access is restricted by environment boundaries, document the exact reproducible CLI procedure, verify existing local archives and integrity checksums, and proceed with rigorous offline validation.
3. **Reproducible Compact Tile Regeneration:**
   - Compile compact tiles with provenance hashes, modal bitmasks, restriction legality, and strict unknown-surface semantics (`confidence = 0` for unknown).
4. **Independent Corridor Road & Surface Validation:**
   - Measure physical road coverage and surface certainty for each of the four corridors (`cadorna-darsena`, `moscova-porta-venezia`, `sempione-porta-romana`, `magenta-missori`).
   - Do not conflate tile boundary presence with actual street coverage.
5. **Multi-Modal Routing Benchmarking Before/After:**
   - Compare identical route requests across `car`, `motorcycle`, and `bicycle`.
   - Measure rough exposure (meters and %), unknown coverage, alternative route discovery, and end-to-end API latency.
6. **Runtime Environment Profiling:**
   - Measure cold and warm memory, isolate heap, and concurrent request behavior.
   - Distinguish Node.js benchmarking from Cloudflare Workers runtime (`workerd`).
7. **Verification & Quality Gates:**
   - Full test suite passing (`npm test`).
   - Clean TypeScript check (`npx tsc --noEmit`).
   - Clean ESLint check (`npm run lint`).
   - Production build check (`npm run build`).

## 2. Limitations & Operational Rules
- Sandbox network boundary respected: no repeated retries on blocked endpoints.
- No fabricated data or synthetic surfaces: honest product behavior maintained.
- External map applications remain fallbacks; Lastrico in-app navigation is primary.
- No commit, push, or deploy.

## 3. Acceptance Criteria
- Exact mathematical reconciliation of segment counts documented.
- Clear acquisition status and reproducible procedure provided.
- Actual road and surface coverage reported with precision per corridor.
- Before/after routing comparisons across all 3 transport modes documented.
- 100% test pass rate, 0 TypeScript errors, 0 ESLint warnings/errors.
- Concise Italian summary report delivered.
