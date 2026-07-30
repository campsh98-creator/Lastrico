# Lastrico by Motia — product roadmap

**Status:** conditional management roadmap  
**Planning horizon:** August 2026–Q4 2029  
**Baseline:** Milan PWA beta; all future milestones depend on evidence, funding, data,
provider terms, and platform review

## Roadmap rules

- A target is not a committed release date.
- National basemap availability is not national verified hazard coverage.
- Native apps, CarPlay, Android Auto, live-data feeds, and promptable routing are planned.
- No phase advances because code merely compiles. It needs automated, field, privacy,
  provider, and operational verification.
- The selected Lastrico route remains primary; a provider change must be disclosed.
- Legal restrictions cannot be overridden and unknown evidence remains unknown.

## Preparation period — August and September 2026

This period sits outside the formal 13-quarter financial forecast.

| Workstream | Conditional deliverables | Exit evidence |
| --- | --- | --- |
| Product | Reconcile beta claims, interview priority users, define route-quality rubric | Current-state audit and interview plan |
| Technology | Provider proof of concept; route-integrity contract; technical gap audit | At least one credible production architecture tested |
| Data | Hazard taxonomy, provenance fields, coverage metric, licence register | Schema and sample import review |
| Company | Founder, company-name, and trademark facts prepared for verification | Professional advice commissioned or questions logged |
| Funding | Reconciled model and campaign readiness criteria | Funding scenarios separate financing from revenue |
| Automotive | Developer-account and CarPlay entitlement feasibility work begins | External dependency register; no approval assumed |

## Thirteen-quarter roadmap

| Quarter | Product and technology target | Data and community target | Commercial, team, legal, and funding gate |
| --- | --- | --- | --- |
| **Q4 2026** | Stabilise the Milan super-beta; repair routing, GPS, ETA, manoeuvres, and route visibility; publish honest coverage | Formal road-condition schema; moderation workflow design; controlled testers | Privacy/licence assessment; founder-led evidence content; company formation only when timing justifies it |
| **Q1 2027** | Contracted provider prototypes; PostGIS design; distributed throttling; route-version telemetry | Milan evidence audit; contributor onboarding; measure unknown metres | Select primary mobile platform and accountable technical lead; no campaign launch |
| **Q2 2027** | Production regional backend; first native phone alpha on one platform; network-loss behaviour | Nearby-municipality pilot; moderation dashboard alpha; source register | Crowdfunding only if legal entity, platform, KIIS/due diligence, anchor demand, and net-use case are ready |
| **Q3 2027** | Native phone closed beta; background guidance permissions; provider quota/fallback tests | Verified-evidence freshness and contributor trust pilot | First paid/co-funded pilot hypothesis; hire/contract complementary mobile and geospatial expertise |
| **Q4 2027** | Second mobile platform decision; route-comfort profiles; subscription instrumentation | Expand only where audit thresholds pass; moderation service levels | Evaluate retention, route acceptance, cost per session, and funding runway before broader release |
| **Q1 2028** | Stable iOS/Android phone navigation target; structured preference profiles | Second-region ingestion adapter; field-validation protocol | CarPlay/Android Auto implementation starts only after phone stability and entitlement feasibility |
| **Q2 2028** | Bounded natural-language preference parser alpha; deterministic scoring unchanged | Broader hazard taxonomy behind feature flags | B2B fleet design-partner test; privacy review of prompt and telemetry data |
| **Q3 2028** | Prompt interpretation confirmation UI; explainable candidate comparisons | Rome or Catania pilot if data and moderation are ready | Automotive simulator/head-unit testing; no public availability claim |
| **Q4 2028** | Motia Routing Intelligence private beta; route-policy API contracts | North–south corridor benchmark and long-route regression suite | Complete automotive prototypes and submission-readiness review only if phone reliability and entitlement gates pass |
| **Q1 2029** | Personal preference profiles with deletion/export; scoring-model version controls | Repeatable zone release and rollback | Conditional automotive submissions; validate B2C/B2B economics and decide build/buy routing scope |
| **Q2 2029** | Motia Routing Engine/API developer preview target | Partner ingestion and data-quality APIs | API design partners; security and licensing due diligence |
| **Q3 2029** | Multi-objective routing improvements; provider portability tests | Selected Italian corridor expansion | Seed-readiness review based on retention, quality, revenue, and operational evidence |
| **Q4 2029** | Conditional commercial API and broader Italian release; European pilot discovery only | Cross-region coverage report, not blanket national claim | Seed or strategic financing only if repeatable economics and governance are demonstrated |

## Release gates

### Gate A — regional production backend

- Public Nominatim, Valhalla, OSRM, and community tile services are not critical production
  dependencies.
- Provider credentials, quotas, costs, fallbacks, and licensing are documented.
- PostGIS or an equivalent spatial system supports versioned road-edge and hazard queries.
- Distributed abuse protection replaces process-local controls.
- Moderation owners and response targets exist.

### Gate B — native phone beta

- Foreground and background location behaviour matches store declarations.
- App Privacy and Google Data Safety information includes every embedded SDK.
- Active guidance survives ordinary backgrounding, audio interruption, and recoverable
  network loss.
- Route, GPS, rerouting, voice, battery, accessibility, and crash tests pass on a defined
  device matrix.
- A user can delete account, prompt, report, and location-linked information subject to
  documented retention requirements.

### Gate C — promptable routing

- Natural language produces only an allow-listed, versioned schema.
- Low-confidence and conflicting requests require clarification.
- The user confirms material preferences.
- Legal constraints and provider validation remain deterministic.
- Prompt parsing and route scoring have separate regression and adversarial evaluation
  corpora.
- Free-form generation is absent from the live navigation control loop.

### Gate D — automotive submission

- Native phone navigation is stable in long-distance field testing.
- Apple entitlement has been granted before CarPlay capability is claimed.
- CarPlay uses `CPMapTemplate` and approved interaction patterns.
- Android uses `CarAppService`, the navigation category, navigation-template permission,
  and vehicle-surface rendering.
- CarPlay simulator, Android test hosts/emulators, and multiple real head units pass
  connect, disconnect, reroute, audio, day/night, rotary/touch, and network-loss tests.
- Platform submission is complete; approval and timing remain external.

### Gate E — geographic release

- Coverage, freshness, false positives, false negatives, and unknown distance are measured.
- Source licences and redistribution rights are approved.
- Field validation represents each supported travel mode.
- Moderation capacity scales with expected reports.
- A zone can be disabled or rolled back without an app release.

## Work not scheduled as a promise

- Complete Italian hazard coverage.
- Guaranteed compatibility with all vehicles or head units.
- Accident prevention or certified safety.
- A proprietary foundation model.
- A production Motia Routing Engine before provider and unit-economic validation.
- European expansion before repeatable Italian operations.

## Quarterly evidence pack

Every quarter should close with:

- product release and incident notes;
- route-quality and reliability metrics;
- coverage and unknown-data report;
- moderation and contributor report;
- provider usage and cost report;
- privacy, security, and licence exceptions;
- financial variance and runway;
- milestone decision: continue, narrow, delay, or stop.
