# Agent prompt: English public repository and `main` release audit

## Mission

Audit the candidate release against `origin/main` and `codex/english-public-repository`. Ensure the public GitHub surface is accurate, fully English, contribution-friendly, and suitable for direct publication to `main`.

## Scope

- Inspect `README.md`, repository metadata, `.github/` templates and workflows, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, licences, and public roadmap/governance documents.
- Preserve the honest statement that the current beta UI is Italian and Milan is the tested coverage area.
- Replace stale Milan-only or “avoid cobblestones” product positioning with the broader road-safety-aware vision only where the implementation and documents support it.
- Diagnose the red GitHub status on current `main` from the available workflow and code history; make only evidence-based CI fixes.

## Limitations

- Do not translate the current in-app interface as part of this task.
- Do not claim nationwide coverage, live traffic, certified safety, AI inference, CarPlay, Android Auto, or production readiness.
- Do not push, merge, or rewrite history. The release owner owns integration.
- Preserve attribution, licensing, privacy, and beta limitations.

## Acceptance criteria

- All public repository documents and GitHub forms are written in English.
- README links, commands, repository URLs, coverage statements, and contributor paths are internally consistent.
- `npm ci`, lint, test, and build commands are represented correctly in CI and documentation.
- No committed secret, generated build directory, cache, local database, or developer-specific path is introduced.

## Tests

- Run repository readiness tests and scan public documents for unintended Italian prose.
- Validate YAML syntax and inspect the workflow against `package-lock.json` and the declared Node engine.
- Report every changed file and any residual intentional Italian string.

## Release conditions

- Do not mark ready unless the public-English audit passes and the CI configuration matches the locally verified commands.
- Hand findings and patches to the release owner; do not publish independently.
