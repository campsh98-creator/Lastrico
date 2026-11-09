# Lastrico — Phase 4.13 Execution Prompt: UI Excellence & Milan Road Coverage

## 1. Context & Baseline

- **Repository**: `/Users/campsh/Documents/Codex/Lastrico-App-Anti-Pave` on branch `fix/mobile-navigation-stability` (baseline commit `19d211a` + Phase 4.12 updates).
- **Current Milan Coverage**:
  - 23 compact tiles (`0.01° × 0.01°`) covering `9.169°E – 9.206°E`, `45.450°N – 45.480°N`.
  - 37,844 total segments in `data/surfaces/milan-compact-tiles.json` (5.51 MB raw JSON).
  - Routes extending into southern Milan (e.g., Porta Romana `[9.202056, 45.4522392]` → Largo Promessi Sposi `[9.1734728, 45.4349746]`) exit the southern boundary (`45.450°N`) after ~675 m, leaving 3,826 m (85%) outside tile coverage.
- **Current UI State**:
  - `RouteComparisonPanel.tsx`, `SurfaceBreakdown.tsx`, and `app/page.tsx` still expose developer-oriented strings (`Copertura OSM critica`, `Motivo selezione`, `Non censito: X (Y%)`, `Fondo non censito: X (Y%)`, `archivio OSM locale`) in the default route comparison view.

## 2. Scope & Objectives

### Objective 1: UI/UX — Clean, Consumer-Ready Layout & Responsive Polish
1. **Default Route Comparison & Selection (`RouteComparisonPanel.tsx`, `phase43.css`, `app/page.tsx`, `app/globals.css`)**:
   - Keep the map prominent and route cards scannable at a glance.
   - Show only essential consumer metrics by default on each route card:
     - Travel time (`min`)
     - Distance (`km`)
     - Pavé meters (`Pavé: X m`)
     - Smooth road meters (`Liscio: Y m / km`)
     - Actual pavé savings (`-X m` / `-Y%`) and extra time (`+Z min`) when a distinct anti-pavé alternative exists.
   - When no distinct alternative exists, display a single, concise, human-friendly notice explaining that the fastest route is already optimal within the time budget.
   - Remove technical wording, redundant explanations, coverage percentages, internal scoring, and developer-style diagnostics from the primary interface (`Motivo selezione`, duplicate unknown rows, `OSM` acronyms, raw percentage badges).
   - Keep advanced technical details (unknown surface meters/percentages, OSM coverage badges, selection rationale, data provenance notice, GPS trace & navigation diagnostics) strictly inside the secondary collapsible diagnostics view (`Dettagli tecnici e diagnostica`).
   - Preserve honest surface uncertainty: never present unknown roads as smooth; when unknown surfaces materially affect route reliability (> 25% of route), display one short, clear, plain-Italian caution (`Alcuni tratti non hanno dati sul fondo stradale e potrebbero includere pavé`).
   - Keep **"Avvia navigazione"** prominent, full-width, and unmistakably primary (`>= 48px` height), visually separated from secondary actions (`Simula percorso`, `Apri in mappe`).
2. **Layout, Theme & Viewport Excellence**:
   - Verify and fix spacing, typography, bottom-sheet scroll behavior, safe-area insets (`env(safe-area-inset-bottom)`), and control positioning across:
     - Small iPhone (`320×568`, `375×667`)
     - Modern iPhone (`390×844`, `428×926`)
     - Landscape mobile (`844×390`, `667×375`)
     - Tablet (`768×1024`) and Desktop (`1280×800`)
   - Verify both Light and Dark themes (`color-scheme: light dark`, proper contrast, dimmed dark-mode map tiles and buildings).

### Objective 2: Milan — Citywide Authentic OSM Road-Surface Expansion
1. **Geographic Gap Analysis & Tile Grid Expansion**:
   - Current coverage: `lon 9.169–9.206`, `lat 45.450–45.480` (23 tiles).
   - Expand authentic OpenStreetMap highway coverage across urban Milan (`lon 9.11–9.26`, `lat 45.42–45.51`), specifically covering:
     - **Southern Milan (Priority)**: Porta Romana, Bocconi, Ravizza, Viale Tibaldi, Viale Liguria, Naviglio Pavese, Largo Promessi Sposi, Famagosta, Ripamonti, Vigentino, Corvetto, Brenta, Lodi (`lat 45.420–45.455`, `lon 9.150–9.230`).
     - **Western & South-Western Corridors**: Porta Genova, Tortona, Solari, Giambellino, Lorenteggio, Bande Nere, De Angeli, Wagner, San Siro/Lotto (`lon 9.120–9.175`, `lat 45.440–45.485`).
     - **Northern & North-Western Corridors**: Arco della Pace, Sempione, Bullona, Cenisio, Bovisa, Maciachini, Isola, Porta Garibaldi, Centrale, Melchiorre Gioia, Greco/Bicocca (`lat 45.475–45.510`, `lon 9.140–9.220`).
     - **Eastern & South-Eastern Corridors**: Porta Venezia, Corso Buenos Aires, Loreto, Città Studi, Lambrate, Argonne, Dateo, Corso XXII Marzo, Linate/Forlanini (`lon 9.200–9.260`, `lat 45.450–45.495`).
