# Audit reconciliation and final integration (21 November 2026)

Baseline: `main` at `311b7a5`. Work branch `claude/audit-reconciliation` in an isolated clone (the primary checkout has a damaged
object database and staged work of its own: not touched). Nothing is merged or deployed by this work. CAMPSH and `lastrico-pilot`
untouched. No live TomTom request was made. No raw coordinate, timestamp of a position or home location appears in any committed file.

## 0. State found

| Item | State |
| --- | --- |
| `main` | `311b7a5` (Pin preview 4.37 to `e0d8680`), CI green |
| Deployed preview | pin `8cf048d` (routing #39, #40, #44). The pin `e0d8680` (recorder #46) has a `Preview 4.37` run **waiting for the `preview-437` environment approval**: not deployed, not ours to approve |
| Merged | #39 heading, #40 + #44 residual stone at Maximum, #46 recorder (with #41 core), #43/#45/#47 pins |
| Open | #36 (TomTom probe, draft), #37 (foreground GPS), #38 (routing + audits), #41 (superseded by #46), #42 (audit text), #48 (second recorder, based on #37) |
| Worktrees | primary checkout (damaged git database, staged work, preserved), `Lastrico-phase438`, `Lastrico-claude-p0`, `Lastrico-clean` untouched |

## 1. Claude vs Antigravity: reconciliation

| Topic | Claude (merged unless noted) | Antigravity (open) | Verdict |
| --- | --- | --- | --- |
| Reroute start direction | #39: course sent on the first point of every Valhalla request, one counted retry without it | #38: same idea as tests/fixtures only (its code diff did not touch heading: #39 was already in its base) | Keep #39; keep #38's **recorded provider answers** as the real before/after evidence |
| Residual stone at Maximum | #40 + #44: one exclusion search, stone of all candidates | #38: duplicated-base refinement | Keep #40/#44; add #38's refinement for Strong **planner** only (section 2) |
| Provider budget | none | #38: OSRM reserve fix | **Accepted** (real bug) |
| Trace labels | audit: "reporting artefact, not changed" | #38: record intent instead of the card | **Reimplemented**: both are recorded |
| GPS recorder | #46 `free-recording` (merged baseline) | #48: second recorder on the navigation trace format + second panel + second storage key; #37: shared foreground watcher, auto-start on launch | **One recorder (#46)**; only missing pieces integrated (section 3) |
| TomTom | offline checks on the real tiles (audit) | #38 audit test, #36 probe | Verified offline, no defect; #36 not merged (section 4) |
| Mapillary | audit: unverified, NO-GO | #38 pilot document (ids, bearings, confidences) | Claims rejected, nothing imported (section 5) |

## 2. Routing: what was accepted and rejected

Method: every change of PR #38 was applied on top of current `main` and measured with the real handler on the recorded provider
answers (public OSM junctions). "Corso Lodi" below is the public-junction replica of journey A (`piazzale-lodi-return-car`).

| PR #38 change | Decision | Reason and evidence |
| --- | --- | --- |
| Valhalla OSRM reserve | **Accepted** | Penalised and exclusion requests cannot fall back to OSRM but still gave up 1.5 s of their own budget: after one paced slot a 3.5 s budget left a ~1 s timeout. Test `a customised or excluding car request keeps its whole budget` fails on `main`, passes now |
| Duplicate-base refinement | **Accepted, Milan planner only** | The first penalised route only reproduced the 25 m alternate, so the refinement gate stayed shut. One extra request now finds a route that is cleaner and not slower (Strong: 25 m / 595 s -> 0 m / 574 s, 2 -> 3 requests). Selection untouched. Maximum was already 0 m (unchanged). Outbound replica unchanged. Test `P0-1` and `phase437` return replica fail on `main` |
| Premature termination (`stopsOnlyWhenClean` in navigation) | **Rejected** | It would let every reroute run up to 3 paced requests (about 2.1 s of pacing plus provider latency) inside a 5.5 s budget, with no latency evidence. A reroute stays at one request (pinned by tests) |
| Heading-aware snapping | **Already on `main` (#39)** | Verified again: recorded answers without the course give 1 U-turn instruction, with `heading=311` give 0; all requests carry it on the first point only |
| Repeated U-turns | **Covered by #39** | Reproduced from the original trace (section 5): 5 consecutive reroutes started against the course |
| Safe/fast objective logging | **Reimplemented (additive)** | #38 replaced the shown kind by the intent, which would make the GPX label of a fast card say "anti-pavé". Now `objective` (shown) is unchanged and `journeyObjective` (asked) is added; older traces still parse |
| Unnecessary geometric detours | **Rejected for now** | Trace C shows three detours that came out dominated (543-763 m of stone against 69 m), but no public recorded replica reproduces it, so there is no failing-before test, and skipping detours could hide a via-point alternative. Follow-up: record a public replica first |
| #38 `tests/helpers/load-api.mjs` | Accepted | Test loader finds `node_modules` from a worktree |

## 3. GPS recorder

Baseline is the merged recorder of #46 (`lib/free-recording.ts`, `components/RecordingPanel.tsx`, key `lastrico-recording-active`), in
the main options and independent of any destination. #48 and #37 were compared with it feature by feature.

| Capability | #46 (baseline) | #48 / #37 | Decision |
| --- | --- | --- | --- |
| Number of recorders, panels, storage keys | 1 / 1 / 1 | #48: a second recorder on the navigation trace format, a second panel and a second key | **Rejected**: one recorder, one panel, one key (a test guards the key and the call site) |
| Location watch | the recorder had its own `watchPosition`, navigation another | #37: a shared foreground watcher | **Integrated** as `lib/gps-watch-hub.ts`: the only `watchPosition` in the app; navigation and the recorder subscribe; recording while navigating costs no second watch; the accuracy follows the most demanding subscriber; a re-arm replaces the watch once for everybody; a denied permission reaches both |
| Start | the person starts it, before any route | #37: auto-start on launch | **Rejected**: recording without consent is not honest behaviour; it stays an explicit action available before navigation |
| Pause / resume / stop | states `recording`, `paused`, `stopped` | similar | Kept; a **transition table** test pins start, pause, resume, stop, save, recover and resume after recovery |
| Checkpointing | whole record saved every 10 s and on every state change | #48: similar | Kept. **Measured**: one hour (3,600 points) 0.8 ms, 188 KB; the 50,000-point cap 9.8 ms, 2.6 MB, inside the localStorage budget |
| Interrupted session | recovered as paused, never resumed on its own, the closed-app time marked | #48: similar | Kept and hardened: a record that lost its gap list no longer throws; a stopped recording is recovered as stopped |
| Gaps (page hidden, app closed, no signal) | one threshold of 30 s | #48: finer reasons | **Integrated**: a pause or an imported segment is always a cut; hidden page or closed app from **10 s** (the 20 November trace had 112 s and 17 s); a quiet receiver from **15 s**; the 17 s gap is now cut, not drawn across |
| Fix-gap while the page is visible | nothing said | #48: a stall indicator | **Integrated**: after 20 s without a usable fix, while recording and visible, the panel says so ("not recording points right now") |
| Import | GPX and GeoJSON, replaced the track on screen | #48: similar | **Integrated**: refused while a device recording is running or paused (checked before and after reading the file); a multi-segment GPX keeps its `<trkseg>` cuts even if the clock shows seconds; a self-closing `<trkpt/>` is refused; the safety limits stay |
| Export | GPX, GeoJSON | similar | GPX unchanged; GeoJSON keeps only valid LineStrings (RFC 7946, two or more positions); a lone fix stays in GPX. Round trip export -> import tested; no identifier, no network code (guard test) |

Boundaries: a web page cannot record in the background on iOS. This is stated in the panel and the gap is shown, never hidden.
Not verified on a real iPhone. The mobile (390x844) start / pause / resume / stop and import / export run is the Linux evidence in
section 7; no instruction in this section is claimed beyond what the tests and that run show.

## 4. TomTom and Mapillary

Detail and test names: `outputs/audit-reconciliation-tomtom-mapillary.md`.

- TomTom: decoding, direction-aware matching, ETA and ranking (the threshold is 600/700 = 0.857 of free flow), closure versus incident
  semantics, the interaction with Maximum (the congestion rides in the same request as the stone, 4 cost factors instead of 3, 7
  requests at most, exclusion stone-only, 0 m kept), ZTL legality, quota, cache, breaker and fallback: **GO**, offline, no defect found.
  The 900 s flow-closure penalty and Incidents are **CONDITIONAL** (standing-closure policy; incidents never seen live and
  informational only). Live peak-hour density and tile storage licensing: **unverified**. PR #36 not merged.
- Mapillary: the image ids, bearings, the "confidence 0.91 to 0.96" and the one-way claim for Corso di Porta Romana are rejected
  (the 17:19 trace drove north-west on it). Nothing Mapillary-derived enters road data; a guard test fails if production code starts
  to mention it. Open: current API terms on caching, share-alike against ODbL, provenance, accuracy on setts.

## 5. The original traces (20 November), reproduced offline

`scripts/summarize-private-trace.mjs` prints counts, bearings and distances only. Raw files stay in `private/gps-traces`.

| Trace | Reproduced | After this work |
| --- | --- | --- |
| 15:39 (journey A) | 709 fixes, 835 s, heading in 100 % of fixes, background gaps of **112 s and 17 s**. Route 0: 25 m confirmed stone, "penalised search attempted, generated 0", the selected candidate was a provider alternate: exactly the trigger of the duplicated-base refinement. Reroutes planned with one request | Planner: refinement runs (replica: 25 m -> 0 m at Strong, Maximum stays 0 m). Reroutes unchanged by design. Gaps: see section 3 |
| 17:19 (journey B) | 1,022 fixes, 8 reroute requests. Reroutes 2 to 6 (device course 311 degrees, 4 to 5.5 m/s, 100 % heading): the new route started on **131 degrees, against the course**, each with a U-turn instruction within 400 m. Reroute 2 happened 35 m from the public junction used by the fixture | Same junction and course, recorded provider answers: U-turn instructions **1 -> 0**; selected route 8.4 -> 9.4 min, 2.60 -> 2.89 km, because the shorter route needed the U-turn. Stone 247 -> 307 m: the old figure was bought with a turn the car could not make |
| 19:09 (journey C) | 12 fixes in 11 s, then the page was suspended; initial plan: 69 m confirmed stone, 294 m unknown, 3 detours all dominated. Logged "fast" although the objective was safe | Objective now recorded next to the shown kind. Page suspension is a platform limit, shown as a gap, not hidden |

## 6. Before / after metrics (real handler, recorded public-junction answers)

| Case | Before (`main`) | After |
| --- | --- | --- |
| Return replica, Maximum, planner | 574 s, 0 m stone, 0 m unknown, 3 requests | identical (preserved) |
| Return replica, Strong, planner | 595 s, 25 m, 2 requests | 574 s, 0 m, 3 requests |
| Return replica, reroute (Strong and Maximum) | 1 request, 25 m | identical |
| Outbound replica, Strong / Maximum, planner | 2 requests, 50 m / 3 requests, 0 m (+92 s) | identical |
| Corso di Porta Romana NW, reroute with the vehicle's course | 1 U-turn instruction (without course) | 0, 2 requests, within the 4-request cap |
| Customised car request, 2.5 s budget after one slot | refused ("Budget routing esaurito") | runs |

## 7. Regression and CI results

Pull request: https://github.com/campsh98-creator/Lastrico/pull/49 (against `main`, not merged, nothing deployed).

| Gate | Where | Result |
| --- | --- | --- |
| Type-check (`tsc --noEmit`) | local + Linux CI | exit 0 / success |
| ESLint | local + Linux CI | 0 errors; warnings only (4 in the project paths I linted locally, 53 in the whole-repository run of CI) |
| Production build (`npm run build`) | Linux CI (inside `npm test`) and the temporary verification job | success |
| Full test suite (`node --test tests/*.test.mjs`) | **Linux CI, commit `11750fd`** | **746 tests, 733 pass, 0 fail, 13 skipped** |
| Same suite on the Windows development machine | local | 746 tests, 710 pass, 22 fail, 14 skipped: CRLF line endings in source-text regexes, `C:\C:\` URL paths and data checksums of a CRLF checkout. All 22 pass on Linux, so they are environment-only |
| Deterministic routing regressions (Corso Lodi return/outbound replicas at Strong and Maximum, reroute caps, heading, OSRM reserve) | Linux CI | pass (each fixed behaviour has a test that fails on `main` and passes here) |
| GPS: hub, recorder, state transitions, import/export, privacy | Linux CI | pass (the GPS merge adds 40 tests to the suite) |
| TomTom offline (decoding, ranking, closures, ZTL, Maximum interaction, fallback) | Linux CI | pass; real saved tiles are an opt-in local check |
| Mobile browser, 390x844, simulated GPS and browser geolocation | temporary verification workflow | MOBILE_PENDING |

Run links: CI `https://github.com/campsh98-creator/Lastrico/actions/runs/44941739078`, verification
`https://github.com/campsh98-creator/Lastrico/actions/runs/44941687726`.

## 8. Residual issues and GO / NO-GO

### Residual issues

| Issue | Severity | Next step |
| --- | --- | --- |
| Real iPhone not tested; a web page is suspended in the background, so recording shows a gap there (stated in the panel) | medium | one field run on a device, with the screen on, then the screen off |
| Unnecessary geometric detours (trace C: three dominated detours) not reproduced by a public replica | low | record a public replica first, then a failing-before test, then a decision |
| Strong avoidance is a product choice (stone against minutes): the Strong planner now spends one more request in Milan | low | confirm with field data |
| TomTom: the 900 s flow-closure penalty cannot tell a standing closure from a fresh one; incidents are informational only; live peak-hour density unverified | medium | decide the standing-closure policy; no live request without explicit approval |
| Mapillary: current API terms, share-alike against ODbL, provenance and accuracy on setts are open | blocking for any import | nothing Mapillary-derived enters road data until answered |
| Preview deploy of `e0d8680` (recorder #46) waits for the `preview-437` environment approval | process | approved by the owner, not by this work |
| The 22 Windows-only test failures | low | the suite passes on Linux; a CRLF-tolerant check would fix the local run |

### Housekeeping before merge

- Remove `.github/workflows/audit-reconciliation-verify.yml` (temporary): done in the final commit of the branch.
- Close or supersede #37, #38, #42 and #48 after this PR is reviewed; their branches and the `recover/*` branches are kept.
- PR #36 stays unmerged; #41 is superseded by #46.

### GO / NO-GO

- Routing (Corso Lodi at Maximum stays 0 m; the reroute no longer starts against the course; one more request only at the Strong planner in Milan): **GO**.
- GPS (one watcher, one recorder, one key; recording starts without a route; start / pause / resume / stop and import / export tested): **GO** for the logic; **CONDITIONAL** for a real iPhone.
- TomTom: **GO** for the verified behaviour, **CONDITIONAL** for closure policy and incidents.
- Mapillary: **NO-GO** for any production use.
- Overall: **GO to review and merge PR #49, after the mobile browser result below is green and the temporary workflow is removed.** Not merged, not deployed by this work.
