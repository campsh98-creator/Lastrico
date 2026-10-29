# Lastrico — Phase 3.5 Execution Prompt: Advanced Routing Intelligence

## 1. Objective & Scope
Advance Lastrico's routing intelligence and authentic OpenStreetMap (OSM) surface coverage for the Milan pilot through measurable, reproducible improvements:
1. **Parallel Read-Only Discovery (2 Subagents):**
   - **Agent A — OSM Intelligence:** Audit `scripts/osm/*`, `data/sources/*`, `data/surfaces/milan-central.json`, and benchmark/route corridors to identify high-value geographic or attribute gaps in the current pilot snapshot (`9.18–9.20 E, 45.455–45.475 N`), plan an incremental, reproducible OSM expansion with lossless source provenance and surface neutrality, and quantify coverage impact.
   - **Agent B — Routing Optimization:** Audit `lib/surface-aware-routing.ts`, `lib/route-optimization.ts`, `lib/route-candidates.ts`, `lib/routing-providers.ts`, `app/api/routes/route.ts`, and `outputs/phase32-benchmark/` to evaluate Valhalla `linear_cost_factors`, rough-slice extraction, multi-pass or adaptive penalty targeting, candidate diversity, and Pareto selection under conservative unknown-surface semantics.
2. **Centralized Implementation (Orchestrator):**
   - Consolidate verified findings from Agents A and B.
   - Implement only justified, measurable improvements in OSM coverage and routing optimization.
   - Preserve fastest-route baseline, Pareto dominance rules, mode-specific legal access, hard time budgets (`maxExtraMinutes`), live GPS navigation stability, and API/UI compatibility.
3. **Factorial Benchmark Evaluation:**
   - Benchmark representative Milan routes across `car`, `motorcycle`, and `bicycle`, isolating:
     1. **Old vs. New Routing Algorithm** on identical OSM data.
     2. **Old vs. Expanded OSM Coverage** using identical routing logic.
     3. **Combined Final Improvement** (New Algorithm + Expanded OSM Coverage).
   - Report known rough-surface exposure (`paveMeters`), known smooth exposure (`smoothSurfaceMeters`), unknown surface coverage (`unknownSurfaceMeters` / `%`), route diversity (`hasDistinctAlternative`, `distinctCandidates`), legal validity (`confirmedRestrictionMeters === 0`), and P50/P95 latency (explicitly separating offline replay from live capture measurements).

## 2. Limitations & Non-Goals
- **No Fabricated Data:** Never infer smooth or rough surfaces from highway class, `surface=paved`, or missing tags. Unknown segments remain `unknown`.
- **No Unnecessary Infrastructure:** Keep Cloudflare Worker / Next.js bundle sizes practical and respect public Overpass / Valhalla rate limits.
- **No Git Commit, Push, or Deploy:** Leave changes uncommitted in the working tree for review after passing all checks.

## 3. Acceptance Criteria & Validation
- Incremental OSM snapshot and manifest (`data/surfaces/milan-central.json`, `data/surfaces/milan-central.manifest.json`, `outputs/road-intelligence-quality-report.md`) are deterministically reproducible offline from archived source data in `data/sources/` with verified SHA-256 checksums.
- Routing algorithm changes demonstrably improve or preserve rough-surface avoidance and candidate diversity without violating hard time budgets or mode legality.
- Focused unit and integration tests added for any new routing or OSM logic.
- Full validation suite passes:
  - `npx tsc --noEmit --incremental false`
  - `npm run lint`
  - `npm test` (`vinext build` + `node --test tests/*.test.mjs`)
  - `git diff --check`
