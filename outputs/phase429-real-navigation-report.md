# Fase 4.29 — Navigazione reale a Milano: GPS, movimento fluido e pavé non segnalato

8 novembre 2026. Prompt di esecuzione: `outputs/prompt-phase429-real-navigation-gps-pave.md`.

Tutto è stato fatto in locale: niente commit, push, merge o deploy. Il pilota online resta `03a6776e`. I commit di Roma e di Milano sono intatti.

Le misure "prima/dopo" vengono da tracce GPS **sintetiche** e da un browser emulato. **Non sono misure su iPhone.**

## 1. Cause dei tre difetti

### 1.1 La freccia avanza a scatti
- **Nessuna animazione.** `app/page.tsx` spostava il segnaposto con `marker.setLngLat(posizione)` una volta per ogni fix GPS. Su iPhone è circa una volta al secondo, e tra un fix e l'altro non c'era nulla.
- **Movimenti trattenuti.** `processGpsFix` (`lib/navigation-fix-processor.ts`) teneva ferma la freccia finché lo spostamento non superava 4–15 m (`markerMovementThreshold`, in funzione della precisione), poi rilasciava tutto in un colpo.
- **Camera e freccia fuori sincronia.** La camera scorreva in 650 ms con accelerazione ease-in-out, mentre la freccia si teletrasportava.
- **Rotazione a scatti.** Anche la rotazione cambiava di colpo.
- **Posizione accanto alla strada.** Il punto disegnato era il GPS filtrato, mai il punto abbinato alla strada: l'errore laterale si vedeva come salti di lato.

### 1.2 GPS lento e impreciso all'avvio
- **Nessuno stato "approssimativo".** Ogni fix con precisione fino a ±120 m veniva accettato come "GPS LIVE" fin dalla prima lettura.
- **La media si portava dietro le posizioni sbagliate.** `smoothGpsCoordinate` pesava il nuovo fix solo in base alla propria precisione. Un fix preciso che arrivava dopo uno impreciso ereditava il 28–78% della posizione sbagliata.
- **Controllo fuori percorso troppo presto.** Partiva dal secondo fix, con una soglia che cresceva con la precisione dichiarata.
- **I grattacieli di Porta Nuova.** Riflettono il segnale: un fix può dichiarare ±20 m ed essere a 80 m di distanza. Il primo punto poteva anche ancorare l'avanzamento sulla parte sbagliata del percorso.
- **Riprodotto sul banco sintetico:** con una partenza riflessa su una via parallela, la logica precedente fa **3 ricalcoli sbagliati** e l'errore di posizione arriva a 160 m.
- **Un ricalcolo all'avvio può cambiare il percorso.** Se dal nuovo punto non esiste un'alternativa distinta, l'app passa al percorso più rapido (codice `selectRouteKind`). È stato verificato nel codice, ma non è confermato che sia successo nel test.

### 1.3 Circa 1 km di pavé non segnalato
- **E. Avviso durante la navigazione (certo).** L'app **non aveva alcun avviso di pavé**: la voce leggeva solo le manovre e il pavé compariva solo come tratteggio rosso sulla mappa. Quindi nessun tratto, nemmeno corto, poteva essere annunciato. I tratti "rilevati" più avanti erano quelli disegnati in rosso.
- **A. Dato di origine (il più probabile, non confermato).** Vedi la sezione 2: sul tratto candidato OpenStreetMap descrive la carreggiata come asfalto.
- **C. Abbinamento percorso-strada (escluso).** Sui percorsi ricostruiti la geometria coincide con le strade OSM (distanza massima 0,0–0,5 m) e i tratti in pavé noti risultano tutti classificati correttamente.
- **B. Classificazione (esclusa).** Nessun tag `sett`/`cobblestone` è stato perso nella compilazione.
- **F/G. Avanzamento GPS (possibile).** Un ricalcolo all'avvio, come al punto 1.2, può aver portato sul percorso più rapido. Senza la traccia resta un'ipotesi.

