# Milan road-surface public datasets: can any of them complement OSM `surface=*`?

Access date for every source: **2026-11-07**. Only metadata, catalogue and preview APIs were read: CKAN `package_*`/`datastore_search*`, ArcGIS REST `?f=json`/`query` with statistics or counts, HTTP HEAD for file sizes, and spec PDFs. No full dataset file (zip/shp/gpkg/csv dump) was downloaded.

## Bottom line

- **No public, legally reusable dataset records the physical material of Milan streets (asphalt vs sett/pavé/porfido) with useful coverage.**
- The official topographic databases have a `FONDO` (surface) attribute. The Comune di Milano DBT 2020 and DBT 2012, and the regional Lombardy DBGT, all use it. Its domain is binary: `01 pavimentato` / `02 non pavimentato`. The national spec's "pavimentato" covers asphalt or concrete, and setts are not separated out. In Milan DBT 2020, **every** polygon or segment is `01 pavimentato`. Example: Via Disciplini is stone-paved per a current utility notice, and its DBT value is still `01`. These datasets cannot change Lastrico's surface classification.
- The **only** open dataset with a material value is the Comune di Milano **"Avvisi di manomissione"** (ds925, CC-BY). It has a field `Pavimentazione area occupata` with values such as `Pietra` and `Conglomerato Bituminoso`. But it is a rolling feed of about 214 point records, mostly on sidewalks, self-declared by utility operators. Only 3 records currently say `Pietra`. At most it can act as a **review flag**, not a classification source.
- Cycle-path datasets (ds60 and the GIS service) have **no** surface or material attribute.
- Several Comune GIS folders that might hold pavement or road-asset data are **token-protected** (HTTP 499 "Token Required"): `AMAT`, `D_Tecnica_arredo_urbano`, `SINFI-PUGSS`, `D_Data_Driven_City_Operations`. Getting that data would need an agreement with the Comune or AMAT, not open-data reuse.
- Context, from press reports and not from a dataset: Milan is replacing pavé with asphalt in the centre in 2025–2026. Streets named include corso Magenta, via Meravigli, via Torino and via Cesare Correnti. OSM tags there may be stale. I found no official open dataset listing these works.

## Candidate datasets

### 1. Avvisi di manomissione (utility excavation notices). Comune di Milano
| Item | Finding |
|---|---|
| Publisher | Comune di Milano – Direzione Mobilità e Trasporti |
| Dataset page | https://dati.comune.milano.it/dataset/ds925_avvisi-di-manomissione |
| Data endpoints | Datastore API: `https://dati.comune.milano.it/api/3/action/datastore_search?resource_id=4ed6ff36-6d1b-469a-8f57-9b1b292089fb`. Files: CSV (72,615 B), JSON (204,373 B), GeoJSON (238,343 B), e.g. `.../resource/e3d5c87c-cb26-49e0-8102-2c90ee03598c/download/20261107-063351_avvisi_manomissione_final.geojson` |
| Licence | CKAN: "Creative Commons Attribution" (`cc-by`, no version given). The portal footer puts site content under **CC BY 4.0**. Attribution to Comune di Milano is required. |
| Update | Frequency DAILY. Metadata modified 2026-11-07. Declared coverage 2021-06-03 → 2026-11-06. In practice it is a **rolling feed**: 214 records = 1 from 2021-06, 147 from 2026-10, 66 from 2026-11. |
| Geometry / CRS | Points. Columns `LONG_X_4326`/`LAT_Y_4326` (WGS84), plus `Nome via` and civic number for the start and end of the works. |
| Surface attributes | **`Pavimentazione area occupata`** (physical material, self-declared). Current counts: Asfalto Colato 103, Conglomerato Bituminoso 94, Altro 8, Materiali Speciali (art. 80) 4, **Pietra 3**, Opera d'Arte (arredo urbano) 2. **`Tipologia area coinvolta`**: Marciapiede, Carreggiata, Marciapiede e Carreggiata, Carreggiata Zona Sosta, Carreggiata Zona Pedonale, Pista ciclabile, Parterre, Giardino pubblico, blank. Example "Pietra" records: Via DISCIPLINI (Carreggiata, 2026-11-06), Viale FILIPPETTI ANGELO (Carreggiata), Viale BLIGNY (blank area type). |
| OSM match | Possible as a point snapped to the nearest way, filtered by street name. It only describes a spot of up to about 60 m², not a whole segment. |
| Verdict | **UNCERTAIN: usable only as a review flag.** It is legally reusable and does give physical material. But it is very sparse, point-based, self-declared and mostly about sidewalks. "Pietra" does not separate slabs from setts. The feed keeps only recent records, so it would have to be harvested daily to build up history. It must not change classifications by itself. |

