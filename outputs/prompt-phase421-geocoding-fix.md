# Lastrico — Phase 4.21: Critical Production Geocoding Fix Execution Specification

## 1. Context & Problem Statement
- **Incident**: Production geocoding autocomplete failure on `https://lastrico-pilot.campsh.workers.dev` (Priority P0).
- **User Symptom**: On iPhone / mobile Safari, entering an address or typing in the search bar triggered `"Ricerca degli indirizzi temporaneamente non disponibile."` (or `"La ricerca indirizzi è temporaneamente indisponibile."`), blocking address selection and route planning.
- **Root Cause**:
  1. **Head-of-Line Blocking in Isolate Queue**: `createGeocodeFetcher` in `lib/geocoding.ts` serialized requests with a `minimumIntervalMs = 1_050` ms delay. Rapid keystrokes during client autocomplete (`AUTOCOMPLETE_DEBOUNCE_MS = 320` ms) accumulated in the queue.
  2. **Timeout Inconsistency**: The server had an 8,000 ms hard-coded timeout (`timeoutMs = 8_000`), while the client timeout was 12,000 ms (`ADDRESS_SEARCH_TIMEOUT_MS = 12_000`). When queue delay exceeded 8 seconds, requests aborted with `TimeoutError` and returned HTTP 503.
  3. **Lack of Server Caching**: The API endpoint `app/api/geocode/route.ts` did not cache responses across keystrokes or repeated queries in the isolate, forcing every autocomplete query to hit Nominatim and enter the serialized queue.
  4. **Error Masking**: Exceptions in `app/api/geocode/route.ts` were caught without error logging, concealing upstream timeout/error details.

## 2. Scope & Implementation Boundaries
- **Scope**:
  - Implement an in-isolate LRU cache in `app/api/geocode/route.ts` (capacity: 200 items, TTL: 60s) to absorb typing bursts and repeated queries with instant (< 1 ms) responses.
  - Align `createGeocodeFetcher` default `timeoutMs` to 12,000 ms to match client-side timeout budget.
  - Early-exit pre-aborted caller signals in `createGeocodeFetcher` to avoid enqueuing dead requests.
  - Add diagnostic error logging (`console.error`) in the catch block of `/api/geocode`.
  - Maintain all existing regex patterns tested by `tests/rendered-html.test.mjs` (`NOMINATIM_MIN_INTERVAL_MS = 1_050`, `fetchNominatim`, `set("limit", "10")`, etc.).
  - Preserve single-shot calculation, one-tap selection, and all Phase 4.21 UI/routing features.
- **Non-Goals / Limitations**:
  - Do not introduce paid APIs or external dependencies.
  - Do not modify routing logic, navigation state, or scoring algorithms.
  - Do not merge into or modify `main`. Deploy strictly to `lastrico-pilot`.

## 3. Acceptance Criteria
1. Automated unit test suite (`tests/geocode-api.test.mjs`, `tests/geocoding.test.mjs`, `tests/rendered-html.test.mjs`, `tests/pilot-areas.test.mjs`, `tests/phase414-one-tap-autocomplete.test.mjs`, `tests/deploy-pilot-config.test.mjs`) passes 36/36.
2. TypeScript compilation (`npx tsc --noEmit --incremental false`) and ESLint (`npm run lint`) pass with 0 errors.
3. Deploy to `lastrico-pilot.campsh.workers.dev` via `npm run deploy:pilot` succeeds and outputs active Version ID.
4. Live verification of 5 mandatory queries on production pilot returns HTTP 200 with valid coordinates:
   - `Porta Romana, Milano`
   - `Largo Promessi Sposi, Milano`
   - `Duomo, Milano`
   - `Stazione Centrale, Milano`
   - `Via Marina, Roccella Ionica`
5. Rapid mobile typing simulation on production pilot returns 100% HTTP 200 with 0 errors.
6. Post-deployment smoke test (`scripts/post-deploy-smoke.mjs`) completes 18/18 PASS.
