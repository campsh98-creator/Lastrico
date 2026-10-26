# Lastrico Road Intelligence — Data Quality & Coverage Report

**Generated:** 2026-10-26T00:15:14.010Z  
**Dataset Version:** 2026.10.26-mil-central  
**Zone:** Milan Pilot Area (Central & Inner Ring) (MIL_CENTRAL)  
**SHA-256 Checksum:** `9f349966f41e5c2eec89f29f368a1d18b36a6a2e0db1b9dec6f039616e8c6752`  

---

## 1. Executive Summary & Quality Scorecard

| Metric | Measured Value | Unit / Scale |
| :--- | :--- | :--- |
| **Total Processed Road Length** | **81.18** | km |
| **Total Segment Records** | **5,453** | directed segments |
| **Unique Source OSM Ways** | **1,545** | ways |
| **Known Surface Classification** | **80.14 km** (98.72%) | length-weighted |
| **Unknown Surface Classification** | **1.04 km** (1.28%) | length-weighted |
| **Known Smoothness Availability** | **9.20 km** (11.33%) | length-weighted |
| **Cycling Infrastructure Exposure** | **3.58 km** (4.41%) | length-weighted |
| **Embedded Tram Rails Hazard Length**| **2.61 km** | length-weighted |
| **Invalid Geometries Excluded** | **0** | ways |
| **Flagged Jumps (> 250m)** | **11** | ways (e.g. Way 4011978) |
| **Attribute Conflicts Detected** | **0** | meters |

---

## 2. Length-Weighted Coverage by Functional Road Class

| Road Class (`highway`) | Total (km) | Known Surface (km) | Rough Surface (km) | Surface Coverage (%) | Smoothness Known (%) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `residential` | 71.98 | 70.94 | 70.94 | 98.6% | 0.0% |
| `primary` | 3.65 | 3.65 | 0.00 | 100.0% | 100.0% |
| `secondary` | 2.28 | 2.28 | 0.00 | 100.0% | 100.0% |
| `tertiary` | 1.61 | 1.61 | 0.68 | 100.0% | 100.0% |
| `cycleway` | 1.15 | 1.15 | 0.00 | 100.0% | 100.0% |
| `path` | 0.33 | 0.33 | 0.00 | 100.0% | 100.0% |
| `pedestrian` | 0.18 | 0.18 | 0.00 | 100.0% | 100.0% |

---

## 3. Surface Material Distribution

| Category | Length (km) | Share (%) |
| :--- | :--- | :--- |
| **Confirmed Rough** (`sett`, `cobblestone`, `unhewn_cobblestone`) | **45.55** | 56.1% |
| **Probable Rough** (`paving_stones`) | **26.07** | 32.1% |
| **Confirmed Smooth** (`asphalt`, `concrete`) | **8.18** | 10.1% |
| **Unpaved Loose** (`compacted`, `gravel`) | **0.33** | 0.4% |
| **Unknown Surface** | **1.04** | 1.3% |

---

## 4. Source Attribution & Compliance

- **OpenStreetMap Data:** Licensed under [Open Database License 1.0 (ODbL)](https://opendatacommons.org/licenses/odbl/1.0/). Attribution: © OpenStreetMap contributors.
- **Municipal Cycling Data Adapter:** Licensed under [Creative Commons Attribuzione 4.0 Internazionale (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). Attribution: Comune di Milano.
- **Integrity Rule:** No observation timestamps are fabricated. Smoothness is strictly separated from surface material.
