# Fase 4.31 · completamento: ZTL di Milano, inversione A/B e casi della prova su strada

8 novembre 2026. Piano di lavoro: `outputs/prompt-phase431-final-ztl-reverse-field-cases.md`. Prove e misure: `outputs/phase431/`.

Tutto è in locale: nessun commit, push o deploy. Il pilota online e Roma non sono stati toccati, e non ho fatto lavori su Cloudflare. Le correzioni delle Fasi 4.29–4.31 sono intatte e verificate di nuovo:
- ricalcolo anti-pavé;
- fusione GPS e freccia;
- popup sul fondo;
- semafori.

Nessuna traccia GPS reale è stata registrata. Dove scrivo «ricostruito» intendo percorsi del vero servizio di routing tra i punti indicati, valutati con il motore di Lastrico, non il tuo viaggio.

## 1. ZTL: cosa è implementato e cosa no

**Fonte.** Solo dati OSM già presenti nel progetto (`scripts/osm/extract-ztl-areas.mjs` → `data/features/milan-ztl-areas.json`). Non esistono perimetri ufficiali nei dati, e non ne ho inventati.

**ZTL verificate, autorizzabili per Auto e Moto:**

| ZTL | Prova nei dati | Quando è attiva |
|---|---|---|
| Quadrilatero della Moda | poligono OSM «ZTL: Quadrilatero della Moda» | tutto il giorno, dalla sua descrizione |
| Arco della Pace | poligono OSM con descrizione | 22:00–06:00 |
| Navigli: Via Magolfa, Borsi, Gola, Fusetti, Argelati, Pichi | regole di accesso sulle vie (Borsi «permit @ 20:00–07:00») e varco ZTL mappato | 20:00–07:00 |
| Corso Giuseppe Garibaldi | 2 varchi ZTL mappati | orari non nei dati: sempre attiva |
| Corso di Porta Ticinese | 2 varchi ZTL mappati | orari non nei dati: sempre attiva |
| Corso Sempione (vie laterali) | `motor_vehicle=permit`, chiusura 22:00–06:00 | come da tag |
| Via Mazzini / Via Dogana | `access=permit` | sempre con permesso |

**Come funziona**
- **Ora di partenza.** Il server valuta le regole all'ora di Milano: quella attuale, oppure `departure=` per le misure.
- **Lettore delle regole OSM** (`lib/access-conditions.ts`). Legge giorni, mesi, fasce oltre la mezzanotte, `PH off` e categorie come residenti.
- **Senza autorizzazione** (il valore predefinito):
  - un percorso che attraversa una ZTL attiva viene escluso;
  - se il servizio di routing passa comunque di lì, Lastrico chiede un percorso che escluda quel tratto;
  - se la ZTL è entro 150 m dalla partenza o dall'arrivo, il percorso resta e l'app lo segnala;
  - se ogni percorso deve attraversarla, l'app lo spiega: «Ogni percorso trovato entra in ZTL …, attiva in questo orario. Se hai l'autorizzazione, attivala in Preferenze › Accessi ZTL».
- **Con autorizzazione.** Il percorso può usare la ZTL e la scheda lo dice («Usa la tua autorizzazione: …»).
- **Cosa l'autorizzazione non sblocca mai:** un `access=no` semplice, le vie pedonali, le strade private, i sensi unici (verificato anche dentro una ZTL autorizzata) e le corsie bus.
- **Per mezzo.** Le regole su `motor_vehicle` riguardano auto e moto, non le bici; ogni mezzo ha la sua autorizzazione.
- **Salvataggio.** Le autorizzazioni restano sul telefono e vengono inviate con ogni calcolo e ogni ricalcolo in navigazione. Cambiarne una ricalcola subito il percorso mostrato.
- **Altre chiusure a orario** (mercati settimanali, strade scolastiche, parchi di notte): 10 gruppi, rispettati ma non autorizzabili, perché non sono ZTL.

**Non gestito, e detto nell'app**
- Area C (a pagamento).
- ZTL senza regole in OSM.
- Giorni festivi.
- Eccezioni per residenti, disabili, carico e scarico.
- Orari dei varchi Garibaldi e Ticinese.

