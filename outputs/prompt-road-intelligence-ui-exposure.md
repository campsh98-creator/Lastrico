# Lastrico Phase 2: Road Intelligence UI Exposure — Execution Prompt

## 1. Scope and Authority

- **Feature:** Expose Phase 2 Road Intelligence metrics in Lastrico's iPhone PWA route details UI.
- **Audience:** Milan cyclists, motorcyclists, and motorists testing Lastrico on mobile Safari and installed PWA.
- **Language:** Italian, clear, concise, and nontechnical.
- **Target Metrics:**
  1. *Known Smooth Surface (Fondo liscio noto):* distance and percentage of route on confirmed smooth surfaces (asphalt, concrete).
  2. *Known Rough Surface (Fondo sconnesso noto / pavé):* distance and percentage of route on confirmed or probable rough surfaces (sett, cobblestone, paving stones).
  3. *Unknown Surface (Fondo non verificato / sconosciuto):* distance and percentage of route lacking direct surface tags in OpenStreetMap.
  4. *Cycling Infrastructure (Infrastruttura ciclabile):* distance in meters/kilometers of dedicated or segregated cycling facilities (`cyclewayMeters`), displayed when relevant (especially in bicycle mode or where facilities exist).
- **Invariants & Safeguards:**
  - *Honesty:* Never imply that unknown roads are safe, smooth, or pavé-free.
  - *Disclaimers:* Explicit micro-copy stating that unclassified segments have unverified surfaces.
  - *No algorithm changes:* Do not modify routing algorithms, candidate generation, or backend scoring.
  - *No workflow changes:* Preserve GPS navigation, simulation, voice guidance, and off-route recalculation.
  - *Git hygiene:* Do not commit, push, or deploy. Work remains strictly local.

## 2. Technical Design & Architecture

### A. TypeScript Interface Alignment
- Update `RouteResult` in `app/page.tsx`:
  - `smoothSurfaceMeters?: number`
  - `cyclewayMeters?: number`
  - `unknownSurfaceMeters?: number`
  - `surfaceCoveragePercent?: number`
  - `confirmedPaveMeters?: number`
  - `probablePaveMeters?: number`
- Ensure demo fallback `route(...)` computes deterministic smooth, pave, and unknown values so the UI is fully functional in both demo and live OSM modes.

### B. UI Component: Road Intelligence Breakdown (`surface-breakdown`)
- Placed in `routes-panel` beneath the route selector and impact strip.
- Rendered for the currently selected route (`selectedRoute = activeRoute === "safe" ? safeRoute : fastRoute`).
- Visual layout:
  - 3-column / responsive grid using Lastrico design tokens (`var(--surface)`, `var(--border)`, `var(--metric-value)`, `var(--metric-label)`).
  - Metrics shown:
    - **Liscio (asfalto)**: distance (km/m) + percentage.
    - **Sconnesso (pavé)**: distance (km/m) + percentage.
    - **Non verificato**: distance (km/m) + percentage.
  - When `selectedRoute.cyclewayMeters > 0` or in bicycle mode:
    - Dedicated badge / row: **Ciclabile**: distance (km/m) of dedicated or segregated cycling path.
  - Micro-disclaimer:
    *"Tratti non verificati: assenza di dati OSM, fondo non garantito."*

### C. Styling & Contrast Requirements
- Fully responsive on iPhone screens (down to 320px width).
- Tested against WCAG AA color contrast (>= 4.5:1) in both light mode and dark mode (`data-theme="dark"`).
- Reuses semantic CSS variables already in `app/globals.css`.

## 3. Acceptance Criteria

1. Route details panel renders known smooth surface with distance and percentage.
2. Route details panel renders known rough surface with distance and percentage.
3. Route details panel renders unknown surface with distance, percentage, and explicit unverified surface disclaimer.
4. Cycling infrastructure distance is surfaced when present or in bicycle mode.
5. Zero known pavé is NEVER presented as 100% smooth or 100% safe.
6. The interface is clean, uncluttered, and mobile-first, adhering to existing iPhone PWA design patterns.
7. Existing navigation, voice guidance, and routing logic remain 100% intact.
8. `npm run lint`, `npx tsc --noEmit`, and `npm test` pass with 0 errors and all regressions guarded.

## 4. Verification & Testing

- Automated UI unit tests in `tests/rendered-html.test.mjs` verifying:
  - Presence of road intelligence metrics in the routes panel.
  - Surface breakdown labels in Italian (`Fondo liscio`, `Pavé`, `Non verificato`, `Ciclabile`).
  - Presence of the unverified surface disclaimer.
  - WCAG AA contrast compliance across light and dark modes in `tests/dark-mode-contrast.test.mjs`.
- End-to-end build test via `npm test` and `npm run build`.
