# Prompt operativo — Lastrico Beta Navigazione affidabile

## Mandato

Agisci come un team di prodotto e sviluppo autonomo con un solo release owner responsabile
dell’integrazione finale. Non limitarti a correggere sintomi isolati: analizza e migliora
l’intera pipeline di navigazione di Lastrico, dalla selezione degli indirizzi al routing,
dalla qualità dei dati sul pavé alla guida GPS, fino al rilascio e allo smoke test in
produzione.

L’obiettivo non è dichiarare una parità irrealistica con Google Maps o Apple Maps. L’obiettivo
è consegnare una beta credibile, fluida, verificabile e onesta per Milano, abbastanza buona
da essere provata sul campo prima di investire in infrastruttura commerciale o in un’app
iOS nativa.

La funzione differenziante resta invariata: Lastrico deve minimizzare l’esposizione a pavé,
sanpietrini e fondi sconnessi conosciuti. Quando evitare completamente questi tratti non è
possibile, l’app deve dirlo chiaramente, quantificare l’esposizione e cercare un’uscita
ragionevole dal tratto critico senza proporre deviazioni sproporzionate.

## Organizzazione del team

Lavora in parallelo quando le attività sono indipendenti:

- **Release owner:** mantiene scope, integra le modifiche, risolve conflitti, verifica le
  condizioni di rilascio e decide se fermare il deploy.
- **Routing e dati:** analizza provider, tempi, alternative, scoring del pavé, ricalcolo
  parziale, fallback e qualità dei dati.
- **UX e mobile:** verifica planner, selezione percorso, HUD, feedback di stato, accessibilità,
  animazioni GPS e comportamento della camera su viewport iPhone.
- **QA e performance:** definisce test, metriche, casi limite, regressioni, prove E2E e smoke
  test di produzione.
- **Ricerca mappe:** valuta soluzioni cartografiche aggiornate usando documentazione ufficiale,
  con costi, termini d’uso, chiavi, limiti e percorso di migrazione espliciti.

Gli audit possono essere delegati. Le modifiche al prodotto devono essere integrate dal
release owner, che preserva il lavoro esistente e non sovrascrive cambi non correlati.

## Ordine di lavoro obbligatorio

1. Leggi repository, test, configurazione di hosting e implementazione corrente.
2. Riproduci o localizza ogni problema prima di modificarlo.
3. Registra una baseline per tempi di routing, visibilità del percorso e comportamento GPS.
4. Individua cause radice, dipendenze esterne e limiti non risolvibili solo via codice.
5. Implementa prima le correzioni P0 e P1 definite sotto.
6. Aggiungi test mirati per ogni regressione corretta.
7. Esegui build, test automatici e verifica mobile E2E.
8. Pubblica una versione di produzione soltanto se tutte le condizioni di rilascio sono vere.
9. Esegui smoke test sull’URL di produzione; se fallisce, non dichiarare completata la beta.

## Scope P0 — necessario per una beta utilizzabile

### 1. Ricalcolo fuori percorso

- Rileva l’uscita dal percorso usando distanza dalla geometria, precisione GPS, letture
  consecutive e isteresi, evitando falsi positivi da rumore.
- Mostra il feedback “Fuori percorso” immediatamente e avvia il ricalcolo senza attese
  artificiali.
- Mantieni visibile e utilizzabile l’ultimo percorso durante il ricalcolo.
- Annulla le richieste superate e impedisci che risposte vecchie sovrascrivano la sessione.
- Nel ricalcolo GPS riusa destinazione, mezzo, livello di evitamento e percorso selezionato.
- Usa il dataset locale del pavé nel percorso rapido; gli aggiornamenti live non devono
  bloccare una manovra urgente.
- Riduci chiamate sequenziali e lavoro duplicato. Usa una richiesta dedicata alla navigazione,
  con budget più corto e un numero limitato di tentativi di deviazione.
- Se il nuovo punto è su un tratto critico, privilegia un’alternativa che ne riduca
  l’esposizione e consenta di uscirne presto, entro i limiti di deviazione scelti.
- Se la rete o il provider non risponde, conserva il percorso precedente e comunica il
  degrado senza simulare un successo.

Target beta misurabili:

