# Agent prompt: Dark-mode route-time contrast

## Mission

Improve the readability of route durations, arrival times, and related metrics in dark mode so that they have a clear visual hierarchy comparable to light mode.

## Scope

- Audit route cards, the map summary, directions summary, active-navigation trip bar, metric labels, selected states, hover/focus states, and responsive layouts.
- Introduce semantic colour tokens or tightly scoped dark-theme rules where needed.
- Preserve the existing visual identity and both system/theme-toggle behaviour.

## Limitations

- Do not solve contrast by making every metric pure white.
- Do not change routing logic, copy, layout structure, or unrelated components.
- Do not hide information or rely on colour alone for selected state.
- Target WCAG AA contrast for normal text where practical; document any large-text exception.

## Acceptance criteria

- Durations remain prominent without washing out labels, units, or route names.
- Selected and unselected route cards are distinguishable in light and dark themes.
- Map and navigation overlays remain readable over the basemap.
- Focus-visible styling stays clear for keyboard users.
- Mobile widths do not overflow or truncate the primary time value.

## Tests

- Add or update a deterministic CSS/markup regression test for the semantic contrast rules.
- Run lint, unit tests, production build, and a mobile visual check in both themes.

## Release conditions

- Do not release on colour inspection alone: provide computed colour pairs or another reproducible contrast check and verify the rendered interface at desktop and mobile sizes.
