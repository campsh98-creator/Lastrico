# Execution prompt — English GitHub default branch

## Objective

Make the public GitHub repository for Lastrico consistently English on its default `main`
branch. The repository tabs, rendered README, contribution guidance, governance, security
policy, issue templates, and project metadata must no longer present the superseded
Milan-only Italian positioning.

## Scope

- Confirm which commit and branch GitHub renders as the default.
- Integrate the reviewed English documentation into `main` without dropping unrelated user
  work.
- Replace the Milan-only hero image with a city-independent Lastrico brand asset.
- Keep the current Milan beta URL and current tested coverage clearly labelled as temporary
  beta facts, not as the product identity.
- Keep historical Italian execution prompts only inside the indexed archive under
  `outputs/`; they are not current public product copy.
- Keep the current operational application interface language separate from the public
  repository language.

## Limitations

- Do not rename the repository or change visibility.
- Do not claim nationwide production coverage.
- Do not claim that Lastrico guarantees safety or prevents accidents.
- Do not rewrite or delete repository history.
- Do not publish credentials, personal location data, production data, or user histories.

## Acceptance criteria

- GitHub renders an English README from `main`.
- The `Code of conduct`, `Contributing`, `Security`, and issue-template content is English.
- The hero asset contains no Milan landmark, Milan subtitle, or Italian copy.
- The product is named `Lastrico`, while Milan is described only as the current beta area.
- Cars, motorcycles, and bicycles are represented honestly.
- All repository-local links resolve.

## Tests

- Compare the working branch with `origin/main` before integration.
- Search public documentation and metadata for stale Italian or Milan-only positioning.
- Validate issue-template YAML.
- Run `npm run lint` and `npm test`.
- Inspect the rendered GitHub README after pushing `main`.

## Release conditions

- The release uses a docs-only branch and commit created from `origin/main`; it must not
  fast-forward the current feature branch or mix routing and application changes into the
  documentation release.
- Automated checks pass.
- The working tree is clean.
- The public GitHub default branch is verified after push.
- No production application deployment is implied by the documentation release.
