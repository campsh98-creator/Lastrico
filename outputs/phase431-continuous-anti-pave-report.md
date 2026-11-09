# Fase 4.31 — Navigazione anti-pavé continua, ricalcolo affidabile, avvisi sul fondo

8 novembre 2026. Piano di lavoro: `outputs/prompt-phase431-continuous-anti-pave-navigation.md`. Prove e misure: `outputs/phase431/`.

Tutto è stato fatto in locale: nessun commit, push, merge o deploy. Il pilota online resta `03a6776e`. Le Fasi 4.29 e 4.30 sono intatte e integrate. Roma e Roccella non sono state toccate.

**Cosa sono le prove.** Le tre prove su strada sono state ricostruite con i percorsi del servizio di routing tra i punti indicati. Non sono le tracce reali, che non sono state registrate. Tutte le misure di GPS sono simulate: **nessun risultato qui è una prova fisica su iPhone.**

## 1. Cause delle tre prove su iPhone

Le tre prove sono state fatte sul codice pubblicato (Fase 4.28): le correzioni delle Fasi 4.29 e 4.30 non erano sul telefono.

| Osservazione | Causa (verificata o probabile) | Stato |
|---|---|---|
| **A · GPS lento all'avvio, allineamento iniziale impreciso, freccia a scatti** | Verificata nel codice 4.28: niente fusione GPS, freccia spostata un dato alla volta. | Corretta nella 4.29, non pubblicata. Nella 4.31 ho trovato e corretto un difetto introdotto dalla 4.29 (vedi §3). |
| **A · ~1 km di pavé non riconosciuto** | Non confermato. Il percorso anti-pavé ricostruito ha 252 m di pavé confermato in OSM: Piazzale Principessa Clotilde, Piazza della Repubblica, Viale Beatrice d'Este. Il tratto lungo potrebbe essere segnato in OSM come asfalto, o potresti aver fatto un'altra strada. | Serve la traccia GPS della prossima prova. Non ho riclassificato nessuna strada. |
| **B · nessuna alternativa utile** | Anche da fermo non ce n'è una con meno pavé: il percorso più rapido ha un solo tratto, 143 m su Via Conca del Naviglio, e nessun candidato legale lo evita entro il tempo massimo. | Limite reale dei dati e delle strade. L'app ora lo dice chiaramente. |
| **B · più pavé del percorso di Google Maps** | Due difetti confermati possono averlo causato, perché lo stesso viaggio ha avuto un ricalcolo:<br>**1.** I ricalcoli usavano solo le alternative del servizio di routing, senza la ricerca anti-pavé più efficace.<br>**2.** Dopo un ricalcolo senza alternative, l'obiettivo anti-pavé andava perso fino alla fine del viaggio.<br>Il confronto con Google resta un'osservazione, non una misura. | Entrambi corretti (§2). |
| **B · popup sul fondo assenti** | Verificata: gli avvisi della 4.29 non sono pubblicati. | Popup migliorato (§4). |
| **B · semafori assenti** | Verificata: non c'erano mai stati. | Aggiunti dai dati OSM (§6). |
| **B · chat non visibile** | Lastrico non ha mai avuto una chat (§7). | Da chiarire con te. |
| **C · svolta sbagliata senza ricalcolo** | Non si può distinguere senza traccia. Ipotesi in ordine di probabilità:<br>**1.** La richiesta di ricalcolo è fallita sul Worker (limite di CPU del piano gratuito, misurato nella 4.30). L'app riprova dopo 30, 60 e 120 s.<br>**2.** Il riconoscimento era lento: serviva allontanarsi di circa 80 m, cioè 9–12 s. In una via parallela a 40–55 m dal percorso non arrivava quasi mai (riconosciuta solo nel 38% dei casi simulati).<br>**3.** La strada presa si ricollegava più avanti al percorso, e allora il ricalcolo non serve. | 2 corretta (§3). 1 dipende dal piano Workers Paid. D'ora in poi la traccia di collaudo registra motivo ed esito di ogni ricalcolo, compreso il codice di errore (es. `http-503`) o il timeout. |

## 2. Anti-pavé su tutto il viaggio: prima e dopo

