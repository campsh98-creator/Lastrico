# Development

## Requirements and local server

- Node.js 24 or later;
- npm;
- a modern browser.

```bash
npm ci
npm run dev
```

The local beta is available at `http://localhost:3000`.

## Required checks

```bash
npm run lint
npm test
```

`npm test` creates a clean build and runs the Node test suite. Before opening a pull request,
also verify a desktop viewport and the 320×568, 393×852, and 568×320 mobile viewports.
Changes to navigation, GPS, routing, or layout need behaviour-level evidence rather than a
successful compilation alone.

## Changing a feature

1. Open or link an issue with scope, out-of-scope items, acceptance criteria, and a
   validation plan.
2. Create a focused branch such as `feature/directions-sheet`.
3. For a product feature, add an execution prompt under `outputs/` before implementation.
4. Keep pure logic in `lib/` and pass explicit callbacks to components where practical.
5. Add regression tests.
6. Verify each affected mode: car, motorcycle, and bicycle.
7. Run lint, tests, desktop and mobile checks, then document results and limitations in the
   pull request.

## Database and community reports

Reports use Drizzle and the D1 binding `DB`. After changing the schema:

```bash
npm run db:generate
```

Never commit a local database, production dump, token, personal coordinate, licence plate,
or travel history. New reports remain `pending` until moderation marks them `verified`.
Unverified reports must not affect routing.

## Routing and providers

Public beta APIs have limited capacity and usage policies. Preserve timeouts, caching,
attribution, rate limits, and explicit fallback behaviour. A visual control must change the
routing parameter it claims to control.

Routing must remain mode-specific. Never hide provider failure by substituting an automobile
route for a bicycle or motorcycle request. Document degraded behaviour and remember that a
route based on known surface data is not a safety certification.

## Road-surface data

Every dataset or correction needs:

- a source and compatible licence;
- geographic scope and generation or observation date;
- an explanation of classification and confidence;
- deduplication and geometry validation;
- OpenStreetMap attribution when derived from OSM;
- tests that prevent missing data from being interpreted as a known smooth surface.

Use public road segments or municipality-level descriptions in evidence. Do not include a
person's home address or identifiable movement history.

## Regional expansion

Milan is the current beta area. Product copy may describe future expansion, but code and
documentation must not claim support for a new area before geocoding, routing,
road-surface data, GPS, report boundaries, mobile behaviour, and production smoke tests
have passed for that region.

## Pull request evidence

Describe:

- linked issue and user-visible outcome;
- affected travel modes and regions;
- automated and manual checks;
- privacy, safety, accessibility, data-provenance, provider, and moderation impact;
- known limitations and rollback considerations;
- screenshots or recordings for visual changes, with sensitive data removed.
