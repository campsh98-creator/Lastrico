# Lastrico mobile navigation stabilization — execution prompt

## Objective

Reproduce and fix the mobile regression that makes the GPS navigation CTA unavailable after route calculation, then validate the complete navigation lifecycle from planning through arrival on the integration branch `fix/mobile-navigation-stability`.

## Scope

- Mobile route-result layout, safe areas, viewport height, overflow and bottom navigation.
- Bounded route-preference prompt and `maxExtraMinutes` state.
- Authoritative route readiness, request identity and selected-route synchronization.
- GPS navigation start/stop/restart, permission states, filtering, progress, rerouting, ETA, distance, arrival, Wake Lock and voice.
- Map layer ordering, active-route contrast and redraw across themes and lifecycle changes.
- Automated, visual, responsive, lifecycle, failure and performance verification.
- Bug audit and physical-iPhone checklist.

## Limitations

- Do not work on `main`, force-push, reset destructively or broadly rewrite the application.
- Do not remove the route-preference prompt to hide the regression.
- Do not modify business-plan, Motia, fundraising or marketing material.
- Do not add dependencies unless a confirmed defect cannot be addressed with the existing stack.
- Do not claim physical-device validation. Browser emulation and deterministic GPS simulations must be labelled accurately.
- Do not persist or log precise user locations.
- External map applications remain fallbacks and do not receive Lastrico route geometry.

## Workstreams and ownership

- Lead/integrator: repository baseline, architecture map, integration, final suite, documentation, release and smoke test.
- Mobile UI specialist: read-only diagnosis first; later ownership of route-result presentation and the relevant mobile CSS when authorized.
- Routing-state specialist: read-only diagnosis first; later ownership of request identity, prompt state and route-authority helpers/tests when authorized.
- GPS-runtime specialist: read-only diagnosis first; later ownership of navigation runtime helpers/tests when authorized.
- Map-rendering specialist: map-route style and visual-state helpers/tests; no planner redesign.
- QA specialist: independent adversarial review and evidence; no production edits unless the lead reopens a confirmed defect.

`app/page.tsx` and `app/globals.css` have one writer at a time. Specialists initially return evidence and proposed patches; the lead integrates accepted changes.

## Acceptance criteria

1. A current route produces a single authoritative `routeReady` state.
2. When ready and not navigating, `Avvia con GPS` is visible, reachable and dominant on all required mobile viewports.
3. Prompt state, transport, avoidance and time budget match the displayed, summarized, selected and navigated route.
4. Older route responses cannot overwrite newer prompt, mode or reroute requests.
5. Single, double and rapid taps initialize at most one GPS watcher/session.
6. Permission denied, weak GPS, temporary unavailability and outside-beta-area are distinct and recoverable.
7. Rerouting keeps navigation active and the old route visible, preserves preferences and updates the map/progress atomically.
8. Safe/fast selection remains synchronized with map, metrics, ETA and navigation.
9. Simulation and GPS clean up all timers, watches, speech and session state between modes.
10. The selected route remains high contrast in light/dark themes and after recalculation or foreground restoration.
11. ETA, remaining distance and arrival derive from one progress model and never become negative.
12. Existing planner, reporting, routing and PWA behavior remains intact.

## Required validation

- Baseline and final build, lint, TypeScript/build compilation and complete automated suite.
- Regression tests for prompt/no-prompt/time-budget requests, stale responses, route authority, CTA visibility/start, GPS failures, reroute inheritance, cleanup and route contrast.
- Mobile visual tests at 375×812, 390×844, 393×852 and 430×932 in light and dark modes.
- Route results for safe, fast, prompt-applied and no-alternative states.
- Navigation states for GPS request, active, weak, outside-area, rerouting and arrival where deterministic simulation permits.
- Repeated interaction and resource-cleanup tests.
- Production deployment only after all non-physical gates pass, followed by a production smoke test.

## Release conditions

- Work remains on `fix/mobile-navigation-stability`; do not merge to `main` automatically.
- Create `docs/BUG_AUDIT_MOBILE_NAVIGATION.md` and `docs/IPHONE_PHYSICAL_TEST_CHECKLIST.md`.
- No CRITICAL or HIGH finding may remain after independent QA.
- Final status must be exactly `READY FOR PHYSICAL IPHONE TESTING` or `NOT READY — BLOCKING ISSUES REMAIN`.

