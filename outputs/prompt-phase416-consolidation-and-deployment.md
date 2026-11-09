# Lastrico — Phase 4.16 Execution Prompt: Consolidation & Controlled Cloudflare Pilot Deployment

## 1. Context & Baseline
- **Repository**: `/Users/campsh/Documents/Codex/Lastrico-App-Anti-Pave`
- **Active Branch**: `fix/mobile-navigation-stability` (tracking `origin/fix/mobile-navigation-stability`)
- **Completed Work to Consolidate**:
  - **Phase 4.13**: 117-tile citywide Milan authentic OSM surface coverage (`data/surfaces/milan-compact-tiles.json`), southern Milan corridors (Porta Romana → Largo Promessi Sposi), and simplified consumer-first UI.
  - **Phase 4.14**: True one-tap address autocomplete suggestion selection (`onPointerDown`/`onMouseDown` preventing blur loss), mobile Safari/WebKit keyboard dismissal without input reflow, and automatic single-shot route calculation when both addresses are valid.
  - **Phase 4.15**: Large-scale routing stress test (150+ scenarios across Auto, Moto, Bici in Milan and Roccella Ionica) and fixes for geocoding, boundary cases, and surface accounting.

## 2. Scope & Objectives
1. **Git Consolidation**:
   - Verify uncommitted files against secrets, artifacts, personal data, and accidental files.
   - Stage and commit Phase 4.13–4.15 work in clean, logical commits.
   - Verify local branch status with `git status` and ensure safe synchronization with `origin/fix/mobile-navigation-stability`.
   - Push feature branch only if synchronization is safe (no force-push, no merge into `main`).

2. **Final Technical Validation**:
   - 117 Milan surface tiles verification (manifest integrity, SHA-256 provenance, coverage over southern/western/northern/eastern corridors).
   - Roccella Ionica compact tiles verification.
   - Core regression test suite (326+ tests passing).
   - TypeScript compilation (`npx tsc --noEmit --incremental false`) and ESLint (`npm run lint`).
   - Production build check (`WRANGLER_LOG_PATH=.wrangler/wrangler.log vinext build`).
   - Representative real-provider / browser smoke tests for one-tap autocomplete, multi-mode routing, and navigation lifecycle.

3. **Controlled Cloudflare Deployment**:
   - Target strictly isolated to `lastrico-pilot` (`https://lastrico-pilot.campsh.workers.dev`).
   - Query currently active deployment ID and record previous version ID for immediate rollback capability.
   - Execute deployment via `node scripts/deploy-pilot.mjs`.
   - Record newly deployed version ID and deployment timestamp.

4. **Post-Deployment Verification**:
   - HTTPS live smoke tests on `https://lastrico-pilot.campsh.workers.dev`:
     - Map and app loading.
     - Address geocoding and autocomplete suggestions.
     - Automatic route calculation on single-tap selection.
     - Southern corridor: Porta Romana → Largo Promessi Sposi.
     - Distinct anti-pavé alternative route verification.
     - Car, Motorcycle, Bicycle modes.
     - Navigation start and stop.
   - Confirm rollback availability.
   - Assess GO / NO-GO for physical iPhone testing.

## 3. Limitations & Constraints
- No new features, redesigns, or unrelated changes.
- Never merge into `main` or touch other projects/Cloudflare workers.
- Preserve honest product behavior: unmapped roads remain unknown; external maps remain fallbacks.
- Keep user communication concise, nontechnical, and in Italian.
