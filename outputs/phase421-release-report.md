# Lastrico — Phase 4.21 Release Report
**Data:** 6 Novembre 2026  
**Branch:** `fix/mobile-navigation-stability`  
**Deploy URL:** `https://lastrico-pilot.campsh.workers.dev`  
**Active Cloudflare Version ID:** `dbb73365-5c3c-4ba9-b077-0713519b75d3`  
**Rollback Target Version ID:** `1b945749-2b1d-406b-9412-39749b9f8ffd`  
**Esito Finale Quality Gate:** **GO per test su dispositivo fisico (iPhone a Milano)**

---

## 1. Sintesi Esecutiva

La Fase 4.21 ha completato il consolidamento del lavoro multi-agente, integrando in modo controllato i moduli validati, isolando rigorosamente le parti sperimentali e distribuendo la release sul pilot Cloudflare.

Tutti i requisiti operativi e di integrità di prodotto sono stati rispettati:
1. **Nessuna regressione di routing**: l'algoritmo di selezione Pareto e la conservatività sulle superfici sconosciute (`burden = candidate.riskMeters + ...`) rimangono inalterati.
2. **Onestà informativa**: le spiegazioni del compromesso di percorso (`lib/route-tradeoff.ts`) distinguono rigorosamente il pavé confermato da quello probabile e non trattano mai le superfici sconosciute come lisce.
3. **Isolamento della ricerca**: `experiments/` e il dashboard interno `tools/road-dashboard/` non sono inclusi nei bundle pubblici né serviti dalle rotte Worker.
4. **Ottimizzazione CPU Edge**: risolto il collo di bottiglia che causava Error 1102 (CPU limit) su percorsi complessi o in modalità navigazione tramite potatura immediata degli itinerari provider fuori budget, pre-reiezione bounding box nella divergenza di corridoio e rimozione delle allocazioni di stringa nei campionamenti.
5. **Verifica UI 2.0**: validazione reale tramite Chrome DevTools Protocol su 6 viewport mobile/desktop, garantendo visibilità mappa in landscape, target touch >= 44px e tipografia secondaria leggibile (>= 12px).

---

## 2. Risultati della Verifica Post-Deployment (18/18 PASS)

Test eseguiti in tempo reale direttamente su `https://lastrico-pilot.campsh.workers.dev`:

| # | Verifica | Esito | Latenza | Dettaglio |
|---|---|:---:|:---:|---|
| 1 | Homepage HTTP 200 & Security Headers | **PASS** | 634 ms | HTML pulito, no leak interni |
| 2 | Web App Manifest PWA | **PASS** | 133 ms | Manifest valido, icone e tema conformi |
| 3 | Assets & Service Worker | **PASS** | 777 ms | Bundle JS/CSS caricati, `sw.js` 200 OK |
| 4 | Isolamento Strumenti Interni & Ricerca | **PASS** | 600 ms | `/tools/`, `/experiments/`, `/dashboard` non esposti |
| 5 | Rifiuto Input Geografici Non Validi | **PASS** | 44 ms | HTTP 400 controllato senza stack trace |
| 6 | Autocomplete: Porta Romana (Milano) | **PASS** | 76 ms | Coordinate valide nell'area pilota |
| 7 | Autocomplete: Largo Promessi Sposi | **PASS** | 57 ms | Espansione Sud Milano inclusa (lat < 45.45) |
| 8 | Autocomplete: Via Marina (Roccella) | **PASS** | 48 ms | Roccella Ionica correttamente geocodificata |
| 9 | Routing Auto: Porta Romana -> Promessi Sposi | **PASS** | 4411 ms | 4.4 km, alternative analizzate, pavé isolato |
| 10 | Routing Moto: Porta Romana -> Promessi Sposi | **PASS** | 4396 ms | Profilo moto conforme, restrizioni rispettate |
| 11 | Routing Bici: Porta Romana -> Promessi Sposi | **PASS** | 4379 ms | Rete ciclabile e sensi unici validati |
| 12 | Alternativa Anti-Pavé: Castello -> Missori | **PASS** | 260 ms | Bici: risparmio netto pavé garantito |
| 13 | Alternativa Anti-Pavé: Duomo -> Centrale (Moto) | **PASS** | 390 ms | Risparmio significativo (> 1000m) confermato |
| 14 | Alternativa Anti-Pavé: Duomo -> Centrale (Bici) | **PASS** | 1345 ms | Risparmio significativo (> 1000m) confermato |
| 15 | Routing Navigazione (`navigation=1`) | **PASS** | 1251 ms | Turn-by-turn guidance completo, 0 errori 1102 |
| 16 | Routing Roccella Ionica (Auto) | **PASS** | 98 ms | Routing locale senza contaminazione Milano |
| 17 | Routing Roccella Ionica (Moto) | **PASS** | 74 ms | Routing locale istantaneo |
| 18 | Routing Roccella Ionica (Bici) | **PASS** | 90 ms | Routing locale istantaneo |

