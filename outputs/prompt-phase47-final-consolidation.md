# Lastrico — Phase 4.7 Execution Prompt: Final Consolidation & Pilot Readiness

## 1. Scope & Objectives

1. **Pre-commit Integrity & Sanitation:**
   - Inspect git status, ensuring all files from Phase 3, Phase 4.1 through Phase 4.6 are intact.
   - Verify that no accidental secrets, temporary debug files, or untracked debris exist.
   - Run `git diff --check` to ensure no whitespace, conflict marker, or encoding errors.

2. **Full Validation Suite:**
   - Run TypeScript type check (`npx tsc --noEmit`).
   - Run ESLint check (`npm run lint`).
   - Run production build (`npm run build`).
   - Run full project automated test suite (`npm test` / `node --test tests/*.test.mjs`).

3. **Logically Grouped Local Commits:**
   - Commit cleanly and descriptively into logical units (e.g. core routing & datasets, isolated UX & feedback toolkit, and pilot validation suites).
   - Do NOT rewrite existing git history.
   - Zero push, zero deployment to external hosting.

4. **Release Checklist & Pilot Audit:**
   - Record final commit SHA(s).
   - Document Milan & Roccella dataset versions, manifest checksums, and tile counts.
   - Explicitly document known limitations (notably Roccella's ~77.6% unknown surface coverage).
   - Formulate deployment, rollback, iPhone PWA installation, and field testing instructions.

## 2. Boundaries & Invariants

- Strictly NO git push or remote deployment.
- Maintain 100% test pass rate across all 260 unit, integration, and headless Chrome tests.
- Preserve all existing functionality, Pareto optimization, and surface honesty.
