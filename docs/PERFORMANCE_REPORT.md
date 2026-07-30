# Navigation performance report

Date: July 30, 2026
Initial environment: macOS, local Node.js, vinext/Vite production build

## Method

Measurements are separated into:

1. reproducible local checks;
2. server timings exposed by routing responses;
3. client request, parsing/application, and map-update timings;
4. browser verification on desktop and mobile viewports;
5. prolonged simulated navigation with request and timer checks.

Public-provider timings are not guarantees. Network measurements must record the date, route,
travel mode, and sample count without logging personal addresses or coordinates.

## Baseline before fixes

| Check | Result |
| --- | ---: |
| `npm run lint` | passed, 3.76 s |
| `npm test` | passed, 3.65 s |
| Automated tests | 24/24 |
| Client references | 374 ms |
| Server references | 150 ms |
| RSC build | 416 ms |
| Client environment | 539 ms |
| SSR build | 462 ms |

The build reported client chunks above 500 kB after minification. MapLibre and the large
client coordinator explain part of this size, but it remains a limitation to monitor.

The original application baseline did not structurally separate preparation, network,
scoring, and rendering time. The fixes introduced monotonic measurements without placing
addresses or coordinates in logs.

## Measurable goals

- One confirmed deviation produces one authoritative request.
- No stale response changes the active route.
- The existing route stays visible during recalculation.
- No timer or GPS watch remains after a session ends.
- Remaining values and ETA never become negative.
- A prolonged simulation ends without continuous timer or request growth.

## Results after fixes

### Local micro-benchmark

The surface index was built once over the full 1,530-way snapshot:

| Measurement | Result |
| --- | ---: |
| Index build, 1,023 cells | 6.851 ms |
| Synthetic 50-point score, p95 over 30 iterations | 3.473 ms |
| Synthetic 200-point score, p95 over 30 iterations | 1.097 ms |
| Synthetic 500-point score, p95 over 30 iterations | 0.950 ms |

The synthetic route keeps approximately the same overall length as point density changes.
It measures geometry-density cost rather than network latency. The equivalent unindexed
baseline measured 21 ms for 50 points, 88.5 ms for 200, and 221 ms for 500.

Progress model with 5,000 points and 100 instructions:

| Measurement | Result |
| --- | ---: |
| Precomputation | 18.073 ms |
| Median update | 0.131 ms |
| p95 update | 0.231 ms |

### Browser verification

- Desktop address search, result selection, and a real route completed.
- Duomo to Porta Venezia returned five real candidates with no application console error.
- Viewports checked: 393×852, 320×568, and 568×320.
- Primary interactions remained available on compact layouts; the panel requires scrolling
  at 320×568 and in landscape.
- A roughly 73-second mobile simulation completed automatically, displayed arrival, and
  produced no browser error.

The routing sample uses public providers and is not an SLA. Real on-road GPS validation
remains necessary before claiming general navigation readiness.

### Final local checks

- lint passed;
- build passed;
- 36 automated tests passed;
- the non-blocking warning about client chunks above 500 kB remains.