**Totale:** 18 Passed, 0 Failed.

---

## 3. Risoluzione Defect e Miglioramenti Tecnici

### A. Prevenzione Errore Edge CPU 1102 (Worker Exceeded CPU Limit)
- **Causa primaria**: Valhalla forniva alternative estreme (es. raccordi autostradali di 26 km per percorsi cittadini di 4 km). Il caricamento e lo scoring di 23 tile spaziali per itinerari che sarebbero stati comunque scartati saturavano i 50 ms di budget CPU dell'isolate.
- **Soluzione**: Pruning preliminare in `app/api/routes/route.ts` basato sui limiti fisici di `MODE_POLICY` e sul budget `maximumExtraMinutes` dell'utente.
- **Ottimizzazione geometrica**: In `lib/route-candidates.ts`, aggiunta pre-reiezione bounding box per `distanceToSegment` nei controlli di tolleranza di `divergentMeters`, riducendo del 73% il tempo di calcolo delle divergenze di corridoio (da 155 ms a 42 ms).
- **Zero allocazioni di stringa**: In `lib/road-intelligence-scoring.ts`, sostituita la formattazione di template string per il controllo layer/bridge/tunnel con un confronto diretto di proprietà `rawTags` (`verticalGradeDiffers`), e ottimizzato `nearbySegments` per riutilizzare la chiave della cella quando il raggio di campionamento risiede in una sola coordinata spaziale.

### B. Isolamento Strumenti Interni e Laboratori
- Il Road Dashboard (`tools/road-dashboard/`) è isolato nella cartella `tools/` e non viene bundleizzato nel Worker né referenziato nelle rotte Next.js/Vinext.
- Il lab di ricerca (`experiments/`) è protetto da `.gitignore` e verificato da `tests/experiments-isolation.test.mjs` (7/7 test passati).

### C. Spiegazioni del Compromesso di Percorso (`lib/route-tradeoff.ts`)
- Implementate spiegazioni trasparenti in linguaggio naturale (italiano) per le schede di confronto:
  - Pavé evitato distinto tra confermato e probabile.
  - Nessuna compensazione indebita con strade non verificate.
  - Spiegazione chiara anche quando l'alternativa è identica o priva di risparmio reale.

---

## 4. Registro dei Commit Git (`fix/mobile-navigation-stability`)

Tutti i commit sono lineari, descrittivi e sincronizzati su `origin/fix/mobile-navigation-stability`:

- `325348f`: `feat(ui): Premium UI 2.0 with targeted landscape and responsive refinements`
- `817629d`: `feat(routing): honest route trade-off explanations and surface split transparency`
- `ae32a50`: `feat(tools): isolated internal road dashboard with integrity checks`
- `ba4df0c`: `chore(research): isolate experimental labs and enforce production boundaries`
- `a7a2cc9`: `test(smoke): comprehensive post-deployment smoke verification and mobile acceptance`
- `1bd69be`: `perf(scoring): optimize spatial box caching and scale calculations for edge CPU limits`
- `924e7df`: `perf(routing): prune excessive provider alternates to prevent edge CPU limits`
- `558191a`: `perf(routing): bound alternate pruning, optimize corridor divergence and eliminate sample allocations`

Nessun merge su `main` e nessun force-push effettuato.

---

## 5. Procedura di Rollback

In caso di anomalia sul campo a Milano:
```bash
npx wrangler rollback 1b945749-2b1d-406b-9412-39749b9f8ffd --name lastrico-pilot
```
Il rollback ripristina istantaneamente la versione pilota precedente.