**Correzioni**
- **L'obiettivo resta fisso.** Prima, ogni ricalcolo chiedeva "il tipo di percorso mostrato adesso". Un ricalcolo senza alternative faceva diventare "più rapido" tutto il resto del viaggio. Peggio: se già il piano iniziale non aveva alternative, nessun ricalcolo poteva più proporne una. Ora l'obiettivo si fissa alla partenza e cambia solo se scegli tu un altro percorso (`lib/reroute-objective.ts`).
- **Il ricalcolo usa lo stesso motore anti-pavé del piano.** La ricerca che penalizza il pavé ora gira anche in navigazione. Costa una richiesta in più al servizio di routing, circa +1 s. Il raffinamento resta solo nel piano.
- **Messaggio dopo ogni ricalcolo**, mostrato per 6 s: «Nuovo percorso · anti-pavé mantenuto» oppure «Nuovo percorso · da qui nessuna alternativa con meno pavé».

**Benchmark.** 203 svolte sbagliate simulate su strade OSM reali, prese dagli 88 viaggi di Milano in auto, moto e bici. Percorsi e fondi sono reali, presi dalle risposte registrate e riproducibili. Non è nato nessun ricalcolo perso, a parte un caso: un 422 legittimo a pochi metri dall'arrivo. Il pavé è sommato sul resto di tutti i 203 viaggi.

| | Prima | Dopo | Variazione |
|---|---:|---:|---:|
| Pavé confermato sul resto del viaggio | 46,3 km | 41,4 km | **−10,7%** |
| …solo con la correzione dell'obiettivo | — | 44,7 km | −3,6% |
| Pavé probabile | 28,6 km | 24,5 km | −14,3% |
| Fondo sconosciuto | 21,0 km | 11,6 km | −44,9% |
| Ricalcoli con un'alternativa anti-pavé reale | 56 | 71 | +27% |
| Ricalcoli che mostrano davvero l'alternativa | 51 | 71 | +39% |
| Tempo in più rispetto al più rapido, medio per ricalcolo | +23 s | +35 s | +12 s |
| Attesa stimata del ricalcolo, mediana | 1,2 s | 1,2 s | |
| Attesa stimata del ricalcolo, 95° percentile | 1,4 s | 2,5 s | +1,1 s |

**Per modo, pavé confermato:** auto −8,8%, moto −10,2%, bici −13,0%.

**Secondo ricalcolo dopo un primo senza alternative** (79 casi):
- prima l'obiettivo andava perso in 7 casi;
- mantenendolo, il pavé confermato scende da 15,5 a 13,6 km.

**Casi peggiorati: 2 su 203**, entrambi spiegati:
- **Duomo–Porta Garibaldi in bici:** il nuovo candidato è più rapido di 2 s e ha meno pavé in totale (710 m contro 997), ma più pavé confermato (710 contro 552).
- **Abbiategrasso–Colonne in moto:** +10 m.

**Oscillazione.** Non l'ho osservata. La scelta del server è deterministica per un dato punto. Con meno falsi ricalcoli (§3) i cambi di corridoio restano legati a vere deviazioni. Non ho misurato catene di molti ricalcoli consecutivi su strada.

**Percorsi calcolati prima della partenza: identici.** Le 354 risposte del benchmark coincidono campo per campo, a parte i nuovi campi aggiunti apposta (nome, fondo e semafori).

## 3. Riconoscimento della svolta sbagliata

**Correzioni** (`lib/navigation-fix-processor.ts`, `lib/route-progress.ts`)
1. **Direzione più distanza.** Basta qualche dato GPS preciso che si allontana dalla direzione del percorso, mentre il veicolo è chiaramente a lato, per confermare la svolta sbagliata. Le condizioni:
   - almeno 3 dati, che salgono a 5 se il telefono non fornisce la direzione di marcia;
   - almeno 35 m di spostamento netto (24 m in bici);
   - il veicolo deve andare nella direzione in cui punta, mentre un salto del GPS lo sposta di lato.
