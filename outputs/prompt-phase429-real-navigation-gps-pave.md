# Lastrico — Phase 4.29 Execution Prompt: real navigation (GPS start, smooth movement, missed pavé)

## 1. Checkpoint (2026-11-08)

- Local HEAD `733518b`; `origin` at `66bdccd`.
- Pilot `03a6776e`: Milan only, built from `66bdccd` + `cb8fbbe` + `69678e3`.
- Field test on a physical iPhone (installed Safari PWA), Piazza Gae Aulenti → Largo Promessi Sposi. About 90% satisfactory. Three defects reported:
  1. The arrow jumps.
  2. The GPS start is slow and inaccurate.
  3. About 1 km of sampietrini in the first 10 minutes was not marked or announced.

## 2. Root causes (code evidence)

| Defect | Cause |
|---|---|
| Jumping arrow | `app/page.tsx` moves the marker with `marker.setLngLat(journeyPosition)` once per accepted fix, about 1 Hz on iOS, with no interpolation. `processGpsFix` (`lib/navigation-fix-processor.ts`) holds the marker until it has moved 4–15 m (`markerMovementThreshold`), then releases the whole step at once. The camera eases over 650 ms with ease-in-out while the marker teleports. The arrow rotation also changes in steps. The displayed point is the filtered raw GPS, never the matched point on the route, so error across the road shows as sideways jumps. |
| GPS start | Every fix up to ±120 m is accepted as "GPS attivo" from the first reading. There is no "approximate" state. `smoothGpsCoordinate` weights the new fix only by its own accuracy, so a precise fix arriving after a poor one keeps 28–78% of the poor position. Off-route detection runs from the second fix, and its threshold grows with the reported accuracy. In an urban canyon (Porta Nuova towers) the reported accuracy understates the error, so an early wrong reroute can replace the chosen route. A reroute without a distinct alternative falls back to the fastest route. |
| Missed ~1 km of pavé | **E (certain):** the app has no pavé warning at all during navigation. Pavé is only drawn on the map (`problemSegments`), and the voice speaks only manoeuvres. **A (most likely, unconfirmed):** current OSM (Overpass 2026-11-08) has no surface change against the archive. Every sett/cobblestone corridor of 400 m or more in the area is already classified as rough. The fastest car/motorcycle variant (Via Legnano → Viale Gadio → Foro Buonaparte, minutes 5–10) runs 1,029 m along tram tracks on carriageways tagged `asphalt`, with no `embedded_rails` tag; only 201 m + 105 m are tagged `sett`. Matching is exact (route-to-way distance 0.0 m), so C is excluded on the reconstructed routes. **G (possible):** a startup reroute from an inaccurate fix can move the user from the anti-pavé route to the fastest one. Without the trace this stays a hypothesis. |

## 3. Scope

1. **GPS acquisition.**
   - Accuracy-weighted fusion: a precise fix replaces a poor estimate.
   - Quality states: searching, approximate, accurate, lost, resumed. These are shown honestly.
   - Startup grace: no reroute while the position is still approximate. The grace ends after 30 s, so navigation is never blocked for good.
   - The route-matched position and the route bearing are displayed only when the match is confident.
2. **Smooth movement.**
   - Timestamp-paced interpolation of the marker toward each new position: along the route when matched, never beyond the last fix.
   - The camera eases linearly over the same interval.
   - The arrow rotates smoothly on the shortest path.
   - No animation for relocations or large jumps. Reduced motion is respected.
3. **Pavé warnings.**
   - The server returns `roughSections`: contiguous rough stretches merged across gaps of 25 m or less, with confirmed and probable metres, positioned along the route geometry. They are computed in the existing scoring pass, at no extra CPU.
   - A pure warning engine announces each section once, with lead time (car/motorcycle 250 m, bicycle 100 m). If the lead point was skipped it still announces on entry; the same physical section is not announced again after a reroute. Confirmed and probable are worded differently. Short sections appear on the HUD only.
   - A visible HUD line in navigation. The voice never cuts a manoeuvre instruction.
4. **Data.** No reclassification without evidence. Deliver a shortlist of candidate corridors and the smallest observation the user needs to make.

## 4. Limits

- No push, merge or deploy; the pilot stays `03a6776e`. No new branch or worktree. Rome stays local.
- No raw GPS history is stored or sent. The existing trace recorder stays opt-in and local.
- No extra provider calls. Worker CPU is not increased beyond the per-index bookkeeping.
- Synthetic traces are never reported as iPhone results.

## 5. Acceptance

- Unit tests for fusion, acquisition states, startup grace, interpolation and the warning engine. Each covers:
  - cold start in an urban canyon;
  - parallel streets;
  - outage and recovery;
  - out-of-order and duplicate fixes;
  - stationary periods and U-turns;
  - long sections with intermittent GPS;
  - reroute before and inside a section;
  - adjacent segments;
  - missing evidence;
  - all three transport modes.
- API test for `roughSections`.
- The browser acceptance suite (71 scenarios) plus new scenarios for:
  - smooth marker steps;
  - the approximate-to-accurate transition;
  - the pavé HUD and voice;
  - no startup reroute.
- Before/after measurements on the same synthetic traces:
  - largest marker step per frame;
  - time to accurate state;
  - false reroutes at cold start;
  - warning lead time and missed or duplicate warnings.
- `tsc`, lint, `npm test`, build and the dry run all pass. A Milan-only GO/NO-GO is given.
