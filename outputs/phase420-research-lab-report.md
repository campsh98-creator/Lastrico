# Fase 4.20 — Laboratorio di ricerca: rapporto finale

Data: 5 novembre 2026. Quattro esperimenti indipendenti, ciascuno nella propria cartella sotto `experiments/`. **Niente è stato integrato nell'app**, nel routing di produzione o nel pilot e non c'è stato nessun deploy, commit o push. Piano di lavoro: `outputs/prompt-phase420-research-lab.md`.

## In sintesi

| # | Esperimento | Stato | Esito |
|---|---|---|---|
| 1 | Classifica intelligente dei percorsi | Completo e verificato | **GO condizionato** a una fase di integrazione dedicata |
| 2 | Dashboard della conoscenza stradale | Completo e verificato | **GO** solo come strumento interno |
| 3 | Sensori di vibrazione dello smartphone | Completo e verificato, solo con dati simulati | **NO-GO** per l'app; GO solo per una prova sul campo |
| 4 | Riconoscimento del pavé dalle foto | Completo e verificato: dataset scaricato con permesso, modello addestrato e valutato | **NO-GO**: 2 dei 5 criteri fissati in anticipo non superati |

---

## 1. Classifica intelligente dei percorsi — `experiments/route-ranking/`

**Cosa è.** Una regola trasparente per scegliere il percorso. Pesa pavé confermato, pavé probabile, fondo sconosciuto, tempo e distanza secondo profili configurabili (più rapido, bilanciato, deciso, massimo, personalizzato). Per ogni scelta spiega in italiano perché un percorso batte il più rapido. Il fondo sconosciuto non viene mai trattato come asfalto.

**Dati.** Solo percorsi reali: 74 risposte archiviate, 29 percorsi d'archivio ricalcolati con i dati di oggi e 36 nuove richieste fatte oggi a Milano a una copia locale dell'app, distanziate di almeno 10 secondi. Due richieste in bici sono state rifiutate dall'app, quindi ne restano 34 utili. In totale ci sono 36 casi con un vero compromesso tra pavé e tempo, tutti a Milano: sui percorsi di Roccella non c'è pavé noto.

**Risultati rispetto alla scelta attuale dell'app.**
- Sulle 34 richieste reali di oggi la nuova regola sceglie **lo stesso percorso dell'app in 34 casi su 34**. Su tutti i confronti l'accordo è di 399 su 400.
- In 23 di quei 34 viaggi l'app (e la nuova regola) devia dal percorso più rapido. In totale evita **11,9 km di pavé noto** al costo di **57,6 minuti** in più e 269 m di fondo sconosciuto in più. In media ogni deviazione evita circa 520 m di pavé con circa 2,5 minuti in più.
- Nessuna scelta è "dominata", cioè nessun percorso scelto è peggiore di un altro su tutti i criteri.
- L'unica differenza (moto, Duomo → Garibaldi, profilo bilanciato) è un caso limite tra due percorsi entrambi ragionevoli.

