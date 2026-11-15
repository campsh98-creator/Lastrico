# Lastrico · Fase 4.40 · Integrazione runtime del Surface Intelligence Layer, in modalità ombra

- **Data:** 15 novembre 2026. **Base:** commit locale `b5ba991` (Fase 4.39b). Ramo `feat/phase440-sil-runtime-shadow`, worktree separato `…\Lastrico-phase440-sil-runtime`. Nessun push, merge o deploy, nessuna risorsa Cloudflare. PR #16, pilota pubblico, Roma, il repository originale e i worktree precedenti **non toccati**.
- **Stato:** implementata e verificata in locale. Il motore dei percorsi di Milano legge ora, **in sola lettura e dopo che la risposta è decisa**, gli strati SIL e aggiunge `diagnostics.sil`. **Spenta per impostazione predefinita.**
- **Decisione:** **GO per la revisione tecnica e la validazione controllata in modalità ombra.** **NO-GO** per qualsiasi uso in produzione, per avvisi o penalità sui binari e per la distribuzione degli strati (§12).
- Tutti i numeri sui binari sono **evidenza da dati aperti datati** (OSM senza data di rilievo, DBT marzo 2020, ATM 24 luglio 2026): non sono una verifica fisica né una misura di rugosità.

## 1. Sintesi dell'implementazione

| Pezzo | Che cosa fa |
|---|---|
| **Strati separati per fonte** (`scripts/sil/sil-layers.mjs`, chiamato da `sil-build.mjs`) | L'overlay 4.39b fonde OSM, DBT e ATM in un'unica parola di bit: da lì non si distingue più la fonte. La costruzione emette ora anche **quattro famiglie di file distinti**: `osm` (ODbL 1.0), `dbt` (CC BY, versione in conflitto), `atm` (CC BY 4.0), `assoc` (metadati di associazione derivati, solo interni). Ogni file porta fonte, licenza, attribuzione e data. Ledger, manifesto, copertura, fatti e 117 tessere dell'overlay 4.39b restano **identici byte per byte** (confrontati con la costruzione 4.39b). |
| **Lettore** (`lib/sil-layers.ts`) | Tipi, politica fonte↔licenza, impronta della tessera di base, controllo del manifesto e di ogni tessera, indici in array tipizzati. Puro, senza moduli Node. |
| **Adattatore** (`lib/sil-shadow.ts`) | Aggancia i due percorsi della risposta (veloce e anti-pavé) ai segmenti compilati, compone gli strati e produce i contatori. Provider iniettabile, cache limitate, tetti espliciti. **Non lancia mai eccezioni.** |
| **Indice di importazione** (`lib/sil-layer-index.ts`) | **Vuoto nel commit.** Il generatore `generate-sil-layer-index.mjs` copia in locale gli strati in una cartella ignorata da Git e scrive un `import()` pigro per tessera, come per le tessere stradali. |
| **Aggancio** (`app/api/routes/route.ts`) | Tre punti: import, una chiamata dopo `calculationCompletedAt`, la chiave additiva `diagnostics: { sil }`. |
| **Strumenti** | `--sil-layers=` nel benchmark, report di parità, corridoi noti, misure di runtime e di bundle. |

Attivazione: `configureSilShadow({ mode: "shadow", provider })` oppure `LASTRICO_SIL_MODE=shadow`. **Il collegamento di quella variabile al Worker non è verificato su Cloudflare.** Con `off` la risposta non contiene nemmeno la chiave `diagnostics`.

## 2. File modificati

**Modificati (4):** `.gitignore` (+4: strati generati ignorati), `app/api/routes/route.ts` (+10: aggancio), `scripts/benchmark-milan-routing.mjs` (+10 −1: flag `--sil-layers`, campi additivi nelle righe), `scripts/sil/sil-build.mjs` (+21 −2: compilazione e scrittura degli strati).

**Nuovi, codice (11):** `lib/sil-layers.ts` (228 righe), `lib/sil-shadow.ts` (552), `lib/sil-layer-index.ts` (16), `scripts/sil/sil-layers.mjs` (124), `generate-sil-layer-index.mjs` (63), `sil-corridor-diagnostics.mjs` (102), `sil-parity-report.mjs` (130), `sil-runtime-measure.mjs` (103), `sil-bundle-measure.mjs` (59), `tests/helpers/sil-fs-provider.mjs` (29), `tests/phase440-sil-runtime.test.mjs` (598, 29 test).

