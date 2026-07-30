# Marketing metrics and measurement plan

## Metric hierarchy

### Product truth

- eligible beta visitors by supported region and mode;
- first successful route comparison;
- provider/routing failure rate;
- seven-day and thirty-day retained users;
- routes per active user;
- valid feedback and approved corrections.

### Acquisition and community

- non-branded and branded search clicks;
- qualified content visits and watch time;
- beta registrations and consent rate;
- community joins;
- first and repeat contributors;
- accepted pull requests and approved data corrections;
- valid referral rate;
- cost per activated and retained user.

### Future commercial validation

- problem interviews completed;
- explicit willingness-to-pay evidence;
- paid conversion after a paid product exists;
- qualified partner/investor/crowdfunding opt-ins in separate consented segments.

Followers, raw impressions, stars, press mentions, and financing are context metrics—not
proof of product-market fit or operating revenue.

## Definitions

| Metric | Definition | Review |
| --- | --- | --- |
| qualified visit | session from intended audience with meaningful product/evidence engagement | weekly |
| registration | explicit beta opt-in with required consent | weekly |
| activation | first completed route comparison without a blocking error | weekly |
| route success | user confirms the comparison was understandable/useful; not a safety claim | weekly |
| D7/D30 retention | activated user with a qualifying return in 7/30-day window | monthly |
| valid contribution | report, issue, test, documentation, or code accepted as useful | monthly |
| approved correction | moderated correction admitted to the verified data workflow | monthly |
| referral rate | eligible active users generating a valid referred activation | monthly |
| CPActivated | attributable campaign spend / activated users | per experiment |
| CPRetained30 | attributable campaign spend / retained D30 users | monthly |

Define qualifying events, attribution window, bot filtering, and identity rules in the
analytics implementation before publishing numbers.

## Dashboard views

1. Funnel by week, region eligibility, mode, and acquisition source.
2. Cohort retention by activation week.
3. Content asset to qualified visit, activation, and contribution.
4. Community join to first/repeat contribution.
5. Experiment spend, founder hours, outcomes, and stop status.
6. Data quality: pending age, approval/rejection, corrections, and moderation load.
7. Claims/quality: complaints, public corrections, privacy incidents, and route-error reports.

Small cohorts must show absolute counts and denominators; suppress or aggregate breakdowns
that risk identifying individuals.

## Initial baseline and gates

Collect at least four weeks of stable, consented event data before setting targets. A paid
test requires reliable activation measurement. Scaling requires evidence of retained use,
moderation capacity, and an acquisition cost compatible with the current financial
scenario. Thresholds are approved per experiment; this document does not invent universal
benchmarks.

## Privacy and data quality

- collect the minimum event data and avoid continuous location histories;
- document consent, purpose, processor, retention, access, deletion, and lawful basis;
- separate product analytics from investor, media, and crowdfunding lists;
- never expose personal route or location data in a marketing dashboard;
- version event definitions and flag instrumentation changes;
- distinguish zero, unknown, unavailable, and not applicable;
- record source and confidence for external reporting.

## Reporting cadence

Weekly: reliability, activation, experiment health, moderation backlog.  
Monthly: cohorts, community quality, content efficiency, costs, and corrections.  
Quarterly: channel allocation, financial reconciliation, risks, and go/no-go decisions.

Every external metric statement needs period, denominator, definition, source, and current
status. Forecasts and targets must be labelled as management assumptions.
