# Road Intelligence Dashboard — moved

The Phase 4.20 prototype that lived here is now a maintained internal tool at
[`tools/road-dashboard/`](../../tools/road-dashboard/README.md) (Phase 4.21). It is still local,
offline, developer-only and outside the public app.

Phase 4.20 evidence, kept unchanged:

- Measurements and verdict (GO as an internal tool only, NO-GO for anything user-visible):
  [`tools/road-dashboard/evidence/phase420/results.json`](../../tools/road-dashboard/evidence/phase420/results.json).
  Paths inside that file still say `experiments/road-dashboard/` because it records the Phase 4.20 run.
- Phase 4.20 screenshot:
  [`tools/road-dashboard/evidence/phase420/milan-experimental-on.png`](../../tools/road-dashboard/evidence/phase420/milan-experimental-on.png).
- Lab report: [`outputs/phase420-research-lab-report.md`](../../outputs/phase420-research-lab-report.md), section 2.

Commands now run from the repository root, for example `node tools/road-dashboard/build.mjs` and
`node --test tools/road-dashboard/test/`.
