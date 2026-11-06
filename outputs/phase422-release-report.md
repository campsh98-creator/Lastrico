# Lastrico — Phase 4.22 Release Report: Restore Fast Search & Fix Address Selection UX

**Date**: 2026-11-06  
**Target Environment**: `https://lastrico-pilot.campsh.workers.dev`  
**Active Branch**: `fix/mobile-navigation-stability`  
**Deployed Version ID**: `f61513e2-4e7c-481f-8b9f-8cf801d632ff`  
**Rollback Target Version ID**: `6e172128-a889-4ceb-9bf1-23bb522208a2` (or previous stable `dbb73365-5c3c-4ba9-b077-0713519b75d3`)

---

## 1. Exact Cause of the Latency Regression

During Phase 4.21, an investigation into geocoding reliability introduced a fallback chain in `app/api/geocode/route.ts` that sequentially queried upstream providers. Under this design:
- Nominatim was executed first with an isolate-level rate-limiting interval queue of `1,050 ms`.
- If Nominatim stalled, encountered rate limiting, or took several seconds, Photon was not even initiated until after Nominatim threw or timed out (`3,500 ms` server timeout).
- On the client side in `app/page.tsx`, `handleAddressInputChange` called `cancelAddressSearch()` on every single keystroke. This executed `cancelAutocomplete()`, which cleared `inlineSuggestions` (`setInlineSuggestions([])`), effectively wiping out the dropdown while the user was actively typing.
- When results finally arrived, if the user pressed Enter or clicked the search icon, it opened a secondary modal dialog (`<Dialog className="modal address-picker">`) requiring additional user interaction.
- The cache size on the Worker was limited to `100` entries, causing high cache eviction and frequent cache misses during fast typing sessions.

Combined, this resulted in keystroke-to-suggestion delays of 4 to 8+ seconds (or apparent failure when requests were repeatedly aborted and wiped by subsequent keystrokes).

---

## 2. Changes to the Address Selection UI & Architecture

To eliminate the regression and fulfill genuine mobile-first one-tap UX:

1. **Staggered Concurrent Geocoding Race (`app/api/geocode/route.ts`)**:
   - Nominatim is initiated at $t = 0$.
   - If Nominatim resolves with valid results within $250\text{ ms}$, it returns immediately (Photon is never called).
   - If Nominatim takes $> 250\text{ ms}$ or fails early, Photon is queried concurrently in parallel. Whichever upstream provider returns valid results first wins and aborts the other.
   - Server-side in-memory cache capacity increased to `2,000` entries (`CACHE_TTL_MS = 60_000` to maintain unit test compatibility and absorb autocomplete bursts).

2. **Uninterrupted Typing & Instant Client Cache (`app/page.tsx`)**:
   - Removed the destructive `cancelAddressSearch()` call from `handleAddressInputChange`. The suggestion list is no longer wiped on each keystroke.
   - Added instant client cache checks (`geocodeCacheRef.current`), rendering cached results with zero latency ($0\text{ ms}$) while revalidating.

3. **Inline Floating Dropdown Directly Beneath Active Field (`app/page.tsx` & `app/globals.css`)**:
   - Each field (Partenza and Destinazione) is wrapped in a dedicated `.route-field-wrapper`.
   - The dropdown (`#start-address-results` or `#end-address-results`) is rendered directly inside the active field's wrapper, floating with `position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 25; box-shadow: var(--shadow-float)`.
   - Suggestions appear immediately beneath the field the user is editing, without shifting the destination field or the swap button.

4. **Zero-Modal Interaction**:
   - The secondary modal dialog is completely bypassed for typing, Enter, and search icon taps.
   - Pressing Enter automatically chooses the active (or top) suggestion.
   - Tapping the search icon triggers inline autocomplete rather than a modal.

5. **Genuine Single-Tap Selection**:
   - Tapping any suggestion option (`onMouseDown={(e) => e.preventDefault()}` and `onPointerDown={(e) => e.preventDefault()}`) prevents focus loss conflicts on iOS Safari / WebKit.
   - One tap confirms the address and coordinates, closes the dropdown, and immediately blurs the input (`input.blur()`), dismissing the mobile virtual keyboard.
   - When both endpoints are confirmed, route calculation initiates automatically exactly once (`shouldAutoCalculateAfterAddressSelection`).

---

## 3. Before / After Latency Measurements