**Due scelte da segnalare**
1. **Via Boccaccio e Via XX Settembre.** Sono le uniche due vie di Milano con «vietato lun–ven 7:30–19:30», cioè esattamente l'orario di Area C. Applicato alla lettera, rendeva Bande Nere → Duomo irraggiungibile in auto. Lo tratto come probabile errore di mappatura: segnalato, non applicato.
2. **Corso Matteotti e Piazza Meda.** Il poligono del Quadrilatero li include. Ho escluso le vie che proseguono fuori dal poligono, come Corso Venezia, e le vie di perimetro indicate nella descrizione. Corso Matteotti e Piazza Meda restano dentro per prudenza: va verificato con la segnaletica.

**Effetto misurato.** Benchmark di 88 viaggi × 3 mezzi, lunedì alle 12:00 e alle 21:00:
- 6 risposte su 264 cambiano: Castello → Porta Venezia, Città Studi → Duomo e Via Manzoni → Porta Venezia, in auto e in moto. Tutte e 6 prima passavano per Via Bigli, Via Monte Napoleone, Via Verri o Corso Matteotti, dentro il Quadrilatero.
- Le altre 258 sono identiche.
- Le bici non cambiano.
- Fuori Milano il comportamento è quello di prima.

**Il caso Largo Promessi Sposi ↔ M4 Vetra**, ricostruito alle 12:00 e alle 21:00, con e senza autorizzazione, in auto, moto e bici (`outputs/phase431/ztl-cases.json`):
- **Effetto delle ZTL:** nessuno dei percorsi proposti dal servizio entra in una ZTL mappata, quindi l'autorizzazione non cambia nulla.
- **Alternative candidate:**
  - Corso di Porta Ticinese è una ZTL con varchi, ma il suo tratto centrale è segnato `access=no` e in **pavé (sett)**. Non è un'alternativa più liscia e non si può sbloccare.
  - La ZTL serale dei Navigli non è su questo tragitto.
- **Le stesse regole funzionano su destinazioni dentro la zona:**
  - Vetra → Via Magolfa alle 21:00: senza autorizzazione arriva la spiegazione; con autorizzazione, un percorso di 2,76 km con 136 m in ZTL.
  - Piazza Cavour → Via Monte Napoleone in auto: senza autorizzazione la spiegazione; con autorizzazione, 2,45 km con 336 m nel Quadrilatero.
  - Lo stesso viaggio in bici non è limitato.

## 2. Inversione partenza/destinazione

**Il controllo c'era già, con l'etichetta «Inverti partenza e destinazione», ma su iPhone non si vedeva.** I due campi indirizzo stavano sopra di lui (livello 15 e 10 contro 2), quindi era praticamente nascosto e non si toccava con sicurezza. Inoltre non ricalcolava.

**Correzioni**
- È sopra i campi e sotto l'elenco dei suggerimenti, con un'area di tocco di 44 px. Screenshot: `outputs/phase431/screenshots/planner-swap-visible-light-390x844.png`.
- Scambia indirizzi e coordinate in un solo passo e svuota i suggerimenti.
- Fa **un solo calcolo**.
- Mantiene mezzo, livello di pavé, minuti extra e autorizzazioni ZTL.
- Mantiene il tipo di percorso: se avevi scelto «Più rapido» rispetto a un'alternativa, resta «Più rapido».
- È disattivato durante la navigazione.

**Prova G4 nel browser (390×844).**
- Cadorna ⇄ Darsena in moto, con «+8 minuti» e la ZTL Navigli autorizzata per la moto.
- Due inversioni producono esattamente 2 richieste; la prima ha partenza e arrivo invertiti, la seconda li riporta com'erano.
- Si mantengono moto, +8 min, ZTL e «Più rapido».
- L'autorizzazione resta salvata sul dispositivo.

Promessi Sposi ↔ Vetra è stato ricalcolato nei due sensi (casi B e C).

## 3. I sei casi della prova su strada

