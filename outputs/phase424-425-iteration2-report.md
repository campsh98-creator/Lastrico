# Fasi 4.24–4.25, seconda iterazione — Milano: qualità dei dati e percorsi anti-pavé

7 novembre 2026. Branch `fix/mobile-navigation-stability`. Prompt di esecuzione: `outputs/prompt-phase424-425-iteration2-milan.md`.

**Il lavoro su Milano non è salvato su Git:** aspetta la tua revisione. Niente push, merge o deploy: il pilota online resta `bf3e13d5`.

## 1. Roma messa al sicuro (commit locali, non inviati)

| Commit | Contenuto |
|---|---|
| `e084138` | Fonti OSM di Roma con checksum e provenienza (licenza ODbL) |
| `6b77681` | Script di compilazione e compressione, metadati, 378 tile compresse con impronta SHA-256, test |
| `2b56e3b` | Area Roma nell'app, nella ricerca indirizzi e nel calcolo dei percorsi |
| `7bc22ff` | Strumenti e prove di validazione della Fase 4.23, resoconto della Fase 4.27 |

- **Esclusi da Git solo i file intermedi:** l'archivio compatto (50 MB) e le 378 tile JSON (55 MB). Ho verificato che si ricostruiscono identici byte per byte dalle fonti.
- **Senza quei file Roma funziona lo stesso:** l'app e i test leggono le tile compresse. Su una copia pulita dei commit passano 15 test di Roma su 15.
- `origin` è fermo a `66bdccd`: Roma non è stata inviata né pubblicata.

## 2. Difetti di Milano esaminati

| Caso | Esito |
|---|---|
| **3 percorsi in bici rifiutati** (Arco della Pace → Duomo, Centrale → Piazza Fontana, Piazza Fontana → San Babila) | **Difetto confermato.** Partenza o arrivo cadono su via Pattari o via Santa Margherita. In OpenStreetMap sono chiuse ai veicoli (`access=no`) ma aperte ai pedoni (`foot=yes`). Bastavano 46–91 m all'inizio o alla fine per scartare tutto il percorso, anche se scendere e spingere la bici è consentito. L'archivio non conservava il dato sui pedoni, quindi l'app non poteva distinguere. |
| 9 casi con un'alternativa utile scartata | **Non è un difetto.** Ognuna aggiunge tratti non verificati (da +134 m a +26 km) o pavé probabile, oppure risparmia meno dei 100 m minimi. Le regole prudenti funzionano come previsto. |
| 1 deviazione "inutile" (Maciachini → Moscova in bici) | **Non è un difetto.** Evita 120 m di pavé confermato con 4 minuti in più: appena oltre la soglia di valutazione del benchmark, ma dentro i limiti di "Forte". |
| Circa 5,4 s sui percorsi più pesanti in centro | **Non è un difetto.** Le richieste al servizio di routing pubblico sono distanziate apposta di 1,05 s, come chiede il servizio stesso. |

## 3. Correzione (solo Milano)

- **Archivio di Milano.** Ora conserva anche il dato sull'accesso pedonale (`foot`). Ho verificato che è l'unica differenza: i 104.463 tratti hanno geometrie, fondi, nomi e accessi identici, e il dato è stato aggiunto a 9.127 di essi. L'archivio resta riproducibile dalle fonti.
- **Regola.** Solo per la bici, e solo entro 150 m dalla partenza o dall'arrivo, un tratto chiuso ai veicoli ma aperto ai pedoni non blocca più il percorso. Diventa un tratto "a piedi". Restano bloccanti:
  - lo stesso tratto in mezzo al percorso;
  - un divieto esplicito per le bici (`bicycle=no`);
  - il senso vietato;
  - auto e moto, che non cambiano.
- **Avviso onesto.** Il pannello dei percorsi mostra in modo visibile: «Alla partenza o all'arrivo, per circa 91 m la via è pedonale: scendi e prosegui a piedi con la bici.» Il dettaglio del percorso indica anche quale percorso lo richiede. Screenshot in `outputs/phase424-425-iteration2/`.
- **Roma e Roccella.** Comportamento invariato: la regola è attiva solo per Milano, finché non viene verificata anche lì.

## 4. Risultati prima/dopo (benchmark, stessi 264 casi, stesso metro)

| Misura | Prima | Dopo |
|---|---:|---:|
| Percorsi validi e legali | 261/264 | **263/264** |
| Percorsi rifiutati (tutti in bici) | 3 | 1 |
| Alternative anti-pavé scelte | 137 | 140 |
| Pavé confermato evitato rispetto al più rapido | 52,75 km | **53,67 km** |
| Alternative che aggiungono pavé confermato | 0 | 0 |
| Deviazioni inutili | 1 | 1 |
| Casi con molto pavé che ricevono un'alternativa | 122/154 | 125/156 |
| Esito stabile con coordinate spostate di circa 22 m | 70/90 | 71/90 |
| Quota non verificata sui percorsi scelti | 7,7% | 7,7% |

