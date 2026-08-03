# Release-owner prompt: Integrate, harden, publish, and verify

## Mission

Integrate the English public repository baseline, dark-mode accessibility improvement, and prompt-to-route demo into one production-quality beta release, then publish it safely to `main` and the configured production target.

## Scope

- Review agent patches, resolve conflicts, and keep one coherent product model.
- Audit routing deadlines, input validation, client state synchronisation, accessibility, privacy, caching, error recovery, bundle impact, and dead prototype code.
- Apply additional low-risk technical improvements only when they are evidence-based and covered by tests.
- Verify that `origin/main` has not moved before fast-forwarding it.

## Limitations

- No force push, history rewrite, secret exposure, fake control, unsupported coverage claim, or unverified external service dependency.
- Do not merge unrelated business-plan work into the application release.
- Preserve user changes and licensing/attribution requirements.

## Acceptance criteria

- Repository-facing content is English; current app language limitations remain honest.
- Dark-mode time metrics meet the agreed contrast criteria.
- Prompt preferences drive real route computation and remain bounded to implemented cobblestone controls.
- CI commands pass from a clean install; production build succeeds.
- Mobile navigation, reporting, route selection, prompt demo, and theme switching pass smoke tests.

## Tests and release conditions

- Run `npm ci`, `npm run lint`, the full test suite, and the production build.
- Run desktop and mobile end-to-end checks in light and dark themes.
- Deploy only after automated checks pass; then smoke-test the public URL.
- Push `main` only as a fast-forward from the verified release commit and confirm the remote commit.