| Interaction | Before Phase 4.22 | After Phase 4.22 (Live Pilot) | Improvement |
| :--- | :---: | :---: | :---: |
| **API: Porta Romana (uncached)** | 3,200 – 6,500 ms | **542 ms** | **~85% faster** |
| **API: Largo Promessi Sposi** | 2,800 – 5,400 ms | **461 ms** | **~88% faster** |
| **API: Via Marina (Roccella Ionica)** | 2,100 – 4,800 ms | **256 ms** | **~90% faster** |
| **API: Stazione Centrale** | 3,500 – 7,000 ms | **295 ms** | **~92% faster** |
| **Client: Keystroke-to-Visible ("Duomo")** | 4,500 – 8,000+ ms (or wiped) | **1,083 ms** (incl. typing) | **Immediate / Responsive** |
| **Client: Keystroke-to-Visible ("Porta Romana")** | 5,000 – 8,500+ ms | **776 ms** (incl. typing) | **Immediate / Responsive** |
| **Client Cache Hit (repeat or backspace)** | N/A (cleared) | **< 16 ms** (0 ms network) | **Instant** |

---

## 4. Number of Taps Required: Before vs. After

- **Before Phase 4.22**:
  - Minimum **2 to 3 taps** on iOS:
    1. First tap on suggestion was often swallowed by virtual keyboard dismissal / input blur or triggered the modal dialog.
    2. Second tap required inside the modal dialog or on "Confronta i percorsi" button.
- **After Phase 4.22**:
  - Exactly **1 single tap**:
    - Typing "Duomo" → suggestions appear beneath "Partenza" → 1 tap selects "Duomo", fills field, closes dropdown, dismisses keyboard.
    - Typing "Porta Romana" → suggestions appear beneath "Destinazione" → 1 tap selects "Porta Romana", dismisses keyboard, and routes calculate automatically without any extra tap.

---

## 5. Browser & Regression Test Results

- **Unit & Integration Tests**: **359 / 359 tests passed** (`npm test`, 100% pass rate).
- **DOM & Mobile Layout Verification**: **PASS** (`tests/phase4181-ui-verification.test.mjs`, verified landscape visibility, 44px touch targets, and safe area boundaries).
- **TypeScript & Linting**: **PASS** (`npx tsc --noEmit` & `npm run lint` clean, exit code 0).
- **Production Post-Deploy Smoke Suite**: **18 / 18 checks passed** (`scripts/post-deploy-smoke.mjs` on `https://lastrico-pilot.campsh.workers.dev`):
  - Homepage & HTML headers: PASS
  - PWA Manifest & Service Worker: PASS
  - Experimental / Internal isolation: PASS
  - Autocomplete (Porta Romana, Largo Promessi Sposi, Via Marina): PASS
  - Route calculation across Car, Motorcycle, Bicycle: PASS
  - Anti-pavé alternatives generation & scoring honesty: PASS
  - GPS Navigation session creation: PASS
- **Live Mobile Safari / iPhone E2E Automation**: **PASS** (`scripts/verify-live-iphone.mjs` against live Cloudflare Worker):
  - Tested 390×844 @2x mobile viewport.
  - Duomo autocomplete visible in 1,083 ms; single tap confirmed.
  - Porta Romana autocomplete visible in 776 ms; single tap confirmed.
  - Route comparison panel with 2 distinct route cards displayed in 70 ms.
  - No leftover modals, no layout shifts, keyboard dismissed properly.

---

## 6. Cloudflare Deployment & Rollback Target

- **Production URL**: `https://lastrico-pilot.campsh.workers.dev`
- **Active Deployment Version ID**: `f61513e2-4e7c-481f-8b9f-8cf801d632ff`
- **Immediate Rollback Command**:
  ```bash
  npx wrangler rollback 6e172128-a889-4ceb-9bf1-23bb522208a2 --name lastrico-pilot
  ```
  *(Alternative previous stable version: `dbb73365-5c3c-4ba9-b077-0713519b75d3`)*

---

## 7. Release Recommendation

**RECOMMENDATION: GO (100% READY FOR USER VALIDATION)**

Both mandatory objectives of Phase 4.22 are completely satisfied:
1. Search latency regression has been eliminated with the staggered concurrent upstream race (uncached queries resolved in 250–550 ms vs. 3,000–8,000+ ms previously).
2. Address selection UX is now genuine single-tap inline autocomplete directly beneath the active input with automatic keyboard dismissal, zero modals, and single-shot route calculation.
