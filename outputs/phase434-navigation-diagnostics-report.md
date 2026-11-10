# Fase 4.34 — diagnostica della navigazione reale e verifica delle strade (Milano)

Data: 10 novembre 2026. Base: `main` a `497dbf1`.

**Non fatto:**
- nessun commit, push, ramo o pubblicazione;
- Roma e Roccella non sono state toccate;
- il pilota pubblico non è cambiato.

**Nessuna prova su iPhone fisico è stata fatta:** quello che segue è verificato in locale e in simulazione.

## 1. Cosa c'era già e ho riusato

- **Registratore di tracce GPS** (Fasi 4.29–4.31), già disattivato di partenza:
  - si attiva con un interruttore e mostra **REC** durante la navigazione;
  - resta solo sul dispositivo e si esporta in JSON;
  - si cancella a mano.
- **Riproduzione deterministica**, che ripete ogni decisione dell'app sulla traccia (`replayGpsTrace`).
- **Note di collaudo locali** (pavé non segnalato, pavé che è asfalto, manovra errata, GPS spostato), esportabili in JSON e CSV e mai inviate.
- **Segnalazioni della comunità** su D1: entrano come "in revisione", e il calcolo dei percorsi non le legge mai.
- **Semafori, stop e precedenze** da nodi OSM con fonti verificate da checksum.

## 2. Cosa ho aggiunto

- **Traccia v2.** Per ogni percorso registra:
  - l'obiettivo (più rapido o anti-pavé);
  - il pavé previsto e i tratti su cui l'app può avvisare.

  Registra anche questi eventi:
  - quando ogni avviso di pavé compare e a quale distanza;
  - pagina nascosta e di nuovo visibile;
  - cambio di percorso;
  - nota di collaudo, solo il tipo, mai il testo.

  Le tracce v1 restano leggibili e riproducibili.
- **Esportazione GPX** accanto al JSON: le rilevazioni come traccia, con ora, precisione, direzione e velocità; i percorsi come `<rte>`.
- **Importazione controllata** (`parseGpsTrace`): rifiuta file con campi estranei, per esempio un nome o un'e-mail aggiunti, con versione, area o modalità non valide, o con rilevazioni malformate.
- **Limiti di conservazione:**
  - al massimo 3 tracce e 2,5 MB in tutto, cioè circa 2 ore;
  - cancellazione automatica dopo 7 giorni;
  - dimensione mostrata per ogni traccia;
  - **REC piena** quando la registrazione si ferma.
- **Analisi delle tracce** (`lib/trace-diagnosis.ts` e `node scripts/replay-gps-trace.mjs <traccia> --text`): divide quello che trova in 8 categorie (§3).
- **Verifica dei dati agli incroci** (`scripts/audit-milan-intersections.mjs`): vedi §4.
- **Note sul pavé:** un nuovo tipo, "Avviso di pavé sbagliato", e il tratto del percorso allegato alla nota (§5).
- **Identificazione verso i servizi esterni:** corretta (§6).

## 3. Registrazione e riproduzione

- **Registrazione:** solo se attivata, solo durante la navigazione con GPS (non in simulazione), solo sul dispositivo.
- **Uscita dal dispositivo:** solo premendo **Esporta** o **GPX**, che aprono il foglio di condivisione o un download. Nessun invio automatico.
- **Analisi:** `node scripts/replay-gps-trace.mjs traccia.json --text` ripete la traccia e la analizza. Le categorie:

| Categoria | Cosa la indica |
|---|---|
| Precisione GPS | più rilevazioni oltre i 30 m di precisione; rilevazioni scartate; salti impossibili |
| Interruzioni dell'app | silenzi di più di 10 s: "misurato" se la pagina era nascosta (schermo bloccato o secondo piano), "possibile" se era visibile (segnale perso) |
| Aggancio alla strada | rilevazioni precise a 15 m o più dal percorso, ma sotto la soglia, per più secondi; avanzamento trattenuto |
| Riconoscimento della svolta sbagliata | fuori percorso senza ricalcolo, oppure riconosciuto dopo più di 15 s, esclusi i momenti in cui un ricalcolo era già in corso; ricalcolo partito da posizioni vicine al percorso |
| Servizio di routing | ricalcoli falliti (tempo scaduto, HTTP, rete) e risposte lente |
| Indicazioni | manovre saltate, indicazioni vocali dopo il punto, uscita dal percorso subito dopo una manovra |
| Dati sul pavé | tratto previsto raggiunto senza avviso o con avviso tardivo; note del collaudatore sul pavé |
| Comportamento cambiato | decisioni che il codice attuale prende in modo diverso dall'app che ha registrato |

- **Certezza:** ogni risultato è "misurato" o "possibile", con le prove e cosa verificare. Nessuno conclude che il percorso fosse sbagliato: dice cosa controllare.
- **Ripetibilità:** la stessa traccia dà sempre lo stesso risultato.
- **Tempi:** su una traccia di 4 ore (14.400 rilevazioni), l'analisi richiede 0,28 s e il GPX 0,03 s.

## 4. Semafori, segnali e svolte

