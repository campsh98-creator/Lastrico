# Lastrico — Report di Rilascio Fase 4.13–4.16

## 1. Riepilogo Consolidamento

Tutti i miglioramenti verificati delle Fasi 4.13, 4.14 e 4.15 sono stati integrati, consolidati e messi in sicurezza per l'esecuzione sull'infrastruttura Cloudflare Workers edge (risolvendo definitivamente il limite di CPU di 10 ms del piano Free):

1. **Copertura Stradale Autentica OSM a 117 Tile (Fase 4.13)**:
   - Estensione a 117 tile cittadine (`data/surfaces/milan-tiles/`) per l'intera area urbana di Milano, inclusi i corridoi meridionali (Porta Romana → Largo Promessi Sposi), occidentali, orientali e settentrionali.
   - Integrità SHA-256 e fedeltà semantica rigorosa: le strade senza classificazione esplicita restano contrassegnate come `unknown` (nessuna assunzione arbitraria di asfalto liscio).
   - Area pilota di Roccella Ionica con 40 tile compatte separate.

2. **Autocomplete One-Tap e Calcolo Percorso Singolo (Fase 4.14)**:
   - Selezione immediata del suggerimento di indirizzo con un solo tocco su mobile (`onPointerDown`/`onMouseDown` che previene la perdita di focus e il doppio tocco su iOS Safari/WebKit).
   - Dismissal automatico della tastiera virtuale mobile senza causare reflow o spostamenti dell'input.
   - Trigger automatico del calcolo del percorso al completamento di partenza e destinazione.

3. **Stress Test di Routing su Larga Scala (Fase 4.15)**:
   - Oltre 150 scenari di calcolo validati tra Auto, Moto e Bicicletta sia a Milano che a Roccella Ionica.
   - Robustezza verificata su casi limite geografici, geocoding e coerenza delle metriche superficiali.

4. **Hardening Prestazionale Edge per Cloudflare Workers (Fase 4.16)**:
   - **Indicizzazione pre-computata a livello di cella**: ogni tile JSON memorizza una mappa diretta cella → indici di segmenti.
   - **Idratazione on-demand sub-millisecondo (`LazySurfaceCellMap`)**: durante il calcolo e lo scoring del percorso, vengono idratate in memoria solo le ~35 celle effettivamente attraversate dal tracciato (circa 300-400 segmenti), anziché caricare e processare oltre 25.000 segmenti delle tile circostanti.
   - **Eliminazione del sovraccarico `paveIndex`**: rimossa la scansione ridondante delle superfici nei punti di detour, mantenendo l'ancoraggio diretto sui segmenti ruvidi rilevati dallo scorer.
   - Risultato prestazionale: tempo di CPU edge ridotto da >64 ms a **< 3 ms**, azzerando gli errori di risorsa `Error 1102`.

---

## 2. Stato del Repository Git

- **Branch attivo**: `fix/mobile-navigation-stability`
- **Stato del working tree**: Pulito (`working tree clean`), nessun file non tracciato o segreto presente.
- **Sincronizzazione con GitHub**: Sincronizzato con `origin/fix/mobile-navigation-stability` (nessun merge su `main`, nessuna riscrittura della cronologia, nessun force push).
- **Commit consolidati recenti**:
  - `651f02a`: `fix(routing): eliminate lazy paveIndex fallback in findDetourAnchor to protect Worker CPU limit`
  - `42270d1`: `perf(spatial-store): implement pre-indexed on-demand cell hydration to eliminate edge CPU timeout on central corridors`
  - `5fa1bb9`: `perf(routing): incrementally cover detour tiles and lazy-evaluate pave index to prevent worker CPU limit`
  - `b2470be`: `perf(spatial-store): optimize tuple hydration caches and tighten corridor padding to 50m`
  - `fb5ce64`: `feat(milan-coverage): expand authentic surface coverage to 117 citywide tiles and polish route UI`
  - `9b87cf4`: `feat(autocomplete): one-tap address selection and automatic single-shot route calculation`
  - `8b800df`: `fix(spatial-store): harden spatial surface store, scoring consistency, and geocoding edge cases`

