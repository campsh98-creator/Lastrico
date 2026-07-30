# Motia risk register

**Status:** management risk register  
**Review cadence:** monthly during beta; before every financing, provider, data, geographic,
or store-release decision

Scale: probability and impact are **Low / Medium / High / Critical**. Ratings are management
judgements requiring owner review, not quantified actuarial conclusions.

| ID | Risk | Probability | Impact | Early warning indicator | Mitigation / decision control | Accountable owner |
| --- | --- | --- | --- | --- | --- | --- |
| R01 | Current beta is mistaken for a production navigator | Medium | High | Claims exceed repository evidence | Claims register; current/planned/vision labels; release review | Founder / product |
| R02 | Incorrect route or silent provider substitution | Medium | Critical | Displayed and navigated geometry diverge | Versioned route contract; reroute reason; field regression; explicit user notice | Routing lead |
| R03 | Incomplete road-condition coverage | High | High | Unknown route share remains high | Publish unknown metres; zone gates; source partnerships | Data lead |
| R04 | Stale or false hazard evidence | High | High | Confirmations fall; report age rises | Provenance, expiry, corroboration, moderation, rollback | Data/moderation lead |
| R05 | Community abuse or coordinated false reports | Medium | High | Duplicate clusters, unusual accounts or geography | Distributed rate limits, trust levels, blocking, audit and appeals | Trust and safety |
| R06 | Unsafe reporting interaction while moving | Medium | Critical | Reports initiated during active driving | Stopped/post-trip flow; automotive template limits; telemetry audit | Product / safety |
| R07 | Location privacy or GDPR failure | Medium | Critical | Data retained beyond purpose; consent mismatch | Minimisation, DPIA, retention/deletion, processor register, privacy review | Privacy owner / counsel |
| R08 | Images reveal faces, plates, homes, or metadata | Medium | High | Moderation finds unredacted evidence | Strip metadata, blur/redact, restrict public evidence, deletion route | Trust and safety |
| R09 | OSM or third-party licence incompatibility | Medium | Critical | Source lacks rights or attribution | Per-source licence register; legal review; separated databases | Data/legal |
| R10 | Public OSM services become unavailable or block usage | High | High | Rate-limit or policy warnings | Contracted/self-hosted production services; quotas and cache policy | Platform lead |
| R11 | Navigation/map provider cost exceeds unit model | Medium | High | Cost per session rises above threshold | Quotas, scenario tests, contract negotiation, provider portability | CFO / platform |
| R12 | Provider lock-in prevents Motia route control | Medium | High | Custom route cannot survive rerouting | Competing proof of concepts; abstraction; route-token tests | CTO / routing |
| R13 | Native mobile complexity delays evidence | High | High | PWA work does not transfer to phone lifecycle | One-platform sequence if needed; experienced native hires; device matrix | CTO |
| R14 | CarPlay entitlement is not granted | Medium | High | Apple declines or requests changes | Apply early; stable phone app; compliant template design; do not promise | iOS/product |
| R15 | Android Auto approval or Preview dependency fails | Medium | High | Quality review or SDK changes block release | Use Android for Cars standards; isolate Preview dependency; fallback plan | Android/product |
| R16 | GPS, battery, audio, or background guidance is unreliable | Medium | Critical | Route abandonment, battery or crash reports | Field tests, lifecycle instrumentation, degraded mode | Mobile leads |
| R17 | Prompt parser misinterprets user intent | Medium | High | Confirmation corrections or route regret increase | Allow-listed schema, confidence threshold, confirmation, test corpus | AI/product |
| R18 | AI is treated as routing authority | Low | Critical | Free-form output reaches route constraints directly | Deterministic legal/routing layer; architecture review; feature flag | CTO / safety |
| R19 | Existing competitors copy visible features | High | Medium | Similar controls appear before moat develops | Evidence quality, ontology, integrations, community, execution | Founder / product |
| R20 | Users value the problem but do not retain | High | High | Strong first-use feedback, weak D30 | Narrow recurring use case; route quality interviews; stop expansion | Product / growth |
| R21 | Willingness to pay is lower than forecast | High | High | Paid-intent and conversion miss targets | Test price/value early; B2B mix; revise burn and funding | Founder / finance |
| R22 | B2B sales cycle and integration cost are underestimated | High | High | Pilots stall or require custom builds | Paid discovery, standard contracts/API, stage-gate custom work | Commercial lead |
| R23 | Community growth does not produce reliable evidence | Medium | High | Joins grow, verified contributions do not | Contributor funnel, feedback, trusted roles, professional data operations | Community/data |
| R24 | Open-source governance or security failure | Medium | High | Unreviewed changes, maintainer bottleneck, disclosure gaps | Maintainer rules, review ownership, security policy, release controls | Maintainer / security |
| R25 | Single-founder dependency | High | High | Decisions, fundraising, product and communications queue behind founder | Delegated owners, board/advisors, documentation, complementary hires | Founder / board |
| R26 | Founder biography or credentials are published incorrectly | Medium | High | Materials disagree or evidence is missing | “Founder verification required” gate and documentary review | Founder / counsel |
| R27 | Inability to recruit geospatial/mobile leadership | Medium | High | Critical roles remain vacant | Focused scope, advisor network, contractor bridge, realistic compensation | Founder |
| R28 | Crowdfunding campaign launches prematurely | Medium | Critical | No anchor demand, due diligence, legal entity, or coherent minimum use | Readiness checklist; authorised platform/counsel; delay campaign | Founder / finance / counsel |
| R29 | Crowdfunding fails or damages follow-on signal | Medium | High | Weak pre-commitment or conversion | Pre-launch demand test, minimum viable target, parallel financing path | Founder / finance |
| R30 | Excessive dilution or unrealistic valuation | Medium | Critical | Round terms block option pool or later investors | Cap-table model, valuation methods, counsel, investor negotiation | Founder / board |
| R31 | ECSPR or company-law route is misunderstood | Medium | Critical | Planned offer exceeds scope or uses unauthorised provider | Authorised ESMA-registered provider; specialist legal/tax review | Counsel |
| R32 | Trademark or company-name conflict | Medium | High | Search/clearance identifies earlier rights | Clearance before campaign/app launch; provisional identity | Founder / IP counsel |
| R33 | Security incident or credential exposure | Medium | Critical | Secret scanning or anomalous access alerts | Key restrictions/rotation, least privilege, incident response, audits | Security owner |
| R34 | Operational outage during active navigation | Medium | Critical | Error and latency budgets breached | Redundancy, cached guidance, fallback, on-call, status communication | SRE/platform |
| R35 | Nationwide wording outruns verified coverage | Medium | High | Support complaints outside validated zones | Coverage map, corridor releases, no blanket claim | Product / communications |
| R36 | Road-condition insight is marketed as safety certification | Medium | Critical | “Safe/safest/prevents accidents” appears | Copy tests, legal review, independent impact study before claims | Founder / legal |
| R37 | Financial runway is overstated | Medium | Critical | Provider/hiring costs exceed model or funding slips | Quarterly scenario reconciliation; financing separate from revenue | Finance owner |
| R38 | Accelerated hiring increases burn before validation | Medium | High | Headcount grows without retention/pilots | Hiring gates, probationary contracts, board budget control | Founder / finance |
| R39 | Public-sector data cannot be reused commercially | Medium | High | Licence or access conditions block ingestion | Dataset-level rights review; alternative sources; no unauthorised import | Data/legal |
| R40 | Weather, collision, or inferred data is presented as a current hazard | Medium | High | Old aggregate signal appears as verified event | Separate observed/inferred states, expiry, explanation | Data/product |

## Critical linked controls

### Product release

R02, R03, R04, R06, R16, R17, R18, R34, and R36 require explicit sign-off before a route
feature reaches users.

### Geographic release

R03, R04, R09, R23, R35, R39, and R40 require a zone-level evidence pack and rollback owner.

### Automotive submission

R02, R06, R14, R15, R16, R17, R18, and R34 require simulator, device, real-head-unit, and
field evidence. Platform approval remains external.

### Financing or crowdfunding

R21, R22, R25, R26, R28, R29, R30, R31, R32, R37, and R38 require founder, finance, and
professional-advisor review.

## Monthly review record

For each High or Critical risk record:

- current rating and movement;
- evidence observed;
- mitigation owner;
- due date;
- cost and dependency;
- decision taken;
- residual risk accepted by whom.

Absence of an incident does not demonstrate that the risk is controlled.

