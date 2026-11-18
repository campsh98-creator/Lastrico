# Road intelligence: licensing decision (18 November 2026)

Checked against the official pages on 18 November 2026. What could not be read is stated as such.

| Source | What was verified | Decision |
| --- | --- | --- |
| OpenStreetMap | ODbL 1.0 (opendatacommons.org). A Produced Work needs attribution only; a Derivative Database needs share-alike and a machine-readable copy; a Collective Database of independent datasets is not a derivative. The OSMF Community Guidelines say a combination is collective only when the datasets are independent. | OSM-derived layers may be used, with the credit "© OpenStreetMap contributors, ODbL" and a link to openstreetmap.org/copyright. They must stay separate from other sources. |
| Comune di Milano DBT | **Not verified.** The portal dati.comune.milano.it answered HTTP 403, so the declared licence (CC BY 2.5 Italia or 4.0) could not be confirmed. The OSMF Licence Compatibility page says all CC BY versions are incompatible with OSM data without an explicit waiver (IODL 2.0 is compatible). | The conflict stays **unresolved**. The DBT layer stays local and is not published, not merged into any OSM-derived file, and not used in routing. |
| ATM | **No open licence found.** atm.it has no open-data page; its copyright and terms pages allow download for personal or informational use only and say nothing about reuse. | The ATM layer stays local and is not published or used. |

## Consequences for the architecture

- Layers stay source-separated (osm, dbt, atm, association). No combined file is built for distribution.
- Nothing is activated by this decision: `LASTRICO_SIL_MODE` stays off and the layer index in Git stays empty.
- Evidence of routing value: with the shadow on, 264 of 264 Milan cases were identical (Phase 4.40), and rails are not used in ranking. There is no measured benefit that would justify the risk of publishing DBT or ATM data.
- Standard navigation outside the enriched coverage is unchanged.
- To unlock DBT or ATM: obtain the licence text from the data owner (Comune di Milano / ATM) in writing, or from the portal when reachable, and re-run this assessment. This is not an engineering task.