## 2. Dove può essere il tratto mancante

Ho ricostruito Piazza Gae Aulenti → Largo Promessi Sposi sul pilota pubblicato, con gli stessi dati e lo stesso servizio di routing del test. Ho usato la partenza esatta che l'app assegna a "Piazza Gae Aulenti" (9.19022, 45.48348) e tutte e tre le modalità.

Ho confrontato l'archivio con l'OpenStreetMap attuale (Overpass, 8 novembre 2026) su tutta l'area Garibaldi–Brera–Castello, per 14.072 strade:
- **nessun fondo è cambiato** dopo il nostro archivio;
- tutte le strade con almeno 400 m di pietra (via Manzoni, via Solferino, via San Marco, via Castelfidardo, via Turati, via Ariosto, corso Magenta…) sono già classificate come pavé.

**Candidati, in ordine di probabilità:**

| # | Corridoio | Quando | Cosa dicono i dati | Perché è candidato |
|---|---|---|---|---|
| 1 | **Via Legnano → Viale Gadio → Foro Buonaparte** (percorso più rapido in auto/moto: Bastioni di Porta Nuova → Viale Crispi → Bastioni di Porta Volta → Piazzale Biancamano → via Legnano) | minuti 5–10 | La carreggiata usata è `asphalt` per 434 + 84 + 609 m. Pavé noto solo per 105 m (Biancamano) e 201 m (Foro Buonaparte). **1.029 m di percorso corrono lungo i binari del tram**, che in OSM non hanno alcun tag `embedded_rails` né di superficie. Foro Buonaparte ha carreggiate separate: 13 sono in `sett`, ma il percorso usa quelle in asfalto. | Lunghezza (~1 km) e tempo (primi 10 minuti) coincidono con quanto riferito. A Milano le corsie del tram sono spesso in pietra anche quando la strada è segnata come asfalto. |
| 2 | **Bastioni di Porta Nuova → Piazzale Principessa Clotilde → Viale Monte Santo → Piazza della Repubblica** (percorso anti-pavé in auto/moto, quello predefinito) | minuti 2–4,5 | 153 + 68 m di `sett` riconosciuti; il resto è `asphalt`; nessun binario per 3,4 km | È il percorso che l'app mostra per primo. Un chilometro continuo di pietra qui contraddirebbe OSM. |
| 3 | **Via San Marco → piste di Brera → Via Pontaccio → Foro Buonaparte** (bici) | minuti 2,5–10 | Circa 830 m di `sett`, tutti riconosciuti e disegnati in rosso | Poco probabile come tratto "mancato", perché la mappa lo mostrava. |

**La più piccola informazione che serve:** la modalità usata e se il percorso è passato **accanto all'Arena e al Castello Sforzesco** (via Legnano / Foro Buonaparte) oppure **da Piazza della Repubblica**. Meglio ancora la traccia GPS del prossimo test (sezione 8).

**Nessuna strada è stata riclassificata.** Il ricordo di un tratto lungo è un indizio forte, ma non basta a cambiare la classificazione di un'intera via. Se il punto 1 verrà confermato, la correzione giusta è una regola verificata per le corsie del tram oppure una correzione in OSM, non un ritocco manuale dei nostri dati.

## 3. Correzioni fatte

| Area | File |
|---|---|
| GPS: fusione pesata sulla precisione, stati onesti, avvio protetto, posizione sulla strada | `lib/navigation-fix-processor.ts`, `lib/route-progress.ts` (`pointAtProgress`) |
| Movimento fluido di freccia e camera | `lib/marker-motion.ts`, `app/page.tsx` |
| Tratti di pavé dal server, senza CPU aggiuntiva | `lib/road-intelligence-scoring.ts`, `lib/rough-sections.ts`, `app/api/routes/route.ts` (`roughSections`) |
| Avvisi di pavé: pannello di navigazione e voce | `lib/pave-warnings.ts`, `app/page.tsx` |

