# Lastrico · Fase 4.38 · Fondazione OSM e integrità geospaziale

## Decisione

**GO per revisione tecnica della pipeline offline. NO-GO per l’uso del nuovo strato in produzione.** Le prove consentono di integrare la compilazione e rieseguire i join su input con provenienza verificata. Per usare la topologia come dato cittadino occorrono gli estratti arricchiti dei singoli settori e una validazione con gli stessi snapshot dei provider.

Ramo `feat/phase438-osm-foundation`, worktree esterno alla copia originale, baseline remota `3e31da9a32795c20cdb8b38d343906c546e6058f`. La PR #16 risultava aperta al commit `1a5d8e95066cb106283e169cc0b862a108e6f1be`. La fase 4.38 è indipendente. Nessun commit, push, merge, deploy o aggiornamento degli archivi e delle tessere in produzione. Il candidato con il nuovo senso di marcia è stato generato in `work/`. I rapporti, gli esperimenti e le cache 4.36 restano nella directory originale. [PR #16](https://github.com/campsh98-creator/Lastrico/pull/16)

## Implementazione e schema

| Livello | Prima | Dopo |
| --- | --- | --- |
| Estrazione cittadina | Otto box, soli `highway`, nodi scheletrici, versione del nodo con fallback a 1. | Stessi otto box con estrazione esplicita per settore. Vie stradali e ferroviarie separate, nodi pertinenti, relazioni di svolta con membri, riferimenti alle relazioni ferroviarie locali. Versioni, timestamp, changeset e tag ammessi presenti all’origine. Copertura effettiva e digest della query e della risposta nel manifesto v3. |
| Tessera runtime | Tuple compatte di 11 campi per Milano (14 nel formato completo), ID via, coordinate, superficie e bit modali. | Stessa arità e stesse tabelle. Bit 5–7 del campo flag per la direzione circolare inferita separatamente per auto, moto e bici. Il lettore accetta tessere storiche con questi bit a zero. |
| Artefatto offline | L’output compilato perdeva la versione della via, gli ID dei nodi e il riferimento puntuale alla fonte. | Manifesto `lastrico-osm-foundation-v1`, tabelle delle entità per gruppo di fonti e file compressi per tessera. Una riga `[stato, gruppo, indiceDelPrimoNodo, orientamento]` punta alla geometria OSM originale. Riferimenti alle geometrie ferroviarie per tile e alle relazioni per via. Hash SHA-256 della tessera di base, dei file compressi e dei contenuti decompressi. |
| Identità | L’hash di compilazione derivava dalla geometria e dall’orientamento. | `osm-edge-v1` ordina i due ID degli estremi e quantizza le coordinate a 10⁻⁷ gradi. L’ID geometrico è indipendente dall’orientamento. L’ID di revisione include anche ID e versione della via. La versione base del dataset e l’hash della tessera devono coincidere prima di un join posizionale. |

Gli attributi `surface`, `smoothness`, `surface_bike` e le varianti di corsia o senso sono leggibili in offline con la loro provenienza. L’offset di una tessera è un riferimento alla compilazione corrente. Per spostare evidenze tra snapshot, il confronto riconosce archi conservati e segnala split, merge, cambio di via/versione, modifica di geometria e nodi che cessano di essere adiacenti. Le associazioni ambigue richiedono revisione e una cancellazione richiede un tombstone esplicito. L’assenza da un estratto lascia il riferimento orfano. Un bordo tagliato conserva il riferimento all’arco padre e la lookup restituisce lo stato `clipped`.