2. **Via parallela.** Una distanza costante di almeno 35 m dal percorso, mantenuta per 120 m (80 m in bici), conferma una via parallela.
3. **Partenza su un percorso ad anello.** Se il percorso ripassa due volte dallo stesso punto, la partenza viene agganciata al primo passaggio. Senza questa correzione, il codice locale della 4.29 dava un falso ricalcolo alla partenza, assente nella versione pubblicata.
4. **Salto GPS all'indietro.** Un dato che cade su un tratto del percorso molto più indietro, irraggiungibile alla velocità del veicolo, non conta più come "tornare indietro".
5. **Nessun ricalcolo da un solo dato.** Restano l'attesa di 15 s tra un ricalcolo e l'altro e il blocco mentre un ricalcolo è in corso. Un'inversione a U breve sul percorso continua a non provocare un ricalcolo.

**Simulazione:** 263 percorsi, 440 svolte, 6.600 guide simulate (`outputs/phase431/deviation-bench-after.json.gz`). Il confronto è tra il codice pubblicato e la Fase 4.31.

| Scenario | Riconosciuto (prima → dopo) | Metri dopo l'incrocio, mediana / p90 | Secondi, mediana / p90 |
|---|---|---|---|
| Svolta invertita (sinistra↔destra) | 99,1% → 99,8% | 76/84 → **60/68** | 9/14 → **8/11** |
| Svolta invertita, canyon urbano | 99,1% → 99,5% | 76/100 → 60/76 | 10/17 → 8/14 |
| Svolta con GPS scarso subito dopo | 98,9% → 99,1% | 84/84 → 84/84 | 10/15 → 10/14 |
| Svolta con GPS perso per 10 s | 98,9% → 98,9% | 124 → 116 | 15 → 15 |
| Incrocio mancato (dritto) | 96,4% → 96,6% | 84/140 → 68/108 | 12/21 → 10/18 |
| Via parallela a 60 m | 99,5% → 98,6% | 92 → 68 | 16 → 12 |
| **Via parallela a 45 m** | **37,7% → 93,4%** | 160 → 172 | 31 → 22 |
| Guida corretta, falsi ricalcoli | 0/1.320 → **0/1.320** | | |
| Guida corretta senza direzione dal telefono, falsi ricalcoli | 0/880 → 1/880 | | |

**Casi non riconosciuti.** Sono soprattutto strade sbagliate che si ricollegano più avanti al percorso, dove è giusto non ricalcolare, e incroci dove le tile non hanno una strada reale nella direzione voluta.

**Ricalcolo ricevuto ma non applicato.** Ho riletto il percorso del codice dalla richiesta all'applicazione e non ho trovato perdite silenziose:
- le risposte superate o arrivate fuori ordine vengono scartate;
- un timeout o un errore mostra «Ricalcolo non riuscito» e conta per l'attesa crescente prima del tentativo successivo.

## 4. Popup sul fondo in arrivo

- **Testo:** «**Tra 230 m** — Pavé su Via Legnano per 600 m» e poi «**Su pavé** — ancora 470 m · Via Legnano». Anche la voce dice il nome, ad esempio «Tra 250 metri, pavé su Via Legnano per circa 400 metri.».
- **Nome della via:** viene dal nome OSM della strada su cui il tratto è stato riconosciuto. Si mostra solo se un nome copre almeno il 60% del tratto; altrimenti il nome non c'è e non viene mai indovinato.
- **Confermato e probabile restano distinti:**
  - «Pavé» per sett e cobblestone;
  - «Ciottoli» per unhewn_cobblestone;
  - «Masselli» per paving_stones;
  - «Pavé probabile» per il resto.
- **Asfalto rovinato:** non è supportato, perché i dati non lo stabiliscono. Su 1.248 km di asfalto solo 0,8 km hanno `smoothness` cattiva.
- **Comportamento:** ogni tratto viene annunciato una sola volta, anche dopo un ricalcolo. Un salto del GPS oltre il punto di preavviso fa annunciare il tratto all'ingresso.
- **Schermo:** il popup sta sotto l'istruzione di svolta e resta tutto visibile a 390×844, in tema chiaro e scuro.
- **Screenshot** in `outputs/phase431/screenshots/`. Il nome nelle immagini è un dato di prova inserito dal test del browser, non la via reale di quel percorso. Nello screenshot scuro il tema è forzato dal test, quindi la mappa resta chiara.

## 5. Freccia e telecamera

