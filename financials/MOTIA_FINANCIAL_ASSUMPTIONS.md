# Motia financial model assumptions

**Model status:** management planning assumptions, not audited forecasts, valuation advice,
an investment offer, or evidence of commercial traction.  
**Forecast:** 13 exact quarters, Q4 2026 through Q4 2029. August–September 2026 is excluded
as preparation time.  
**Currency:** EUR, excluding VAT. Provider prices originally published in USD are reference
points only; the model does not assume a fixed EUR/USD exchange rate.

## Accounting boundary

- Operating revenue is B2C subscription revenue plus recognised B2B/B2G revenue plus
  separately identified grants and other operating income.
- Equity, crowdfunding proceeds, shareholder loans, debt, and other financing are never
  operating revenue.
- The CSV is a cash planning model. It does not model corporation tax, interest,
  depreciation, capitalised development, accounts receivable, deferred subscription
  revenue, or working-capital timing. A qualified accountant must convert it into statutory
  financial statements.
- Grants are uncommitted management assumptions. They remain zero in actual reporting until
  awarded and recognisable under the applicable terms.
- All development work is expensed in operating costs. The separate native/automotive
  product estimate must not be added again to the model.

## Model formulas

For scenario `s` and quarter `q`:

```text
Paid users = round(MAU × paid conversion)
B2C revenue = paid users × net quarterly B2C ARPPU
B2B/B2G revenue = active recognised contracts × quarterly revenue per contract
Total operating revenue = B2C + B2B/B2G + grants/other operating income
Total operating costs = sum of the seven operating-cost categories
Operating cash flow = total operating revenue − total operating costs
Closing cash = opening cash + operating cash flow + net financing inflows
Net burn = max(0, −operating cash flow)
Average monthly net burn = net burn ÷ 3
Runway = closing cash ÷ average monthly net burn
```

Runway is blank when quarterly operating cash flow is non-negative. `Revenue_Check_EUR` and
`Cash_Check_EUR` must both equal zero. Opening cash is zero because pre-forecast founder
spend has not been verified.

## Scenario drivers

| Driver at Q4 2029 | Lean | Base | Accelerated |
| --- | ---: | ---: | ---: |
| Monthly active users | 90,000 | 400,000 | 1,500,000 |
| Paid conversion | 6.0% | 8.0% | 10.0% |
| Paid users | 5,400 | 32,000 | 150,000 |
| Net B2C ARPPU per quarter | €9.50 | €10.00 | €10.50 |
| Active B2B/B2G contracts | 10 | 48 | 165 |
| Recognised revenue per active contract per quarter | €5,000 | €8,000 | €10,000 |
| Implied annual contract revenue | €20,000 | €32,000 | €40,000 |
| Total net financing | €2.0m | €5.6m | €6.5m |

These are targets, not market facts. Lean assumes staged development and one primary native
platform first. Base is the preferred planning case. Accelerated depends on unusually strong
consumer growth, conversion, enterprise sales, hiring, provider capacity, and moderation
performance and must not be used as a commitment.

## Consumer pricing assumption

Net B2C ARPPU is recognised revenue after VAT, store/payment fees, discounts and refunds. It
is not a published price. The €9.50–€10.50 quarterly range is broadly compatible with a
consumer consideration near €13.99–€15.49 per quarter including 22% Italian VAT and an
illustrative 15% distribution/payment deduction:

```text
Net revenue ≈ consumer price ÷ 1.22 × 0.85
```

The actual list price, annual-plan discount, direct/store mix, churn, refunds, Apple/Google
programme eligibility and tax treatment require validation. Google changed EEA subscription
fees in 2026; Apple programme eligibility is not assumed.

## Cost assumptions

The seven cost series are management budgets, not supplier quotes:

- payroll and contractors include sustainable founder compensation and specialist support;
- infrastructure/maps includes cloud, geospatial databases, tiles, search, routing,
  navigation, observability, backups and provider support;
- data/moderation includes ingestion, provenance, licences where needed, contributor
  operations and human review;
- legal/security/insurance includes privacy, licensing, company, platform, security and
  liability work;
- field testing includes devices, vehicles, accessibility and long-distance testing;
- sales/marketing is an aggregated envelope covering the narrower channel-marketing plan,
  non-payroll sales and business-development costs, partnerships, pilot delivery and an
  uncommitted reserve;
- administration/contingency includes finance, tools, travel and general reserve.

Total operating-spend mix over the forecast:

| Category | Lean | Base | Accelerated |
| --- | ---: | ---: | ---: |
| Payroll/contractors | 55.2% | 48.6% | 44.7% |
| Infrastructure/maps | 8.9% | 11.1% | 13.2% |
| Data/moderation | 6.9% | 8.8% | 10.8% |
| Legal/security/insurance | 4.3% | 2.2% | 1.8% |
| Field testing | 4.3% | 3.3% | 3.3% |
| Sales/marketing | 14.6% | 21.0% | 22.2% |
| Administration/contingency | 5.7% | 5.0% | 3.9% |

