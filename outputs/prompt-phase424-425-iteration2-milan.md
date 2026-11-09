# Lastrico — Phases 4.24–4.25, second iteration (Milan): execution prompt

## 1. Checkpoint (2026-11-07)

- Branch `fix/mobile-navigation-stability`, `origin` at `66bdccd` (Milan 4.24–4.25 released as pilot `bf3e13d5`).
- Local Rome commits `e084138..7bc22ff` are not pushed and not deployed.
- Benchmark replay on the current code (`iter2-baseline`) is identical to the released `after` run:
  - 261 of 264 cases are valid;
  - confirmed pavé on the selected routes is 51.8 km;
  - there is 1 unnecessary detour;
  - 0 alternatives add confirmed pavé.

## 2. Defects examined

| Finding | Evidence | Verdict |
|---|---|---|
| 3 bicycle refusals (Arco della Pace → Duomo, Centrale → Piazza Fontana, Piazza Fontana → San Babila) | In each case the only restriction is 46–91 m at the first or last stretch, on Via Santa Margherita or Via Pattari. OSM tags there are `access=no` + `foot=yes`, so a cyclist may walk the bike. Every provider route must use them because the endpoint lies on them. The archive does not keep `foot`, so the scorer cannot tell. | **Confirmed defect**: a legal journey (ride, then walk the last metres) is refused |
| 9 "useful candidate in pool" not selected | Each one adds unverified stretches (+134 to +26,383 m) or probable pavé, raises raw pavé, or saves less than the 100 m minimum of weighted pavé | Not a defect: the conservative policy works as designed |
| 1 unnecessary detour (Maciachini → Moscova, bicycle) | It saves 120 m of confirmed pavé for +243 s, which is 202 s per 100 m against the analysis threshold of 180 | Not a defect: inside the "Forte" limits |
| About 5.4 s on heavy central routes | Provider calls are deliberately paced at 1.05 s (FOSSGIS policy) | Not a defect: documented latency |

## 3. Scope: one fix

- **Milan archive:** also keep the `foot` tag (`keepFoot`, Milan "2026-11" compile only).
  - Roccella's archive stays byte-identical.
  - Rome keeps its own full tags.
- **Scorer:** add an opt-in rule. For a bicycle, a stretch closed only by generic `access`/`vehicle=no`, where `foot` is yes, designated or permissive, and which lies within the existing 150 m terminal allowance, counts as terminal walking (`terminalWalkMeters`).
  - It is not blocking.
  - In the middle of a route it stays blocking.
  - `bicycle=no` and one-way violations stay blocking.
  - Car and motorcycle are unchanged.
- **Routes API:** enable the rule for Milan only. Rome and Roccella are unchanged until they are revalidated.
  - Report `terminalWalkMeters` on each route and in the diagnostics.
  - Add an honest notice to `dataNotice`.
- **App:** a visible notice in the route panel when the selected bicycle route has terminal walking ("scendi e prosegui a piedi"). No new control.

## 4. Limits

- No commits for this Milan work until it has been reviewed. No push or deploy. The pilot stays `bf3e13d5`.
- Rome, Roccella and the Phase 4.22 autocomplete are not changed.
- No new branch or worktree.
- No surface classification changes. Provider responses are captured only when they are missing, paced at 1.1 s or more.

## 5. Acceptance criteria

- **Benchmark** (`iter2-after` against `iter2-baseline`, same yardstick):
  - the 3 refusals become valid routes with terminal walking of at most 150 m, stated honestly;
  - no other case changes its selected route or its metrics.
- **Network coverage by transport mode:** unchanged.
- **Regressions:** all of these pass:
  - `npx tsc --noEmit`, `npm run lint`, `npm test`;
  - the Roccella and Milan reproducibility tests;
  - the Rome tests;
  - the build and the dry-run under 64 MiB;
  - the local mobile acceptance suite in Day and Night themes.
- **Report:** in Italian, with Milan coverage by transport mode, routing results, regressions and GO/NO-GO.
