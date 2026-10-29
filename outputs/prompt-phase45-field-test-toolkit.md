# Lastrico — Phase 4.5 Execution Prompt: Field Test Toolkit

## 1. Scope & Purpose

Make local field feedback useful, exportable, and privacy-conscious for real-world testing (on-road pilot in Milan and Roccella Ionica) before physical iPhone field evaluation:

1. **Enhanced Field Feedback Model (`FieldFeedbackItem` & `LocalFieldFeedbackProps`):**
   - **Optional GPS Location**: Location attachment is explicitly optional with a clear user toggle (enabled by default when GPS is available, with clear explanatory text about local-only storage).
   - **Route Context**: Genuinely available route context passed from `app/page.tsx`:
     - `activeRoute`: `"fast" | "safe"`
     - `routeSummary`: departure & destination labels, distance, estimated minutes
     - `predictedSurfaceCategory`: predicted surface classification at current position or route (e.g. `pave`, `smooth`, `unknown`, `unpaved`)
     - `transportMode`: `"car" | "motorcycle" | "bicycle"`
     - `pilotArea`: `"milan" | "roccella"`
   - **User-Observed Issue**: Categorized into surface (`unmapped_pave`, `false_pave_smooth`, `hazardous_surface`) and navigation (`incorrect_maneuver`, `road_closure`, `gps_drift`, `other`), plus user notes.

2. **Report Review & Management (Local In-App History):**
   - A dedicated "Storico segnalazioni" (Reports Review) tab/view within `LocalFieldFeedback` modal:
     - View all locally saved reports with timestamp, kind, category, transport mode, optional coordinates, and note.
     - Delete individual reports by ID (`deleteLocalFeedback(id)`).
     - Clear all reports (`clearLocalFeedback()`).
     - Badge showing count of saved reports.

3. **Export Formats (JSON & CSV):**
   - **JSON Export (`exportLocalFeedbackJson`)**: Full structured export of all stored items with ISO timestamps, coordinates, context, and issue classifications.
   - **CSV Export (`exportLocalFeedbackCsv`)**: Properly escaped RFC-4180 compliant CSV export with headers:
     `id,timestamp_iso,area,transport_mode,category,kind,predicted_surface,latitude,longitude,departure,destination,active_route,note`
     Neutralizes spreadsheet injection (escaping `=`, `+`, `-`, `@`).
   - Download triggers for mobile/browser: provides 1-tap browser file downloads for both `.json` and `.csv`.

4. **Privacy & Offline Integrity:**
   - 100% client-side via `localStorage`. No external network requests, no telemetry, no OSM server mutation.
   - Clear explanations: "La posizione è facoltativa e rimane esclusivamente sul dispositivo."

5. **Touch Targets & Mobile Usability:**
   - Apple HIG compliant touch targets ($\ge 44\text{px}$).
   - 16px input font size to avoid iOS auto-zoom.
   - Clean scrolling, zero overflow on iPhone viewports (390×844).

## 2. Limitations & Boundary Rules

- **Zero Backend / Cloud Database**: All feedback is strictly local in `localStorage`.
- **Zero Third-Party Tracking / Paid APIs**: Use standard Web APIs (`URL.createObjectURL`, `Blob`).
- **No Git Commit, Push, or Deploy.**
- **Preserve Existing Functionality**: All routing, Milan/Roccella datasets, and navigation logic remain unaltered.

## 3. Acceptance Criteria

- `LocalFieldFeedback` accepts optional route, predicted surface, and area context.
- Location toggle enables/disables coordinates before saving.
- Review view lists saved reports with individual delete and bulk clear.
- JSON and CSV exports produce valid data matching the schema.
- CSV sanitizes formula injection characters.
- All touch targets $\ge 44\text{px}$.
- Unit and integration tests pass 100% (`tests/phase45-field-toolkit.test.mjs`).
- Full test suite (`npm test`), TypeScript, and ESLint pass with zero errors/warnings.
- Production build succeeds.
