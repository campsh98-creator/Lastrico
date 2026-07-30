# Prompt esecutivo — Estensione geografica Milano–Pioltello

## Mandato

Estendi Lastrico da Milano a una prima area beta contigua che comprenda almeno Milano,
Segrate/Vimodrone, Pioltello e i corridoi stradali che li collegano. Non introdurre una
seconda mappa: MapLibre e OpenFreeMap restano la basemap primaria, perché dispongono già di
copertura cartografica globale.

Il lavoro deve separare esplicitamente:

1. **mappa disponibile**: area visualizzabile dalla basemap;
2. **routing disponibile**: area in cui i provider possono creare e ricalcolare percorsi;
3. **copertura superficie**: area e quota del tragitto per cui Lastrico possiede evidenze
   sufficienti sul pavé.

L’obiettivo non è soltanto far accettare una coordinata di Pioltello. La beta deve consentire
ricerca, pianificazione, navigazione, ricalcolo e segnalazioni senza dichiarare sicuro o
asfaltato un tratto per il quale mancano dati.

## Precondizioni Git e organizzazione

- Parti dall’ultima baseline di stabilità accettata dal responsabile del progetto.
- Crea un branch dedicato, ad esempio `feat/metropolitan-coverage-pioltello`.
- Non modificare direttamente `main`.
- Non fare force push, merge o pull request automatica.
- Prima di implementare, aggiorna questo prompt con eventuali decisioni territoriali
  approvate.
- Mantieni commit piccoli: configurazione area, geocoding, dati, routing, GPS/segnalazioni,
  UI, test e documentazione.

### Squadra

- **Release owner:** integrazione, confini, gate e decisioni finali.
- **Geocoding/routing:** ricerca, provider, attraversamento dei confini e ricalcolo.
- **Dati superficie:** estrazione OSM, schema, tiling, confidenza e copertura.
- **UX:** messaggi, selezione indirizzo, indicatori persistenti e accessibilità.
- **QA/performance:** test di confine, percorsi reali, tracce GPS, mobile e produzione.

Gli audit indipendenti possono procedere in parallelo; un solo responsabile integra i file
condivisi.

## Baseline tecnica da non ignorare

- La basemap `https://tiles.openfreemap.org/styles/liberty` è già globale e non impone
  `maxBounds`.
- Il geocoder forza oggi Milano tramite viewbox, `bounded=1`, parametro `city=Milano` e
  filtro finale sul nome del comune.
- Routing, GPS e segnalazioni usano il rettangolo
  `west 9.04 / east 9.31 / south 45.38 / north 45.55`.
- Pioltello è appena oltre il limite orientale attuale.
- Il dataset incluso non copre tutta l’area dichiarata: il suo bbox reale è circa
  `9.1206–9.2390 / 45.4334–45.5106`.
- Dataset corrente: 1.530 way, 6.948 punti, 285 KB e circa 71 km di geometrie.
- Un campione Pioltello contiene circa 560 way di superficie rilevante e 3.799 punti.
- Un bbox metropolitano campione contiene circa 13.085 way, 8,6 volte il numero attuale.
- Overpass non può essere la fonte primaria nel flusso utente: il timeout applicativo è
  650 ms, mentre le misure reali sono state circa 4,6 s per Pioltello e 9 s per il solo
  conteggio metropolitano. Durante il ricalcolo GPS Overpass viene inoltre saltato.

## Principi non negoziabili

- `unknown` non equivale a pavé, ma non equivale neppure ad asfalto.
- `0 m di pavé noto` non significa `percorso senza pavé`.
- La confidenza dei segmenti abbinati non è la completezza della copertura del tragitto.
- Se la copertura è insufficiente, il percorso rapido resta disponibile; l’alternativa
  anti-pavé viene nascosta o qualificata come non confrontabile.
- Il GPS può continuare a guidare in un’area priva di dati superficie: non deve diventare
  falsamente `GPS debole`.
- Le app esterne restano fallback e non sostituiscono il percorso Lastrico selezionato.
- Niente cronologia GPS, indirizzi personali nei log o telemetria di coordinate.
- Non dipendere da endpoint pubblici Overpass durante la navigazione.

## Fase A — Configurazione geografica unica

Creare un modulo centrale, per esempio `lib/service-area.ts`, con:

- area ricercabile;
- area navigabile;
- area abilitata alle segnalazioni;
- poligoni o zone di copertura superficie;
- versione e label user-facing;
- `contains`, `intersectsRoute`, `coverageForGeometry`;
- casi di confine e margine numerico documentato.

Rinominare il tipo `MilanBounds` in `GeoBounds` o `ServiceBounds`.

