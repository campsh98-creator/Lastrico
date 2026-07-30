# Lastrico — concise business plan

**Planning date:** 30 July 2026

**Currency:** EUR, excluding VAT unless stated otherwise

**Status:** working strategy document, not audited financial advice or an investment offer

## Executive summary

Lastrico is an open-source road-intelligence and navigation project. Its current beta
compares routes for cars, motorcycles, and bicycles using known road-surface data in Milan.
The long-term opportunity is broader: help people choose routes using time, reliability,
road class, surface quality, known hazards, lighting, weather, closures, comfort, vehicle
suitability, and personal preferences.

Mainstream route interfaces commonly foreground estimated arrival time. A route that appears
a few minutes faster can still be a poor match for a person's preferences when it uses
narrow, dark, damaged, steep, or unreliable roads. Lastrico's proposed differentiator is an
explainable, multi-objective route-intelligence layer—not another undifferentiated basemap.

The Italy-first vision is a progressively verified road-condition network combining
OpenStreetMap, official feeds, licensed partners, municipalities, fleets, and moderated
community observations. A future conversational interface could translate a request such as:

> I have time. Prefer major, well-lit roads and avoid narrow mountain roads, even if the
> journey takes up to 30 minutes longer.

into explicit preferences. A deterministic routing engine, not a language model, would still
enforce legal access, generate routes, score trade-offs, and explain the result.

## Mission

Help drivers, motorcyclists, and cyclists make better-informed route choices by comparing
time, road characteristics, known hazards, comfort, reliability, and uncertainty.

## Vision

Build an Italy-wide, community-supported road-intelligence layer that can serve travellers,
fleets, municipalities, road operators, insurers, and existing mobility platforms—then
expand to other European markets with the same transparent regional model.

Lastrico must never promise a “safe route”, guarantee accident prevention, or interpret
missing evidence as a hazard-free road.

## The problem

Time alone is an incomplete routing objective:

- a nominal shortcut can have high delay variability;
- a secondary mountain or rural road may be unsuitable for the user's preferences;
- potholes, rough surfaces, flooding, debris, roadworks, missing lighting evidence, and
  closures affect different modes differently;
- map and hazard data can be stale, incomplete, or contradictory;
- people cannot usually express trade-offs in plain language;
- non-technical road users have limited ways to contribute structured, verifiable evidence.

