# Motia investor data-room checklist

**Status:** readiness checklist; an item is not complete because a filename exists  
**Owner:** founder until a finance/legal operations owner is appointed  
**Rule:** no secrets, production credentials, raw personal location histories, unredacted
identity documents, or unlicensed datasets in a broadly shared data room

## Access model

Create staged access:

1. **Public:** pitch, product evidence, repository, high-level plan.
2. **Qualified investor:** model, risks, roadmap, source notes, non-sensitive diligence.
3. **Restricted diligence:** cap table, contracts, legal, tax, founder verification, security
   summaries under controlled access.
4. **Professional advisers only:** identity documents, privileged advice, vulnerability
   detail, bank and tax records.

Record downloader identity, access date, document version, and revocation. Use a question log
so every investor receives consistent material answers.

## A. Corporate and governance

- [ ] Legal entity certificate and current registry extract.
- [ ] Articles/bylaws and shareholder agreements.
- [ ] Registered office, tax identifiers, and beneficial owners.
- [ ] Board/director appointments and delegated authorities.
- [ ] Current fully diluted cap table.
- [ ] Founder, adviser, employee, and option/equity arrangements.
- [ ] Historical share issuances, loans, grants, and convertible instruments.
- [ ] Related-party transactions.
- [ ] Board/shareholder minutes and material approvals.
- [ ] Litigation, claims, insolvency, and regulatory declarations.
- [ ] Data-room index, access policy, and version register.

**Current expected gap:** entity, ownership, governance, and financing history require
founder/legal confirmation.

## B. Founder verification required before external publication

- [ ] Government identity verified privately.
- [ ] Founder-approved name and public biography.
- [ ] Degree certificates or university verification.
- [ ] Employment/project chronology and supporting evidence.
- [ ] Permission to name former employers/clients/projects.
- [ ] Conflict, non-compete, confidentiality, and IP-assignment review.
- [ ] Founder availability, compensation, expenses, and related-party policy.
- [ ] Approved founder photograph and image rights, if used.

Do not describe the founder as a senior AI researcher, senior software architect, geospatial
scientist, serial entrepreneur, or mobility executive without new verified evidence.

## C. Brand and intellectual property

- [ ] Motia and Lastrico trademark searches and counsel opinion.
- [ ] Domain, social handle, and app-store name availability.
- [ ] Ownership or assignment of code, designs, documents, logos, and datasets.
- [ ] Contributor licence/terms and employee/contractor IP clauses.
- [ ] Open-source software bill of materials and licence review.
- [ ] OSM/ODbL compliance and attribution procedure.
- [ ] Third-party map, routing, font, image, and data rights.
- [ ] Patentability/freedom-to-operate analysis only if justified.
- [ ] Provisional-brand status clearly recorded.

## D. Product evidence

- [ ] Current capability matrix linked to repository commits.
- [ ] Current beta URL, release date, and deployment status.
- [ ] Screenshots/video labelled with date, mode, geography, and limitations.
- [ ] Product analytics dictionary and consent basis.
- [ ] User research plan, raw evidence controls, and synthesised findings.
- [ ] Cohort metrics: activation, successful routes, retention, route choice, regret.
- [ ] Coverage and unknown-distance report.
- [ ] Product roadmap with conditional gates.
- [ ] Defect, incident, and release history.
- [ ] Accessibility and localisation status.

No planned native, national, automotive, live-data, or prompt capability belongs in the
“current product” evidence folder.

## E. Technical diligence

- [ ] Architecture, data flows, trust boundaries, and deployment diagram.
- [ ] Source repositories, branch protection, release process, and ownership.
- [ ] Build, lint, automated-test, dependency, and coverage reports.
- [ ] Mobile/native architecture decision record.
- [ ] Provider proof-of-concept results and route-integrity tests.
- [ ] Route-selection contract, graph/data versions, and reroute reasons.
- [ ] PostGIS/geospatial design and stable road-edge strategy.
- [ ] Offline/degraded mode and disaster-recovery design.
- [ ] Performance, availability, error-budget, and capacity assumptions.
- [ ] Observability, backups, restore tests, and incident response.
- [ ] Security threat model and recent assessment summary.
- [ ] Secret management, key restrictions/rotation, access control, and audit logging.
- [ ] Distributed abuse protection and moderation architecture.
- [ ] Technical debt and build-vs-buy register.

Keep exploitable vulnerability detail outside general investor access.

## F. Data, AI, and moderation

- [ ] Source and licence register for every ingested dataset.
- [ ] Data provenance, freshness, confidence, verification, and expiry schema.
- [ ] Import manifests, quality checks, and rollback history.
- [ ] Separation of observed, official, community, and inferred signals.
- [ ] False-positive/false-negative audit method.
- [ ] Coverage completeness and unknown-data methodology.
- [ ] Community report terms, moderation policy, blocking, appeals, and SLA.
- [ ] Contributor trust and abuse-control design.
- [ ] Preference ontology and allow-listed prompt schema.
- [ ] Prompt ambiguity/adversarial evaluation corpus.
- [ ] Scoring-model versions and deterministic regression tests.
- [ ] AI/provider inventory, terms, data retention, and processor role.

No document may call an inferred signal a verified current hazard or claim an AI model
guarantees route safety.

## G. Privacy, security, and regulatory

