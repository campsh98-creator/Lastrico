# Mobile navigation stabilization audit

Date: 2026-08-23  
Branch: `fix/mobile-navigation-stability`  
Starting commit: `2ccc452d67fe090a00fd96d6fb390735f4e98cf0`

## Confirmed defects and disposition

| Severity | Defect | Root cause | Disposition |
| --- | --- | --- | --- |
| P1 | Prompt A could finish after Prompt B and become navigable | Preference recalculation was dropped while another request was loading; request identity omitted planner revision and preferences | Fixed with authoritative planner revision, explicit request preferences, abort/supersede and API preference acknowledgement |
| P1 | Editing an endpoint left the previous route navigable | `isLiveResult` meant only that a route had succeeded sometime in the past | Fixed with separate `routeReady`; every route-defining edit invalidates navigation immediately |
| P1 | Repeated start could create more than one GPS watcher | Start checked asynchronous React state rather than the synchronous journey ref | Fixed with idempotent synchronous guard |
| P1 | Stopping during reroute could leave routing permanently loading | Teardown removed the request identity before its `finally` block could clear loading | Fixed by resetting request/loading/recalculation state in navigation teardown |
| P1 | Progress could jump backwards at a self-intersection | Map matching always selected the globally nearest segment without continuity | Fixed with bounded backward tolerance and a retained journey progress anchor |
| P1 | Planner CTA was clipped at 375×812 after prompt expansion | Fixed panel height combined with `overflow:hidden` | Fixed with native panel scrolling on mobile and short-height layouts |
| P2 | GPS CTA was clipped in 812×375 landscape | Short-height scrolling rule applied only below 760px width | Fixed with width-independent short-height scrolling |
| P2 | A GPS fix outside Milano appeared as weak signal | GPS state model combined different causes | Fixed with explicit outside-area and temporarily-unavailable states |
| P2 | New fixes could overwrite the recalculation state | GPS informational updates had no status priority | Fixed by giving recalculation priority until its request settles |
| P2 | Wake Lock could resolve after stop and remain held | Asynchronous result was not associated with a navigation session | Fixed with pending-session ownership and late-handle release |
| P2 | Re-enabling voice could skip the visible instruction | Spoken instruction ID remained deduplicated after explicit voice activation | Fixed by resetting that ID when voice is enabled |
| P2 | Dark theme did not affect the vector basemap | Theme code targeted a nonexistent raster layer named `osm` | Fixed with a vector-compatible tint overlay below route layers |
| P2 | Red pavement could represent the other alternative | One combined pavement collection was assigned to both route results | Fixed by returning and rendering route-specific problem segments |
| P2 | `sanpietrino/sanpietrini` spelling variants were rejected | Bounded parser covered only the `sampietrini` form | Fixed with explicit singular/plural variants |

## Intentionally unchanged

- Surface scoring thresholds and routing-provider selection.
- Milan beta coverage bounds.
- Simulation remains an explicit secondary test mode and never presents itself as GPS.
- Apple Maps, Google Maps and Waze remain fallbacks; they do not receive Lastrico geometry.
- Bundle splitting was not changed. The production build still reports a client chunk above 500 kB; this is a performance follow-up, not a navigation-integrity blocker.

## Verification completed without a physical device

- ESLint, standalone TypeScript, production build and full Node test suite.
- Prompt interpretation and real route calculation through the local application.
- Stale-route invalidation after destination editing.
- Safe/fast result rendering and selected-route-specific pavement overlay contract.
- GPS/simulation separation and live moving marker in simulation mode.
- Light/dark screenshots.
- CTA geometry and hit-testing at 375×812, 390×844, 393×852 and 430×932.
- Scroll reachability at 812×375 landscape.

## Validation that still requires an iPhone

- Safari and installed-PWA precise-location permission flows.
- Stationary GPS behavior, real movement, heading and accuracy changes.
- Background/foreground suspension and Wake Lock behavior on iOS.
- Physical off-route recalculation, arrival detection and spoken instructions.
- Safe-area layout with real browser chrome and Home Indicator.