Verifica offline e ripetibile dei dati del centro di Milano (`outputs/phase434/intersection-audit.md`):
- **Provenienza:**
  - le 11 fonti OSM corrispondono ai checksum;
  - tutti i 595 elementi risalgono a un nodo OSM con il tag giusto e le stesse coordinate;
  - ricostruito dalle fonti, il dataset è identico.
- **Posizione:**
  - 2 semafori su nessuna strada: uno sulla linea della M3, uno su un confine amministrativo;
  - 5 solo su binari del tram e 4 solo su marciapiedi;
  - 10 su ciclabile o strada di servizio vicini alla carreggiata.
- **Doppioni:**
  - 15 coppie probabili;
  - 3 gruppi sembrano due incroci distinti mostrati come un solo semaforo, uno tra Viale Filippetti e Corso di Porta Vigentina.
- **Stop e precedenze:**
  - 108 senza direzione;
  - 8 su sensi unici legati all'incrocio alle spalle, che l'app non mostrerebbe mai a chi guida nel verso giusto;
  - 3 rivolti contro il senso unico.
- **Classificazione:** 1 precedenza con tag da semaforo, 1 semaforo pedonale come semaforo d'incrocio, 12 attraversamenti con tag contraddittori.
- **Sensi unici:** 3.054 strade carrabili. Due conflitti nei dati:
  - in Via Manzoni due tag danno orari diversi (07:20 contro 07:30–20:00);
  - intorno a Piazza Vetra c'è un tag con data in contrasto.
- **Divieti di svolta:**
  - 187 relazioni nel centro; li applica il servizio di routing (FOSSGIS Valhalla), non Lastrico;
  - sui 3.215 percorsi archiviati del servizio, **0 manovre vietate** dove il divieto vale;
  - un obbligo con orario (Via Manzoni / Via Pisoni, rel. 6416225) viene percorso in senso opposto da 95 percorsi archiviati. Le richieste non indicano l'orario, quindi non è giudicabile: da leggere sul cartello.
- **Regole con orario:** 148 sulle chiavi che l'app legge, tutte interpretate. 25 non supportate, elencate e non ignorate, soprattutto `oneway:conditional`, che applica solo il servizio di routing.
- **Elenco per il sopralluogo:** 144 punti ordinati, con ID OSM, coordinate e cosa verificare. I primi sono:
  1. Piazzale Cadorna;
  2. XX Settembre / Monti;
  3. Corso Europa / Via Larga;
  4. Foro Buonaparte.
- **Limite:** **nessun incrocio è verificato sul posto.** Copre solo gli 11 riquadri centrali.

## 5. Segnalazioni sul pavé

- **Cosa c'era già:** segnalare pavé mancante ("Pavé non segnalato") e asfalto scambiato per pavé ("Pavé segnalato ma asfalto liscio").
- **Nuovo tipo:** **"Avviso di pavé sbagliato"**, per un avviso dove non c'è pavé, nel punto sbagliato o in ritardo.
- **Tratto allegato:** se la nota è fatta in navigazione e la posizione resta allegata, la nota porta il tratto del percorso così come l'app lo aveva:
  - inizio e fine;
  - via e superficie OSM;
  - metri confermati e probabili;
  - se l'avviso era stato mostrato.

  Senza posizione, niente tratto. Le nuove colonne sono in fondo al CSV, quindi le precedenti non si spostano.
- **Revisione prima di contare:** le note restano sul dispositivo; le segnalazioni pubbliche restano "in revisione" finché non vengono verificate. Il calcolo dei percorsi non legge né le une né le altre (test).
- **Cosa manca:** le segnalazioni pubbliche su D1 non hanno ancora il tratto né l'ID OSM. Aggiungerli cambierebbe il database di produzione: è un passo separato, da autorizzare.

## 6. Identificazione verso i servizi

- **Prima:** le richieste a Valhalla, OSRM, Nominatim e Photon dichiaravano come contatto il vecchio sito beta, che risponde 401.
- **Ora:** `Lastrico/0.5.0 (+https://github.com/campsh98-creator/Lastrico)`, da un'unica costante (`lib/provider-identity.ts`). È il repository del progetto, con le issue aperte; nessuna e-mail personale.
- **Verifica:** una richiesta a ciascun servizio ha risposto 200; anche il link di contatto risponde 200.
- `package.json` (homepage) è corretto.
- Nessun riferimento al vecchio sito resta nel codice di esecuzione (test).

## 7. Test automatici

| Verifica | Esito |
|---|---|
| ESLint | ✅ |
| TypeScript (`tsc --noEmit`) | ✅ |
| `npm test` con build di produzione, copia pulita senza i duplicati di iCloud | **478/479**, 0 falliti, 1 saltato (Roma, atteso) |
| Nuovi test di diagnostica (`phase434-diagnostics`) | 18/18 |
| Verifica incroci (`phase434-intersection-audit`) | 9/9 con l'archivio; 8 + 1 saltato senza, come in CI |
| Riproduzione delle tracce GPS (v1 e v2), esportazione e importazione, privacy e stato della registrazione | inclusi sopra |
| E2E mobile sul Worker locale, 16 formati (iPhone da 320×568 a 428×926, chiaro e scuro) | **81/81**: registrazione solo se attivata, esportazione JSON v2 e GPX, 0 invii (E6); note di collaudo locali (D7) |

