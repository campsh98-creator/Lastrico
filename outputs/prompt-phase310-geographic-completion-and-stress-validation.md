# Lastrico — Phase 3.10 Execution Prompt: Geographic Completion & Stress Validation

## 1. Objective & Scope
1. **Geographic Coverage & Data Integrity:**
   - Measure actual road and surface coverage for the expanded Milan grid (12 current tiles + candidate perimeter/gap areas).
   - Evaluate the four benchmark corridors:
     - `cadorna-darsena` (Western Cerchia dei Navigli)
     - `moscova-porta-venezia` (Northern Cerchia dei Bastioni / Giardini Pubblici)
     - `sempione-porta-romana` (North-West to South-East diagonal)
     - `magenta-missori` (Western historical axis)
   - Determine missing genuine OSM data without inventing synthetic geometry or classifications.
   - Maintain strict provenance manifests, SHA-256 verification, and unknown-surface semantics (confidence = 0).

2. **Runtime & Routing Reliability Stress Testing:**
   - Stress-test cold/warm tile loading, LRU cache eviction under load (concurrency, bursts).
   - Test cross-tile detours and edge-case routing across tile boundaries.
   - Profile memory and latency under realistic concurrency (P50/P95 latency, heap deltas).
   - Validate compliance with Cloudflare Workers 128 MB memory limit and workerd runtime characteristics.

3. **Routing Fidelity & Multi-Modal Verification:**
   - Verify all transport modes (`car`, `motorcycle`, `bicycle`).
   - Validate legal restrictions (one-ways, turning restrictions, cycle tracks).
   - Validate Pareto optimization, fastest-route baseline, and extra-time budget boundaries.

4. **Testing, Linting, & Build Verification:**
   - Full automated test suite passing (`npm test`).
   - TypeScript clean (`npx tsc --noEmit`).
   - ESLint clean (`npm run lint`).
   - Production build clean (`npm run build`).

## 2. Limitations & Operational Rules
- Sandbox runs without outbound network access. Do not attempt blocked remote network calls.
- Never fabricate data or infer surface from highway class; missing surfaces remain `unknown`.
- External maps are fallbacks; in-app routing remains primary.
- No commit, push, or deploy.

## 3. Acceptance Criteria
- Coverage quantified for all four corridors and expanded tile grid.
- Stress testing verifies bounded memory (< 30 MB isolate heap), zero leaks, and P95 latency < 15 ms.
- Dynamic cross-tile detour expansion proven safe under concurrent access.
- 100% test pass rate with zero regressions.
- Concise Italian summary report delivered with clear GO/NO-GO recommendation.