Non duplicare coordinate limite in client e API. Preferire una zona/poligono versionato a
una lista fragile di nomi di comuni. Se per il pilot viene usato un bbox, documentare che è
una semplificazione e aggiungere casi appena dentro/fuori.

### Criteri di accettazione

- Geocoding, routing, GPS e segnalazioni derivano dalla stessa policy.
- Pioltello centro e il corridoio Pioltello–Milano risultano interni.
- Un punto appena fuori viene respinto con lo stesso risultato in tutti gli endpoint.
- Nessun valore `9.04`, `9.31`, `45.38`, `45.55` resta duplicato nella logica prodotto.

## Fase B — Ricerca indirizzi metropolitana

Modificare il geocoder affinché:

- non aggiunga automaticamente `Milano` a tutte le query;
- accetti Milano, Pioltello e gli altri comuni del pilot;
- mantenga `countrycodes=it`;
- usi un viewbox metropolitano come bias/limite del pilot;
- verifichi il risultato con coordinate e area di servizio;
- mostri sempre comune e CAP;
- deduplichi senza fondere omonimi in comuni diversi;
- propaghi abort, timeout e rate limit già esistenti.

Non implementare autocomplete aggressivo contrario alle condizioni di Nominatim.

### Test obbligatori

- `Pioltello`;
- `Via Roma 1, Pioltello`;
- `Via Roma` con risultati distinti a Milano e Pioltello;
- Pioltello come partenza e come destinazione;
- risultato italiano fuori area beta respinto con messaggio specifico;
- provider indisponibile distinto da indirizzo non trovato.

## Fase C — Dataset superficie esteso e riproducibile

La fonte primaria deve essere uno snapshot OSM generato offline, non una query Overpass nel
percorso utente.

Il manifest deve includere:

- `schemaVersion`;
- `datasetVersion`;
- `generatedAt` e timestamp/sequence OSM;
- area o poligono;
- query/filtri e versione del generatore;
- SHA-256;
- conteggi e validazioni;
- licenza ODbL e attribuzione;
- eventuale dimensione delle tile e halo.

Ogni feature deve conservare almeno:

- `osmType`, `osmId`;
- `name` nullable;
- `surface`, `highway` e tag di accesso utili;
- geometria;
- classe (`confirmed_pave`, `probable_pave`, `confirmed_not_pave`, `unknown`);
- confidenza separata;
- provenienza/versione.

### Strategia di scala

Misurare prima due alternative:

1. snapshot unico per il pilot Milano est–Pioltello;
2. tile territoriali, ad esempio celle da circa `0.05°`, con manifest, deduplica per ID OSM
   e halo di 20–30 metri.

Per l’area metropolitana scegliere in base a dimensione, memoria e tempo di cold start.
Per Lombardia/Italia usare tile o estratti PBF con aggiornamenti incrementali: vietato un
unico JSON nazionale monolitico.

L’indice spaziale dello scoring va riusato/precostruito per tile. Anche ricerca del punto di
deviazione e selezione dei segmenti visualizzati devono evitare scansioni globali.

### Validazioni dati

- coordinate finite e nell’area dichiarata;
- almeno due punti distinti;
- nessun ID duplicato dopo il merge delle tile;
- superfici normalizzate;
- segmenti nulli o salti anomali segnalati;
- sovrapposizioni al bordo tile deduplicate;
- conteggi e hash riproducibili;
- dataset pilot effettivamente presente su Pioltello e sul corridoio verso Milano.

## Fase D — Routing e copertura per percorso

Estendere l’API per accettare coordinate nel pilot e restituire per ogni candidato:

- distanza e durata;
- metri e percentuale di pavé noto;
- metri confermati e probabili;
- deviazione dal più rapido;
- `surfaceCoverage: "full" | "partial" | "none"`;
- percentuale o intervallo di copertura del tragitto;
- versione del dataset;
- confidenza dei match, separata dalla copertura;
- provider, profilo e tempi interni.

Definire una soglia documentata di copertura minima per confrontare due alternative. Se i
candidati attraversano zone con copertura diversa o insufficiente:

- non premiare automaticamente quello con più area sconosciuta;
- mantenere il percorso rapido;
- non mostrare un risparmio anti-pavé come certo;
- spiegare la limitazione nell’interfaccia.

La pianificazione e il ricalcolo GPS devono usare lo stesso snapshot. Overpass può servire
soltanto come aggiornamento non bloccante/cached o nella pipeline offline.

### Itinerari minimi

- Pioltello centro → Duomo;
- Duomo → Pioltello centro;
- Pioltello → Segrate;
- Pioltello → Pioltello;
- percorso che entra nella vecchia copertura centrale;
- percorso che esce dalla copertura superficie;
- partenza appena dentro e appena fuori l’area beta;
- auto, moto e bici, senza fallback auto silenzioso per gli altri mezzi.

