# Lastrico — Phase 4.21 Execution Prompt: Selective Integration, Consolidation and Pilot Release

## 1. Checkpoint (2026-11-05)

- Branch `fix/mobile-navigation-stability` at `9225730`, equal to `origin/fix/mobile-navigation-stability`. `origin/main` is at `19d211a`.
- Uncommitted work in the tree:
  - Premium UI 2.0 and the 4.18.1 refinements: `app/globals.css`, `components/phase43/phase43.css`, `tests/phase4181-ui-verification.test.mjs`, plus screenshots under `outputs/phase418-ui-artifacts/` and `outputs/phase4181-ui-artifacts/`.
  - Research: `experiments/` (surface-ml, route-ranking, road-dashboard, roughness-sensors, surface-vision), `outputs/phase417/`, `outputs/phase420-research-lab-report.md` and the prompts for phases 4.17, 4.18, 4.18.1 and 4.20.
- Pilot `lastrico-pilot` serves version `1b945749-2b1d-406b-9412-39749b9f8ffd`, deployed 2026-11-04. The earlier uploaded version is `34a4f413-39bd-4724-ba42-efaee7f5b448`.
- Research verdicts:
  - Surface ML (4.17): NO-GO.
  - Computer vision (4.20): NO-GO.
  - Vibration sensors (4.20): NO-GO for production.
  - Route ranking (4.20): conditional GO.
  - Road dashboard (4.20): GO, internal use only.

## 2. Scope

| Agent | Area | Exclusive files |
|---|---|---|
| 1 | Route ranking: explain the trade-off the app already chooses | `experiments/route-ranking/`, new `lib/route-tradeoff.ts`, `components/phase43/RouteComparisonPanel.tsx`, `components/phase43/types.ts`, new `tests/route-tradeoff.test.mjs` |
| 2 | Road dashboard: maintained internal tool | `experiments/road-dashboard/` moved to `tools/road-dashboard/`, new `tests/road-dashboard*.test.mjs` |
| 3 | UI 2.0 consolidation and mobile quality: confirmed defects only | `app/globals.css`, `components/phase43/phase43.css`, `app/page.tsx` (defect fixes only), `tests/phase4181-ui-verification.test.mjs`, `tests/e2e/`, `outputs/phase421-ui-artifacts/` |
| 4 | Research preservation and release safety | `experiments/surface-ml/`, `experiments/surface-vision/`, `experiments/roughness-sensors/`, new `experiments/README.md`, new `tests/experiments-isolation.test.mjs`, the temporary image download |

The orchestrator owns all shared files (`package.json`, `.gitignore`, docs, release report), integration, commits, push and deployment.

## 3. Limits

- The production route-selection algorithm stays the default and is not modified. There is no learned ranking and no new consumer setting unless it is proven safe and simple.
- Confirmed, probable and unknown surfaces stay distinct. Nothing unverified is presented as verified.
- The dashboard, ML, vision and sensor code never enter the Worker bundle, `public/` or any public route.
- Datasets that may not be redistributed stay out of Git: StreetSurfaceVis images and models. Generated clutter also stays out.
- No new branch or worktree, no merge into `main`, no force-push, no paid services, no new runtime dependencies.
- Only one agent builds and serves at a time (Agent 3, port 8799), and only Agent 3 calls the live providers during the agent phase. The public Valhalla service allows at most one request per second.
- Simulated GPS is never reported as physical iPhone validation.

## 4. Acceptance criteria

- `npx tsc --noEmit`, `npm run lint`, `npm test`, the targeted ranking and dashboard suites, and a production build all pass.
- The browser acceptance suite passes in both Day and Night themes, with screenshots of loaded maps.
- Live checks for Auto, Moto and Bici in Milan and Roccella:
  - Route geometry is valid and navigation starts.
  - No artificial anti-pavé alternative is offered, and pavé savings are measured against the real fastest route.
  - Unknown surfaces stay unknown.
- Milan has its 117 surface tiles. Worker CPU stays within the free plan.
- A built-bundle check shows no experiment or dashboard code.
- Separate commits for: the UI, the ranking explanation (if justified), the dashboard, the research artifacts, and release fixes.

## 5. Release conditions

1. Record the active version and confirm the rollback command.
2. Deploy only `lastrico-pilot` with `npm run deploy:pilot`.
3. Run the HTTPS smoke tests: home page, PWA assets, Day/Night themes, autocomplete, Auto/Moto/Bici routing, anti-pavé alternatives, navigation startup, Milan and Roccella.
4. If a critical check fails, roll back to `1b945749-2b1d-406b-9412-39749b9f8ffd`.
5. The final report states what was integrated, deferred and rejected, with SHAs, the version ID, rollback steps, limitations, and a GO/NO-GO for physical iPhone testing.
