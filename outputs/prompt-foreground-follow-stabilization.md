# Foreground location follow and navigation baseline stabilization (22 November 2026)

Owner: one release owner in an isolated clone of `campsh98-creator/Lastrico`, branch `claude/foreground-follow`, base `main` at `761b919`.
Nothing is deployed. `lastrico-pilot`, CAMPSH and the damaged local clone are not touched. No live provider request (TomTom, routing,
Mapillary) and no credential or quota change without explicit approval.

## 1. Scope

1. **Foreground location follow** (the part of PR #37 that `main` does not have), built on `lib/gps-watch-hub.ts`:
   - when the browser already reports the geolocation permission as `granted` and the person has not switched it off, the page
     subscribes to the shared watch (low accuracy), draws a position marker and centres the map once on the first fix;
   - `prompt`, `denied` or an unsupported Permissions API never start geolocation by themselves: a gesture does;
   - manual pan, zoom or rotate, choosing a route or changing city suspends the follow; a "centre on me" control resumes it;
   - a hidden page releases its subscription, a visible one (`visibilitychange`, `pageshow`, persisted or not) restores exactly one;
   - an explicit "switch off" in the menu is remembered (only that preference is stored, never a coordinate) until switched on again;
   - the planner endpoints and navigation are never changed by a foreground fix.
2. **One watch, always**: follow, navigation and the independent recorder all subscribe to the hub; the app has exactly one
   `watchPosition` call site and at most one live underlying watch.
3. **Heading-aware rerouting stays reliable**: verified against the real traces of 20 November (offline, aggregate output only).
4. **Navigation baseline checks**: Corso Lodi / Porta Romana replicas at Strong and Maximum (0 m route kept), U-turn instructions,
   voice, arrival, GPS tracking and the mobile layout audit.
5. **TomTom**: offline verification of Flow ETA and ranking with ZTL, legality and anti-pavé constraints (existing fixtures only).
6. **Dependency maintenance**: review the open Dependabot PRs, merge only low-risk independently verified ones with green CI;
   MapLibre 6 is high risk (`styleimagemissing`, rendering, mobile E2E) and is merged only with the owner's approval.

## 2. Limitations (stated, not hidden)

- A web page cannot track in the background on iOS: a hidden page is suspended and the follow stops; it resumes on return.
- No physical iPhone is available: no claim of iPhone validation is made. Evidence is headless Chrome at iPhone sizes with a
  simulated geolocation API and the iOS lifecycle events (`pagehide`, `pageshow`, `visibilitychange`).
- The Permissions API for geolocation is not available everywhere; when it is missing the follow waits for a gesture.
- Private traces stay in `private/gps-traces` and are never committed; tests that read them are opt-in and print counts only.

## 3. Acceptance criteria

- `npx tsc --noEmit`, `npm run lint`, `npm test` (full suite, including the production build) green on Linux CI.
- New deterministic unit tests: permission states, lifecycle, stale permission answers, explicit stop, one watch with follow +
  navigation + recorder, errors.
- New mobile scenarios (390x844, simulated GPS): granted launch, prompt launch, pan suspends and recentre resumes, switch-off
  survives reload, hide / show restores one watch, follow + recording + navigation on one watch.
- Existing mobile scenarios keep passing (layout audit D1, recorder E10 / E11, navigation B*, voice E7, arrival B5).
- Private-trace replay (local, opt-in): every reroute of the traces carries the vehicle's course while it moves; no raw coordinate
  appears in any output or file.
- Dependabot PRs: each one merged, deferred or blocked with a written reason; no security check disabled, no test weakened.

## 4. Tests to add or change

`tests/foreground-follow.test.mjs`, `tests/gps-watch-hub.test.mjs` (three subscribers), the `I1`-`I6` scenarios of
`tests/e2e/acceptance.mjs`, expected watch counts of the existing GPS scenarios, `tests/private-trace-heading.test.mjs` (opt-in).

## 5. Release conditions

All gates of section 3 green; every limitation above repeated in the PR; the exact commit proposed for the next `preview-437`
deployment named in the report; the deployment itself waits for the owner's approval in the `preview-437` environment.
