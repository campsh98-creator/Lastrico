# Valhalla customization feasibility

Investigation: 2026-10-25. No production routing changes or remote mutations.

## Finding

Valhalla documents `linear_cost_factors` as a top-level request array. Each item is either
`{ "shape": "<polyline6>", "factor": 2 }` or a GeoJSON LineString Feature with
`properties.factor`. Values above one discourage traversing matched edges; one is neutral.
The geometry is matched by an edge walk and must follow the routing graph. Arbitrary straight
lines between report endpoints are therefore unsuitable without matching/preprocessing.
This is distinct from changing the route's estimated travel time.

Sources: [official route API](https://valhalla.github.io/valhalla/api/route/api-reference/),
[official OpenAPI schema](https://github.com/valhalla/valhalla/blob/master/docs/docs/api/openapi.yaml),
[maintainer explanation of matching failures](https://github.com/valhalla/valhalla/discussions/6062).

The upstream changelog introduces linear feature factors in 3.6.2. Subsequent releases fix
edge walking and factor handling. Version alone does not establish correctness or the
configuration of a public instance. The OpenAPI schema documents a configurable edge limit,
with 50,000 as its default; it is not a suitable Lastrico request budget.

Source: [upstream changelog](https://github.com/valhalla/valhalla/blob/master/CHANGELOG.md).

## Current endpoint: version observed, feature behavior unverified

Lastrico uses `https://valhalla1.openstreetmap.de/route`. The initial sandboxed `/status`
request failed at DNS resolution and the web reader could not access it. A later single
read-only request outside the network sandbox succeeded: the endpoint reported version
`3.9.1-618cad5` and `route` among its available actions. This establishes an observed build,
not effective feature limits or matching behavior. No public routing experiment was issued.
No controlled local Valhalla graph/runtime is present, so there is no verified local proof
of concept to enable. A mock accepting an extra field would not prove provider support.

Source: [provider status](https://valhalla1.openstreetmap.de/status), read 2026-10-25.

Upstream exposes the feature at the request level, alongside `auto`, `motorcycle` and
`bicycle` costings. This makes it a plausible fit, but effective support must be demonstrated
separately for each profile. Lastrico must never set access-override options such as
`allow_types`, change the selected profile, or bypass the existing extra-time constraint.

## Minimal next experiment

1. Use a pinned local Valhalla build and a small Milan graph, or a provider explicitly
   confirming support and an appropriate usage allowance.
2. Select one graph-aligned rough segment with an alternative path. Compare factor 1 and
   a moderate penalty for all three profiles. Verify changed geometry and legal access,
   plus unchanged travel time on an unchanged path. Include a malformed/misaligned feature.
3. Keep factors disabled by default. Bound request bytes, number of features, matched edges
   and total deadline; measure median and tail latency locally. Edge matching and potentially
   wider searches add work, but no quantitative overhead was measured in this audit.
4. Reuse the normal surface scoring and hard extra-time filter. On unsupported parameters,
   matching errors or timeout, retain the ordinary same-profile candidate flow.

Self-hosting is not intrinsic to the API, but a controlled provider/build is needed for a
repeatable experiment. Preprocessing is likely necessary for bundled OSM geometry to align
with the provider's current graph; persist graph/data version with that result. Public
endpoint success without a measurable route/cost effect is insufficient evidence.

## Incremental road attributes

Keep `surface`, `smoothness`, cycling infrastructure and speed zones as separate evidence
attributes; do not infer them from each other. A future additive evidence record should carry
OSM way identity, attribute value, provenance, observation/import date and graph/data version.
Unknown values remain explicit. Begin with one attribute and deterministic fixtures;
freshness and provenance should describe evidence, not certify route safety. No new database,
ingestion platform or generalized preference engine is required for this investigation.