- **Cosa cambia: 4 casi, tutti in bici e tutti vicino a Piazza Fontana.**
  - **Centrale → Piazza Fontana:** prima rifiutato, ora un percorso che passa da 731 a 298 m di pavé confermato.
  - **Piazza Fontana → San Babila:** prima rifiutato, ora da 298 a 165 m di pavé confermato.
  - **Conciliazione → Piazza Fontana:** ora riceve un'alternativa, da 851 a 546 m di pavé confermato per 54 s in più.
  - **NoLo → Piazza Fontana:** il percorso scelto non cambia.
- **Nessun altro caso cambia.** Auto e moto sono identici a prima.
- **Arco della Pace → Duomo in bici resta rifiutato, correttamente.** Il tratto chiuso alle bici (via Santa Margherita) è a circa 200 m dall'arrivo, cioè in mezzo al percorso.
- **Pavé confermato sui percorsi scelti:** il totale passa da 51,75 a 51,91 km solo perché ora contiene i 2 percorsi prima rifiutati. Sugli stessi 261 casi di prima scende di 305 m.

## 5. Copertura di Milano per modalità

Non cambia con questa correzione: i fondi non sono stati toccati.

| | Rete con fondo noto | Pavé confermato | Pavé probabile | Non verificato | Quota non verificata sui percorsi scelti del benchmark |
|---|---:|---:|---:|---:|---:|
| Auto | 88,6% di 1.110,9 km | 44,8 km | 19,5 km | 126,5 km | 9,5% |
| Moto | 88,0% di 1.125,7 km | 45,1 km | 19,7 km | 135,2 km | 7,4% |
| Bici | 88,1% di 1.277,1 km | 54,8 km | 33,5 km | 151,6 km | 5,8% (prima 5,9%) |

## 6. Regressioni

- **Controlli automatici:**
  - TypeScript ed ESLint senza errori.
  - **376 test su 376**, compresi:
    - i test di Roma;
    - la riproducibilità degli archivi di Milano e Roccella;
    - i nuovi test della regola e dell'API.
- **Build e dry-run riusciti:** il pacchetto pesa 26,56 MiB, con Roma, contro il limite di 64.
- **Prova mobile** (Chrome emulato, Worker locale, temi chiaro e scuro): **71 scenari su 71**. Comprende:
  - il nuovo scenario dell'avviso «scendi e prosegui a piedi»;
  - i viaggi reali a Milano e Roccella;
  - la ricerca indirizzi della Fase 4.22.
- **Verifica reale sul Worker locale:** Centrale → Piazza Fontana in bici ora risponde con un percorso (pavé confermato da 731 a 298 m) e con l'avviso. In auto la stessa tratta funziona come prima.

## 7. Limiti

- L'indicazione di scendere dalla bici è nel pannello del percorso, non ancora tra le istruzioni vocali di navigazione.
- "Confermato" significa tag OSM, non rilievo sul campo. In molte zone pedonali di Milano la bici è ammessa anche se OSM non lo dice: l'app resta prudente.
- Nessuna prova su iPhone fisico. La CPU reale va misurata su Cloudflare.
- **I commit di Roma stanno sotto quelli futuri di Milano sullo stesso branch.** Un push o un deploy dal branch includerebbe anche Roma. Per pubblicare solo Milano serve la stessa procedura senza Roma usata nella Fase 4.26.

## 8. GO/NO-GO

- **GO per la revisione** delle modifiche di Milano, non salvate su Git:
  - codice: `lib/road-intelligence-scoring.ts`, `app/api/routes/route.ts`, `app/page.tsx`, `scripts/osm/compile-compact-tiles.mjs`;
  - dati: l'archivio di Milano, cioè `milan-compact-tiles.json`, il suo manifest e 109 delle 117 tile (le altre 8 non hanno tratti con il dato pedonale);
  - test: `route-restrictions`, `routes-api`, `phase424-surface-rules`, `tests/e2e/acceptance.mjs`;
  - resoconti in `outputs/`.
- **NO-GO per la pubblicazione adesso.** Prima servono:
  1. la tua revisione e l'autorizzazione al commit;
  2. la decisione su come pubblicare Milano senza Roma;
  3. smoke test in produzione;
  4. una prova su iPhone, soprattutto un arrivo in bici a Piazza Fontana.
