# Lastrico — Phase 4.10 release report

**Outcome: ready for the first physical iPhone test. Navigation is not yet validated on a real device.**

Deployed to `https://lastrico-pilot.campsh.workers.dev` on 2026-11-01 as version `ad7a353a-cbfa-485d-9d51-bcbb1ac2fb3e`.

Rollback:

```bash
npx wrangler rollback de0d61c9-4061-4177-add1-3d174f6d8e42 --name lastrico-pilot
```

Nothing was pushed to GitHub or merged, so the pilot now runs commits that exist only on the local branch `fix/mobile-navigation-stability`. The ChatGPT Sites deployment was not touched, and no production D1 write was made.

## Packages

| Package | Status | Result |
|---|---|---|
| A. GPS progress guard | Done, with additions | Reproduced 1.6 km jump is gone. See deviations |
| B. Trace recorder and replay | Done, with one deviation | A trace recorded in Chrome replays with 0 differences |
| C. Overpass removal | Done | No route request path contacts it; bundle has no mention of it |
| D. Valhalla pacing | Done | Time slots replace the cross-request promise chain |
| E. Versioned deployment | Done | This release was deployed through `npm run deploy:pilot` |
| F. Honest UI | Done | Percent text, contrast and the false privacy banner are fixed |
| G. Error logging | Done | Internal and provider failures are distinct and carry no location |
| H. Route equivalence | Done | All listed parallel detours are distinct; 2.5 ms worst pair measured |
| I. Search threshold | Done | Cadorna → Darsena improves; see below |
| J. Unpaved risk | Done | Gravel no longer scores as smooth |
| K. Private access at route ends | Added during execution | See below |

## Defect found during execution (K)

`wrangler dev` testing exposed a production 503 on a valid route (start 9.1765,45.4682, end 9.1771,45.4623). The destination is reached through a short `vehicle=private` stretch, so the local restriction check rejected every provider route and the user was told to retry. The catch-all error hid the cause; the new logging revealed it at once.

Private access within 150 m of either route end is now allowed and disclosed. `access=no`, wrong-way travel and private land crossed mid-route still disqualify a route, and now answer 422 with the real reason. This route returns 200 in production with the notice.

The review report also missed that the diagnostics card claimed "Nessuna coordinata GPS viene inviata a server", which is false because reroutes send the position to routing providers. A test pinned that text. Both are corrected.

## Deviations from the prompt

- **A, additions.** Smoothing is skipped across gaps over 5 s, because averaging placed the vehicle far behind its fix and then raced to catch up. Hold time accumulates so a driver rejoining the route is not stuck. A backward candidate must also be clearly closer, which stops multipath toward an earlier parallel leg from forcing a false reroute. A first fix away from the route start is located immediately.
- **B.** The recorder runs only in GPS navigation, not simulation, because simulation never reaches the per-fix logic, and the control says so. The acceptance check used a GPS journey emulated through Chrome's geolocation API instead of a simulated journey.
- **B, untested path.** Export used the download path with the anchor click captured. The iOS share sheet has not been exercised.
- **Benchmarks.** `scripts/benchmark-route-optimization.mjs` was not run, because it overwrites tracked files and replays archived provider responses that no longer match these requests. The table below compares the review's production measurements with the new production version instead.
- **End-to-end tool.** The built-in browser blocks localhost subresources, so `scripts/e2e-mobile-chrome.mjs` drives real Chrome through DevTools. It is committed and can be rerun.
- **Scope additions.** `.p43-hud-diagnostics` now spans the HUD row and the panel closes when navigation starts, because the recorder flow otherwise left a clipped panel covering the map.

## Evidence

### Static and automated checks

`npx tsc --noEmit`, `npm run lint` and `git diff --check` pass. `npm test` passes 319 of 319 with none skipped, against a baseline of 272 of 272.

