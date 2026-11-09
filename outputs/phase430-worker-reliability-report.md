# Fase 4.30 — Affidabilità del Worker Cloudflare

8 novembre 2026. Prompt di esecuzione: `outputs/prompt-phase430-worker-reliability.md`.

Tutto è stato fatto in locale: niente commit, push, merge o deploy. Il pilota online resta `03a6776e`. Le correzioni della Fase 4.29 sono intatte.

## 1. Causa: il limite di CPU del piano gratuito, misurato in produzione

Test controllato e in sola lettura sul pilota: 14 richieste a 4 s l'una dall'altra, senza tentativi ripetuti, con il registro di Cloudflare (`wrangler tail`) acceso. Dettagli in `outputs/phase430/production-controlled-test-*`.

| Esito registrato da Cloudflare | Richieste | Tempo CPU al momento dell'interruzione |
|---|---:|---|
| `exceededCpu`, «Worker exceeded CPU time limit», HTTP 503 | **12 su 14**: tutte e 10 le richieste di percorso e 2 home page su 3 | **10 ms** (due a 16 ms) |
| `ok` | 2: ricerca indirizzi (3 ms) e una home page a caldo (6 ms) | — |

Cosa dicono questi dati:
- **Sono interruzioni per CPU, non per memoria:** nessun `exceededMemory`.
- **L'app non va in errore:** nessuna eccezione.
- **Non c'entrano il servizio di routing né un limite di frequenza:** le richieste vengono fermate in pochi millisecondi di CPU, prima o durante il lavoro.
- **Il limite è quello del piano gratuito:** 10 ms di CPU per richiesta, mentre il piano a pagamento ha 30 s predefiniti ([limiti dei Workers](https://developers.cloudflare.com/workers/platform/limits/)).
- **Il pilota usa il piano gratuito:** la configurazione non imposta limiti propri.
- **Il limite oggi viene applicato in modo rigido.** Fino al 7 novembre passavano richieste da 70–500 ms, con una sola interruzione, a 96 ms.
- **Il 503 della home page ha la stessa causa.** La pagina generata dal server richiede 6–16 ms di CPU e viene fermata quando supera i 10.
- **Oggi il pilota non calcola quasi nessun percorso, e tornare a una versione precedente non serve:** tutte hanno la stessa architettura.

## 2. Dove va la CPU (misure locali, Node)

Il replay del benchmark di Milano (263 casi validi, risposte registrate) dà:
- **CPU per richiesta:** mediana 20 ms, p90 93 ms, massimo 557 ms.
- **Richieste entro 10 ms:** 69 su 263.
- **Prima richiesta di un processo nuovo:** 139 ms, perché carica i dati.

**Profilo** (`outputs/phase430/profile-before.txt`):
- **59%: confronto tra percorsi candidati** (`routesShareCorridor` → `divergentMeters`, `lib/route-candidates.ts`). Per ogni punto di un percorso che si discosta dall'altro, il codice scandiva tutti i segmenti dell'altro percorso (forza bruta). Le alternative si discostano per definizione, quindi era il caso più frequente.
- **22%: analisi del fondo** di ogni percorso candidato (`scoreRoadIntelligence`).
- **Memoria:** con tutti i 117 riquadri di Milano espansi in memoria si arriva a **107 MB**, vicino al limite di **128 MB per isolato**, che è lo stesso anche nel piano a pagamento. In produzione non è ancora successo, ma un isolato usato a lungo in tutta la città poteva arrivarci e fallire con lo stesso errore 1102.

## 3. Ottimizzazioni fatte (risultati identici)

1. **Griglia spaziale dei segmenti** per il confronto tra percorsi (`lib/route-candidates.ts`):
   - ogni segmento è inserito in tutte le celle che il suo riquadro, allargato della tolleranza, tocca;
   - l'allargamento in longitudine usa la scala più sfavorevole, quindi nessun segmento utile può mancare;
   - il controllo finale sulla distanza esatta è lo stesso di prima, quindi la risposta è identica alla scansione completa.
2. **Riuso dei calcoli nella stessa richiesta.** Il confronto tra due percorsi e la loro lunghezza vengono ricordati. Si può fare con sicurezza perché le geometrie non cambiano più dopo la decodifica (verificato nel codice).
3. **Memoria limitata** (`lib/spatial-road-store.ts`). Al massimo 64 riquadri espansi per isolato; il più vecchio viene liberato per primo e, se serve di nuovo, viene ricostruito identico dai dati grezzi.

## 4. Prima e dopo

**CPU per richiesta** (replay del benchmark, 263 casi; `outputs/phase430/benchmark-cpu-before-after.txt`):

| | Mediana | p90 | p99 | Massimo | Totale | ≤ 10 ms |
|---|---:|---:|---:|---:|---:|---:|
| Prima (Fase 4.29) | 20 ms | 93 ms | 322 ms | 557 ms | 10,7 s | 69 |
| Con la griglia | 11 ms | 39 ms | 114 ms | 129 ms | 4,7 s | 122 |
| **Finale** (griglia e memoria limitata) | **12 ms** | **40 ms** | **150 ms** | **175 ms** | **5,3 s** | **114** |

- La versione finale è poco più lenta di quella con la sola griglia perché il replay attraversa tutta la città di fila e ricostruisce alcuni riquadri. In uso reale un isolato lavora su zone più ristrette.
- Rispetto alla partenza la CPU totale scende del 50% e il caso peggiore di quasi 3 volte.

**Memoria:** con tutti i 117 riquadri toccati si passa da 107 MB a **76 MB** (64 riquadri espansi più i dati grezzi).

**Risultati identici:**
- **Benchmark:** confrontando ogni risposta del benchmark campo per campo (`scripts/compare-benchmark-payloads.mjs`: geometria, fondo, tratti di pavé, candidati, avvisi; esclusi solo i tempi), sono **354 su 354 identiche**, anche dopo la liberazione e ricostruzione di riquadri.
- **Test di confronto:** un nuovo test (`tests/phase430-route-candidates.test.mjs`) confronta il nuovo calcolo con quello vecchio a forza bruta su **1.800 casi casuali**: stesso percorso, rumore, via parallela, deviazione, sottoinsieme, tre tolleranze e lunghi percorsi nord-sud. L'accordo è totale.

**Prove sul Worker locale (workerd).** Il Worker locale non applica il limite di CPU di Cloudflare, quindi queste prove verificano la correttezza, non il limite:

| Prova | Esito |
|---|---|
| A freddo: home page e primo percorso pesante | 200 / 200 |
| A caldo: lo stesso percorso ripetuto | identico |
| 4 percorsi pesanti in contemporanea | tutti 200, identici a quelli calcolati uno per volta |
| 5 ricalcoli di navigazione consecutivi | tutti 200 |
| Home page ×4, ricerca indirizzi, Roccella | 200 |

**Regressioni:**
- TypeScript ed ESLint senza errori.
- **407 test su 407**, compresi Roma, Roccella e la Fase 4.29.
- Build e dry-run riusciti: 26,6 MiB, con Roma, che è nel branch locale.
- Prova mobile: **74 scenari su 74**, cioè ricerca indirizzi della Fase 4.22, scelta del percorso, GPS, voce, ricalcolo, arrivo, impaginazione nei temi chiaro e scuro, freccia fluida, avvio approssimativo e avvisi di pavé della Fase 4.29. Il server di sviluppo locale si è bloccato due volte, quindi gli scenari sono passati in tre giri:
  - i blocchi coincidevano con un database locale senza tabelle, che la build aveva ricreato; con le tabelle create il server è rimasto attivo;
  - B10, B11 e B12 sono falliti una volta subito dopo l'avvio, con la mappa ancora in caricamento, e sono passati 2 volte su 2.

## 5. Il carico rientra nel piano gratuito?

**No, e le misure lo dimostrano.**
- **Percorsi.** Anche dopo le ottimizzazioni, con i dati già in memoria, solo il **43%** delle richieste di percorso resta entro 10 ms di CPU; il p90 è 40 ms e i percorsi pesanti arrivano a 175 ms. A freddo il caricamento dei riquadri aggiunge decine di millisecondi. Analizzare il fondo di 6–8 percorsi candidati non può stare in 10 ms.
- **Home page.** Anche la pagina generata dal server supera a volte i 10 ms.
- **Ritentare** maschererebbe il problema e consumerebbe altre richieste.

**Il cambiamento di architettura più piccolo per restare nel piano gratuito:**
1. Servire la home page come file statico, così che non passi dal Worker.
2. Spostare nel telefono l'analisi del fondo e la scelta del percorso. Il telefono scarica i riquadri di Milano (circa 9 MB, poi in cache) e il Worker si limita a inoltrare le richieste al servizio di routing.

| | Piano gratuito con architettura nuova | Workers Paid |
|---|---|---|
| Costo | 0 € | **5 USD al mese**, minimo per account ([prezzi](https://developers.cloudflare.com/workers/platform/pricing/)) |
| Cosa include | 100.000 richieste al giorno, 10 ms di CPU per richiesta | 10 milioni di richieste e 30 milioni di ms CPU al mese, 30 s per richiesta. Il pilota resta molto sotto queste soglie, anche più che prima grazie alle ottimizzazioni. |
| Lavoro | Grande: va spostato e riverificato tutto il motore dei percorsi (~800 righe del server più l'analisi del fondo); i ricalcoli passano dal telefono; il primo uso scarica circa 9 MB; più batteria e dati | Nessuna modifica al codice |
| Rischio | Medio-alto: tutti i percorsi vanno riverificati | Basso |
| Tempi | Più fasi di sviluppo | Immediato dopo l'attivazione |

**Raccomandazione: Workers Paid.** L'attivazione è un acquisto e devi farla tu dalla dashboard di Cloudflare; io non posso farla. Le ottimizzazioni di questa fase restano utili comunque: risposte più rapide, meno CPU e meno rischio di memoria.

## 6. GO/NO-GO

- **NO-GO per il pilota sul piano gratuito**, con o senza queste ottimizzazioni: la maggior parte dei percorsi resta sopra i 10 ms di CPU.
- **GO per un rilascio solo Milano delle Fasi 4.29 e 4.30, appena il piano a pagamento sarà attivo**, dopo la tua revisione e autorizzazione, con il metodo che esclude Roma. Poi servono smoke test in produzione con il registro di Cloudflare acceso e una nuova prova su iPhone.
- **Il pilota attuale (`03a6776e`) resta invariato** e, finché il piano non cambia, in questo momento quasi non calcola percorsi.
