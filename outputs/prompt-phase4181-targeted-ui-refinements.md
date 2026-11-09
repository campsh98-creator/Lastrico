# Lastrico — Phase 4.18.1 Execution Prompt: Targeted UI Refinements

## 1. Scope & Objectives
Address specific feedback from the independent review (rating 7/10) to bring Lastrico's Premium UI 2.0 to 9+/10 production excellence through targeted, verified refinements without redesigning core components:
1. **Fix P1 Landscape Map Hiding**:
   - In `app/globals.css`, resolve the conflict where `@media (max-width: 760px) and (max-height: 560px)` unconditionally hides `.map-stage` via `visibility: hidden;`.
   - Restore full map visibility in phone landscape mode (e.g. 667×375 for iPhone SE, 844×390 for iPhone 13/14) while preserving compatibility with `tests/rendered-html.test.mjs`.
   - Ensure the map and `.control-panel` coexist cleanly side-by-side in landscape.
2. **Validate & Fix Layout Clipping / Overflow**:
   - Inspect rendered components: `.p43-route-card`, `.p43-tradeoff-banner`, `.p43-breakdown-row`, `.navigation-hud`, `.trip-metric`.
   - Apply robust CSS defenses (`min-width: 0`, proper flex shrink, grid wrapping) to prevent ellipsis truncation or edge clipping on narrow viewports (350px - 390px).
3. **Typography Readability & Touch Target Compliance**:
   - Upgrade secondary labels and metrics from 10.5–11px to 12–14px where space permits.
   - Maintain 44px (`var(--tap)`) minimum touch target height across all interactive elements (buttons, selectors, disclosures), including landscape media queries where 40px was previously used.
   - Maintain full WCAG AA contrast, focus outlines, safe-area insets, and reduced-motion support.
4. **Visual & Browser Verification**:
   - Start the real application with authentic styles and MapLibre.
   - Capture side-by-side screenshots for both themes (Asphalt Yellow & Urban Light) across:
     * iPhone Portrait (390×844)
     * Compact iPhone (375×667)
     * iPhone Landscape (667×375 & 844×390)
     * Address Autocomplete with suggestions
     * Route Comparison Cards
     * Active Navigation HUD
     * Desktop (1200×800)

## 2. Limitations & Boundaries
- No backend API changes, no routing algorithm alterations, no changes to Valhalla or OSM datasets.
- No changes to existing test contracts in `tests/rendered-html.test.mjs` (keep required regex patterns intact).
- Preserve concurrent work and experimental files (`experiments/`, `outputs/phase417/`, `outputs/prompt-phase417-surface-ml.md`, `outputs/prompt-phase420-research-lab.md`).
- No Git commits, branch creation, pushing, or remote deployment in this phase.

## 3. Acceptance Criteria
- `.map-stage` is visibly rendered with positive dimensions in landscape at 667×375 and 844×390.
- All interactive buttons meet ≥ 44×44px touch target guidelines.
- Zero horizontal overflow or clipped text in route comparison cards or navigation HUD.
- Secondary typography is ≥ 12px for readable metrics and labels.
- 100% of the automated test suite passes (326/326 tests).
- Clean TypeScript check (`tsc --noEmit`) and lint.
- High-fidelity screenshots captured and saved to `outputs/phase4181-ui-artifacts/`.

## 4. Verification & Test Plan
- Run `node --test tests/*.test.mjs` to ensure zero regressions across all 326 tests.
- Run `npx tsc --noEmit --incremental false` for static typing.
- Run `npm run lint` for code quality.
- Execute headless Chrome verification script with actual CSS and MapLibre assets to capture artifacts and measure element geometries (bounding boxes, computed visibility).
