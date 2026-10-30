# Lastrico — Final Consolidation & Controlled Pilot Deployment Execution Prompt

## 1. Scope & Objectives

1. **Resolution of Codex Findings:**
   - **GPS progress jumps:** Constrain projection along route with dynamic forward/backward window and tolerance check (`Math.max(45, accuracy * 1.8)`), preventing parallel/future snapping while keeping legitimate loop and U-turn progress.
   - **Voice guidance:** Suppress maneuvers beyond approach thresholds (250m car/moto, 80m bike) and during inaccurate GPS (>45m); announce arrival strictly after 2+ consecutive confirmed readings within 25m accuracy.
   - **Live OSM cache consistency:** Preserve and restore `liveSegments` on cache hits across corridor expansion, guaranteeing identical scores between cold and warm requests.
   - **Route alternatives fallback:** Continue waypoint detour evaluation when Valhalla direct candidate is distinct but inadmissible (`!directHasAdmissibleAlternative`).

2. **Sanitation, Integrity & Git Consolidation:**
   - Verify TypeScript (`npx tsc --noEmit`), ESLint (`npm run lint`), production build (`npm run build`), test suite (`npm test`), and git diff formatting (`git diff --check`).
   - Create a clean local commit consolidating Phase 4.8 and Phase 4.9 verified changes without rewriting history.

3. **Cloudflare Deployment & Architecture Evaluation:**
   - Identify deployment target: Cloudflare Worker via vinext/wrangler with D1 binding (`site-creator-d1`) and OpenAI Canvas / ChatGPT Sites hosting (`https://lastrico-milano.cscda39.chatgpt.site`).
   - Verify Workers resource limits: Bundle budget < 10 MB total uncompressed, gzip ~3.03 MB, isolate memory << 128 MB, CPU time < 50ms.
   - Confirm compatibility of dual-city datasets (Milan compact tiles: 23 tiles; Roccella compact tiles: 14 tiles) in Workers static bundle assets.
   - Identify rollback procedure: git checkout of known good commit (`8fd31cd`) or prior deployment rollback in Cloudflare Dashboard.

4. **Controlled Deployment Safety & Smoke Testing:**
   - Enforce rule: Prefer isolated pilot deployment; if deployment would overwrite existing production without user approval, verify credentials and prompt user.
   - Perform live smoke tests for Milan and Roccella (routing API, surface scoring, mobile layout).
   - Document iPhone installation and field-testing instructions.
