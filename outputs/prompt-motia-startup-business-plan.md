# Execution prompt — Motia startup repository and investor business plan

## Role and release ownership

Act as an autonomous cross-functional startup team with one release owner responsible for
integration, factual consistency, financial reconciliation, document production, and final
quality assurance. Independent agents may cover finance, market research, strategy,
marketing, community, investor materials, automotive platforms, and brand design, but no
agent may redefine the verified product state or publish unsupported claims.

## Objective

Transform this repository into the first strategic startup repository for **Motia**, the
parent mobility-intelligence company, while preserving **Lastrico by Motia** as the first
working product. Produce an internally consistent, investor-ready working package for
2026–2029, including two business-plan drafts, an adversarial review between them, a
formula-driven financial model, community and marketing strategies, crowdfunding and
investor materials, a provisional Motia identity, and a polished Italian business plan in
DOCX and PDF.

## Non-negotiable product and brand architecture

- Parent company: **Motia**.
- Parent tagline: **Routes shaped around you.**
- Platform: **Motia Routing Intelligence**.
- Future engine/API: **Motia Routing Engine**.
- First product: **Lastrico by Motia**.
- Lastrico tagline: **Smoother roads. Smarter routes.**
- Explain Motia as a coined name and include a simple pronunciation guide without claiming
  linguistic origins, registrations, or trademark protection that have not been verified.
- Motia is not tied to Milan, cobblestones, one transport mode, or one city.
- Lastrico is the focused product wedge: the current tested beta is a Milan PWA using road
  surface information for car, motorcycle, and bicycle route comparison.
- Never describe planned national coverage, native apps, CarPlay, Android Auto, live hazard
  data, conversational routing, production SLAs, or commercial traction as already working.

## Central product thesis

Use the founder thesis **“The future interface of navigation is the prompt.”** Explain that
natural language translates user intent into a versioned, bounded, reviewable preference
schema. It does not replace deterministic graph routing, legal constraints, provider
validation, or safety-critical logic. The user must confirm interpreted preferences; unknown
data stays unknown; hard legal restrictions cannot be overridden.

## Evidence and claims policy

- Use repository evidence for current capabilities.
- Use authoritative, current primary sources for market, platform, regulatory, pricing, and
  road-safety facts. Record access dates.
- Label each material statement as current fact, management assumption, target, conditional
  milestone, or long-term vision where ambiguity could mislead.
- Flag all founder biography, trademark, legal structure, valuation, equity, campaign,
  market-size, pricing, provider-contract, and regulatory statements requiring confirmation.
- Never promise a safe route, accident prevention, platform approval, national hazard
  coverage, investment return, fundraising success, or specific deployment dates.
- Do not treat missing evidence as evidence of a safe, smooth, lit, or hazard-free road.
- Do not treat equity or debt financing as operating revenue.

## Founder profile

Use only the founder information explicitly supplied in the project brief, with the heading
**“Founder verification required before external publication.”**

- Domenico Campanella Scali, Italian founder.
- Business, economics, and management background.
- Bachelor’s degree in Business Economics, Università Politecnica delle Marche.
- Master’s degree in Management and Business Strategy, Università degli Studi di Verona.
- Current Master in Fintech, Politecnico di Milano Graduate School of Management.
- Experience involving business analysis, financial services, banking projects, technology,
  AI-related initiatives, software prototypes, and AI-enabled workflows.
- Interests in fintech, innovation, data, AI, and entrepreneurship.
- Currently developing Lastrico as the first prototype under the Motia vision and willing
  to act as the public face of the project.

Do not describe the founder as a senior AI researcher, senior software architect, geospatial
scientist, established serial entrepreneur, or mobility-industry executive. State the need
for complementary geospatial, routing, mobile, data, design, legal/privacy, and fundraising
expertise. Do not invent or generate a founder portrait.

## Required work sequence

