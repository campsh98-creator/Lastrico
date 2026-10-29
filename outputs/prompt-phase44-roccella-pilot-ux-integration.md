# Lastrico — Phase 4.4 Execution Prompt: Roccella Pilot Completion & UX Integration

## 1. Scope & Objectives

1. **Roccella Pilot Verification & Completion:**
   - Verify authentic OSM coverage, road network segments, and compact tile compilation for Roccella Ionica (`data/roccella-road-network.json`, `data/surfaces/roccella-compact-tiles.json`).
   - Validate routing for car, motorcycle, and bicycle in Roccella Ionica with authentic surface classifications (asphalt, paving stones, unpaved).
   - Ensure area isolation between Milan and Roccella: disjoint bounds, independent caches, and cross-area routing rejection.
   - Verify area switching in the mobile UI, geocoding bounded to Roccella, and GPS positioning within Roccella bounds.

2. **Phase 4.3 Component Integration (`app/page.tsx`):**
   - Import `components/phase43/phase43.css` and components: `RouteComparisonPanel`, `LocalFieldFeedback`, `NavigationDiagnosticsCard`.
   - **`RouteComparisonPanel`**:
     - Integrate into the routes panel (`activePanel === "routes"`).
     - Display authentic trade-offs: meters of pavé avoided, percentage reduction, extra travel time, and unknown-surface percentage.
     - Display the honest "no distinct alternative" message when no alternative satisfies Pareto constraints.
     - Allow seamless route selection switching (`fast` vs `safe`) synced with map polyline rendering.
   - **`LocalFieldFeedback`**:
     - Integrate as an accessible modal dialog accessible across both Milan and Roccella.
     - Provide a dedicated button in the header/app bar or navigation bar to open field feedback for testers.
     - Capture current coordinates when available and persist feedback locally in `localStorage` without backend dependency or OSM mutation.
   - **`NavigationDiagnosticsCard`**:
     - Integrate into the navigation HUD / routes view during active journey (or testable diagnostic drawer).
     - Reflect real session counters: accepted/rejected fixes, off-route events, reroute attempts/successes, signal loss, WakeLock state, and rejection reasons.
     - Expose the ephemeral privacy assurance indicator.

3. **Behavioral & Mobile Validation:**
   - Real API integration: verify real routes calculated in Roccella and Milan pass valid surface metrics to `RouteComparisonPanel`.
   - Touch targets and responsive layout: verify all new UI controls adhere to $\ge 44\text{px}$ touch targets and 16px input font size at iPhone viewport (390×844).
   - Zero horizontal scroll overflow across both Milan and Roccella views.

4. **Regressions & Quality Standards:**
   - Full test suite passes 100%.
   - TypeScript compiles with 0 errors (`npx tsc --noEmit`).
   - ESLint passes with 0 warnings/errors (`npm run lint`).
   - Production build compiles cleanly (`npm run build`).

## 2. Limitations & Boundary Rules

- **Zero Git Commits, Pushes, or Deploys.**
- **Preserve Existing Improvements:** Do not reset or regress Phase 3/4.1 Milan routing, spatial store tiles, or GPS navigation.
- **Do Not Recreate Phase 4.3:** Reuse `components/phase43/` and `phase43.css` directly as written.
- **Honest Product Behavior:** No fake metrics, mock routes, or visual toggles that do not affect functionality.

## 3. Test & Verification Plan

- Run unit and integration tests:
  - `tests/pilot-areas.test.mjs`
  - `tests/roccella-data.test.mjs`
  - `tests/roccella-navigation.test.mjs`
  - `tests/phase43-ux-feedback.test.mjs`
- Mobile viewport & headless Chrome test:
  - Extend mobile testing to verify both Milan and Roccella with integrated Phase 4.3 components.
- Full project test suite:
  - `npm test`
- Build and static analysis:
  - `npx tsc --noEmit`
  - `npm run lint`
  - `npm run build`