### 2. Database Topografico (DBT) 2020 / DBGT. Comune di Milano
| Item | Finding |
|---|---|
| Publisher | Comune di Milano – Unità SIT e Sviluppo del Gemello Digitale Urbano |
| Dataset pages | https://dati.comune.milano.it/dataset/ds2889_database-topografico-dbt-2020-shp (DWG version: ds2890) |
| Data endpoints | SHP zip: `https://gisportal.comune.milano.it/download/area_download/SIT/DBT2020/DBT_2020.zip`, **596,533,009 B (not downloaded)**. A Gauss-Boaga variant is also offered. Live REST: `https://gisportal.comune.milano.it/federated/rest/services/DBGT/Milano_2020_DBGT/MapServer` (and a FeatureServer). WMS: `.../DBGT/Milano_2020_DBGT/MapServer/WMSServer` |
| Licence | CKAN `cc-by`. The service description says "Licenza Creative Commons Attribuzione (CC-BY 4.0)". Owner: Comune di Milano. |
| Date | Aerial survey March/April 2020, scale 1:1,000. Update frequency "NEVER" / "Non pianificato". CKAN entry modified 2025-02-05. |
| Geometry / CRS | Polygons for the areas, lines for street elements. EPSG:7791 (RDN2008 / UTM 32N); the SHP is also offered in EPSG:3003. |
| Surface attributes (counted via statistics queries) | Area di circolazione veicolare (layer 39), `AC_VEI_FON`: **'01' in all 37,892 polygons**. Area di circolazione pedonale (layer 38), `ac_ped_fon`: 71,151 × '01' = "pavimentato". Area ciclabile (layer 37), `ac_cic_fon`: 2,798 × '01' = "pavimentato". Street elements (layer 1, "Label strade"), `EL_STR_FON`: **'01' in all 55,554 segments**. National spec (Catalogo dati territoriali v1.0, Apr 2010): `01 pavimentato` covers asphalt or concrete, `02 non pavimentato` is granular material. The spec allows a further material breakdown, but Milan does not use it. |
| OSM match | Good. EL_STR lines carry `NOME` and `VIA_ID` (the Comune street code). AC_VEI polygons carry `NOME`. |
| Verdict | **NOT USABLE for surface material.** The attribute is binary and set uniformly to "paved"; Via Disciplini, for example, has `01`. It could serve only as an official street-name and geometry reference. |

### 3. Database Topografico (DBT) 2012. Comune di Milano
- Page: https://dati.comune.milano.it/dataset/ds2892_database-topografico-dbt-2012-shp. SHP zip `https://gisportal.comune.milano.it/Download/area_download/SIT/DBT2012/DBT2012_ALL_SHP_E0.zip`, **590,476,659 B (not downloaded)**. CC-BY. Survey March 2012. EPSG:7791 / 3003.
- I could not inspect the attributes without downloading. The same Milan data seen through the regional service (item 5) shows only `pavimentato` / `non pavimentato`.
- **Verdict: NOT USABLE** (binary paved/unpaved, 2012).

### 4. Carta Tecnica Comunale (CTC) 2020. Comune di Milano
- https://dati.comune.milano.it/dataset/ds2891_carta-tecnica-comunale-ctc-2020. Raster JPEG + JGW, 343 sheets, EPSG:7791, CC-BY.
- **Verdict: NOT USABLE** (raster map, no attributes).

