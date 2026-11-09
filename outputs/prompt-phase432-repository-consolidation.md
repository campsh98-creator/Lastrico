# Phase 4.32 execution prompt — repository consolidation, GitHub synchronisation, showcase

9 November 2026. A consolidation and presentation phase, not a routing phase.

## Scope

1. Audit the branch `fix/mobile-navigation-stability`. That covers:
   - the 7 local commits not on `origin`: Rome 4.23/4.27 and Milan 4.28;
   - the uncommitted Phases 4.29–4.31.
2. Scan for credentials, personal data and real GPS traces, and check large files.
3. Re-run the automated checks: TypeScript, ESLint, the production build and the full unit suite.
4. Capture real README screenshots from the current local build:
   - routes are recorded provider responses replayed through the real handler;
   - GPS is simulated;
   - the capture is reproducible with `scripts/capture-showcase-screenshots.mjs` and `scripts/build-readme-assets.mjs`.
5. Write the documentation:
   - a public README;
   - an engineering status document that separates local features, public-pilot features, experimental work and items awaiting physical iPhone validation;
   - an updated architecture page.
6. Preserve the irreplaceable provider-response archive as one compressed file with a checksum.
7. Make logical commits.
8. Push the existing feature branch without force.
9. Update the GitHub description and add topics.

## Limits

These steps are excluded:
- no change to routing, GPS or navigation behaviour, unless a release-blocking defect appears;
- no Cloudflare deploy and no Workers Paid;
- no DNS changes;
- no push to `main`, no merge, no force push;
- no tag or release;
- no change of visibility, default branch or licence;
- no history rewrite;
- no deletion of datasets.

## Acceptance criteria

- Every commit is on `origin/fix/mobile-navigation-stability`, and the remote head equals the local head.
- No secret, private trace or personal data is pushed, and nothing over 50 MB is added.
- The README images are real screenshots stored in the repository, with their conditions stated.
- The README separates what is online from what is local only.
- The repository description and topics are confirmed by `gh repo view`.
- An Italian report states:
  - the hashes;
  - the checks;
  - the backup gaps;
  - that the GitHub homepage still shows `main`.

## Tests and release conditions

- Before committing: `npx tsc --noEmit`, `npm run lint`, `npm test` (build plus the full unit suite).
- The browser suites are not repeated: the routing code is unchanged since the last 8/8 focused run.
- The showcase capture exercises the built app once more: planner, routes, navigation and the ZTL panel, in both themes.
- No production release follows from this phase.
