# Lastrico — Phase 3.6 Execution Prompt: Geographic Expansion & Routing Validation

## 1. Objective & Scope
1. **Parallel Read-Only Audits (2 Subagents):**
   - **Agent A — Geographic Coverage:**
     - Assess the western Milan blind spot (Cadorna, Carducci, De Amicis, Cerchia dei Navigli) and evaluate the smallest reliable, reproducible OSM extraction approach.
     - Evaluate offline tile/way retention options versus incremental download parameters.
     - Preserve genuine OSM tag provenance, modal restrictions, and honest unknown surface representation without fabrication.
   - **Agent B — Routing Validation:**
     - Review the 0.35x uncertainty heuristic in `lib/route-optimization.ts` to identify any edge cases or potential false-safe selections.
     - Design diverse validation routes beyond the 3 existing central corridors (e.g. western bypasses, longer trips across the Cerchia dei Bastioni, cross-district routes) across `car`, `motorcycle`, and `bicycle`.
     - Evaluate candidate legality, Pareto trade-offs, latency, and candidate diversity.
2. **Centralized Implementation (Orchestrator):**
   - Consolidate findings and implement justified improvements centrally.
   - Expand local OSM coverage incrementally and deterministically with full provenance and integrity checks.
   - Validate the uncertainty heuristic against the conservative selector on identical datasets.
   - Conduct 4-way ablation benchmarking (Old vs. New Algorithm $\times$ Old vs. New Dataset) and measure surface exposure, uncertainty, legality, candidate diversity, and P50/P95 latency.
   - Run focused regression tests, TypeScript, ESLint, build, and diff checks.

## 2. Limitations & Operational Rules
- Preserve honest product behavior: never infer surface from highway class or generic `paved`. Missing data remains `unknown`.
- If network access is restricted in the sandbox, execute verifiable offline dataset improvements and document remaining live download requirements.
- No commit, push, or deploy.

## 3. Acceptance Criteria
- Full test suite passing (`npm test`, 187+ tests).
- Clean TypeScript compilation (`npx tsc --noEmit --incremental false`) and ESLint (`npm run lint`).
- Documented benchmark comparison isolating algorithmic versus data-driven improvements.
