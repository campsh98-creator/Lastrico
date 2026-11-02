# Lastrico — Phase 4.11 Execution Prompt: Recovery, Redesign and Hard Acceptance

## 1. Context checkpoint

Baseline on 2026-11-02: working tree clean at `333e9f5`, equal to `origin/fix/mobile-navigation-stability`. The pilot runs `63166b9`, which differs only by a documentation commit. No field traces exist yet.

Three subagents reproduced failures in real Chrome against the HEAD build. No workflow is completely broken in ideal conditions: calculation and start work. The recurring failure is in the states around them, which unit tests never exercise: the map line not drawing while tiles load, a valid route becoming unstartable, hidden default endpoints, zero-length routes, and errors nobody can see.

Why tests missed this: they assert source text and library behaviour, and never check that the line is on the map or that a person can tap Start.

## 2. Confirmed issue register

**Routing:** R1 route not drawn while tiles load (also selection highlight, demo line). R2 hidden default endpoints. R3 zero-length route accepted. R4 failed recalculation disables Start on a valid route. R5 stale route after editing. R6 raw English errors. R7 status frozen on dropped or cancelled requests. R8 client timeout includes geocoding. R9 address picker does not resume. R10 geocoder fails on full addresses, including the app's own labels. R11 errors truncated. R12 comparison panel states false things. R13 address search has no timeout or cancel. R14 failed mode switch breaks later switching. R16 copy and small state bugs.

**Navigation:** N1 same as R4, plus offline preset. N2 no lock shows a fake maneuver and hides the remedy. N3 clock skew rejects every fix. N4 selected route swapped on reroute or Ricalcola. N5 errors and duplicates erase readings, blocking reroute and arrival. N6 arrival never fires at ±35 m or parked short. N7 reroute failure invisible, retries without backoff. N8 watch never re-armed. N9 reload loses everything. N12 true relocation rejected. N13 misleading copy.

**UI:** U1 landscape navigation hides the map. U2 landscape up to 760 px hides the map. U3 Start below the fold. U4 planner hides the map. U5 hidden overflow at 351–387 px. U6 legend misleads. U7 pavé missing on the selected route. U8 errors and loading nearly invisible. U9 dark map not applied. U10 dark contrast on fills. U11 portrait HUD covers the map. U12 width-only breakpoint. U13 duplicated information. U14 test wording. U15 route fit ignores overlays. U16 overlays collide. U17 app bar. U18 keyboard and input. U19 safe areas. U20 small targets. U21 design sprawl. U22 details.

## 3. Scope

1. Fix the register, root cause first. Keep existing architecture: no rewrite of routing, processor or data.
2. Add a derived navigation phase (Idle, Planning, RouteReady, Starting, Navigating, Rerouting, Completed, Stopped, Error) on top of existing refs. `session` stays the only async guard.
3. Redesign the shell: map as base layer, sheets over it, one design system with tokens, inline SVG icons, map-first navigation.
4. Add a browser-driven acceptance suite under `tests/e2e/` that checks what a person sees: the line on the map, Start tappable, HUD state.

## 4. Limitations

- Work only in this repository and on this branch. No new branches, worktrees or repositories.
- No push, PR, merge or deploy without explicit approval. No commit unless the owner asks.
- Preserve OSM datasets and provenance; do not fabricate surface classifications; unknown stays unknown.
- Never replace a requested transport mode. Keep recording opt-in and local. Never commit traces, credentials or personal data.
- No new dependency or paid service. Simulated GPS is never reported as iPhone validation.

## 5. Acceptance criteria

- Every register item above is fixed with a regression test, or listed as deferred with a reason.
- The essential journey passes in Milan and Roccella from a fresh browser: open, city, mode, enter route, calculate, select alternative, start, simulate movement, reroute, stop, start again.
- Automated layout audit at 320×568, 375×667, 390×844, 428×926, 844×390, 667×375, 768×1024, 1280×800, in both themes: no overflow, no covered controls, targets at least 44 px, primary action visible, map at least 55% free in planning and 70% in navigation on 390×844.
- Assertions are never weakened to pass. A changed test states why.

## 6. Release conditions

`npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`, `git diff --check`, and the acceptance suite all pass on the final code. Before and after screenshots are saved under `outputs/phase411-validation/`. The final report gives GO or NO-GO for deployment and iPhone testing, and deployment waits for the owner.
