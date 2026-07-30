# Motia unit economics

**Status:** testable management targets. Motia has no verified acquisition, retention,
subscription, contract-margin or lifetime-value history yet.

## Consumer unit

The primary consumer unit is a paying user-quarter. The model deliberately keeps fixed
engineering and data-platform costs outside this contribution illustration.

| Planning assumption | Lean | Base | Accelerated |
| --- | ---: | ---: | ---: |
| Net B2C revenue per paid user-quarter | €9.50 | €10.00 | €10.50 |
| Navigation sessions per user/month | 8 | 10 | 12 |
| Variable map/navigation cost per session | €0.03 | €0.04 | €0.05 |
| Support/moderation per paid user-quarter | €0.75 | €0.90 | €1.10 |
| Contribution per paid user-quarter | €8.03 | €7.90 | €7.60 |
| Contribution margin | 84.5% | 79.0% | 72.4% |
| Target blended consumer CAC | €15 | €20 | €25 |
| CAC payback | 5.6 months | 7.6 months | 9.9 months |
| Target quarterly paid churn | 15% | 12% | 10% |
| Simple contribution LTV | €53.53 | €65.83 | €76.00 |
| Simple LTV/CAC | 3.57x | 3.29x | 3.04x |

Formulas:

```text
Variable route cost = monthly sessions × 3 × cost per session
Contribution = net quarterly ARPPU − variable route cost − support/moderation
Contribution margin = contribution ÷ net quarterly ARPPU
Payback months = CAC ÷ (quarterly contribution ÷ 3)
Simple contribution LTV = quarterly contribution ÷ quarterly churn
```

These are not cohort forecasts. They ignore fixed costs, taxes, working capital, annual-plan
timing and reactivation. Stop scaling paid acquisition if measured LTV/CAC is below 3x, CAC
payback exceeds 12 months, or retention deteriorates. Provider quotes may make the variable
cost materially higher.

## B2B/B2G unit

| Driver | Lean | Base | Accelerated |
| --- | ---: | ---: | ---: |
| Recognised annual revenue per active contract | €20k | €32k | €40k |
| Target direct delivery/data cost | ≤35% | ≤30% | ≤25% |
| Target contribution margin before shared platform costs | ≥65% | ≥70% | ≥75% |
| Target implementation payback | ≤12 months | ≤12 months | ≤12 months |

An “active contract” means a signed arrangement whose revenue can be recognised in that
quarter. Pipeline, memoranda, unpaid pilots and grants are not active contracts. Sales-cycle,
renewal, implementation effort, support load, procurement delay and bad-debt assumptions
must be measured separately for municipalities, fleets, insurers and platform customers.

## Route/session economics

Track these at provider, mode and geography level:

- routing, geocoding, search, tile, traffic and navigation cost per successful session;
- successful navigation sessions per active and paying user;
- cache hit rate where licensing permits;
- provider errors, retries and fallbacks;
- report moderation cost and verified reports per contributor;
- unknown road-condition distance per route;
- gross margin after all variable map, data, store, support and moderation costs.

Google and Mapbox list multiple separately metered events; a destination request is not the
entire cost of one successful Motia navigation session. Current provider reference links,
access dates and limitations are recorded in `MOTIA_FINANCIAL_ASSUMPTIONS.md`.

## Validation gates

1. Do not adopt a consumer price before at least two pricing experiments and cohort retention
   measurement.
2. Do not include B2B/B2G revenue before signed scope, acceptance, payment and recognition
   terms are modelled.
3. Do not scale marketing solely on installs; require retained navigation users and
   contribution payback.
4. Do not claim safety value, crash reduction or insurance savings from these economics.
5. Reforecast quarterly using actual invoices, recognised revenue, churn and provider usage.

## Commercial-budget boundary

Consumer CAC is funded only from the detailed channel-marketing component in
`marketing/MARKETING_BUDGET.csv`. The larger `Sales_Marketing_EUR` line in the financial
model also includes non-payroll B2B/B2G sales, partnership integrations, paid-pilot delivery
and an uncommitted commercial reserve. Do not divide that entire envelope by consumer
acquisitions when calculating CAC. The exact reconciliation is maintained in
`MOTIA_FINANCIAL_ASSUMPTIONS.md`.
