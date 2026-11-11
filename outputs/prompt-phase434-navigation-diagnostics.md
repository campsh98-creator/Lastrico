# Phase 4.34 — real-world navigation diagnostics and road validation: execution prompt

Date: 10 November 2026. Base: `main` at `497dbf1` (Phase 4.33 merged and on the pilot). Milan only.

## Audit: what already exists and is reused

- **GPS field trace** (`lib/gps-trace.ts`, `components/phase43/GpsTraceControls.tsx`, Phase 4.29–4.31).
  - Off by default; turned on with an explicit switch; a REC badge is shown during navigation.
  - Local storage only: up to 3 traces of 4 hours (14,400 fixes); quota failures suspend recording honestly.
  - Records each fix (time, position, accuracy, heading, speed), the decision made from it
    (progress, off-route distance, instruction, reroute), every route, and events: reroute start,
    success and failure, voice prompts, spoken pavé warnings, GPS re-arm, wake lock, signal loss.
  - JSON export through the share sheet; delete.
  - Deterministic replay: `replayGpsTrace`, `scripts/replay-gps-trace.mjs`.
  - E2E covers off-by-default, recording, export and no upload.
- **Navigation diagnostics card** (`NavigationDiagnosticsCard.tsx`): counters only, no positions.
- **Local field notes** (`LocalFieldFeedback.tsx`).
  - Kinds include unmapped pavé, pavé that is actually smooth, wrong manoeuvre and GPS drift.
  - Local, exported as JSON or CSV, never uploaded.
- **Community reports** (`/api/reports`, D1). They are moderated: stored `pending`, and only
  `verified` ones are shown. Routing never reads them.
- **Road features** (`data/features/milan-road-features.json`): OSM nodes with checksummed sources.

## Gaps and minimum changes

1. **Trace content.**
   - Each route records its objective (fast or anti-pavé), pavé exposure and rough sections.
   - The time a pavé warning is first shown, with its distance.
   - Page hidden and visible, to tell screen lock and background apart from GPS loss.
   - Field notes saved during the journey.
   - Trace format v2; v1 still replays.
2. **Retention.**
   - Traces older than 7 days are deleted.
   - All traces together may use 2.5 MB. A 4-hour trace measured 4.45 MB, and Safari allows about
     5 MB per site, shared with the rest of the app.
   - The limits are shown in the panel, with an approximate size per trace, and the HUD shows
     **REC piena** when recording stops.
3. **Export.** GPX 1.1 next to JSON: the track with time, the routes as `<rte>`, and accuracy in an
   extension.
4. **Import.** `parseGpsTrace` validates an exported file (schema, version, area, mode, shapes) before
   replay, and rejects unknown identifying fields.
5. **Diagnosis.** `lib/trace-diagnosis.ts` and `scripts/replay-gps-trace.mjs --diagnose` turn a trace
   into findings by category:
   - GPS accuracy;
   - map matching;
   - wrong-turn detection;
   - routing API;
   - instructions;
   - pavé evidence;
   - app interruption;
   - changed behaviour.
   Each finding has evidence and an Italian note on what to check. Every finding is marked
   "measured" or "possible", never "routing bug".
6. **Pavé reports.**
   - New local note kind: wrong pavé warning.
   - A note made during navigation attaches the nearest rough section on the route (start/end,
     street, OSM surface, metres) and whether a warning was shown.
   - Notes stay local, and routing is unchanged.
7. **Traffic lights and turns.** Offline audit script with checks and a ranked list of suspicious
   junctions (delegated):
   - provenance and checksums;
   - placement on carriageways;
   - duplicates;
   - sign direction;
   - classification;
   - one-way and turn restrictions;
   - unsupported conditional rules.
8. **Outbound identification.** The four `User-Agent` headers and `package.json` named the dead beta
   URL. They now name the project repository `https://github.com/campsh98-creator/Lastrico`, through
   one constant.

## Limitations

- No commits, pushes, branches, deploys or paid services. Rome and Roccella untouched.
- No automatic upload of positions. Nothing is recorded unless the switch is on.
- The diagnosis is a triage aid: it cannot know the ground truth.
- No physical iPhone test is done here.

## Acceptance criteria and tests

- Recording off by default, visible when on, local only. Export JSON/GPX and import round-trip.
- Retention enforced (count, length, age, quota).
- Replay of v1 and v2 is deterministic. The diagnosis is deterministic, and each category is
  exercised by a synthetic trace.
- With recording off, navigation does no extra work beyond null checks.
- The intersection audit is deterministic, with checksums verified and every feature traced to OSM.
- `User-Agent` is one constant, with no obsolete URL anywhere in runtime code.
- Gates:
  - `npx tsc --noEmit`, ESLint, `npm test` (build included);
  - the routing replay is unchanged;
  - E2E acceptance on the local Worker, including the iPhone viewports.

## Release conditions

Not released in this phase. A later Milan-only release needs the user's authorisation, the Phase
4.33 release procedure and a physical iPhone test.