1. Audit repository evidence, current documentation, source code, tests, and Git state.
2. Create this prompt before feature/document implementation.
3. Research only the current facts required for the investment case and source register.
4. Produce `MOTIA_BUSINESS_PLAN_DRAFT_1.md`.
5. Produce the quarterly financial model and supporting assumptions.
6. Write `DRAFT_1_CRITICAL_REVIEW.md` from a sceptical investor, CFO, product, legal,
   technical, and community perspective.
7. Revise all material weaknesses into `MOTIA_BUSINESS_PLAN_DRAFT_2.md` and record changes in
   `DRAFT_2_CHANGELOG.md`.
8. Produce the strategy, product, marketing, community, crowdfunding, investor, brand, and
   market-research companion files.
9. Build the final Italian investor working draft from Draft 2 and the reconciled model.
10. Render and inspect the spreadsheet, DOCX, and every PDF page; repair any content or layout
    defects before release.
11. Run repository tests and document validation checks.
12. Commit in logical groups and push only `docs/motia-business-plan`; do not open or merge a
    pull request without explicit founder approval.

## Required deliverables

### Business plan

- `docs/business-plan/MOTIA_BUSINESS_PLAN_DRAFT_1.md`
- `docs/business-plan/DRAFT_1_CRITICAL_REVIEW.md`
- `docs/business-plan/MOTIA_BUSINESS_PLAN_DRAFT_2.md`
- `docs/business-plan/DRAFT_2_CHANGELOG.md`
- `docs/business-plan/MARKET_RESEARCH_REQUIRED.md`
- `docs/business-plan/final/MOTIA_BUSINESS_PLAN_2026_2029.docx`
- `docs/business-plan/final/MOTIA_BUSINESS_PLAN_2026_2029.pdf`
- `docs/business-plan/final/MOTIA_BUSINESS_PLAN_SOURCE_NOTES.md`
- `docs/business-plan/final/MOTIA_BUSINESS_PLAN_VALIDATION_CHECKLIST.md`

### Finance

- `financials/MOTIA_FINANCIAL_MODEL.csv`
- `financials/MOTIA_FINANCIAL_MODEL.xlsx`
- `financials/MOTIA_FINANCIAL_ASSUMPTIONS.md`
- `financials/MOTIA_FUNDING_SCENARIOS.csv`
- `financials/MOTIA_UNIT_ECONOMICS.md`

### Strategy, product, brand, crowdfunding, and investors

- `docs/brand/BRAND_ARCHITECTURE.md`
- `docs/brand/ICON_CONCEPTS_DRAFT_1.md`
- `docs/brand/ICON_CONCEPTS_DRAFT_2.md`
- provisional SVG assets under `docs/business-plan/final/assets/`
- `docs/product/MOTIA_PRODUCT_VISION.md`
- `docs/product/LASTRICO_PRODUCT_ROADMAP.md`
- `docs/strategy/FUNDING_STRATEGY.md`
- `docs/strategy/GO_TO_MARKET.md`
- `docs/strategy/RISK_REGISTER.md`
- `docs/crowdfunding/MOTIA_CROWDFUNDING_NARRATIVE.md`
- `docs/crowdfunding/FOUNDER_VIDEO_SCRIPT.md`
- `docs/investors/INVESTOR_DECK_OUTLINE.md`
- `docs/investors/ONE_PAGE_SUMMARY.md`
- `docs/investors/INVESTOR_FAQ.md`
- `docs/investors/DATA_ROOM_CHECKLIST.md`

### Marketing and community

- `docs/marketing/MARKETING_STRATEGY.md`
- `docs/marketing/SEO_STRATEGY.md`
- `docs/marketing/CONTENT_STRATEGY.md`
- `docs/marketing/SOCIAL_MEDIA_PLAN.md`
- `docs/marketing/YOUTUBE_STRATEGY.md`
- `docs/marketing/MEDIA_OUTREACH_STRATEGY.md`
- `docs/marketing/COMMUNITY_GROWTH_PLAN.md`
- `docs/marketing/MARKETING_EXPERIMENTS.md`
- `docs/marketing/MARKETING_METRICS.md`
- `marketing/MARKETING_BUDGET.csv`
- `marketing/CONTENT_CALENDAR_Q4_2026.csv`
- `marketing/CREATOR_AND_MEDIA_TARGET_TEMPLATE.csv`
- `marketing/GROWTH_EXPERIMENT_BACKLOG.csv`
- `docs/community/OPEN_SOURCE_STRATEGY.md`
- `docs/community/CONTRIBUTOR_ONBOARDING.md`
- coherent updates to `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`.