- feedback visivo di ricalcolo entro 250 ms dalla decisione fuori percorso;
- una sola richiesta di routing attiva per sessione;
- nessuna attesa artificiale nel ricalcolo GPS;
- obiettivo p50 inferiore a 2,5 s e p95 inferiore a 5 s nelle prove controllate a Milano;
- un timeout o errore non deve cancellare il percorso già visualizzato.

I target di rete sono obiettivi di beta, non garanzie: se i provider pubblici non li
consentono, documenta la baseline e il piano di sostituzione senza falsificare i risultati.

### 2. Percorso selezionato sempre evidente

- Il percorso attivo deve essere disegnato sopra l’alternativa.
- Usa un colore di navigazione luminoso e accessibile, bordo di contrasto e spessore adeguato.
- L’alternativa non selezionata deve rimanere comprensibile ma chiaramente secondaria.
- Mantieni leggibilità con tema chiaro/scuro e agli zoom usati durante la guida.
- I tratti di pavé devono restare distinguibili senza nascondere la linea del percorso.
- Il cambio tra “Anti-pavé” e “Più rapido” deve aggiornare davvero sia stato sia mappa.

Acceptance criteria:

- il percorso selezionato non appare grigio scuro o nero;
- è distinguibile su strade, parchi, edifici e aree dense;
- cambio selezione, ricalcolo e cambio zoom non invertono la gerarchia visiva;
- test automatici verificano colore, spessore, opacità e ordine dei layer.

### 3. Mappe migliori e sostenibili

- Sostituisci la dipendenza diretta dalle tile raster standard di OpenStreetMap con una
  basemap vettoriale compatibile con MapLibre e adatta a una beta pubblica.
- Mantieni attribuzioni visibili e conformi alle licenze.
- Non aggiungere chiavi segrete nel client o nel repository.
- La basemap deve poter essere sostituita tramite configurazione senza riscrivere il routing.
- Documenta un percorso successivo verso un provider con SLA, analytics e stile personalizzato.
- Non confondere qualità della basemap, qualità del routing e qualità dei dati sul fondo
  stradale: sono tre sistemi distinti.

Per la beta senza investimento privilegia una soluzione vettoriale pubblica, documentata e
senza chiave; prima della crescita prepara il passaggio a un provider commerciale con chiave
protetta per origine o a infrastruttura self-hosted.

### 4. ETA, tempo e distanza residui

- Mostra minuti residui, distanza residua e ora stimata di arrivo nel HUD.
- Calcola il progresso sulla geometria del percorso attivo.
- Aggiorna i valori con ogni posizione accettata e dopo ogni ricalcolo.
- Evita valori negativi, salti irragionevoli e dati appartenenti alla risposta annullata.
- Indica chiaramente che il tempo beta non include traffico in tempo reale.

### 5. Movimento GPS e camera

- Filtra il rumore in base alla precisione della lettura.
- Applica smoothing della coordinata e interpolazione circolare dell’heading.
- Non spostare il marker per deriva stazionaria sotto una soglia adattiva.
- Anima marker e camera con durate coerenti con la frequenza GPS.
- Mantieni il veicolo nel viewport, con zoom e pitch da navigazione.
- Un gesto manuale disattiva temporaneamente il follow; “Ricentra” lo riattiva davvero.
- Rispetta `prefers-reduced-motion`.
- Non salvare una cronologia GPS.

## Scope P1 — necessario prima di invitare tester reali

### 6. Qualità pavé e sanpietrini

- Tratta il dataset locale come snapshot versionato e il live update come arricchimento
  opzionale, non come dipendenza bloccante.
- Mantieni separate le segnalazioni `pending` dai dati verificati.
- Rendi tracciabile la fonte di ogni tratto e la data dello snapshot.
- Riduci falsi match geometrici su strade parallele e incroci.
- Supporta copertura parziale: non dichiarare “senza pavé” se i dati sono incompleti.
- Prepara un flusso di moderazione e promozione da segnalazione a dato verificato.
- Costruisci un corpus di 10–15 tragitti reali con casi: evitabile, parzialmente evitabile,
  inevitabile, strada parallela, inizio sul pavé, uscita dal percorso e ritorno.

### 7. Navigazione e arrivo

- Istruzione principale leggibile con distanza alla manovra e nome strada.
- Feedback espliciti per aggancio GPS, segnale debole, fuori percorso, ricalcolo, offline e
  arrivo.