- [ ] GDPR roles, processing inventory, lawful bases, and data-flow record.
- [ ] Privacy notice, cookie/analytics policy, retention and deletion schedule.
- [ ] DPIA decision and completed DPIA where required.
- [ ] Processor agreements and international-transfer review.
- [ ] Data-subject access/deletion/export procedures.
- [ ] Breach and incident response; authority/user notification process.
- [ ] App Store privacy disclosures and SDK privacy manifests.
- [ ] Google Play Data Safety and location-permission declarations.
- [ ] User-generated-content terms and moderation compliance.
- [ ] Road-navigation claims and liability review.
- [ ] Insurance policies/quotes: cyber, professional, product, D&O where relevant.
- [ ] Accessibility and consumer-law assessment.

## H. Maps, routing, and automotive

- [ ] Map, search, routing, traffic, weather, and navigation provider terms/quotes.
- [ ] Provider usage model at 10k, 100k, 250k, and modelled MAU.
- [ ] OSM public-service exit plan.
- [ ] Custom-route fidelity, token, rerouting, and fallback tests.
- [ ] Native iOS/Android lifecycle and device-matrix evidence.
- [ ] Apple Developer organisation and CarPlay entitlement status.
- [ ] CarPlay addendum, templates, simulator, and real-head-unit test records.
- [ ] Android for Cars service/category/permission and quality checklist.
- [ ] Android Auto Preview-dependency risk decision.
- [ ] Store and automotive submissions, correspondence, and outcomes.

No entitlement application, submission, or prototype is described as approval.

## I. Market and commercial evidence

- [ ] Customer segmentation and bottom-up TAM/SAM/SOM method.
- [ ] Interview scripts, anonymised notes, and synthesis.
- [ ] Competitor matrix with dated primary evidence.
- [ ] Pricing experiments and willingness-to-pay results.
- [ ] Pipeline definitions and CRM extract.
- [ ] Letters of intent, pilot scopes, contracts, and invoices.
- [ ] Sales cycle, implementation effort, support load, and renewal evidence.
- [ ] Consumer cohort CAC, retention, conversion, and payback.
- [ ] B2B/B2G ACV, margin, procurement, and collection assumptions.
- [ ] Go-to-market experiment register and stopped experiments.

Waitlist, follower, GitHub-star, and unsigned-pipeline counts are not revenue or traction.

## J. Financial and tax

- [ ] 13-quarter Lean/Base/Accelerated source model.
- [ ] Formula and reconciliation checks.
- [ ] Financial assumptions, confidence, owner, and validation deadline.
- [ ] Unit economics and provider sensitivities.
- [ ] Funding scenarios, gross-to-net bridge, runway, and use of funds.
- [ ] Historical bank statements and founder spend, when verified.
- [ ] Management accounts and statutory statements when available.
- [ ] Payroll, contractor, VAT, corporation-tax, and store-revenue advice.
- [ ] Cash controls, payment approvals, and budget variance process.
- [ ] Grant applications/awards separated from equity and revenue.
- [ ] Cap-table and dilution sensitivities.
- [ ] Qualified accountant review.

The Base targets—400k Q4 2029 MAU, 8% paid conversion, €10 quarterly net ARPPU, and 48
active B2B/B2G contracts—remain management assumptions until measured.

## K. Fundraising and crowdfunding

- [ ] Board/founder-approved financing strategy.
- [ ] Security, valuation methodology, price, equity, and rights.
- [ ] Minimum and maximum target with coherent net milestone sets.
- [ ] Authorised ECSP selected from ESMA register.
- [ ] Platform due diligence and engagement letter.
- [ ] Legal, accounting, tax, and company-law opinions.
- [ ] Draft and approved key investment information sheet.
- [ ] Campaign communications and financial reconciliation.
- [ ] Anchor-investor evidence and conflict disclosures.
- [ ] Transaction, legal, production, marketing, and payment costs.
- [ ] Shareholder communication, nominee/SPV, voting, and reporting design.
- [ ] Follow-on dilution and option-pool model.
- [ ] Failed/underfunded campaign contingency.

The €5.60m Base requirement is financing across two events, not one campaign. Regulation
(EU) 2020/1503 excludes offers above EUR 5 million aggregated over 12 months from its scope;
specialist advice must confirm the applicable structure.

## L. Team and operations

- [ ] Organisation chart and role descriptions.
- [ ] Hiring plan, budget, and funding dependencies.
- [ ] Employment/contractor agreements and IP/confidentiality.
- [ ] Adviser terms and conflicts.
- [ ] Founder succession and key-person mitigation.
- [ ] Product, data, safety, security, moderation, and finance decision owners.
- [ ] Vendor register and business-continuity plan.
- [ ] Customer support and complaint process.
- [ ] Quarterly board/model/risk review calendar.

## M. Partner and contract records

- [ ] Provider and cloud contracts.
- [ ] Data licences and sharing agreements.
- [ ] Pilot/customer contracts and data-processing terms.
- [ ] University/public-sector collaboration agreements.
- [ ] Insurance and professional-adviser engagements.
- [ ] Material confidentiality, exclusivity, indemnity, SLA, and termination obligations.

## Final release check

- [ ] Every externally visible claim links to evidence.
- [ ] Current, planned, conditional, and vision content are separated.
- [ ] Dates, currency, scenario, gross/net, and financing/revenue labels reconcile.
- [ ] Founder facts are verified.
- [ ] No secret, personal trace, privileged advice, or unlicensed data is exposed.
- [ ] Access logs and document versions are current.
- [ ] Legal, accountant, technical, and founder sign-offs are recorded.

