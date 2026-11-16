# Lastrico — Fase 4.37: generazione dei candidati anti-pavé (pacchetto P0), con la revisione della PR #16

- **Data:** 15 novembre 2026. **Base:** `main` a `3e31da9` (Fase 4.35). **Ramo:** `fix/phase437-anti-pave-candidates` ([PR #16](https://github.com/campsh98-creator/Lastrico/pull/16)).
- **Stato: implementato, rivisto e provato in locale e su Linux. NON rilasciato sul pilota.** Il rilascio richiede il via libera del proprietario (scelta predefinita del prompt `outputs/prompt-phase437-anti-pave-candidate-generation.md`).
- Solo Milano. Roma non toccata, Roccella con le regole di prima (verificato, §4).
- Tutti i numeri sul pavé sono **effetti previsti su dati OSM**, non verità a terra: meno pavé previsto non dimostra una strada migliore nella realtà.

## 1. Che cosa cambia

1. **Soglia del tratto di pietra** della ricerca anti-pavé: da 25 m fissi a `min(riduzione minima della modalità, 15 m)` (auto 15, moto 15, bici 12). Il tratto di Piazzale Lodi misura 24,99 m: prima la ricerca non partiva mai.
2. **Stop anticipato e deviazioni inutili:** un miglioramento «economico» ferma la ricerca del pianificatore solo se non resta pietra significativa; dopo un percorso penalizzato pulito non partono le tre deviazioni geometriche. I ricalcoli in navigazione restano veloci come prima.
3. **Messaggio e traccia v3:** il ricalcolo senza pavé dice «Nuovo percorso · nessun tratto significativo di pavé rilevato nei dati disponibili.» (testo indicato dal proprietario); la traccia GPS v3 registra come ogni percorso è stato generato (senza coordinate né nomi di vie).
4. **Svolte a U:** costano 60 s nel confronto tra candidati già legali, mai un'esclusione.
5. **Aggiunte dalla revisione:** (a) un percorso della ricerca penalizzata che aggiunge pietra confermata al percorso più rapido del provider (oltre la tolleranza che la selezione già usa) esce dal gruppo dei candidati e non può diventare la scheda «più rapido»; (b) tetto esplicito di richieste al provider per calcolo (7 pianificatore, 4 ricalcolo), con il conteggio in `antiPave.search.providerRequests`; (c) gli script di cattura (`benchmark-milan-routing.mjs --live`, `record-phase437-fixtures.mjs --live`) hanno ora un limite `--max-live` (predefinito 25).

## 2. Revisione della PR #16: i punti richiesti

| # | Punto | Esito |
|---|---|---|
| 1 | Il caso del benchmark senza percorso | **Non è una regressione, non è un guasto del provider.** È `arco-pace-duomo` in bicicletta: risposta 422 «Tutti i percorsi trovati attraversano tratti vietati secondo OpenStreetMap», **identica a `3e31da9`** (stesso stato, 1 richiesta al provider in entrambi). Il provider risponde (un solo percorso, 558 s, 2.477 m); il controllo locale di legalità trova 51 m con restrizione confermata per la bici vicino alla destinazione. L'errore nasce prima del nuovo codice (`route.ts`, prima della ricerca anti-pavé). Limite preesistente: se tutti i percorsi di base sono illegali non si cerca un'alternativa; è fuori da questa PR. |
| 2 | I cinque casi peggiorati | **Due casi corretti, tre accettabili** (dettaglio in §3). |
| 3 | E2E mobile completo in Linux | Eseguito su GitHub Actions (ubuntu + Chrome reale) sulla **copia di rilascio solo-Milano**: **78/81** scenari (solo mock: 71/74). I 3 falliti (layout 390×844 chiaro e scuro, planata della freccia F1) **falliscono allo stesso modo sul `3e31da9`** (§5). Lo script `e2e-mobile-chrome.mjs` fallisce anche sul `3e31da9` («timeout waiting for planner»): **non lo considero superato.** Niente WSL/Docker sul computer locale. |
| 4 | La build di rilascio solo-Milano senza Roma e con Roccella | Verificato su Linux (§4). |
| 5 | La penalità sulle svolte a U non crea percorsi illegali né deviazioni indesiderate | Verificato: §6. |
| 6 | Richieste al provider pubblico | Verificato e limitato: §7. |
| 7 | Messaggio del ricalcolo | Sostituito con il testo indicato, con test. |
| 8 | Conflitti con la Fase 4.36 | Nessun conflitto bloccante: §8. |
| 9 | Nuove esecuzioni | Benchmark, `tsc`, ESLint, build e test rieseguiti dopo le modifiche: §5. |

## 3. Il benchmark dopo la revisione (264 casi di Milano, 88 viaggi × auto/moto/bici, «strong», lunedì 9 novembre 2026 ore 12:00)

| Misura | Prima (`3e31da9`) | Dopo |
|---|---|---|
| Casi identici / cambiati / senza percorso | — | **246 / 17 / 1** (prima della revisione: 244 / 19 / 1) |
| Pietra confermata totale sui percorsi mostrati | 50.483 m | 47.402 m (−6,1 %) |
| Tempo totale dei percorsi mostrati | 3.694 min | 3.692 min |
| Richieste al provider (dall'archivio) | 817 | 870 (+0,20 per caso) |
| Massimo di richieste per calcolo | 7 | 7 |

**I cinque casi peggiorati, uno per uno:**

| Caso | Che cosa cambiava | Verdetto |
|---|---|---|
| De Angeli → San Babila, **auto** | il «più rapido» passava da 85 a 258 m di pietra confermata per 29 s in meno (−388 m di probabile) | **Corretto** dalla guardia: il «più rapido» torna quello del provider. Non compare più tra i casi cambiati. |
| De Angeli → San Babila, **moto** | il «più rapido» passava da 85 a 511 m confermati per 27 s in meno, con rischio ponderato più alto (543 contro 369) | **Corretto** dalla guardia (stesso motivo; qui anche per la metrica del motore). |
| Colonne → Porta Genova, **moto** | alternativa persa (85 m → 205 m mostrati) | **Accettabile:** l'alternativa toglieva 120 m di pietra confermata ma costava +134 s, +134 m di tratto sconosciuto e una svolta a U; vinceva di soli 20 punti di utilità senza la penalità. |
| Cadorna → Cinque Giornate, **moto** | alternativa persa (0 → 2 m mostrati, −269 s) | **Accettabile:** l'alternativa costava +269 s (+32 %) e +1,36 km, con una svolta a U, per togliere 2 m di pietra confermata. |
| San Siro → Città Studi, **bici** | +6 m confermati, +1 s | **Non è un peggioramento per la metrica del motore:** il rischio ponderato scende da 332 a 288 e il tratto sconosciuto da 660 a 459 m. Equivalente o migliore. |

Dei 17 casi cambiati, 14 mostrano meno pietra o un'alternativa nuova (per esempio Brera → Darsena in bici −730 m per +104 s; Duomo → Isola in auto −600 m per +114 s; Greco → Lambrate −63 m e −141/−170 s), 2 perdono l'alternativa per la penalità sulle svolte a U (Colonne, Cadorna) e 1 è equivalente (San Siro). Cinque casi superano +90 s sul percorso mostrato: sono alternative offerte, ciascuna toglie almeno 150 m di pietra (circa 1 s per metro, il cambio attuale), e il percorso più veloce non diventa mai più lento. Dettaglio: `outputs/phase437/benchmark-before-after.json`.

## 4. Build di rilascio solo-Milano (Linux, commit `ffcf008` e successivi)

- Copia di rilascio: 1.704 file esportati, 634 file di Roma rimossi, 7 file condivisi ripuliti senza conflitti.
- **Nessun file con «Rome» come parola** nel nome fuori da `node_modules` (restano solo falsi positivi come «Promessi» e «Chrome»); aree pilota nella copia: `["milan","roccella"]`; 23 file di Roccella.
- **`dist`:** nessun file e nessun riferimento ai dati di Roma (`rome-tiles|rome-compact|rome-osm|rome-pilot|rome-road`).
- **Test nella copia (build + tutti i test): 535 test, 526 superati, 0 falliti, 9 saltati.** Sul `3e31da9`: 512 test, 504 superati, 0 falliti, 8 saltati (CI di `main`); il test in più saltato è quello con la traccia privata, che si attiva solo con la variabile d'ambiente.
- **Prova di pubblicazione a secco:** 13.380,64 KiB (gzip 3.361,08 KiB); «Nothing was uploaded». Nulla è stato pubblicato.
- **Roccella conservata:** i test di Roccella passano nella copia e gli scenari E2E sulla build di rilascio «Roccella in auto» (E2) e «Roccella in moto» (E4), oltre a «Milano → Roccella → Milano» (A5), sono superati. Nota: nella build non esistono file con «roccella» nel nome (i dati stanno dentro gli asset), quindi la presenza è provata dai test e dagli scenari, non da un elenco di file.

## 5. Risultati esatti dei test

| Controllo | Esito |
|---|---|
| `tsc --noEmit` | 0 errori |
| ESLint (repository, sorgenti tracciati) | 0 problemi |
| CI GitHub «Lint, test and build» (Linux) sul commit con le correzioni della revisione (`4650d07`, dopo la rimozione del workflow temporaneo) | **superata:** 544 test, 535 superati, 0 falliti, 9 saltati (`main` a `3e31da9`: 512, 504, 0, 8) |
| Test nuovi/aggiornati in locale | `phase437-candidate-generation` 13/13; `phase437-trace-generation` 16/16 (compreso il test con la traccia reale); gate Fase 4.31 6/6; `phase431-navigation` 14/14 |
| Test completo su Windows | 31 fallimenti dovuti all'ambiente (percorsi, CRLF); **gli stessi 31 sul `3e31da9`** (misurato prima delle ultime modifiche); la CI su Linux non ne ha |
| Replay della traccia reale del 13 novembre | 0 differenze di decisione, 1 ricalcolo, 930 rilevazioni accettate |
| E2E (Linux, build di rilascio, Chrome reale) | suite completa 78/81, solo mock 71/74. Falliti: D1-390×844 chiaro e scuro (stesso valore 0,544 anche sul `3e31da9`) e F1 |
| Studio di ripetizione F1 (3 esecuzioni complete per lato, runner separati) | **F1 fallisce 3/3 sul `3e31da9` e 3/3 sul ramo**: scenario sensibile al carico, **non una regressione**. Sul `3e31da9` falliva a volte anche D2 (tema scuro), che sul ramo passava. L'unico fallimento causato dalla PR, E6 (versione della traccia 2 → 3), è stato corretto |
| Script `e2e-mobile-chrome.mjs` | fallisce uguale sul `3e31da9`: non è un controllo utilizzabile su Linux così com'è |

## 6. Svolte a U: sicurezza

- La penalità entra solo nell'utilità con cui si confrontano candidati **già legali**: la legalità (profilo del provider, restrizioni note, ZTL), i limiti di tempo e le regole sulla pietra non cambiano; la scheda «più rapido» non la usa.
- Test di proprietà (600 insiemi di candidati pseudo-casuali con seme fisso, anche con percorsi illegali e oltre il limite): non viene mai scelto un percorso illegale o fuori limite; la scelta cambia solo verso un percorso con **meno** svolte a U, a un costo di utilità al massimo di 60 s per svolta evitata; non si aggiunge pietra confermata oltre tolleranza. Cambia una scelta su meno di metà dei casi (verificato).
- Nel benchmark nessun percorso scelto è diventato più lento: le uniche due variazioni da svolte a U tolgono un'alternativa (Colonne, Cadorna).

## 7. Richieste al provider pubblico

- **Controlli già presenti, invariati:** ritmo di almeno 1,05 s tra le richieste per isolate, scadenze di 18 s (pianificatore) e 5,5 s (ricalcolo), timeout di 8 s, nessun nuovo tentativo automatico di una richiesta fallita.
- **Nuovo:** tetto di 7 richieste per un calcolo del pianificatore e 4 per un ricalcolo (base fino a 2 con il ripiego OSRM, ricerca penalizzata, raffinamento, deviazioni), con il conteggio reale in `antiPave.search.providerRequests`. Test: con un provider che risponde sempre «continua», i calcoli restano entro 7 e 4, e il conteggio coincide con le richieste reali.
- **Misura:** massimo 7 richieste per calcolo prima e dopo; media +0,20 per caso.
- **Strumenti di cattura:** i miei script dal vivo non hanno nuovi tentativi, ma una cattura può innescare richieste a cascata. Nel giro precedente ho fatto 127 richieste per il corpus contro le 82 approvate: ora `--max-live` (25 di default) lo impedisce. Totale delle richieste dal vivo di questa fase: 8 (gate) + 5 (repliche) + 127 (corpus) = 140, tutte a ritmo di almeno 1,1–1,2 s e con soli punti pubblici. L'archivio versionato è salito a 2.281 risposte (SHA-256 in `PROVIDER_ARCHIVE.md`).

## 8. Conflitti con la Fase 4.36

Nessun conflitto bloccante. Allineamenti: soglia del tratto a 15 m (raccomandazione 4.36); stop anticipato come nella variante provata G4/G5; nessuna modifica ai pesi, alla penalità sui tratti sconosciuti né ai dati; penalità di 60 s sulle svolte a U senza rifiuto; nessuna sonda «shortest».
Scarti consapevoli: (a) le deviazioni geometriche si saltano quando la ricerca penalizzata lascia **meno della riduzione minima** di pietra (20/15/12 m), non esattamente 0 m ponderati come scritto nel prompt: è la stessa regola dello stop anticipato; (b) la guardia sulla pietra confermata è una novità emersa dal benchmark (la 4.36 aveva visto la stessa classe di effetto per le deviazioni «via»). Non fatti: aggancio dei punti di passaggio agli incroci (P0-4b), marca temporale del grafo, `heading`, ranking in modalità ombra, `surface_bike`.

## 9. Rischi residui

- **E2E:** nessun controllo su telefono reale; F1 e il layout 390×844 falliscono su Linux anche prima della PR (da sistemare a parte); lo script `e2e-mobile-chrome.mjs` non gira su Linux.
- **Dati e provider:** effetti previsti su OSM, nessuna misura di comfort reale; il confronto prima/dopo mescola il grafo del provider del 7–8 novembre con quello del 14–15; il piano originale del 13 novembre non è riproducibile.
- **Casi limite:** una svolta a U utile può non essere più offerta (2 su 264); quando tutti i percorsi di base sono illegali non si cercano alternative (preesistente).
- **Processo:** la copia di rilascio non si prepara su Windows (limiti di `tar` e `git merge-file`): va preparata su Linux/macOS, come fatto qui in CI.
- **Non rilasciata:** nessun deploy, nessun merge.