**La freccia era indietro di un aggiornamento.** Con un dato GPS al secondo, la freccia scivola verso ogni nuovo dato in circa un secondo, quindi era sempre un secondo indietro. Ora, quando è agganciata con sicurezza alla strada, punta a dove sarà il veicolo:
- al massimo 0,8 s e 10 m più avanti, lungo il percorso;
- mai oltre la prossima svolta o l'arrivo;
- se il GPS tace, si ferma lì e non continua a muoversi;
- con GPS impreciso o fuori percorso non fa nessuna previsione.

Misura nel browser: auto a 29 km/h, un dato al secondo, dati GPS senza ritardo (un telefono vero aggiunge il suo).

| | Fase 4.29 | Fase 4.31 |
|---|---:|---:|
| Ritardo medio rispetto alla posizione reale | 9,0 m | **2,5 m** |
| Ritardo, mediana / p90 | 8,2 / 11,5 m | 1,7 / 4,1 m |
| Dal dato GPS al primo movimento | 39 ms | 40 ms |
| Passo più grande per fotogramma | 0,77 m | 0,69 m |

La telecamera segue la stessa animazione lineare, quindi non aggiunge ritardo. Il consumo resta quello della 4.29: un'animazione per dato GPS, nessun calcolo continuo.

## 6. Semafori e segnali

- **Fonte.** Nodi OSM etichettati, già presenti nel progetto: gli 11 archivi del centro scaricati dall'API OSM tra il 26 e il 28 ottobre, con le impronte di controllo verificate. Non ho fatto nessuna nuova estrazione. Sui dati citywide non ci sono etichette sui nodi.
- **Estratti** (`data/features/milan-road-features.json`, 25 KB, 9 KB compressi):
  - 302 semafori (`highway=traffic_signals`);
  - 54 attraversamenti con semaforo a metà isolato;
  - 36 stop e 203 precedenze, ciascuno collegato al proprio incrocio.
  - 7 segnali sono stati scartati perché non attribuibili a un solo senso di marcia.
- **Sulla mappa.** Il server restituisce solo i segnali sul percorso scelto. I semafori dello stesso incrocio diventano un'icona sola, e le icone compaiono solo da vicino (zoom ≥14).
- **Stop e precedenze** compaiono solo se il percorso passa dal segnale e poi dal suo incrocio. Non mostro mai fasi, tempi o traffico.
- **Copertura dichiarata.** Una nota sotto il percorso dice, per esempio, «24 semafori sul percorso (OSM) · dati solo per il centro». Le tre prove su strada sono tutte coperte solo in parte.
- **Costo:** 0,4 ms di CPU per risposta.

## 7. La chat precedente

Ho cercato in tutta la storia Git e in tutti i branch: **Lastrico non ha mai avuto una chat**, né AI né di altro tipo, e il progetto non ha nessun collegamento a servizi AI.

L'elemento più simile è la casella «Descrivi la tua preferenza», con il pulsante «Interpreta»:
- è un interprete locale dichiarato «non AI»;
- fino al 2 novembre era sempre visibile;
- dal commit `19d211a` è dentro la sezione chiusa «Preferenze e percorsi suggeriti»;
- è presente anche nella versione pubblicata.

Non ho cambiato nulla qui. Se è quella che intendi, renderla di nuovo visibile è un intervento piccolo e gratuito.

## 8. Cloudflare: CPU e memoria

- **CPU dei ricalcoli** (misura locale in Node, indicativa): mediana 21 ms e p95 122 ms dopo; prima erano 32 e 221 ms nella stessa misura. Il dato è rumoroso, ma la ricerca anti-pavé in più non ha fatto crescere la CPU in modo misurabile.
- **CPU dei percorsi calcolati prima della partenza**, misurata a macchina libera su 263 casi: mediana 12 → 11 ms, p90 40 → 35 ms, massimo 175 → 137 ms. È rumore di misura, ma non c'è nessun aumento. Le parti nuove costano 0,4 ms per richiesta.
- **Memoria:** invariata rispetto alla 4.30 (76 MB con tutta Milano caricata, più 25 KB di semafori).
- **Pacchetto:** 27.273 KiB (13.036 KiB compressi) nel dry-run, con Roma presente nel branch locale. È molto sotto i 64 MiB, e un rilascio solo Milano è più piccolo.
- **Piano gratuito: resta NO-GO.** Con il limite di 10 ms di CPU per richiesta la maggior parte dei percorsi viene interrotta, come misurato nella 4.30. Queste modifiche non cambiano la conclusione. Il ricalcolo fallito per CPU è anche la causa più probabile della prova C.

