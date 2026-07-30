# Roadmap

This roadmap describes intended directions, not delivery promises.

## Stable beta

- validate representative journeys for cars, motorcycles, and bicycles;
- make turn instructions, rerouting, and GPS feedback reliable;
- establish repeatable moderation for community reports;
- measure road-surface data coverage and quality;
- improve accessibility and automated mobile testing;
- keep safety and data limitations visible throughout the experience.

## Regional coverage

- validate Milan and nearby municipalities as the first beta region;
- separate regional boundaries, geocoding, datasets, and attribution from the product's
  general identity;
- document and implement a city/region adapter before adding distant areas;
- evaluate Rome and other municipalities only after region-specific data, routing, GPS,
  mobile, and production checks exist;
- never present planned coverage as currently supported coverage.

## Data and community

- connect a report to the correct road segment rather than only to a line;
- publish only verified contributions with transparent provenance;
- add review and conflict-resolution tools;
- measure confidence and freshness without treating missing data as a smooth road;
- propose suitable corrections upstream to OpenStreetMap.

## Routing and safety

- evaluate rough-surface exposure as one signal alongside legal and mode-appropriate
  routing;
- improve mode-specific behaviour for cars, motorcycles, and bicycles;
- document provider limitations and degraded behaviour;
- test route progress, arrival, GPS loss, and rerouting without claiming safety
  certification.

## Infrastructure

- define limits and caches for mapping services;
- add observability without tracking users' journeys;
- evaluate providers or managed instances before increasing traffic;
- document D1 backup, restore, and migration procedures.

## Native experience

- prototype foreground iPhone navigation;
- assess technical and road-safety requirements for CarPlay;
- consider requesting Apple's entitlement only after a stable mobile beta.

See issues labelled `good first issue`, `help wanted`, `data`, `navigation`, and `ux` for
focused work.