**Nuovi, documenti e prove:** `outputs/prompt-phase440-sil-runtime-shadow.md`, questo rapporto, `outputs/phase440/` (`shadow-parity.json`, `runtime-measure.json`, `bundle-growth.json`, `corridor-diagnostics.json`: solo conteggi e metri, nessuna coordinata).

**Non toccati:** `lib/spatial-road-store.ts`, punteggio, ordinamento, tessere, `worker/`, ogni file di Roma, `lib/sil-overlay.ts` (il lettore dell'overlay fuso 4.39 resta offline e non è letto dal runtime: lo verifica un test), i test 4.38, 4.39 e 4.39b.

## 3. Architettura del runtime

```
richiesta → handler (invariato) → candidati, punteggio, selezione, legalità → risposta decisa
                                                          │  solo se mode = shadow e area = Milano
                                                          ▼
 silShadowDiagnostics → manifesto (una volta per isolate) → versione del dataset
      │
      ├─ per ogni tessera toccata (≤ 24): tessera di base già in memoria → impronta (id via + vertici)
      ├─ per ogni strato consultato: import() pigro della tessera di strato → controllo di fonte, licenza,
      │   versione, impronta → apertura in array tipizzati → cache (≤ 480 tessere di strato, ≤ 120 indici)
      └─ aggancio a passi di 10 m (≤ 12 m, ≤ 30°) → codice di stato a 13 bit per tupla → contatori in metri
                                                          ▼
                                      risposta + { diagnostics: { sil } }   (nessuna rete, nessun D1, nessuna scrittura)
```

- **Copertura.** Per ogni fonte una tupla è *mappata*, *cercata e non mappata* (non è prova di assenza) oppure *sconosciuta* (nessuno ha chiesto). Uno strato non consultato dalla costruzione e una tessera mai interrogata non diventano mai «nessun binario». Il lettore non produce un valore «assente».
- **Identità della tessera di base.** Il Worker ha solo il JSON già analizzato, non i byte del file. L'aggancio è all'**impronta delle tuple** (id della via e quattro coordinate di ogni tupla), più il numero di tuple, più `sourceDatasetSha256` nel manifesto. Un vertice spostato di 8 cm cambia l'impronta (test). Otto tessere hanno hash di file diverso dalla base 4.38 per la correzione delle direzioni circolari, ma stesse tuple: l'impronta coincide su tutte e 117.
- **Fail-safe.** Provider o manifesto assente o illeggibile, versione sbagliata, dataset diverso, fonte o licenza non ammesse, impronta diversa, tessera mancante, corrotta o illeggibile, errore interno: la risposta di routing resta identica e `diagnostics.sil` dice `unavailable` o `partial` con il motivo. Una tessera di strato non leggibile vale «dato mancante», **mai** «cercato e non mappato».
- **Tetti.** 24 tessere per richiesta (oltre: `partial` con `tile-budget-exceeded`); 480 tessere di strato e 120 indici in cache.
- **Roccella e Roma.** L'adattatore esce subito per ogni area diversa da Milano.

## 4. Separazione delle fonti e valutazione delle licenze

**Implementato.** Ogni file di strato dichiara fonte, licenza e attribuzione; il caricamento **rifiuta** un file la cui fonte o licenza non è nell'elenco ammesso per quello strato (un file OSM etichettato CC BY, o un DBT etichettato ODbL, non viene letto). Il DBT resta `CC-BY-VERSION-CONFLICT`. Lo strato `assoc` è derivato da tutte e tre le fonti, è marcato `INTERNAL-DERIVED` e non eredita nessuna licenza di fonte. Tutti i file e il manifesto portano `distribution: internal-shadow-only`. **I dati degli strati non sono in Git** (cartella ignorata) e l'indice committato è vuoto. L'overlay fuso 4.39b resta un artefatto interno.

**Verifica sui testi.** Lettura delle fonti primarie da parte di un sotto-agente di ricerca, con questi limiti: le pagine sono state lette tramite uno strumento che riassume l'HTML (le lettere delle clausole sono quelle riportate dallo strumento). **Lettura di testi, non consulenza legale.**

| Fonte | Che cosa dice (parafrasi) | Riferimento |
|---|---|---|
| CC BY 2.5 Italia | Vieta la sublicenza dell'opera; ogni destinatario riceve la licenza dal titolare. Una «Collezione di Opere» non è un'opera derivata e la licenza copre l'opera, non la collezione. Obbliga a mantenere gli avvisi, citare l'autore e indicare che un'opera è derivata. | art. 1(a)(b), 4(a)(b), 8 |
| CC BY 4.0 | Non sublicenziabile; nessun termine aggiuntivo né misura tecnica che limiti i destinatari; attribuzione, indicazione delle modifiche e link alla licenza; la licenza dell'opera adattata non deve impedire di rispettare la CC BY. Nessuna condivisione alla pari. | §2(a)(5), §3(a) |
| ODbL 1.0 | Una banca dati derivata usata **pubblicamente** deve restare ODbL (o compatibile). Una *Collective Database* può avere altra licenza, ma la parte ODbL resta coperta. L'uso **interno** non è pubblico. Un *Produced Work* usato pubblicamente richiede un avviso. | 4.3–4.6 |
| OSMF | Attribuzione «© OpenStreetMap contributors» con link a openstreetmap.org/copyright e all'ODbL. Linea guida *Collective Database*: dati OSM e non OSM restano indipendenti se, **per ogni tipo di oggetto**, sono interamente OSM o interamente non OSM. Linea guida *Horizontal Map Layers*: per le mappe, se OSM e non OSM coprono lo stesso tipo di oggetto, la condivisione alla pari raggiunge anche i dati non OSM in uno strato separato. Tutte le versioni CC BY risultano incompatibili con l'**importazione in OSM** senza deroga. | pagine OSMF |
| Comune di Milano, DS2889 (DBT 2020) | Scheda: `cc-by` senza versione. Entrambe le risorse: `A25_CCBY25IT` (CC BY 2.5 IT). Il servizio REST: «CC-BY 4.0». **Incoerenza interna del Comune.** Nessun testo di attribuzione richiesto. | portale e servizio |
| Comune di Milano, ds538 (ATM) | Scheda `cc-by` senza versione; tutte le risorse `A21_CCBY40` (CC BY 4.0). Nessun testo di attribuzione richiesto. | portale |

**Attribuzioni proposte** (deduzione dell'agente, non richieste dall'ente): OSM «© OpenStreetMap contributors» con link e ODbL; DBT «Contiene dati del Database Topografico 2020 (DS2889), Comune di Milano, CC BY 2.5 Italia, elaborati/modificati»; ATM «Contiene dati ATM – Percorsi delle linee di superficie urbane (DS538), Comune di Milano, CC BY 4.0, modificati».

**Che cosa ne segue** (deduzione):
1. Tre file separati con avvisi separati sono la strada prudente: è la disposizione che le fonti descrivono come *Collective Database*. Stretta lettura: l'ODbL definisce il termine per la banca dati non modificata, e se fatti derivati dal DBT o dall'ATM contino come «banche dati indipendenti» è una **deduzione non verificata**.
2. **Un nuovo punto, emerso ora:** il contatore composto `railsMapped` unisce OSM e DBT sullo **stesso tipo di oggetto** (binari). Per la linea guida *Collective Database* l'uscita composta non è «interamente OSM o interamente non OSM». Finché `diagnostics.sil` resta interno non c'è distribuzione pubblica (ODbL 4.5(c)); **se mai fosse esposto**, andrebbero esposti solo i contatori per fonte con i rispettivi avvisi, e servirebbe una revisione legale.
3. Un file unico non cambia le conseguenze per il DBT e l'ATM fra loro (nessuna condivisione alla pari), ma **mescolare fatti OSM in un file CC BY non è ammesso** dall'ODbL se usato pubblicamente, e mettere fatti CC BY in un file ODbL scontra con il divieto di sublicenza della 2.5 IT.
4. **Non verificati:** i termini d'uso del portale (la pagina ha risposto 403), la linea guida OSMF sulle banche dati derivate (404), un testo OSMF che tratti direttamente la miscela CC BY 2.5 IT / 4.0 dentro una banca dati ODbL distribuita.

Nessun intervento di questa fase autorizza una distribuzione pubblica.

## 5. Esempi di diagnostica su Milano

Corridoi pubblici, dai segmenti compilati e dagli strati reali (`outputs/phase440/corridor-diagnostics.json`). Ogni via è letta in due modi: segmenti unici composti dagli strati, e ogni segmento percorso come un proprio percorso attraverso l'adattatore intero.

| Via | Segmenti (m) | Binari mappati | Cercati e non mappati | Servizio ATM sui binari mappati | Note |
|---|---|---|---|---|---|
| **Corso Lodi** | 238 (5.100) | **34 seg., 683 m**, tutti DBT, nessuno OSM, tutti su carreggiata condivisa | 4.417 m | linea programmata vicina 0 m, **nessuna linea 683 m** | **Disaccordo visibile:** DBT mappa, OSM ha cercato e non mappa, per 683 m. 683 m da rivedere. 657 m con più assi. Come percorsi: 682 m mappati. |
| **Piazzale Lodi** | 107 (373) | **0** | 373 m | — | Nessun binario inventato. Non è prova di assenza. Come percorsi: 0. |
| **Via Lazzaro Papi** | 12 (274) | **0** | 274 m | — | **Nessuna eredità** da Corso Lodi che la incrocia: anche percorsa come percorso, 0 m mappati. |
| **Via Friuli** | 38 (1.244) | **3 seg., 72 m** (DBT) | 1.172 m | **linea vicina 72 m**, nessuna linea 0 m | Infrastruttura storica (DBT, marzo 2020) e servizio attuale (ATM, luglio 2026) sono **numeri separati**. Nessun disaccordo registrato. |
| **Viale Umbria** | 182 (4.475) | **17 seg., 340 m** (DBT) | 4.135 m | linea vicina 29 m, **nessuna linea 311 m** (14 segmenti) | Binari mappati senza linea programmata: causa **non verificata**. 14 m con classe ambigua, 340 m con più assi. |

I numeri per via coincidono con la 4.39b (34, 0, 0, 3, 17 segmenti: lo stesso conteggio dell'overlay fuso). Differenza dichiarata: l'ATM dello strato è valutato **per segmento** (linea entro 12 m dal punto medio), mentre l'overlay fuso lo valutava per tratto continuo (≥ 50 % dei punti medi), quindi su Viale Umbria i segmenti senza linea sono 14 invece di 15.

## 6. Copertura e incertezza

Su 263 risposte del benchmark (401 percorsi distinti, 1.747,9 km; `outputs/phase440/shadow-parity.json`):

| Misura | Metri | Quota |
|---|---:|---:|
| **Binari mappati** (almeno una fonte) | 255.955 | 14,64 % |
| **Cercati e non mappati** (non è prova di assenza) | 1.398.763 | 80,03 % |
| **Sconosciuti per copertura** | 0 | 0 % (il DBT interroga tutto il Comune) |
| Senza segmento allineato entro 12 m | 93.138 | 5,33 % (include i 3 casi con tetto di 24 tessere) |
| Dati mancanti (strato non leggibile) | 0 | 0 % |

- **Per fonte, sui binari mappati:** DBT 255.424 m, OSM 125.066 m; entrambi 124.531 m; solo DBT 130.892 m; solo OSM 534 m. Classe DBT: carreggiata condivisa 236.423 m, sede propria 14.141 m, classe sconosciuta 4.865 m.
- **Servizio ATM sui binari mappati:** linea vicina 175.572 m, **nessuna linea 80.395 m** (31 %). Non vuol dire «binari rimossi».
- **Disaccordo fra fonti:** DBT mappa e OSM ha cercato senza mappare, **27.075 m** (10,6 % dei mappati); l'inverso 534 m; contestati dal risolutore 12 m.
- **Ambiguità:** per **301.280 m (18,2 % dei metri agganciati)** esiste un secondo segmento allineato entro 12 m con stato diverso. Nei tratti a carreggiate affiancate o con binari in mezzo l'assegnazione dei binari al segmento è quindi **incerta**: è l'incertezza principale di questo strato. Altri conteggi: classe ambigua 10.683 m, più assi 229.595 m, quasi-agganci 6.166 m, da rivedere 84.243 m.
- **Esposizione dei percorsi:** 341 percorsi su 401 toccano almeno un tratto con binari mappati. Con alternativa anti-pavé (138 casi) l'alternativa ha meno binari mappati in 102 casi, più in 30, uguale in 6: informazione, **non una decisione**.
- **Verifica incrociata con il replay 4.39b** (overlay fuso, stesse risposte): metri mappati entro 1 m su **522 di 526** percorsi mostrati. I percorsi che divergono sono solo quelli dei **3 casi `partial`** (percorsi motociclistici di 10–16 km oltre il tetto di 24 tessere); lì il runtime lo dice (`partial`, `tile-budget-exceeded`) e conta come «senza aggancio» ciò che non ha letto.

## 7. Parità in modalità ombra

Stessi 264 casi del corpus, stesse 817 richieste dall'archivio dei provider (0 mancanti, 0 nuove), stesso orario di partenza fisso (`2026-11-09T12:00`, come la registrazione 4.39b). Confronti A = 4.39b registrato, A' = 4.40 con SIL spento, B = 4.40 con SIL in ombra; il report è `scripts/sil/sil-parity-report.mjs`.

| Invariante (A' contro B) | Esito |
|---|---|
| Stato della risposta | 264/264 |
| Geometrie dei percorsi (veloce e anti-pavé) | 264/264 |
| Percorso scelto (anti-pavé uguale o diverso, esito, alternative analizzate) | 264/264 |
| Pavé confermato, probabile, sconosciuto, copertura | 264/264 |
| Durata e distanza | 264/264 |
| Legalità (idoneità, restrizioni bloccanti e confermate per candidato) | 264/264 |
| Richieste al provider (stesse chiavi, stesso ordine) | 264/264 (817 = 817) |
| **Unica differenza nel payload: la chiave `diagnostics.sil`** | 264/264 (263 con diagnostica; il caso 422 non ne ha) |

- **A contro A':** 264/264 payload identici (solo i campi di tempo ignorati). **A contro B** ignorando `diagnostics`: 264/264. **A' contro B** senza ignorare nulla: differisce in 263 casi, per la sola diagnostica.
- **Differenza inattesa trovata e spiegata:** al primo confronto A contro A' dava 0/264 identici. Causa: la registrazione 4.39b usava `--departure=2026-11-09T12:00` e i miei primi run no, quindi la partenza era l'ora corrente (finestre ZTL diverse: `accessContext.departure`, `unknownConditionMeters`, `dataNotice`). **Era un input diverso, non una differenza di codice.** Rieseguiti con lo stesso orario: 264/264.
- **Stato della diagnostica:** 260 `ok`, 3 `partial` (tetto di 24 tessere), 0 `unavailable`. 1.812 tessere di base controllate, tutte compatibili.
- **Roccella:** richiesta in area Roccella con SIL in ombra: nessuna chiave `diagnostics`, risposta identica (test). **Roma:** non toccata; l'adattatore la ignora e nessun file di Roma cambia. Verificato a mano che `removeRomeBlocksFromRoutesHandler` (copia di rilascio solo-Milano) trova ancora i suoi due blocchi esattamente una volta e che il gancio SIL resta nel gestore dopo la rimozione; il test omonimo fallisce già sulla baseline su questo host per le fini riga CRLF.

## 8. CPU, memoria e bundle

**Misure locali in Node 26 su Windows. Non sono misure su workerd né su Cloudflare.**

| Misura | Valore |
|---|---|
| Tempo della diagnostica (`processingMs`), 263 richieste del benchmark | mediana **2,0 ms**, media 2,6 ms, p95 5,9 ms, massimo 67,5 ms (letture a freddo) |
| Con cache calda (ripetizione) / molto calda (40 percorsi ripetuti) | mediana 2,0 / 2,1 ms, p95 4,2 / 5,7 ms |
| CPU per richiesta, benchmark intero (con lettura da disco a freddo) | media **32,3 → 35,8 ms (+10,9 %, +3,5 ms)**; mediana 31 → 31 ms; totale 8.529 → 9.459 ms. Il tempo del gestore (`performance.totalMs`) non cambia: la diagnostica è dopo. |
| Ricerche di tessera per richiesta | 6,9 tessere di base, 22,9 tessere di strato (228 letture dal provider in tutto, 5.800 dalla cache) |
| Richieste esterne | **0** (`fetch` mai chiamato in tutti i passaggi; i test lo verificano) |
| Memoria dell'heap, SIL | **+0,94 MiB** dopo tutto il corpus; **piatta a 42,9 MiB su 800 richieste ripetute** (cache limitate: 228 tessere di strato, 83 indici a fine prova) |
| Strati su disco | 440.874 B grezzi, 198.783 B gzip (per file): osm 25 file, dbt 117, atm 66, assoc 67, più il manifesto. L'overlay fuso 4.39b: 158.578 B grezzi |
| Bundle (due `vinext build`, nessun deploy) | senza strati 18.881.080 B → con strati 19.479.837 B: **+598.757 B grezzi (+3,17 %), +241.184 B gzip per file (+6,1 %)**, in **276 pezzi caricati pigramente** |

Lettura:
- **Memoria e lookup rispettano l'obiettivo.** Il profilo ha mostrato due versioni peggiori: la prima ricostruiva l'indice delle tessere a ogni richiesta (CPU media +68 ms); la seconda lo teneva in cache con strutture a mappe (+5,7 ms ma +18,7 MiB di heap). La versione finale usa array tipizzati e una griglia densa; i numeri sopra sono i suoi. Tutte e tre danno gli stessi metri (verifica con l'oracolo 4.39b).
- **Il tetto della 4.36 («CPU ≤ +5 %») non è dimostrato:** +10,9 % in Node, a freddo e su un host non confrontabile con il Durable Object. In assoluto sono +3,5 ms su un compito che in produzione ha 30 s di CPU, ma **la CPU del Durable Object non è stata misurata**.
- **Bundle:** +0,23 MiB gzip per file, entro l'obiettivo «≤ +0,5 MiB»; +0,57 MiB grezzi, lievemente sopra. `dist/server` misura 19,5 MB non compressi (albero con Roma; la copia pilota è più piccola). Dalla pagina ufficiale dei limiti (letta oggi): **64 MiB non compressi, nessun limite sulla dimensione compressa**, 128 MB di memoria per isolate, 10 ms di CPU per richiesta HTTP del Worker ordinario (il routing gira nel Durable Object: 30 s di CPU predefiniti). La dimensione è compatibile.
- **Non verificato su Cloudflare:** CPU nel Durable Object, memoria reale (in un Worker il JSON importato resta nel registro dei moduli oltre alle mie cache), costo dell'`import()` dei 276 pezzi a freddo, gzip dell'intero pacchetto (la misura qui è la somma dei gzip per file: sovrastima), collegamento della variabile `LASTRICO_SIL_MODE`. Un `wrangler deploy --dry-run` non è stato eseguito.

## 9. Test

| Controllo | Esito |
|---|---|
| `tsc --noEmit` | 0 errori |
| ESLint | 0 errori, 0 avvisi |
| `vinext build` | riuscita (con l'indice vuoto committato) |
| Test nuovi `phase440-sil-runtime` | **29/29** |
| Test 4.39 e 4.39b | 16/16 invariati (compreso «nessun overlay fuso letto dal runtime» e la costruzione deterministica, che ora copre anche gli strati) |
| Guardia «nessun codice di ricerca nel bundle» (`experiments-isolation`) | passa dopo la correzione descritta sotto; gli altri test di quel file già falliti sulla baseline restano falliti allo stesso modo |
| **Suite completa** (Windows, Node 26, archivio dei provider messo da parte) | **573 test: 543 superati, 22 falliti, 8 saltati.** Baseline `b5ba991` sullo stesso host: 544 test, 514 superati, 22 falliti, 8 saltati. **Stesso insieme di 22 falliti** (confronto dei nomi), +29 test nuovi tutti superati. Nessuna nuova regressione. |
| Linux CI | **Non eseguita**: niente push, quindi niente flusso remoto autorizzato. Va rieseguita prima di qualsiasi unione. |

I 29 test coprono: caricamento degli strati e impronta della tessera; separazione delle fonti (nessuno strato cita un'altra fonte, nessun bit estraneo); provenienza e date; metadati di licenza (una licenza o fonte non ammessa viene rifiutata, il DBT conserva il conflitto di versione); semantica della copertura; controllo di versione e di tessera di base; ripiego (provider assente, manifesto mancante o corrotto, dataset diverso, tessera illeggibile, mancante, corrotta, rietichettata, impronta diversa, tetto di tessere); compatibilità delle diagnostiche dell'API (con `off` nessuna chiave); invarianza del routing con il gestore vero (stessa risposta, stesse richieste al provider); nessuna richiesta esterna; caricamento compatibile con i Worker (nessun modulo Node, nessun `fetch`, indice vuoto); Roccella invariata; esclusione di Roma; corridoi noti dagli strati reali.

**Due falsi allarmi trovati dalla suite, entrambi chiariti:**
1. `built bundle … contains no experiment or dashboard code` falliva perché una mia costante testuale conteneva la parola «roughness» (guardia contro codice di ricerca nel bundle). **Regressione mia, corretta** (la costante è ora `no-physical-condition-measurement`); ricostruito e riverificato.
2. `the committed report matches a fresh run` falliva perché avevo decompresso l'archivio delle risposte dei provider (ignorato da Git) per il benchmark: il test lo trova e produce un report diverso da quello committato. **Artefatto del mio ambiente**, non del codice: con l'archivio messo da parte passa. La suite finale è stata eseguita così, come la baseline.

Nessun test è stato modificato per farlo passare. I test 4.39 e 4.39b non sono stati cambiati.

## 10. Blocchi tecnici residui

1. **Nessuna misura su workerd/Cloudflare:** CPU del Durable Object, memoria reale, costo a freddo degli `import()`, collegamento della variabile d'ambiente, `wrangler --dry-run`. Serve un ambiente isolato autorizzato.
2. **Licenze:** versione CC BY del DBT (2.5 IT o 4.0) e testo di attribuzione da chiedere al Comune; stato giuridico del contatore composto OSM+DBT; termini d'uso del portale non letti. **Nessuno strato può uscire dal repository** finché non sono chiariti.
3. **Canale di consegna degli strati.** Oggi l'indice committato è vuoto e i dati sono locali: per un Worker serve decidere come arrivano (risorsa statica, R2 o altro), fuori dal repository pubblico.
4. **Ambiguità di aggancio: 18,2 % dei metri agganciati.** Rende incerta l'assegnazione dei binari dove le carreggiate sono affiancate. Prima di qualsiasi avviso serve ridurla o mostrarla.
5. **Tetto di 24 tessere:** 3 richieste su 263 (percorsi motociclistici di 10–16 km) restano `partial`. Alzarlo costa memoria transitoria; è una scelta da fare con le misure su Cloudflare.
6. **Il DBT è del 2020.** Nessuna prova che i binari esistano ancora. Sui percorsi del benchmark: 27 km di disaccordo con OSM sui binari mappati e 80 km senza linea ATM programmata (somme sui percorsi, non sulla rete). Cause non verificate.
7. **Linux CI non eseguita;** 22 fallimenti già presenti sulla baseline di questo host (fini riga CRLF, Node 26) restano da confrontare con la CI Linux.
8. **Differenza semantica dell'ATM** rispetto all'overlay fuso (per segmento invece che per tratto): dichiarata; da tenere presente nei confronti con la 4.39b.
9. **Dopo l'unione della PR #16:** rebase, benchmark nuovo, nuovo confronto di parità (§11).
10. Il collegamento della modalità `shadow` a una variabile del Worker non esiste ancora: oggi si attiva solo via codice o ambiente Node.

## 11. Dipendenze dalla PR #16

Stato verificato oggi: **aperta**, non in bozza, **unibile**, CI «Lint, test and build» **riuscita**, testa `1a5d8e9`, 38 file cambiati rispetto a `main` (`3e31da9`). Non è stata toccata né unita.

- Questo ramo parte da `b5ba991` (che non contiene la PR #16): **i percorsi della PR #16 non sono stati valutati**. Il candidato di generazione anti-pavé e la penalità della svolta a U cambiano i percorsi scelti: la parità di questo rapporto vale per il motore *senza* PR #16.
- **File in comune:** `app/api/routes/route.ts` (la PR: +75 −16; qui: +10 in tre punti) e `scripts/benchmark-milan-routing.mjs`. Un calcolo di unione senza modificare nulla (`git merge-tree` fra `ac17c0d` e `1a5d8e9`) segnala **nessun conflitto testuale**. Non è una validazione semantica.
- **Condizioni dopo l'unione:** rebase di 4.38, 4.39, 4.39b e 4.40; nuovo benchmark con la baseline della PR #16 (A = PR #16 senza SIL, B = con SIL in ombra); ripetere il confronto di parità; rieseguire la suite; confermare che la copia di rilascio solo-Milano e i test su Roma passano.

## 12. Raccomandazione GO / NO-GO

- **GO** per la **revisione tecnica** e per la **validazione controllata in modalità ombra**, in un ambiente di prova: il motore legge gli strati durante una richiesta, produce diagnostica consapevole delle fonti e **non cambia nessuna decisione** (264/264 su tutti gli invarianti, 0 richieste esterne, memoria piatta, fallimenti sempre spiegati).
- **NO-GO** per: attivazione in produzione; avvisi o penalità sui binari; distribuzione o pubblicazione degli strati o dell'overlay fuso; esposizione pubblica di `diagnostics.sil`; qualsiasi uso dei binari come «presenza fisica» o come rugosità.

## 13. Prima di qualsiasi avviso o penalità sui binari

1. **Licenze:** conferma della versione CC BY del DBT con il Comune, testi di attribuzione, parere legale sul contatore composto e sulla linea guida *Collective Database*; decisione su dove vivono gli strati.
2. **Infrastruttura:** misura della CPU nel Durable Object e della memoria su Cloudflare (con approvazione), canale di consegna dei dati, variabile di modalità collegata e provata, tetto di tessere calibrato.
3. **Dati:** ridurre o mostrare l'ambiguità di aggancio (18 %); estrazione OSM arricchita per i 3.510 segmenti dove il DBT vede binari e OSM non ha mai cercato; capire i tratti senza linea ATM.
4. **Verità a terra:** sopralluoghi con foto e metro su Corso Lodi, Via Friuli, Viale Umbria e Piazzale Lodi (presenza fisica, incasso a filo o sporgente, stato): senza, i binari restano «mappati nel 2020».
5. **Prodotto:** una decisione esplicita sull'uso (informazione, avviso o penalità) e sulle parole, che non dicano «binari presenti» ma «binari mappati nel 2020».
6. **Rilascio:** rebase sulla PR #16, nuovo benchmark e parità, CI Linux, validazione sul pilota in ombra senza effetti visibili.

## 14. Riproduzione

```bash
# 1. Strati (offline). L'ATM e la cache DBT sono quelli della 4.39b.
node scripts/sil/sil-build.mjs --foundation=work/base-supp/osm-foundation --tiles=work/base-supp/milan-tiles \
  --production-tiles=data/surfaces/milan-tiles --dbt-citywide-cache=work/dbt-cache --atm=<atm-tpl_percorsi.geojson> --output=work/sil-city
# 2. Benchmark: SIL spento, poi in ombra (stesso orario fisso della registrazione 4.39b)
node scripts/benchmark-milan-routing.mjs --label=phase440-off --no-stability --departure=2026-11-09T12:00
node scripts/benchmark-milan-routing.mjs --label=phase440-shadow --no-stability --departure=2026-11-09T12:00 --sil-layers=work/sil-city/layers
node scripts/compare-benchmark-payloads.mjs phase440-off phase440-shadow --ignore=diagnostics
node scripts/sil/sil-parity-report.mjs --a=phase440-off --b=phase440-shadow --replay=<shadow-replay.json>
# 3. Corridoi, runtime, bundle
node scripts/sil/sil-corridor-diagnostics.mjs --layers=work/sil-city/layers --fused=work/sil-city/overlay
node --expose-gc scripts/sil/sil-runtime-measure.mjs --layers=work/sil-city/layers --cases=outputs/phase425-benchmark/phase440-off/cases
node scripts/sil/sil-bundle-measure.mjs --layers=work/sil-city/layers
```
Il benchmark richiede l'archivio dei provider decompresso (`outputs/phase425-benchmark/PROVIDER_ARCHIVE.md`); va messo da parte per eseguire la suite completa.

## Sintesi esecutiva

**Esito Fase 4.40: criteri di accettazione superati in locale.** Il motore dei percorsi di Milano legge ora gli strati SIL durante una richiesta e produce una diagnostica che distingue le fonti (OSM, DBT del Comune, ATM) senza cambiare alcuna decisione: su 264 casi reali di Milano, risposta, geometrie, percorso scelto, pavé, tempi, legalità e richieste al provider sono identici a prima. Roccella è invariata, Roma non è stata toccata. Se uno strato manca, è danneggiato o non coincide con la mappa, il percorso si calcola lo stesso e la diagnostica lo dice; «sconosciuto» non diventa mai «nessun binario». Nel 14,6 % dei metri percorsi esistono binari mappati nei dati aperti (2020 per il Comune), ma per il 18 % dei metri agganciati l'assegnazione è ambigua e per il 10 % dei binari mappati le fonti discordano: sono evidenze, non prove di binari oggi presenti.

**Raccomandazione: GO per revisione tecnica e validazione controllata in ombra. NO-GO per produzione, avvisi o penalità sui binari e per pubblicare gli strati.** Prima servono: chiarire le licenze (versione CC BY del DBT, miscela OSM+DBT), misurare CPU e memoria su Cloudflare, decidere come consegnare i dati, rieseguire tutto dopo la PR #16 e la CI Linux, e un sopralluogo fisico. Nulla è stato pubblicato, unito o distribuito; il commit è locale.