| Caso | Cosa hai osservato | Cosa si ricostruisce | Cosa resta incerto | Accessi e ZTL | Prima → dopo | Stato |
|---|---|---|---|---|---|---|
| **A** Gae Aulenti → Promessi Sposi | GPS lento all'avvio, aggancio iniziale sbagliato, freccia a scatti, ~1 km di pavé non segnalato verso Garibaldi | **Anti-pavé:** 9,06 km, 28,9 min, 252 m di pavé confermato (Principessa Clotilde 128, Repubblica 68, Beatrice d'Este 32). **Più rapido:** 28,4 min, 359 m, passa da Piazza XXV Aprile (54), Piazzale Biancamano (104), Via Legnano e Foro Buonaparte (201) | Il tuo percorso reale e dove sia il km di pavé. Nessuno dei due percorsi passa da Corso Garibaldi | Corso Garibaldi è una ZTL con varchi, non sui percorsi ricostruiti | GPS e freccia: ritardo da 9,0 a 2,5 m nel browser, partenza su percorso ad anello corretta. Il pavé: nessuna riclassificazione | **GPS/freccia corretti in locale**, da provare su iPhone. **Pavé: bloccato dalla mancanza di traccia.** Il candidato più probabile resta XXV Aprile → Biancamano → Via Legnano |
| **B** Promessi Sposi → Vetra | Funzionava; alternative meno comode; un'alternativa più liscia usava una ZTL a cui hai accesso; il ricalcolo a volte era rapido; i minuti extra vanno rispettati | Più rapido: 4,02 km, 14,3 min, 143 m confermati (Via Conca del Naviglio) + 22 m probabili. Degli altri 5 candidati: 4 hanno più pavé (272–1.368 m); il migliore toglie solo 17 m per +2 min, sotto la soglia minima di 20 m | Quale ZTL intendevi. Area C (Vetra è dentro i Bastioni) non è gestita | Navigli serale e Corso di Porta Ticinese: nessun candidato le usa; Ticinese è `access=no` e in pavé | Con +0, +5 e +10 min non c'è un'alternativa con meno pavé, ed è corretto. Sul viaggio D/E: +0 min → nessuna alternativa; +1 min → anti-pavé da 18 s in più | **ZTL implementata; l'alternativa ZTL di questo caso non è verificabile.** I minuti extra sono rispettati |
| **C** Vetra → Promessi Sposi | Doveva girare a sinistra, sei andato a destra; nessun ricalcolo; premendo la freccia di ricentratura è arrivato un ricalcolo rapido | Percorso di 3,67 km, 14 min, 0 m di pavé. **La freccia di ricentratura non ha un ricalcolo suo**: sposta solo la mappa, sia nel codice online sia in quello locale. Spiegazione più probabile: iPhone ha smesso di inviare la posizione (l'app la riattivava solo ogni 20 s) oppure il ricalcolo è fallito sul Worker; il tuo tocco ha coinciso con la ripresa | Quale delle due, senza traccia | Nessuna ZTL | Riconoscimento della svolta sbagliata: da 76 a 60 m. Ora la ricentratura riattiva subito il GPS se l'ultima posizione ha più di 5 s, e la traccia registra riattivazioni e motivo di ogni ricalcolo | **Migliorato e misurabile alla prossima prova; causa non verificata** |
| **D** Porta Vittoria → Beatrice d'Este → «Via Carlo…» | Hai evitato le svolte sul pavé proseguendo verso un'alternativa più avanti | Origine e arrivo **ipotizzati** (Corso di Porta Vittoria → Promessi Sposi). L'anti-pavé di Lastrico fa Caldara → **Filippetti → Beatrice d'Este** → San Gottardo: 6,29 km, 20,8 min, 74 m. Le «Via Carlo» vicine sono Crivelli (a nord, parallela), Patellani e Vittadini (a sud) e Bazzi, tutte in asfalto | Il nome esatto della via e l'incrocio | Nessuna ZTL | La variante forzata su Vittadini passa comunque da Sabotino (459 m di pavé, 21,8 min) e non rappresenta il tuo percorso | **Non verificato per mancanza di dati.** Il percorso anti-pavé di Lastrico segue già Beatrice d'Este |
| **E** Porta Romana / Viale Filippetti | Girare prima su Filippetti evitava un lungo tratto di pavé e accorciava il viaggio. Lo screenshot mostrava «Più rapido» e tratti rossi più avanti | **Più rapido:** da Medaglie d'Oro su **Viale Sabotino** (383 m di pavé) e Ripamonti (126 m), 6,21 km, 20,5 min, 567 m confermati. **Anti-pavé:** Caldara → **Filippetti** (431 m, cemento liscio, doppia carreggiata) → Beatrice d'Este, 6,29 km, 20,8 min, **74 m**. L'alternativa di Filippetti è proprio l'anti-pavé di Lastrico: 18 s in più e 493 m di pavé in meno | Se «Più rapido» l'avevi scelto tu o l'app l'aveva impostato dopo un ricalcolo | Filippetti percorribile in entrambi i sensi, nessuna ZTL | Con il difetto ora corretto, un ricalcolo senza alternative faceva diventare «Più rapido» il resto del viaggio (prova G1) | **Spiegato; corretto se la causa era il ricalcolo** |
| **F** Corso San Gottardo | ~1 km risparmiato nei primi minuti verso Vetra; è asfalto con binari del tram | Il percorso B usa Corso San Gottardo per 611 m nei primi minuti; nei dati tutta la via è asfalto «liscio confermato» (703 m). I binari sono vie separate e non trasformano mai una strada in pavé (test) | — | Nessuna | Invariato | **Preservato e verificato** |

## 4. Altre verifiche richieste

- **Popup sul pavé:** distanza, nome verificato e lunghezza («Tra 230 m — Pavé su Via Legnano per 600 m»). Funziona (prove G2 e F3); non l'ho rifatto.
- **Ritardo della freccia:** 3,7 m in questo giro, 2,5 m nel giro precedente, contro 9,0 m della Fase 4.29 (prova F1, soglia 5 m).
- **Anti-pavé dopo un ricalcolo:** resta attivo (prova G1).
- **Minuti extra:** rispettati (sopra), e mantenuti anche dopo l'inversione (G4).
- **Semafori:** sulla mappa, con copertura dichiarata (G3).
- **«Descrivi la tua preferenza»** era nascosta nella sezione chiusa. Ora la sezione si chiama «Preferenze, ZTL e «Descrivi la tua preferenza»», quindi il campo si trova senza aprirla e senza righe in più (verificato in G4). Nessuna nuova chat.
  - Un primo tentativo con un collegamento separato aggiungeva una riga e riduceva la mappa al 52% dello schermo: il controllo dell'impaginazione l'ha bocciato e l'ho tolto.

## 5. Verifiche

- **TypeScript ed ESLint:** nessun errore.
- **Test automatici: 430/430.** I 12 nuovi in `tests/phase431-ztl.test.mjs` coprono:
  - orari OSM;
  - regola effettiva per mezzo;
  - Navigli alle 12 e alle 21, con e senza autorizzazione;
  - poligoni e perimetri;
  - un `access=no` semplice non sbloccabile;
  - il senso unico dentro una ZTL autorizzata;
  - una ZTL all'arrivo segnalata e non nascosta;
  - Area C;
  - i binari di Corso San Gottardo.
- **Benchmark dei percorsi alle 12:00 e alle 21:00:** 258/264 risposte identiche; le 6 diverse sono spiegate sopra.
- **Prove nel browser (390×844):**
  - 13/13 mirate (G1–G4, A1, A6, A8, A13, A14, B3, B4, F1, F3).
  - **Serie completa: 78/78** al secondo giro. Nel primo giro, 76/78: le 2 prove d'impaginazione D1 erano fallite per il collegamento in più, poi tolto.

## 6. Limiti che restano

- Le ZTL valgono quanto i dati OSM.
  - Mancano i perimetri ufficiali.
  - Mancano gli orari dei varchi Garibaldi e Ticinese.
  - Il poligono del Quadrilatero potrebbe includere Corso Matteotti e Piazza Meda per errore.
- Area C e i festivi non sono gestiti; l'app lo dice.
- Per i casi A, C e D serve la traccia GPS della prossima prova. Senza traccia non posso confermare né il km di pavé né la causa del ricalcolo mancato.
- Niente qui è una prova su un iPhone vero. Il rilascio resta legato alle condizioni della Fase 4.31: Workers Paid, la tua autorizzazione e il metodo che esclude Roma.
