# Foreground location follow and navigation baseline stabilization (22 November 2026)

Branch `claude/foreground-follow`, base `main` at `761b919`, pull request #61. Nothing is deployed; `lastrico-pilot`, CAMPSH and
the damaged local clone are untouched; no live provider request, credential or quota change. Execution contract:
`outputs/prompt-foreground-follow-stabilization.md`.

## 1. GPS and navigation: what changed

PR #37 was reviewed against `main`. Its single shared watcher is superseded by `lib/gps-watch-hub.ts` (#49); its
auto-follow behaviour was the missing part, and it is now built on the hub, not on a second watcher.

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Automatic positioning when permission is granted | `lib/foreground-follow.ts`: one more low-accuracy subscriber of the hub; starts by itself only when the Permissions API says `granted` and the person has not switched it off; draws the position, centres once inside the service area | unit tests; mobile I1 |
| Never prompts by itself | `prompt`, `denied`, a missing or failing Permissions API wait for a tap (the locate control, the menu switch, or "use my position") | unit tests; mobile I2 |
| One watch, no duplicates | follow, navigation and the recorder all subscribe to the hub; accuracy follows the most demanding subscriber and falls back when it leaves; a test pins that `lib/gps-watch-hub.ts` holds the only `watchPosition` call | unit tests (three subscribers); mobile I6 (`maxActive` 1 over follow + recording + navigation) |
| No conflict with map interaction | a manual pan, zoom or rotate, a route on screen, starting navigation or changing city suspends the camera follow; "centre on me" (top bar) resumes it | mobile I3 |
| No conflict with planning | a fix never sets the origin or starts navigation; "use my position" takes the follow's fresh fix instead of asking the device again | mobile I1, I7 |
| iPhone foreground behaviour | `visibilitychange`, `pagehide` and `pageshow` (including a back-forward cache restore) release the subscription and restore exactly one | unit tests; mobile I5 |
| Explicit off | menu switch "Posizione sulla mappa", remembered across reloads (only the preference is stored, never a coordinate) | unit tests; mobile I4 |
| Reliable heading-aware rerouting | already in `main` (#39); verified on the real traces (section 2) | `tests/private-trace-heading.test.mjs` |

Also in this PR: the map code compiles and behaves the same on MapLibre 5 and 6 (section 4), the end-to-end harness reads GeoJSON
sources on both, the Dependabot development group no longer includes the React and Next families, and a failed mobile scenario
now prints the uncaught page errors.

Existing mobile scenarios start with the follow switched off (the person's own "off" preference) because they count watches
exactly; the `I*` scenarios run with it on.

## 2. Navigation validation

**Private traces** (the four recorded traces, local only; `LASTRICO_PRIVATE_TRACES`; counts and degrees only, no coordinate printed):
4 traces replayed with **0 differences**; 24 reroute events read: 22 while moving, each with the vehicle's course present and within
45 degrees of the device's; 2 at a standstill, where no course is sent (a stale course there is what started the U-turns). The
reroutes that started against the course (journey B, 17:19) are the original defect, fixed by #39; the recorded provider answers
at the same public junction give 0 U-turn instructions with the course (test `P0-4`).

**Corso Lodi, Porta Romana, Maximum**: `tests/p0-road-test-regressions.test.mjs`, `phase437-candidate-generation` and
`phase437-trace-generation` pass (36 tests): the return replica reaches 0 m of confirmed stone at Strong and keeps 0 m at Maximum;
a reroute stays at one request; caps stay 7 (planner) and 4 (reroute).

**Mobile (headless Chrome, 390x844 and the suite's other viewports, release build, local Worker, mocked providers, simulated
GPS), Linux CI: 83 of 83 pass**: layout audit at 8 sizes in light and dark (including 320x568), voice (E7), arrival (B5), GPS
start / stop / no leaked watch (B1, B2), the recorder (E10, E11), the arrow glide (F1) and the new follow scenarios I1-I7.
Not run on a physical iPhone: **no iPhone validation is claimed**.

## 3. TomTom (offline only)

`traffic-core`, `traffic-hub`, `traffic-route`, `traffic-offline-verification` and `traffic-maximum-interaction`: 37 pass, 1
skipped (the opt-in check on locally saved real tiles). Congestion changes the ETA and the ranking exactly where the formula says
(a statically faster route keeps its place in light traffic and loses it in heavy); a Flow closure costs a car 900 s and moves
the ranking while an Incident-tile closure changes neither; a route illegal at the departure time never wins because it is
free-flowing; ZTL and legality stay non-negotiable; with Maximum the congestion rides in the stone search, the exclusion search
stays stone-only, the caps hold and 0 m is kept; when the provider fails the answer equals the answer without traffic. No live
call was made. Conditional items stay as in the reconciliation report: the 900 s closure-penalty policy and Incidents.

## 4. Dependency pull requests

| PR | What | Security | Evidence | Decision |
| --- | --- | --- | --- | --- |
| #4 (merged earlier today) | next 16.4.6 | yes (advisories of 16.2.11 and 16.4.5) | CI + mobile 76/76 | merged |
| #54 | react family 19.2.6 -> 19.3.1 | no (feature release) | CI green; mobile run on a throwaway branch: no failure caused by React | **deferred**, ready to adopt after this PR |
| #57 | maplibre-gl 5.24 -> 6.19.0 | no | types and build pass with the compatible map code; **the map canvas stays blank** (no tiles, no route) and 63 of 83 mobile checks fail | **blocked**, high risk |
| #58 | drizzle-orm 0.45.2 -> 0.45.4 | no | CI green; release notes concern drivers the app does not use | deferred (unnecessary), safe to merge when convenient |
| #60 | development group (10 tools) | no | `npm ci` fails (`ERESOLVE`): it also bumps `react-server-dom-webpack`, `eslint-config-next` | **not mergeable**; the config change in this PR excludes the families and Dependabot rebuilds it |

MapLibre 6: `styleimagemissing` is a notify-only event in 6, so the handler now uses `setMissingStyleImageResolver` when the engine
has it; `serialize()` of GeoJSON sources is gone in 6, so the harness reads them both ways. Neither is the cause of the blank map,
which is unexplained (a worker that is not found or served is a hypothesis, not a finding). Do not merge #57 until the map renders
and the mobile suite passes on it.

## 5. Release safeguards and the next `preview-437`

- Clean isolated clone; tsc, lint (0 errors, 53 warnings as before), full tests (766, 752 pass, 0 fail, 14 skipped), production
  build and Linux CI green on the head of this branch.
- The preview workflow builds a commit **fixed in `.github/workflows/preview-437.yml` (`APPROVED_SHA`)**, today
  `e0d8680f3e29b6817f0f714b68d03a2e973b2acd` (#46). `main` has moved well past it (#49, #50, #4, #53). A run that is waiting for
  the `preview-437` approval (on `311b7a5`) would publish that old build; do not approve it.
- The commit to publish is the **merge commit of this PR on `main`** (named in the PR once merged), pinned by a separate pin PR
  as before. That pin PR is the owner's to review and the deployment waits for the owner's approval; nothing was deployed.

## 6. Remaining issues

- Real iPhone not tested (a hidden page is suspended: the follow stops and resumes on return, stated in the app and here).
- MapLibre 6 renders nothing in the current build (blocker for #57).
- #37 stays open until this PR lands, then should be closed as superseded.
- Open items from before: the 900 s closure penalty and Incidents (TomTom), Mapillary NO-GO, the unnecessary-detours follow-up
  (#52) and the TrafficHub ordering idea (#51).
