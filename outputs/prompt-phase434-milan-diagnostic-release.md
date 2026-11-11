# Execution Prompt: Phase 4.34 Milan Diagnostic Release & Physical iPhone Test Readiness

**Release Owner:** Release & Integration Team  
**Date:** 2026-11-11  
**Target Pilot:** `https://lastrico-pilot.campsh.workers.dev`  
**Base Commit:** `336462d468fa78444624dd1fb70cfc2f1bdcff05` (PR #12 merged to `main`)  
**Previous Pilot Version:** `170ac277-c990-4416-86d1-21c8da7f5a40` (Phase 4.33, Durable Object routing)

---

## 1. Scope & Goals

1. **Phase 4.34 Navigation Diagnostics Deployment**:
   - Release opt-in, client-side-only GPS trace recording (Trace Format v2).
   - Enable local trace storage, GPX/JSON export, and complete local trace deletion.
   - Retain existing Durable Object architecture for Milan and Roccella on Cloudflare Workers Free.
2. **Selective Milan-Only Release (Deployment Isolation)**:
   - Compile a production artifact strictly containing Milan and Roccella Ionica.
   - Exclude all Rome runtime code, datasets (`rome-tiles`, `rome-tiles-packed`, `rome-compact-tiles.json`), and city selection references.
   - Rome remains 100% intact in the canonical repository, but excluded from the pilot bundle.
3. **Safety & Privacy Verification**:
   - Diagnostic recording MUST be disabled by default.
   - Zero automatic uploads of GPS traces or coordinates to Cloudflare or external servers.
   - Diagnostic overhead with recording OFF must be completely inert (no extra object creation or CPU load).
4. **Physical iPhone Test Readiness**:
   - Provide clear, safe Italian instructions for test corridors in Milan.
   - No phone handling while operating a vehicle.

---

## 2. Safety Gates & Pre-Release Checklist

| Check | Gate Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Commit Baseline** | `main` at or ahead of `336462d4` | `git rev-parse HEAD` | Verified (`336462d4`) |
| **CI Status** | GitHub Actions green on `main` | `gh run list --branch main` | Verified (Run 43011614795 PASS) |
| **Local Quality** | Typecheck, lint, and full tests pass | `npx tsc`, `npm run lint`, `npm test` | Required before deploy |
| **Rome Exclusion** | Zero Rome data or code in compiled bundle | `scripts/deploy-pilot.mjs` selective release & bundle grep | Mandatory gate |
| **Workers Free** | Stay strictly within Workers Free limits | Check Durable Object bindings, bundle gzip | Mandatory gate |
| **Rollback Plan** | Verify rollback target and command | `npx wrangler rollback` / `170ac277` verified | Mandatory gate |

---

## 3. Production Smoke Verification Criteria

1. Autocomplete for Milan (`Porta Romana`, `Duomo`) and Roccella (`Via Marina`).
2. Routing calculations across Car, Motorcycle, Bicycle.
3. Anti-pavé alternatives and Pareto trade-off honesty.
4. Core junction regressions (Viale Sabotino/Filippetti, Moscova → Crocetta).
5. Opt-in GPS diagnostics toggle, recording, export (JSON/GPX), and deletion.
6. Verification that network logs carry no trace uploads.
7. Surface warning HUD popups and traffic signal visibility.
8. Responsive layout on iPhone dimensions (390×844).

---

## 4. Rollback Conditions

If any of the following occur on production:
- Worker CPU limit exhaustion (HTTP 503 errors).
- Accidental Rome exposure in the UI or API.
- Automatic GPS network requests.
- Failure of address search or routing calculations.
Execute immediate rollback:
```bash
npx wrangler rollback 170ac277-c990-4416-86d1-21c8da7f5a40 --name lastrico-pilot
```
