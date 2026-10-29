# Lastrico — OSM pilot coverage

Dataset: osm-api-pilot-2026-10-28. Acquisition completed: 2026-10-28T23:03:26.733Z.

## Denominator and limits

Milan city-centre pilot only (9.169–9.206 E, 45.45–45.48 N). Bounds: {"west":9.169,"south":45.45,"east":9.206,"north":45.48}.

Sum of linear highway-way centreline edges (area=yes polygons excluded) clipped to the pilot bounds, including unknown surface; each OSM way retained once. Separate mapped carriageways count separately; not lane-km, municipal extent, or citywide road coverage.

The four API map responses contain all highway ways returned for the requested tiles, without any surface filter. 102 area polygons are excluded from the linear network. 0 invalid ways are excluded. Geometry is clipped to the pilot bounds. This does not establish completeness of OSM against streets on the ground. **Citywide Milan coverage is not measured.** Outside the pilot, this archive supplies no Road Intelligence evidence.

## Measured composition

| Metric | Value |
| --- | --- |
| Linear highway ways | 10919 |
| Segments | 37106 |
| Total processed length | 487.136 km |
| Known Surface Classification | 74.08% |
| Explicit surface tag present (including nonspecific values) | 75.36% |
| Known smoothness tag | 11.11% |
| Cycling facility evidence | 4.15% |

| Classification | Metres | Share of pilot linear network |
| --- | --- | --- |
| confirmed_rough | 45016.8 | 9.24% |
| probable_rough | 47291.3 | 9.71% |
| confirmed_smooth | 244235.7 | 50.14% |
| unpaved_loose | 24347.0 | 5.00% |
| unknown | 126245.6 | 25.92% |

Generic surface=paved is not confirmed smooth. Unknown classification includes missing, nonspecific and unsupported surface values; absence of roughness evidence is not smoothness evidence. Surface material does not establish physical ride comfort. These lengths include mapped sidewalks, pedestrian ways, cycleways and steps as well as motor roads; access eligibility is evaluated per mode at runtime.

| Highway class | Metres | Classified surface within class |
| --- | --- | --- |
| cycleway | 13507.4 | 88.99% |
| footway | 292438.4 | 65.73% |
| living_street | 118.1 | 100.00% |
| path | 1619.5 | 85.41% |
| pedestrian | 21556.6 | 91.64% |
| residential | 93474.2 | 94.70% |
| secondary | 11902.3 | 99.74% |
| service | 23316.4 | 47.06% |
| steps | 4139.4 | 21.25% |
| tertiary | 21017.6 | 100.00% |
| unclassified | 2.9 | 100.00% |
| unknown | 4043.6 | 52.96% |

## Provenance and reproduction

Source: [OpenStreetMap API](https://api.openstreetmap.org/api/0.6/map). © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1.0/).

Original API JSON responses are archived losslessly as gzip under data/sources/. Their exact request URLs, retrieval times, SHA-256 checksums and bbox are in data/sources/milan-pilot-osm.source.json. The responses were fetched sequentially, not as an atomic historical snapshot. Element version/edit timestamps are retained in the derived way file; they are not physical observation dates. No municipal dataset is merged into these metrics.

Reproduce offline: node scripts/osm/build-representative-network.mjs, then node scripts/osm/ingest.mjs, then node scripts/osm/quality-report.mjs. To explicitly refresh from the API, run the builder with --download first. Network or checksum errors abort; there is no fabricated fallback.

Normalized dataset SHA-256: 267b01744a33146e5ec237dc1fa4df907d7427f7e121b3ba0cc3c3aaa67f5586.