Italy recorded 173,364 injury-producing road crashes, 233,853 injuries, and 3,030 deaths in
2024. The estimated social cost was about €22.6 billion including property-only damage.
These statistics establish the importance of the mobility problem; they do **not** prove that
Lastrico will reduce crashes. That requires independent, controlled evaluation.
[Source: Istat, Road accidents 2024](https://www.istat.it/en/press-release/road-accidents-2024-2/).

## Product strategy

### What exists today

| Capability | Current state |
| --- | --- |
| Product | Experimental React/Next.js PWA |
| Map | MapLibre with OpenFreeMap/OpenStreetMap data |
| Search | Public Nominatim beta integration |
| Routing | Public Valhalla; temporary OSRM car fallback |
| Modes | Car, motorcycle, and bicycle |
| Differentiated signal | Estimated exposure to known rough or irregular surfaces |
| Navigation | Foreground GPS, rerouting experiment, manoeuvres, optional voice |
| Community data | Report submission and pending/verified/rejected data states; no production moderation dashboard or demonstrated moderation operation yet |
| Geography | Tested beta coverage limited to Milan |

The beta is useful technical evidence, not a production national navigator. It does not yet
have native applications, CarPlay, Android Auto, production service-level agreements,
traffic, weather, nationwide hazards, offline navigation, or conversational preferences.

### Future route signals

Lastrico should add signals only when their source, licence, freshness, confidence, and
mode-specific meaning are explicit:

- expected travel time and its variability;
- distance and energy or fuel implications;
- road hierarchy and suitability;
- legal access by travel mode;
- surface material, damage, potholes, and roughness;
- width, gradient, curvature, and complex junctions;
- closures, works, debris, flooding, ice, and landslides;
- lighting evidence;
- traffic and heavy-vehicle exposure where licensed;
- weather and forecast relevance;
- verified user and institutional observations;
- proportion of the route that remains unknown or unassessed.

The engine should generate multiple legal candidates and rank them through a documented,
calibrated generalised-cost model. It should present the fastest route alongside meaningful
alternatives and explain the trade-off.

### Promptable preferences

Natural language is a future interface, not the routing authority.

```json
{
  "max_extra_minutes": 30,
  "prefer_major_roads": "strong",
  "avoid_narrow_roads": "strong",
  "avoid_unpaved": "required",
  "prefer_lit_roads": "medium",
  "time_priority": "medium",
  "comfort_priority": "high"
}
```

The user must see and confirm the interpreted preferences. Hard legal restrictions cannot be
overridden. Unknown lighting, surface, or hazard data remains unknown. Free-form language
generation should not run inside the real-time vehicle-control loop.

The parser must produce only a versioned, allow-listed schema, reject unsupported
preferences, request clarification when confidence is low or preferences conflict, and never
infer a hard prohibition from ambiguous language. Raw prompts should not be retained by
default. Preference interpretation and deterministic scoring require separate regression,
ambiguity, and adversarial test corpora.

## Community contribution model

Non-technical participation is central to the data strategy:

1. The user stops safely or reports after the trip.
2. The app map-matches the approximate public road segment.
3. The user selects a plain-language category and affected mode.
4. Optional voice or photo evidence can be added.
5. The system removes image metadata and protects faces, plates, homes, and identity.
6. The report receives provenance, freshness, confidence, verification state, and expiry.
7. Automated checks, corroboration, trusted sources, or human moderation determine whether
   it can affect routing.
8. Contributors can see status, correct a report, or request deletion.

Unverified reports must not change routes immediately. Production requires contributor
terms, moderation tools, abuse reporting, blocking, audit logs, appeals, and response targets.
Apple and Google both impose continuing user-generated-content moderation requirements.
[Apple App Store Review Guideline 1.2](https://developer.apple.com/app-store/review/guidelines/)
and [Google Play's user-generated-content policy](https://support.google.com/googleplay/android-developer/answer/9876937)
set relevant platform requirements.

## Data strategy for Italy

An Italian basemap is not the same as verified Italian hazard coverage. National expansion
should happen through versioned coverage zones and corridors.

### Data layers

- **Network:** OpenStreetMap topology, restrictions, surfaces, lanes, access, and road class.
- **Official dynamic data:** Italy's CCISS National Access Point catalogue and available
  DATEX II or operator datasets, including roadworks, closures, traffic, and other events
  where reuse terms permit.
- **Regional and municipal data:** maintenance, lighting, flooding, landslide, inspection,
  and collision datasets with source-specific licences.
- **Community observations:** moderated, time-bounded, mode-aware reports.
- **Inferred signals:** separately labelled estimates such as recurring delay variability or
  anomalous vibration clusters, collected only with explicit consent and validation.

Each feature needs source, licence, observation time, import version, confidence, freshness,
mode relevance, verification state, and expiry. OpenStreetMap-derived data requires
attribution and ODbL compliance. Public OSM tiles and Nominatim are community services with
usage policies and no commercial SLA, so they cannot remain critical production
dependencies. [OSM licence](https://www.openstreetmap.org/copyright),
[tile policy](https://operations.osmfoundation.org/policies/tiles/), and
[Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/).

The national access point may act as a catalogue or registry rather than one uniform
production API. Availability, latency, geographic coverage, licence, and redistribution
rights must be verified separately for every dataset.
[European Commission national-access-point register](https://transport.ec.europa.eu/transport-themes/smart-mobility/road/its-directive-and-action-plan/national-access-points_en).

### Geographic rollout

1. Milan and nearby municipalities.
2. Deliberately different pilots, such as Rome and Catania.
3. A north–south benchmark corridor including long-distance motorway and alternative-road
   cases.
4. Priority corridors selected by usage, available evidence, partners, and moderation
   capacity.
5. National coverage only when completeness and freshness can be measured honestly.

## Technical architecture

### Recommended target

- native iOS application in Swift/SwiftUI;
- native Android application in Kotlin/Compose;
- shared server-side preference, scoring, explanation, and analytics contracts;
- PostgreSQL/PostGIS authoritative geospatial database;
- object storage for snapshots and non-public evidence;
- versioned ingestion workers and routing-graph builds;
- stable road-edge identifiers and compatibility mappings across graph releases;
- production geocoding, tiles, traffic, routing, and navigation SDK contracts;
- candidate-route, hazard-matching, and multi-objective scoring services;
- versioned route-selection contracts containing candidate ID, selected geometry or provider
  route token, scoring-model version, routing-graph version, hazard-snapshot version,
  source-import versions, and reroute reason;
- explicit notification whenever a provider cannot preserve the selected Lastrico route;
- provider-licensed offline map packages or self-hosted offline assets, cached active-route
  geometry and manoeuvres, route-progress recovery, data-version checks, and a documented
  network-loss fallback;
- moderated contribution and contributor-trust services;
- vector-tile or feature APIs for hazard overlays;
- observability, distributed rate limiting, audit logs, backups, and rollback.

The current TypeScript domain logic can remain useful in APIs and shared test fixtures.
Cloudflare D1 can support small operational tables, but PostGIS is the more credible
authoritative national spatial store.

Every route score must record the routing graph, hazard snapshot, source imports, and scoring
model versions that produced it. Public OpenStreetMap tile prefetching must never be used as
an offline-navigation implementation.

### Provider strategy

Three paths should be prototyped before commitment:

| Option | Strength | Main constraint |
| --- | --- | --- |
| Google Navigation SDK | Mature navigation and traffic ecosystem | Cost, terms, and limits on custom route integration |
| Mapbox Navigation SDK | Native navigation and flexible OSM-oriented stack | Metered cost and provider-specific custom-route behaviour |
| Operated/self-hosted OSM stack | Maximum scoring and graph control | High engineering, traffic, search, map-matching, QA, and on-call burden |

The recommended first production architecture uses a contracted navigation foundation while
Lastrico owns its differentiated hazard, preference, ranking, and explanation layer.
Self-hosting more routing infrastructure becomes attractive only after usage and customisation
requirements justify the operational burden.

## Deployment roadmap

| Stage | Indicative timing | Outcome and release gate |
| --- | --- | --- |
| 0. Product foundation | 2–6 weeks | Hazard taxonomy, claims policy, provider proof of concept, privacy and licences; developer-account and legal-entity setup, early CarPlay entitlement request, and automotive-provider feasibility |
| 1. Production regional backend | 6–16 weeks | PostGIS, contracted services, moderation, official feeds, observability |
| 2. Native phone apps | Months 4–7 | Stable iOS and Android phone navigation, background guidance, store privacy and location declarations, closed testing |
| 3. Automotive surfaces | Months 7–10 | CarPlay and Android Auto implementations submitted after phone stability |
| 4. National zones | Months 10–18+ | Versioned expansion based on measured data quality and field validation |
| 5. Promptable routing | After deterministic model validation | Confirmed natural-language preferences and explainable alternatives |

Timings are internal planning ranges. Platform approval, data access, field validation, and
partner contracts can extend them.

### Production launch checklist

- remove public community map/search/routing services as critical dependencies;
- define provider quotas, budgets, fallbacks, and commercial terms;
- establish staging and production environments;
- automate signed data imports and reversible graph releases;
- add monitoring for routing latency, failed sessions, stale hazards, and provider errors;
- implement distributed abuse protection and moderation operations;
- let the formal GDPR assessment determine whether Article 35 requires a DPIA for the final
  processing design;
- complete Apple App Privacy disclosures for Lastrico and every embedded SDK;
- complete Google Play Data Safety, prominent in-app location disclosure, and applicable
  background-location or foreground-service declarations and approvals;
- verify precise-location minimisation, consent refusal behaviour, retention, export, and
  deletion;
- publish privacy, retention, deletion, security, and contributor policies;
- run long-distance, poor-network, accessibility, and mode-specific field tests;
- establish incident response, backups, recovery objectives, and on-call ownership;
- release coverage only when route, GPS, rerouting, mobile, moderation, and smoke tests pass.

## Apple CarPlay and Android Auto

A PWA cannot simply be switched on in either automotive system.

### Apple

Lastrico needs a native iOS navigation application, Apple Developer enrolment, a CarPlay
maps/navigation entitlement request, the applicable addendum, CarPlay templates and
navigation sessions, simulator and vehicle testing, and App Store review. Apple evaluates
entitlement requests; approval is not guaranteed.
[Apple CarPlay entitlement documentation](https://developer.apple.com/documentation/carplay/requesting-carplay-entitlements)
and [CarPlay navigation integration](https://developer.apple.com/documentation/CarPlay/integrating-carplay-with-your-navigation-app).
Apple Developer Program membership is currently USD 99 per year.
[Apple membership comparison](https://developer.apple.com/support/compare-memberships/).

A navigation app's CarPlay root template must be `CPMapTemplate`. Lastrico must use Apple's
controlled templates and limited interactions rather than reproducing its phone interface.

### Android

Lastrico needs a native Android navigation application using the Android for Cars App
Library, the `NAVIGATION` category, navigation templates, manoeuvre and estimate feeds,
voice/audio handling, distraction-limited flows, automotive testing, and Google Play review.
[Android navigation-app documentation](https://developer.android.com/training/cars/apps/navigation).
Google's documented Navigation SDK integration for Android Auto is currently labelled
Preview, so it is a supplier risk rather than a guaranteed production dependency.
[Google Android Auto integration](https://developers.google.com/maps/documentation/navigation/android-sdk/android-auto).
Google Play full distribution currently has a one-time USD 25 registration fee in the EEA.
[Google Play EEA conditions](https://support.google.com/googleplay/android-developer/answer/14659200).

The Android client requires a `CarAppService`,
`androidx.car.app.category.NAVIGATION`, the `NAVIGATION_TEMPLATES` permission, rendering to
the host `Surface`, phone handoff for disallowed tasks, and applicable car-quality checklist
tests.

CarPlay and Android Auto are car environments. Motorcycle and bicycle navigation remain
first-class phone experiences unless a platform provides and approves an appropriate surface.

Automotive release evidence must cover the CarPlay simulator and multiple real vehicles or
head units; Android Desktop Head Unit, Android Automotive emulator, and real head units;
connect, disconnect, and reconnect; phone lock and backgrounding; audio interruption and
voice guidance; dual-display lifecycle; rerouting and network loss; day/night themes; rotary
and touch input; and every applicable platform checklist.

## Business model

### Revenue streams

- free consumer route comparison and community reporting;
- consumer premium subscription for advanced preferences, proactive alerts, richer
  explanations, and lawful personalisation;
- fleet SaaS priced per active vehicle, route, or operating region;
- municipal and road-operator dashboards and pilots;
- API/SDK licensing for hazard intelligence and route scoring;
- insurer, roadside-assistance, and mobility-platform partnerships;
- research or aggregate analytics only when lawful, anonymised, and contractually bounded.

Lastrico should never sell identifiable movement histories.

### Initial customer sequence

1. Surface-sensitive cyclists, motorcyclists, drivers, commuters, and long-distance users.
2. Delivery, field-service, roadside-assistance, and micromobility fleets.
3. Municipalities, regions, and road operators.
4. Insurers and existing navigation or mobility platforms.

The most defensible initial wedge is a verified road-condition and preference-ranking layer,
not a direct claim to replace Google Maps or Waze immediately.

## Go-to-market

### Phase 1 — evidence

- recruit Milan road-user, cycling, motorcycle, and accessibility communities;
- publish coverage, unknown-distance, confidence, and moderation metrics;
- validate whether people understand and choose non-fastest alternatives;
- run paid or co-funded municipal and fleet pilots.

### Phase 2 — differentiated regions

- pilot Rome, Catania, and a long-distance north–south corridor;
- demonstrate that the taxonomy supports cobblestones, potholes, damaged surfaces,
  unsuitable roads, works, and weather-related hazards;
- build partner ingestion and contributor programmes.

### Phase 3 — platform

- expand corridor by corridor;
- sell B2B/B2G intelligence and APIs;
- launch premium preferences only after retention and route-value evidence;
- pursue international expansion through reusable regional adapters.

## Team

### Year 1: 5–6 core people

- technical/product founder;
- geospatial and routing engineer;
- iOS engineer;
- Android engineer;
- data/ML engineer;
- product design and community lead;
- fractional QA, privacy, security, insurance, licensing, and legal support.

### Year 2: 10–12 people

Add backend reliability, data operations, partnerships, moderation, customer success, and
growth.

### Year 3: 18–24 people

Add SRE, a dedicated data-quality function, enterprise sales, support, and expanded mobile,
routing, and moderation teams.

Budgets should include sustainable founder compensation rather than hiding costs through
unpaid labour.

## Cost plan

Small platform registration fees are not the material cost. The main drivers are engineering,
navigation usage, tiles/search, live data, cloud spatial processing, moderation, privacy and
licensing work, field testing, support, and customer acquisition.

Published prices are reference points, not supplier quotes:

- Google currently lists Navigation SDK, Routes, Geocoding, Places, and related services as
  separately metered products. At published Navigation SDK tiers, approximately 100,000
  billable destination or waypoint events per month would be around USD 2,475 before other
  services and taxes. A request containing multiple destinations consumes multiple billable
  events.
  [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing).
- Mapbox currently publishes metered navigation pricing by monthly active user and trip.
  Approximately 10,000 navigation users and 50,000 trips per month would be about USD 6,890
  for those line items before search, support, taxes, and negotiated terms.
  [Mapbox pricing](https://www.mapbox.com/pricing).
- Cloudflare Workers lists a low paid-plan entry price, but edge requests are only a small
  part of a production navigation system.
  [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

Internal planning ranges:

| Operating state | Indicative recurring infrastructure and data |
| --- | ---: |
| Hosted technical beta | €50–€300/month |
| Production regional pilot | €2,000–€10,000/month |
| Growing national platform | €10,000–€60,000+/month |

Production-quality native applications, navigation integration, automotive surfaces, QA,
legal review, and launch represent approximately **€250,000–€700,000** of work, depending on
in-house staffing, provider choice, and scope. This allowance is **already included** in the
scenario payroll, contractors, legal, devices, and infrastructure lines; it must not be added
again.

## Three-year financial scenarios

These are cash-planning scenarios, not forecasts. “Cost” means cash operating expenditure
including sustainable founder compensation and expensed product development. It excludes
VAT, financing costs, corporation tax, depreciation, capitalised development, and
acquisition expenditure. A later accounting model must handle those items separately.

| Scenario | Year 1 revenue / cost | Year 2 revenue / cost | Year 3 revenue / cost | Indicative funding need |
| --- | ---: | ---: | ---: | ---: |
| Lean | €40k / €300k | €180k / €550k | €550k / €850k | €1.1m–€1.4m |
| Base | €75k / €500k | €450k / €1.1m | €1.7m / €2.3m | €2.0m–€2.5m |
| Growth | €150k / €900k | €1.2m / €2.4m | €5.0m / €5.0m | €3.5m–€5.0m |

### Scenario operating drivers

| Driver | Lean | Base | Growth |
| --- | --- | --- | --- |
| Year 3 monthly active users | 75,000 | 250,000 | 800,000 |
| Year 3 paid conversion | 4% | 6% | 8% |
| Net annual paid ARPU | €35 | €38 | €42 |
| Year 3 B2B/B2G customers | 12 | 25 | 60 |
| Year 3 average contract value | €30k | €45k | €55k |
| Year 1 / Year 2 / Year 3 core team | 3 / 6 / 9 | 6 / 12 / 22 | 10 / 24 / 45 |
| Navigation/data profile | Regional, provider quotas | Multi-region, contracted services | National, high availability and multiple feeds |

Years 1 and 2 are milestone-led ramps toward those Year 3 drivers. Each quarterly revision
must add actual MAU, paid conversion, contract count, request volume, unit cost, and
headcount. The current Lean and Growth revenue figures are directional envelopes until those
cohort and pipeline measurements exist.

### Base-case operating assumptions

- Year 3 reaches approximately 250,000 monthly active users.
- Approximately 6% convert to paid consumer plans.
- Net annual B2C revenue per paying user is about €38 excluding VAT. The working assumption
  is a €4.99 monthly or €39.99 annual list price, a predominantly annual mix, up to 15%
  introductory discounts, a 15% store commission where eligible, approximately 3% refunds
  or failed collections, and churn already reflected in the average active paid base.
- Approximately 25 B2B/B2G customers reach an average €45,000 annual contract value.
- Break-even is not assumed within three years.
- Forecast assumptions are replaced quarterly with retention, contract, usage, and unit-cost
  evidence.

### Base-case revenue bridge

| Revenue source | Year 1 | Year 2 | Year 3 |
| --- | ---: | ---: | ---: |
| B2C premium | €5k | €80k | €570k |
| B2B/B2G pilots and contracts | €60k | €300k | €1,125k |
| Non-dilutive grants/research operating income | €10k | €70k | €5k |
| **Total** | **€75k** | **€450k** | **€1,700k** |

### Base-case cost bridge

| Cost area | Year 1 | Year 2 | Year 3 |
| --- | ---: | ---: | ---: |
| Payroll and specialist contractors | €330k | €720k | €1,350k |
| Maps, routing, cloud, and observability | €30k | €90k | €240k |
| Data acquisition and moderation | €25k | €70k | €170k |
| Legal, privacy, security, and insurance | €35k | €45k | €70k |
| Devices, vehicles, and field testing | €20k | €30k | €50k |
| Partnerships, sales, and marketing | €45k | €100k | €320k |
| Administration and contingency | €15k | €45k | €100k |
| **Total** | **€500k** | **€1,100k** | **€2,300k** |

The base scenario produces indicative annual operating gaps of €425k, €650k, and €600k.
The €2.0m–€2.5m funding range provides approximately the cumulative gap plus working-capital,
timing, and contingency headroom.

Grant income is probability-weighted at approximately 50% of an identified pipeline and
recognised only when the relevant grant or research agreement permits. It is not assumed to
be recurring subscription revenue.

Indicative cumulative operating gaps are €930k for Lean, €1.675m for Base, and €1.95m for
Growth. Funding ranges include approximate milestone and working-capital reserves of
15%–35% for Lean, 20%–50% for Base, and 80%–155% for Growth. The larger Growth reserve
reflects faster hiring, automotive submission risk, national data contracts, and the option
to extend runway rather than a higher forecast certainty.

### Funding stages

- **Focused pre-seed alternative: €600k–€900k.** One primary mobile platform, regional
  validation, and several paid pilots over 12–18 months.
- **Expanded pre-seed alternative: €1.2m–€1.8m.** Parallel iOS/Android work, automotive
  prototypes, and a broader data pipeline.
- **Later seed round: €2m–€3.5m.** This is a subsequent round, not included in the pre-seed
  amount, and is appropriate only after retention, route acceptance, data-quality,
  provider-unit-economics, moderation, and paid B2B demand are demonstrated.

The three-year funding ranges in the scenario table are total planning needs. Round sizes and
timing must be adjusted so cumulative capital does not exceed the selected scenario without
an approved expansion of scope or runway.

## Key performance indicators

### Product

- weekly and monthly active users;
- route-preview-to-navigation conversion;
- percentage choosing a non-fastest alternative;
- D30 and D90 retention;
- successful navigation sessions;
- route latency and application crash-free sessions.

### Data

- kilometres with recent verified evidence;
- unknown or unassessed percentage per route;
- report confirmation, expiry, and rejection rates;
- median report age and moderation turnaround;
- contributor retention;
- audited false-positive and false-negative rates.

### Business

- paid conversion and net revenue retention;
- consumer acquisition cost and payback;
- B2B contract value, pipeline, and sales cycle;
- revenue and map/data cost per navigation session;
- gross margin, monthly burn, and runway.

### Responsible impact research

- change in exposure to verified road conditions;
- user understanding of route trade-offs;
- route acceptance and regret;
- privacy-preserving discomfort or near-miss studies;
- independently designed pilot outcomes.

No crash-reduction or safety claim should be marketed until a defensible study supports it.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Stale or false hazards | Confidence, expiry, corroboration, moderation, and audit samples |
| Coverage cold start | Show unknown coverage and expand by measured corridors |
| Privacy and GDPR | Minimise traces, explicit consent, retention controls, deletion, and an Article 35 assessment to determine whether a DPIA is required |
| Driver distraction | Voice-first, stopped-only reporting, approved automotive templates |
| Liability and misleading claims | Explain evidence and uncertainty; never certify a safe route |
| CarPlay or Android Auto rejection | Prototype early; do not promise approval dates |
| Provider cost or lock-in | Benchmark suppliers, quotas, portable contracts, staged self-hosting |
| Licence incompatibility | Per-source provenance and legal review |
| Incumbent competition | Own differentiated condition data, ranking, explainability, and APIs |
| AI unpredictability | Constrain AI to preference interpretation; deterministic routing |
| Community abuse | Moderation, trust levels, rate limits, reporting, blocking, and appeals |

## Milestones and go/no-go gates

### Pre-seed evidence

- a production-provider proof of concept preserves Lastrico route intent;
- users understand and choose explained alternatives;
- verified data coverage improves through contributions and partners;
- at least three paid institutional or fleet pilots;
- privacy and moderation operations work at pilot volume;
- native phone navigation passes long-distance field tests.

### Seed evidence

- repeat usage and measurable retention;
- acceptable provider cost per session;
- signed B2B pipeline and repeatable deployment;
- audited data-quality metrics;
- automotive prototypes that satisfy submission requirements;
- national expansion economics supported by corridor-level evidence.

### Release principles

- national map availability is never confused with national hazard coverage;
- unknown data is never treated as smooth, illuminated, or hazard-free;
- selected routes are not silently replaced by external providers;
- users see why a route is suggested and what remains uncertain;
- road signs, laws, current conditions, and traveller judgement always take precedence.

## Source register

Primary sources accessed 30 July 2026:

- [Istat — Road accidents 2024](https://www.istat.it/en/press-release/road-accidents-2024-2/)
- [OpenStreetMap copyright and licence](https://www.openstreetmap.org/copyright)
- [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/)
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- [Apple — Requesting CarPlay entitlements](https://developer.apple.com/documentation/carplay/requesting-carplay-entitlements)
- [Apple — Integrating CarPlay with a navigation app](https://developer.apple.com/documentation/CarPlay/integrating-carplay-with-your-navigation-app)
- [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- [Apple Developer membership](https://developer.apple.com/support/compare-memberships/)
- [Android for Cars App Library](https://developer.android.com/training/cars/apps/library)
- [Android — Build a navigation app](https://developer.android.com/training/cars/apps/navigation)
- [Android car-app quality](https://developer.android.com/docs/quality-guidelines/car-app-quality)
- [Google Navigation SDK for Android Auto](https://developers.google.com/maps/documentation/navigation/android-sdk/android-auto)
- [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Google Play EEA developer conditions](https://support.google.com/googleplay/android-developer/answer/14659200)
- [Google Play user-generated-content policy](https://support.google.com/googleplay/android-developer/answer/9876937)
- [Google Play Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Google Play background-location requirements](https://support.google.com/googleplay/android-developer/answer/9799150)
- [European Commission National Access Points](https://transport.ec.europa.eu/transport-themes/smart-mobility/road/its-directive-and-action-plan/national-access-points_en)
- [OpenStreetMap attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
- [GDPR Article 35](https://eur-lex.europa.eu/eli/reg/2016/679/art_35/oj)
- [Mapbox pricing](https://www.mapbox.com/pricing)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