---

## 3. Validazione Tecnica Locale

- **TypeScript (`npx tsc --noEmit --incremental false`)**:
  - 0 errori riscontrati.
- **ESLint (`npm run lint`)**:
  - 0 errori, 0 warning.
- **Test Suite Completa (`npm test` / `node --test tests/*.test.mjs`)**:
  - **326 test su 326 superati con successo** (100% pass rate, durata totale ~28 secondi).
  - Copertura integrale: scoring multi-attributo, invarianza geometrica delle tile, accessibilità WCAG AA, navigazione simulata/GPS, replay avversario, geocoding e resilienza del provider Valhalla/OSRM.

---

## 4. Deploy Controllato su Cloudflare Workers

- **Worker Target**: `lastrico-pilot` (isolato, nessun impatto su altri ambienti)
- **Database Binding**: `env.DB` collegato a `site-creator-d1`
- **URL di Produzione Pilota**: `https://lastrico-pilot.campsh.workers.dev`
- **Startup Time del Worker**: 24 ms
- **Versione Attiva Distribuita**: `1b945749-2b1d-406b-9412-39749b9f8ffd`
- **Versione Precedente per Rollback**: `34a4f413-39bd-4724-ba42-efaee7f5b448`
- **Comando per Rollback Immediato**:
  ```bash
  npx wrangler rollback 34a4f413-39bd-4724-ba42-efaee7f5b448 --name lastrico-pilot
  ```

---

## 5. Verifica Smoke Test Live HTTPS Post-Deploy

Esecuzione automatica dello smoke test completo su rete HTTPS pubblica (`node scripts/post-deploy-smoke.mjs`):

| # | Verifica | Stato | Latenza |
|---|---|---|---|
| 1 | Homepage HTTP 200 e intestazioni HTML | **PASS** | 3750 ms |
| 2 | Web App Manifest PWA | **PASS** | 167 ms |
| 3 | Autocomplete Geocoding: 'Porta Romana' (Milano) | **PASS** | 447 ms |
| 4 | Autocomplete Geocoding: 'Largo Promessi Sposi' (Espansione Sud Milano) | **PASS** | 741 ms |
| 5 | Autocomplete Geocoding: 'Via Marina' (Roccella Ionica) | **PASS** | 125 ms |
| 6 | Routing: Porta Romana → Promessi Sposi (Auto) | **PASS** | 4570 ms |
| 7 | Routing: Porta Romana → Promessi Sposi (Moto) | **PASS** | 4486 ms |
| 8 | Routing: Porta Romana → Promessi Sposi (Bicicletta) | **PASS** | 4463 ms |
| 9 | Alternativa Anti-Pavé Distinta: Castello → Missori (Bicicletta) | **PASS** | 404 ms |
| 10 | Alternativa Anti-Pavé Distinta: Duomo → Centrale (Moto) | **PASS** | 530 ms |
| 11 | Alternativa Anti-Pavé Distinta: Duomo → Centrale (Bicicletta) | **PASS** | 1377 ms |
| 12 | Richiesta Tracciamento Navigazione (`navigation=1`) | **PASS** | 1406 ms |
| 13 | Routing Roccella Ionica (Auto) | **PASS** | 175 ms |

**Esito Smoke Test**: **13 verifiche superate su 13** (0 fallite).

---

## 6. Valutazione e Condizioni di Rilascio

- **Esito Tecnico**: **GO** per la fase di test sul campo.
- **Requisito Obbligatorio Rimanente**: I test automatizzati e la verifica HTTPS in cloud sono completati con successo; tuttavia, come stabilito nelle linee guida operative (`AGENTS.md`), un rilascio pubblico definitivo richiede la prova fisica su strada con iPhone reale a Milano per validare la ricezione GPS reale e la stabilità del tracciamento in movimento.
