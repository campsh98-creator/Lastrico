# Lastrico Phase 3.1: Surface-Aware Routing PoC — Execution Plan

## 1. Scope & Objective

- **Goal:** Prove whether Road Intelligence data can directly influence Valhalla route generation (active cost modification) rather than merely scoring pre-generated candidates.
- **Hypothesis:** Valhalla's supported `linear_cost_factors` request parameter can apply cost penalties to rough-surface segments, directing the pathfinding algorithm to find smoother alternative paths natively.
- **Scope:**
  - Verify Valhalla provider capabilities on the existing FOSSGIS public endpoint (`https://valhalla1.openstreetmap.de/route`).
  - Implement an isolated, opt-in proof-of-concept (PoC) function that generates surface-penalized routes.
  - Keep default routing 100% intact and backward-compatible.
  - Measure travel time, geometry differences, pavé reduction, unknown surface coverage, and API latency across reproducible Milan test pairs.
  - Deliver measured findings, limitations, and a clear GO / NO-GO recommendation for Phase 3.2.

## 2. Technical Findings & Verification

1. **`avoid_bad_surfaces` in `costing_options` (Bicycle):**
   - Evaluated on FOSSGIS Valhalla with factors `0.0` to `1.0`.
   - Result: 0% effect on Milan urban cobblestone/sett routes. Valhalla treats historic urban stone paving as "paved", reserving `avoid_bad_surfaces` for unpaved dirt, gravel, and unpaved tracks. Ineffective for urban pavé avoidance.

2. **`avoid_locations`:**
   - Evaluated by injecting point coordinates along rough streets.
   - Result: In dense one-way urban grids, single-point exclusions often fail to redirect traffic or snap to wrong parallel edges.

3. **`linear_cost_factors` (Supported Provider Feature):**
   - Verified on FOSSGIS Valhalla v3.9.1.
   - Accepts arrays of `{ shape: string (polyline6), factor: number }`.
   - **Crucial limitation:** Requires precise edge-walking alignment with Valhalla's underlying graph. Arbitrary off-graph coordinates or broken sub-segments return `HTTP 400: Failed to edge walk line feature`.
   - **Empirical breakthrough:** When linear cost factors are derived from the maneuver shape geometries of the baseline route that intersect Lastrico's Road Intelligence rough surface segments, Valhalla achieves 100% edge-walk success (HTTP 200) and natively computes routes bypassing the penalized rough corridors!

## 3. Architecture & File Ownership

1. `lib/surface-aware-routing.ts` (New isolated PoC module):
   - `buildSurfaceAwareCandidate(baseRoute, surfaceScore, mode, options)`:
     - Identifies maneuvers on `baseRoute` with significant rough surface exposure (`paveMeters > 30`).
     - Constructs valid `linear_cost_factors` using the exact maneuver shape slices.
     - Calls Valhalla with `linear_cost_factors` to generate a candidate route.
     - Scores the candidate against `scoreRoadIntelligence`.
     - Validates that the candidate respects legal travel direction and mode constraints.
     - Returns candidate diagnostics (pave reduction, extra time, latency).
   - Fully opt-in, non-breaking, fails gracefully if Valhalla returns 400 or times out.

2. `app/api/routes/route.ts`:
   - Adds an opt-in parameter (e.g., `poc=surface-aware` or `direct=1`) or test flag for isolated evaluation.
   - Production default remains completely untouched.

3. `tests/surface-aware-routing.test.mjs`:
   - Unit and integration tests for `linear_cost_factors` construction, error handling, budget enforcement, and fallback safety.

## 4. Acceptance Criteria & Release Conditions

- Default routing behavior, timings, and candidate selection are 100% preserved.
- No paid services, no local Valhalla installation, and no external dependencies introduced.
- Measured before/after metrics on at least 3 representative Milan routes.
- Full test suite passing (`npm test`, `npm run lint`, `npx tsc --noEmit`).
- No commits, pushes, or deployments.