## Fase E — GPS, navigazione e segnalazioni

- Accettare posizione corrente e GPS affidabile a Pioltello.
- Attraversare il vecchio limite est `9.31` senza stop, salto camera o falso segnale debole.
- Continuare ETA, istruzioni, progresso e ricalcolo anche con copertura pavé parziale.
- Conservare l’ultimo percorso durante timeout/offline.
- Accettare segnalazioni a Pioltello con moderazione invariata.
- Aggiungere filtro viewport/paginazione alle segnalazioni prima che l’aumento dei record
  renda insufficiente il limite globale di 200.
- Distinguere chiaramente: fuori area beta, GPS debole, provider indisponibile e dati
  superficie insufficienti.

## Fase F — Esperienza e comunicazione

Aggiornare branding e testi da “solo Milano” a una formulazione verificabile, per esempio
“Milano e area beta est”, senza promettere l’intera area metropolitana se non è coperta.

Aggiungere un indicatore persistente e accessibile nei risultati e prima dell’avvio GPS:

- `Dati pavé disponibili`;
- `Dati pavé parziali`;
- `Dati pavé non disponibili`.

Non affidarsi solo al colore. Il dettaglio deve spiegare:

- cosa resta disponibile;
- quale parte del confronto è limitata;
- data/versione dei dati;
- perché l’anti-pavé può non essere proposto.

Con copertura parziale usare “pavé noto rilevato”, mai “senza pavé”.

Rimuovere o contestualizzare landmark/demo di Milano quando un risultato reale è fuori dal
centro, evitando marker dimostrativi fuorvianti.

## Fase G — Test, prestazioni e rollout

### Test automatici

- configurazione unica e test dei bordi;
- geocoding multi-comune e omonimi;
- API routing nei due sensi;
- copertura `full/partial/none`;
- nessuna preferenza artificiale per zona sconosciuta;
- planner e reroute coerenti senza Overpass;
- posizione corrente/GPS Pioltello;
- segnalazione valida e fuori area;
- dataset/manifest/hash/tile invariants;
- abort, timeout, offline e provider indisponibile;
- nessun dato personale nei log.

### Verifica E2E

- desktop;
- 393×852;
- 360×640;
- 568×320;
- ricerca, scelta indirizzo, percorso, elenco svolte, simulazione e ricalcolo;
- traccia GPS simulata Pioltello–Milano;
- segnalazione di un tratto a Pioltello;
- attraversamento del vecchio confine senza perdita della rotta.

### Prestazioni

Misurare su almeno 20 itinerari:

- p50/p95 di geocoding e routing;
- generazione candidati e scoring;
- memoria/cold start;
- numero e peso delle tile caricate;
- timeout/error rate;
- dimensione build;
- aggiornamento MapLibre;
- sessione prolungata.

Confrontare con la baseline esistente e documentare regressioni.

### Rollout

1. test locali e dati pilot;
2. tester limitati Milano est–Pioltello;
3. correzione segnalazioni e falsi match;
4. estensione all’intera Città Metropolitana solo dopo i gate;
5. Lombardia tramite tile/PBF;
6. Italia soltanto con pipeline incrementale e monitoraggio.

## Documenti richiesti

- `docs/SERVICE_AREA.md`
- aggiornamento `docs/COBBLESTONE_DATA_MODEL.md`
- aggiornamento `docs/architecture.md`
- aggiornamento `docs/PERFORMANCE_REPORT.md`
- report di qualità del dataset pilot;
- matrice E2E e limiti noti.

## Gate di rilascio

- Pioltello ricercabile come partenza e destinazione;
- quattro itinerari pilot completati;
- GPS e ricalcolo funzionanti a Pioltello;
- planner e navigazione usano dati coerenti;
- copertura pavé sempre dichiarata;
- zero casi in cui dato assente viene mostrato come strada senza pavé;
- segnalazioni Pioltello accettate;
- lint, build e test verdi;
- E2E desktop/mobile e sessione lunga superati;
- p95 e memoria entro limiti documentati;
- dataset con provenienza, versione e hash;
- nessun segreto o dato personale;
- smoke test della versione distribuita;
- limiti reali dichiarati;
- nessun merge o pull request senza autorizzazione.

## Condizione di stop

Non distribuire l’espansione se il routing funziona ma la UI non distingue copertura
superficie assente/parziale, oppure se il ricalcolo GPS usa dati meno completi del percorso
iniziale senza comunicarlo. In tali casi mantenere la beta precedente e consegnare diagnosi,
misure e prossima azione concreta.
