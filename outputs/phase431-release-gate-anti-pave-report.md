# Fase 4.31 · verifica di rilascio: perché l'anti-pavé a volte non veniva offerto

8 novembre 2026. Tutto in locale: nessun commit, push o deploy. Il pilota online (`03a6776e`) e Roma non sono stati toccati.

Prove in `outputs/phase431/`:
- `filippetti-gate.json`: versione pubblicata e locale, casi Porta Romana;
- `anti-pave-availability-*.json`: benchmark di Milano;
- `reroute-bench/gate`: ricalcoli;
- `screenshots/`.

**Metodo**
- **Versione pubblicata:** ho fatto girare il codice esatto di `03a6776e` (la copia del rilascio del 7 novembre) accanto al codice locale.
- **Dati comuni:** gli stessi dati stradali di Milano e le stesse risposte reali del servizio di routing, registrate e riproducibili.
- **Cosa non so:** l'origine del tuo viaggio e il mezzo non sono stati registrati. Ho provato l'origine ipotizzata, Corso di Porta Vittoria, e tre punti reali dell'avvicinamento a Piazzale Medaglie d'Oro (Viale Regina Margherita e Viale Caldara), in auto e in moto, sia nel calcolo iniziale sia nel ricalcolo durante la navigazione.

## 1. Perché l'anti-pavé non era disponibile nella tua navigazione

Non dipendeva dalla tua scelta. Ho escluso le altre ipotesi:
- **ZTL:** sul tratto non ce ne sono.
- **Filtro dei percorsi uguali:** il percorso via Filippetti è davvero diverso.
- **Risposta del server:** i percorsi arrivano interi all'app.

Le cause misurate sono tre.

1. **Nella versione pubblicata, i ricalcoli durante la navigazione non cercavano un percorso anti-pavé.** Cercavano solo tra le alternative del servizio di routing e al massimo una deviazione. Sull'avvicinamento a Porta Romana l'unico candidato che evita Viale Sabotino è proprio quello della ricerca anti-pavé, quindi:
   - **in moto**, da Viale Regina Margherita o Viale Caldara, il ricalcolo dava solo il percorso via **Viale Sabotino**, con 522 m di pavé su quella via e 524–543 m in totale, etichettato «Più rapido» e senza alternative;
   - lo stesso calcolo fatto prima della partenza, dallo stesso punto, sceglie Filippetti con 69 m.

   Corretto nella Fase 4.31: ora anche i ricalcoli cercano l'anti-pavé.
2. **Sempre nella versione pubblicata, dopo un ricalcolo senza alternative l'app chiedeva solo «il più rapido» fino all'arrivo.** In auto, vicino a Medaglie d'Oro, un ricalcolo successivo avrebbe avuto l'alternativa da 14 m di pavé, ma l'app mostrava comunque Sabotino. Corretto nella Fase 4.31.
3. **Difetto trovato ora, presente anche nel codice locale.** Se il servizio di routing proponeva già un'alternativa con meno pavé, la ricerca anti-pavé non partiva, anche quando quell'alternativa costava molto tempo.
   - In auto da Viale Regina Margherita l'app offriva solo un anti-pavé con **6,4 minuti in più** (32 m di pavé).
   - Il percorso via Filippetti, con 69 m di pavé e senza tempo in più, non veniva nemmeno generato.
   - **Correzione:** un'alternativa già trovata ferma la ricerca solo se costa al massimo 90 s o l'8% del viaggio; altrimenti la ricerca parte e la scelta finale confronta tutto.