Per `junction=circular` senza indicazione esplicita il compilatore conserva il flusso lungo l’ordine dei nodi come inferenza modale compatibile con i provider. `oneway=no`, `-1`, eccezioni modali e condizioni restano riconoscibili. L’inferenza aiuta l’abbinamento superficiale e da sola non invalida un percorso del provider. Il valutatore offline verifica sequenze esatte di archi e relazioni `no_*` e `only_*` via nodo o via una sequenza di strade. Condizioni, topologia incompleta, corrispondenze ambigue e copertura indeterminata producono un esito incerto. Il provider resta la fonte degli itinerari e dei vincoli di svolta usati in app. [OSM junction=circular](https://wiki.openstreetmap.org/wiki/Tag:junction%3Dcircular) · [OSM turn restrictions](https://wiki.openstreetmap.org/wiki/Relation:restriction) · [Valhalla](https://github.com/valhalla/valhalla/blob/master/lua/graph.lua) · [OSRM bicycle](https://github.com/Project-OSRM/osrm-backend/blob/master/profiles/bicycle.lua)

## Verifiche di provenienza e dati

- Otto archivi cittadini storici verificati via digest grezzo e gzip, con 56.702 vie stradali distinte. Sette registrano `timestamp_osm_base`. Gli undici archivi pilota riportano il momento delle singole acquisizioni. L’ora di modifica di una via e la data di un rilievo fisico hanno significati distinti. Le versioni storiche dei nodi fabbricate a partire dallo scheletro Overpass vengono lasciate sconosciute.
- Il campione pubblico 4.36 di Piazzale Lodi, Corso Lodi e Via Lazzaro Papi è stato rielaborato due volte. Raw SHA-256 `a14b786c7bde04dc7af154b2f86265d48e0c2db9d31c51f3cef01bb6e8370b79`, query SHA-256 `a51b67dd4a4822467e0b9df956f989343bb3f1719ebb2b90b55f92ff830c8b74`, snapshot `2026-11-14T13:49:43Z`. Le due estrazioni hanno lo stesso manifesto SHA-256 `f28ceb008f7d1511f9fbf70ec33143b22c3f5097eec9c0140e9c93a0c2e2bc44`. Campione di 121 vie stradali, 13 ferroviarie, 691 nodi di cui 187 con tag e 12 restrizioni di cui 4 con membri assenti. Il campione ha copertura per corridoio dichiarata e nessun tram mappato.
- Il sidecar storico conserva 826 vie ferroviarie del pilota, tra cui 661 vie tram con tutti i vertici, e 220 restrizioni e 76 altre relazioni ferroviarie. 29 restrizioni hanno almeno un membro assente nel gruppo. Gli otto archivi cittadini storici hanno zero relazioni e zero vie ferroviarie indipendenti. Il controllo di completezza resta falso per questi archivi e per il campione mirato.
- I 102.028 segmenti del candidato hanno una corrispondenza esatta con la via e i relativi vertici, con versione nota. Le vie `287070936` (sett, v17), `111768010` (asfalto con `surface_bike=milanese_paving`) e `111767966` (asfalto) danno 27 archi OSM distinti. Il test sintetico verifica anche un tratto ritagliato e una linea tram indipendente completa di geometria.
- Una richiesta esplicita al solo settore sud-est è terminata con `fetch failed` prima di ottenere una risposta HTTP. Nessun retry. Il comportamento su HTTP 429 e `Retry-After` è verificato con una risposta simulata. Nessun settore è stato sostituito.

## Risultati

- **Corpus Milano** · 264 casi (88 per auto, moto e bici), 263 HTTP 200 e 1 HTTP 422 in bici già presente sulla base. 817 richieste riutilizzate dall’archivio, zero mancanti e zero chiamate al provider. I 264 payload coincidono a esclusione dei campi cronometrici. Geometrie, fondo, risposta e richieste del provider coincidono.
- **Topologia OSM** · 51 vie cambiano direzione per ciascuna modalità, in 192 tuple su 8 tessere, inclusa la via 713165261 di Piazzale Lodi. Le maschere di accesso, i valori e i pesi del fondo risultano identici. Il controllo su 45 relazioni archiviate via nodo trova 45 divieti applicabili per l’auto e 44 per moto e bici. La relazione `16115966` contiene un’eccezione esplicita per moto e bici.
- **Copertura e fondo** · 117 tessere e 1.637.974 m su entrambi i dataset. Circa 70.444 m di pavé confermato, 59.534 m probabile, 1.171.696 m di liscio confermato, 60.813 m di fondo sciolto e 275.487 m sconosciuti in entrambi. La qualità degli itinerari reali richiede riscontri sul campo.

- **Test mirati** · 20 su 20 superati, di cui 16 test 4.38. La ricompilazione storica riproduce l’hash compatto 4.24. I test verificano anche versioni sintetiche assenti, nodi con tag, relazioni temporali, geometrie ferroviarie indipendenti e verifica degli hash del sidecar.
- **Suite completa Windows** · baseline 492 pass, 13 fail, 7 skip su 512. Candidato 508 pass, 13 fail, 7 skip su 528. Le 13 prove fallite coincidono per nome su entrambe. Coincidono due test di replay GPS, le due prove 4.18.1 sul DOM e le richieste in uscita, la prova 4.33 sul separatore del controllo Roma e otto verifiche di percorso del dashboard. ESLint, TypeScript `--noEmit`, build completa e build pilota completati. WSL non è disponibile su questo host.
- **E2E mobile locale** · 5/5 sul pilota in Chrome con emulazione mobile, risposte dell’API simulate con le fixture di itinerari e correzioni del banco di prova confinate alla copia di verifica Windows. A1 (pianificatore), A5 (cambio città), A6 (modalità), B1 (navigazione), C1 (Roccella). C1 ha avuto un timeout nel primo passaggio ed è passato al riesame isolato. La baseline supera gli stessi cinque scenari. La prova usa emulazione Chrome su Windows.
- **Artefatto pilota** · escluse 634 sole voci Roma e ripuliti 7 file condivisi. Zero corrispondenze Roma nei sorgenti e negli output di baseline e candidato, anche dopo la generazione della homepage statica. Homepage statica del candidato 12.449 B. La build contiene Milano e Roccella. La scansione e il dry-run sono locali. Il Worker candidato serve `/` e `/?area=roccella` con HTTP 200 e risponde HTTP 400 alla ricerca troppo breve. Con la configurazione pilota applicata a Wrangler locale, la prova su richieste incomplete a `/api/routes` restituisce HTTP 503 anche sulla baseline preparata nello stesso modo.

## Misure

| Misura | Baseline | Candidato |
| --- | ---: | ---: |
| JSON compatto Milano | 8.209.189 B | 8.209.765 B (+576 B) |
| JSON compatto, gzip livello 9 | 1.835.102 B | 1.835.258 B (+156 B) |
| SHA-256 JSON compatto | `996c043468389761015b8b487aef14f8c5bb8d323b2dd35d9350fe3508cb1f4d` | `bd885ce32ab5e7a2050e679306c54a535b08eb18c907a44a11f2fec9ef1d9830` |

| Durata compilazione locale | 9,98 s | 18,33–21,55 s in due processi |
| Picco RSS della compilazione locale | 558,8 MiB | 710,1–801,2 MiB |
| Artefatto offline, escluso manifesto | — | 24.659.745 B grezzi / 2.978.925 B gzip |

Le due compilazioni con il campione 4.36 producono lo stesso hash base e lo stesso SHA-256 del manifesto offline `31fb661283da142fc93c0aab527691e546cde2a9d0c81d6709a84a787d1000ec`. La versione dati offline è `c3856977fe2e10db5069f7549ec3a0fd5cbc20f32fa1f8f8fa09d0eca0770e64`. Il supplemento mantiene tutte le 134 vie e i 691 nodi della raccolta, come gruppo autonomo. Il confronto file per file tramite SHA-256 coincide per i 118 file del runtime e i 121 file offline. I digest dell’artefatto sono verificati in lettura.

Il dry-run Wrangler del pilota misura 13.368,96 → 13.370,06 KiB grezzi (+1,10 KiB) e 3.357,57 → 3.357,80 KiB gzip (+0,23 KiB). Il limite pubblicato da Cloudflare per Workers Free è 64 MiB non compressi. [Limiti Cloudflare Workers](https://developers.cloudflare.com/workers/platform/limits/#worker-size)

Nella coppia sequenziale dei 264 replay Node, a browser e server di test chiusi, l’heap dopo GC passa da 84.886.736 a 84.890.424 B (+3.688 B) e il picco RSS da 431.328 a 432.164 KiB (+836 KiB). CPU aggregata 7.141 → 6.577 ms, tempo a parete aggregato 5.653,9 → 5.339,1 ms. CPU per caso p50/p95 16/63 → 16/47 ms, tempi a parete 13/38 → 12/34 ms. Una prima coppia sotto carico contemporaneo aveva CPU p50/p95 31/124 → 46/141 ms. La variabilità di queste misure locali non consente una stima stabile della latenza o della CPU per richiesta del Worker.

La memoria di compilazione è rilevata nel processo Node locale. I file con metadati sono sotto `work/`, fuori dal bundle e dalla sua memoria runtime. Le misure del Worker sono locali, senza telemetria di produzione su CPU o memoria Workers Free.

## Riproduzione

In un checkout di lavoro. L’ultimo comando confronta le tuple con l’archivio storico del repository, prima di qualsiasi copia del candidato nelle cartelle di build. Lo staging conserva il set di chiavi usato dall’indice TypeScript esistente.

~~~powershell
node scripts/osm/expand-milan-citywide.mjs --verify
node scripts/osm/compile-compact-tiles.mjs --output-dir=work/phase438-candidate
node scripts/osm/compare-foundation-build.mjs work/phase438-candidate
node --test tests/osm-foundation.test.mjs tests/phase438-osm-extraction.test.mjs tests/phase438-topology.test.mjs tests/phase424-surface-rules.test.mjs
~~~

Il corpus usa l’archivio `outputs/phase425-benchmark/provider-responses.tar.gz`. Estrarlo nella cartella `outputs/phase425-benchmark` di ciascuna copia di verifica e usare `node scripts/benchmark-milan-routing.mjs --label=<prima-o-dopo> --departure=2026-11-09T12:00 --no-stability`. Eseguire la baseline su `3e31da9` e il candidato con JSON compatto, manifesto e tessere staged nella copia di verifica. Raccogliere le due cartelle dei risultati in un’unica copia e usare `node scripts/compare-benchmark-payloads.mjs phase438-before phase438-after` con le rispettive etichette.

Per ripetere il campione 4.36 si passa il JSON raw e la riga di cattura Q2 conservati localmente al comando `expand-milan-citywide.mjs --sector s-east --cache <file> --capture <ricevuta.json> --output-dir <cartella>`. La ricevuta è l’oggetto JSON della sola riga Q2 HTTP 200 in `outputs/phase436-surface-intelligence/evidence/osm-data-audit/request-log.jsonl`. Aggiungere `--foundation-manifest=<cartella>/milan-citywide-expansion.source.json` in compilazione. Il manifesto riporta la copertura del campione. `--legacy-topology` ricostruisce i bit di direzione del precedente archivio Milan.

## Limiti e dipendenze per la fase 4.39

- Acquisire gli otto settori arricchiti in modo progressivo e verificare copertura, snapshot e riferimenti prima di qualunque aggiornamento alla base delle superfici. Conservare i settori storici per rollback e rieseguire il corpus dopo ogni aggiornamento della base.
- Applicare i join ferroviari sullo strato offline con tipo, quota o livello, geometria, data e fonte. La presenza di un asse ferroviario è distinta dalla presenza di rotaie in carreggiata. Corso Lodi e il materiale fisico di Piazzale Lodi richiedono ulteriori riscontri.
- Per la modalità ombra della 4.39 usare l’identità e la versione attese dal manifesto, conservare per revisione le evidenze con split, merge e ambiguità e misurare il costo della futura integrazione nel Worker. I provider possono usare altri snapshot OSM. Un confronto di svolte a scopo diagnostico richiede una corrispondenza temporale e topologica.
- Gli estratti OSM restano attribuiti a OpenStreetMap contributors e registrati con licenza ODbL-1.0. Questi artefatti contengono unicamente dati OSM. [Licenza ODbL](https://opendatacommons.org/licenses/odbl/1-0/)

## File modificati

| File | Modifica |
| --- | --- |
| `lib/road-intelligence-scoring.ts` | Evita una violazione confermata basata solo su un senso implicito. |
| `lib/road-intelligence-types.ts` | Tipizza la maschera di inferenza modale. |
| `lib/spatial-road-store.ts` | Legge la maschera dai flag delle tuple. |
| `scripts/osm/build-rome-pilot.mjs` | Seleziona la topologia storica per la ricostruzione dell’archivio. |
| `scripts/osm/compare-foundation-build.mjs` | Confronta le tuple, controlla pavimentazioni e copertura e misura output e gzip. |
| `scripts/osm/compile-compact-tiles.mjs` | Integra le fonti e la compilazione del sidecar, opzioni di staging e flag modali. |
| `scripts/osm/compile-osm-foundation.mjs` | Verifica le fonti e compila entità, collegamenti per tessera, geometrie ferroviarie e provenienza. |
| `scripts/osm/expand-milan-citywide.mjs` | Estrazione per settore da cache o con richiesta esplicita, controllo limiti e manifesto v3. |
| `scripts/osm/generate-tile-chunks.mjs` | Permette di generare le tessere di staging senza emettere un indice TypeScript nel checkout. |
| `scripts/osm/ingest.mjs` | Mantiene riproducibili gli archivi di ingestione storici, inclusa Roccella. |
| `scripts/osm/normalize.mjs` | Normalizza la direzione circolare e traccia l’inferenza per modalità. |
| `scripts/osm/osm-extraction.mjs` | Seleziona entità, geometria, tag e metadati ammessi. |
| `scripts/osm/segment-identity.mjs` | ID, controllo versione della tessera e confronto esplicito tra estratti. |
| `scripts/osm/turn-restrictions.mjs` | Valuta restrizioni via nodo o strada sulla topologia OSM disponibile. |
| `tests/osm-foundation.test.mjs` | Identità, Piazzale Lodi, rail, provenienza, join e determinismo. |
| `tests/phase424-surface-rules.test.mjs` | Verifica l’hash dell’archivio originario con la topologia storica. |
| `tests/phase438-osm-extraction.test.mjs` | Copertura, completezza, cache riproducibile e rate limit. |
| `tests/phase438-topology.test.mjs` | Sensi di marcia, accesso, codec e restrizioni su fixture e dati archiviati. |
| `outputs/prompt-phase438-osm-foundation.md` | Mandato, accettazione e condizioni di rilascio. |
| `outputs/phase438-osm-foundation-report.md` | Esiti e raccomandazione. |


## Revisione tecnica indipendente (15 novembre 2026)

Revisione del solo diff della 4.38 (base `3e31da9`), senza reimplementare nulla. Ripetuti in cartelle di scratch: baseline estratta da `3e31da9` e candidata con i soli file della 4.38, entrambe in LF come la CI Linux. Host: Windows, Node 26.13, senza WSL.

**Esito: il diff passa la revisione. GO per un prototipo 4.39 offline e limitato. NO-GO per l'attivazione in produzione.**

### Riverificato

| Controllo | Esito |
| --- | --- |
| `tsc --noEmit`, ESLint (`npm run lint`) | 0 errori |
| Test mirati (4 file) | 20/20 |
| Benchmark Milano, 264 casi, 817 richieste dall'archivio, 0 mancanti, 0 chiamate al provider | **264/264 payload identici** tra baseline e candidata con tessere staged (esclusi i soli campi cronometrici); 263×200 e 1×422 su entrambe |
| Compilazione deterministica | Due compilazioni in processi separati: 240 file con hash identici. JSON compatto `bd885ce3…9830` (baseline `996c0434…1cb4f1d`), come nel report |
| Direzione circolare | 51 vie, 192 tuple, 8 tessere; `modeAccess` invariato; nessun flag oltre il bit 4 nelle tessere già committate (Milano max 30, Roccella max 4), quindi la lettura è inerte finché le tessere non vengono sostituite |
| Sidecar | 102.028 segmenti tutti `exact` (0 clipped, 0 ambigui, 0 non agganciati); 661 vie tram con tutti i vertici; 220 restrizioni; hash raw verificati; nessun campo `user` o `uid` |
| Fonti storiche | `expand-milan-citywide.mjs --verify`: 8 settori, 56.702 vie, SHA-256 verificati |
| Roma | Nessun percorso di Roma nel diff. `lib/spatial-road-store.ts` è un file condiviso con Roma: la fusione a tre vie dello script di rilascio resta pulita su di esso (0 riferimenti a Roma, modifica 4.38 conservata). I blocchi di Roma del gestore dei percorsi si rimuovono ancora |
| Licenza e privacy | Solo dati OSM con attribuzione e `ODbL-1.0` nel manifesto; nessun dato committato (`data/` e `work/` non toccati nel commit); nessuna traccia GPS privata |

### Differenze rispetto al report e non riverificato

- **Suite completa:** su questo host la baseline dà 482 superati e **23 falliti su 512**; la candidata 498 superati e **23 falliti su 528** (7 saltati). L'insieme dei test falliti è **identico per nome**, e nei test che confrontano hash anche i valori «attuali» sono identici tra baseline e candidata. Il report indicava 13 falliti: non riprodotto qui. Dieci in più sono test di riproducibilità delle fonti e di Roccella (probabilmente Node 26 o zlib; **non attribuibili** alla 4.38, perché falliscono uguali sulla baseline). Il confronto autorevole è la CI Linux su Node 24, da fare dopo il push.
- **503 locale:** non riprodotto. Con la configurazione generata e con quella del pilota applicata, baseline e candidata rispondono 400 alle richieste incomplete tramite il Durable Object (anche 16 richieste parallele a un'istanza appena avviata: 16/16 400). Il 503 è la risposta esplicita `route_engine_unavailable` del Worker quando la chiamata al Durable Object lancia un errore (`worker/route-engine.ts`); l'esito osservato nel report è un'indisponibilità locale transitoria, presente anche sulla baseline, **non una regressione**.
- **Non rieseguiti:** E2E mobile (5/5), dry-run Wrangler con dimensioni del bundle (la copia solo-Milano non si prepara su Windows) e le misure di memoria/CPU. I numeri del report restano dichiarazioni del suo autore.
- **`npm test` su Windows:** non parte (`WRANGLER_LOG_PATH=…` nello script `build`). Build e test vanno lanciati separatamente su questo host.

### Idoneità del sidecar per lo strato Surface Intelligence (4.39)

Adatto per un join **offline** per tessera: riga `[stato, gruppo, indice-nodo, orientamento]` per ogni tupla, hash della tessera di base e `datasetVersion` da verificare prima del join (`openFoundationTile`), identità `osm-edge-v1` indipendente dall'orientamento, versione, timestamp e changeset per via e nodo, relazioni di svolta con membri, geometrie ferroviarie per tessera. Limiti da sapere:

1. **Provenienza parziale proprio dove serve.** Le vie dell'anello di Piazzale Lodi (`287070936` v17, `111768010` v19, `111767966` v17, `713165261` v6) stanno nel gruppo `legacy-citywide`: hanno versione e timestamp, **`changeset` nullo**, versioni dei nodi sconosciute, nessuna ferrovia né restrizione. Il gruppo pilota non ha `timestamp_osm_base` per le 11 fonti.
2. **Il gruppo `legacy-citywide` non ha ferrovie né restrizioni**: «zero» significa «non estratto», non «assenti». Il manifesto non lo dichiara con un campo esplicito per gruppo: lo strato 4.39 deve trattare i gruppi con `coverage: "legacy"` e `completeSectorCoverage: false` come **sconosciuti** per binari e svolte.
3. Il campione 4.36 (13 vie ferroviarie, 12 restrizioni, 4 con membri assenti) è un gruppo a sé: non è collegato ai segmenti, e l'accordo tra le sue versioni e quelle del gruppo storico non è verificato in automatico.
4. L'hash del gzip dipende dalla versione di zlib; il riferimento canonico è l'hash del contenuto non compresso (nei nomi dei file).
5. L'offset è valido solo per la compilazione corrente: ogni cambio di base impone di ricompilare e di rieseguire il confronto tra snapshot.

### Copertura: che cosa serve a 4.39 e che cosa può restare incompleto

| Serve per un prototipo 4.39 offline | Può restare incompleto, con flag espliciti |
| --- | --- |
| Gruppo pilota (11 fonti; 826 vie ferroviarie, 661 tram, 220 restrizioni) | Le zone coperte solo dagli otto settori storici (solo strade, senza ferrovie né restrizioni) |
| Supplemento del corridoio Lodi (campione 4.36, locale) per Corso Lodi, Piazzale Lodi, Via Friuli | Gli estratti arricchiti degli otto settori (il campione 4.36 copre solo il corridoio Lodi) |
| Flag di copertura per tessera derivati dal gruppo (pilota / storico / supplemento) | Snapshot e versioni dei nodi storici |

Per l'**attivazione in produzione**: serve almeno la copertura arricchita verificata dell'area in cui lo strato modifica qualcosa; fuori da essa lo strato deve essere inattivo e dichiararlo. Tutto il resto è NO-GO finché i settori non sono acquisiti, verificati con gli stessi snapshot del provider e ricompilati.

### Integrazione con la PR #16

Nessun file in comune (38 file della PR contro 20 della 4.38) e nessun cambio da incorporare. Ordine consigliato: 1) la PR #16 segue il suo percorso (anteprima, collaudo, pilota, unione); 2) la 4.38 si rebasa su `main` dopo l'unione e si rieseguono benchmark e test; 3) il prototipo 4.39 parte dalla 4.38 e non tocca il percorso di produzione; 4) le tessere con i bit di direzione circolare non sostituiscono quelle di produzione senza un nuovo benchmark sulla 4.37; 5) nessuna attivazione senza copertura verificata. Nota: una compilazione senza `--output-dir` riscrive le tessere runtime in `data/surfaces` con la topologia nuova. Per ora va usata solo con `--output-dir`.