## 9. Verifiche

| Verifica | Risultato |
|---|---|
| TypeScript, ESLint | Nessun errore |
| Test automatici | **418/418** (11 nuovi in `tests/phase431-navigation.test.mjs`; aggiornato 1 test che verificava il comportamento difettoso) |
| Percorsi calcolati prima della partenza | 354/354 risposte identiche (esclusi i nuovi campi) |
| Prove mobili nel browser (390×844) | **77/77 al primo giro**: le 74 precedenti (ricerca indirizzi 4.22, piano, GPS, voce, ricalcolo, arrivo, temi, Fase 4.29) più G1–G3 |
| Nuove prove nel browser | G1 obiettivo mantenuto dopo il ricalcolo, G2 popup con nome e fondo in tema chiaro e scuro, G3 semafori e copertura: passano |
| F1, F2, F3, B3, B4, B10, B11, B12 | Passano. F1 ora controlla anche il ritardo della freccia (< 5 m) e che si fermi dopo l'ultimo dato |
| Build e dry-run del deploy | Riusciti, 27.273 KiB |
| Controlli sul servizio di routing reale | 545 richieste nel benchmark dei ricalcoli e 5 nelle tre prove ricostruite, a ≥1,1 s l'una dall'altra; risposte registrate e riproducibili |

## 10. Rischi, lavoro rimandato e GO/NO-GO

**Rischi**
- Le soglie di riconoscimento sono calibrate su GPS simulato. Un canyon urbano reale può essere peggiore, e senza direzione dal telefono c'è stato 1 falso ricalcolo su 880 guide simulate.
- Il 95° percentile dell'attesa di ricalcolo sale da circa 1,4 a 2,5 s.
- Il pavé lungo della prova A resta non individuato. Il limite sono i dati OSM, non il codice.

**Rimandato**
- Semafori fuori dal centro: serve un'estrazione OSM in sola lettura, che richiede la tua approvazione per il download.
- Asfalto rovinato: i dati non bastano.
- Chat: da chiarire con te.

**Decisione**
- **NO-GO sul piano gratuito**, come nella 4.30.
- **GO per un rilascio solo Milano delle Fasi 4.29, 4.30 e 4.31**, alle condizioni del prompt di esecuzione: Workers Paid attivo, la tua autorizzazione per commit e deploy, il metodo selettivo che esclude Roma, e smoke test in produzione con il registro di Cloudflare acceso.

## Piano per la prossima prova su iPhone

1. **Prima di partire**
   - Apri il pilota aggiornato e attiva **Menu › Registra traccia GPS per il collaudo**.
   - Tieni Anti-pavé e annota l'ora d'inizio: con l'ora posso seguire in diretta il registro di Cloudflare.
2. **Prova A, Gae Aulenti → Promessi Sposi.** Rifalla con la traccia accesa. Quando sei sul tratto lungo di pavé, segna il punto con «Segnala una strada». Così il tratto si individua senza indovinare.
3. **Prove B e C, con errori fatti apposta** in un punto sicuro e senza traffico:
   - una svolta invertita (sinistra invece di destra);
   - un incrocio saltato (dritto);
   - due isolati su una via parallela.

   Ogni volta il ricalcolo dovrebbe partire entro 60–70 m e mostrare «Nuovo percorso · anti-pavé mantenuto» o «…nessuna alternativa con meno pavé».
4. **Da guardare durante il viaggio**
   - Il popup «Tra … — Pavé su … per …» deve comparire prima di Via Conca del Naviglio nella prova B.
   - La voce deve dirlo una volta sola.
   - Le icone dei semafori devono comparire nel centro.
   - La freccia non deve restare indietro.
5. **Alla fine.** Esporta la traccia (JSON) e mandamela. Contiene, per ogni ricalcolo, motivo ed esito, compreso l'eventuale errore del Worker, e permette di riprodurre esattamente il viaggio.
