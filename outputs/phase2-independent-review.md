# Revisione indipendente — Lastrico

26 ottobre 2026 · commit `5ae75b7` e `99a86e9` · modifiche locali non committate.

**Esito: Phase 3 non pronta.** La Phase 1 supera i controlli eseguiti su budget, cancellazione, profili e fallback. La Phase 2 contiene componenti ancora scollegati dal prodotto e dati che non giustificano le metriche di copertura dichiarate. I problemi seguenti sono riproducibili sul codice e sui file dei commit; le prove sintetiche sono indicate separatamente.

## Problemi verificati, in ordine di gravità

### P1 — Dataset non rappresentativo e attribuzione OSM non supportata

[build-representative-network.mjs](/Users/campsh/Documents/Codex/Lastrico-App-Anti-Pave/scripts/osm/build-representative-network.mjs:22) aggiunge manualmente 15 way, ID `20000001–20000015`, al vecchio archivio di 1.530 way selezionate per fondo irregolare. Geometrie e tag sono scritti nel sorgente. [normalize.mjs](/Users/campsh/Documents/Codex/Lastrico-App-Anti-Pave/scripts/osm/normalize.mjs:60) attribuisce anche queste osservazioni a `osm:way:*`, con autorità OSM e confidenza fino a 1; l'ingestione applica indistintamente la data dello snapshot precedente.

Verifica sui file committati: **5.453 segmenti, 81.179 m**; i 35 segmenti aggiunti manualmente rappresentano 10.237 m e contengono **tutti gli 8.183 m classificati lisci e tutti i 9.198 m con smoothness nota**. Le way legacy senza `highway` diventano `residential` per default. Il **98,72%** misura la classificazione interna di questo insieme preselezionato, non la copertura della rete milanese. Il checksum corrisponde, ma non certifica la provenienza.

**Soluzione:** separare le fixture dai dati utilizzabili dal prodotto; acquisire un estratto OSM riproducibile dell'intera rete nell'area, inclusi i tratti senza tag di superficie, conservando query, risposta originale, data e checksum della fonte. Non inferire la classe stradale quando manca. Calcolare separatamente copertura della rete e completezza degli attributi. È un blocco per qualsiasi demo che presenti queste percentuali come qualità reale dei dati.

### P1 — Le nuove metriche non raggiungono l'API

[route.ts](/Users/campsh/Documents/Codex/Lastrico-App-Anti-Pave/app/api/routes/route.ts:2) importa ancora `milan-pave-central.json`; a riga 436 usa `scoreSurfaceExposure`, non il nuovo scorer. I campi `smoothSurfaceMeters` e `cyclewayMeters` vengono valorizzati con `?? 0` su proprietà mai prodotte dal motore corrente.

Prova del vero handler GET, con solo il provider simulato: sul segmento committato `20000010`, coordinate `[[9.212,45.497],[9.216,45.499]]`, modalità bicycle e navigation=1, HTTP 200 restituisce **0 m lisci, 0 m ciclabili, 382 m sconosciuti, copertura 0%**. Lo scorer Phase 2 sul medesimo record restituisce 382 m lisci/ciclabili e copertura 100%. Il record è un campione costruito manualmente: la prova dimostra il collegamento mancante, non la verità del fondo stradale.

**Soluzione:** dopo la correzione dei dati e del matcher, integrare indice e scorer nell'handler con una semantica esplicita per attributi non disponibili. Servono test API con valori positivi verificati, planner e navigation, oltre ai controlli sui tipi. I nuovi campi sono compatibili strutturalmente, ma oggi gli zeri possono essere letti erroneamente come misurazioni. Non è stato collegato al runtime il dataset non validato.

### P1 — Il matcher comunale non verifica la geometria

[milan-cycling-adapter.ts](/Users/campsh/Documents/Codex/Lastrico-App-Anti-Pave/lib/adapters/milan-cycling-adapter.ts:159) confronta i nomi e conta i candidati: non usa distanza, bearing o direzione. Una strada a Milano e una ciclabile omonima con coordinate `[[12,43],[12,44]]` producono `matched: true`, confidenza 0,85, anche con soglia 7 m. Inoltre una tipologia sconosciuta diventa `sede_propria` e quindi una struttura ciclabile presente.

**Soluzione:** implementare prossimità, allineamento e sovrapposizione geometrica, direzione e gestione delle ambiguità; conservare come sconosciute le tipologie non riconosciute. Verificare la provenienza dei cinque record del file etichettato “official”, senza considerarli una validazione rappresentativa. Il problema è nel componente Phase 2, attualmente non collegato all'API.

### P2 — Accesso, direzione e identità non sufficienti per il nuovo matching

