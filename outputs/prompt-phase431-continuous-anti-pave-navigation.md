# Lastrico — Phase 4.31 Execution Prompt: continuous anti-pavé navigation and reliable rerouting

8 November 2026. Branch `fix/mobile-navigation-stability`, HEAD `733518b`. Phases 4.29 and 4.30 are
uncommitted in the working tree and **not deployed**. The public pilot is `03a6776e`, the
Phase 4.28 code. It currently fails most route requests on the Workers Free 10 ms CPU limit
(Phase 4.30).

## 1. Evidence available before starting

- **Field tests.** Three iPhone journeys, as reported by the user (A, B, C). No authentic GPS trace was
  supplied, so every replay below is either a reconstructed provider route or a synthetic trace,
  and is labelled as such.
- **The tests ran on the Phase 4.28 code.** The Phase 4.29 pavé HUD and voice warnings were therefore not
  on the phone. That alone explains the missing popups in Test B.
- **Code reading (confirmed defects, to be proven by tests):**
  1. **The anti-pavé objective is lost after one reroute.** `handleGpsFix` passes
     `preserveRoute: activeRouteRef.current`. `applyRouteData` overwrites that ref with the kind
     actually shown, so a reroute that finds no distinct alternative turns the journey into
     "fastest". Every later reroute then stays fastest.
  2. **Reroutes use a smaller candidate pool than the planner.** With `navigation=1`, the
     surface-aware Valhalla search (Phase 4.25, the strongest anti-pavé generator) never runs, and
     at most one detour waypoint is tried. The rest of the journey is optimised with less than
     the initial route had.
  3. **Wrong-turn detection is distance-only.** A reroute needs about 55 m (car), 50 m (moto) or
     38 m (bike), plus up to 60 m of accuracy, on two or three consecutive fixes. On a
     dense Milan grid, a wrong turn followed by a parallel street, or a slow wrong turn, can stay
     under that threshold for a long time.
- **Release state.** A reroute that failed on the Worker (HTTP 503 on the CPU limit, or a timeout) shows
  "Ricalcolo non riuscito" and then backs off for 30, 60 and 120 s. On the current pilot this is a
  plausible cause of Test C. It is not provable without a trace or historical logs, and the pilot
  has no Workers Logs.

## 2. Scope

**P0 — Routing and rerouting**
1. **Persistent journey objective.** Store the objective chosen at navigation start and send it with every
   reroute. When no alternative exists, show the fastest route honestly and keep the objective
   for the next reroute.
2. **Same anti-pavé generator in navigation.** Run the surface-aware Valhalla search in reroutes when
   the fastest candidate has measurable pavé and the latency budget allows it. Do not
   change the planner path, and keep the payloads of the existing planner benchmark identical.
3. **Wrong-turn evidence.** Add heading-plus-offset evidence (sustained travel away from the route's
   course while clearly beside it), and a sustained-offset rule for parallel streets. Both are gated
   by GPS accuracy, start-up confidence, the existing cooldown and the in-progress lock. No
   single fix can trigger a reroute.
4. **Clear reroute states.** Recalculating, success (objective kept, or "no alternative from here")
   and failure with a reason, recorded in the diagnostics.

**P0 — Benchmarks**
5. **Deviation replay.** Deterministic and offline, over all 88 Milan journeys × 3 modes (264 routes)
   from the Phase 4.30 benchmark. Scenarios: mirrored wrong turn (left↔right), missed junction,
   parallel street, correct driving with noise, urban-canyon multipath, poor fix after a turn, GPS
   loss and recovery, and two consecutive wrong turns. It compares the deployed processor,
   the Phase 4.30 working tree and Phase 4.31, and measures detection rate, detection
   distance and time, and false positives.
6. **Reroute quality.** A request from the simulated deviation point of each route, through
   the real handler, with provider responses archived (FOSSGIS-paced, ≥1.1 s apart) and replayable.
   Before and after are compared on confirmed and probable pavé, unknown surface, extra time and distance,
   distinct alternatives, provider calls, latency and CPU.
7. **The three field journeys,** reconstructed from provider routes (not the user's trace).

**P1**
8. **Surface popup.** Reuse the Phase 4.29 engine and add the verified OSM road name and the surface
   type. Probable (paving_stones) stays distinct from confirmed. No "deteriorated asphalt"
   unless the data says so.
9. **Arrow lag.** Measure location-to-render lag in the browser and reduce it without extrapolating
   through an outage.

**P2**
10. **Traffic signals** from tagged OSM nodes already in the repository (central pilot archives,
    26–28 Oct), shown only along the selected route, with stated coverage. No network
    extraction without approval.
11. **The missing chat.** Report what was found. Lastrico never had an AI chat; the
    "Descrivi la tua preferenza" interpreter is collapsed since `19d211a`.

## 3. Limits

- No commits, pushes, merges or deployments. Do not touch the pilot. No branches or worktrees.
- Phases 4.29 and 4.30, Rome, Roccella and the Phase 4.22 autocomplete are preserved. Planner
  routing results stay identical: 354/354 benchmark payloads, compared field by field.
- No retries that hide failures. No fabricated surfaces, names, signals or traces. Synthetic GPS is
  never reported as a physical iPhone result.
- No new paid dependency, no AI backend.

## 4. Acceptance

- In replay, a confirmed wrong turn (mirrored turn or missed junction, accurate GPS) is
  detected in at least 95% of cases. Correct driving with noise produces no more false reroutes
  than the deployed processor.
- After a reroute the anti-pavé objective is kept, in a unit test and in the browser.
- Reroutes do not end with more confirmed pavé than before on the benchmark. The added latency and CPU
  are measured and reported.
- The popup shows distance, road name when verified, surface type and length, and is legible at
  375×812 in light and dark themes.
- `tsc`, lint, `npm test`, the browser suite, the build, the dry run and the bundle size all pass.
- An Italian report with root causes, before/after measurements, risks, GO/NO-GO and the
  next iPhone test plan.

## 5. Release conditions

A GO for a Milan-only release requires all of the following:
- the P0 acceptance above;
- Workers Paid enabled by the user, since the Phase 4.30 NO-GO on Free still holds;
- explicit authorisation for commit and deploy;
- the selective method that excludes Rome;
- production smoke tests with `wrangler tail`.
