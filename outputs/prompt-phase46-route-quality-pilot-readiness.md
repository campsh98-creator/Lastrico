# Lastrico — Phase 4.6 Execution Prompt: Route Quality & Pilot Readiness

## 1. Scope & Objectives

1. **Route Quality Transparency (`RouteComparisonPanel`):**
   - Reuse existing Road Intelligence surface scoring to clearly differentiate:
     - Confirmed rough surfaces (pavé, ciottoli, masselli, pietre squadrate).
     - Confirmed smooth surfaces (asfalto, calcestruzzo).
     - Unknown coverage (strade prive di tag `surface` su OpenStreetMap).
   - Display a clear **Selection Rationale** explaining *why* an alternative was selected or why no alternative is available (e.g. pavé reduction percentage, travel time delta within budget, or baseline fastest route).
   - Explicitly flag routes with high unknown surface exposure ($\ge 25\%$ or $\ge 50\%$) with an honest advisory notice stating that unclassified OSM roads are not assumed to be smooth or safe.

2. **Reproducible Pilot Journeys (Milan & Roccella Ionica):**
   - Define a curated set of verified pilot journeys for both pilot areas:
     - **Milano**:
       - *Pilota 1 (Centro Storico / Pavé test)*: Brera $\to$ Santa Sofia (confronto pavé Corso Italia/Torino vs alternative lisce).
       - *Pilota 2 (Arco della Pace / Parco Sempione)*: Castello Sforzesco $\to$ Porta Garibaldi / Porta Venezia.
       - *Pilota 3 (Navigli / Sud)*: Missori $\to$ Darsena.
     - **Roccella Ionica**:
       - *Pilota 1 (Borgo Storico $\to$ Marina)*: Castello Carafa / Via Città $\to$ Lungomare Sisinio Zito.
       - *Pilota 2 (Costiero Nord $\to$ Sud)*: Via Cavone $\to$ Lungomare Sisinio Zito.
       - *Pilota 3 (Centro Cittadino)*: Piazza San Vittorio $\to$ Via Giuseppe Garibaldi.
   - For all 3 modes: Auto (`car`), Moto (`motorcycle`), Bici (`bicycle`).
   - Provide easy, 1-tap quick-selection chips in the planner UI for rapid, deterministic field testing.

3. **End-to-End Mobile Flow Verification:**
   - Route planning (via preset chips or geocoding).
   - Alternative selection (`fast` vs `safe`) updating the route map and metrics.
   - Navigation start and simulated guidance session.
   - Local field feedback modal with pre-populated route and area context.
   - History review, individual item deletion, and formula-safe JSON/CSV export.
   - Real-time navigation diagnostics counter and privacy indicator.

4. **Quality & Release Criteria:**
   - 100% test pass rate across unit, integration, and Chrome mobile viewport tests.
   - TypeScript compiles cleanly with 0 errors (`npx tsc --noEmit`).
   - ESLint passes cleanly with 0 errors and 0 warnings (`npm run lint`).
   - Production build succeeds without errors (`npm run build`).
   - No Git commit, push, or deploy.

## 2. Boundaries & Invariants

- **Preserve Legal Routing & Pareto Invariants**: Do not relax one-way, turn restrictions, or extra time budgets.
- **Strict Surface Honesty**: Never classify unknown surface roads as smooth, asphalted, or safe.
- **Zero Backend / Telemetry**: Maintain complete client-side privacy with `localStorage` and `Blob` downloads.
- **No Broad Refactoring**: Minimal surgical updates to existing components (`RouteComparisonPanel.tsx`, `phase43.css`, `app/page.tsx`).

## 3. Test & Verification Plan

- Unit & integration tests:
  - `tests/phase46-route-quality-pilot.test.mjs` verifying selection rationale strings, unknown surface badges, pilot journey presets, and multi-modal route responses.
  - Full project test suite: `npm test` (all 250+ tests).
  - Headless Chrome testing at mobile iPhone resolution (390×844) verifying touch targets ($\ge 44\text{px}$) and zero overflow.
