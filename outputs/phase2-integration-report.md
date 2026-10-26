# Lastrico — integrazione Phase 2 e UI

26 ottobre 2026. Nessun commit, push o deploy. Conservate le modifiche precedenti di Codex e Antigravity; la UI è stata riconciliata dopo aver verificato che il lavoro concorrente fosse terminato.

**Esito: integrazione locale verificata, pronta per una Phase 3 circoscritta al pilota. Non è una validazione della copertura di tutta Milano o della navigazione GPS in produzione.**

## Correzioni verificate

- **Integrità OSM:** rimosse le 15 way costruite manualmente dalla pipeline e dall'archivio runtime. Quattro risposte genuine dell'API ufficiale OSM sono archiviate losslessly con URL, date, versioni e checksum. Ricostruzione offline e ingestione deterministiche. Le geometrie sono ritagliate sull'area dichiarata; i poligoni `area=yes` sono esclusi dal denominatore lineare. I campioni municipali non verificati sono soltanto fixture, esplicitamente etichettate.
- **Runtime:** `/api/routes` usa il nuovo indice e scorer anche in navigation. Profili, fallback, cancellazione, deduplicazione e budget Phase 1 restano coperti dai test. Gli aggiornamenti live includono anche superfici lisce e sconosciute, così possono sostituire evidenze obsolete. Il contratto mantiene i campi precedenti e aggiunge `surfaceTotalMeters`, `unpavedSurfaceMeters`, `surfaceSource`.
- **Matching:** il matcher comunale richiede prossimità, allineamento e sovrapposizione; rifiuta omonimi lontani, incroci, contatti agli estremi, geometrie invalide e direzioni ambigue. Accessi specifici per modalità, eccezioni bici e senso unico inverso sono rispettati. Il matcher non trasferisce evidenza dalla strada vietata più vicina a una parallela; livelli sovrapposti irrisolti restano sconosciuti.
- **UI:** il pannello di Antigravity conserva struttura e classi CSS, con un componente condiviso verificabile. Usa il denominatore dello scorer, comprende lo sterrato noto e distingue ciclabile non disponibile da zero rilevato. I dati demo sono sempre indicati come simulati. Il test API→React verifica i valori ricevuti per fast/safe, senza confondere distanza del provider e geometria classificata.
- **Difetti trovati durante l'integrazione:** sullo schermo mobile le schede si comprimevano tagliando ciclabili e avvertenza; ora il pannello scorre e le schede mantengono la propria altezza. L'archivio maggiore causava esaurimento memoria nel trasformatore del server di sviluppo: abilitato il percorso JSON SSR di Vite con `stringify: true, namedExports: false`, verificato sia in build sia in un avvio pulito del server.

## Copertura misurata

Area pilota: **9,18–9,20 E; 45,455–45,475 N**. Denominatore: **221,272 km di geometrie lineari OSM**, comprese strade, marciapiedi, percorsi pedonali/ciclabili e scale; non chilometri di sole strade percorribili in auto. 5.482 way, 18.246 segmenti; 65 poligoni esclusi.

| Categoria | Lunghezza | Quota |
| --- | --- | --- |
| Pavé confermato o probabile | 58,583 km | 26,47% |
| Asfalto/calcestruzzo classificato liscio | 86,342 km | 39,02% |
| Non asfaltato noto | 6,260 km | 2,83% |
| Sconosciuto/non classificabile | 70,088 km | 31,68% |

**Classificazione disponibile: 68,32%.** Smoothness esplicita: 9,03%; evidenza ciclabile: 3,16%. Queste percentuali descrivono l'estratto, non la completezza di OSM rispetto alla realtà né la copertura cittadina. La regolarità del fondo non viene dedotta dal materiale.

Dettagli e riproduzione: [report qualità](/Users/campsh/Documents/Codex/Lastrico-App-Anti-Pave/outputs/road-intelligence-quality-report.md), [manifest delle fonti](/Users/campsh/Documents/Codex/Lastrico-App-Anti-Pave/data/sources/milan-pilot-osm.source.json).

## Verifiche finali

- `npm test`: build completata e **158/158 test passati**.
- `npm run lint`, `npx tsc --noEmit`, `git diff --check`: passati.
- Prova API→UI su Via Santa Sofia, way OSM `442754378`: **33 m lisci, 33 m ciclabili, 0 m sconosciuti, copertura 100%**, sia planner sia navigation; provider controllato e archivio autentico.
- Smoke HTTP sul server locale con **Valhalla reale**, profilo bicycle/navigation: HTTP **200**, medesimi 33 m/33 m/0 m. Nessun fallback auto.
- Prova nel browser con routing reale e cambio fast/safe: valori e percentuali si aggiornano. A 393×852 e 320×568 il contenuto della scheda, inclusa l'avvertenza, rimane integro; lo scorrimento rende raggiungibili i controlli successivi. [Vista anti-pavé](/Users/campsh/Documents/Codex/Lastrico-App-Anti-Pave/outputs/phase2-integration/mobile-safe.png) · [Vista rapido](/Users/campsh/Documents/Codex/Lastrico-App-Anti-Pave/outputs/phase2-integration/mobile-fast.png).

## Limiti ancora aperti

L'archivio autentico copre soltanto il pilota centrale; fuori dall'area serve evidenza live o la superficie resta sconosciuta. Nella prova reale l'alternativa anti-pavé aveva **92,6% sconosciuto**: la UI lo mostra; la riduzione riguarda l'esposizione nota, non una sicurezza certificata. La politica di selezione Phase 1 è stata conservata.

L'arricchimento comunale richiede ancora una fonte autentica e la verifica della convenzione concorde/discorde rispetto alla geometria. Restrizioni condizionali irrisolte e tratti bici a mano restano conservativamente sconosciuti nel matching. Le risposte OSM sono state acquisite in sequenza, non come snapshot atomico. Non sono state svolte prove GPS su strada né verifiche/deploy in produzione.
