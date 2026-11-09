# Fase 4.33 · Affidabilità di Milano sul piano gratuito di Cloudflare

9 novembre 2026. Base: `main` a `e30ccf5`. Piano di lavoro: `outputs/prompt-phase433-milan-workers-free-reliability.md`. Prove: `outputs/phase433/`.

**Cosa non è stato fatto:**
- nessun commit, push o merge;
- nessuna modifica al pilota pubblico, che resta `03a6776e`;
- Roma e Roccella non sono state toccate: il codice condiviso dà risultati identici.

**Unica pubblicazione, autorizzata:** un Worker di prova separato, `lastrico-free-test`, per verificare la soluzione su Cloudflare (§6 bis).

## 1. Causa degli errori del Worker

**Prova nuova: le statistiche reali di Cloudflare.** Le ho lette in sola lettura, senza mandare traffico al pilota (`outputs/phase433/production-analytics-*`).

| Giorno, versione `03a6776e` | Riuscite | Interrotte (`exceededResources`) | CPU delle riuscite (p50 / p90 / p99) |
|---|---:|---:|---|
| 7 nov, uso reale | 291 | 1 | 7 / 33 / 442 ms |
| 8 nov, uso reale | 108 | 7 | 13 / 208 / 607 ms (tutto il giorno) |
| 8 nov, mia prova controllata (14 richieste in 1 minuto) | 2 | 12 | — |
| 9 nov | 44 | 0 | 17 / 63 / 90 ms |

**Cosa dicono questi dati**
- **È la CPU, sempre.** Ogni interruzione avviene a 10 ms di CPU. Non c'è nessuna interruzione per memoria (`exceededMemory`), nessuna per il servizio di routing, nessuna per durata o numero di richieste (al massimo 7 per percorso, il limite è 50).
- **Gli errori 1102 e 503 sono la stessa interruzione.** Le voci `clientDisconnected` sono invece persone che hanno chiuso la pagina, non errori.
- **Non è un limite rigido a ogni richiesta.** Sono riuscite richieste fino a 985 ms. La documentazione conferma che ogni isolato tollera sforamenti occasionali e interrompe quando diventano costanti.
- **Gli errori arrivano a raffiche:**
  - una serie di percorsi pesanti, come nella mia prova;
  - una navigazione con ricalcoli ravvicinati.
- **La diagnosi della Fase 4.30 era troppo pessimista.** Nell'uso reale del 7–8 novembre il pilota ha sbagliato circa lo 0,3% e il 5,5% delle richieste, non quasi tutte. Il 100% di errori riguardava la raffica di prova. Ho corretto README e `docs/ENGINEERING_STATUS.md`.