## Financial model specification

- Forecast 13 exact quarters: Q4 2026 through Q4 2029.
- Scenarios: Lean, Base, Accelerated.
- Show users, paid users, paid conversion, B2C revenue, B2B/B2G contracts and revenue,
  grants/other operating income, total operating revenue, payroll/contractors, infrastructure
  and maps, data/moderation, legal/security/insurance, field testing, sales/marketing,
  administration/contingency, total operating costs, operating cash flow, financing inflows,
  closing cash, burn, runway, and funding requirement.
- Treat August–September 2026 as planning/preparation outside the formal forecast.
- Model sustainable founder compensation; any temporary reduction must be explicit.
- Keep financing separate from revenue and grants separately identifiable.
- Include formula-driven assumptions, scenario logic, checks, sources, and a chart dashboard
  in the XLSX; export transparent flat CSVs.
- Create credible Lean/Base/Accelerated fundraising scenarios with target, transaction cost,
  net proceeds, indicative equity range, runway, funded milestones, hiring, infrastructure,
  and risks. Any valuation is illustrative and must explain method and limitations.
- The preferred scenario for the final plan is Base unless the completed model demonstrates
  a more credible choice.

## Final business-plan specification

- Language: Italian.
- Title: **MOTIA — Business Plan 2026–2029**.
- Subtitle: **Routes shaped around you.**
- Product line: **Lastrico by Motia / Smoother roads. Smarter routes.**
- Status: **Investor Working Draft**.
- Version 1.0, July 2026.
- A4 portrait, target 10–14 pages, selectable text, restrained editorial design, page
  numbers, consistent styles, accessible charts, no fake confidentiality marking.
- Use a clean MOTIA wordmark and provisional continuous-path abstract M; at most three first
  concepts and one documented second-round refinement. Mark the identity unregistered,
  provisional, founder-review pending, and subject to trademark clearance.
- Include a compact visual of the Motia/Lastrico architecture and charts for user growth,
  revenue/cost trajectory, cash/runway or funding, and use of funds. All chart values must
  come from the verified financial source data.
- If no verified founder photograph exists, use a professional text-only founder layout
  stating that a photograph may be added after approval.

## Acceptance criteria

- Every named deliverable exists and opens correctly.
- Draft 2 demonstrably resolves the critical review or explains unresolved gaps.
- All founder details are consistently marked for confirmation.
- Current Lastrico beta, planned Motia capabilities, and long-term vision are visually and
  verbally distinct.
- Quarterly model totals reconcile; checks equal zero or PASS; financing is not revenue.
- Marketing budgets reconcile to the financial model.
- Crowdfunding is conditional, regulated, and not described as ready or guaranteed.
- Current platform, provider, legal, privacy, and automotive limitations remain explicit.
- DOCX renders without clipping, overlap, broken tables, orphan headings, or missing assets.
- PDF is A4, text-selectable, 10–14 pages where feasible, and every rendered page has been
  visually inspected.
- XLSX sheets have readable widths, frozen headers where useful, source notes, formulas, and
  no spreadsheet errors.
- Existing application code and prior documents remain preserved.
- Tests and document checks pass, secrets remain excluded, and no production deployment,
  remote change, pull request, or merge occurs without authority.

## Release conditions

Release the document package only after the financial model, Draft 2, companion documents,
DOCX, PDF, spreadsheet renders, automated checks, and manual visual review agree. Record
unresolved founder, legal, market, regulatory, provider, and trademark questions explicitly
rather than hiding them. Push the dedicated documentation branch only; stop before any pull
request.
