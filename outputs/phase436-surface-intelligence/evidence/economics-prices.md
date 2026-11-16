# Economic evidence — prices and limits (retrieved 2026-11-14 via web search summaries)

Method: five standard web searches on 2026-11-14. The results are search-engine summaries of vendor pages, not the
vendor pages themselves. Every number below is therefore **STRONGLY SUPPORTED at best** and must be re-read on the
vendor page before any decision to pay. Nothing was purchased or registered. Anything not listed is **UNKNOWN**.

| Option | What it provides (A routing, B geometry, C surface materials, D physical roughness, E reliability) | Price / limit found | Source | Label |
|---|---|---|---|---|
| Cloudflare Workers Free (current) | E (floor) | 100,000 requests/day, **10 ms CPU per HTTP request**, 50 subrequests per request; limits reset 00:00 UTC | https://developers.cloudflare.com/workers/platform/limits | STRONGLY SUPPORTED |
| Cloudflare Workers Paid | E | minimum **$5/month**; CPU per request up to 5 min (default 30 s); 10,000 subrequests per request; no request cap | https://developers.cloudflare.com/workers/platform/pricing/ | STRONGLY SUPPORTED (an older page says 1,000 subrequests: outdated) |
| Google Routes API (Compute Routes) | A, E; no surface data; Google terms on caching and use outside Google maps not checked | Essentials 10,000 free/month then $5.00 per 1,000 (volume tiers down to $0.38); Pro 5,000 free then $10.00 per 1,000; Enterprise 1,000 free then $15.00 | https://developers.google.com/maps/billing-and-pricing/pricing | STRONGLY SUPPORTED (mixed regional pages) |
| Mapbox Directions API | A, E; no pavement attributes in the API as far as the summaries show (not inspected) | 100,000 free requests/month, then ≈ $2.00 per 1,000 | https://docs.mapbox.com/ , third-party summaries | PLAUSIBLE (third-party) |
| Stadia Maps (hosted Valhalla fork) | A, E; same OSM data as today, so no new C/D | usage/credit based plans, 14-day trial; one aggregator lists $20–$250/month, not confirmed | https://stadiamaps.com/products/routing-navigation/ | UNVERIFIED price |
| Self-hosted Valhalla (own VM) | A with custom costing, E under own control; data still OSM | server cost unknown; operations burden; **UNKNOWN** | `docs/VALHALLA_CUSTOMIZATION.md` in the repo | UNKNOWN price |
| FOSSGIS public Valhalla (current provider) | A | free, public instance, 1 request/s politeness rule used in the repo; no SLA | `outputs/phase425-benchmark/PROVIDER_ARCHIVE.md` | VERIFIED (repo) |
| Mapillary imagery | potential C (visible pavement), not D | API free with rate limits; user content CC BY-SA by default; terms restrict automated access to the published APIs; commercial and ML-training clauses not confirmed; imagery coverage and dates not checked | https://www.mapillary.com/legal , https://help.mapillary.com/hc/en-us/articles/115001770409 | PLAUSIBLE; Agent 3 to confirm |
| Municipal / regional open data | potential B, C | normally free; licence per dataset (to be read by Agent 3) | see `external-data-audit.md` | see that file |
| Licensed pavement datasets, commercial computer vision on imagery, self-collected validated surface evidence | C, D | **UNKNOWN** (no public price list found; none to be assumed) | — | UNKNOWN |

How to read it: the decision rule from the phase brief is that no option should be paid for under category A (routing
computation) or E (reliability) when the verified failure originates in C (surface materials) or D (physical roughness).
Which category each verified failure belongs to is decided in `final-decision-report.md`, after the routing and data
audits. Workers Paid at $5/month is the only cheap, well-defined lever in this table; it matters only if Phase 4.37 needs
more than 10 ms of CPU per request.
