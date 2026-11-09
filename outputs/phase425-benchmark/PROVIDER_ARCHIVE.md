# Archived routing-provider responses

`provider-responses.tar.gz` holds every FOSSGIS Valhalla response used by Lastrico's Milan
benchmarks from Phase 4.25 to Phase 4.31. With it, the benchmark scripts reproduce their results
exactly, offline. The public provider changes over time, so a live run would not give the same
answers. This archive cannot be regenerated.

| Item | Value |
| --- | --- |
| File | `provider-responses.tar.gz` (5.9 MB; 41 MB unpacked) |
| SHA-256 | `acea0e1238fd98ba72bd73a6cdab4018d87b8ca2585d182eb8ed68c7952b8356` |
| Content | 2,160 JSON files, one per request, named by the SHA-256 of `{url, method, body}` |
| Provider | `https://valhalla1.openstreetmap.de/route` only (FOSSGIS public instance) |
| Retrieved | 7–8 November 2026, paced at least 1.05 s apart |
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