## 4. GPS e movimento della freccia

**Avvio e qualità del segnale**
- **Fusione pesata sulla precisione, con previsione di velocità** (un passo di filtro di Kalman). Un fix preciso sostituisce quasi del tutto una stima imprecisa, e la freccia non resta indietro mentre ci si muove. Se il telefono dice di essere fermo, la previsione si ferma (niente deriva al semaforo).
- **Stati dichiarati sullo schermo:**
  - "RICERCA GPS" (già esistente);
  - "**GPS APPROSSIMATIVO** · ±90 m · attendo un segnale più preciso";
  - "GPS LIVE";
  - "Segnale GPS assente" (già esistente);
  - "**GPS ripreso**", per 4 secondi, dopo un silenzio di almeno 8 s.
- **Avvio protetto.** Nessun ricalcolo finché non arrivano 3 fix precisi (±30 m in auto e moto, ±25 m in bici) che concordano con il percorso, entro la loro precisione dichiarata. L'attesa ha un limite: dopo 20 s il ricalcolo torna normale, quindi chi parte davvero fuori percorso viene comunque ricalcolato. Prima di allora i fix non ancorano l'avanzamento.
- **Nessuna precisione inventata.** La freccia viene disegnata sulla strada solo con un fix preciso entro 10–25 m dalla strada. Con un fix approssimativo resta dove dice il GPS, con il cerchio di incertezza. Una deviazione isolata resta sulla strada, una deviazione persistente (via parallela) no.
- **Direzione stabile.** Quando la freccia è sulla strada segue la direzione della strada ed è ferma quando il veicolo è fermo.

**Animazione**
- **La freccia scorre** dal punto disegnato al nuovo punto nel tempo in cui arrivano davvero i fix (0,25–1,2 s), lungo la strada nelle curve. Non va mai oltre l'ultimo fix: se il GPS si ferma, si ferma anche lei. Un salto di 90 m o più viene mostrato subito, senza scivolare sulla mappa.
- **Camera in sincronia.** La camera si muove in modo lineare per la stessa durata, quindi la freccia resta ferma sullo schermo mentre la mappa scorre.
- **Rotazione** fluida e sempre dal lato più corto.
- **Risparmio di batteria.** L'animazione gira solo mentre la freccia si muove. È disattivata se il telefono chiede di ridurre i movimenti.

## 5. Classificazione e avvisi del pavé

- **Tratti dal server.** Il server restituisce per ogni percorso i tratti di pavé (`roughSections`) con inizio e fine lungo il percorso e i metri confermati e probabili. Le vie adiacenti e i vuoti di 25 m o meno agli incroci si fondono: un chilometro di pietra diviso in 20 vie OSM diventa un solo tratto. Sono calcolati nello stesso passaggio di analisi, quindi non servono nuove chiamate né CPU in più.
- **Pannello di navigazione:**
  - «Pavé tra 470 m · per 600 m»;
  - «Su pavé · ancora 350 m»;
  - «Pavé probabile…» per i masselli.
- **Voce:**
  - un solo annuncio per tratto, con anticipo di 250 m in auto e moto e di 100 m in bici: «Tra 250 metri, pavé per circa 600 metri.»;
  - se il punto di preavviso viene saltato (salto GPS, ricalcolo vicino al tratto o dentro), l'annuncio arriva all'ingresso: «Pavé ora, per circa 850 metri.»;
  - lo stesso tratto non viene annunciato due volte, nemmeno dopo un ricalcolo, perché è riconosciuto dalla sua posizione sul terreno;
  - niente voce per i tratti sotto gli 80 m in auto, 60 m in moto e 40 m in bici, che restano nel pannello;
  - niente voce con GPS non affidabile: l'annuncio arriva quando il fix torna buono;
  - l'avviso si mette in coda e non interrompe mai un'indicazione di manovra.
