# Lastrico — Phase 3.7 Execution Prompt: Geographic Coverage & Routing Robustness

## 1. Objective & Scope
1. **Corridor Coverage Measurement:**
   - Measure the exact coordinate bounds, total path distance, and missing coverage fraction outside the current Milan pilot bounding box (`[9.180, 45.455, 9.200, 45.475]`) for the four proposed test corridors:
     - `cadorna-darsena`
     - `moscova-porta-venezia`
     - `sempione-porta-romana`
     - `magenta-missori`
   - Quantify exact segment presence in both current clipped `milan-central.json` and the unclipped `data/sources/*.osm.json.gz` extracts.

2. **Reproducible Dataset Expansion Procedure:**
   - Account for sandbox network isolation (no internet / DNS resolution).
   - Provide an executable standalone script (`scripts/osm/download-western-tiles.mjs`) to fetch the exact missing western tiles (`w-sw: [9.169, 45.455, 9.180, 45.465]` and `w-nw: [9.169, 45.465, 9.180, 45.475]`) in a connected environment.
   - Enforce SHA-256 provenance tracking, strict OSM tag preservation, and uncompromised surface uncertainty semantics (never infer surfaces).

3. **Adversarial Routing & Heuristic Testing:**
   - Expand adversarial unit and regression test coverage for the 0.35x uncertainty heuristic with its `1.25 * paveSaved` cap in `lib/route-optimization.ts`:
     - Marginal / small pavé savings ($\le 5\text{ m}$) cannot justify disproportionate unknown detours.
     - Long unknown excursions ($> 1000\text{ m}$) are strictly penalized at 1.0x once the cap is exceeded, preventing false-safe detours.
     - Directional / modal restrictions and highway class validity remain strictly respected.
     - Route overlap and near-identical candidate diversity are handled deterministically without degradation.

4. **Benchmarking & Worker Constraints:**
   - Benchmark routing optimization against recorded Valhalla responses.
   - Verify Cloudflare Worker memory and payload constraints (bundle budget < 1 MB uncompressed, peak memory << 128 MB).
   - Full automated test suite passing, clean TypeScript, ESLint, and zero git diff check anomalies.

## 2. Limitations & Operational Rules
- Sandbox runs without outbound network access. No repeated network downloads will be attempted in the sandbox.
- Preserve honest product behavior: never infer surface from highway type or generic `paved`. Missing data remains `unknown`.
- External maps are fallbacks; in-app routing remains primary.
- No commit, push, or deploy.

## 3. Acceptance Criteria
- Exact corridor coverage metrics documented in `outputs/`.
- Standalone executable download script verified with `--help` / offline validation.
- Comprehensive adversarial tests passing in `tests/route-optimization.test.mjs`.
- Full test suite passing (`npm test`).
- Clean TypeScript (`npx tsc --noEmit --incremental false`) and ESLint (`npm run lint`).
- Concise Italian summary for the user.
