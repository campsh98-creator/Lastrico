# Motia business plan — Draft 2

**Planning horizon:** Q4 2026–Q4 2029  
**Status:** revised investor working draft; not an offer or forecast  
**Currency:** EUR, excluding VAT unless stated otherwise  
**Evidence cut-off:** 30 July 2026

## Investment thesis in one page

**Motia** is a proposed mobility-intelligence company whose purpose is to make route choice
reflect the traveller, vehicle, road, uncertainty, and acceptable trade-offs—not estimated
arrival time alone.

The architecture is:

- **Motia — Routes shaped around you:** parent company and trust promise;
- **Motia Routing Intelligence:** planned preference, condition, ranking, and explanation
  platform;
- **Motia Routing Engine:** future B2B/API layer;
- **Lastrico by Motia — Smoother roads. Smarter routes:** first product and technical wedge.

Lastrico currently proves a bounded proposition: an open-source PWA can compare candidate
routes for cars, motorcycles, and bicycles using known rough-surface evidence, display
trade-offs, support foreground navigation, and accept structured community reports in a
tested Milan beta.

It does not prove product-market fit, nationwide data, native navigation, operating
moderation, automotive approval, or safety outcomes. The proposed pre-seed therefore funds
a validation programme, not a national launch.

### The next four proofs

1. **Behaviour:** people repeatedly understand and choose an explained alternative.
2. **Data:** condition evidence can be licensed, verified, refreshed, and measured.
3. **Delivery:** a native navigation foundation can preserve or explicitly degrade the
   selected Motia route.
4. **Economics:** selected consumers and institutional customers pay at viable unit costs.

The preferred working path is the **Base scenario**, with an expanded pre-seed range subject
to the reconciled model, founder approval, legal advice, and investor demand. Equity
crowdfunding is one conditional route, not guaranteed financing and not operating revenue.

## 1. Why now and why this problem

Mainstream navigation interfaces commonly foreground ETA. Users frequently have preferences
that do not fit a single “fastest” objective: major-road continuity, surface comfort,
gradient, complexity, narrow-road avoidance, vehicle suitability, toll-versus-delay limits,
or confidence in the available evidence.

