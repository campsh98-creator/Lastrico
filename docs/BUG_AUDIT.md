# Initial audit — navigation stability

Baseline date: July 30, 2026
Branch: `fix/navigation-stability-and-performance`

## Verified baseline

- Lint passed.
- Build passed.
- 24 of 24 automated tests passed.
- Build warning: some minified client chunks exceed 500 kB.
- The previous route remains visible during recalculation.
- Routing responses already have a local identifier and are discarded after their
  navigation session ends.

## Priority findings

### P0 — Recalculation state was not fully centralised

`app/page.tsx` coordinated HTTP requests, aborts, sessions, cooldowns, GPS state, messages,
and route replacement in one component. Existing guards were useful, but multiple refs and
flags made atomic transitions difficult to prove. Direct coverage for timeouts, retries,
stale responses, and single-authority recalculation was missing.

Closure condition: a pure, tested controller with monotonic IDs, session checks, cooldown,
timeout, limited retry, and explicit stale-response rejection.

### P0 — GPS readings lacked time and plausible-speed validation

Readings were filtered by coordinates, accuracy, and the beta area, but their timestamps
were not part of the decision. Old fixes or physically implausible jumps could be accepted.

Closure condition: reject stale, duplicate, or implausible readings without blocking valid
movement.

### P1 — Camera updated on every React change

Position, heading, and accuracy could each invoke a new 650 ms `easeTo` animation. Faster
fixes could overlap these transitions and cause jitter.

Closure condition: a central camera policy with bounded updates and testable transitions.

### P1 — Route style depended on the initial map lifecycle

Sources, layers, colours, and widths were created directly inside the component and repeated
between initialisation and selection.

Closure condition: central tokens and an idempotent route style with a green, high-contrast
active route.

### P1 — Surface scoring was expensive and its confidence was implicit

Every route segment was compared with all relevant known rough-surface segments. OSM
provenance was stated, but local geometries effectively had the same weight and the response
did not expose route coverage separately from match confidence.

Closure condition: a spatial index, an explicit confidence model, and candidate diagnostics
covering percentage, deviation, and known evidence.

### P2 — Main component remains concentrated

`app/page.tsx` exceeds 99 kB and contains planning, mapping, GPS, voice, reporting, and
rendering. This raises regression risk and contributes to a large client chunk.

Closure condition for this phase: extract only high-value pure logic and configuration
without rewriting the whole interface.

## Initial verification limits

- Real GPS accuracy requires outdoor, on-device testing.
- Public Valhalla, OSRM, and Overpass providers have external latency and availability.
- The beta does not use live traffic.
- Road-condition coverage depends on available OpenStreetMap evidence.

## Fixes integrated on the branch

- Monotonic request IDs, client timeout, and latest-wins checks before address or route
  mutations.
- Abort propagation from the server request to external providers and detour attempts.
- A reserved budget for the car OSRM fallback.
- GPS filtering by timestamp, duplication, and plausible speed; arrival and deviation
  sequences reset after unreliable readings.
- Camera updates bounded by time, movement, and heading change.
- Continuous segment progress using cumulative distances and pre-indexed instructions.
- Central route style tokens with an opaque green active route and high-contrast outline.
- Sampled partial surface scoring with a spatial index, candidate cache, and lower weight for
  `paving_stones`.
- Routing diagnostics extended with percentages, confidence, matched features, deviation,
  and internal timing.

## Declared residual risks

- The Valhalla queue remains shared within an instance and does not prioritise navigation
  over planning across users.
- Progress matching scans route segments once per fix. It meets the benchmark but is not yet
  a stateful spatial matcher with intersection hysteresis.
- The local dataset still lacks an OSM timestamp, generation query, and `highway` tags.
- The basemap is not available offline, although the route geometry and panel can retain the
  last in-memory route.
- The client chunk above 500 kB requires a separate code-splitting task.
