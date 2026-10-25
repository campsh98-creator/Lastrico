# Lastrico engineering audit — local stabilization

## Scope and authority

Audit current routing, surface scoring, navigation, inputs and Worker/D1 integration.
Implement verified defects with deterministic regression tests. Preserve existing API
fields and mode policies; add explicit surface-coverage semantics without treating missing
coverage as smooth. No commits, pushes, deployments, remote writes or production changes.
The user request overrides repository release instructions requiring deployment.

## Baseline (2026-10-25)

- Branch: `fix/mobile-navigation-stability`; initially clean working tree.
- `npm run lint`: passed.
- `npm test`: build and 62 tests passed. Existing large client chunk warning.
- `npx tsc --noEmit`: failed TS2688 on nine empty duplicate `node_modules/@types/* 2`
  directories. Repair only empty local dependency directories, without weakening checks.
- `git diff --check`: passed.

## Execution and acceptance

1. Bound provider queue waits by request cancellation/deadline; validate provider summary,
   geometry and manoeuvres. Reject malformed candidates without discarding valid siblings.
   Car fallback remains car-only. Use mocked fetch responses and deterministic geometry.
2. Reproduce route equivalence/deduplication and constraint defects; preserve fastest
   reference before enforcing explicit extra-time budgets. Test exact budget boundaries,
   equivalent geometry with different sampling and faster duplicate candidates.
3. Match the nearest supported aligned surface, avoiding severity overriding closer evidence.
   Report unmatched geometry as unknown and separate classification weighting from data
   reliability. Test no coverage, zero length, overlap and parallel features.
4. Validate HTTP inputs and bounded report bodies; retain pending moderation and privacy.
5. Research documented Valhalla linear_cost_factors using primary sources. Do not enable
   pathfinding changes without verified support; otherwise document a minimal future plan.
6. Keep changes cohesive and the architecture recognizable. Defer new ingestion, storage,
   global rate-limiter infrastructure and tuning without evidence.

## Validation and stopping conditions

Run targeted tests after each logical group, then lint, full npm test (including build),
TypeScript and diff whitespace checks. Review all changed files and API/mode invariants.
Attempt local desktop/mobile smoke checks without depending on public routing services for
automated test success. Clearly distinguish browser simulation from physical GPS/iPhone
verification. Document environmental blocks and residual matching/data uncertainty.
Stop when verified scoped defects are fixed and checks pass; remaining speculative work
belongs in the audit report. Deliver reviewable local changes and suggested commit message.