**Limiti ufficiali del piano gratuito** ([pagina dei limiti](https://developers.cloudflare.com/workers/platform/limits/), letta oggi):
- CPU: 10 ms per richiesta, con tolleranza per isolato.
- Memoria: 128 MB per isolato.
- Sottorichieste: 50.
- Connessioni simultanee: 6.
- Avvio: 1 s.
- Durata: nessun limite.
- Richieste: 100.000 al giorno.

## 2. CPU e memoria, prima e dopo

Le misure sono fatte con le risposte di routing registrate, sullo stesso codice che gira su Cloudflare.

| Misura (Node, locale) | Prima | Dopo | Variazione |
|---|---:|---:|---:|
| **Calcolo percorso, isolato già caldo** (264 casi, mediana di 3 esecuzioni) | mediana 14 ms · p90 42 · p99 117 · max 200 | mediana **9 ms** · p90 **26** · p99 **57** · max 149 | CPU totale **−39%** |
| Calcoli entro i 10 ms | 39% | **59%** | |
| **Ricalcoli in navigazione** (275) | mediana 8 ms · p90 25 · p99 91 | mediana **7** · p90 **20** · p99 **61** | CPU totale **−20%** |
| Ricalcoli entro i 10 ms | 59% | **69%** | |
| **Prima richiesta di un isolato nuovo** (14 percorsi pesanti, auto) | mediana 275 ms, 19–379 | mediana **174 ms**, 19–281 | −37% |

**Memoria:**
- **Riquadri:** la memoria resta limitata a 64, come nella Fase 4.30 (76 MB).
- **Memoria dei tratti:** vale per una sola richiesta, al massimo circa 1 MB.
- **Processo di prova:** il picco passa da 486 a 497 MB (+2%). La cifra comprende il compilatore TypeScript e il banco di prova, non è l'isolato di Cloudflare.

**Il profilo** (`outputs/phase433/profile-before.txt` / `-after.txt`): il confronto dei percorsi con le strade OSM scende da 3,97 a 2,18 s sull'intero benchmark (−45%). Era il 59% della CPU.

## 3. Ottimizzazioni fatte

**Risultati identici:**
1. **Memoria dei tratti condivisi** (`EdgeMemo`, `lib/road-intelligence-scoring.ts`).
   - I percorsi candidati di una richiesta hanno in comune quasi metà dei tratti: il 46% del lavoro misurato.
   - Ora ogni tratto viene confrontato con le strade una sola volta per richiesta.
   - Il risultato non viene riusato se il tratto ha letto zone della mappa non ancora caricate. Un test verifica che, togliendo questa protezione, l'errore viene trovato.
2. **Ricerca delle strade vicine:**
   - i campioni consecutivi riusano l'ultima zona della griglia;
   - le chiavi sono numeriche e verificate esattamente;
   - ci sono meno oggetti temporanei;
   - la lunghezza di ogni tratto viene calcolata una volta sola.
3. **Tratti già penalizzati:** quelli lontani più di 8 m vengono scartati con un controllo esatto sul riquadro. Il costo passa da 205 a 49 ms sull'intero benchmark.

**Architettura (gratuita):**

4. **Calcolo dei percorsi in un Durable Object** (`worker/route-engine.ts`, `worker/index.ts`, `vite.config.ts`).
   - **Perché funziona sul piano gratuito:** i Durable Objects con archivio SQLite sono inclusi nel piano gratuito e hanno **30 secondi di CPU per richiesta** ([limiti](https://developers.cloudflare.com/durable-objects/platform/limits/)).
   - **Cosa fa il Worker:** inoltra soltanto `/api/routes` a uno di 8 oggetti, e tutto il resto resta com'era.
   - **Risultati identici:** l'oggetto esegue la stessa app.
   - **Se l'oggetto non risponde,** per esempio perché la quota giornaliera è finita, il Worker calcola come prima e lo registra nei log.
   - **Verifica in produzione:** le risposte portano l'intestazione `x-lastrico-route-engine: durable-object`, così una prova futura può controllare dove è avvenuto il calcolo.

**Rilascio solo Milano, ripetibile:**

5. **`scripts/prepare-milan-release.mjs`** prepara la copia solo Milano e Roccella dello stato di lavoro.
   - Elimina i file aggiunti da Roma.
   - Toglie le modifiche di Roma dai 6 file condivisi con un'unione a tre vie.
   - Toglie i 2 blocchi di Roma del gestore dei percorsi con una sostituzione verificata.
   - Ricrea esattamente la copia pubblicata su `lastrico-free-test`.
6. **`npm run deploy:pilot` rifiuta ogni pacchetto che contiene Roma,** anche in prova senza caricamento.
   - Su `main` il rifiuto è verificato: 382 elementi di Roma trovati.
   - Sulla copia solo Milano la prova senza caricamento passa.
   - Il lavoro su Roma resta intatto su `main`.

**Non fatto, apposta:**
- nessuna ricerca di alternative è stata tolta o ridotta;
- nessun calcolo è stato spostato nel telefono: i dati del fondo di tutta Milano sono troppo pesanti da scaricare.

## 4. Qualità dei percorsi

Le ottimizzazioni non cambiano nessun risultato:
- **Calcolo dei percorsi:** identici **354 su 354**, cioè i 264 casi più le 90 varianti di stabilità.
- **Ricalcoli:** identici **275 su 275**.
- **Casi nominati:** identici prima e dopo:
  - ZTL;
  - Largo Promessi Sposi → M4 Vetra, con Corso San Gottardo;
  - Porta Vittoria / Filippetti;
  - le tre prove su strada.

Quindi pavé confermato evitato, pavé probabile, fondo sconosciuto, alternative offerte, ZTL e permessi restano uguali.

Ho trovato un limite che c'era già: per 7 casi ZTL mancano risposte nell'archivio, quindi quei casi non si possono rifare offline. Sono uguali prima e dopo.

## 5. Filippetti e Moscova

- **Porta Romana / Filippetti (auto):** anti-pavé 20,8 min con 74 m di pavé, contro 20,5 min e 567 m.
  - Ottenuto nei test e con una richiesta reale calcolata **dentro il Durable Object**.
- **Moscova → Crocetta (auto):**
  - **Risultato:** l'alternativa è offerta: +24 m di pavé confermato e −388 m di masselli, 17,2 contro 15,6 min.
  - **Dove:** nei test e con una richiesta reale nel Durable Object.
  - **Ripetizione:** una seconda richiesta uguale dà un risultato identico.

## 6. Test

- **Test automatici: 447 su 447**, cioè i 440 di prima più 7 nuovi:
  - memoria dei tratti: uguaglianza esatta, zone caricate a metà calcolo, contesti diversi;
  - Durable Object: instradamento, ripiego, intestazione, configurazione SQLite.
- **TypeScript, ESLint e build:** senza errori.
- **Server locale con il runtime Cloudflare (`wrangler dev`):**
  - richieste servite dal Durable Object;
  - primo calcolo e calcolo ripetuto;
  - due richieste in parallelo;
  - ricalcolo in navigazione;
  - input errato rifiutato.
- **Prova completa nel browser, telefono simulato:** **81 scenari su 81**. Comprende i viaggi reali a Milano e Roccella, che ora passano dal Durable Object.
- **Prova di pubblicazione senza caricamento (`npm run deploy:pilot -- --dry-run`):** riuscita.
  - Il pacchetto vede il Durable Object `ROUTE_ENGINE` e il database D1, e pesa 27,3 MB contro un limite di 64.
  - **Attenzione:** questo pacchetto è l'attuale `main` e **contiene Roma**. Non va pubblicato così: un rilascio solo Milano deve usare il metodo che esclude Roma.
- **Non verificato:** prova su iPhone fisico.

## 6 bis. Verifica su Cloudflare (piano gratuito, Worker di prova)

Con la tua autorizzazione ho pubblicato una copia **solo Milano e Roccella** su un Worker separato:
- **Indirizzo:** https://lastrico-free-test.campsh.workers.dev, versione `44a8466a`.
- **Il pilota non è stato toccato.**
- **Roma esclusa** con il metodo della Fase 4.28: tolti i file di Roma e annullate le sue modifiche nei file condivisi.
  - Nel pacchetto non ci sono moduli, dati o testi di Roma.
  - La copia passa **438 test su 438**, cioè i 447 meno i 9 di Roma.
- **Senza database di produzione:** il Worker di prova non è collegato al D1 del pilota.

**Prova controllata:**
- **Richieste:** 20 di percorso e 2 della pagina, sui percorsi del benchmark.
  - 8 calcoli pesanti, uno ogni 4 s;
  - una **raffica di 6**, una ogni 2 s, come quella che il 8 novembre aveva bloccato il pilota;
  - 4 ricalcoli in navigazione;
  - 2 richieste in parallelo.
- **Registro:** `wrangler tail` acceso, con le prove in `outputs/phase433/free-test-*.json`. Contengono solo esiti e tempi: niente IP, intestazioni o coordinate.

| Cosa | Richieste | CPU per richiesta | Esito |
|---|---:|---|---|
| Worker principale che inoltra i percorsi | 20 | 0–2 ms | **20 ok** |
| **Durable Object che calcola i percorsi** | 20 | **mediana 156 ms, massimo 314 ms** | **20 ok, nessuna interruzione** |
| Pagina principale | 5 | 6–37 ms | 5 ok |

**Cosa mostra la prova**
- **Il Durable Object ha usato fino a 31 volte i 10 ms** senza interruzioni, anche nella raffica e con l'isolato appena creato. Il limite di CPU del piano gratuito non lo riguarda, come dice la documentazione.
- **I risultati coincidono con quelli locali:**
  - Filippetti: 20,5 → 20,8 min, da 567 a 74 m di pavé;
  - Moscova → Crocetta: da 940 + 388 m a 964 m, senza tratti probabili;
  - Castello → Porta Venezia: da 1022 a 383 m.
- **Tempo per la persona:** 1–6 s per calcolo, dovuti all'attesa del servizio di routing.

**Da sapere: quota gratuita e pagina principale**
- **Ogni richiesta resta attiva più a lungo della risposta.** Nel Durable Object dura 4–12 s, contro 1–6 s di risposta, perché i timer di scadenza delle chiamate al servizio di routing (`AbortSignal.timeout`) restano in sospeso.
  - Con 128 MB fanno 0,5–1,5 GB-s per percorso. La quota gratuita è di 13.000 GB-s al giorno.
  - Non indico una capacità giornaliera garantita: dipende da quanto si attende il servizio di routing, dai ricalcoli e dal traffico. 20 richieste non bastano per stimarla.
  - Annullare quei timer a risposta arrivata accorcerebbe la durata e quindi il consumo. È un piccolo miglioramento successivo; non l'ho fatto.
- **La pagina principale ha usato fino a 37 ms**, oltre i 10. È passata grazie alla tolleranza, ma resta il punto più fragile rimasto nel Worker principale.

## 7. Limiti che restano sul piano gratuito

- **Senza Durable Object il piano gratuito non regge.** Anche ottimizzato, il calcolo resta sopra i 10 ms nel 41% dei casi a isolato caldo. A isolato nuovo, i percorsi pesanti richiedono 64–281 ms, cioè 6–28 volte il limite: con poco traffico è il caso più comune.
- **Con il Durable Object:**
  - **Quote giornaliere gratuite:** 100.000 richieste e 13.000 GB-s. Il consumo misurato è di 0,5–1,5 GB-s per percorso, aumentato dai timer in sospeso (§6 bis). Nessuna capacità giornaliera è garantita: se una quota finisce, il Worker calcola da sé, come prima, con il rischio di CPU.
  - **Ogni oggetto calcola un percorso alla volta,** quindi ce ne sono 8.
  - **La pagina principale resta nel Worker,** con 6–16 ms di CPU: oggi passa grazie alla tolleranza.
- **Il servizio di routing gratuito (FOSSGIS)** resta il limite di velocità: circa 1 richiesta al secondo per isolato.
- **Verificato su Cloudflare** (§6 bis): il Durable Object di questo account ha calcolato percorsi fino a 314 ms di CPU senza interruzioni.

## 8. GO/NO-GO per un rilascio solo Milano sul piano gratuito

- **Worker normale, anche ottimizzato: NO-GO.** Sul piano gratuito resta inaffidabile, con le misure sopra.
- **Versione con Durable Object: GO tecnico.**
  - Su Cloudflare ha retto 20 richieste su 20, raffica compresa, con CPU 15–31 volte oltre i 10 ms.
  - Le alternative anti-pavé sono identiche, e non serve Workers Paid.

**Prima del rilascio pubblico servono ancora:**
1. **La tua autorizzazione** per:
   - fare commit di queste modifiche;
   - pubblicare la copia solo Milano sul pilota `lastrico-pilot`, con punto di ripristino `03a6776e`.
2. **Una prova su iPhone fisico** con la nuova versione.

## 9. Il passo più piccolo giustificato

La verifica su un Worker separato è **fatta e superata**. Il passo più piccolo adesso è:
1. **Commit delle modifiche della Fase 4.33** su un ramo e pull request.
2. **Pubblicazione della stessa copia solo Milano sul pilota** e verifica in produzione, come nella Fase 4.28.
3. **Prova su iPhone fisico** con la nuova versione.

Workers Paid resta solo come riserva: per ora non serve.

**Il Worker di prova `lastrico-free-test` resta online per altre prove.** Usa il piano gratuito, non ha database e non costa nulla.