- Rilevamento arrivo tollerante alla precisione ma non prematuro.
- Guida vocale facoltativa e persistente, con testo visivo sempre disponibile.
- Avvio GPS e simulazione chiaramente distinti.
- Le mappe esterne restano fallback e dichiarano che ricalcoleranno il proprio percorso.

### 8. Performance e robustezza

- Evita ridisegni completi della mappa per ogni fix GPS.
- Non ricreare l’istanza MapLibre durante la sessione.
- Profila numero e durata delle richieste e crescita memoria in una simulazione lunga.
- Pulisci watch GPS, timer, wake lock, sintesi vocale e richieste abortite a fine navigazione.
- Mantieni UI utilizzabile offline con l’ultimo percorso disponibile, senza promettere un
  nuovo routing.

## Fuori scope per questa beta

- traffico live affidabile e ETA basato sul traffico;
- parità funzionale con Google Maps o Apple Maps;
- navigazione in background garantita su iOS PWA;
- CarPlay, entitlement Apple o app nativa;
- mappe offline o prefetch massivo di tile;
- copertura fuori Milano;
- approvazione automatica delle segnalazioni della comunità;
- SLA su Nominatim, Valhalla, OSRM, Overpass o altre istanze pubbliche;
- acquisto di servizi o pubblicazione di credenziali senza autorizzazione.

Non mascherare questi limiti con copy promozionale o controlli non funzionanti.

## Test automatici minimi

- unit test per accettazione GPS, deriva stazionaria, smoothing coordinate e heading;
- unit test per isteresi fuori percorso, cooldown e richiesta già in corso;
- test del progresso: distanza residua monotona su percorso regolare, ETA coerente e arrivo;
- test API per parametri non validi e modalità navigazione;
- test API che il ricalcolo usa il dataset locale e limita i tentativi live;
- test della deduplicazione delle alternative e selezione anti-pavé;
- test statici o di integrazione per stile vettoriale, attribuzione e gerarchia dei layer;
- test per aborto/race: l’ultima richiesta valida è l’unica che aggiorna lo stato;
- test dei tre mezzi senza usare silenziosamente un percorso auto per bici o moto.

## Verifica mobile E2E

Esegui almeno su viewport iPhone compatto e iPhone moderno:

1. carica la home e verifica che mappa, attribuzione e controlli siano leggibili;
2. cerca/seleziona partenza e destinazione;
3. calcola e passa tra rapido e anti-pavé, verificando la linea sulla mappa;
4. avvia la simulazione e verifica HUD, istruzioni, distanza, minuti, ETA e camera;
5. disattiva follow con un gesto e ripristinalo con “Ricentra”;
6. termina la navigazione e verifica pulizia dello stato;
7. simula offline/errore routing e verifica che il percorso precedente resti presente;
8. verifica touch target, safe area, assenza di overflow e testo essenziale non troncato.

Il GPS reale richiede una prova fisica separata. Una simulazione browser non può certificare
la qualità del sensore, la guida su strada o il comportamento iOS in background.

## Gate di rilascio

Pubblica soltanto se:

- build e suite automatica sono verdi;
- nessun errore di lint bloccante è stato introdotto;
- i flussi mobile P0 sono completabili;
- il percorso selezionato è visivamente dominante;
- tempo, distanza ed ETA sono sincronizzati;
- il ricalcolo preserva la rotta precedente in caso di errore;
- attribuzioni e limiti della beta sono visibili;
- nessuna chiave o dato sensibile è nel client o nel repository;
- l’archivio di deploy corrisponde esattamente al sorgente validato;
- il deploy di produzione termina con successo;
- lo smoke test di produzione conferma home, mappa, API principali e avvio simulazione.

Se un gate fallisce, correggi e ripeti. Se il blocco dipende da autorità nuova, acquisto,
credenziali, modifica irreversibile o decisione di prodotto con esiti materialmente diversi,
fermati e chiedi indicazioni precise.

## Output finali richiesti

- codice integrato della beta;
- test aggiunti o aggiornati;
- breve report con baseline, risultati e limiti non certificabili;
- matrice dei 10–15 tragitti reali da eseguire a Milano;
- raccomandazione mappe in due stadi: beta gratuita e infrastruttura post-validazione;
- URL della versione di produzione e risultato dello smoke test;
- elenco esplicito di ciò che serve validare sul campo prima di investire.
