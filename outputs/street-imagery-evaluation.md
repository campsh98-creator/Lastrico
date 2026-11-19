# Free street-level imagery for surface classification: evaluation (19 November 2026)

Question: can free street-level images tell Lastrico a road's surface (cobblestone, asphalt, rough), so that an unknown surface
becomes known? Reuses the Phase 4.20 and 4.36 measurements (`outputs/phase436-surface-intelligence/external-data-audit.md`,
section 3.D) and adds one fresh coverage count. No new model was downloaded or run.

## Decision

**Imagery stays a verification channel, not an automatic classifier.** A photo can be shown to a person or attached to an
observation (`lib/road-observations.ts`, channel `imagery-review`, the strongest one); no model fills an unknown surface. An
unknown surface is never asphalt, whatever a classifier says.

## Evidence

| Source | Access | Milan coverage (measured) | Licence | Use |
| --- | --- | --- | --- | --- |
| Panoramax | open STAC API, no key | **19 Nov 2026: 1,000 pictures returned (the page limit) for the central box 9.05–9.30 E, 45.40–45.55 N; 77 % from 2024, 592 from one contributor and 382 from another** | CC BY-SA 4.0 per picture | Review queue |
| KartaView | open API, no key | Phase 4.36: 1 photo within 500 m of Piazzale Lodi, 4 around the Duomo, all 2016–2018 | CC BY-SA 4.0 | Review queue |
| Mapillary | token (registration) | not verified: needs a credential | CC BY-SA 4.0 + API terms | Not used |
| Google Street View | key and card | not used | terms forbid scraping and model training | Out |

Coverage is still sparse: about one picture per 1.5 km of road in the central box, from two contributors, so it cannot be a layer.

## Model quality (Phase 4.20, StreetSurfaceVis, 9,122 German images)

- Setts precision 0.632 (about 24 of 38 predicted; 95 % interval roughly 0.47–0.77), calibration error 0.113: **NO-GO** for
  automatic use. A wrong "smooth" label would hide stone from the optimiser; a wrong "stone" label would make detours for nothing.
- A model trained on German images has not seen Milan's setts, tram rails or wet stone.

## What would change the decision

1. A labelled Milan sample (at least 300 images, two reviewers, setts/asphalt/other/cannot-tell).
2. Setts precision of at least 0.9 on that sample, with calibration error under 0.05.
3. Licence review of model-derived labels (share-alike) before any label enters a published dataset.

Until then: references only (provider, id, date, heading, licence), human review, and the observation rule that evidence can only
add caution.