In one earlier full run during development, two headless Chrome layout tests (Phase 4.6 and Phase 4.8) timed out. They passed alone and in every later full run, so this looks like load-related flakiness, but the cause was not established.

### Bundle

| Measure | Before | After |
|---|---|---|
| `dist/server/index.js` | 7,782,527 B | 7,769,262 B |
| `index.js` gzip | 2,706,049 B | 2,703,025 B |
| Total Worker upload gzip | not measured | 3,037 KiB |

### Route quality in production

Pavé is shown as chosen route against fastest route. All values are from the live provider.

| Itinerary | Review (before) | This release |
|---|---|---|
| Car, Brera → Santa Sofia | 916 m / 1,520 m, +3.1 min | 916 m / 1,520 m, +3.0 min |
| Car, Cadorna → Darsena | 431 m / 464 m, +1.6 min | **172 m / 464 m, +0.7 min** |
| Bicycle, Castello → Porta Venezia | No alternative, 482 m | No alternative, 482 m |

The bicycle case is unchanged: it needs corridor-wide penalties, which are out of scope. Three itineraries are not a statistic.

### Mobile end-to-end

`scripts/e2e-mobile-chrome.mjs` passed 24 of 24 checks on the local build under `wrangler dev` and again on production. Screenshots and `e2e-results.json` from the production run are in `outputs/phase410-validation/`.

- Selected card contrast is at least 6:1 in both themes.
- Simulation reaches arrival with monotonic distance.
- With the recorder off, nothing is stored and the HUD says the position is not saved.
- With the recorder on, a 128-fix GPS journey shows REC and discloses local storage, with no reroute and a largest advance of 27.6 m. It replays with 0 decision differences.
- No trace data appears in any network request, and delete removes every stored piece.

### Production smoke test

Read-only, at no more than one request per second, with no report POST:

- All 6 preset itineraries by car, plus motorcycle and bicycle samples, returned 200 from `valhalla-fossgis`.
- No notice mentions Overpass.
- Production's page asset matches the build (`page-DnV64chf.js`), and the service worker is `lastrico-v13`.
- Invalid coordinates return 400, and `/api/reports` returns 200.

### `wrangler dev` queue reproduction

A client abort while queued and while in flight did not stall later requests locally, so the risk was not reproduced. The cross-request dependency was removed regardless. The one failure seen in that run was defect K, not the queue.

## Known issues left open

- **Landscape HUD:** on a phone in landscape the instruction and trip panels overlap by about 9 px and cover nearly all of the map (`simulation-hud-dark-852x393.png`). The checklist still tests landscape.
- **Toast:** "Non interagire con lo schermo" overlaps HUD controls for a few seconds.
- **Coverage:** surface data covers about 5% of the accepted Milan area, and nothing warns when a route leaves it.
- **`/api/routes` has no per-client rate limit.** This is needed before wider testing, not for one iPhone.
- **Coordinates are still sent in GET URLs,** with Workers observability enabled.
- **iOS icon:** only an SVG is provided, so the Home Screen icon may be missing.

## Not verified

- Real iPhone GPS accuracy, heading and update rate.
- Safari speech, including prompts enabled during navigation.
- Wake Lock, background and lock-screen behaviour, and PWA standalone mode.
- The iOS share sheet.
- How often real devices report geolocation errors. These reset arrival readings, and the emulator's 126 errors per journey are an artefact of how it sets positions, so this needs field data.
- Actual Worker CPU time and memory under workerd.

## Next

Run `docs/IPHONE_PHYSICAL_TEST_CHECKLIST.md`. Its traces decide the tuning of off-route thresholds, voice distances, smoothing, arrival tolerance and surface weights. The search thresholds in package I are provisional until then.

The proposed next engineering phase is corridor-wide `linear_cost_factors`, which in the review's experiment reduced pavé from 482 m to 86 m on the bicycle case above at +2.5 min. It made one of three itineraries worse, so it must add a candidate rather than replace selection.
