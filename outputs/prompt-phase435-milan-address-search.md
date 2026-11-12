# Phase 4.35 — reliable Milan address search: execution prompt

Date: 12 November 2026. Base: `main` at `8370bf7` (Phase 4.34 on the pilot, version `fe69e630`).
Branch: `fix/phase435-milan-address-search`. Milan only; Rome untouched; Roccella preserved.

## 1. Recovered work (Antigravity, interrupted on 12 November 2026 ~14:55 UTC)

Both investigations stopped without a report when Antigravity became unavailable. Recovered from
`~/.gemini/antigravity/brain/{d9a704f0…,2dcecdf0…}` (scripts, tool output, task logs):

- **Task A (backend)**, evidence only, no conclusions written:
  - Live pilot, 14:44 UTC: `Via Filippo Argelati[, Milano]`, `Filippo Argelati`, `Argelati`,
    `Via Argelati` → HTTP 200 with the street (2–6 results).
  - Direct Nominatim: full names found; prefixes are not (`Via Filippo Argel` → 0);
    `Via F. Argelati` → 0; house number 12/20 found.
  - Direct Photon: 28–36 s per answer, one HTTP 502.
  - Cloudflare GraphQL: `clientDisconnected` invocations and `notDone` subrequests on 12 Nov.
    The telemetry (log) API answered 403: no historical log lines are available.
- **Task B (frontend)**, a Chrome (not Edge: not installed) stress run on the live pilot, 24 of a
  planned 40 edits before the interruption:
  - Edits 1–6 worked.
  - From edit 7 on, every query not already cached got **HTTP 503 after ~4.3 s**
    (Via Savona, Stazione Centrale, Piazzale Loreto, Navigli, Darsena, Via Fil).
  - Argelati kept working only because it was cached in the browser.
  - The UI showed no list and no message for the 503s.

## 2. Verified root causes (reproduced on 12 Nov 2026 15:19–15:22 UTC, `wrangler tail`)

1. **Backend: the per-isolate Nominatim queue is poisoned by cancelled requests.**
   - `createGeocodeFetcher` chains every Nominatim call on one module-level promise.
   - The page aborts its previous request at each keystroke. Workers then cancels that
     invocation (tail outcome `canceled`), so its link in the chain never settles.
   - Every later Nominatim call in that isolate waits on the dead link and dies at the 3.5 s
     deadline (`Geocoding timed out`).
   - Reproduction: one typing burst of 12 aborted requests on the live pilot. The final query
     and every new query for the next two minutes returned 503. Over the same minutes, Nominatim
     queried directly answered in 0.8–1 s.
2. **Backend: Photon is unavailable, so nothing catches the failure.**
   - The public Photon timed out at 4 s for every query, and directly at 15 s.
   - With Nominatim stuck, every uncached search ends in `503` at ~4.25 s
     (250 ms stagger + 4 s Photon deadline).
3. **Backend: partial input has no provider that matches it.**
   - Nominatim does not match prefixes (`Via Filippo Argel` → `[]` after 4.3 s).
   - The empty answer is cached by the browser for 5 minutes (`max-age=300`).
4. **Policy: autocomplete uses Nominatim.**
   - The public Nominatim policy forbids search-as-you-type and allows at most 1 request/s.
   - Photon's public instance is fair-use, with no availability guarantee.
5. **Frontend: failures are silent.**
   - `runAutocomplete` swallows every error ("Do not surface premature errors while typing"),
     the explicit search button and Enter included.
   - It never sets a loading state.
   - A 503, a timeout and "street does not exist" all look the same: nothing happens.

Not confirmed: whether the user's historical Edge session hit exactly this. No log lines exist
for it. Edge was not available on this machine; Chromium is the same engine.

## 3. Scope

### Backend (`lib/geocoding.ts`, `app/api/geocode/route.ts`)

- **Rate limiter without cross-request promises.**
  - Each call reserves its own start time from a plain number, then waits in its own request.
  - It fails fast when the wait would exceed its deadline.
  - A cancelled reservation that never started gives its slot back.
- **Purposes.**
  - `purpose=suggest` (typing) never calls Nominatim: Photon only, behind a circuit breaker.
  - `purpose=search` (Enter, the search button, Calcola, or resolving a house number on
    selection) uses Nominatim first, with Photon as fallback.
  - A request without `purpose` keeps today's behaviour, so Roccella and old clients do not
    change.
- **Circuit breakers per provider and isolate.**
  - After a timeout, a 429 or a 5xx, the provider is skipped for a cool-down (Retry-After
    honoured, bounded), so answers come back fast instead of at 4.3 s.
