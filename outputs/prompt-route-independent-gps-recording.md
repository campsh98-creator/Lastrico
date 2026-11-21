# Execution Prompt — Route-Independent GPS Recording & Main Options UI

**Repository:** `campsh98-creator/Lastrico`  
**Branch / Base:** `feat/route-independent-gps-recording` based cleanly on `codex/gps-default-follow` (PR #37, `6847d8d`)  
**Worktree:** `.worktrees/gps-recording` (isolated from `p0-road-test-fixes`, `gps-default-follow`, `traffic-auth-recovery`, CAMPSH, and `lastrico-pilot`)

---

## 1. Objective & Scope

Enable explicit, user-controlled, device-local GPS recording that operates **independently of route calculation and active navigation**, coordinated cleanly with PR #37's default foreground GPS watcher:

- Allow starting, pausing, resuming, and stopping GPS track recording **before any route is calculated**, during free driving, or seamlessly spanning across planning → active navigation → post-navigation arrival without resetting or duplicating geolocation watchers.
- Reuse PR #37's single `ForegroundGps` lifecycle (`setRecording(active)` upgrades watch options to high accuracy `{ enableHighAccuracy: true, maximumAge: 1500, timeout: 12000 }` while recording or navigating without leaking a second `watchPosition`).
- Persist active session checkpoints locally (`lastrico-gps-active-checkpoint`), recover interrupted recordings on reload (`recording-recovered`), and keep finalized traces local in browser storage (`lastrico-gps-traces`) with **zero network transmission**.
- Detect and record interruptions honestly:
  - Background gap (`page-hidden` -> `page-visible` >= 10 s -> `background-gap`)
  - Fix interval gap (>= 15 s -> `fix-gap`)
  - Foreground GPS stall (>= 20 s without fix -> `gps-stall`)
- Support multi-`<trkseg>` GPX export/import, RFC 7946 GeoJSON (`FeatureCollection`) export/import, and offline file validation.
- Expose controls symmetrically in:
  1. **Initial journey options** (`activePanel === "plan"` preferences accordion, alongside Anti-pavé, Binari, Traffico, ZTL — `data-testid="plan-gps-recording"`),
  2. **Main Menu** (`app-menu`, `data-testid="menu-gps-recording"`), and
  3. **Top-bar HUD status pill** (`REC` / `PAUSA` / `REC sospesa` / `REC piena`) without breaking existing `phase434-diagnostics.test.mjs` invariants.

---

## 2. Explicit Platform Limitations (No Overpromising)

- **iOS Safari / Installed PWA Background Constraint:** iOS suspends web app JavaScript execution and `navigator.geolocation.watchPosition` shortly after switching apps (e.g., opening Waze) or locking the screen. Web apps have no OS-level background location entitlement. Lastrico **must not claim continuous background tracking on iPhone**: instead, it checkpoints locally, detects interruptions upon return, and clearly informs the driver in Italian UI copy.

---

## 3. Acceptance Criteria

1. Recording works with `route: null` before planning/navigation, upgrades to high-accuracy single watcher via `ForegroundGps.setRecording(true)`, ignores fixes while `paused`, and transitions smoothly when starting or ending navigation.
2. Zero duplicate `watchPosition` instances when starting recording, upgrading accuracy, pausing, resuming, navigating, or returning to foreground.
3. Checkpoint saves mid-session and `recoverInterruptedRecording` recovers interrupted traces cleanly on reload with a `recording-recovered` event.
4. `detectBackgroundGap` (>= 10 s), `detectFixGap` (>= 15 s), and `detectGpsStall` (>= 20 s) emit honest events and surface interruption warnings in UI.
5. GPX exports split `<trkseg>` across resume/interruption breaks (preserving single `<trkseg>` on uninterrupted sessions) and round-trip with `parseGpxToTrace`; GeoJSON exports valid RFC 7946 `FeatureCollection` and round-trips with `parseGeoJsonToTrace`.
6. Controls render in initial journey options (`plan-gps-recording`) and Main Menu (`menu-gps-recording`); existing `phase434-diagnostics.test.mjs` and `foreground-gps.test.mjs` remain green.
7. Zero network calls (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`) in `lib/gps-recording.ts` and `lib/gps-trace.ts`.

---

## 4. Verification & Release Conditions

- Run `tsc --noEmit`, `eslint . --ignore-pattern dist --ignore-pattern .next`, `vinext build`, and targeted/full test suites (`gps-recording.test.mjs`, `foreground-gps.test.mjs`, `rendered-html.test.mjs`, `phase437-trace-generation.test.mjs`).
- Verify `.worktrees/gps-default-follow` stays untouched at `6847d8d`.
- Commit to isolated branch `feat/route-independent-gps-recording`, push, open PR targeting `--base codex/gps-default-follow`, and obtain **GREEN** Linux CI before completion (no auto-merge or deployment).
