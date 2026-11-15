# Fase 4.36 — Rapporto finale di decisione

Data: 14 novembre 2026 · Base: `main` a `3e31da9` (Fase 4.35) · Stato: indagine e fattibilità, **nessuna modifica a produzione, dati OSM, Roma o pilota pubblico**.

Etichette: **VERIFICATO** (visto in un file, dataset o risposta indicati), **FORTEMENTE SUPPORTATO**, **PLAUSIBILE**, **NON VERIFICATO**.
Rapporti di dettaglio (in inglese) in questa cartella: `gps-trace-forensics.md`, `routing-forensics.md`, `osm-data-audit.md`, `external-data-audit.md`, `routing-experiments.md`, `surface-intelligence-design.md`, `smartphone-sensor-feasibility.md`. Prove compatte in `evidence/`.

## 0. Come è stata condotta l'indagine

- Sei flussi di lavoro specialistici, al massimo due agenti insieme: routing (1), dati OSM (2), dati esterni (3), esperimenti di punteggio (4), architettura dello strato di superficie (5), sensori dello smartphone (6). La traccia GPS è stata analizzata dall'agente principale.
- **Deviazione dall'ordine previsto:** l'agente 4 è partito insieme al 3 e gli agenti 5 e 6 dopo, perché l'architettura dipendeva dagli schemi verificati del 3. Gli agenti 3 e 4 sono stati interrotti una volta da un limite di utilizzo e ripresi dal lavoro salvato.
- La traccia GPS è stata letta per intero dal disco (il file allegato era troppo grande per essere mostrato intero in conversazione). Resta fuori da Git; nei rapporti ci sono solo dati aggregati, tempi relativi e coordinate arrotondate. Origine e destinazione sono oscurate.
- **Andata e ritorno sono tenuti separati.** Il file contiene solo il **ritorno**. Per l'**andata** non esiste alcuna registrazione GPS: ciò che la riguarda viene da tue osservazioni e screenshot, più repliche fatte con punti pubblici. Nessuna prova dell'andata è dedotta dal ritorno.

## A. Diagnosi esecutiva

**Che cosa è andato storto, dove, come, con quale certezza.**

1. **Ritorno (traccia GPS, VERIFICATO).** Alla partenza Lastrico ha pianificato 4,703 km via Viale Umbria e rotatoria di Piazzale Lodi (25 m di sett confermato, 285 m di fondo sconosciuto). Dopo circa 60 m hai svoltato in Via Friuli, 160 m prima della svolta prevista. Dopo 7 secondi l'app ha ricalcolato, e il nuovo percorso (4,334 km, 0 m di pavé confermato) è stato seguito quasi alla perfezione fino alla fine della registrazione (scostamento massimo 10,8 m). I due percorsi coincidono per circa 4,1 km e differiscono solo nei primi 220 m. Dal punto della svolta, la scorciatoia di Via Friuli era circa **244 m (5,3 %) più corta**, senza pavé e più veloce secondo lo stesso provider.
2. **Perché non era stata pianificata (VERIFICATO nel meccanismo; FORTEMENTE SUPPORTATO per il grafo del momento).** La scorciatoia non era tra i candidati: non era illegale, non era classificata male, non è stata scartata. Tre fatti si sommano. (a) Il provider di routing ottimizza un *costo* interno, non il tempo che dichiara; la scorciatoia costa di più pur essendo più veloce. (b) L'unico generatore di Lastrico capace di uscire dall'ottimo del provider, la ricerca anti-pavé con penalità, non è partito: scatta solo per tratti di pietra di almeno 25 m, e quello di Piazzale Lodi misura 24,99 m. Con la penalità di produzione sullo stesso tratto il provider restituisce proprio la scorciatoia. (c) Se la scorciatoia fosse stata tra i candidati, avrebbe vinto a ogni livello di preferenza. Il grafo del provider è stato ricostruito dopo il viaggio, quindi il piano originale non è riproducibile al 100 %.
3. **Piazzale Lodi, andata (dati VERIFICATI, realtà fisica NON VERIFICATA).** I "25 m" sono un solo tratto OSM della rotatoria (via 287070936, `sett`). Gli altri due tratti percorsi (111768010 e 111767966, 44,1 m) sono taggati asfalto, da rilievi dichiarati del 2019 e del 2023. Lastrico riproduce esattamente i dati OSM (0,0 m di differenza su 69 tratti): aggancio alla strada, geometria, distanze, compilazione e dati vecchi sono **esclusi** come cause. Resta una domanda dati-contro-realtà: i due tratti sono taggati male, differiscono per corsia, oppure hai generalizzato dai 25 m? Una sola foto aperta del 2016, letta visivamente dall'agente, mostra sett su tratti vicini taggati asfalto; non esiste nessuna immagine dei due tratti contestati.
4. **Corso Lodi e Via Lazzaro Papi, andata (NON VERIFICATO sul percorso reale).** In OSM il braccio nord-ovest di Corso Lodi è per il 70–74 % in sett, e Via Lazzaro Papi ha 45,5 m di sett: Lastrico li conosce. Le **rotaie invece sono invisibili al sistema**: il compilatore scarta tutto ciò che non è una strada, nessun codice di punteggio legge il flag delle rotaie incorporate, e OSM non ha tram in zona. Il DBT 2020 del Comune mostra circa 1,04 km di binari in carreggiata su Corso Lodi (71 % su tratti `sett`), ma ATM non fa passare alcun tram lì: i due dataset non concordano.
5. **Svolta a U strana (NON VERIFICATO come evento).** Lastrico non ha alcuna gestione delle svolte a U. Nell'archivio storico dei provider, il 38 % delle deviazioni generate con punti di passaggio nel corridoio ne contiene una, contro il 2,5 % delle alternative. È un meccanismo plausibile; nessuna replica ha riprodotto il tuo evento.
6. **Conclusione.** Il limite principale è una **combinazione**: (i) dati di superficie mancanti o contestati e rotaie invisibili, (ii) una logica di generazione dei candidati con soglie che falliscono sul bordo. Il **punteggio non è il collo di bottiglia**: nel ritorno il candidato migliore non è mai entrato nel confronto.