### 5. Database Geo-Topografico (DBGT). Regione Lombardia
| Item | Finding |
|---|---|
| Metadata | Geoportale Lombardia record `r_lombar:0092b7ba-c697-433b-b5f2-9f9d9b8694e3`. The INSPIRE geoportal mirror failed with an expired TLS certificate. |
| Licence | "CC-BY 4.0" under "Vincoli di fruibilità". The Geoportale legal notice requires attribution, a link to the licence, and an indication of changes. |
| Date | Last revision 15/02/2023. The regional mosaic was completed in 2020, with mixed survey years. For central Milan the records carry `md_upd_dt` = 2012-01-01. |
| Access | GeoPackage zip per comune or province (`dbgt.gpkg`) via https://www.geoportale.regione.lombardia.it/download-pacchetti. The URL needs parameters set in the viewer; Milan's file and its size were not retrieved. No WFS is listed. Public REST: `https://www.cartografia.servizirl.it/arcgis2/rest/services/BaseMap/dbtr/MapServer/106` (Area di circolazione veicolare). CRS EPSG:6707 (service in EPSG:32632). |
| Surface attributes | `ac_vei_fon` ("FONDO"): distinct values in central Milan are `pavimentato` and `non pavimentato` only. In a central envelope, 6,611 polygons are `pavimentato`. |
| Verdict | **NOT USABLE** (binary paved/unpaved, derived from Milan's 2012 DBT). |

### 6. Itinerari ciclabili. Comune di Milano (open data + GIS)
| Item | Finding |
|---|---|
| Pages and endpoints | https://dati.comune.milano.it/dataset/ds60_infogeo_piste_ciclabili_localizzazione_ : GeoJSON 2,333,971 B, SHP zip 345,830 B, CSV 853,366 B, datastore `resource_id=18b0480e-5e7d-4a7d-902f-30cc76ad4f9f`. GIS: `https://gisportal.comune.milano.it/federated/rest/services/D_Mobilita/Piste_ciclabili/MapServer/0`, and PAC snapshots `PAC/PAC_212_ciclabili` (31/12/17, 31/12/22, 31/12/23) |
| Publisher / licence | Direzione Mobilità (the data comes from AMAT). CKAN `cc-by`; the service says CC-BY 4.0. |
| Date | CKAN modified 2026-10-25. The service says "aggiornati all'ultima rilevazione del 2023". |
| Geometry | Lines, 4,411 records, with `id_via` (Comune street code) and the street name. |
| Attributes | `gerarchia`, `rete`, `tipologia` (ciclabile sede propria / segnaletica / promiscuo pedoni / promiscuo veicoli), `sede` (carreggiata, marciapiede, parterre, parco…), `marcia`, `norma`/`regolament`, `fine_lavor`, `lunghezza`. **No surface or material field.** |
| Verdict | **NOT USABLE for surface** (useful only for cycle-infrastructure attributes). |

### 7. Other Comune di Milano items checked: all NOT USABLE for material
| Dataset / service | Why |
|---|---|
| ds2829 Esposizione al calore urbano degli itinerari ciclabili (Jul 2024, CC-BY) | Heat index only |
| PAC 4.3.1 Depavimentazione (`PAC/PAC_431_Depavimentazione/MapServer/1`) | Planned de-paving polygons. Fields `tipol_pre` (marciapiede, piazza, parcheggio…) and impermeable/green area figures. No material |
| PAC 1.4.1.2 Interventi tattici / Piazze aperte | Tactical-urbanism polygons, status and furniture counts only |
| ds51 Aree pedonali e ZTL, Zone 30 service, ds1438 Aree a velocità limitata | Administrative zones only |
| ds634 Numeri civici, `Toponomastica/Centroidi_Vie`, CKAN "stradario" files | Names and codes only; useful for matching |
| `Toponomastica/Strade_TomTom_ToponomasticaViario` | TomTom 2024 graph with Comune street codes. No surface field; based on a proprietary source; no licence stated |
| Accident data (ds175–179; Lombardy portal y7qm-hfqy, ind9-tpgk) | Aggregated by month, zone or comune; no per-location pavement type. Monza publishes per-accident "Tipo pavimentazione" (e.g. "In cubetti di porfido") but Milan does not |
| CKAN keyword search (pavimentazione, lapidea, masselli, cubetti, porfido, pavé, rizzada, asfalt*, grafo, cantieri) over all 2,618 packages | No matching dataset |
| gisportal public item search (pavimentazione, asfalto, porfido, pave, lapideo, pietra, granito, manomissione) | 0 relevant public items. "Cantieri_copia_feature" returns 404 |

### 8. Other sources
| Source | Finding | Verdict |
|---|---|---|
| Geoportale del Comune di Milano (geoportale.comune.milano.it) | **Host does not resolve (DNS failure)** on 2026-11-07, including the `/sit/download-utili/` page cited by CKAN. The working GIS is gisportal.comune.milano.it (covered above). | Unreachable |
| AMAT Milano | GIS folder `AMAT` is token-protected. The OSM wiki AMAT page (last edited 2014) lists road graph, cycle paths and transit routes, with no surface data or licence stated. | NOT USABLE (not public) |
| Comune `D_Tecnica_arredo_urbano`, `SINFI-PUGSS` folders | Token-protected; contents unknown | NOT USABLE (would need an agreement) |
| INSPIRE Transport Networks | `RoadSurfaceCategoryValue` = `paved` / `unpaved` only (inspire.ec.europa.eu codelist) | NOT USABLE for material |
| Città Metropolitana di Milano | Lombardy portal "Strade Provinciali Gestite" (kpgg-tqg9, CC0) covers provincial roads, not city streets; no columns exposed. No surface dataset found. | NOT USABLE |
| IGM DBSN | Spec PDF unreachable (connection refused) | Not verified |
| Crowd4roads SmartRoadSense (dati.gov.it / Regione Marche) | Crowdsourced roughness, not material. Licence is inconsistent (CC BY 4.0 on dati.gov.it vs ODbL on the source). Last modified 2018-01-30. Download URL returns 404. | NOT USABLE |
| Precedent, not Milan: Comune di Pavia DBT | Local `AC_VEI_FON` extension with `PAVE`, `CIOTTOLI`, `LASTRONI IN PIETRA`… This shows such a breakdown is possible within the DBT model, but Milan has not done it. | n/a |

## Recommendations for Lastrico
1. Keep OSM `surface=*` as the primary source. No official open dataset can confirm or overturn a sett classification at street level.
2. Optional: poll ds925 daily and store records whose `Pavimentazione area occupata` is `Pietra` or `Materiali Speciali (art. 80)` on `Carreggiata`. Use them only as **"verify this OSM segment"** flags, never to auto-reclassify. Attribution: "Comune di Milano, CC BY 4.0".
3. Prioritise checking central streets named in the 2025–2026 pavé-removal programme (press reports: via Torino, via Cesare Correnti, corso Magenta, via Meravigli; also cited: corso di Porta Romana, corso Lodi, via De Amicis, Carrobbio, via Bramante). The OSM state there may be out of date.
4. For authoritative material data, the only route seems to be a data request to the Comune (Direzione Mobilità / arredo urbano / AMAT). The relevant GIS folders exist but are not public.
5. Licence note: CC BY 4.0 is fine for in-app use with attribution. Copying such data **into OSM** generally needs an explicit waiver from the publisher (OSMF compatibility practice). I did not re-verify that rule in this session.

## Key evidence URLs
- Milan CKAN API: https://dati.comune.milano.it/api/3/action/package_show?id=ds925_avvisi-di-manomissione
- DBGT 2020 REST: https://gisportal.comune.milano.it/federated/rest/services/DBGT/Milano_2020_DBGT/MapServer (layers 1, 37, 38, 39)
- Lombardy DBGT layer: https://www.cartografia.servizirl.it/arcgis2/rest/services/BaseMap/dbtr/MapServer/106
- Lombardy DBGT metadata: https://www.geoportale.regione.lombardia.it/web/geoportale/metadati?p_p_id=detailSheetMetadata_WAR_gptmetadataportlet&p_p_lifecycle=0&_detailSheetMetadata_WAR_gptmetadataportlet_identifier=r_lombar%3A0092b7ba-c697-433b-b5f2-9f9d9b8694e3
- Geoportale Lombardia legal notice: https://www.geoportale.regione.lombardia.it/en/note-legali
- National content spec v1.0 (AC_VEI_FON domain): https://www.sitr.regione.sicilia.it/wp-content/uploads/Documenti/Gara_CTN_2000/db_geotopografici_v1_parte_i.pdf
- INSPIRE codelist: https://inspire.ec.europa.eu/codelist/RoadSurfaceCategoryValue
- Pavia DBT domain (precedent): https://cartografia.comune.pavia.it/arcgis/rest/services/base/BaseCOL3_sql/MapServer/7
- Press on the pavé removal: https://www.open.online/2026/10/13/milano-addio-pave-davvero-storico-video/ ; https://www.ilgiorno.it/milano/cronaca/via-torino-eliminazione-pave-mtlodrre ; https://www.ilgiorno.it/milano/cronaca/pave-sala-stavolta-fa-sul-5bb38b43
