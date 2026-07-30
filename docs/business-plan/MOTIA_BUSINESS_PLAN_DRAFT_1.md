# Motia business plan — Draft 1

**Planning horizon:** Q4 2026–Q4 2029  
**Status:** internal working draft; not an investment offer  
**Currency:** EUR, excluding VAT unless stated otherwise  
**Evidence cut-off:** 30 July 2026

## 1. Executive summary

Motia is a proposed mobility-intelligence company built around one observation: the fastest
route is not always the route a person would choose if the road, vehicle, uncertainty, and
personal trade-offs were visible. Its mission is to let people shape routes around their
real priorities while preserving legality and deterministic navigation.

**Motia Routing Intelligence** is the planned platform. **Motia Routing Engine** is the
future API and scoring layer. **Lastrico by Motia** is the first product and current
technical evidence: an experimental open-source PWA that compares routes for cars,
motorcycles, and bicycles using known road-surface data in a tested Milan beta.

Motia's thesis is: **“The future interface of navigation is the prompt.”** A language model
would translate a request into an allow-listed preference schema; it would not replace graph
routing, legal restrictions, provider checks, or deterministic scoring. Users would see and
confirm the interpretation.

The initial commercial wedge is not a replacement for Google Maps or Waze. It is a
road-condition, preference-ranking, and explanation layer that can serve consumers, fleets,
municipalities, insurers, and existing mobility platforms.

The working Base scenario seeks a staged **€1.2m–€1.8m expanded pre-seed**, conditional on
readiness, to fund approximately 18–24 months of native mobile development, regional data
operations, field validation, moderation, provider contracts, and early paid pilots. A
smaller focused pre-seed remains possible. Exact valuation and equity remain undecided and
require corporate, legal, tax, and regulated-platform advice.

## 2. Company and brand architecture

| Layer | Name | Role | Status |
| --- | --- | --- | --- |
| Parent | Motia | Mobility-intelligence company | Proposed; legal and trademark checks pending |
| Platform | Motia Routing Intelligence | Preference, condition, ranking, and explanation layer | Planned |
| Engine/API | Motia Routing Engine | B2B/API product and future routing service | Long-term vision |
| Product | Lastrico by Motia | Surface-aware route comparison and community wedge | Experimental beta |

**Motia — Routes shaped around you.**  
**Lastrico by Motia — Smoother roads. Smarter routes.**

Motia is a coined name, provisionally pronounced “MOH-tee-ah” in English and
“MO-ti-a” in Italian. This explanation is a communication choice, not a linguistic,
corporate, domain, or trademark claim.

## 3. Problem

Mainstream route interfaces commonly foreground estimated arrival time. Yet a nominally
faster route may use narrow, poorly surfaced, steep, unfamiliar, or delay-prone roads that
do not match a driver's, rider's, cyclist's, or vehicle's needs.

The information problem has four parts:

1. route objectives are too compressed into time and distance;
2. road-condition evidence is fragmented, stale, or unavailable;
3. users cannot express complex trade-offs simply;
4. community observations are difficult to structure and verify safely.

