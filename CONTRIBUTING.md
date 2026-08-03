# Contributing to Lastrico

Thank you for helping improve Lastrico. Lastrico is an open-source, multimodal navigation
project for cars, motorcycles, and bicycles. Milan is the current beta coverage area, but
the project is designed to support additional municipalities and regions over time.

## Your first contribution

1. Read the [Code of Conduct](CODE_OF_CONDUCT.md) and search existing issues.
2. Choose an issue labelled
   [`good first issue`](https://github.com/campsh98-creator/Lastrico/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22)
   or [`help wanted`](https://github.com/campsh98-creator/Lastrico/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22help%20wanted%22).
3. Comment before starting. Wait for a maintainer to assign the issue so that work is not
   duplicated.
4. Confirm the issue has a clear scope, acceptance criteria, and validation plan. Ask in the
   issue if any of these are missing.
5. Fork the repository, create a focused branch, implement the change, run the required
   checks, and open a pull request linked to the issue.

Useful contribution areas include code, routing, road-surface data, accessibility,
documentation, testing, localisation, and mobile UX. A contribution does not need to add a
large feature: a reproducible bug report, a test, or a well-sourced data correction can be
valuable.

## Local setup

Requirements:

- Node.js 24 or later;
- npm;
- a modern browser.

```bash
git clone https://github.com/campsh98-creator/Lastrico.git
cd Lastrico
npm ci
npm run dev
```

The local application is available at `http://localhost:3000`.

## Code workflow

1. Use a descriptive branch such as `fix/...`, `feature/...`, `docs/...`, or `data/...`.
2. For a new product feature, first document scope, limitations, acceptance criteria, tests,
   and release conditions in an execution prompt under `outputs/`.
3. Keep pure logic in `lib/` where practical and pass explicit callbacks to UI components.
4. Keep each pull request focused on one problem. Avoid unrelated refactors and unexplained
   dependencies.
5. Add or update regression tests.
6. Run:

```bash
npm run lint
npm test
```

7. For UI changes, verify desktop plus 320×568, 393×852, and 568×320 viewports. Include
   screenshots or a short recording with sensitive information removed.
8. Explain the change, evidence, limitations, and any impact on privacy, GPS, routing,
   moderation, external services, or supported travel modes in the pull request.

See [Development](docs/development.md) for the complete workflow and
[Architecture](docs/architecture.md) before choosing a module.

## Routing, safety, and accessibility

Road-surface information is one routing signal, not a certification that a route is safe.
Never describe a route as guaranteed safe, accident-free, legal in every immediate
condition, or completely free of rough surfaces. Users remain responsible for traffic laws,
signs, closures, weather, vehicle suitability, and current road conditions.

Routing changes must:

- preserve honest, mode-specific behaviour for cars, motorcycles, and bicycles;
- never substitute a car route silently when a legal bicycle or motorcycle route is
  unavailable;
- keep provider attribution, timeout, cache, rate-limit, and fallback behaviour explicit;
- ensure every visual control changes the underlying behaviour it claims to control;
- avoid encouraging screen interaction while a user is moving;
- preserve large controls, keyboard access, readable contrast, and reduced-motion support.

## Road-surface data contributions

Use the road-surface issue template. Include the municipality or public road segment,
observation date, affected travel modes, source, compatible licence, and non-sensitive
evidence. Do not publish a home address, a person's live location, licence plate, or travel
history.

Community reports are not verified data by default. New reports remain `pending` until
moderation. They must not alter routing automatically. Data derived from OpenStreetMap must
retain OpenStreetMap attribution and comply with the ODbL. Do not submit scraped,
proprietary, or otherwise incompatible data.

## Definition of done

A change is ready for review when:

- the issue scope and acceptance criteria are satisfied;
- lint, build, and automated tests pass;
- affected travel modes and regional coverage have been checked honestly;
- relevant desktop and mobile behaviour has been verified;
- privacy, safety, accessibility, data provenance, and provider impacts are documented;
- documentation and tests are updated;
- no secret, production dump, personal location, or unrelated change is included.

Compilation alone is not sufficient evidence that a product feature is complete.

## Licence

Code contributions are distributed under the [MIT License](LICENSE). Contributors retain
applicable rights to their work while licensing the submitted contribution under those
terms. OpenStreetMap-derived data remains subject to applicable ODbL attribution and
conditions.
