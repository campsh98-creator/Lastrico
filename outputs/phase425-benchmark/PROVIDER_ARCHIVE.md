# Archived routing-provider responses

`provider-responses.tar.gz` holds every FOSSGIS Valhalla response used by Lastrico's Milan
benchmarks from Phase 4.25 to Phase 4.31. With it, the benchmark scripts reproduce their results
exactly, offline. The public provider changes over time, so a live run would not give the same
answers. This archive cannot be regenerated.

| Item | Value |
| --- | --- |
| File | `provider-responses.tar.gz` (5.8 MB; 45 MB unpacked) |
| SHA-256 | `8b6b9ef725af6700628c6d21b086f9484f0e1c8233fe256222d28176997a2300` |
| Content | 2,280 JSON files, one per request, named by the SHA-256 of `{url, method, body}` (2,160 from Phases 4.25–4.31 plus 120 added in Phase 4.37) |
| Provider | `https://valhalla1.openstreetmap.de/route` only (FOSSGIS public instance) |
| Retrieved | 7–8 November 2026, paced at least 1.05 s apart; the 120 Phase 4.37 responses on 14 November 2026 (provider graph tileset 2026-11-14T03:50Z, a newer graph than the 7–8 November ones), paced at least 1.1 s apart |
| Licence of the data | Route geometry derived from © OpenStreetMap contributors, ODbL 1.0 |

The requests contain only the benchmark journeys of `tests/fixtures/phase425-milan-journeys.json`,
their synthetic wrong-turn reroute positions, and the public places of the Phase 4.31 field
cases. They contain no API keys, request headers or personal traces.

## Restore

```bash
cd outputs/phase425-benchmark
shasum -a 256 provider-responses.tar.gz   # must match the value above
tar -xzf provider-responses.tar.gz        # recreates responses/ (ignored by Git)
```

Then, for example:

```bash
node scripts/benchmark-milan-routing.mjs --label=replay
```

Per-run case outputs (`outputs/phase425-benchmark/<label>/`, `outputs/phase431/reroute-bench/*/cases/`)
are derived from this archive and the code. They stay out of Git, and their summaries are
versioned.

When a new benchmark run adds responses, replace the tarball, update the checksum and count above,
and commit both together.
