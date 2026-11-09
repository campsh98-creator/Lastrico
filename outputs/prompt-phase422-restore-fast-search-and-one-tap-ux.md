# Lastrico — Phase 4.22 Execution Prompt: Restore Fast Search & One-Tap Address Autocomplete UX

## 1. Scope
- Eliminate the address search latency regression observed on the deployed pilot.
- Measure keystroke-to-visible-suggestion latency and optimize end-to-end performance.
- Position autocomplete suggestions directly beneath the active address field (`start-search` or `end-search`).
- Keep typing uninterrupted while suggestions are loading (no clearing on keystroke).
- Eliminate the modal dialog during typing and search (no `address-picker-modal`).
- Ensure one single tap on any suggestion selects the address and coordinates without blur conflicts or layout shifts.
- Maintain single-shot automatic route calculation once both endpoints are confirmed.
- Respect OpenStreetMap / Nominatim rate limits and usage policies while maintaining reliability.

## 2. Limitations
- Public OSM Nominatim has a 1 req/s policy and can experience intermittent latency from cloud egress IPs.
- Open-source Photon has variable response latency (~2-2.5s) and must not be allowed to slow down fast Nominatim responses.
- Simulated browser viewports (headless Chrome) must accurately mirror physical mobile touch semantics (`pointerdown`, layout bounds, virtual keyboard insets).

## 3. Acceptance Criteria
1. **Search Latency**:
   - Uncached address search returns in < 800ms.
   - Cached/prefix search returns in < 5ms.
   - End-to-end keystroke-to-visible-suggestion latency is under 600ms on first search, < 50ms on repeat/cached search.
2. **Address Selection UX**:
   - Suggestions appear in an inline dropdown directly beneath the field the user is typing in.
   - Typing is smooth and uninterrupted; existing suggestions are not wiped on every keystroke.
   - No secondary modal dialog ever opens on typing, Enter, or search icon tap.
   - One tap on a suggestion immediately selects the address and sets coordinates.
   - Mobile keyboard is dismissed upon selection without requiring a second tap.
   - When both origin and destination are valid, route calculation fires automatically exactly once.
3. **Automated Verification**:
   - All unit tests pass (`node --test tests/*.test.mjs`).
   - TypeScript checks and lint pass with 0 errors.
   - Post-deployment smoke test (`scripts/post-deploy-smoke.mjs`) passes 18/18 on the live Cloudflare pilot.
   - Real mobile browser CDP test confirms the complete interaction on `https://lastrico-pilot.campsh.workers.dev`.

## 4. Release Conditions
- Feature branch: `fix/mobile-navigation-stability`.
- Deploy strictly to `lastrico-pilot.campsh.workers.dev`.
- Record previous version ID, new version ID, and rollback target.
- Document before/after latency measurements and tap counts.
- Keep final user communication in Italian, concise, and nontechnical.
