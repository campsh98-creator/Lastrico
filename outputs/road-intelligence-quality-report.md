# Lastrico — OSM pilot coverage

Dataset: osm-api-pilot-2026-10-26. Acquisition completed: 2026-10-26T00:44:43.832077+00:00.

## Denominator and limits

Milan city-centre pilot only (9.18–9.20 E, 45.455–45.475 N). Bounds: {"west":9.18,"south":45.455,"east":9.2,"north":45.475}.

Sum of linear highway-way centreline edges (area=yes polygons excluded) clipped to the pilot bounds, including unknown surface; each OSM way retained once. Separate mapped carriageways count separately; not lane-km, municipal extent, or citywide road coverage.

The four API map responses contain all highway ways returned for the requested tiles, without any surface filter. 65 area polygons are excluded from the linear network. 0 invalid ways are excluded. Geometry is clipped to the pilot bounds. This does not establish completeness of OSM against streets on the ground. **Citywide Milan coverage is not measured.** Outside the pilot, this archive supplies no Road Intelligence evidence.

## Measured composition

| Metric | Value |
| --- | --- |
| Linear highway ways | 5482 |
| Segments | 18246 |
| Total processed length | 221.272 km |
| Known Surface Classification | 68.32% |
| Explicit surface tag present (including nonspecific values) | 71.46% |
| Known smoothness tag | 9.03% |
| Cycling facility evidence | 3.16% |

| Classification | Metres | Share of pilot linear network |
| --- | --- | --- |
| confirmed_rough | 24394.7 | 11.02% |
| probable_rough | 34187.8 | 15.45% |
| confirmed_smooth | 86341.7 | 39.02% |
| unpaved_loose | 6259.5 | 2.83% |
| unknown | 70088.5 | 31.68% |

Generic surface=paved is not confirmed smooth. Unknown classification includes missing, nonspecific and unsupported surface values; absence of roughness evidence is not smoothness evidence. Surface material does not establish physical ride comfort. These lengths include mapped sidewalks, pedestrian ways, cycleways and steps as well as motor roads; access eligibility is evaluated per mode at runtime.

| Highway class | Metres | Classified surface within class |
| --- | --- | --- |
| cycleway | 3102.4 | 97.73% |
| footway | 138067.9 | 59.85% |
| living_street | 118.1 | 100.00% |
| path | 268.1 | 39.86% |
| pedestrian | 12579.1 | 86.33% |
| residential | 45242.5 | 91.75% |
| service | 10278.3 | 43.39% |
| steps | 2591.0 | 10.35% |
| tertiary | 7195.5 | 100.00% |
| unclassified | 2.9 | 100.00% |
| unknown | 1826.5 | 54.99% |

## Provenance and reproduction

Source: [OpenStreetMap API](https://api.openstreetmap.org/api/0.6/map). © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1.0/).

Original API JSON responses are archived losslessly as gzip under data/sources/. Their exact request URLs, retrieval times, SHA-256 checksums and bbox are in data/sources/milan-pilot-osm.source.json. The responses were fetched sequentially, not as an atomic historical snapshot. Element version/edit timestamps are retained in the derived way file; they are not physical observation dates. No municipal dataset is merged into these metrics.

Reproduce offline: node scripts/osm/build-representative-network.mjs, then node scripts/osm/ingest.mjs, then node scripts/osm/quality-report.mjs. To explicitly refresh from the API, run the builder with --download first. Network or checksum errors abort; there is no fabricated fallback.

Normalized dataset SHA-256: 15e3cc7893fd8f72404be88062f3c591e9ba494c51c9d21f9feafacfffc36841.