The quarterly sales/marketing series in `MOTIA_FINANCIAL_MODEL.csv` is the upper controlling
envelope. `marketing/MARKETING_BUDGET.csv` is only the externally itemised channel-marketing
component. Base salaries for sales or business-development employees remain in
payroll/contractors and are not in the residual below.

| Reconciliation, Q4 2026–Q4 2029 | Lean | Base | Accelerated |
| --- | ---: | ---: | ---: |
| Financial-model sales/marketing envelope | €278,000 | €1,395,000 | €3,175,000 |
| Detailed channel-marketing budget | €27,850 | €110,150 | €492,000 |
| Residual sales/BD/partnership/pilot envelope | €250,150 | €1,284,850 | €2,683,000 |
| Reconciliation check | €0 | €0 | €0 |

The residual is a cap, not committed spend. Its working allocation is:

| Residual use | Lean | Base | Accelerated |
| --- | ---: | ---: | ---: |
| Non-payroll sales tools, travel and commissions | €80,000 | €400,000 | €800,000 |
| Partnership and integration co-funding | €90,000 | €400,000 | €850,000 |
| Paid-pilot delivery and customer onboarding | €50,000 | €250,000 | €550,000 |
| Uncommitted commercial reserve | €30,150 | €234,850 | €483,000 |
| **Total residual** | **€250,150** | **€1,284,850** | **€2,683,000** |

Release residual funds only against signed partnerships, contracted pilots, measured
pipeline conversion or approved commercial experiments. If the detailed marketing plan
changes, preserve the quarterly financial envelope or formally reforecast.

## Financing and runway

The model records **net** cash received. `MOTIA_FUNDING_SCENARIOS.csv` assumes 5% indicative
legal, platform, due-diligence and transaction costs to bridge gross targets to net proceeds.
This percentage is unverified.

- Lean: €0.70m net pre-seed in Q4 2026 and a conditional €1.30m follow-on in Q4 2028.
- Base: €1.50m net pre-seed in Q4 2026 and a conditional €4.10m follow-on in Q2 2028.
- Accelerated: €2.20m net pre-seed in Q4 2026 and a conditional €4.30m follow-on in Q1 2028.

The second tranche is not assumed to be available at formation. It requires the milestone
evidence stated in the funding-scenario file and a new financing process. In particular, the
Base €5.6m is a three-year cumulative net requirement—not an initial crowdfunding target.
The financial model would have to be reforecast if the follow-on is delayed or smaller.

Base and Accelerated gross totals exceed €5m and cannot be described as one EU crowdfunding
offer within Regulation (EU) 2020/1503's scope. Any crowdfunding component requires an
authorised European crowdfunding service provider, legal advice, investor disclosures,
company-law and tax review, and confirmation of the rolling 12-month aggregation. No round,
valuation, equity percentage, return, or platform approval is guaranteed.

## External reference points

Sources were accessed 30 July 2026.

- Italy recorded 173,364 injury crashes, 233,853 injuries and 3,030 deaths in 2024; estimated
  social cost including property-only damage was approximately €22.6bn. This establishes
  problem importance, not Motia impact:
  [Istat, Road accidents 2024](https://www.istat.it/en/press-release/road-accidents-2024-2/).
- Google listed Navigation Requests at a 1,000-event free cap and USD 25 per 1,000 for the
  next tier; Routes, Places, geocoding and other events are separately metered:
  [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing).
- Mapbox listed Navigation SDK v3 metered pricing by MAU and trip:
  [Mapbox pricing](https://www.mapbox.com/pricing).
- OpenStreetMap data is ODbL-licensed, while public tiles are best-effort, lack an SLA and
  may not be bulk-downloaded for offline use:
  [OSM licence](https://www.openstreetmap.org/copyright) and
  [tile policy](https://operations.osmfoundation.org/policies/tiles/).
- Apple Developer Program membership was USD 99 per year and CarPlay navigation required a
  managed entitlement request:
  [membership](https://developer.apple.com/programs/enroll/) and
  [CarPlay entitlement](https://developer.apple.com/documentation/carplay/requesting-carplay-entitlements).
- Google Play listed a USD 25 one-time EEA registration fee. Subscription service-fee rules
  changed from 30 June 2026 and depend on programme and billing route:
  [registration](https://support.google.com/googleplay/android-developer/answer/14659200) and
  [service fees](https://support.google.com/googleplay/android-developer/answer/16954621).
- Android Auto navigation apps must meet navigation-category and car-quality requirements:
  [navigation apps](https://developer.android.com/training/cars/apps/navigation) and
  [car quality](https://developer.android.com/docs/quality-guidelines/car-app-quality).
- EU crowdfunding scope and investor-protection requirements:
  [Regulation (EU) 2020/1503](https://eur-lex.europa.eu/eli/reg/2020/1503/oj).

## Required validation before external use

Obtain written provider quotes, Italian payroll and employment estimates, accountant review,
insurance quotes, data-licence terms, app-store tax advice, pricing interviews, enterprise
letters of intent, grant eligibility evidence, fundraising counsel and founder approval.
Replace assumptions quarterly with observed cohorts, signed contracts and invoices.
