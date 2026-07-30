# Governance

Lastrico is an open-source project in beta. Its initial maintainer and release owner is
[Domenico Campanella Scali](AUTHORS.md).

## Decision process

- Small, reversible corrections are discussed in their pull request.
- Changes to routing, privacy, road safety, supported travel modes, regional coverage, or
  the data model require an issue that documents alternatives, impact, and validation.
- Significant or difficult-to-reverse decisions should use a public design proposal linked
  from the issue. The resulting decision and rationale remain discoverable in the issue or
  project documentation.
- Maintainers seek consensus. When consensus is not possible, the release owner decides
  using the principles in `CONTRIBUTING.md` and explains the decision publicly.
- A feature is not released until lint, tests, build, relevant mobile verification,
  deployment, and beta smoke testing are complete.

## Roles

- **Contributor:** proposes issues, data, documentation, tests, design, or code.
- **Reviewer:** has demonstrated knowledge of an area and helps verify focused pull
  requests.
- **Maintainer:** can merge changes, manage releases, moderate reports, and enforce project
  policies.
- **Release owner:** coordinates integration and makes the final release decision.

Roles are earned through useful contributions, reliable review, and conduct consistent with
the [Code of Conduct](CODE_OF_CONDUCT.md). A contributor may ask in a public issue to take on
review responsibility after sustained work in an area. Maintainer status requires an
existing maintainer's approval and documented repository access.

Contributors are credited through Git history and pull requests and, when appropriate, in
`AUTHORS.md` or release notes.

## Regional and product scope

Lastrico's identity is not tied to one city. Milan is the current beta coverage area.
Support for another municipality or region must not be announced until routing,
road-surface data, GPS boundaries, mobile behaviour, and production checks pass for that
area. Cars, motorcycles, and bicycles must be evaluated independently.

## Licences and data

By contributing code, contributors agree that it is distributed under the MIT License.
OpenStreetMap-derived data and geometry retain applicable ODbL attribution and conditions.
Do not submit personal data, production dumps, unverifiable road claims, or material with an
incompatible licence.

## Security and conduct

Security vulnerabilities follow [SECURITY.md](SECURITY.md). Community behaviour follows the
[Code of Conduct](CODE_OF_CONDUCT.md). Private reports are handled by a maintainer without a
conflict of interest whenever practical.
