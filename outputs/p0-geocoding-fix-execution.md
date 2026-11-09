# Lastrico — P0 Production Hotfix: Address Search on Mobile / iPhone

## 1. Incident Description
Users on mobile devices (specifically iPhone / iOS Safari) experienced a persistent failure when searching for addresses on the deployed Cloudflare pilot (`https://lastrico-pilot.campsh.workers.dev`):
- Typing "Porta Romana", "Duomo", or "Via Marina" displayed: *"Ricerca degli indirizzi temporaneamente non disponibile."*
- Address selection and route planning were blocked.

## 2. Root Cause Analysis
Three distinct issues combined to break the user experience on mobile:

1. **Nominatim Tarpitting / Timeout on Cloudflare Worker Egress**:
   - Cloudflare edge nodes making outbound HTTP requests to `nominatim.openstreetmap.org` are frequently rate-limited or tarpitted (TCP connections stalling for >10-30s).
   - In `lib/geocoding.ts`, `createGeocodeFetcher` serializes requests per-isolate. When an egress call stalled, it hit the 12,000ms timeout (`DOMException("Geocoding timed out", "TimeoutError")`), causing the Worker to return `HTTP 503 {"error":"La ricerca indirizzi è temporaneamente indisponibile."}`.
   - Without an independent open-source OSM fallback, Nominatim degradation completely halted address discovery in production.

2. **Client-side Autocomplete Response Suppression (`shouldApplyAutocompleteResponse`)**:
   - In `lib/planner-support.ts` line 158:
     `if (input.activeTarget !== input.responseTarget) return false;`
   - When users typed on mobile iOS, virtual keyboard events, focus changes, or touches caused `focusedAddressFieldRef.current` to become `null`.
   - When the response returned, `input.activeTarget` was `null` while `responseTarget` was `"start"` or `"end"`.
   - `shouldApplyAutocompleteResponse` evaluated `null !== "end"` as true, returning `false` and discarding valid suggestions.

3. **iOS Safari Lost Tap on Virtual Keyboard Dismissal**:
   - In `app/page.tsx` (lines 2717 and 3244), suggestions had `onMouseDown={(e) => e.preventDefault()}`.
   - On iOS Safari touchscreens, `mousedown` only fires after `touchend`.
   - Touching an item caused `<input>` to blur, triggering keyboard dismissal and a layout shift under the finger before the `click` event could fire.
   - The user had to tap a second time after the keyboard closed.
   - Adding `onPointerDown={(event) => event.preventDefault()}` prevents blur on modern iOS Safari on the very first touch.

## 3. Scope of Fix
1. **Upstream Geocoding Resilience (`app/api/geocode/route.ts`)**:
   - Reduce Nominatim per-request timeout to 3,500ms so it does not block the user or isolate queue.
   - Implement an open-source OSM Photon fallback (`https://photon.komoot.io/api/`) bounded to the pilot bounding box.
   - If Nominatim fails or times out, Photon immediately fulfills the request with genuine OpenStreetMap coordinates.
   - Maintain full compatibility with existing tests in `tests/rendered-html.test.mjs` and `tests/geocode-api.test.mjs`.
2. **Client-side Autocomplete Acceptance (`lib/planner-support.ts`)**:
   - Update `shouldApplyAutocompleteResponse`:
     `if (input.activeTarget !== null && input.activeTarget !== input.responseTarget) return false;`
   - Ensure suggestions display even if the input lost active focus during network flight, provided the query text matches.
3. **Touch & Tap Responsiveness (`app/page.tsx`)**:
   - Add `onPointerDown={(event) => event.preventDefault()}` to all address suggestion items.
4. **Unit Tests**:
   - Add test coverage for `shouldApplyAutocompleteResponse` with `activeTarget: null`.
   - Add tests for Photon fallback response mapping and error resilience in `tests/geocode-api.test.mjs`.

## 4. Acceptance Criteria
- [x] Typing "Porta Romana", "Duomo", "Via Marina" in mobile viewport yields instant suggestions without 503 errors.
- [x] One single tap on any suggestion selects the address, updates the input, hides suggestions, and auto-calculates route if both endpoints are set.
- [x] All 18 post-deployment smoke tests pass on the live Cloudflare pilot.
- [x] Real-browser headless test confirms mobile touch selection and route rendering on `https://lastrico-pilot.campsh.workers.dev`.

## 5. Release Conditions
- Pass all unit tests (`node --test tests/*.test.mjs`).
- Pass TypeScript checks (`tsc --noEmit`) and ESLint.
- Deploy cleanly to Cloudflare Worker `lastrico-pilot`.
- Run post-deploy smoke suite (`scripts/post-deploy-smoke.mjs`) -> 18/18 PASS.
- Communicate in Italian, concise, and nontechnical.
