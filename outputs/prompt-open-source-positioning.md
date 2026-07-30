# Execution prompt — English open-source project and general Lastrico positioning

## Objective

Turn Lastrico into a clear, English-language open-source project whose identity is not tied
to Milan and can later support Rome and other municipalities.

Position the product as a multimodal road-awareness and navigation project for cars,
motorcycles, and bicycles. Its current method is to reduce exposure to known rough or uneven
road surfaces. This can support smoother journeys and better-informed decisions, but it must
never claim to guarantee safety, prevent accidents, certify a road, or replace the
traveller’s judgement.

The current beta may still describe its tested geographic coverage separately.

## Required positioning

Use this core description consistently:

> Lastrico is an open-source, multimodal navigation project that compares route alternatives
> using known road-surface conditions. It supports drivers, motorcyclists, and cyclists in
> making better-informed route choices while keeping data coverage and routing limitations
> explicit.

Use a short repository description:

> Open-source multimodal navigation using road-surface data for smoother, better-informed
> journeys.

Use this safety disclaimer consistently:

> Lastrico does not guarantee route safety, prevent accidents, or replace road signs, traffic
> rules, rider judgement, or certified navigation. Zero known rough-surface exposure does not
> mean a route is hazard-free, and unknown surface data must never be treated as asphalt.

Never use:

- “guarantees safety”;
- “prevents accidents”;
- “safe route” as a certified outcome;
- “road without cobblestones” when data is incomplete;
- a product name containing Milan;
- copy implying the product is car-only.

## Documentation scope

Make all public repository documentation and contribution material English:

- `README.md`;
- `CONTRIBUTING.md`;
- `CODE_OF_CONDUCT.md`;
- `GOVERNANCE.md`;
- `ROADMAP.md`;
- `SECURITY.md`;
- `NOTICE.md`;
- `AUTHORS.md`;
- `CITATION.cff`;
- `docs/*.md`;
- new execution prompts;
- package and repository metadata;
- GitHub repository description, website, and topics.

Historical execution prompts may be retained as records, but add an English index and mark
their language/status clearly, or translate them when they remain active instructions.

The current Italian beta interface may remain Italian unless a separate localisation task
is approved. Repository documentation must state that UI localisation and repository
language are separate.

## Open-source contribution section

The README must contain a prominent `Contributing` section that:

1. links to `CONTRIBUTING.md`;
2. lists code, routing, road-surface data, accessibility, documentation, testing, and
   localisation contribution paths;
3. links to issue templates;
4. recommends `good first issue` and `help wanted`;
5. explains the privacy and road-safety boundaries;
6. states required checks;
7. explains OSM/ODbL attribution for data contributions.

Update the existing templates without introducing duplicates:

- `.github/ISSUE_TEMPLATE/bug-report.yml`;
- `.github/ISSUE_TEMPLATE/beta-feedback.yml`;
- `.github/ISSUE_TEMPLATE/pavement-report.yml`;
- `.github/ISSUE_TEMPLATE/feature-request.yml`;
- `.github/ISSUE_TEMPLATE/config.yml`;
- `.github/pull_request_template.md`.

Templates must request reproducible evidence without asking contributors to publish home
addresses, live locations, licence plates, or identifiable travel histories.
Road-data reports must request travel mode, municipality, observation date, provenance,
licence compatibility, and non-sensitive evidence.

## Multimodal and safety requirements

- Mention cars, motorcycles, and bicycles in the README and roadmap.
- Keep provider limitations mode-specific.
- Describe rough-surface avoidance as one current routing signal, not the entire long-term
  identity.
- Explain that users remain responsible for traffic rules, road signs, weather, closures,
  vehicle suitability, and immediate conditions.
- State that Lastrico is not an emergency service or safety-certified navigation system.
- Avoid encouraging screen interaction while moving.

## General geographic identity

- Product name: `Lastrico`.
- Repository name and headings must not append Milan.
- Package name and public metadata must use the generic product name.
- Milan is the first beta coverage area, not the permanent identity.
- Document a city/region adapter model suitable for Rome and other future areas.
- Do not claim support for an area until routing, data, GPS, mobile, and production checks
  pass for it.

## GitHub metadata

Update the repository:

- description in English;
- website to the current beta URL;
- topics such as `navigation`, `maplibre`, `openstreetmap`, `pwa`, `routing`,
  `road-surface`, `bicycle`, `motorcycle`, `open-source`;
- public README links to the correct repository;
- package repository and issue URLs.

Do not rename the GitHub repository, change visibility, merge branches, or open a pull
request without explicit authorization.

## Validation

- Search public documentation for remaining Italian prose.
- Search for misleading guarantees and car-only positioning.
- Search public copy and metadata for stale `Lastrico Milano`, `/lastrico-milano`,
  `Anti-pavé`, and Milan-only product naming. The current beta hostname and historical
  prompts explicitly indexed as archived records are allowed.
- Verify every local link in Markdown.
- Verify GitHub templates are valid YAML/Markdown.
- Run lint, build, and all tests.
- Check the README on desktop and narrow width.
- Confirm the application still reports current beta coverage honestly.
- Confirm repository metadata through GitHub after updating it.

## Release conditions

- Public repository documentation is English.
- A first-time contributor can find setup, contribution types, tests, privacy rules, and PR
  expectations in under two minutes.
- Cars, motorcycles, and bicycles are represented.
- No accident-prevention or safety guarantee appears.
- Lastrico is presented as city-independent, with Milan clearly labelled as the current
  beta area.
- GitHub metadata matches the README.
- No unrelated product functionality changes.
- No secrets or personal location data are introduced.