- **Errors and caching.**
  - Errors carry `retryable` and `reason`.
  - An empty answer is cached for at most 60 s, and only when a provider actually answered.

### Local Milan street index (static asset, zero Worker CPU)

- `scripts/osm/fetch-milan-street-names.mjs`: one Overpass snapshot of every named highway
  way inside the Comune di Milano, with Municipi and quarters, plus a provenance manifest
  (query, endpoint, osm_base, sha256).
- `scripts/osm/build-milan-street-index.mjs`, deterministic:
  - one entry per street, grouping segments with the same name within 800 m;
  - a representative point that is a real node of the street;
  - Municipio and nearest quarter for the second line;
  - variants from `alt_name`/`official_name`/`old_name`;
  - output `public/data/milan-streets-v1.json` plus a manifest with counts, attribution and
    sha256.
- `lib/street-index.ts`, a pure search used in the browser:
  - accent- and case-insensitive;
  - abbreviations (`v.`, `p.za`, `c.so`, `v.le`, `p.le`, `l.go`, `s.`);
  - initials (`F.` matches `Filippo`) and optional particles (`di`, `del`, …);
  - prefix of the last word;
  - a trailing house number is parsed and kept separate from the street;
  - `, Milano` and postcodes are ignored.
- The index is loaded once, lazily, on the first address focus in Milan. The service worker
  caches it as an ordinary static asset.

### Frontend (`app/page.tsx`)

- **Typing in Milan.**
  - Street matches from the local index appear instantly.
  - A debounced `purpose=suggest` request adds places and house numbers.
  - The results are merged, de-duplicated and ranked.
- **Status inside the list (`role=status`), always honest:**
  - searching places…;
  - "Ricerca luoghi non disponibile: mostro le vie" when the remote search failed;
  - "Nessun risultato" only when both the index and a provider answered empty;
  - a retry button for a retryable failure.
- **Explicit search.** Enter or the search button with no suggestion chosen sends
  `purpose=search`, shows a spinner and shows a visible error instead of nothing.
- **House numbers.**
  - A street suggestion with a typed number ("Via Filippo Argelati 12", street-level) is
    resolved on tap with one `purpose=search` call.
  - If the civic number is not found, the street position is used and the status says so.
  - A street-level result is never presented as a verified house position.
- **Calcola with typed text.** Server results as before; the local index is the fallback when
  the server fails.
- Unchanged: one-tap selection, keyboard navigation, the swap button, the Premium UI, GPS and
  routing.

## 4. Limitations

- Coverage is measured, not promised: the share of a reference list of Milan street names
  found in the top 5 is reported. The index is as complete as OSM.
- House numbers still depend on Nominatim or Photon, called once per selection or explicit
  search.
- Places (stations, venues, quarters) still need a provider. During a joint outage only streets
  and squares are found, and the UI says so.
- The in-isolate limiter is per isolate; a global 1 req/s needs shared state (Durable Object),
  which is out of scope.

## 5. Acceptance criteria

1. `Via Filippo Argelati`, `Argelati`, `argel`, `Via F. Argelati`, `V. Filippo Argelati`,
   `via filippo argelati, milano`, `Via Filippo Argelati 12` all show Via Filippo Argelati
   first, with every provider down.
2. Representative central and peripheral streets (Quarto Oggiaro, Gallaratese, Baggio,
   Gratosoglio, Ponte Lambro, Figino, Chiaravalle, Rogoredo, Bicocca, Lorenteggio) are found
   from the index.
3. 50 consecutive origin/destination edits (typing, deleting, swap, select, edit during route
   calculation) in Chromium: each edit ends with the right list or an honest status, never a
   frozen field. A stale response never shows.
4. The provider fault matrix (timeout, empty, 429, 503, aborted, out-of-order) shows the right
   status and recovers on the next edit.
5. The backend limiter: a cancelled caller never blocks later callers (unit test reproducing
   the poisoned queue). Typing never reaches Nominatim (API test).
6. Roccella answers as before; Rome files untouched; `scripts/prepare-milan-release.mjs` still
   strips Rome.

## 6. Tests and release conditions

- `tsc --noEmit`, ESLint, full `npm test` (build + node tests), Milan release preparation with
  its tests in the release copy, browser E2E (existing acceptance suite with mocks plus the new
  Phase 4.35 address stress).
- Before and after measured on the same scripts.
- No deploy, no merge: a PR targeting `main`. Deploying to the pilot needs separate approval.
