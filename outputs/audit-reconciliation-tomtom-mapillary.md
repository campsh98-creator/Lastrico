# TomTom traffic and Mapillary: verification for the audit reconciliation (21 November 2026)

Scope: sections 3 and 4 of `outputs/prompt-audit-reconciliation.md`. Everything below was checked **offline**: no request to TomTom
(no live call, no key), no request to Mapillary, no private coordinates. PR #36 is not merged and not needed.
Baseline: `main` at `311b7a5` plus the tests of branch `claude/reconcile-traffic`.

## 1. TomTom (live traffic)

### 1.1 What was verified, and how

| Capability | How it was checked | Result |
| --- | --- | --- |
| Flow tile decoding and direction-aware matching | `tests/traffic-real-tile.test.mjs`, **opt-in** (`LASTRICO_REAL_FLOW_TILES`, `LASTRICO_REAL_FLOW_TILE_ZXY`), run on the two flow tiles saved by hand (never committed: provider data); plus `traffic-core` (synthetic tiles) | Both real tiles decode: layer "Traffic flow", extent 4096, line features only, 28 and 21 features (the earlier audit's "21" reproduced), `traffic_level` within 0..1, coverage `full` or `one_side`, 2 flagged closures per tile, geometry inside Milan. Every feature is matched by a route running the same way; driven the other way 18 of 28 and 13 of 21 features are "not described" and keep the provider's time (the rest meet the opposite carriageway's own feature) |
| ETA and ranking | `traffic-offline-verification`: "congestion changes the ranking exactly where the ETA formula says" | A fully covered route is slowed to static / level. Corridor A (600 s) vs B (700 s): A stays fastest at levels 1.0, 0.90, 0.88 (682 s), loses at 0.84 (714 s) and 0.25 (2,400 s); the threshold is 600/700 = 0.857. When B wins, the card shows what the switch saves |
| Mode shares | `traffic-core` (existing) | Car all of the delay, motorcycle half (an assumption, labelled "stima" in the payload), bicycle none |
| Flow closure vs Incident-tile closure | "a Flow closure costs a car 900 s ... an Incident-tile closure changes neither" | A flow closure adds the fixed 900 s once per route (a second closure adds only its own stretch time) and moves the ranking. An incident-tile `road-closed` (category 8) changes neither time nor ranking, is not a slice for the penalised search, raises no "closed by the provider" warning, and is listed as information. Bicycles: closure shown, no time added |
| Interaction with Maximum anti-pavé | `tests/traffic-maximum-interaction.test.mjs`, real handler on the recorded Corso Lodi replica (public junctions) | With a jam on the fastest route: the congestion rides in the **same** provider request as the stone (4 cost factors instead of 3); at most 7 routing requests in total (7 in the recorded run, cap 7), counter equals the real count; the one exclusion request carries **no** cost factors (stone only), within the 100-vertex limit; the safe route keeps **0 m** of confirmed stone. A reroute stays at ≤ 4 requests with no exclusion search. With the traffic provider failing (`provider-failing`, `quota-daily`, `key-rejected`, `no-key`) the answer is identical to the one without traffic, with the same number of routing requests |
| ZTL / legality | "a route that is illegal at the departure time never wins because it is free-flowing" (+ `traffic-route`) | A timed-closed route is not even a candidate, however free-flowing; the legal congested route is returned with its delay |
| Quota, cache, breaker, fallback | `traffic-hub` (existing, 9 tests) and `traffic-route` "unavailable" / "worst case" tests | Cache reused for 90 s (flow) / 120 s (incidents), refetched after; quota is spent before the call and survives a restart (SQLite); 401/403 close the circuit 6 h, 429 15 min, three failures 5 min; every failure returns static Valhalla times with an explicit reason. PR #38's "Audit 5" duplicated these tests and was dropped |
| Incidents as a separate capability | the closure test above, `traffic-core` incidents test, and "the wording never presents an incident as closure avoidance" | Informational only: zero effect on ETA, ranking or search. No text in the panel or the handler promises to avoid closures or incidents; a flow closure is shown as "verifica sul posto" |

### 1.2 PR #38's `traffic-validation-audit.test.mjs`

All 5 of its tests pass on `main`, which confirms its claims. Four of them are kept in rewritten, smaller form (ranking threshold,
closure vs incident, ZTL, anti-pavé + traffic, the last one now on recorded provider answers with exact request composition);
the fifth (cache, quota, breaker) duplicated `traffic-hub.test.mjs` and was not carried over. Its anti-pavé test only asserted
the request cap and that the search ran; the new one asserts what the request contains and that 0 m survives.

### 1.3 The standing-closure question

The earlier audit saw the same two closures in two tiles 11 minutes apart (293 m and 564 m) and asked whether a standing closure is
penalised too hard. What protects against a **stale** closure, in code:

- Nothing is remembered: a closure exists only in the tile of this calculation. A tile is reused for 90 s (`FLOW_TTL_MS`), then
  refetched; if the provider fails after that, the old tile is **not** served (`worker/traffic-hub.ts`), the caller gets "unavailable"
  and static times. Test: "a closure cannot outlive its tile".
- A closure is a **penalty, not an exclusion**: +900 s once per route, plus the stretch read at a tenth of free speed; it never
  makes a route illegal, and if it is the only route it is still returned with the delay. Test: "when the closed route is the only route".
- The person is told: the panel shows the tile time and "un tratto è segnalato chiuso dal provider (N m): verifica sul posto".

What does **not** protect: nothing tells a long-standing closure (a building site TomTom keeps reporting) from a fresh one, so such
a route is penalised on every request for as long as the provider reports it. That is a policy question (the 900 s value is
unvalidated), not a defect; **left unchanged**, to be decided after field data.

### 1.4 Findings

- **No defect found** in the traffic code. No product file was changed.
- Observation (by design, not changed): any failing or unreadable tile, **including an incident tile**, makes the whole session
  "unavailable" and discards the flow data too ("falls back as a whole", pinned by `traffic-core`). Incidents are separate in
  effect (no ETA or ranking), not in availability or quota.
- Test hygiene: a test that mocks the road store with synthetic ways (`mockRoadWays`) can change a later handler run on the real
  Milan tiles in the same process (the Maximum request count and result differed). PR #38's audit file mixes both; the new Maximum
  tests live in a file of their own.

### 1.5 Status

| Capability | Status | Why |
| --- | --- | --- |
| Flow decoding, matching, direction | **GO** | real tiles + fixtures |
| Congestion ETA and ranking | **GO** | pinned numerically, offline |
| Interaction with Maximum, request caps, fallback | **GO** | real handler on recorded answers |
| ZTL / legality | **GO** | |
| Quota, cache, breaker | **GO** | |
| Flow closure penalty (900 s) | **CONDITIONAL** | standing-closure policy open; confirm one on site |
| Traffic Incidents | **CONDITIONAL, informational only** | never seen live (no real incident tile exists); must not be sold as closure avoidance |
| Live peak-hour density, live incident coverage | **UNVERIFIED** | needs live requests: not allowed without explicit approval |
| Storing real tiles in the repository | **NO** | provider terms not reviewed; the opt-in test reads local files instead |

## 2. Mapillary

### 2.1 Confirmed facts

| Fact | Source |
| --- | --- |
| Images by other users are under CC BY-SA, unless marked otherwise (some carry other terms, which then prevail) | [Mapillary Terms of Use](https://mapillary.com/legal), [Help Center: licences](https://help.mapillary.com/hc/en-us/articles/115001770409-Licenses) |
| API v4 needs an OAuth access token (tokens look like `MLY\|...`) | [API v4 announcement](https://blog.mapillary.com/update/2021/06/23/getting-started-with-the-new-mapillary-api-v4.html) |
| OSM contributors may derive data from the images for OpenStreetMap under a special permission; Mapillary says derived metadata may go to OSM under the OSMF contributor terms | [OSM wiki: Mapillary](https://wiki.openstreetmap.org/wiki/Mapillary), [Mapillary and OSM](https://mapillary.com/osm) |
| Elsewhere, derived metadata may be published only if publicly accessible and ODbL-licensed; attribution is asked | [Mapillary help](https://help.mapillary.com/hc/en-us/articles/115001777705) |
| In this repository: **no production source mentions Mapillary** and the bundled Milan data carries it only as OSM's own `mapillary=<image id>` tag (33 occurrences, bare numeric ids, data under ODbL with OSM attribution) | `tests/mapillary-provenance.test.mjs` (2 tests, passing) |
| Open imagery in Milan is too sparse to be a layer; model precision on setts was 0.632 (Phase 4.20): not usable automatically | `outputs/street-imagery-evaluation.md` |

### 2.2 Claims rejected as unverified

- The image ids per corridor, their bearings and the "confidence 0.91-0.96" of the earlier draft: no response files, no method for a
  visual classification, no reproducible source. PR #38's final text itself retracts the five ids; that retraction is **accepted**.
  Nothing derived from them (surface or tram-rail classifications) may be used.
- "Corso di Porta Romana is one-way south-east" (earlier draft, per the independent audit): contradicted by the 17:19 trace, where
  the car drove north-west on it and the app itself proposed a north-west route. Rejected.
- Corridor coverage, capture dates and viewing angles from the live API: never measured (no token), so none is claimed.
- The independent audit's remark that the licence reading "is plausible" stands as a reading, not a legal opinion.

### 2.3 Unresolved questions

1. The current Meta/Mapillary API terms on caching, storage and redistribution of API responses were not found in the pages above:
   to be read directly before any API use.
2. Share-alike: images are CC BY-SA, and derived metadata outside OSM must be published under ODbL. Whether a Lastrico road
   database that mixed such values would have to be published as ODbL (and how that interacts with how the project distributes its
   compiled tiles) is a legal question, not answered here.
3. Provenance: what a derived value would need to carry (image id, capture date, heading, detector and version, reviewer) to be
   auditable, and who reviews it.
4. Accuracy on Milan setts, wet stone and embedded tram rails: no labelled sample exists (`outputs/street-imagery-evaluation.md`
   asks for at least 300 images, two reviewers, precision of at least 0.9).

### 2.4 Rule

**Nothing Mapillary-derived enters production road data**: no field, no table, no classification, no import. Imagery stays a human
review channel (`imagery-review` in `lib/road-observations.ts`): references only (provider, id, date, heading, licence), a person
decides, and the observation rule that evidence can only add caution applies. An unknown surface is never asphalt. The guard test
fails if production code starts to refer to Mapillary, so a change of this rule is an explicit, reviewed one.
Verified fixes belong upstream in OpenStreetMap first.

## 3. Test commands

```
node --test tests/traffic-core.test.mjs tests/traffic-hub.test.mjs tests/traffic-route.test.mjs \
  tests/traffic-offline-verification.test.mjs tests/traffic-maximum-interaction.test.mjs \
  tests/traffic-real-tile.test.mjs tests/mapillary-provenance.test.mjs
# with the saved real tiles (optional, local only):
LASTRICO_REAL_FLOW_TILES="<file1>;<file2>" LASTRICO_REAL_FLOW_TILE_ZXY="12/2152/1465" node --test tests/traffic-real-tile.test.mjs
```
