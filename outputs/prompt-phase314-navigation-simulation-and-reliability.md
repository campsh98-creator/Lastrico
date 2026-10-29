# Lastrico — Phase 3.14 Execution Prompt: Navigation Simulation & Reliability

## 1. Objective & Scope
1. **Realistic, Deterministic Navigation Simulation:**
   - Design an automated navigation replay harness that simulates realistic GPS journeys along actual Milan routes (using the 23-tile network).
   - Simulate authentic mobile GPS noise and environmental challenges:
     - Inaccurate initial fix (coarse-to-fine GPS lock transition).
     - Epistemic noise / multipath jitter (urban canyons of historical Milan center).
     - Signal loss (tunnels, underpasses, subway proximity) and subsequent re-acquisition.
     - Sudden position jumps / teleportation rejection.
     - Off-route divergence (missed turns, unexpected detours, wrong-way driving, U-turns).
     - Parallel road ambiguity and complex multi-leg intersections.
     - Network failure during rerouting recalculations.
2. **Navigation Engine Reliability Verification:**
   - Progress tracking: test monotonic progress preservation, lookahead maneuver advancement, and anti-jump protection at self-intersecting loops.
   - Off-route detection & Rerouting lifecycle: evaluate off-route counter accumulation, cooldown handling, in-progress recalculation locking, and seamless new-route adoption.
   - Arrival detection: verify clean transition to arrival state within target threshold distance.
   - Diagnostics & Telemetry: verify privacy-safe event logging (accepted vs rejected fixes, off-route events, reroute attempts/successes/failures, signal stall detections).
3. **Multi-Modal & Cross-Corridor Evaluation:**
   - Execute deterministic simulations across:
     - `car` profile
     - `motorcycle` profile
     - `bicycle` profile
   - Cover central pilot routes and the 4 Milan expansion corridors (`cadorna-darsena`, `moscova-porta-venezia`, `sempione-porta-romana`, `magenta-missori`).
4. **Distinction of Synthetic vs Physical Validation:**
   - Clearly delineate synthetic GPS replay results from physical iPhone / iOS WebKit testing.
   - Document known iOS Safari/PWA background throttling, wake-lock, and geolocation permissions behavior.
5. **Quality Gates:**
   - 100% test pass rate (`npm test`).
   - Clean TypeScript check (`npx tsc --noEmit`).
   - Clean ESLint check (`npm run lint`).
   - Clean production build (`npm run build`).

## 2. Limitations & Operational Rules
- Simulations must be 100% deterministic, seedable, and reproducible without flaky timers.
- No fabricated real-world claims: clearly label simulation results as synthetic offline validation.
- Preserve all existing routing logic, Pareto optimization, and surface scoring.
- No commit, push, or deploy.

## 3. Acceptance Criteria
- Automated simulation harness implemented and passing all scenarios.
- Zero crashes, zero unhandled errors, zero negative instruction distances.
- Measurable metrics reported: maneuver accuracy, false reroute rate, missed reroute rate, recovery time, route continuity.
- All tests passing with 0 regressions.
- Concise Italian summary report delivered.