**Qualità delle prove e limiti.** Non esiste una verità su quale percorso preferiscano gli utenti. L'accordo così alto è in parte voluto, perché i pesi del tempo sono presi dall'app. Il valore dimostrato è quindi la **trasparenza** (ogni scelta si può spiegare e regolare), non percorsi migliori. Due decisioni di prodotto restano aperte. La prima: premiare o no un percorso con meno tratti sconosciuti (oggi l'app non lo fa; sui percorsi reali cambia 1 decisione su 300). La seconda: quanto pesare la distanza.

**Costo.** Circa 5 milionesimi di secondo per decisione, contro 1 per la regola attuale: trascurabile. Il codice della regola è di circa 420 righe, senza dipendenze. Un test segnala se le costanti dell'app cambiano. Per integrarla l'app deve fornire, per ogni percorso candidato, i metri di pavé confermato e quelli di pavé probabile. Poi servono un periodo di confronto silenzioso in parallelo e un interruttore per attivarla.

**GO condizionato** a una fase di integrazione dedicata, come motore di spiegazione e di preferenze dell'utente. Condizioni: confronto in parallelo con almeno il 95% di accordo e 0 scelte dominate. **NO-GO** a presentarla come "percorsi migliori".

## 2. Dashboard della conoscenza stradale — `experiments/road-dashboard/`

**Cosa è.** Una mappa locale per sviluppatori, senza internet e senza tracciamento. Mostra dove il fondo stradale è noto, probabile o sconosciuto, la copertura per zona e le "zone di incertezza", cioè i punti dove un rilievo ridurrebbe di più i dubbi del navigatore. Le previsioni sperimentali della Fase 4.17 stanno in uno strato separato, spento di base ed etichettato "Previsione sperimentale — non verificata". Non entrano mai nei totali verificati.

**Cosa dicono i dati** (per "verificato" si intende un'etichetta esplicita di OpenStreetMap, non un rilievo sul campo):

| Area | Rete | Pavé verificato | Pavé probabile | Liscio verificato | Altro (sterrato) | Sconosciuto | Fondo noto |
|---|---:|---:|---:|---:|---:|---:|---:|
| Milano | 1.644,7 km | 70,7 km | 68,1 km | 1.169,3 km | 60,9 km | 275,8 km | **83,2%** |
| Roccella Ionica | 176,5 km | 0 km | 0,4 km | 30,9 km | 8,2 km | 137,1 km | **22,4%** |

- A Milano le strade principali sono note al 99,9%. Lo sconosciuto è soprattutto marciapiedi mappati, strade residenziali, strade di servizio e piste ciclabili.
- A Roccella le strade principali sono note, ma quasi tutto il resto no: strade minori e sentieri. Le zone di incertezza più importanti sono il centro di Roccella (Via Vittorio Emanuele, Via Nanni e Piazza Stazione) e, a Milano, la zona di Via Pirelli e alcune vie sconosciute all'interno di un'area di 3,4 km di pavé verificato nel centro-nord.
- Le previsioni della Fase 4.17 non superano mai il 34% di probabilità di pavé: confermano il NO-GO di quella fase.

**Qualità delle prove e limiti.** Tutte le 57 impronte di controllo dei dati di partenza coincidono. I pesi usati per le zone di incertezza sono scelti a mano e non sono validati sull'uso reale. La copertura dell'anello esterno di Milano appare più alta del vero, perché in produzione alcune strade minori sconosciute sono state escluse.

**Costo.** Si ricostruisce in circa 3 secondi, pesa 1,45 MB e si apre in circa un decimo di secondo (meno di un secondo al primo avvio). Aggiornarla richiede da mezza a una giornata a ogni aggiornamento dei dati. Non ha alcun costo per l'app in uso. Durante il lavoro è emersa un'anomalia del motore JavaScript di Node 24, che in un caso specifico restituiva numeri sbagliati. L'ho riprodotta; è neutralizzata da una protezione e da un controllo che blocca la generazione se i numeri non tornano.

**GO** come strumento interno per la qualità dei dati e per pianificare i rilievi, in particolare a Roccella. **NO-GO** per qualunque uso visibile agli utenti o nel routing.

## 3. Sensori di vibrazione dello smartphone — `experiments/roughness-sensors/`

**Cosa è.** Un prototipo per sviluppatori che, solo dopo un consenso esplicito, registra le vibrazioni del telefono durante il viaggio e le analizza sul dispositivo, senza inviare nulla. Etichetta ogni tratto di circa 60 m come liscio, ruvido tipo pavé o incerto. Il GPS ha un consenso separato ed è spento di base. A questo si aggiunge un'indagine sui permessi di iPhone.

**Risultati — solo con viaggi simulati al computer, non con strade vere.** Su 38 viaggi simulati il riconoscimento del pavé ha precisione 0,96 e completezza 0,98. Una soglia semplice si ferma a 0,89 e 0,92. Asfalto e pavé non vengono mai scambiati direttamente, e nei casi dubbi (telefono in mano, GPS assente, velocità a passo d'uomo) il sistema si astiene invece di sbagliare.

**Scoperte decisive per il prodotto.**
- **Su iPhone i sensori arrivano a circa 60 letture al secondo.** Sopra circa 11 km/h questo non basta a "vedere" il ritmo dei cubetti. A velocità normali il telefono sente solo "vibrazione forte" e **non distingue il pavé da asfalto rovinato, binari del tram o ghiaia**. Nei test, 9 tratti su 11 di asfalto rovinato sono stati scambiati per pavé.
- Il permesso si chiede solo con un tocco su un pulsante e solo su una pagina sicura (HTTPS).
- La registrazione si ferma quando lo schermo si spegne o l'app va in secondo piano.

**Qualità delle prove e limiti.** Nessuna prova su un telefono reale (su questo computer manca anche il simulatore iOS) e nessuna verità sul campo. I numeri dicono solo che il codice funziona come previsto se la realtà somiglia al modello. Batteria e calore non sono stati misurati.

**Costo.** L'analisi è velocissima: circa 7 millesimi di secondo per minuto di dati. Una prova sul campo richiederebbe 2–3 settimane più le uscite; un'eventuale integrazione 4–8 settimane, più una taratura continua per nuovi telefoni.

**NO-GO** per l'integrazione nell'app. **GO condizionato** solo per una prova sul campo con il team, seguendo il protocollo già scritto: tratti di pavé e asfalto verificati a piedi, più telefoni, veicoli e velocità, passaggi ripetuti e tutele per la privacy.

## 4. Riconoscimento del pavé dalle foto — `experiments/surface-vision/`

**Cosa è stato fatto.**
- **Scelta del dataset.** Ho confrontato sette fonti di immagini stradali per licenza, qualità delle etichette, classi e copertura geografica. **L'unica affidabile e riutilizzabile è StreetSurfaceVis**: 9.122 foto stradali tedesche etichettate a mano da 3 persone con ottimo accordo, di cui 1.363 di pavé, con licenza CC BY-SA 4.0. Le altre sono escluse per licenze non commerciali, perché non hanno una classe pavé o perché non dichiarano una licenza. **Non esiste un dataset italiano con il pavé etichettato.**
- **Download.** Con il permesso del proprietario ("Sì, scarica") sono stati scaricati solo i due file approvati (1,28 GB), nella cartella temporanea della sessione e fuori dal repository. Dimensioni e impronte coincidono con quelle pubblicate e l'archivio non è stato estratto.
- **Prova.** Un modello leggero, che legge la trama dell'immagine, è stato addestrato su alcune città e provato su cinque città tedesche mai viste durante l'addestramento. I criteri di successo erano stati fissati prima della prova: precisione e completezza sul pavé di almeno 0,70, un miglioramento netto rispetto a un modello basato solo sui colori, probabilità ben tarate e nessuna sovrapposizione tra dati di addestramento e di prova.

**Risultati** (776 foto di prova, di cui 32 di pavé):

| Modello | Foto classificate correttamente | Pavé: segnalazioni corrette (precisione) | Pavé: casi trovati (completezza) |
|---|---:|---:|---:|
| Risposta sempre "asfalto" (riferimento minimo) | 68% | — | 0% |
| Solo colori | 59% | 11% | 44% |
| **Modello leggero (principale)** | **82%** | **63%** | **75%** |
| Rete neurale pubblicata dagli autori del dataset (riferimento) | 91% | 88% | 92% |

- Il modello supera nettamente quelli semplici, ma **solo 24 delle sue 38 segnalazioni di pavé sono giuste**. Gli errori più frequenti sono autobloccanti scambiati per pavé (9 casi).
- **Criteri superati: 3 su 5.** Completezza, miglioramento sul modello a colori e assenza di sovrapposizioni sono superati. Precisione (0,63 invece di almeno 0,70) e taratura delle probabilità (errore 0,113 invece di al massimo 0,10) non lo sono.
- Se il modello risponde solo quando è abbastanza sicuro, decide sul 60% delle foto con il 93% di risposte giuste e il 78% di precisione sul pavé.
- Dove il pavé è raro la precisione scende ancora: con una soglia tarata su dati dove il pavé è comune, la precisione passa da 0,80 a 0,64 sulle città di prova.

**Qualità delle prove e limiti.**
- Il risultato vale solo per foto tedesche: su Milano e Roccella non è stato misurato nulla.
- Con solo 32 foto di pavé l'incertezza è ampia: la precisione reale potrebbe stare tra 0,47 e 0,77.
- Il 69% delle foto di prova viene da fotografi presenti anche nell'addestramento.
- Le etichette riguardano una singola foto, non un'intera strada.
- La licenza "condividi allo stesso modo" potrebbe estendersi ai modelli addestrati: serve una verifica legale prima di qualsiasi uso.
- Per applicarlo alle vie sconosciute servirebbero foto recenti di quelle vie.

**Costo.** Circa 12 minuti in tutto, di cui 5 per analizzare le 9.122 foto (33 millesimi di secondo l'una). Le dipendenze Python sono separate dall'app. Nel repository ci sono solo metriche aggregate: nessuna immagine, nessun modello addestrato, nessuna previsione per singola foto.

**NO-GO** per questo modello e per qualunque integrazione. Un eventuale seguito richiederebbe nuove decisioni: prima un piccolo insieme di foto di Milano etichettate a mano per misurare l'applicabilità all'Italia, poi eventualmente una rete neurale con pesi dalla licenza chiara.

---

## Classifica dei quattro esperimenti

| Posizione | Esperimento | Valore dimostrato per il prodotto | Rischio di implementazione | Fattibilità |
|---|---|---|---|---|
| 1 | Classifica dei percorsi | Alto: rende spiegabile e regolabile la funzione principale, provato su percorsi reali | Basso | Alta |
| 2 | Dashboard dati | Medio, indiretto: mostra dove servono dati (Roccella al 22%) | Molto basso | Alta |
| 3 | Sensori di vibrazione | Non ancora dimostrato: solo dati simulati, con un limite strutturale a 60 Hz | Alto (falsi pavé, privacy, batteria) | Media-bassa |
| 4 | Foto del pavé | Basso: provato e respinto (2 criteri su 5 non superati), dati solo tedeschi | Alto (licenza, applicabilità all'Italia, falsi pavé) | Bassa |

Raccomandazione: aprire per prima una fase di integrazione della **classifica dei percorsi**, partendo dal confronto silenzioso in parallelo. Usare la **dashboard** per pianificare i rilievi a Roccella, che migliorano direttamente la qualità dei percorsi. Tenere i sensori nella ricerca, con una prova sul campo solo se se ne vede il valore. Fermare la strada delle foto finché non esiste un piccolo insieme italiano etichettato a mano.

## Verifica indipendente

Per ogni esperimento ho rieseguito io stesso i test e la pipeline, e ho ricalcolato a parte almeno un numero chiave.

| Esperimento | Test | Rielaborazione | Numeri ricalcolati da me |
|---|---|---|---|
| Classifica | 25/25 | identica | 23 deviazioni, 11.884 m di pavé evitato, +57,6 min e +269 m sconosciuti dai dati grezzi; accordo 34/34 con un mio convertitore indipendente |
| Dashboard | 24/24 | identica byte per byte | chilometri per categoria di Milano e Roccella dai dati originali, identici; anomalia del motore riprodotta; pagina aperta nel browser senza richieste esterne |
| Sensori | 57/57 | stessa impronta | precisione e completezza ricalcolate dalle matrici di confusione, identiche |
| Foto | 57/57 | identica (riesecuzione senza rete dai file verificati) | impronte dei file scaricati; precisione, completezza e Wilson ricalcolate dalla matrice di confusione; caratteristiche di 40 immagini rielaborate dall'archivio, identiche |

**Integrità.** I file della Fase 4.17 e della Fase 4.18 non sono stati toccati. I due file CSS modificati sono cambiati durante la giornata a opera della sessione della Fase 4.18.1, non del laboratorio. Gli esperimenti hanno scritto solo nelle proprie cartelle.

## Note

- Il lavoro si è interrotto una volta per il limite di utilizzo ed è ripreso dal punto esatto, senza rifare nulla.
- I rapporti in italiano dei singoli esperimenti 2, 3 e 4 (`report.md` nelle rispettive cartelle) non sono stati creati, perché il sistema impedisce agli agenti secondari di scrivere file di rapporto. Il loro contenuto è riassunto qui; i dettagli tecnici completi sono in `README.md` e `results.json` di ogni cartella.
- I file scaricati (1,2 GB) restano nella cartella temporanea di questa sessione, fuori dal repository, e si possono cancellare in qualsiasi momento.
