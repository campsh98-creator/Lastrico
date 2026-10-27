# Phase 3.3 — Esecuzione: Performance di Routing e Copertura Dati OSM

## 1. Ambito e preservazione
- **Stato di partenza:** lavorazione su repository corrente con tutte le modifiche Phase 1, Phase 2, Phase 3.1 e Phase 3.2 preservate (inclusi i test e il benchmark in `outputs/phase32-benchmark/`).
- **Obiettivo:** ridurre la latenza reale end-to-end del calcolo percorsi (`P50` / `P95`) e aumentare la copertura autentica dei fondi stradali OSM sul pilota di Milano, riducendo la dipendenza da Overpass a runtime senza inventare classificazioni di superficie né degradare la qualità delle rotte o il comportamento di navigazione.
- **Vincoli tassativi:**
  - Nessun commit, push o deploy.
  - Nessuna nuova dipendenza, servizio a pagamento, infrastruttura esterna o refactoring esteso.
  - Preservare selezione Pareto deterministica, penalizzazione diretta Valhalla (`linear_cost_factors`), legalità di accesso per modalità (`car`, `motorcycle`, `bicycle`), semantica conservativa dei tratti `unknown` (`zero pavé noto != fondo liscio`) e budget temporali rigidi (`maximumExtraMinutes`).

## 2. Limitazioni dichiarate
- Qualsiasi miglioramento della copertura deve provenire esclusivamente da attributi OpenStreetMap autentici (o dataset comunali verificati già presenti), mai da inferenze sintetiche su strade prive di tag `surface=*`.
- Le strade prive di tag `surface=*` in OpenStreetMap restano classificate come `unknown`.
- L'istanza pubblica FOSSGIS Valhalla resta soggetta a rate-limiting; l'ottimizzazione della latenza non deve causare errori `HTTP 429` né violare i test di coda e cancellazione.

## 3. Criteri di accettazione
1. **Baseline e diagnosi:** misurazione riproducibile di latenza (`P50`, `P95`, tempi di routing, coda, generazione candidati e scoring) e copertura (`known smooth`, `known rough`, `unknown`) prima e dopo sulle 9 combinazioni milanesi (`castello-missori`, `san-babila-cordusio`, `brera-santa-sofia` × `car`, `motorcycle`, `bicycle`).
2. **Performance di routing:**
   - Riduzione misurabile della latenza `P50`/`P95` eliminando attese ridondanti (es. dipendenza bloccante da Overpass quando i dati locali coprono già il corridoio, pruning di deviazioni waypoint inutili o ridondanti, ottimizzazione dello scoring geometrico e del filtro `relevantPave`).
   - Rispetto rigoroso dei budget `ROUTE_BUDGET_MS` (`18s`) e `NAVIGATION_ROUTE_BUDGET_MS` (`5,5s`).
3. **Copertura dati OSM e riduzione dipendenza runtime da Overpass:**
   - Verifica dell'estensione geografica e della completezza dello snapshot locale `data/surfaces/milan-central.json` e relativo manifesto crittografico SHA-256 (`data/surfaces/milan-central.manifest.json`).
   - Riduzione della dipendenza da chiamate live Overpass a runtime per i percorsi già coperti dallo snapshot locale verificato, mantenendo la possibilità di aggiornamento quando necessario o nei test che verificano il merge live.

## 4. Strategia di test e validazione
- Test unitari e di regressione mirati su performance/coda provider, selezione Pareto, copertura OSM e contratto `/api/routes`.
- Esecuzione completa di `npx tsc --noEmit --incremental false`, `npm run lint`, `npm test` (`vinext build` + suite completa `node --test tests/*.test.mjs`) e `git diff --check`.
- Benchmark riproducibile `before` vs `after` con metriche `P50`/`P95`, copertura nota/sconosciuta, esposizione al pavé e qualità dei candidati.

## 5. Condizioni di rilascio
- Validazione esclusivamente locale in workspace, senza commit, push o deploy.
- Valutazione finale **GO / NO-GO** per il test sul campo su dispositivo mobile.
