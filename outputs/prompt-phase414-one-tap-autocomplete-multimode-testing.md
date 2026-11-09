# Lastrico — Phase 4.14 Execution Prompt: One-Tap Address Selection & Multi-Mode Route Testing

## 1. Scope & Objectives

### Objective 1 — Fix Address Autocomplete & One-Tap Suggestion Selection
- **Live Debounced Suggestions While Typing**:
  - As the user types into `#start-search` or `#end-search` (`query.trim().length >= 3`), fetch geocoding suggestions after a short debounce (`320 ms`) without stealing focus from the active `<input>` and without auto-selecting the first suggestion while typing.
  - Display inline autocomplete suggestions (`role="listbox"`, `data-testid="address-suggestions"`) directly below the active field, while preserving the explicit search button / `Enter` / disambiguation picker (`[data-testid="address-picker"]`) when needed.
- **True One-Tap Selection (Mobile Touch, iOS Safari/WebKit & Desktop)**:
  - Selecting a suggestion (from either inline autocomplete or the address picker modal) requires **one tap only** — no second tap, `Enter`, or extra confirmation button.
  - Handle `onPointerDown` / `onMouseDown` (`event.preventDefault()`) alongside `onClick` so mobile Safari/WebKit and desktop browsers never lose the tap to an input `blur` event or viewport reflow when the virtual keyboard dismisses.
  - Immediately update the target field (`start` or `end`) with both the human-readable `label` (`startText` / `endText`) and exact `[lon, lat]` coordinates (`startLocation` / `endLocation` + refs `resolvedStartRef` / `endLocationRef`).
  - Close all open suggestion lists/modals and explicitly dismiss the mobile keyboard (`input.blur()`), preventing `<Dialog>` unmount focus-restoration (`restoreFocus={false}`) from re-focusing the input and re-opening the keyboard.
- **Automatic Single-Shot Route Calculation When Both Addresses Are Valid**:
  - When a user selects a suggestion for `start` and `end` is already valid (either already confirmed with coordinates or has valid non-empty text), or selects a suggestion for `end` and `start` is already valid, automatically trigger `calculateRoutes(...)` **exactly once**.
  - Prevent duplicate route requests, stale geocoding responses overwriting confirmed selections (`requestId` / `AbortController` + query/target matching), and focus/blur race conditions.
- **Preserve Manual Editing, Accessibility & Keyboard Navigation**:
  - Preserve full manual text editing, `ArrowDown` / `ArrowUp` / `Enter` / `Escape` keyboard navigation across suggestions, ARIA combobox/listbox attributes (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `role="option"`, `aria-selected`), and screen-reader announcements.

### Objective 2 — Test 5 Real Milan Routes Across 3 Transport Modes (15 Scenarios)
Test the 5 specified Milan journeys using genuine geocoding (Nominatim) and routing providers (OSRM / Valhalla) plus the expanded 117-tile Milan road-surface intelligence dataset:
1. **Porta Romana → Largo Promessi Sposi** (`car`, `motorcycle`, `bicycle`)
2. **Castello Sforzesco → Porta Venezia** (`car`, `motorcycle`, `bicycle`)
3. **Cadorna → Darsena** (`car`, `motorcycle`, `bicycle`)
4. **Duomo → Stazione Centrale** (`car`, `motorcycle`, `bicycle`)
5. **Navigli → Città Studi** (`car`, `motorcycle`, `bicycle`)

For all 15 scenarios verify:
- Single-tap address suggestion selection updates the field and coordinates.
- Both origin and destination resolve to valid coordinates within Milan.
- A legal route is returned for the selected transport mode (`car`, `motorcycle`, `bicycle`).
- Route geometry is rendered on the MapLibre map (`fast-line` / `safe-line`).
- Distance, duration, confirmed pavé (`paveMeters`) and smooth-road meters (`smoothSurfaceMeters`) are internally consistent (`paveMeters + smoothSurfaceMeters + unpavedSurfaceMeters + unknownSurfaceMeters ≈ surfaceTotalMeters`).
- When `hasDistinctAlternative === true`, the anti-pavé route (`safe`) is genuinely distinct and `fast.paveMeters - safe.paveMeters > 0` matches displayed savings.
- When no valid alternative exists (`hasDistinctAlternative === false`), no alternative is fabricated.
- **"Avvia navigazione"** starts navigation cleanly, and stopping (`Termina`) + restarting works without breaking the interface.

## 2. Limitations & Constraints
- Preserve all Phase 4.13 UI/UX and 117-tile Milan coverage improvements.
- Do not auto-select the first suggestion while the user is typing.
- Clearly distinguish live-provider integration tests from mocked browser tests; do not claim physical iPhone GPS validation without a physical device.
- No new branches, worktrees, Git pushes, or Cloudflare deployments.

## 3. Acceptance Criteria & Release Conditions
- Focused unit/regression tests for one-tap autocomplete, stale response cancellation, focus/blur handling, keyboard navigation, and single-shot auto-calculation pass (`npm test`).
- All 15 real-provider Milan multi-mode scenarios (5 journeys × 3 modes) are executed and verified end-to-end.
- WebKit/Safari iPhone-sized viewport verification (`390x844`) and Chrome E2E verification pass.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` pass with zero errors.
