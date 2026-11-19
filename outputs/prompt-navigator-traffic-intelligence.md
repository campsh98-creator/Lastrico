# Execution prompt: navigation latency, traffic intelligence and road-intelligence follow-ups

Written before implementation, as AGENTS.md requires. Starting point: `main` at `9cd25b2` (preview run 44477600454 published
`49fea24`; the pilot `lastrico-pilot` is untouched and stays untouched).

## Scope

1. **Routing latency without quality loss.** Measure where wall time goes (provider calls are paced at one per 1.05 s, so
   the floor is about 1.05 s per provider request). Remove requests only where the answer is provably identical: a short-lived
   memo of provider answers, plus a journey-sticky Durable Object shard so a recalculation (another avoidance level, another
   extra-minute limit) lands where the memo lives. Selection output must stay byte-identical to the current code.
2. **Provider budget.** Keep the seven-request ceiling per planner calculation (four per reroute), counting retries and the OSRM
   fallback. Add a test that drives the whole handler through its worst case.
3. **Live traffic, optional, free only.** Pick the provider from the current official quotas and terms, record the decision, then
   build: congestion and incident overlay, traffic-aware ETA, traffic-aware candidate selection and one combined penalised search
   (traffic + stone + rails), hard quotas, graceful fallback. Cars full effect, motorcycles half the delay (documented
   assumption), bicycles ETA unchanged (incidents and closures still shown).
4. **Road-intelligence follow-ups.** Map layers on a phone (tap, not hover), independent and combined pavé/tram avoidance,
   OSM/DBT/ATM reconciliation where it can be measured locally, street-level image classification evaluation (desk plus the
   existing Phase 4.36 probes), a user-observation prototype with provenance, confidence and validation.
5. **Release.** Tests, Linux CI, PR, merge, pin the isolated preview to the merged commit, publish it, production-style smoke test.

## Limitations (hard)

- Cloudflare Free only; no paid plan, no billing, no new Worker, no new Durable Object class (the preview workflow allowlists
  exactly `RouteEngine`; the preview has no D1). Every new piece of state lives in the existing `RouteEngine` SQLite storage.
- Zero new cost: a traffic provider key is a credential the owner must create; without it the feature is off and says so.
- No development for Rome or Roccella. No destructive cleanup. Unresolved datasets (DBT, ATM, combined layers) stay local.
- Traffic is never simulated in product code. Fixtures exist only in tests and are labelled as fixtures.
- An unknown surface is never asphalt; tram rails are map evidence, never roughness.
- No claim of physical-device validation: only emulated GPS/voice/reroute/arrival are run here.

## Acceptance criteria

- Traffic off (default, or no key, or quota spent, or provider failing): `/api/routes` payload identical to today's, apart from an
  explicit `traffic.status` field; 264-case benchmark selection unchanged.
- Traffic on: every route card carries `trafficSeconds`, `trafficDelaySeconds`, `trafficCoveragePercent`, a freshness timestamp
  and the provider name; the UI says "stima" when coverage is partial and never shows traffic it did not receive.
- Hard quota: daily and monthly counters persisted in the ledger object; one calculation can never exceed its tile cap; the
  provider is not called once a cap is reached; a 401/403/429 or three failures open a breaker. All three covered by tests.
- Provider requests per planner calculation ≤ 7, per reroute ≤ 4, in every test including all-providers-fail and slow-provider.
- Navigation outside the enriched coverage still works (region fixtures) with traffic on and off.
- Latency: measured before/after with the same replay harness; a repeated journey costs no provider request inside the memo window.
- Cars, motorcycles and bicycles each have their own assertions (traffic share, selection, budget).
- Mobile (390×844): layer panel, traffic toggle and incident list usable by tap; nothing overlaps the navigation controls.

## Tests

Unit (pure traffic code, memo, quota math, ledger with a fake storage), handler tests with recorded provider fixtures and a
fixture traffic tile built by the test helper, `npm test` (build + all node tests, ESLint, tsc), `npm run test:e2e` mocked suite,
Linux CI, and after publication a smoke test against the preview.

## Release conditions

Green Linux CI on the PR, merge to `main`, preview workflow pinned to the merged SHA through a PR, run published (the GitHub
environment gate needs the owner's approval), smoke test of the preview, pilot version unchanged. The ENGINEERING_STATUS page
separates implemented, tested, deployed; the traffic feature is "deployed, disabled" until the owner provides a key.
