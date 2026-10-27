# Lastrico — Phase 3.4: Real Navigation Readiness Execution Plan

## 1. Objective & Scope

Make Lastrico ready for reliable real-world iPhone navigation within the Milan pilot area while preserving all Phase 1–3.3 routing, Road Intelligence, legal access, time-budget, and UI improvements.

### In Scope
1. **Live Navigation Flow Review & Reliability Fixes:**
   - **GPS Updates & Filtering (`lib/navigation-state.ts`, `app/page.tsx`):**
     - Fix coarse-to-fine GPS lock rejection in `evaluateTimedGpsReading` by accounting for `previousAccuracy` when computing plausible movement distance between consecutive fixes.
     - Fix stale React state closures (`isRecalculating`, `voiceEnabled`) inside the long-lived `navigator.geolocation.watchPosition` callback by using live refs (`recalculatingRef`, `voiceEnabledRef`).
   - **Map Matching & Maneuver Progression (`lib/route-progress.ts`):**
     - Enforce monotonic instruction `progressMeters` during `buildRouteProgressModel` so self-intersecting or looping routes never invert maneuver order.
     - Add forward-continuation locality preference in `projectOnSegment` / `calculateRouteProgress` when `previousProgressMeters` is known, preventing GPS jitter near self-intersections or adjacent legs from jumping hundreds of meters ahead on the route.
   - **Live Off-Route Rerouting Continuity (`app/page.tsx`):**
     - During active navigation rerouting (`options.journeySession !== undefined`), use the locked destination coordinate (`endLocationRef.current ?? endLocation`) directly without re-running Nominatim geocoding on `endText`, and preserve the user's planned origin label/location in the planner form.
     - Reset `offRouteReadingsRef` and `arrivalReadingsRef` and synchronize `lastRouteProgressRef` to the current GPS position immediately when a replacement route is installed.
   - **Signal Loss, Permissions & Foreground/Background Recovery (`lib/navigation-state.ts`, `app/page.tsx`):**
     - Detect silent GPS stalls (when `watchPosition` stops emitting fixes for `>= 15s` without firing an error callback) via `evaluateGpsSignalStall` and transition cleanly to `temporarily-unavailable` while preserving the last valid position and route.
     - On `visibilitychange -> visible` during active GPS navigation, re-request the screen Wake Lock and trigger an immediate high-accuracy position refresh if the last fix is stale (`>= 5s`).
2. **Privacy-Safe Navigation Diagnostics (`lib/navigation-state.ts`, `app/page.tsx`):**
   - Track session-scoped, coordinate-free diagnostic counters (`acceptedFixes`, `rejectedFixes`, `rerouteAttempts`, `rerouteSuccesses`, `rerouteFailures`, `signalLossCount`, `wakeLockActive`) via pure helpers in `lib/navigation-state.ts` and expose a compact, non-intrusive diagnostic line (`data-testid="navigation-diagnostics"`) in the navigation HUD.
3. **Validation & Field-Test Checklist:**
   - Add focused regression tests in `tests/navigation-state.test.mjs` and `tests/route-progress.test.mjs`.
   - Verify TypeScript, ESLint, production build (`vinext build`), full test suite (`node --test tests/*.test.mjs`), and `git diff --check`.
   - Deliver a concise iPhone field-test checklist covering route start, turns, rerouting, GPS interruption, and session completion.

### Out of Scope & Limitations
- No changes to route optimization, Pareto selection, Road Intelligence scoring, OSM ingestion, or `/api/routes` contracts.
- No new dependencies, external telemetry services, or persistent location logging.
- No commits, pushes, or deployments.

## 2. Acceptance Criteria & Release Conditions
- Coarse-to-fine GPS transitions (e.g., `±95 m` cell/Wi-Fi fix followed 1s later by `±6 m` GNSS fix `80 m` away) are accepted without false `"implausible"` lockouts, while genuine teleportation from accurate fixes remains rejected.
- `gpsState` remains `"recalculating"` while an off-route reroute request is in flight and recovers cleanly to `"live"` on success or `"offroute"` on network failure/timeout.
- Self-intersecting and looping routes neither jump backward nor skip forward across distant legs during maneuver progression.
- Silent GPS stalls and background-to-foreground transitions recover automatically on iPhone Safari/PWA.
- All automated checks (`tsc`, `eslint`, `npm test`, `git diff --check`) pass with zero errors.