- **Confermato e probabile restano distinti.** Dove non ci sono dati sul fondo non compare alcun avviso.

## 6. Risultati prima e dopo

**Banco GPS sintetico** (`scripts/navigation-replay-bench.mjs`, percorso reale Gae Aulenti → Promessi Sposi; file `outputs/phase429/bench-before.json` e `bench-after.json`):

| Scenario | Misura | Prima | Dopo |
|---|---|---:|---:|
| Partenza riflessa su una via parallela | Ricalcoli sbagliati | **3** | **0** |
| | Errore direzione p95 | 24° | 20° |
| Partenza nel "canyon" urbano | Errore direzione p95 | 42° | 38° |
| | Salti della freccia trattenuti | 6 | 0 |
| Via parallela | Errore medio di posizione | 13,0 m | 9,5 m |
| | Errore direzione p95 | 10° | 6° |
| GPS assente 14 s e ripresa | Errore medio | 7,6 m | 4,9 m |
| | Errore direzione p95 | 46° | 11° |
| Fix fuori ordine e duplicati | Errore medio | 5,3 m | 2,3 m |
| | Errore direzione p95 | 56° | 16° |
| Fermo al semaforo 30 s | Errore direzione p95 | 53° | 7° |
| | Errore massimo | 11,5 m | 7,7 m |
| Fix ogni 3 s | Errore medio | 7,8 m | 3,1 m |
| Fix ogni 0,5 s | Freccia ferma mentre si muove | 16 | 2 |
| | Errore direzione p95 | 27° | 8° |

All'avvio nel "canyon" il tempo per scendere sotto 15 m di errore non cambia (21 s): dipende dal segnale. Durante quell'attesa ora l'app lo dichiara come "GPS APPROSSIMATIVO".

**Freccia nel browser** (stesso scenario, GPS simulato a 1 Hz e 29 km/h; file `outputs/phase429/marker-frames-before-after.json`):

| | Pilota pubblicato `03a6776e` | Nuova versione |
|---|---:|---:|
| Fotogrammi in cui la freccia si muove | 33 su 334 | 261 su 349 |
| Passo massimo tra due fotogrammi | 21,6 m | 1,8 m |
| Passi di 3 m o più | 11 | 0 |

**Avvisi di pavé:** su un tratto di 600 m, prima nessun avviso. Ora un solo annuncio, 250 m prima, più il pannello «Pavé tra 470 m · per 600 m» → «Su pavé · ancora 350 m». In 10 test unitari ci sono 0 duplicati e 0 tratti mancati, compresi:
- salto del preavviso;
- GPS intermittente;
- ricalcolo prima del tratto e dentro il tratto;
- tratti contigui;
- dati assenti;
- tutte e tre le modalità.

**Regressioni:**
- TypeScript ed ESLint senza errori.
- **405 test su 405**, con 29 nuovi.
- Build e dry-run riusciti: 26,6 MiB, Roma inclusa perché è nel branch locale.
- Prova mobile su Worker locale: **74 scenari su 74**, cioè i 71 esistenti (ricerca indirizzi della Fase 4.22, scelta del percorso, stati GPS, voce, ricalcolo, arrivo, impaginazione in tema chiaro e scuro) più 3 nuovi: freccia fluida, avvio approssimativo senza ricalcolo, avviso di pavé.
  - Lo scenario della freccia misura il passo rispetto al tempo tra un fotogramma e l'altro. Quando il browser headless rallenta (circa 12 fotogrammi al secondo con più scenari in fila), il passo grezzo può arrivare a 5–8 m in un solo fotogramma. Rapportato a 1/60 di secondo resta sotto 0,8 m. Una prima versione dello scenario che usava il passo grezzo è fallita una volta per questo motivo.
- Benchmark di Milano (264 casi): **percorsi e metriche identici** al rilascio precedente, con tempo di calcolo non superiore.