**Problemi dell'ambiente:**
- **Cartella di lavoro:** contiene circa 1.400 copie di conflitto di iCloud ("nome 2.json"). Qui `tsc` e un test falliscono solo per quelle; per questo i test girano su una copia pulita. Non ho cancellato nulla.
- **`wrangler dev` locale:** si è fermato due volte durante l'E2E con "Network connection lost" nel suo proxy, all'incirca dopo 2 minuti. Non si ripete da fermo, e la stessa suite era passata 81/81 sul pilota reale. Lo considero un problema dello strumento, ma lo segnalo.

## 8. Prestazioni e privacy

- **Registrazione spenta:** non esiste nessun registratore. I nuovi punti di aggancio sono solo controlli nulli e un effetto che si ferma subito. Nessun costo misurabile.
- **Registrazione accesa:** 1,3 µs per rilevazione, contro 14,8 µs dell'elaborazione GPS già esistente.
- **Percorsi:** il codice di calcolo non è cambiato, tranne l'intestazione `User-Agent`. I test di routing passano tutti.
- **Privacy:**
  - posizioni precise solo con l'interruttore acceso e solo sul dispositivo;
  - nessun invio;
  - cancellazione dopo 7 giorni;
  - file importati controllati contro campi estranei;
  - nelle tracce nessun identificativo personale (solo un ID casuale) e nessun testo delle note.

## 9. Limiti che restano

- **Analisi:** suggerisce dove guardare. Non conosce la strada reale.
- **iOS:** può sospendere la pagina in secondo piano o a schermo bloccato. La traccia ora lo mostra, ma non lo impedisce.
- **Verifica incroci:** solo dati OSM, solo centro di Milano, nessun sopralluogo. I divieti con orario non sono giudicabili senza l'orario della richiesta.
- **Segnalazioni pubbliche:** non hanno ancora il tratto né l'ID OSM.
- **Pilota:** questa fase non è pubblicata; usa ancora la vecchia identificazione.
- **Durata delle tracce:** circa 2 ore. Una prova più lunga va divisa.

## 10. Prova su iPhone fisico, istruzioni esatte

Prima di partire:
1. **Apertura.** Apri il pilota da Safari o dall'icona sulla schermata Home. Questa fase deve prima essere pubblicata: finché non lo è, la prova riguarda la versione 4.33.
2. **Registrazione.** Menu › **Dettagli tecnici e registrazione GPS** › attiva **Registra traccia GPS per il collaudo**.
3. **Permessi.** Permesso di posizione «Mentre usi l'app», con **Posizione esatta** attiva.

Durante la prova:

4. **Percorsi.** Fai, in auto, da passeggero o fermo per toccare lo schermo:
   - Porta Vittoria → Largo Promessi Sposi, verso Viale Filippetti;
   - Moscova → Crocetta.

   Controlla che compaia **REC** in alto.
5. **Uscita voluta.** Esci dal percorso una volta, di proposito, e annota l'ora.
6. **Schermo bloccato.** Blocca lo schermo per 30 secondi in un punto sicuro, poi riapri.
7. **Pavé.** Dove il fondo non corrisponde, fermati in sicurezza e apri menu › **Note di collaudo sul dispositivo** › Fondo stradale. Scegli:
   - **Pavé non segnalato**;
   - **Pavé segnalato ma asfalto liscio**;
   - **Avviso di pavé sbagliato**.

   Tieni **Allega posizione GPS**.
8. **Semafori e svolte.** Annota i semafori o le svolte che non corrispondono, soprattutto nei punti dell'elenco: Cadorna, Corso Europa, Foro Buonaparte, Viale Filippetti / Porta Vigentina.

Dopo la prova:

9. **Esportazione.** Esporta la traccia (**Esporta**, e **GPX** se vuoi vederla su una mappa) e le note (JSON o CSV).
10. **Archivio.** Salva i file in `outputs/field-traces/`, che git ignora, e non condividerli senza consenso.
11. **Analisi.** Esegui:
    ```bash
    node scripts/replay-gps-trace.mjs outputs/field-traces/<file>.json --text
    ```
    poi confronta i risultati con le tue annotazioni e con l'ora dell'uscita voluta.
12. **Dati del telefono.** Annota modello di iPhone, versione di iOS, Safari o app dalla schermata Home, meteo.

## 11. Raccomandazione

**GO per un futuro rilascio solo Milano** di questa fase, a queste condizioni:
- **Prima del rilascio:** tua autorizzazione, commit e PR, CI verde, procedura di rilascio della Fase 4.33 e build di ripristino pronta.
- **Rischio:** basso, perché la diagnostica è spenta di partenza e il calcolo dei percorsi non cambia.
- **Rilascio utile:** corregge l'identificazione verso i servizi e rende misurabile la prova su iPhone.
- **Dopo il rilascio:** la prova su iPhone resta da fare, e nessuna conclusione sulla navigazione reale è possibile prima.