**Il quadro più coerente con il tuo screenshot** («Più rapido», tratti rossi dopo Medaglie d'Oro): il percorso mostrato veniva da un ricalcolo della versione pubblicata. In moto la causa è la 1; in auto le cause 1 e 2 insieme. Senza la traccia GPS non posso sapere quale ricalcolo l'abbia prodotto.

## 2. Il percorso via Filippetti ora si può scegliere?

**Sì.**
- **Dalla stessa origine ipotizzata:** l'app propone due percorsi diversi, preselezionando l'anti-pavé.
  - **Anti-pavé:** 6,3 km, 20,8 min, **74 m** di pavé, lungo Viale Filippetti per 435 m.
  - **Più rapido:** 6,2 km, 20,5 min, **567 m**, lungo Viale Sabotino.
  - **Frase sopra le schede:** «Evita 493 m di pavé confermato, con 0,3 minuti in più».
- **In tutti i 16 casi dell'avvicinamento** (auto e moto, calcolo iniziale e ricalcolo), la versione locale offre un'alternativa anti-pavé oppure un percorso più rapido che è già anti-pavé. Ogni volta evita 445–510 m di pavé rispetto al percorso standard del servizio di routing.
- **Quando il più rapido è già il percorso anti-pavé** (succede sull'avvicinamento, dove via Filippetti è perfino 9 s più rapida di Sabotino), ora l'app lo dice:
  - scheda «**Più rapido e anti-pavé**» con la frase «Il percorso più rapido è già quello anti-pavé: evita 445 m di pavé del percorso standard, senza tempo in più»;
  - stessa etichetta durante la navigazione.
- **Verificato nel browser a 390×844:**
  - **H1:** schede, frase, scelta nei due sensi e avvio della navigazione con l'etichetta «Anti-pavé».
  - **H2:** il caso «più rapido e anti-pavé».
- **Screenshot** in `outputs/phase431/screenshots/routes-filippetti-light-390x844.png`. Gli indirizzi nella prova sono segnaposto; il percorso è quello reale.

## 3. Quanto spesso manca un'alternativa utile (benchmark di Milano)

88 viaggi × auto, moto e bici = 264 casi, lunedì alle 12:00, con il codice locale corretto.

| Esito | Casi |
|---|---:|
| Alternativa anti-pavé offerta | 137 (52%) |
| Il più rapido è già anti-pavé | 9 (3%) |
| Niente pavé da evitare (meno di 20 m in auto, 15 in moto, 12 in bici, o tratti troppo corti per essere aggirati) | 65 (25%) |
| Nessun percorso migliore trovato | 44 (17%) |
| Il percorso con meno pavé è vietato (ZTL, divieti, sensi unici) | 8 (3%) |
| Errore (bici, Arco della Pace → Duomo, già prima) | 1 |

**Cosa significa**
- **Dove c'è pavé da evitare** (198 casi), Lastrico propone qualcosa di meglio del percorso standard nel 74% dei casi.
- **Nei 44 casi «nessun percorso migliore»:**
  - 37 volte il candidato migliore toglie meno di 100 m;
  - 7 volte toglie più di 100 m entro 5 minuti, ma la regola di scelta lo scarta. Le ragioni: aggiunge pavé confermato per togliere masselli probabili (Moscova → Crocetta: +24 m confermati, −388 m probabili), oppure il tempo in più supera ciò che il livello «Forte» accetta. Questa regola è della Fase 4.25 e non l'ho cambiata.
- **Le spiegazioni sono ora distinte.** L'app dice esplicitamente:
  - «nessuna alternativa migliore»;
  - «ricerca fallita» oppure «ricerca non eseguita»;
  - «supera i minuti extra»;
  - «percorso con meno pavé vietato».
- **Effetto della correzione 3** sui percorsi calcolati prima della partenza:
  - **Pavé noto mostrato:** da 84,9 a **80,9 km**. Il pavé confermato scende da 53,6 a 50,5 km.
  - **Casi cambiati:** 16. In molti si ottiene meno pavé e meno tempo insieme: Nolo → Piazza Fontana passa da 429 m e 21,3 min a 155 m e 19,3 min; Porta Genova → San Babila in auto da 456 m e 15,9 min a 231 m e 13,1 min.
  - **Un caso peggiora sul pavé**, per la regola di scelta già in vigore: Porta Genova → San Babila in moto, 683 m invece di 456, ma 3,5 minuti più rapido.
  - Ho applicato la correzione solo all'avvio della ricerca anti-pavé, non alle deviazioni successive. Applicata anche lì costava fino a 3 richieste in più e cambiava altri 2 casi senza aiutare Filippetti.

## 4. Risparmi reali e costo in tempo

**Calcolo prima della partenza, 264 casi**
- **Pavé noto:** quello dei percorsi standard del servizio di routing è di 146,9 km; con Lastrico se ne percorrono **80,9 km** (−45%).
- **Tempo:** in media 49 s in più a viaggio rispetto al percorso standard.

**Ricalcoli durante la navigazione**, 201 svolte sbagliate simulate su strade reali, rispetto al comportamento della versione pubblicata:

| | Pubblicata | Locale |
|---|---:|---:|
| Pavé confermato sul resto del viaggio | 46,3 km | **41,5 km** (−10%) |
| Pavé probabile | 28,6 km | 25,4 km |
| Ricalcoli che mostrano un'alternativa anti-pavé | 51 | **71** |
| Tempo in più rispetto al più rapido, medio | +23 s | +35 s |
| Attesa stimata del ricalcolo, mediana / 95° percentile | 1,2 / 1,4 s | **1,3 / 2,5 s** |

- **Secondo ricalcolo dopo un primo senza alternative** (78 casi): con l'obiettivo mantenuto il pavé confermato scende da 15,5 a 13,6 km.
- **Costo:** nei ricalcoli più lenti l'attesa sale, perché la ricerca anti-pavé fa una richiesta in più al servizio di routing; la mediana resta quasi uguale.

## 5. Limiti che restano

- **Generazione dei candidati.** Lastrico lavora sui candidati del servizio di routing, più la ricerca che penalizza il pavé e alcune deviazioni. Non esplora tutta la rete stradale, quindi un percorso migliore può esistere senza essere generato. Nei 44 casi senza alternativa non posso escluderlo.
- **Regola di scelta.** Resta prudente sul pavé confermato e sul fondo sconosciuto (sopra). Cambiarla è una decisione di prodotto.
- **Dati OSM.** Restano il limite per il pavé non mappato (caso A) e per le ZTL.
- **Ricalcoli più lenti nei casi peggiori:** 2,5 s al 95° percentile invece di 1,4.
- **Nessuna prova su iPhone vero** di questa correzione. Origine e mezzo del caso Filippetti restano ipotesi finché non c'è una traccia.

## Verifiche

- **TypeScript ed ESLint:** nessun errore.
- **Test automatici: 436/436.** Due test esistenti di `tests/routes-api.test.mjs` sono stati aggiornati:
  - uno verificava il vecchio comportamento (ricerca ferma da un'alternativa con +25% di tempo) ed è stato adattato alla nuova regola;
  - l'altro, sulle deviazioni superflue, passa di nuovo dopo il ripristino.
  - Nuovo `tests/phase431-anti-pave-gate.test.mjs`: il vero motore su 15 risposte reali registrate nel repository (`tests/fixtures/phase431-anti-pave`, 76 KB).
  - Casi coperti: alternativa utile via Filippetti, ricerca che deve partire, ricalcolo in moto via Filippetti, ricerca fallita segnalata come tale, minuti extra a 0, nessun miglioramento (Promessi Sposi → Vetra).
  - Con il codice pubblicato, il primo test di ricalcolo e quello della ricerca fallirebbero.
- **Prove nel browser a 390×844: 81/81**, sulla build finale.
  - **Nuove:** H1 (alternativa utile, scelta e avvio della navigazione), H2 (più rapido già anti-pavé) e H3 (nessun miglioramento, ricerca fallita, accesso vietato, limite di +2 minuti, distinti).
  - **Già presenti:** G1 (anti-pavé mantenuto nei ricalcoli), A8 (la scelta cambia la linea seguita), B3.
- **Percorsi calcolati prima della partenza:** cambiano solo per la correzione 3 (16 casi) e per le ZTL (6 casi), tutti spiegati sopra.
- **Compatibilità di esecuzione:** stessa architettura e stesse dipendenze. Nessuna nuova analisi di Cloudflare.

## GO/NO-GO per un rilascio separato solo Milano

**GO del prodotto**, perché:
- il percorso via Filippetti ora viene offerto, si può scegliere e viene seguito;
- l'anti-pavé resta attivo anche nei ricalcoli;
- un singolo percorso non viene più presentato come se mancasse l'anti-pavé.

**Il rilascio resta bloccato dalle condizioni già note**, che dipendono da te:
- Workers Paid, perché sul piano gratuito i percorsi vengono interrotti (Fase 4.30);
- la tua autorizzazione esplicita per commit e deploy;
- il metodo selettivo che esclude Roma;
- le verifiche in produzione.

**Dopo il rilascio serve una prova su strada** sul tratto Porta Romana → Filippetti, con la traccia GPS registrata.
