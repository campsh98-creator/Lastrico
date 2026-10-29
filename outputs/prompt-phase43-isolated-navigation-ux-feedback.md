# Lastrico — Phase 4.3 Execution Prompt: Isolated Navigation UX & Feedback

## 1. Scope & Purpose

Develop isolated, modular, and reusable mobile UI components for Phase 4.3 in `components/phase43/` without modifying any shared files while Codex is actively working on Phase 4.2:
1. **Route Comparison Component (`RouteComparisonPanel.tsx`):**
   - Explicitly compares fastest route baseline vs anti-pavé alternative.
   - Highlights actual pavé reduction (absolute meters and percentage).
   - Clarifies extra time trade-off and minutes added.
   - Transparently exposes unknown/unmapped surface meters on both options.
   - Distinct state when no alternative meets Pareto constraints.

2. **Local Field Feedback Component (`LocalFieldFeedback.tsx`):**
   - Allows testers to record field observations on surface accuracy (unmapped cobblestone, newly asphalted, hazardous surface) and navigation issues (incorrect maneuver, blocked road, GPS mismatch).
   - Operates strictly client-side via `localStorage` without backend dependency or mutating OSM data.
   - Provides local inspection/export for QA logs.

3. **Privacy-Safe Navigation Diagnostics Component (`NavigationDiagnosticsCard.tsx`):**
   - Visualizes existing session diagnostic counters (`NavigationDiagnostics` from `lib/navigation-state.ts`).
   - Categorizes GPS signal quality (accepted vs rejected fixes, rejection reasons), reroute resilience, and signal loss.
   - Preserves strict privacy: no GPS trace or personal identifier is stored or transmitted.

4. **Phase 4.3 Component Styles (`components/phase43/phase43.css` or scoped styling):**
   - Independent stylesheet strictly within `components/phase43/` to avoid editing shared `app/globals.css`.
   - Adheres to $\ge 44\text{px}$ touch target standards, 16px input font sizes, and dark/light mode token compatibility.

## 2. Limitations & Boundary Rules

- **Zero Modifications to Shared Code:** Do not edit `app/page.tsx`, `app/globals.css`, `app/api/*`, `lib/*`, `data/*`.
- **Zero Backend/OSM Writes:** Field feedback is purely stored locally in `localStorage`.
- **Independent Validation:** Tests reside in `tests/phase43-ux-feedback.test.mjs` and execute without touching global build or git state.
- **No Git Commit, Push or Deploy.**

## 3. Acceptance Criteria

- All three components are exported from `components/phase43/index.ts`.
- Component props accept types compatible with existing Lastrico data models (`RouteResult`, `SurfaceMetrics`, `NavigationDiagnostics`, `TransportMode`).
- Mobile touch targets meet Apple HIG ($\ge 44\text{px}$).
- Accessibility: ARIA roles, labels, live regions, and contrast are properly implemented.
- Focused test suite in `tests/phase43-ux-feedback.test.mjs` passes 100%.

## 4. Test & Verification Plan

- Unit & rendering tests for `RouteComparisonPanel`:
  - Accurate metric comparison (meters saved, % reduction, time difference).
  - Unknown surface exposure transparency.
  - "No alternative" state rendering.
- Unit & interaction tests for `LocalFieldFeedback`:
  - Recording surface and navigation feedback to `localStorage`.
  - Retrieving and clearing local feedback.
  - Validation of coordinates and feedback kind.
- Unit & rendering tests for `NavigationDiagnosticsCard`:
  - Formatted counts for GPS fixes, rejections, reroutes, and signal loss.
  - Explicit privacy assurance indicator.
- Component styling & touch target size verification in headless Chrome.