## B. Matrice delle cause radice

| # | Comportamento osservato | Prova verificata | Prova nel codice | Causa radice | Certezza | Prova mancante | Correzione proposta |
|---|---|---|---|---|---|---|---|
| 1 | Ritorno: percorso via Piazzale Lodi invece della scorciatoia di Via Friuli | Repliche live con punti pubblici; ricostruzione col gestore di produzione; piano ricostruito = 25/0/285 m | `app/api/routes/route.ts:688` (soglia 25 m), `:640-653` (stop anticipato) | Candidato assente: costo del provider ≠ tempo; ricerca anti-pavé saltata per 24,99 m < 25 m | VERIFICATO (meccanismo); FORTEMENTE SUPPORTATO (grafo del momento) | Grafo del provider al momento del viaggio | Soglia del tratto ≤ riduzione minima (tetto 15 m); stop anticipato solo se resta ~0 pietra |
| 2 | Dopo il ricalcolo: "nessuna alternativa con meno pavé" | Stato `no-pave` ricostruito | `lib/reroute-objective.ts:27-35` | Manca un ramo per `no-pave`: il messaggio è fuorviante (il percorso non ha pavé) | VERIFICATO (logica) | Testo effettivamente mostrato (non registrato) | Aggiungere il ramo `no-pave` |
| 3 | Ricalcolo 7 s dopo la svolta | Replay strumentato di `processGpsFix` | `lib/navigation-fix-processor.ts:88,554-582` | Regola dello spostamento netto ≥ 35 m (34,9 m un rilevamento prima); stato di attesa `pendingJump` per progetto | VERIFICATO | — | Nessuna (già 2 s più rapido della regola per distanza) |
| 4 | Piazzale Lodi: 25 m dichiarati, sett osservato su più tratti | Tabelle per tratto; OSM storia e Overpass 14/11 | `scripts/osm/normalize.mjs:60-66` (`surface_bike` ignorato se c'è `surface`) | Dati: solo 287070936 è `sett`; gli altri due tratti sono asfalto in OSM; 160,9 m su 252,7 hanno `surface_bike=milanese_paving` | VERIFICATO (dati); NON VERIFICATO (fisico) | Immagine o rilievo dei tratti 111768010 e 111767966 | Controllo sul campo (5 minuti) e segnale in modalità ombra |
| 5 | Corso Lodi / Via Lazzaro Papi: pietra e rotaie scomode | OSM, tessere compilate, DBT 2020, ATM | `normalize.mjs:276-288`, `road-intelligence-scoring.ts:763-765` | Pietra nota ma rotaie invisibili (nessun consumatore del flag, `smoothness` inerte) | VERIFICATO (assenza); rotaie fisiche NON VERIFICATE | Percorso reale dell'andata, orari del disagio | Strato rotaie separato da DBT, con data e fonte; mai trattato come pietra |
| 6 | Svolta a U | Archivio 3.215 viaggi; nessuna replica la riproduce | `routing-providers.ts:216,263` (testo del provider preso così com'è) | Nessun filtro né penalità; punti di passaggio geometrici | Classe di meccanismo FORTEMENTE SUPPORTATA; evento NON VERIFICATO | Piano e istruzioni dell'andata | Penalità di 60 s per svolta; punti agganciati a incroci del grafo |
| 7 | 285 m di fondo sconosciuto | 100 % tratti senza tag (Via Fra Cristoforo 259,6 m ecc.) | `unknownMeters` | Dati assenti, non dati strani né fuori dalle tessere | VERIFICATO | Fondo fisico | Verifica sul campo; resta "sconosciuto", mai liscio |
| 8 | Nessuna restrizione di svolta, rotaie, tag dei nodi | Archivio cittadino: 0 relazioni | `expand-milan-citywide.mjs:177,88-110` | Estrazione che scarta relazioni, tag dei nodi e vie non-strada; versione dei nodi inventata (`version:1`) | VERIFICATO | — | Ri-estrazione con versione, timestamp, relazioni e linee tram |
| 9 | Rotatorie `junction=circular` senza senso unico implicito | 51 vie in tutta Milano | `normalize.mjs:173` | Difetto dei dati compilati (il provider le tratta come a senso unico) | VERIFICATO | — | Correggere la normalizzazione |
| 10 | Avviso di pavé solo per 25 su ≈ 69 m; tratti < 15 m mai segnalati | Confronto metri | `lib/rough-sections.ts:30-31,86-88` | Una sola via in sett; metrica leggermente diversa (+0,22 %) | VERIFICATO | — | Allineare le soglie |
| 11 | Piano non riproducibile | `/status` del provider | — | Lastrico non registra versione del grafo né lista dei candidati | VERIFICATO | — | Registrare `tileset_last_modified`, stato anti-pavé e verdetti nella traccia |

## C. Valutazione dei dati esterni

**Nessuna fonte esterna ispezionata misura o nomina il tipo di fondo delle vie di Milano.** Che cosa aggiunge davvero rispetto a OSM:

| Fonte | Aggiunge | Non aggiunge | Licenza / costo | Giudizio |
|---|---|---|---|---|
| **DBT 2020 (Comune)** | Asse tram con flag "condivide la carreggiata" (`EL_TRV_POS=02`), citywide; geometria combacia al 99,3 % con le vie OSM entro 12 m | Fondo: `FON` ha un solo valore (`01 pavimentato`) su tutti i 55.554 tratti, e la specifica non ha una classe per il porfido. **Non va mai letto come asfalto** | CC BY (versione da riconfermare), gratis | **Utile**, solo come strato rotaie con data (rilievo marzo-aprile 2020) |
| ATM (ds538) | Numeri di linea | Tipo di binario, sede, disuso; l'80 % dei metri tram nel riquadro pilota è già in OSM | CC BY, gratis | Poco: serve a incrociare il servizio |
| Immagini aperte (KartaView, Panoramax) | Prova visiva puntuale: 1 foto sulla rotatoria (2016) | Copertura: pochissime foto (rotatoria 1, Corso Lodi ramo NO 1 e 67 in un solo punto) | CC BY-SA 4.0, gratis | Canale di **verifica**, non di acquisizione automatica |
| Mapillary, Street View | Probabile copertura densa | Richiedono registrazione/chiave: non verificati. Termini su cache e addestramento non recuperabili | Street View: 10.000 gratis/mese poi 7 USD per 1.000 (da riverificare) | Non verificato |
| Ortofoto Lombardia (20 cm) | — | **Bloccate dalla licenza** (uso solo istituzionale, niente commerciale) | AGEA | Esclusa |
| Avvisi di manomissione (ds925) | Segnale di lavori | 214 punti, nessuno sui luoghi in esame | CC BY | Solo promemoria di revisione |
| Dati commerciali (HERE, TomTom, RoadBotics, Blyncsy…) | Indici di condizione | Prezzi per Milano **SCONOSCIUTI**; sett non verificato | Contratto | Nessuna raccomandazione di acquisto |

Non esiste alcun dataset comunale aperto su sensi unici, restrizioni di svolta, cantieri o manutenzione. **Avrebbero aiutato per Piazzale Lodi e Corso Lodi?** Per Corso Lodi sì, ma solo per le rotaie (DBT) e solo come segnale da verificare. Per il fondo della rotatoria nessuna fonte inspezionata avrebbe potuto dire la verità sui due tratti contestati: serve una foto o un rilievo fatto da noi.

## D. Esperimenti quantitativi (effetti **previsti** su dati OSM; non esiste verità a terra)

Modello di produzione riprodotto (264/264 risultati della Fase 4.31 identici; selezione ricostruita = quella reale in 388/388 casi); una nuova esecuzione indipendente dei risultati chiave ha dato gli stessi hash. Corpus: 298 casi (88 viaggi × 3 modi) più 35 casi di campo e 2 repliche live; divisione corridoio / sviluppo / holdout fissata prima dei risultati.

| Domanda | Risultato |
|---|---|
| Un ranking che tiene conto dell'incertezza avrebbe cambiato il ritorno? | **No**: il candidato migliore non fu mai generato. Una volta presente vince con tutti i modelli. I 285 m di sconosciuto sono identici nei due percorsi |
| … e l'andata (replica)? | **No** sui dati attuali: tutti scelgono il percorso con 50 m di pietra. Quello a 0 m (+92 s, +415 m) vince solo al livello "Massimo" o con peso ≥ 1,84 s/m (1,53× l'attuale) |
| Che cosa risolve davvero il ritorno? | Generazione dei candidati: soglia 25 → 20 o 15 m restituisce la scorciatoia con **una richiesta in più** (574 s, 0 m, −21 s). Sul corpus: 6 su 297 casi saltano la ricerca per soglia (con 20 m non ne recupera nessuno, con 15 m tutti e sei); 36 (12 %) la saltano per stop anticipato |
| Va aumentata la penalità per i tratti sconosciuti? | **No.** L'onere attuale vale 6–17 volte la frequenza stimata di pavé nei tratti senza tag (5,8 % esterno, 20,5 % centro; è una stima indiretta). Serve solo nella coda (es. −277 m di pietra per +26,4 km sconosciuti). Una penalità limitata a valore atteso va prima provata **in modalità ombra** |
| I modelli B–D (materiali, confidenza, robusto) cambiano molto? | Poco: 3–11 scelte su 298. I livelli di dati ne cambiano 28–57; l'unico con guadagno visibile è l'uso di `surface_bike=milanese_paving` (+3,7 % sul suo metro) |
| Tasso di cambio pietra/tempo attuale (1 m ≈ 1,2 s) | Sta al "ginocchio": raddoppiarlo costa +28 min per +975 m di pietra; dimezzarlo perde il 5 % della pietra evitata |
| Svolte a U | 12,4 % delle scelte ne contiene una; escluderle costa 8,1 km di pietra evitata (−12 %). Meglio una penalità di 60 s |
| Pareto | La scelta di produzione è sempre sull'insieme di Pareto (298/298), ma l'app mostra al massimo due percorsi e nel 64 % dei casi ne esiste almeno un terzo distinto |
| Regressioni | B: 7; C globale: 2; D (regret): 2; D (maximin): 5; pool unito con rifiuto delle svolte a U: 14 (+8 km di pietra). Elenco e cause nel rapporto |

**Cautele:** nessuna etichetta di verità; i pesi di B e della variante con `smoothness` sono ipotesi; le repliche non sono i piani reali; il guadagno sul corpus per lo stop anticipato poggia su 6 casi reali.

## E. Architettura tecnica proposta

| Serve… | Verdetto |
|---|---|
| Nuovi dataset | **Sì, uno solo subito**: DBT 2020 come strato rotaie separato e datato. Per il fondo nessuna fonte esterna: serve verifica sul campo |
| Migliore map matching | **No**: l'aggancio è escluso come causa (0,0 m di differenza) |
| Cambi alla generazione dei candidati | **Sì**: sono la correzione con il miglior rapporto beneficio/rischio (sezione G) |
| Cambi al punteggio | **No** ora; solo prove in modalità ombra (penalità di valore atteso limitata, penalità di 60 s per svolta a U) |
| Strato di Intelligenza di Superficie indipendente | **Sì**, in forma ibrida: registro delle prove tracciato in Git + risolutore deterministico offline + overlay statico accanto alle tessere esistenti, con hash della tessera di base (se non coincide, il sistema ricade su OSM). D1 resta coda di raccolta e verifica, **mai** nel percorso di routing. Punteggio 63/65 contro 60 (solo offline), 41 (solo tessere statiche), 32 (D1 a ogni richiesta): giudizio dell'agente, PLAUSIBILE |
| Evidenze da smartphone | **Non ora** (vedi sezione I) |

Punti chiave del progetto (47/47 test del prototipo superati, due esecuzioni identiche byte per byte): materiale, rugosità osservata, rotaie (presenza, condivisione, stato di servizio), attraversamenti, direzione, fonte, date, precisione, stato di verifica, banda di confidenza, conflitti, versione e licenza sono campi **separati**; la confidenza è una banda ordinale, mai una probabilità né fusa col peso; "sconosciuto" è un valore di prima classe; i conflitti non si risolvono col "vince il più recente" (un rilievo verificato più vecchio batte una segnalazione non verificata più recente; due osservazioni verificate discordi restano contestate). Costo modellato per Milano: circa 9.600 voci, ≈ 0,19 MB (2–3 % delle tessere di base), zero richieste aggiuntive, circa 2 MiB di memoria. Numeri sui limiti Cloudflare presi da una pagina riassunta da uno strumento (4 richieste): vanno riverificati.

## F. Analisi costi-benefici

| Categoria | Interventi | Costo |
|---|---|---|
| **Gratuiti** | Modifiche alla generazione dei candidati; ramo `no-pave` del messaggio; registro di versione/grafo nella traccia; ri-estrazione OSM con versione e relazioni; correzione `junction=circular`; join DBT offline in Node; strato di superficie in modalità ombra; controlli sul campo fatti dalla squadra; immagini aperte come canale di verifica | Tempo di sviluppo e di test |
| **Costi operativi** | Piano Workers a pagamento (da 5 USD/mese, CPU fino a 30 s di default) solo se la Fase 4.37 supera i 10 ms di CPU per richiesta: per ora il progetto stima **zero** richieste aggiuntive e overlay trascurabile, quindi non è necessario. Richieste aggiuntive al provider pubblico: +0,25 per caso in media | 5 USD/mese (condizionale) |
| **A pagamento** | Routing commerciale (Google Routes ≈ 5–10 USD per 1.000 dopo la quota gratuita; Mapbox ≈ 2 USD per 1.000 oltre 100.000/mese — cifre da fonti riassuntive, da riverificare); Valhalla ospitato (prezzi non confermati); immagini e visione artificiale commerciali; dati di condizione stradale (prezzi per Milano **SCONOSCIUTI**) | Non giustificati ora |

**Regola applicata:** non pagare per il calcolo del percorso (A) né per l'affidabilità (E) quando il difetto verificato nasce nella conoscenza del fondo (C), nella rugosità fisica (D) o in una soglia di generazione dei candidati che una correzione gratuita risolve. Un routing commerciale non avrebbe aggiunto dati di fondo.

## G. Proposta per la Fase 4.37 (in ordine di priorità)

| Pr. | Intervento | Dipendenze | Beneficio misurabile atteso | Test di accettazione | Rollback |
|---|---|---|---|---|---|
| **P0-1** | Soglia del tratto da targettizzare ≤ riduzione minima (tetto 15 m) — `route.ts:688,724` | Nessuna | La scorciatoia del ritorno viene generata (replica: 1 richiesta in più) | Fixture di 24,99 m; test del gate Fase 4.31; replica Via Friuli; richieste per caso ≤ +0,25 in media | Ripristino del valore; modifica isolata |
| **P0-2** | Stop anticipato solo se il miglioramento lascia < riduzione minima di pietra; saltare i tre punti di passaggio dopo un percorso penalizzato pulito | P0-1 | Meno richieste (−3 su 5 nella replica); percorso a 0 m non perso | Confronto sul corpus (6 casi live + archivio) | Flag |
| **P0-3** | Messaggio `no-pave`; registrare `tileset_last_modified`, stato anti-pavé, lista candidati e verdetti nella traccia | Nessuna | Riproducibilità dei prossimi casi di campo | Test della traccia v3; replay senza differenze | Revert |
| **P0-4** | Penalità di 60 s per svolta a U (mai rifiuto); punti di passaggio agganciati a incroci del grafo | Prova su corpus | Poche scelte cambiano (3 su 298), meno U-turn nei detour | Nessuna regressione > soglia; confronto A/B | Flag |
| **P1-1** | Ri-estrazione OSM con versione, timestamp, ID nodi, relazioni, vie tram; correzione `junction=circular` | Rispetto limiti API/Overpass | Provenienza per segmento; direzione corretta su 51 vie | Test di ingestione; differenza zero sulle quote esistenti | Tessere precedenti |
| **P1-2** | Join DBT → flag rotaie (separato dalla pietra) e SIL in modalità ombra con `diagnostics.sil` (solo conteggi) | P1-1; decisione del proprietario sulla licenza mista | Corso Lodi segnalato come "binari mappati nel 2020"; Via Friuli non penalizzata | **Payload byte-identici con SIL `off` e `shadow`**; test della copia di rilascio solo-Milano (Roma invariata) | Hash della tessera di base: ricade su OSM |
| **P2** | Verifiche sul campo (rotatoria 111768010 e 111767966 per prime; Corso Lodi; Via Fra Cristoforo) con foto e metro | Persone | Chiude la domanda dati-contro-realtà | Scheda di campo con foto datate | — |
| **P3** | Classifica ombra con valore atteso limitato; opzioni Pareto nell'interfaccia; prova di campo sensori | Esito P0–P2, decisioni di prodotto | — | Disaccordi in ombra che vincono nei feedback | — |

**Incertezza residua:** grafo del provider al momento del viaggio; fondo fisico dei due tratti contestati; presenza fisica delle rotaie; evento della svolta a U; che il codice in produzione coincida con `3e31da9`; guadagno sul corpus per P0-2 (6 casi).

## H. Raccomandazione esplicita

1. **Il limite principale sono dati mancanti, logica di routing o entrambi?** Entrambi, ma in ruoli diversi: la logica di generazione dei candidati ha prodotto il percorso sbagliato nel ritorno; i dati (fondo contestato, rotaie invisibili, tratti senza tag) limitano ciò che il sistema può sapere e dire sull'andata. Il punteggio non è il collo di bottiglia.
2. **Perché Piazzale Lodi e Corso Lodi hanno dato risultati insoddisfacenti?** Piazzale Lodi: i dati contano un solo tratto di rotatoria in sett (25 m) e due in asfalto; è una domanda aperta se OSM sbagli o se le condizioni fisiche varino; l'app ha riportato fedelmente i dati. Corso Lodi: la pietra è nota, ma le rotaie e il loro disagio sono invisibili, e il percorso reale dell'andata è sconosciuto.
3. **Dati comunali o di immagini avrebbero aiutato?** In parte: il DBT avrebbe segnalato le rotaie su Corso Lodi; nessuna fonte avrebbe stabilito il fondo dei due tratti contestati.
4. **Lastrico non ha generato candidati migliori?** Nel ritorno sì: la scorciatoia non è mai stata generata.
5. **Un ranking con incertezza avrebbe cambiato l'esito?** No, né nel ritorno né nella replica dell'andata.
6. **Che cosa si migliora senza pagare?** Tutto il pacchetto P0, la ri-estrazione dei dati, il join DBT, lo strato in ombra e le verifiche sul campo.
7. **Che cosa giustificherebbe il pagamento?** Una necessità dimostrata di CPU oltre i 10 ms per richiesta (piano da 5 USD/mese), oppure, dopo la validazione sul campo, la necessità di coprire superfici su larga scala che le fonti gratuite non raggiungono. Il routing commerciale non è giustificato.
8. **Che cosa evitare di costruire?** Un'app nativa per sensori, un modello di predizione del fondo dal contesto (già NO-GO in Fase 4.17), D1 a ogni richiesta di routing, l'ingestione automatica di immagini o di ortofoto, la lettura di `FON=01` del DBT come asfalto, una penalità generale sui tratti sconosciuti o sulle rotaie (colpirebbe la scorciatoia di Via Friuli, che ha 60 m di binari condivisi).
9. **Che cosa implementare per primo?** P0-1 (soglia del tratto) con la fixture di 24,99 m, poi P0-2 e P0-3.
10. **Quali prove dimostrerebbero che Lastrico migliora davvero?** Verità a terra: schede di campo con foto e misure sui tratti contestati; un esperimento di campo con sensori su superfici note; un confronto in ombra tra le scelte nuove e quelle attuali che, su viaggi reali, riduca la pietra percorsa senza allungare i tempi oltre soglia. Un calo del pavé *previsto* da solo non basta.

## I. Sensori dello smartphone

Dettaglio in `smartphone-sensor-feasibility.md`. **Nessun dato di sensori è stato raccolto in questa fase e nessun registratore è stato aggiunto all'app.**

- **Qualità di misura dimostrata: nulla** (VERIFICATO). Non esiste alcuna registrazione sul campo; tutte le cifre di accuratezza della Fase 4.20 sono sintetiche (9 sezioni su 11 di asfalto degradato scambiate per pavé). La fattibilità tecnica è FORTEMENTE SUPPORTATA, la qualità dimostrata è zero.
- **Il web legge i sensori a 60 Hz al massimo** su entrambi i motori (VERIFICATO nel codice di WebKit e Chromium): il limite di circa 11 km/h della Fase 4.20 è riprodotto (10,8 km/h per un passo di 0,10 m). La fascia di passo dei sett (0,09–0,22 m) è risolvibile all'85 % a 10 km/h, al 7 % a 20 e allo 0 % a 30. Circa il 74 % dei rilevamenti in movimento del ritorno era sopra 10,8 km/h (PLAUSIBILE). Si può misurare al più l'ampiezza della rugosità, non il materiale.
- **Il limite vincolante è l'assegnazione al tratto con l'errore GPS reale** (SIMULAZIONE, ottimistica): un tratto di 25 m è assegnato correttamente con probabilità 0,70–0,75, uno di 13,1 m con 0,53–0,57; per P ≥ 0,9 servono tratti di 65–102 m. I tre tratti della rotatoria (25,0; 31,0; 13,1 m) e i due di Via Lazzaro Papi sono più corti dell'incertezza di posizione. Il crowd-sensing **non può chiudere** il caso dei tratti contestati: lo può fare un rilievo fotografico misurato. Anche il ritardo costante di 2,2 s tra rilevamento GPS e consegna (ritardo reale o scarto di orologio, non esaminato) vale 18 m a 30 km/h e farebbe crollare la probabilità da 0,75 a 0,30.
- **L'unità statistica è il sito, non il passaggio**: con effetto ×1,9, la potenza è 17 % con 4 siti per classe, 63 % con 8, 86 % con 12; passare da 8 a 32 passaggi per sito la sposta da 63 a 65 % (SIMULAZIONE con varianza assunta).
- **Il web registra solo in primo piano**: nessuna raccolta in background possibile per costruzione (VERIFICATO nelle specifiche; Wake Lock da schermata Home solo da iOS 18.4).
- **Raccomandazione:** **NO-GO ora** per qualsiasi registratore nell'app e per qualsiasi ingresso da sensori nel routing o negli avvisi. **Prima il rilievo fisico** (foto con metro dei tratti 111768010 e 111767966, tipo ed estensione delle rotaie a Corso Lodi e Via Lazzaro Papi): chiude i casi contesi e produce prove "verificate sul campo" per lo strato di superficie. **GO condizionato solo per una Fase 1 interna alla squadra** (circa 125 ore, 3–4 weekend, nessun acquisto; 13 siti di rugosità continua + 10 di urti isolati; 10/20/30 km/h per auto e moto, 8/12/18 per bici; criteri G1–G10 fissati prima dei dati). Un'app nativa solo se i dati web falliscono e quelli a frequenza nativa passano con AUC ≥ 0,85 e il proprietario approva scopo e manutenzione.
- Decisioni per il proprietario: approvare la Fase 1 e il budget; revisione legale di consenso e conservazione (proposta di 90 giorni per i dati grezzi; regola di minimo contributori k ≥ 5); sicurezza stradale e permessi; pubblicabilità delle foto. Non verificati: testo GDPR/ePrivacy, tetto nativo dei sensori iOS, misure di batteria e temperatura.

## J. Deviazioni e limiti dichiarati

- **Ritmo delle richieste al provider pubblico:** 6 delle 21 richieste live dell'agente 4 sono partite 0,13–0,36 s dopo la precedente (limite scelto: 1,1 s); tre richieste di script diversi dell'agente 3 distavano 0,4–1,0 s. Nessuna ha ricevuto errore 429 e il ritmo è stato corretto negli script.
- **Test di baseline parziale:** manca `node_modules` (nessuna installazione eseguita), quindi i test che richiedono `react`/`typescript`/`next` non girano; il checkout Windows converte i file di testo in CRLF e un test di checksum sui dati OSM fallisce per questo. Sono artefatti dell'ambiente. Gli esperimenti sono stati eseguiti con un caricatore che usa il gestore di produzione senza modificarlo.
- **Richieste di rete (tutte registrate con orario UTC):** Overpass: 5 dell'agente 2 (3 fallite) e 2 dell'agente 1 (scadute); API OSM: 10 dell'agente 2 e 1 dell'agente 1; Valhalla pubblico: 13 dell'agente 1 e 21 dell'agente 4; circa 29 MB scaricati dall'agente 3 (limite 150 MB), con il DBT letto tramite richieste parziali senza scaricare lo zip da 596 MB; 4 richieste a Cloudflare per i limiti. Nessuna coordinata della traccia è stata inviata in rete: le repliche usano solo incroci pubblici.
- **Cache locali sensibili (ignorate da Git):** le risposte dei provider in `experiments/phase436-surface-intelligence/data/` contengono nei testi delle manovre il nome della via di partenza: non vanno pubblicate.
- Il contenuto della traccia è stato mostrato una volta nell'output di un comando e il sistema ne ha conservato una copia locale nella cartella di sessione, fuori dal repository (vedi sezione K).

## K. Registro di sicurezza (verificato il 14 novembre 2026 a fine fase)

| Controllo | Esito |
|---|---|
| `git status --short` | Solo due cartelle non tracciate: `experiments/phase436-surface-intelligence/` e `outputs/phase436-surface-intelligence/` |
| File tracciati modificati (`git diff --stat`) | Nessuno: nessun file di `lib/`, `app/`, `components/`, `worker/`, `public/`, `data/`, `deploy/`, `db/`, `drizzle/`, `tests/`, `package.json` toccato |
| Modifiche a Roma (`rome-*`) | Nessuna (né tracciate né non tracciate) |
| Deploy Cloudflare, push, PR, merge, commit | Nessuno; il pilota pubblico Milano/Roccella è invariato |
| Test di isolamento della ricerca (`tests/experiments-isolation.test.mjs`) | 6/6 superati con i nuovi file presenti |
| Dati scaricati e cache | Solo in `experiments/phase436-surface-intelligence/data/`, ignorata da Git (189 MB nella cartella degli esperimenti; 2,4 MB in `outputs/`; nessun file > 1 MB in `outputs/`) |
| Dipendenze | Nessuna installazione; Node 26 con moduli integrati |
| Privacy: traccia GPS grezza | Mai copiata nel repository; nei rapporti solo aggregati, tempi relativi e coordinate arrotondate. Scansione delle coordinate di partenza/arrivo e dei nomi delle vie di origine e destinazione: nessuna occorrenza fuori da `data/` ignorata da Git, tranne il nome di un punto di riferimento pubblico nello script `exp-run-field.mjs` (vedi nota seguente) |
| Privacy: copia locale del sistema | Un file di cronologia di sessione (317 KB, fuori dal repository) conteneva la traccia grezza perché un comando ne aveva stampato l'inizio: **eliminato**; non ne restano copie nella cartella di sessione |
| Privacy: cache degli esperimenti | Contengono nei testi delle manovre il nome della via di partenza; ignorate da Git, non pubblicare |
| Dati OSM esistenti | Non modificati |
| Rete | Nessuna coordinata della traccia inviata a servizi esterni |

Nota sullo script `experiments/phase436-surface-intelligence/scripts/exp-run-field.mjs`: contiene le coordinate di un punto di riferimento pubblico dei casi di campo della Fase 4.31, già presente in file committati del repository (`outputs/phase421-geocoding-fix-report.md` e i dati delle tessere). Non proviene dalla traccia.

**Non è stato eseguito `commit`:** tutto il lavoro è nella copia locale, non tracciato. Va deciso se committarlo; i rapporti non contengono la traccia grezza.
