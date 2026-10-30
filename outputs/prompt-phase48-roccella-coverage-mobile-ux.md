# Lastrico — Phase 4.8 Execution Prompt: Roccella Coverage & Mobile UX Excellence

## 1. Scope & Objectives

1. **Roccella Road Intelligence & Authentic Surface Enrichment:**
   - Investigate the raw OSM tags present in the Roccella extract (`data/sources/roccella-pilot-*.osm.json.gz` and `data/roccella-road-network.json`).
   - Identify verifiable tags that inform surface characteristics without fabricating data:
     - Explicit surface tags (`surface=*`).
     - Smoothness tags (`smoothness=*`).
     - Tracktype tags (`tracktype=*`).
     - Highway types and auxiliary attributes where OSM documentation defines standard physical characteristics (e.g. `steps`, `pedestrian` paved areas, cycle tracks, or unpaved tracks) while preserving strict provenance.
   - Refine the normalizer (`scripts/osm/build-roccella-pilot.mjs` or `scripts/osm/normalize.mjs`) to recover genuine surface signals.
   - Recompile `data/surfaces/roccella-pilot.json`, `data/surfaces/roccella-compact-tiles.json`, and update the manifest.
   - Measure known vs unknown coverage before and after on the entire network and specifically along the 3 pilot routes.

2. **Mobile UX & Responsive Polish:**
   - Audit layout across viewports: iPhone SE (375×667), standard iPhone (390×844), large iPhone (428×926), iPad / desktop.
   - Review HUD, bottom sheet states, `RouteComparisonPanel`, `LocalFieldFeedback`, and `NavigationDiagnosticsCard`.
   - Ensure maximum map visibility and clean information hierarchy (modern navigation app aesthetic).
   - Verify safe area insets (`env(safe-area-inset-bottom)`, `env(safe-area-inset-top)`), virtual keyboard handling (`interactive-widget=resizes-content`), and touch accessibility ($\ge 44\text{px}$).

3. **Validation & Integration:**
   - Verify multimodal routing (car, motorcycle, bicycle) on both Milan and Roccella.
   - Validate navigation simulation, rerouting, diagnostics, feedback, and JSON/CSV export.
   - Run focused regression tests, complete test suite, TypeScript, ESLint, and production build.

## 2. Invariants & Rules

- Strictly NO fabricated surface data. Never classify an unknown road as smooth without verifiable evidence.
- Strictly NO git commit, push, or deploy.
- Preserve all existing Phase 4.7 commits and capabilities.
- Maintain 100% test pass rate across the full suite.