Italy's mobility and road-condition context makes the problem worth investigating. In 2024
Italy recorded 173,364 injury-producing crashes, 233,853 injuries, and 3,030 deaths; the
combined estimated social cost, including property-only damage, was about €22.6 billion.
This is context, not evidence that Motia prevents crashes.
[Istat](https://www.istat.it/comunicato-stampa/incidenti-stradali-in-italia-2024/).

The opportunity is to build an explainable decision layer that complements established map
and navigation foundations. The wedge begins with road surface because Lastrico already
implements it; the company thesis expands only after measured validation.

## 2. Proof, assumption, and vision

| Category | What may be stated |
| --- | --- |
| Proven in repository | PWA, open-source code, three routing modes, route alternatives, known rough-surface estimate, manoeuvres, foreground GPS, report states, Milan beta |
| Not yet proven | Repeat use, willingness to pay, production moderation, proprietary national data, provider route fidelity, native background navigation, viable unit economics |
| Conditional plan | Regional production service, one primary native app, paid pilots, second-region validation, bounded preference parser |
| Long-term vision | National corridor network, automotive surfaces, Motia Routing Intelligence, Motia Routing Engine/API, selected European expansion |

The final investor document and all public communication must use this hierarchy. “Safe
route,” “accident prevention,” and “complete coverage” are prohibited claims until
appropriate independent evidence exists.

## 3. Product: from Lastrico to Motia

### Lastrico today

Lastrico compares the fastest route with a lower known rough-surface-exposure alternative,
where a genuinely distinct alternative exists. It supports car, motorcycle, and bicycle
provider profiles rather than relabelling a single car route. Surface data can be incomplete
or stale. The public Nominatim, Valhalla, OSRM, and OpenFreeMap dependencies are suitable for
a small beta, not a commercial SLA.

### The next product

The production regional product should add:

- one primary native phone application with reliable background guidance;
- contracted search, map, routing, and navigation services;
- versioned road-condition data and measurable unknown coverage;
- moderation operations, not just database states;
- candidate explanations showing time, distance, exposure, confidence, and unknowns;
- opt-in, privacy-minimised analytics for route-choice validation;
- paid institutional pilot workflows.

The second native platform and automotive surfaces are gated by evidence. CarPlay requires a
native iOS navigation app and Apple entitlement; Android Auto requires the Android for Cars
App Library, navigation category, controlled templates, quality testing, and review.
Approval and timing cannot be promised.

### Prompt as interface, not routing authority

“The future interface of navigation is the prompt” means a user can express a complex policy
in natural language. A constrained interpreter produces a versioned allow-listed schema.

| AI may do | AI may not do |
| --- | --- |
| Classify supported preferences | Create legal access rules |
| Extract maximum delay and soft priorities | Generate unverified road facts |
| Flag ambiguity and ask for confirmation | Select an illegal road |
| Explain a deterministic score | Operate the vehicle-control or rerouting loop |

Graph constraints, candidate generation, route scoring, real-time state, and legal access
remain deterministic, tested, versioned, and auditable. Raw prompts are not retained by
default. Unsupported or conflicting requests are rejected or clarified.

## 4. Customer hypotheses and validation

| Segment | User/buyer and pain | 2026–27 test | Evidence to continue |
| --- | --- | --- | --- |
| Surface-sensitive riders/drivers | Person wants a smoother or more suitable route | 40+ interviews; route-choice experiment; repeat beta cohort | ≥30% choose an explained alternative in relevant cases; ≥20% D30 among activated testers |
| Fleet operations | Operations lead faces damage, delay variability, complaints, or unsuitable roads | 5 discovery partners; 3 scoped pilots | 3 paid or contractually committed pilots and a quantified workflow benefit |
| Municipality/road operator | Mobility or maintenance team needs structured condition evidence | 10 buyer interviews; one data-sharing and dashboard prototype | usable/licensed feed, named budget owner, procurement path, paid/co-funded pilot |

Thresholds are management targets, not forecasts. Failure triggers narrowing or repositioning,
not automatic scale.

## 5. Defensibility

The conversational interface alone is not a moat. Motia's potential defensibility is a
combination of:

1. **verified condition network:** provenance, freshness, confidence, expiry, and mode
   relevance;
2. **preference contract:** versioned schemas and a growing ambiguity/adversarial corpus;
3. **ranking evidence:** calibrated generalised-cost models and route-choice outcomes;
4. **workflow integration:** fleet, municipality, provider, and contributor tools;
5. **trust and transparency:** unknown coverage, reasons, corrections, auditability, and
   privacy boundaries.

Open-source client and core evaluation tools can build trust and contributions. Hosted
operations, verified partner feeds, commercial APIs, moderation workflow, service levels,
and customer integrations can remain paid services. Source licences and contribution terms
must be explicit.

## 6. Data governance and coverage

Every road-condition feature needs source, licence, observation time, import version,
confidence, freshness, mode relevance, verification state, and expiry. Every route score
records the routing graph, hazard snapshot, source import, and scoring-model versions.

Candidate sources—OSM, CCISS/National Access Point catalogues, DATEX II/operator feeds,
regions, municipalities, commercial providers, fleets, and community observations—must
pass separate access, licensing, latency, coverage, accuracy, and redistribution diligence.
An official catalogue is not assumed to be a uniform production API.

Coverage expands by versioned zone or corridor:

1. Milan and selected nearby municipalities;
2. a second pilot with a different hazard profile;
3. a north–south benchmark corridor;
4. additional corridors selected by demand, evidence, partners, and moderation capacity;
5. national claims only after measurable completeness and freshness gates.

Unknown distance remains visible and can block a strong recommendation.

## 7. Technology and operations

Target components:

- Swift/SwiftUI and Kotlin/Compose clients, sequenced rather than assumed simultaneously;
- contracted navigation foundation and server-side preference/ranking contracts;
- PostgreSQL/PostGIS, object storage, versioned ingestion and routing builds;
- stable road-edge compatibility mappings;
- candidate generation, hazard matching, scoring, and explanation services;
- route-selection contract with candidate ID, geometry/provider token, data versions, and
  reroute reason;
- provider-licensed offline/degraded assets, cached active route, recovery, and explicit
  route-fidelity notification;
- moderation, trust, abuse prevention, appeals, and audit logs;
- rate limits, observability, backups, restore tests, incident response, and rollback.

### Product release gates

- p95 route comparison latency ≤4 seconds in the pilot region;
- ≥99% crash-free closed-test sessions;
- no silent substitution of selected geometry;
- known/unknown coverage shown for every candidate;
- median verified-report age and moderation SLA measured;
- long-distance, poor-network, GPS-loss, accessibility, and mode-specific field tests pass;
- privacy, licence, store disclosure, and claims review complete.

## 8. Business model and unit economics

The model deliberately diversifies:

- free route comparison and contribution;
- premium consumer preferences, alerts, and explanations;
- founding-member programme or pre-sales;
- fleet subscription and paid pilots;
- municipal/road-operator dashboards or co-funded mapping;
- API usage and white-label intelligence;
- lawful aggregate analytics with source and privacy constraints;
- grants and research income separately reported.

Working consumer pricing is a hypothesis around €4.99/month or €39.99/year list price. Net
ARPU must account for annual/monthly mix, discounts, VAT treatment, eligible store
commissions, refunds, failed payments, and churn. Fleet and public-sector prices must be
tested from buyer value and support burden, not copied from comparables.

Required unit metrics:

- contribution margin per navigation session;
- net annual paid ARPU and paid conversion;
- acquisition cost, payback, churn, and cohort retention;
- B2B/B2G ACV, gross margin, sales cycle, implementation cost, and renewal;
- data/moderation cost per verified kilometre and active region.

No scaling decision occurs until provider cost sensitivity at 10k, 100k, and 250k MAU is
recalculated with quotes and real request volumes.

## 9. Go-to-market and community

The near-zero-budget strategy prioritises:

- weekly founder build notes with evidence and explicit limits;
- searchable technical and road-intelligence explainers;
- route case studies and transparent “what failed” content;
- local community partnerships and validation days;
- GitHub issues with guided technical and non-technical paths;
- a newsletter/waitlist owned by Motia rather than platform-only followers;
- earned media based on measured regional evidence;
- small paid experiments only after organic message and activation are understood.

Founder-led communication is capped at a sustainable cadence and cannot depend on invented
expertise. Guest experts, contributors, pilot partners, and documented product evidence must
gradually diversify the voice.

Community success is measured by verified contributions, confirmation/rejection rates,
moderation time, contributor retention, unknown-distance reduction, and corrections—not raw
report count.

## 10. Roadmap and go/no-go gates

| Period | Conditional outcome | Go/no-go evidence |
| --- | --- | --- |
| Q4 2026 | Controlled super-beta and baseline | stability, claims/privacy review, 40 interviews, coverage baseline |
| Q1–Q2 2027 | Regional backend, one primary native alpha, design partners | route fidelity PoC, 3 paid/committed pilots, moderation process, campaign readiness |
| Q3–Q4 2027 | Phone field beta, second-platform decision, pricing tests | route acceptance, D30 target, provider unit cost, long-distance tests |
| H1 2028 | Second-region adapter and bounded prompt experiment | data-quality gate, ambiguity corpus, signed partners |
| H2 2028 | Motia Routing Intelligence beta | repeatable B2B deployment, service reliability, acceptable gross margin |
| H1 2029 | API alpha; automotive prototype only if entitled | platform checklist, contract demand, route fidelity |
| H2 2029 | Multi-region scale decision | corridor economics, renewal, audited data quality, funding readiness |

The detailed quarter-by-quarter roadmap is maintained in
`docs/product/LASTRICO_PRODUCT_ROADMAP.md`.

## 11. Team and governance

### Founder verification required before external publication

The supplied profile names **Domenico Campanella Scali** as an Italian founder with a
Bachelor's in Business Economics from Università Politecnica delle Marche, a Master's in
Management and Business Strategy from Università degli Studi di Verona, and a current
Master in Fintech at Politecnico di Milano Graduate School of Management. It also describes
experience involving business analysis, financial services, banking projects, technology,
AI-related initiatives, software prototypes, and AI-enabled workflows. Every biographical
statement requires founder confirmation before circulation.

The honest founder advantage is interdisciplinary business/finance/technology reasoning,
problem discovery, hands-on prototyping, and willingness to build publicly. Motia must add
senior geospatial/routing, native-mobile, data, product-design, legal/privacy, and finance
capability.

Governance milestones:

- documented product and claims decisions;
- independent technical and legal advisors before fundraising;
- clear IP and contribution ownership;
- incorporated entity and cap table only after professional advice;
- quarterly model and risk-register review;
- named operational owners beyond the founder as the team grows.

## 12. Financial scenarios and funding

The auditable source is `financials/MOTIA_FINANCIAL_MODEL.csv` and its workbook. The 13-quarter
model spans Q4 2026–Q4 2029 and separates:

- consumer, B2B/B2G, and other operating income;
- grants/non-dilutive operating income;
- operating costs by function;
- founder contribution, equity, debt, reward, and equity-crowdfunding cash;
- operating cash flow and closing cash.

Three scenarios:

- **Lean:** one primary native platform, a small team, narrow regional scope, slower
  commercial ramp, lower raise but greater key-person and timing risk;
- **Base:** primary native app, production regional services, multiple pilots, measured
  second-region work, and sufficient specialist capacity;
- **Accelerated:** parallel platforms and multi-region investment, accepted only with strong
  anchors, technical leadership, and follow-on financing visibility.

The Base path is preferred because it can test the full investment thesis without assuming
immediate national scale. The exact target, net proceeds, runway, and equity range must be
taken from the reconciled funding-scenario file and approved before external use.

### Use of funds principle

Funds are allocated to product and geospatial engineering, native delivery, data and
moderation, provider/cloud infrastructure, legal/privacy/security/insurance, field
validation, founder and core-team runway, and a limited evidence-led go-to-market programme.
Campaign and transaction costs are shown separately so gross target is not confused with
operating cash.

Founder compensation may be temporarily reduced during preparation, but indefinite unpaid
work is not an assumption.

## 13. Equity crowdfunding: conditional path

Equity crowdfunding may align users, contributors, and investors, but community attention is
not investment demand. The campaign is not legally ready and must not launch until:

- issuer/entity, cap table, IP, accounts, and governance are verified;
- an authorised provider and Italian counsel confirm eligibility and current requirements;
- valuation methodology, equity range, investor rights, and dilution are approved;
- key investment information and risk disclosures pass review;
- data room, privacy, source licences, financial checks, and claims evidence are complete;
- lead/anchor interest and a credible communications audience exist;
- failure, extension, and post-campaign shareholder plans are documented.

Regulation (EU) 2020/1503 provides the EU framework for covered business crowdfunding and
sets a €5 million 12-month scope threshold. CONSOB states that providers operating in Italy
must be authorised under the Regulation and included in the ESMA register. Application to
Motia requires current professional confirmation.
[EUR-Lex](https://eur-lex.europa.eu/eli/reg/2020/1503/oj/eng);
[CONSOB](https://www.consob.it/web/area-pubblica/registro-crowdfunding-sezione-ordinaria).

Alternatives remain founder contribution, pre-sales/rewards, grants, strategic pilots,
angels, convertible instruments where advised, and staged institutional pre-seed. If the
campaign fails, Motia narrows to one platform and one region, protects contributors and
investors from misleading momentum claims, and re-plans before spending against unavailable
capital.

## 14. Risk, stop conditions, and responsible claims

Top risks are weak repeated demand, data cold start, false/stale reports, provider route
fidelity and cost, founder/team gaps, privacy and licensing, automotive rejection, community
abuse, fundraising failure, and incumbent response.

Stop or narrow when:

- relevant users do not choose or understand alternatives after two validated iterations;
- no institutional design partner defines measurable paid value;
- route fidelity cannot be preserved or transparently degraded;
- data freshness/coverage cannot meet the pilot threshold at sustainable cost;
- moderation cannot operate within documented quality and response targets;
- financing would require excessive dilution without milestone value;
- legal/privacy/licensing review blocks the intended data or product design.

Claims ladder:

1. **Current fact:** what repository evidence demonstrates.
2. **Measured pilot result:** published method, sample, period, and limits.
3. **Product suggestion:** an explained preference match, never a safety certification.
4. **Impact hypothesis:** requires independent evaluation.

No crash-reduction claim enters marketing until defensible research supports it.

## 15. Why invest, why wait, and the decision package

Why invest now:

- a concrete user problem and working open-source wedge;
- a broader but bounded platform thesis;
- multiple potential paying segments;
- community and data network effects if quality governance works;
- a disciplined route from regional evidence to an API.

Why wait:

- no measured retention or revenue yet;
- founder and technical-team verification gaps;
- uncertain provider route fidelity and cost;
- unproven national data access and moderation economics;
- fundraising and corporate readiness incomplete.

The appropriate decision is milestone financing. A pre-seed investor or community campaign
should fund the four proofs in this document and release later capital only when behaviour,
data, delivery, and economics meet the stated gates.

## 16. Matters requiring confirmation

Before any external publication or campaign, confirm:

- all founder biography and photograph decisions;
- Motia/Lastrico names, pronunciation wording, domains, trademark and visual similarity;
- entity, jurisdiction, cap table, IP assignments, contributor terms, and governance;
- preferred funding target, valuation method, equity, investor rights, and regulated platform;
- model salaries, taxes, VAT, store treatment, provider quotes, grant eligibility, and insurance;
- market, pricing, competitors, buyer budgets, procurement and cohort assumptions;
- data-source licence, quality, reuse, and availability;
- automotive eligibility, store policies, privacy disclosures, DPIA need, and UGC process;
- final charts, wording, claims, sources, and release approval.

