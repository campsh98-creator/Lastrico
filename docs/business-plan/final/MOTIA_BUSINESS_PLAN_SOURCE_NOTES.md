# Motia Business Plan 2026–2029 — source notes

**Document version:** 1.0  
**Evidence cut-off:** 30 July 2026  
**Status:** investor working draft; not an offer, forecast, or legal/financial advice

## Repository evidence reviewed

The current-product statements were checked against:

- `README.md`;
- `ROADMAP.md`;
- `docs/BUSINESS_PLAN.md`;
- `docs/architecture.md`;
- `docs/development.md`;
- `app/page.tsx`;
- `app/api/routes/route.ts`;
- `components/navigation/DirectionsSheet.tsx`;
- `components/reports/CommunityPanel.tsx`;
- `lib/navigation-state.ts`;
- `lib/navigation-instructions.ts`;
- `lib/routing-types.ts`;
- `lib/reporting.ts`;
- `db/schema.ts`;
- current tests and package scripts.

Repository evidence supports a React/Next.js PWA, MapLibre/OpenFreeMap/OSM map stack,
Nominatim search, Valhalla routing, temporary OSRM car fallback, car/motorcycle/bicycle
modes, known rough-surface exposure comparison, foreground GPS, manoeuvres, optional voice,
experimental rerouting, and report states. It does not support production moderation,
nationwide hazard coverage, native applications, CarPlay, Android Auto, promptable routing,
traffic SLAs, or commercial traction.

## Financial source

Charts and figures in the final DOCX/PDF are generated from:

- `financials/MOTIA_FINANCIAL_MODEL.csv`;
- `financials/MOTIA_FUNDING_SCENARIOS.csv`;
- `marketing/MARKETING_BUDGET.csv`.

The formal forecast contains 13 quarters from Q4 2026 through Q4 2029 and three management
scenarios: Lean, Base, and Accelerated. August–September 2026 is treated as a founder
planning period outside the forecast.

The final plan presents Base as the primary planning scenario:

- €1.5m net initial financing in Q4 2026;
- €4.1m conditional follow-on in Q2 2028;
- €5.6m cumulative net financing;
- approximately €2.017m closing cash at Q4 2029;
- approximately 12.1 months of indicated runway at Q4 2029.

These figures are management assumptions, not a forecast. Financing is separate from
operating revenue. Grants/other operating income remain identifiable. The marketing CSV is
the channel-marketing component of the larger sales and marketing envelope; residual
commercial spend covers non-payroll sales tools/travel/commissions, partnerships,
pilot delivery/onboarding, and uncommitted reserve. Sales payroll remains in payroll.

The workbook `financials/MOTIA_FINANCIAL_MODEL.xlsx` rewrites derived values as formulas and
includes assumptions, dashboard, source register, and identity checks. Revenue and cash
checks pass; no scenario has a negative closing-cash quarter under its assumed financing.

## External primary sources

Accessed 30 July 2026 unless otherwise stated:

- [Istat — Incidenti stradali in Italia 2024](https://www.istat.it/comunicato-stampa/incidenti-stradali-in-italia-2024/)
- [Regulation (EU) 2020/1503](https://eur-lex.europa.eu/eli/reg/2020/1503/oj/eng)
- [CONSOB — crowdfunding service-provider register information](https://www.consob.it/web/area-pubblica/registro-crowdfunding-sezione-ordinaria)
- [European Commission — National Access Points](https://transport.ec.europa.eu/transport-themes/smart-mobility/road/its-directive-and-action-plan/national-access-points_en)
- [OpenStreetMap licence](https://www.openstreetmap.org/copyright)
- [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/)
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- [OSMF attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
- [Apple — requesting CarPlay entitlements](https://developer.apple.com/documentation/carplay/requesting-carplay-entitlements)
- [Apple — integrating a CarPlay navigation app](https://developer.apple.com/documentation/CarPlay/integrating-carplay-with-your-navigation-app)
- [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- [Android — build a navigation app for cars](https://developer.android.com/training/cars/apps/navigation)
- [Android car-app quality](https://developer.android.com/docs/quality-guidelines/car-app-quality)
- [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Google Play user-generated-content policy](https://support.google.com/googleplay/android-developer/answer/9876937)
- [Google Play Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Google Play background-location requirements](https://support.google.com/googleplay/android-developer/answer/9799150)
- [Mapbox pricing](https://www.mapbox.com/pricing)
- [GDPR Article 35](https://eur-lex.europa.eu/eli/reg/2016/679/art_35/oj)
- [European Innovation Council — 2026 Work Programme](https://eic.ec.europa.eu/eic-funding-opportunities/eic-2026-work-programme_en)

Published provider pricing is a benchmark, not a quote. Every provider, dataset, grant, and
regulatory statement requires a current transaction-specific review.

## Founder information used

All founder information came from the founder-supplied project brief:

- Domenico Campanella Scali;
- Italian founder;
- Bachelor's degree in Business Economics, Università Politecnica delle Marche;
- Master's degree in Management and Business Strategy, Università degli Studi di Verona;
- current Master in Fintech, Politecnico di Milano Graduate School of Management;
- experience involving business analysis, financial services, banking projects, technology,
  AI-related initiatives, software prototypes, and AI-enabled workflows;
- interest in fintech, innovation, data, AI, and entrepreneurship;
- developing Lastrico as the first prototype under the Motia vision;
- willingness to act as the public face of the project.

Every biographical statement requires founder verification before external circulation. No
founder photograph was found or generated. The plan does not describe the founder as a
senior AI researcher, software architect, geospatial scientist, serial entrepreneur, or
mobility executive.

## Brand source

Motia, its pronunciation guide, taglines, brand architecture, and marks are provisional
founder-review concepts. They are unregistered and have not been cleared for corporate,
domain, trademark, linguistic, or visual-similarity conflicts. The final PDF uses a generated
continuous-path M and clean MOTIA wordmark; the source SVG concepts are preserved under
`docs/business-plan/final/assets/`.

## Assumptions requiring external validation

- founder biography, entity, ownership, cap table, IP assignment, and governance;
- Motia/Lastrico name, pronunciation, domains, trademark, and visual similarity;
- market size, competitors, buyer budgets, willingness to pay, retention, and sales cycles;
- provider pricing, contracts, route fidelity, custom route rights, offline rights, and SLA;
- each dataset's availability, quality, licence, reuse, latency, and coverage;
- privacy roles, lawful bases, retention, deletion, DPIA need, and moderation obligations;
- CarPlay entitlement, Android Auto eligibility, store approval, and automotive timing;
- salaries, hiring, taxes, VAT, store commissions, insurance, and accounting treatment;
- grants, crowdfunding eligibility, authorised platform, valuation, equity, investor rights,
  campaign costs, anchor interest, and timing.

## Excluded content

- invented market-size totals or unsupported market-share forecasts;
- founder portrait or unverified contact details;
- promises of a safe route, accident prevention, national coverage, automotive approval,
  fundraising success, or investment return;
- confidential marking;
- production credentials, personal locations, investor data, or partner data;
- a claim that an LLM controls legal or safety-critical routing.

