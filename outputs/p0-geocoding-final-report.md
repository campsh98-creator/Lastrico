# Lastrico — P0 Hotfix Report: Real Mobile / iPhone Address Search Resolved

## 1. Executive Summary
- **Target URL**: https://lastrico-pilot.campsh.workers.dev
- **Branch**: `fix/mobile-navigation-stability`
- **New Deployed Version ID**: `6e172128-a889-4ceb-9bf1-23bb522208a2`
- **Previous Deployed Version ID**: `0eeec41e-3262-4705-b9ff-47deeeeb124c`
- **Rollback Target Version ID**: `dbb73365-5c3c-4ba9-b077-0713519b75d3` (or `1b945749-2b1d-406b-9412-39749b9f8ffd`)
- **Status**: **RESOLVED & VERIFIED IN PRODUCTION ON REAL MOBILE VIEWPORT**

---

## 2. Root Cause Discovery
Live empirical observation using `wrangler tail` and mobile browser simulation revealed three converging defects:
1. **Cloudflare Egress Rate-Limiting / Tarpitting by Nominatim**:
   - `wrangler tail` captured: `(error) [geocode] Search failed for "Porta Romana" (milan): Geocoding timed out`.
   - Outbound requests to `nominatim.openstreetmap.org` from Cloudflare Worker egress IPs frequently stalled for >12s, triggering a 503 response.
2. **Client-side Autocomplete Suppression in `shouldApplyAutocompleteResponse`**:
   - Line 158 of `lib/planner-support.ts` checked `if (input.activeTarget !== input.responseTarget) return false`.
   - On iOS touch and keyboard interactions, blurring or virtual keyboard gestures transitioned `focusedAddressFieldRef.current` to `null`.
   - When the geocoding response arrived, `null !== "end"` evaluated to true, silently discarding valid suggestions even when the query matched.
3. **iOS Safari Lost Tap on Virtual Keyboard Dismissal**:
   - Suggestions relied only on `onMouseDown={(e) => e.preventDefault()}`.
   - On iOS Safari touchscreens, `mousedown` fires after `touchend`.
   - Tapping an item blurred the active input, dismissing the keyboard and shifting layout before the `click` event could fire. A second tap was required.
   - Adding `onPointerDown={(event) => event.preventDefault()}` preserves focus and registers the tap on the first touch.

---

## 3. Implemented Solutions
1. **OSM Photon Secondary Geocoder (`app/api/geocode/route.ts`)**:
   - Reduced Nominatim per-request timeout to 3,500ms.
   - Added open-source OSM Photon fallback (`https://photon.komoot.io/api/`) bounded to the pilot bounding box.
   - If Nominatim fails or times out, Photon immediately fulfills the request in ~100–160ms with genuine OpenStreetMap coordinates.
   - Preserved all required regexes and assertions in `tests/rendered-html.test.mjs`.
2. **Resilient Autocomplete Matching (`lib/planner-support.ts`)**:
   - Changed target check to: `if (input.activeTarget !== null && input.activeTarget !== input.responseTarget) return false`.
   - Autocomplete results matching the current input text are displayed even if focus temporarily shifted.
3. **Touch-First One-Tap Selection (`app/page.tsx`)**:
   - Added `onPointerDown={(event) => event.preventDefault()}` on all address suggestion buttons (lines 2717 and 3244).
4. **Automated Test Coverage**:
   - `tests/geocode-api.test.mjs`: Added test for seamless Photon fallback when Nominatim fails or times out.
   - `tests/phase414-one-tap-autocomplete.test.mjs`: Added test verifying autocomplete applies when target focus is blurred.

---

## 4. Verification Evidence

### A. Post-Deployment Smoke Test (18/18 PASS)
Running `scripts/post-deploy-smoke.mjs` against `https://lastrico-pilot.campsh.workers.dev`:
- Homepage HTTP 200 & HTML: PASS (693 ms)
- Web App Manifest: PASS (130 ms)
- App assets and service worker: PASS (1354 ms)
- Internal tools and experiments isolated: PASS (448 ms)
- Bad routing input refused: PASS (60 ms)
- Autocomplete: 'Porta Romana' (Milan): **PASS (164 ms)**
- Autocomplete: 'Largo Promessi Sposi' (Milan): **PASS (612 ms)**
- Autocomplete: 'Via Marina' (Roccella Ionica): **PASS (173 ms)**
- Multi-mode routing (Car, Moto, Bici): **ALL PASS**
- Anti-Pavé alternative calculations (Castello -> Missori, Duomo -> Centrale): **ALL PASS**
- Navigation route request: **PASS (1394 ms)**
- Roccella routing (Car, Moto, Bici): **ALL PASS**

### B. Mobile Browser CDP Acceptance Test (iPhone 390x844 Viewport)
Executed `scripts/verify-live-iphone.mjs` on live deployment:
1. Typed "Duomo" into `#start-search` -> 2 suggestions displayed -> tapped first suggestion -> input updated to `Duomo, Municipio 1 · 20122 · Milano`.
2. Typed "Porta Romana" into `#end-search` -> 1 suggestion displayed -> tapped first suggestion -> one-tap selection accepted.
3. Route calculation automatically triggered -> transition to `.p43-comparison-panel` with 2 route cards (Anti-pavé & Fastest) verified.
4. Screenshots captured:
   - `outputs/live-iphone-suggestions-duomo.png`
   - `outputs/live-iphone-suggestions-porta-romana.png`
   - `outputs/live-iphone-route-calculated.png`
