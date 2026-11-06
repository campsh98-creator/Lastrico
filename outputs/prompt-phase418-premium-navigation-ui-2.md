# Lastrico — Phase 4.18 Execution Prompt: Premium Navigation UI 2.0

## 1. Context and Objective

- **Baseline**: Branch `fix/mobile-navigation-stability`, commit `9225730` (326 passing automated tests).
- **Goal**: Upgrade Lastrico's user interface into a minimalist, premium black-and-yellow navigation experience across two coherent themes:
  - **Night — Asphalt Yellow**: Deep graphite/near-black backgrounds (`#0b1214`, `#10191c`, `#152225`), vibrant navigation yellow (`#f59e0b`, `#fbbf24`), crisp white typography, dark readable map.
  - **Day — Urban Light**: Warm off-white paper and surfaces (`#faf8f5`, `#ffffff`, `#f3efe6`), charcoal typography (`#131e20`), accessible amber/ochre accents (`#92400e`, `#b45309`), clean bright map.
- Both themes must feel like the exact same product, unified by typographic structure, spacing rhythm, icon language, and interactive affordances.

## 2. Scope & Implementation Plan

1. **Design Tokens & Theme System (`app/globals.css`)**:
   - Refine color tokens for `:root` (Day / Urban Light) and `:root[data-theme="dark"]` (Night / Asphalt Yellow).
   - Maintain 100% compliance with `tests/dark-mode-contrast.test.mjs` (WCAG AA ≥ 4.5:1 contrast on all semantic foreground/background pairs).
   - Ensure clean elevations, subtle shadows, refined radii, and sleek glassmorphism/solid surfaces.
2. **Floating Search & Planner Controls (`app/page.tsx`, `app/globals.css`)**:
   - Modernize the floating search card: refined origin/destination indicators, swap button, input padding, and one-tap suggestion dropdowns.
   - Refine mode selector (Auto / Moto / Bici) and pilot journey chips.
3. **Route Comparison Panel (`components/phase43/RouteComparisonPanel.tsx`, `components/phase43/phase43.css`)**:
   - Distinctive anti-pavé route card highlighting without diminishing the fastest route.
   - Clear and compact presentation: travel time, distance, confirmed pavé, confirmed smooth surface, and genuine pavé savings.
   - Streamlined tradeoff banner and uncertainty notices.
4. **Navigation HUD & Trip Bar (`app/page.tsx`, `app/globals.css`)**:
   - Prominent next-maneuver card with large readable direction glyph, distance in bold tabular digits, and clear street name.
   - Modernized trip bar: remaining travel time, arrival ETA, remaining distance, and prominent stop button.
5. **Responsive & A11y Polish**:
   - Small iPhones (≤350px width): compact text and buttons without clipping.
   - Standard iPhones (375x812, 390x844): comfortable 44px+ tap targets and safe-area margins.
   - Landscape mobile (height ≤500px): split view with dominant map.
   - Desktop/tablet (≥768px): elegant floating sidebar.
   - `prefers-reduced-motion: reduce` respect.

## 3. Limitations & Constraints

- Strictly preserve all routing calculations, Pareto logic, Valhalla/OSRM integration, and GPS navigation mechanics.
- Never invent pavement classifications or claim unverified surfaces are confirmed smooth.
- Do not alter or revert Codex's concurrent work (`outputs/prompt-phase417-surface-ml.md`, `experiments/`).
- Do not commit, push to remote, or deploy to Cloudflare.
- Keep all existing test IDs and selector contracts required by regression tests.

## 4. Acceptance Criteria

- [ ] All 326+ automated tests pass (`npm test`).
- [ ] TypeScript check (`npx tsc --noEmit`) passes with 0 errors.
- [ ] ESLint check (`npm run lint`) passes with 0 errors.
- [ ] Production build (`vinext build`) completes successfully.
- [ ] WCAG AA contrast compliance verified in both Day and Night modes.
- [ ] 44px minimum touch targets verified across all interactive controls.
- [ ] Before & After visual comparison documented with screenshots.
- [ ] Concise report in Italian summarizing changes and readiness.
