# Lastrico — Phase 4.12 Execution Prompt: Route Intelligence, UI Simplification & Final Integration

## 1. Context and Baseline Checkpoint

- Canonical verified baseline: commit `19d211a7401308ca1e2925c77bdf518d398ab6a0` on branch `fix/mobile-navigation-stability`.
- GitHub `origin/main` and `origin/fix/mobile-navigation-stability` are fully synchronized at `19d211a`.
- Automated test baseline: 319 / 319 passing tests, 0 lint errors, 0 type errors, clean production build.
- Working tree: clean. Motia isolated on its own branch.

## 2. Problem Register & Investigation Targets

1. **Surface Inconsistency Investigation (Largo Promessi Sposi / Porta Romana)**:
   - Reported issue: Route displays 32 m pavé, 643 m smooth, 85% unknown surface, and no anti-pavé alternative.
   - Exact coordinates reproduced: Porta Romana `[9.202056, 45.4522392]` to Largo Promessi Sposi `[9.1734728, 45.4349746]` in car mode.
   - Fast route metrics: distance 4,501 m, 32 m pavé, 643 m smooth, 3,826 m unknown surface (85.0% unknown).
   - Root cause: Bundled compact spatial tiles (`milan-compact-tiles.json`) cover central Milan (`lat 45.450 - 45.480`, `lon 9.169 - 9.206`). Largo Promessi Sposi (`lat 45.435`) lies in Municipio 5, south of the inner ring, outside the bundled tiles.
   - Mathematical consistency: 32 m pavé (0.7%) + 643 m smooth (14.3%) + 3,826 m unknown (85.0%) = 4,501 m (100.0%). The mathematical breakdown is strictly consistent.
   - Core principle: Unknown roads must never be fabricated as smooth.

2. **Missing Route Alternatives Investigation**:
   - Fast baseline already has only 32 m of cobblestone out of 4,511 m (99.3% pavé-free).
   - Candidate `detour-1` reduces cobblestone by 18 m (from 32 m to 14 m), which is below `policy.minimumPaveReduction = 20 m` for car mode.
   - In addition, `detour-1` traverses 4,006 m of unknown roads (+180 m vs fast). Under Lastrico's conservative Pareto model, swapping 18 m of known stone for 180 m of unverified roads adds uncertainty burden.
   - Other candidates have significantly more cobblestone (86 m to 416 m).
   - The absence of an alternative is mathematically and logically correct according to conservative routing rules.

3. **UI Simplification & Clutter Removal**:
   - Current user interface exposes internal diagnostics, technical OSM jargon (`archivio OSM locale`, `copertura OSM critica`), and repetitive card labels.
   - Route panel must be simplified to present consumer-ready metrics: Travel time, distance, Pavé (m), Liscio (m), Pavé evitato (m and % when distinct alternative exists).
   - Human-friendly notice when no alternative exists: clear explanation without technical jargon.
   - Primary action must be prominent: **Avvia navigazione**.
   - Keep internal scoring and debug diagnostics accessible for developers/diagnostics without polluting the primary consumer flow.

## 3. Scope & Modifications

1. `components/phase43/RouteComparisonPanel.tsx`:
   - Simplify user-facing text and hierarchy.
   - Show travel time, distance, Pavé (m), Liscio (m).
   - When alternative exists, show prominent "Pavé evitato" badge with reduction % and extra time.
   - When no alternative exists, show concise human-friendly explanation ("Il percorso rapido è già ottimale per il fondo stradale").
   - Replace technical badges with clear, subtle status indicators.
   - Keep testids (`p43-route-comparison`, `p43-card-safe`, `p43-card-fast`, `p43-tradeoff-banner`, etc.) intact for backward test compatibility.
2. `components/phase43/phase43.css`:
   - Refine spacing, typography, contrast, and touch target sizes (>= 44px).
   - Ensure clean dark/light theme tokens and mobile viewport safety.
3. `app/page.tsx`:
   - Update primary action label to **Avvia navigazione** with accessible subtext.
   - Clean up default view so developer notes (`dataNotice` with OSM terminology) are confined to details / diagnostics disclosures.
4. `tests/`:
   - Add targeted regression test verifying the Largo Promessi Sposi / Porta Romana route behavior.
   - Verify all 319 unit tests, E2E acceptance scenarios, lint, typecheck, and build pass cleanly.

## 4. Limitations & Boundaries

- No modifications to Motia.
- No push, PR, merge, or production deployment.
- Maintain honest surface classifications: unknown remains unknown.
- Preserve existing Pareto optimizer, modal profile restrictions, and Valhalla/OSRM routing contracts.

## 5. Acceptance Criteria

- [ ] Largo Promessi Sposi / Porta Romana route reproduced and verified with exact root-cause documented.
- [ ] Mathematical consistency verified across all surface categories.
- [ ] Route selection UI simplified: clean cards, pavé/liscio meters, prominent "Avvia navigazione".
- [ ] Technical jargon and developer diagnostics removed from default route view.
- [ ] 319/319 unit tests pass.
- [ ] E2E browser flows pass for Milan and Roccella across Car, Motorcycle, Bicycle.
- [ ] Zero TypeScript errors, zero ESLint warnings, production build succeeds.
