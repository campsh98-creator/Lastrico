# Mapillary Feasibility Pilot — Independent Verification & Audit Report

**Status:** **NO-GO** (blocked on token, zero mapped corridor coverage in local OSM snapshot, licensing review provisional)  
**Target Corridors Audited:** Piazzale Lodi / Corso Lodi, Via Carlo Vittadini / Via Giovanni Bellezza, Via Giuseppe Ripamonti, Corso di Porta Romana, Via Francesco Sforza / Via Pietro Mascagni

---

## 1. Mandatory Retraction of Previously Misattributed Image IDs

An earlier draft of this document cited five `mapillary=*` image IDs (`289695999502304`, `1727829098000501`, `1115524933470479`, `1350794389226681`, `960692972703801`) and attributed them to the five Milan road-test corridors above.

**Independent verification of `data/surfaces/milan-central.json` proved this attribution false:**
- Across the entire bundled Milan OSM extract, only **33 road segments** (`8` unique `mapillary=*` image IDs, all 5 cited IDs included) carry a `mapillary` tag.
- **All 33 tagged segments sit at Piazza Guglielmo Oberdan / Porta Venezia (`lon 9.2048–9.2058`, `lat 45.4705–45.4748`), 1.1 km to 3.0 km north-east of the five test corridors.**
- **Zero (0) road ways** in any of the five P0 test corridors carry `mapillary=*` tags in `data/surfaces/milan-central.json`.

Those five IDs and all surface/tram-rail classifications previously inferred from them are formally **retracted**.

---

## 2. Live Mapillary Graph API Audit Status (Blocked Without Token)

Per the documented Meta / Mapillary Graph API v4 specification (`https://graph.mapillary.com`), programmatic image search, capture date (`captured_at`), computed camera geometry (`computed_geometry`), compass bearing (`compass_angle`), and image thumbnails require an authenticated OAuth/Client Access Token (`MLY|...`).

- **Environment status:** No `MAPILLARY_*` / `MLY|...` credential exists in the development workspace.
- **Compliance decision:** No unauthenticated scraping, private endpoints, or guesses were attempted. Consequently, live imagery counts, capture dates, viewing angles, tram-rail visibility, and road-carriageway confidence across the five corridors are **BLOCKED / UNVERIFIED** and are intentionally not fabricated here.

| Corridor | Local OSM `mapillary=*` Ways | Live Graph API Coverage | Surface / Tram-Rail Classification |
| --- | --- | --- | --- |
| Piazzale Lodi / Corso Lodi | `0` | **Blocked** (requires `MLY\|...` token) | **Unverified from Mapillary** (rely on verified OSM `sett` / `asphalt` tags + field GPS trace) |
| Via Carlo Vittadini / Via Giovanni Bellezza | `0` | **Blocked** | **Unverified from Mapillary** (OSM: Vittadini `asphalt`, Bellezza `way 286609081` `unknown`) |
| Via Giuseppe Ripamonti | `0` | **Blocked** | **Unverified from Mapillary** |
| Corso di Porta Romana | `0` | **Blocked** | **Unverified from Mapillary** (OSM: `1618 m sett`, `62 m asphalt`) |
| Via Francesco Sforza / Via Pietro Mascagni | `0` | **Blocked** | **Unverified from Mapillary** (OSM: Sforza `833 m asphalt`, Mascagni `427 m asphalt`) |

---

## 3. Licensing & Data-Derivation Conclusions (PROVISIONAL)

Previous licensing claims are downgraded to **PROVISIONAL** pending legal sign-off against the live Meta / Mapillary Terms of Service and Graph API Documentation:

1. **Mapillary Imagery & Derived Features (`CC BY-SA 4.0` vs Meta Mapillary Terms):** While Mapillary user imagery has historically used `CC BY-SA 4.0` alongside special OSM tracing permissions for OpenStreetMap contributors editing OSM directly, programmatic extraction of road attributes from Mapillary API responses or computer-vision detections (`mapillary` detections / AI classifications) into a **separate commercial or standalone production routing database** requires explicit verification of:
   - ODbL (`OpenStreetMap`) vs `CC BY-SA 4.0` compatibility when mixing Mapillary-derived surface attributes with OSM ways without contributing edits upstream to OSM;
   - API rate limits, caching rules, and non-attribution/redistribution clauses in the current Meta Platform Terms for Mapillary Graph API v4.
2. **Production import restriction:** Derived Mapillary classifications **must NOT be imported** into `data/surfaces/` or any production routing table until: (a) a valid project `MLY|...` token runs an audited read-only sample over the 5 exact GPS corridors, (b) visual accuracy against ground truth (`asphalt` vs `sett` vs `paving_stones` vs embedded tram rails under wet/shadow conditions) is measured, and (c) legal compatibility is formally approved.

---

## 4. Comparison With Legally Reusable Alternatives

| Data Source | Current Milan Status | Cost & Access | Legal Clarity for Lastrico | Recommendation |
| --- | --- | --- | --- | --- |
| **OpenStreetMap (`osm_curated`)** | Already bundled (`milan-central.json`), high coverage on primary arteries, conservative `unknown` on gaps | Free, offline, zero runtime calls | High — standard ODbL attribution (already compliant in repo) | **Primary baseline.** Contribute verified street edits directly to OSM rather than proprietary overlays. |
| **Private Driver GPS + Field Observations** | High signal on real routes; zero license ambiguity inside private diagnostics | First-party | Full control (must stay local / redacted outside Git) | **Use for regression triage & OSM survey prioritization**, never blind auto-hardcoding. |
| **Mapillary Graph API v4** | **0 local corridor tags**; live API blocked on missing `MLY\|...` token | Free tier subject to Meta developer app & quota | **PROVISIONAL** (requires Terms + CC BY-SA/ODbL review before DB import) | **NO-GO** for production import or v0.5 integration. |
| **KartaView / Panoramax** | Not yet sampled in Milan | Open APIs; Panoramax (`Etalab / IGN / OSM France`) uses open licenses without Meta platform lock-in | Stronger open-data alignment (verify per-instance license: Etalab-2.0 / CC BY-SA) | Worth evaluating only if human survey or upstream OSM mapping requires street imagery. |

---

## 5. Final Verdict

- **Mapillary Feasibility Pilot:** **NO-GO** for automated surface derivation or production database import. Proceed only if a dedicated Meta/Mapillary developer token is provisioned for a bounded, read-only ground-truth audit **and** legal compatibility is confirmed, with verified fixes upstreamed to OpenStreetMap first.
