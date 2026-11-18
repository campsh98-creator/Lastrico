# Road intelligence: tram-track preference and map view (18 November 2026)

**Status: local experiment, off by default, not deployed.** It runs only with `LASTRICO_SIL_EXPERIMENT=rails` and a locally
generated layer set (`data/surfaces/sil-layers/`, git-ignored). The layers mix OSM, Comune di Milano DBT 2020 and ATM data
whose licences are not settled (see `ROAD_INTELLIGENCE_LICENSING.md`): they stay on the machine and are not published.

## What was built

- **Preference `tram=avoid`** on `/api/routes` (independent of `avoid=balanced|strong|maximum`): the planner makes one more
  penalised Valhalla search from the slices of the fastest route that run on mapped shared rails (factor 8) plus its stone
  (factor 15), then `lib/sil-rail-experiment.ts` picks among all legal candidates. A candidate replaces the shown route only
  if it cuts rail exposure by at least 50 m, costs at most 120 s or 10 % over the fastest route (or the request's own extra
  time), and has no more pavé **and** no more surface risk than the route it replaces. Rails never enter the pavé score.
  Combinations: fastest = the `fast` card; pavé avoidance = `avoid`; tram avoidance = `tram=avoid` (with `avoid=balanced`
  for tram alone); comfort = both.
- Without a local layer set (every deployment) the preference changes nothing, makes no extra provider request and reports
  `layers-off`. Navigation reroutes ignore it. Env `LASTRICO_SIL_EXPERIMENT=rails` applies it to every request (benchmarks).
- **Map view** `/intelligence` + `/api/road-intelligence?bbox=` (boxes up to 0.03 degrees): OSM surface classes (asphalt,
  cobblestone, other known, unknown: an untagged way is never shown as asphalt), segment details on tap. Rails and source
  conflicts appear only when a local layer set exists; elsewhere they are reported unavailable. Only OSM data is served.
- `scripts/sil/sil-benefit.mjs` compares recorded cases without and with the preference, per mode.

## Measured (264 recorded Milan cases, same provider answers, departure Mon 9 Nov 12:00, strong avoidance)

| | Car (88) | Motorcycle (88) | Bicycle (87) |
| --- | --- | --- | --- |
| Normal route on mapped shared rails | 70 of 84 read | 66 of 82 | 65 of 86 |
| Rail-aware candidate generated | 53 | 52 | 48 |
| Cases where the shown route changed | 7 | 4 | 6 |
| Rail metres on those cases | 5,070 to 466 | 1,981 to 170 | 3,711 to 373 |
| Extra time on those (median / max) | +59 s / +101 s | +89 s / +101 s | +26 s / +86 s |
| Pavé or risk worse | 0 | 0 | 0 |
| Rail metres over all cases | 36.7 to 32.1 km | 35.1 to 33.3 km | 33.8 to 30.5 km |
| Provider requests, median (cap 7) | 2 to 3, max 7 | 2 to 3, max 7 | 2 to 3, max 7 |
| Evaluation time per request | median 2.4 ms | 2.4 ms | 2.1 ms |

Reading: generating a candidate on purpose adds routes the ranking alone did not have (two-wheelers: 10 changed routes against
9 with ranking only, mainly on cases the pool could not solve), but the gain stays small: most journeys cross tram
corridors that cannot be avoided without a large detour, and the budget refuses those. Cars gain as much as bicycles, but
whether rails matter to a driver is a product decision, not a measurement.

## Sources compared and surface coverage (Milan, 102,009 compiled road segments)

- DBT maps rails on 6,458 segments (5,583 on a shared carriageway); OSM flags 2,621; both agree on 2,479 segments in the box.
- DBT-only: 469 segments where OSM was asked and mapped nothing, 3,510 where OSM was not asked. OSM-only: 142. Conflicts:
  229 (OSM absent, DBT present) and 91 (DBT absent, OSM present); 74 contested and 962 weak dissents are review tasks.
- Confidence of the fused overlay: 0 high, 6,098 medium, 668 low. It never claims "high".
- None of the three sources describes pavement material. Surface coverage on the recorded routes is the OSM one: unknown
  6.2 % (bicycle), 9.3 % (motorcycle), 11.4 % (car) of route metres; confirmed pavé 11.3 %, 9.6 %, 8.7 %.
- Other free sources: no ready Milan layer exists. A global Mapillary-derived paved/unpaved dataset (licence not verified)
  distinguishes only paved from unpaved, and image models such as SurfaceAI need compute we do not have.

## Not claimed

That rails are present or rough today, that a tram-free route is smoother, or any gain on a physical road or on Cloudflare.
CPU on the Worker was not measured.
