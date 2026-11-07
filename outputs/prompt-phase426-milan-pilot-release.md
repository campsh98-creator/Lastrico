# Lastrico — Phase 4.26 Execution Prompt: Milan-only Pilot Release of Phases 4.24–4.25

## 1. Checkpoint (2026-11-07)

- Branch `fix/mobile-navigation-stability` at `ef0a543`, equal to its origin.
- Pilot `lastrico-pilot` serves version `f61513e2-4e7c-481f-8b9f-8cf801d632ff`, deployed 2026-11-06. That is the rollback target.
- Uncommitted work in the tree:
  - Phase 4.23 (Rome).
  - Phases 4.24–4.25 (Milan data quality and anti-pavé routing). See `outputs/phase424-425-report.md`.
- Problem: with Rome included, the Worker bundle is 67.73 MiB, above Cloudflare's 64 MiB limit. Rome has never been deployed.

## 2. Scope

- Release only the Milan work from 4.24–4.25:
  - The 2026-11 surface rules and the rebuilt Milan tiles.
  - On-route surface matching.
  - The rule against adding confirmed pavé.
  - The refinement search.
  - Tests, scripts and reports.
- Leave Rome out of the release:
  - No Rome option, presets, tiles, store or Rome-only server branches.
  - Rome's work stays in the user's working tree exactly as it is.
- Prepare the release in a separate, detached Git worktree in the session scratchpad. The user's checkout is not modified.

## 3. Limits

- Do not change routing behaviour for Milan or Roccella beyond what 4.24–4.25 benchmarked. Only Rome-gated code is removed (`area.id === "rome"` branches, Rome types, the Rome store import).
- Do not delete or rewrite Rome data. Do not touch other projects. Do not merge into `main` and do not force-push.
- Commit, push and deploy need the user's explicit go-ahead after the preparation results are shown.
- Simulated GPS and emulated mobile are never reported as physical iPhone validation.

## 4. Acceptance criteria (preparation)

- The release tree differs from the working tree only by the Rome exclusions.
- The release tree contains no Rome references in `app/`, `lib/` or `components/`.
- All of the following pass in the release tree:
  - `npx tsc --noEmit`;
  - `npm run lint`;
  - `npm test` (including the 4.24/4.25 suites);
  - the production build;
  - the Wrangler dry run.
- Worker bundle below 64 MiB, with the size recorded.
- Milan still has 117 tiles plus the manifest.
- Local mobile E2E in Day and Night themes, with a real local Worker:
  - Milan by car and by bicycle;
  - Roccella by car;
  - search, route, navigation start and reroute.

## 5. Release conditions (after authorization)

1. Commit the Milan-only change on `fix/mobile-navigation-stability` with a patch identical to the tested release tree. Rome stays uncommitted.
2. Push the branch.
3. Deploy only `lastrico-pilot` from the clean release tree with `npm run deploy:pilot`.
4. Record the new version ID.
5. Run the HTTPS smoke tests (`scripts/post-deploy-smoke.mjs`), including Milan and Roccella routes, and check CPU time and latency in the Worker logs or analytics.
6. If a critical check fails, run `npx wrangler rollback f61513e2-4e7c-481f-8b9f-8cf801d632ff --name lastrico-pilot`.
7. Physical iPhone verification is the user's step. It is stated as pending until it is done.
