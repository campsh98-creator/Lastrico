# Lastrico — Phase 4.9 Execution Prompt: Critical Navigation Fixes

## 1. Context & Objectives
Phase 4.8 completed surface provenance corrections and mobile UX refinements across Milan and Roccella Ionica. Phase 4.9 addresses four confirmed critical navigation defects before controlled iPhone pilot deployment:

1. **GPS Progress Snapping:** Prevent implausible forward jumps on parallel streets, looping routes, and future segments by introducing time-elapsed and speed-bounded reachability, GPS accuracy tolerance, and multi-reading confirmation for ambiguous jumps, while preserving legitimate U-turns and rerouting.
2. **Voice Guidance Delivery:** Prevent premature maneuver and arrival speech. Maneuvers must only be announced when within appropriate approach distance; arrival must never be announced as an upcoming maneuver and must require reliable, confirmed GPS fixes near the destination.
3. **Live OSM Cache Consistency:** Preserve live segment records across Overpass cache hits and spatial corridor expansions. Cold and warm requests with identical inputs must produce bit-for-bit identical surface and risk scores.
4. **Route Alternatives Waypoint Fallback:** When Valhalla returns a customized route that is distinct but inadmissible (e.g. exceeds +5 min budget, violates legal turns, or does not improve pavé), waypoint detour generation must continue to find valid legal alternatives within budget.

---

## 2. Scope & Technical Architecture

### 2.1 GPS Progress Snapping (`lib/route-progress.ts`)
- **Root Cause:** `projectOnSegment` previously checked a narrow hardcoded window (`[-35m, +160m]`) and if `bestWindow.offRouteMeters > 40` or `bestWindow.offRouteMeters > best.offRouteMeters + 25`, it unconditionally fell back to the global `best` segment, which could be thousands of meters ahead on a parallel or looping street.
- **Solution:**
  - Support `RouteProgressOptions`: `{ accuracy, elapsedSeconds, maxSpeedMps }`.
  - Calculate plausible forward window: `forwardWindow = Math.max(120, (elapsedSeconds || 1.5) * maxSpeedMps + (accuracy || 15) * 1.5)`.
  - Calculate backward slack: `backwardWindow = Math.max(35, (accuracy || 15))`.
  - Reject forward jumps outside `[anchor - backwardWindow, anchor + forwardWindow]` unless confirmed over multiple readings or within plausible reach.
  - Preserve backward movement / U-turn detection via `backwardMeters` to properly feed off-route rerouting.

### 2.2 Voice Guidance (`lib/voice-guidance.ts` & `app/page.tsx`)
- **Root Cause:** `useEffect` in `app/page.tsx` fired `speakInstruction` immediately whenever `navigationProgress.instruction.id` changed, regardless of distance (e.g. 1.5 km away) or instruction type (announcing destination as a maneuver).
- **Solution:**
  - Create dedicated `evaluateVoiceGuidance` module in `lib/voice-guidance.ts`.
  - Filter out `"arrive"` from maneuver speech; arrival is exclusively announced as `"Sei arrivato a destinazione"` upon confirmed arrival.
  - Threshold maneuver speech:
    - Car / Motorcycle: $\le 250$ m.
    - Bicycle: $\le 80$ m.
  - Require reliable GPS state (`gpsState === "live"`, `accuracy <= 35m`) or simulation mode. Inaccurate or stalled GPS suppresses maneuver speech.
  - Tighten arrival confirmation in `app/page.tsx`: require `accuracy <= 25m`, distance to end $\le arrivalTolerance$, remaining meters $\le arrivalTolerance \times 1.5$, and $\ge 2$ consecutive readings.

### 2.3 Live OSM Cache (`app/api/routes/route.ts`)
- **Root Cause:** `lastOverpassSnapshot` did not store `liveSegmentsList`. On warm cache hits, `liveSegmentsList` was reset to `[]`. When corridor expansion (`ensureRouteCovered`) occurred, it failed to merge live segments into `expanded.roads`, reverting to base OSM and producing inconsistent scores.
- **Solution:**
  - Store `liveSegments: RoadSegmentRecord[]` in `lastOverpassSnapshot`.
  - Restore `liveSegmentsList = lastOverpassSnapshot.liveSegments` on cache hits.
  - Ensure `ensureRouteCovered` merges `liveSegmentsList` identically in cold and warm paths.

### 2.4 Route Alternatives Waypoint Fallback (`app/api/routes/route.ts`)
- **Root Cause:** Line 646 checked `if (canGenerate && directSafe === directFast && !directProducedDistinctRoute)`. If Valhalla returned a distinct route that was inadmissible (e.g. +7 min extra time > 5 min budget), `directProducedDistinctRoute` was true, which stopped waypoint fallback and left the user with zero safe alternatives.
- **Solution:**
  - Define `directHasAdmissibleAlternative`: true only if `!routesAreEquivalent(directSafe.route, directFast.route, mode) && directSafe.riskMeters + policy.minimumPaveReduction <= directFast.riskMeters`.
  - Continue waypoint fallback if `canGenerate && !directHasAdmissibleAlternative`.
  - Preserve legal constraints, Pareto optimization, and the +5-minute budget.

---

## 3. Acceptance Criteria
1. **GPS Snapping:**
   - A single GPS reading near a parallel or loop segment $\ge 300$ m ahead does not cause a progress jump.
   - Legitimate route progression advances smoothly.
   - U-turns and off-route divergences continue to trigger rerouting.
2. **Voice Guidance:**
   - Maneuvers are not spoken when distance exceeds approach threshold (250m car/moto, 80m bike).
   - Arrival is not spoken as an upcoming maneuver; destination arrival is spoken only after confirmed arrival.
   - Weak or inaccurate GPS fixes (> 35m) do not trigger premature arrival or false maneuver prompts.
3. **Live OSM Cache:**
   - Calling `/api/routes` twice with identical coordinates and live Overpass data yields identical `paveMeters`, `riskMeters`, and `surfaceScore` on cold and warm requests.
   - Corridor expansion with live segments preserves live surface classifications in both requests.
4. **Route Alternatives:**
   - When Valhalla direct route is distinct but over-budget (+6 min), waypoint detours execute and return an admissible alternative within the +5 min budget.
   - When Valhalla direct route is admissible, redundant waypoint detours are skipped.
5. **Quality & Release:**
   - Full test suite passes (`npm test`).
   - TypeScript cleanly compiles (`npx tsc --noEmit`).
   - Linter reports zero errors (`npm run lint`).
   - Production build succeeds (`npm run build`).
   - No Git whitespace errors (`git diff --check`).
   - No commit, push, or deploy.