[road-intelligence-scoring.ts](/Users/campsh/Documents/Codex/Lastrico-App-Anti-Pave/lib/road-intelligence-scoring.ts:215) ignora `isMotorAllowed` e `isBicycleAllowed`: il record ciclabile `20000010`, con accesso motore falso, assegna comunque **382 m lisci a una richiesta car**. Il test esistente ammette una footway in bicicletta pur dichiarando `isBicycleAllowed: false`. [normalize.mjs](/Users/campsh/Documents/Codex/Lastrico-App-Anti-Pave/scripts/osm/normalize.mjs:84) riduce la direzione a un solo booleano: nella prova sintetica `oneway=yes` con `oneway:bicycle=no`, il percorso inverso in bicicletta perde tutti i 156 m di superficie nota. Non prova che il provider generi itinerari illegali: prova che il confronto con i dati stradali è scorretto.

L'identità dipende dalla sola geometria bidimensionale: due record sintetici con identiche coordinate, ma way differenti e `bridge=yes, layer=1` su uno solo, ricevono entrambi hash `ac7ec4128af3219a`. L'ingestione li conserva senza risolvere il conflitto. I **5.453 hash distinti del dataset attuale** non dimostrano che siano distinguibili strade sovrapposte su livelli diversi o osservazioni contrastanti.

**Soluzione:** definire accesso e direzione per modalità, includendo i tratti bici a mano; distinguere identità geometrica, livello/topologia e provenienza delle osservazioni. Aggiungere prove di strade parallele, sovrapposte, restrizioni ed eccezioni prima dell'integrazione. Nessuna modifica estesa a schema o regole di accesso in questa review.

## Correzioni locali e regressioni

- **Confidenza fuori intervallo:** il segmento OSM `286609083` lungo 1,36 m restituiva 1,36. Ora il rapporto usa distanze non arrotondate ed è limitato a [0,1].
- **Ambiguità dipendente dall'ordine:** sul segmento `012b1f487a740e5d` invertire il dataset cambiava il conteggio da 1 a 0. Ora il confronto avviene rispetto al candidato finale più vicino.
- **Fondo noto contato come sconosciuto:** il campione compacted `20000014` restituiva 166 m sconosciuti. Aggiunto `unpavedMeters` alla sola API dello scorer Phase 2 e incluso nella copertura; non viene classificato come liscio o pavé. La penalità per sterrato resta una decisione da definire, non è stata aggiunta implicitamente.
- **Crash di validazione:** `[null, [9.19,45.46]]` causava un'eccezione invece del rifiuto del record. Ora i vertici invalidi vengono segnalati senza interrompere l'elaborazione.
- **Test che modificava il repository:** il report qualità ora accetta una destinazione opzionale; il test usa una directory temporanea e verifica l'aritmetica, senza imporre una soglia artificiale >90%. Ripristinato il solo report riscritto dalla suite iniziale.

I cinque nuovi test di regressione sono falliti prima delle correzioni e passano dopo. Sono in [road-intelligence-regressions.test.mjs](/Users/campsh/Documents/Codex/Lastrico-App-Anti-Pave/tests/road-intelligence-regressions.test.mjs) e [osm-validation.test.mjs](/Users/campsh/Documents/Codex/Lastrico-App-Anti-Pave/tests/osm-validation.test.mjs).

## Verifiche e limiti

| Controllo | Esito |
| --- | --- |
| Suite iniziale | 125/125 passati; riscriveva il report qualità |
| `npm test` finale, inclusa build | **130/130 passati** |
| `npm run lint` | Passato |
| `npx tsc --noEmit` | Passato |
| `git diff --check` | Passato |
| Integrità file dataset | Checksum valido, 5.453 hash unici |
| Handler API contro dati committati | Verificato il mancato uso delle metriche Phase 2 |

La build segnala la dimensione del bundle client; non è un errore introdotto dalle correzioni. Non sono emerse ulteriori regressioni verificate della Phase 1 nei controlli su budget massimo, deduplicazione, cancellazione in coda e fallback solo auto. Non sono stati eseguiti test mobili interattivi, chiamate reali ai provider o smoke test in produzione: la disponibilità dei servizi pubblici e le prestazioni su dispositivo restano da verificare. Il benchmark sintetico non sostituisce questi controlli.

**Condizioni per Phase 3:** provenienza e campionamento dei dati verificabili; matching spaziale e modale corretto; integrazione API dimostrata con percorsi reali e casi negativi; verifica mobile della selezione e navigazione del percorso. Le piccole correzioni non rimuovono questi blocchi. Nessun commit, push o deploy eseguito.
