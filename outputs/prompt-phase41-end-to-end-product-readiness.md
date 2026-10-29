# Phase 4.1 — End-to-End Product Readiness (execution prompt)

## Goal
Verify Lastrico as a complete, usable, honest mobile product at real iPhone viewport dimensions (390x844 / 375x667), verifying route planning, transport switching, surface metrics, alternative selection, navigation start/stop, simulated guidance, GPS errors, network failure, and session recovery without mocked UI components.

## Scope
1. **End-to-End User Flows**:
   - Route Planning: Input origin/destination, address search and resolution, calculate routes.
   - Multimodal Switching: Car, motorcycle, bicycle; verify distinct profiles, time estimates, safety guidance.
   - Surface Intelligence: Accurate display of cobblestone (pavé), smooth asphalt, unpaved, and unknown metrics.
   - Route Selection: Fastest baseline vs anti-pavé alternative (with Pareto constraints).
   - Navigation Lifecycle: Start navigation (simulation and live GPS), turn-by-turn guidance, arrival detection, manual stop.
   - Adversarial / Resilient Behavior: GPS permission denial, signal blackout recovery, off-route rerouting, network offline handling, session reset.
2. **Viewport & Mobile UX**:
   - Realistic iPhone viewport (390 x 844 pt, device scale, touch targets >= 44x44 pt).
   - Keyboard handling, bottom sheet navigation, no horizontal overflow, map visibility and controls.
3. **API / UI Integrity**:
   - Response contracts match UI rendering without fabricated attributes.
   - No dead controls or visual elements that pretend to control non-existent features.

## Test Strategy
- Real headless browser execution using system Google Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`) connected to the production Lastrico build server (`vinext start`).
- Programmatic DevTools Protocol / CDP automation exercising real user interactions (click, tap, type, resize, evaluate).
- Automated assertions on rendered DOM states, console error logs, network responses, and visual layout.
- Comprehensive Node.js integration tests in `tests/mobile-e2e-readiness.test.mjs`.

## Limitations
- Synthetic GPS and headless browser verification validate software logic and rendering fidelity. They cannot physically reproduce iPhone hardware battery thermals, physical sunlight glare, or iOS WebKit background suspension while screen is locked.

## Acceptance Criteria
- 100% of defined mobile user flows pass without unhandled exceptions or broken layouts.
- Zero console runtime errors during end-to-end user navigation journeys.
- Full regression suite passes: `npm test` (all tests pass), `npx tsc --noEmit` (0 errors), `npm run lint` (0 errors), `vinext build` (clean).
- Concise Italian report with measured metrics and clear GO/NO-GO recommendation for controlled pilot.
