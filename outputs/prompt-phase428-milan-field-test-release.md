# Lastrico — Phase 4.28 Execution Prompt: Milan field-test readiness and safe pilot release

## 1. Checkpoint (2026-11-07)

- Branch `fix/mobile-navigation-stability`, local HEAD at `69678e3`; `origin` is at `66bdccd`.
- Local commits on top of `origin`:
  - Rome: `e084138`, `6b77681`, `2b56e3b`, `7bc22ff`. Not to be pushed or deployed.
  - Milan: `cb8fbbe` (bicycle terminal walking) and `69678e3` (docs).
- The pilot `lastrico-pilot` serves `bf3e13d5-51be-41a8-95d9-e72462c69053`, the Phase 4.26 Milan-only release from `66bdccd`. This is the rollback target.

## 2. Release tree (Phase 4.26 selective method, without branches or worktrees)

- Export `66bdccd` with `git archive` into the session scratchpad.
- Apply only the Milan diff `7bc22ff..69678e3` to it.
- The result must differ from HEAD exactly by the Rome commits.
- It must contain no Rome code, data or option. Check this with a grep and with the dry-run module list.
- Deploy from that export. No Git history is rewritten, and nothing is pushed.

## 3. Gates before deployment

1. `npx tsc --noEmit`, `npm run lint` and `npm test` pass in the release tree.
2. The production build succeeds and the Wrangler dry run stays below 64 MiB, with no Rome modules.
3. The local mobile acceptance suite (71 scenarios, Day and Night themes) passes on the release build. It covers:
   - address autocomplete;
   - route selection;
   - the GPS states (waiting, weak, off route);
   - voice guidance;
   - rerouting;
   - arrival detection;
   - layout.
4. The live Milan journeys calculate on the local Worker, including the bicycle walking case.

Only confirmed release-blocking defects are fixed.

## 4. Deployment and checks

- Record the active version, then deploy `lastrico-pilot` with `npm run deploy:pilot` from the release tree.
- After deployment run:
  - the HTTPS smoke tests;
  - the full mobile acceptance suite against production;
  - the heavy Milan routes with the default "Forte" setting;
  - the Worker CPU check from the logs.
- On a critical failure run `npx wrangler rollback bf3e13d5-51be-41a8-95d9-e72462c69053 --name lastrico-pilot`.

## 5. Report

The report states:
- the deployed version and its exact source (`66bdccd` + `cb8fbbe` + `69678e3`);
- the test results;
- the rollback procedure;
- a GO/NO-GO for tonight's physical iPhone test, with what to check on the road.

Emulation is never reported as an iPhone test.