Italy recorded 173,364 injury-producing road crashes, 233,853 injuries, and 3,030 deaths in
2024. The estimated social cost was about €22.6 billion including property-only damage.
These figures show the importance of the mobility domain; they do not prove Motia can reduce
crashes or certify safe routes. [Istat, Road accidents 2024](https://www.istat.it/comunicato-stampa/incidenti-stradali-in-italia-2024/).

## 4. Current evidence: Lastrico beta

Repository evidence supports the following current-state description:

- React/Next.js progressive web application;
- MapLibre map with OpenFreeMap/OpenStreetMap data;
- address search through public Nominatim;
- Valhalla routing and temporary OSRM car fallback;
- distinct car, motorcycle, and bicycle modes;
- comparison of fastest and lower known rough-surface-exposure alternatives;
- foreground GPS navigation, manoeuvres, experimental rerouting, and optional voice;
- report submission with pending/verified/rejected data states;
- tested beta coverage limited to Milan.

The beta does **not** establish nationwide hazard coverage, production moderation, native
mobile applications, background-grade navigation, live traffic, contracted data SLAs,
CarPlay, Android Auto, promptable routing, commercial demand, or safety outcomes.

## 5. Product vision

The future platform combines:

- legal and mode-appropriate candidate generation;
- time, distance, road hierarchy, gradient, surface, hazard, lighting evidence, closures,
  weather relevance, delay variability, comfort, and data-confidence signals;
- versioned multi-objective scoring;
- natural-language preference interpretation into a bounded schema;
- transparent trade-off explanations;
- a provenance-aware road-condition network;
- moderated, expiring community evidence;
- APIs and dashboards for partners.

Example:

> I am riding a motorcycle. I can accept five extra minutes, but avoid cobblestones and
> heavily damaged roads where possible.

Illustrative interpreted policy:

```json
{
  "mode": "motorcycle",
  "max_extra_minutes": 5,
  "avoid_surfaces": ["cobblestone", "heavily_damaged"],
  "avoidance_strength": "high",
  "legal_access": "mandatory",
  "objective": "comfort_time_balance",
  "schema_version": "motia-preferences/0.1"
}
```

Unsupported, ambiguous, or conflicting instructions must be rejected or clarified. The user
must confirm the interpretation. Unknown evidence stays unknown. Hard legal constraints are
never negotiable.

## 6. Data and technology

The target architecture requires:

- native iOS and Android phone applications;
- contracted navigation foundations with portable server-side scoring contracts;
- PostgreSQL/PostGIS as the authoritative spatial store;
- versioned graph, hazard, and source snapshots;
- stable edge identifiers across graph releases;
- ingestion workers for official, partner, OSM, and community data;
- route-selection contracts that preserve the selected geometry or explain degradation;
- moderation, contributor trust, expiry, appeals, and audit trails;
- privacy-minimised analytics and operational observability;
- provider-licensed offline assets or self-operated equivalents.

Potential sources include OpenStreetMap; Italy's CCISS National Access Point catalogue;
available DATEX II or road-operator feeds; regional and municipal open data; licensed traffic
and weather providers; fleet observations; and moderated community reports. Each source
needs a separate licence, redistribution, freshness, coverage, and reliability review.

The production strategy should first contract a navigation foundation while Motia owns its
condition data, preference schema, ranking, and explanations. Full self-hosting is an option
only when scale and control justify the operational burden.

## 7. Market and customer sequence

The addressable opportunity spans consumer navigation, fleet route quality, road-asset
intelligence, mobility APIs, insurance or assistance, and public-sector road operations.
This draft intentionally does not publish a TAM number: a defensible estimate needs
country-level user, fleet, procurement, willingness-to-pay, and comparable-product research.

Initial sequence:

1. surface-sensitive cyclists, motorcyclists, drivers, commuters, and long-distance users;
2. delivery, field-service, roadside-assistance, and micromobility fleets;
3. municipalities, regions, and road operators;
4. insurers and established mobility platforms.

The first validation question is narrower than market size: will users repeatedly choose,
understand, and trust an explained non-fastest alternative, and will institutions pay for
condition intelligence that improves their operations?

## 8. Business model

Staged revenue options:

- free consumer route comparison and community contribution;
- premium preferences, alerts, explanations, and lawful personalisation;
- founding-member programme or pre-sales;
- B2B fleet subscriptions and paid pilots;
- B2G dashboards and co-funded mapping;
- API usage and white-label route intelligence;
- aggregate analytics only when lawful, licensed, anonymised, and contractually bounded;
- grants and research agreements, separately identified from recurring revenue.

Motia should not sell identifiable movement histories. Advertising is not a priority because
it can conflict with trust, map readability, distraction constraints, and privacy.

## 9. Go-to-market

### Evidence phase — Q4 2026 to H1 2027

- stabilise the super-beta and publish honest coverage metrics;
- recruit Milan-area cycling, motorcycle, accessibility, and road-user communities;
- interview at least 40 target users and 15 institutional buyers;
- measure route understanding, route acceptance, repeat use, and report quality;
- secure at least three credible design partners and prepare paid-pilot scopes;
- build in public through GitHub and founder-led updates.

### Differentiated-region phase — H2 2027 to 2028

- validate a second city with a materially different hazard profile;
- benchmark one north–south route family;
- deploy a controlled community programme and partner imports;
- test premium preferences and paid institutional pilots;
- release an experimental bounded-language preference interface only after deterministic
  scoring has validation evidence.

### Platform phase — 2028 to 2029

- expand corridor by corridor using release gates;
- introduce Motia Routing Intelligence for fleets and partners;
- commercialise APIs after unit cost, licences, and reliability are known;
- evaluate broader Italian and European expansion from demonstrated regional economics.

## 10. Open-source and community strategy

Open source is a trust, quality, and distribution strategy, not proof of data quality.
Contribution paths must serve technical and non-technical participants:

- code, tests, accessibility, documentation, localisation, and provider adapters;
- structured road-condition reports submitted only when safely stopped or after a trip;
- local validation events and corridor audits;
- transparent report states, expiry, correction, deletion, and appeals;
- public coverage, unknown-distance, source, freshness, and moderation metrics.

Verified community reports may affect routing only after documented confidence rules.
Personal addresses, continuous travel traces, faces, plates, and other unnecessary identity
data must not be published.

## 11. Roadmap

| Quarter | Product and data target | Commercial/organisation target | Gate |
| --- | --- | --- | --- |
| Q4 2026 | Controlled Lastrico super-beta; coverage baseline | Founder interviews; advisor and campaign preparation | Stability, privacy, claims review |
| Q1 2027 | Regional backend and moderation prototype | Design partners; company setup if justified | Provider and legal feasibility |
| Q2 2027 | Controlled public beta; data-quality dashboard | Conditional crowdfunding launch; first paid pilots | Readiness and anchor demand |
| Q3 2027 | Native phone alpha on one primary platform | Technical hires/contractors | Long-distance field tests |
| Q4 2027 | Second platform decision; comfort profiles | Premium and B2B pricing tests | Retention and unit cost |
| Q1 2028 | Second-region adapter | Additional paid pilots | Measured coverage quality |
| Q2 2028 | Prompt-to-schema experiment | Motia platform positioning | Safety and ambiguity corpus |
| Q3 2028 | Broader hazard taxonomy | Municipal/fleet partnerships | Moderation at pilot volume |
| Q4 2028 | Motia Routing Intelligence beta | Repeatable B2B deployment | SLA and gross-margin evidence |
| Q1 2029 | API alpha; selected corridors | Seed-readiness review | Customer retention and pipeline |
| Q2 2029 | Automotive prototype if entitled | Automotive partner tests | Platform checklist evidence |
| Q3 2029 | Multi-region reliability | National expansion decision | Corridor economics |
| Q4 2029 | Engine/API candidate release | European discovery | Board-approved readiness |

Every milestone is conditional on funding, technical validation, data availability, legal
review, platform approval, and preceding release evidence.

## 12. Team

Initial needs:

- product/business founder;
- geospatial and routing lead;
- native iOS and Android capability;
- backend/data engineering;
- product design and research;
- community and moderation operations;
- fractional legal, privacy, security, insurance, finance, and fundraising advice.

### Founder verification required before external publication

Domenico Campanella Scali is presented, based only on founder-supplied information, as an
Italian founder with education in Business Economics, Management and Business Strategy, and
an in-progress Master in Fintech. The supplied profile also describes work involving
business analysis, financial services, banking projects, technology and AI-related
initiatives, plus practical prototyping and AI-workflow experience. Every name, institution,
qualification, status, and experience statement must be confirmed before publication.

The credible founder advantage is interdisciplinary product and business reasoning, direct
prototyping, and willingness to build publicly. The clear gap is senior geospatial, routing,
native-mobile, data, and safety-critical engineering depth; recruitment and advisory support
are core milestones, not footnotes.

## 13. Financial and funding outline

The detailed source is the quarterly model under `financials/`. This draft uses three
planning scenarios, not forecasts:

- **Lean:** one primary platform, small team, regional evidence, constrained provider use;
- **Base:** parallel product/data development, several paid pilots, 18–24 month runway;
- **Accelerated:** faster hiring and multi-region work, with materially higher execution and
  follow-on financing risk.

The model must separate operating revenue, grants or operating research income, founder
contribution, equity financing, loans, reward crowdfunding, and equity crowdfunding.
Founder compensation cannot remain zero indefinitely.

Equity crowdfunding may fit a community-led mobility company, but is not legally or
commercially ready. A campaign requires an incorporated issuer, authorised platform,
verified accounts and cap table, valuation methodology, legal and tax review, key investment
information, risk disclosures, data room, lead or anchor interest, shareholder-management
plan, and evidence that community enthusiasm converts to investment demand.

EU Regulation 2020/1503 governs covered EU crowdfunding services and sets a €5 million
12-month threshold within its scope; Italy permits business crowdfunding service providers
operating under that framework and the ESMA register. Current application to Motia and every
campaign statement require Italian counsel and an authorised platform.
[EUR-Lex](https://eur-lex.europa.eu/eli/reg/2020/1503/oj/eng);
[CONSOB](https://www.consob.it/web/area-pubblica/registro-crowdfunding-sezione-ordinaria).

## 14. Principal risks

| Risk | Initial mitigation |
| --- | --- |
| Sparse/stale/false condition data | Provenance, unknown coverage, expiry, corroboration, audit samples |
| Weak repeated demand | Behavioural tests before scaling engineering |
| Liability or misleading safety claims | Evidence language, legal review, no “safe route” guarantee |
| Technical-founder gap | Recruit senior complementary expertise and advisors |
| Single-founder dependency | Governance, documentation, succession and hiring |
| Provider cost and lock-in | Benchmarks, quotas, portable contracts, staged self-hosting |
| Platform rejection | Early entitlement/quality review; no approval promises |
| Community abuse | Rate limits, moderation, trust, reports, blocking, appeals |
| Privacy and location risk | Minimisation, consent, retention/deletion, Article 35 assessment |
| Fundraising failure/dilution | Staged scope, anchor demand, alternatives, valuation discipline |
| Incumbent replication | Proprietary verified evidence, workflow, trust, explainability, APIs |
| AI ambiguity | Allow-listed schema, confirmation, deterministic legal routing |

## 15. Investment case and next decision

Motia offers a credible problem thesis, a tangible open-source prototype, and a staged route
from surface-aware navigation to broader routing intelligence. It does not yet have
validated product-market fit, proprietary national data, production native navigation, or a
complete technical team.

The next investable step is a measured evidence programme, not a national launch. Funding
should buy four proofs:

1. repeated route-choice value;
2. reliable, measurable condition data;
3. provider-integrated native navigation;
4. willingness to pay from institutional pilots and selected consumers.

Only after those proofs should Motia commit to automotive surfaces, national operations, or
the Motia Routing Engine as a production platform.

## 16. Assumptions requiring verification

- founder identity, education, current study, experience, and public-profile wording;
- company name, domains, incorporation plan, ownership, cap table, and trademarks;
- market sizing, willingness to pay, competitor functionality, and procurement cycles;
- provider contracts, pricing, permitted route preservation, offline use, and SLAs;
- availability, licence, quality, and redistribution rights for every data source;
- CarPlay entitlement and Android Auto eligibility;
- privacy roles, lawful bases, retention, DPIA need, and UGC obligations;
- crowdfunding issuer eligibility, platform selection, costs, valuation, equity, and timing;
- grants, tax treatment, accounting policy, salaries, hiring availability, and insurance;
- every financial assumption until replaced by signed contracts or measured cohorts.

