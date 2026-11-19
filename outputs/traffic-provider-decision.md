# Live traffic: provider decision (19 November 2026)

Question: which provider can give Milan live traffic for free, with no billing, so that Lastrico can draw congestion and
incidents, correct ETAs and prefer routes that avoid queues? Checked on 19 November 2026 against the providers' own pages.

## Decision

**TomTom Traffic Flow and Incident vector tiles (Traffic API v4), free plan, key kept as a Worker secret.** Implemented, tested
and deployed **disabled**: without a key the feature says "non attivo in questa versione" and changes nothing.

| Candidate | Free allowance (official page) | Fits | Verdict |
| --- | --- | --- | --- |
| **TomTom** vector Flow & Incidents tiles | 200,000 a month, "no credit card needed" (docs.tomtom.com/pricing); an older FAQ states 50,000 tile requests a day. Incidents Details API: 2,500 a month. Flow Segment Data: 20,000 a month. Routing API (traffic-aware): 20,000 a month | Tiles give flow for every road in view with one request, shareable by all users; incident tiles carry category, delay, text | **Chosen** |
| HERE Traffic | 5,000 a month on its pricing page (the page is script-rendered: figure read through a search summary, not fetched) | One request per bounding box, but 40 times less quota | Rejected: quota |
| Public datasets (Comune di Milano open data, Regione Lombardia, Italy's National Access Point) | free | Counts and historical flows, DATEX II is published for other countries; no live, street-level Milan feed found | Rejected: not live. The Comune's portal timed out during the check, the National Access Point catalogue lists public-transport data, not road traffic |
| Waze, Google, Apple | no free programmatic live traffic for third-party navigators | n/a | Out |

TomTom's two pages disagree on the unit of the free quota (monthly on the current pricing page, daily in an older FAQ). The
caps below are far under both readings.

## How it stays free

- **Hard caps, enforced before the call**, in one ledger (the `traffic-ledger` instance of the existing `RouteEngine` Durable
  Object, SQLite storage): 4,000 tile requests a day, 60,000 a month (30 % of the monthly allowance), at most 1,500 a day for
  the map overlay, at most 24 per route calculation, cache hits free. A restart cannot reset them (tests/traffic-hub.test.mjs).
- **Circuit breaker:** HTTP 401/403 closes it for six hours, 429 for fifteen minutes, three failures in a row for five minutes.
- **No billing path:** the free plan needs no card, and the code never calls anything but the two tile endpoints. TomTom's paid
  "Pay as you grow" plan exists only if the owner enables it in the TomTom account; even then Lastrico stops at its own caps.
- **Cache:** tiles are cached 90 s (flow) and 120 s (incidents). This is shorter than the provider's update rhythm; whether
  TomTom's terms allow any server-side cache was not investigated at this stage (the brief excludes extended licence work):
  to be confirmed before the feature is turned on in production.

## What is honest about the numbers

- Delay = provider's static time spread over the route, each covered stretch slowed by `traffic_level` (current speed over
  free-flow speed, never faster than free flow, floor one tenth). Stretches the tiles do not describe keep the static time and are
  reported as not covered; below 90 % coverage the UI says "stima".
- Flow tiles measure motor traffic: cars feel all the delay, motorcycles half (provisional assumption, shown in the payload),
  bicycles none (incidents and closures are still shown).
- Nothing is simulated in product code. Fixtures live only under `tests/`.
- **Not verified against the live API:** no key exists yet, so the tile format is implemented from TomTom's documentation
  (layer "Traffic flow", tags `traffic_level`, `road_closure`; layers "Traffic incidents flow" and "Traffic incidents POI") and
  tested on tiles shaped like it. Line direction is assumed to be the direction of travel (the documentation's examples show
  each carriageway as its own line). `node scripts/traffic-live-check.mjs` runs the first real check once a key is set.

## What the owner has to do

Create a free TomTom developer account (no card), copy the key, and store it as the Worker secret `TOMTOM_API_KEY` of
`lastrico-preview-437` (`wrangler secret put`, or the repository secret the publish step reads). Nothing else.
