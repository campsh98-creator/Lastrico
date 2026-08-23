# Lastrico mobile-navigation baseline

## Scope and repository state

- Integration branch: `fix/mobile-navigation-stability`
- Starting commit: `2ccc452d67fe090a00fd96d6fb390735f4e98cf0`
- Prompt/contrast change under audit: `b72b664` (`Add bounded route prompt and improve dark contrast`)
- Parent comparison point: `0cdca5d`
- Local target: `http://localhost:3001/`

The regression candidate added the bounded route-prompt UI, prompt-derived avoidance and time-budget state, and automatic recalculation when either value changes. It did not introduce a route-result identity that binds the visible route to the exact start, destination, mode, avoidance and time budget that produced it.

## Reproduction results

The original report that the GPS CTA was visually missing was not reproduced on the current starting commit. After applying the prompt `Evita il pavé anche con massimo 8 minuti in più`, the CTA was rendered, visible, enabled and hit-testable at all required portrait viewports:

| Viewport | CTA top–bottom | CTA height | Panel bottom | Hit target |
| --- | ---: | ---: | ---: | --- |
| 375×812 | 318.6–363.6 px | 45 px | 456.1 px | `start-navigation` |
| 390×844 | 318.6–363.6 px | 45 px | 475.9 px | `start-navigation` |
| 393×852 | 324.2–369.2 px | 45 px | 480.9 px | `start-navigation` |
| 430×932 | 326.8–371.8 px | 45 px | 530.5 px | `start-navigation` |

No document-level scrolling or bottom-navigation overlap was present at 375×812. This rejects a simple “CTA hidden by prompt height” hypothesis on the current commit.

## Confirmed state defect

A real prompt A→B race is reproducible from the source state machine:

1. route request A starts;
2. the user applies prompt B;
3. the preference effect calls `calculateRoutes`, but the call returns immediately while `loadingRef.current` is true;
4. response A remains the active request and is accepted;
5. the UI now displays preference B while route geometry A remains marked live and the GPS CTA remains enabled.

The current request guard checks request ID, navigation-session ID and transport mode, but not route endpoints, avoidance or time budget. `isLiveResult` also remains true while route-defining inputs change. Therefore a visually valid CTA can start stale geometry.

## Architecture map

`app/page.tsx` currently owns planner inputs, prompt interpretation, route request orchestration, selected-route state, MapLibre lifecycle, GPS watch lifecycle, navigation progress, recalculation, voice, modal state and theme. Pure navigation policies live in `lib/navigation-state.ts`; route progress and map styling are separated into `lib/route-progress.ts` and `lib/map-route-style.ts`.

The stabilization will add one authoritative route-request/result identity and derive GPS-start readiness from that identity. GPS session lifecycle remains separate from planner routing state. Map styling stays in its existing pure helper.

## Baseline automated checks

- ESLint: passed
- Production build: passed
- Node tests: 52 passed
- Standalone TypeScript check: failed before product edits due to one timeout callback type, one MapLibre option type, and missing Cloudflare ambient types. These are baseline issues to resolve before release.

## Baseline visual artifacts

Captured locally in `/private/tmp/lastrico-mobile-baseline.9jgj8G/`:

- planner at 375×812;
- route results at 375×812;
- prompt-applied route results at 375×812, 390×844, 393×852 and 430×932.