Due modifiche ai test esistenti, motivate:
1. Le decisioni registrate in una traccia sintetica sono state aggiornate alla nuova fusione. Le garanzie verificate restano invariate: nessun ricalcolo, nessuna istruzione saltata, avanzamento massimo 16,5 m.
2. Un test che cercava nel codice il nome della vecchia funzione di smussatura ora cerca la nuova.

## 7. Rischi residui e limiti dell'iPhone

- **Limite di calcolo di Cloudflare sul pilota.** Oggi 3 richieste di percorso su 6 da Gae Aulenti hanno restituito l'errore 1102, e per qualche secondo anche la pagina iniziale ha risposto 503. Ieri sera Cloudflare aveva interrotto una richiesta a soli 96 ms di CPU. Questo indica un piano con limite di CPU per richiesta molto basso (probabilmente quello gratuito).
  - Non è un effetto di questa fase. Sul banco il tempo di calcolo non è aumentato.
  - Può però far fallire un calcolo o un ricalcolo per strada.
  - **Decisione tua:** passare al piano a pagamento dei Workers oppure dedicare una fase alla riduzione della CPU.
- **Safari su iPhone in background.** Con lo schermo bloccato o l'app in secondo piano Safari sospende il GPS. Al ritorno l'app riaggancia la posizione (già esistente) e ora mostra "GPS ripreso". Non può però navigare a schermo spento. Il blocco dello schermo resta richiesto all'avvio, ma dipende da iOS.
- **Canyon urbani.** Le riflessioni possono ingannare anche la precisione dichiarata. Ora non provocano ricalcoli all'avvio, ma la posizione approssimativa resta approssimativa: è onesto, non è un errore.
- **Pavé nelle corsie del tram.** Non è nei dati (sezione 2). Se è il tratto riferito, oggi l'app non lo annuncia.
- **Annuncio a piedi in bici.** L'indicazione di scendere e spingere la bici è ancora nel pannello, non nella voce.
- **Tutto è sintetico.** Nessun risultato di questa fase viene da un iPhone fisico.

## 8. Procedura per la prossima prova su strada

1. **Prima di partire:** aprire il pilota dall'icona sulla schermata Home, poi "Dettagli tecnici e registrazione GPS" → attivare «**Registra traccia GPS per il collaudo**». La traccia resta sul telefono.
2. **Stesso viaggio:** Piazza Gae Aulenti → Largo Promessi Sposi. Annotare la **modalità** (auto, moto o bici) e se è stato scelto **Anti-pavé** o **Più rapido**.
3. **Voce attiva**, interruttore silenzioso disattivato, schermo sempre acceso, telefono su un supporto. Le prove le fa un passeggero o si fanno da fermi.
4. **Da osservare:**
   - quanto tempo passa prima che "GPS APPROSSIMATIVO" diventi "GPS LIVE";
   - se la freccia scorre senza scatti e resta sulla strada;
   - se compare «Pavé tra … · per …» e si sente l'annuncio prima di ogni tratto in pietra;
   - se ci sono ricalcoli nei primi minuti.
5. **Sul tratto lungo di pietra:** prendere nota del **nome della via**, dell'**orario** e se si stava **sui binari del tram**.
6. **All'arrivo:** esportare la traccia (pulsante di esportazione nello stesso pannello) e inviarla. Con traccia e via si può confermare o escludere il candidato 1 senza supposizioni.

## 9. GO/NO-GO

- **GO per un rilascio pilota controllato solo Milano**, dopo la tua revisione e autorizzazione, con il metodo selettivo della Fase 4.26/4.28 (senza i commit di Roma). Servono poi:
  - lo smoke test in produzione;
  - la nuova prova su iPhone con la traccia attiva.
- **NO-GO per dichiarare risolto il pavé mancante:** gli avvisi ora esistono, ma il tratto di circa 1 km va prima localizzato con la prova successiva.
- **Da decidere prima della prova:** il limite di CPU di Cloudflare (sezione 7), che può far fallire calcoli e ricalcoli per strada.