2. **Authentic Data Acquisition & Provenance**:
   - Fetch authentic OpenStreetMap highway ways (`highway=*`) with full node coordinates and tags (`surface`, `smoothness`, `highway`, `oneway`, `access`, `bicycle`, `motor_vehicle`, `motorcycle`, `cycleway*`, `tram`, `embedded_rails`, `name`, `layer`, `bridge`, `tunnel`) from public OSM/Overpass APIs under ODbL-1.0.
   - Archive compressed source payloads in `data/sources/` with SHA-256 checksums, retrieval timestamps, bounding boxes, and source manifest metadata.
   - Normalize all segments through `scripts/osm/normalize.mjs` preserving strict provenance (`confirmed_rough`, `probable_rough`, `confirmed_smooth`, `unpaved_loose`, `unknown`). Never fabricate smooth or rough classifications where OSM has no surface tag.
3. **Compact Tile Compilation & Runtime Compatibility**:
   - Compile expanded segments into `data/surfaces/milan-compact-tiles.json` and update manifests with cryptographic SHA-256 checksums.
   - Ensure Cloudflare Workers compatibility:
     - Keep `milan-compact-tiles.json` compact and memory-safe.
     - Ensure `SpatialRoadIntelligenceStore` only hydrates tiles along the requested route corridor (`getScopedIntelligence`), keeping per-request CPU time low and LRU cache bounded (`MAX_INDEX_CACHE = 8`).
4. **Before/After Measurement & Route Verification**:
   - Record exact before/after metrics:
     - Number of `0.01° × 0.01°` tiles covered
     - Bounding box extent
     - Total road segments and total road network km
     - Breakdown of `confirmed_rough`, `probable_rough`, `confirmed_smooth`, `unpaved_loose`, and `unknown` (in meters and %)
   - Re-evaluate **Porta Romana → Largo Promessi Sposi** and representative citywide Milan journeys across Car, Motorcycle, and Bicycle modes, measuring geographic coverage vs confirmed surface classification.

## 3. Limitations & Constraints

- Never invent or infer `asphalt` or `sett` without authentic OSM tag evidence (`surface=*`, `surface_bike=*`). Roads mapped in OSM without a surface tag remain `unknown` (`surface.state = "unknown"`, `confidence = 0`).
- Preserve existing GPS, voice guidance, rerouting, Pareto optimizer, transport mode legality, and Roccella dataset.
- Work strictly inside the existing repository on `fix/mobile-navigation-stability`. No new branches, worktrees, pushes, PRs, or Cloudflare deployments.

## 4. Acceptance Criteria & Test Plan

- [ ] **UI Simplification**: Primary route panel shows only essential metrics (time, distance, pavé m, smooth m, pavé saved badge, single plain-language caution when unknown > 25%, prominent "Avvia navigazione"). Technical details moved to secondary disclosure.
- [ ] **Before/After Screenshots**: Captured via real Chrome for mobile (`390×844`, `320×568`), landscape (`844×390`), tablet (`768×1024`), desktop (`1280×800`), in both light and dark modes.
- [ ] **Milan Coverage Expansion**: Southern Milan (including Largo Promessi Sposi `917_4543` and surrounding tiles) and citywide neighborhoods are present in `milan-compact-tiles.json` with verified checksums.
- [ ] **Porta Romana → Largo Promessi Sposi Verified**: Route is 100% geographically covered by local tiles, with authentic OSM surface breakdown and verified Pareto alternative analysis.
- [ ] **Automated Test Suite**: All unit, integration, schema, and E2E browser tests pass (`npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `git diff --check`).

## 5. Release Conditions

- Local build and verification complete with GO/NO-GO assessment documented.
- No remote push or Cloudflare deployment executed without explicit user authorization.
