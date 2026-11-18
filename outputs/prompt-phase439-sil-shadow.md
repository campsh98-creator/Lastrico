# Fase 4.39: strato Surface Intelligence (SIL) offline e in modalità ombra, prompt di esecuzione

Data: 15 novembre 2026. Base: **commit locale `6fd4908`** (Fase 4.38, ramo `feat/phase438-osm-foundation`), non `main` e non la PR #16.
Ramo: `feat/phase439-surface-intelligence-shadow`, worktree separato accanto a quello della 4.38 (che resta intatto).

**Nota sulle istruzioni originali.** Il messaggio di avvio della 4.39 conteneva solo l'aggiornamento di contesto e i vincoli. Le istruzioni «originali» di cui parla non erano visibili in questa sessione. Questo prompt le ricostruisce da: progetto SIL della 4.36 (`surface-intelligence-design.md`, §11–§13, la «fase minima»), report della 4.38 e vincoli del messaggio. Se differiscono dalle istruzioni originali, quelle originali prevalgono e questo documento va corretto.

## 1. Scopo

Trasformare il prototipo SIL della 4.36 (esperimenti non tracciati) in una pipeline **tracciata, deterministica, offline**, che usa il sidecar di provenienza OSM della 4.38 e produce:

1. un **registro di evidenze** sui binari tranviari (OSM del sidecar, DBT 2020 del Comune, servizio ATM), con provenienza e licenza;
2. un **risolutore** di conflitti (politica v0 della 4.36, invariata) e un **overlay in modalità ombra** indicizzato per tessera, legato all'hash della tessera di base;
3. **flag di copertura espliciti**: dove un'estrazione non ha cercato i binari o le restrizioni, il risultato è «sconosciuto per copertura», mai «assenti»;
4. un **replay in ombra** dei 264 casi di Milano: metri di percorso con binari noti, metri in zona non coperta, nessun effetto sulle risposte;
5. un lettore `lib/sil-overlay.ts` puro, **non collegato** al motore di percorsi, con prova di costo.

## 2. Limiti (non negoziabili)

- Solo offline e ombra. Nessuna penalità di instradamento, nessuna riscrittura delle tessere di produzione, nessun deploy di Worker.
- Nessuna modifica alla PR #16 né ai suoi file (`app/api/routes/route.ts`, `lib/route-optimization.ts`, `lib/gps-trace.ts`, …). **Il collegamento a `route.ts` e a `spatial-road-store.ts` è fuori ambito**: va fatto dopo l'unione della PR #16, con un rebase.
- Roma non toccata; la copia di rilascio solo-Milano deve continuare a togliere Roma.
- Nessun push, merge o deploy senza approvazione esplicita.
- Mai la traccia GPS privata grezza, né una sua coordinata, in file tracciati o report. Si usano solo punti pubblici (Piazzale Lodi, Corso Lodi, Via Lazzaro Papi, Via Friuli).
- **Assenza ≠ nessun binario.** Un estratto storico senza binari né restrizioni non prova l'assenza.
- **Sconosciuto ≠ liscio.** I binari non sono rugosità e non entrano nelle metriche di pavé.
- Niente nuove richieste di rete in questa fase salvo approvazione esplicita (§6).
- Gli input non tracciati (cache 4.36 in `experiments/`, sidecar 4.38) si leggono **solo in lettura**, con percorso esplicito; se mancano, i test dipendenti si saltano con un messaggio, nessuna sostituzione silenziosa.

## 3. Ambito

| Pacchetto | Contenuto |
|---|---|
| S1 | `scripts/sil/sil-core.mjs`: utilità, validatore, risolutore, riancoraggio (porting del prototipo 4.36, comportamento invariato) |
| S2 | `scripts/sil/sil-coverage.mjs`: capacità per fonte (binari, restrizioni) derivate dai dati, unione dei riquadri interrogati, copertura per segmento |
| S3 | `scripts/sil/sil-rails.mjs` (join geometrico generico), `sil-dbt.mjs` (DBT 2020: classi per codice di specifica, mai le etichette `_d` scambiate), `sil-atm.mjs` (solo `service`) |
| S4 | `scripts/sil/sil-build.mjs`: registro, viste, overlay, manifesto, rapporto di copertura e di verifica |
| S5 | `scripts/sil/sil-shadow-replay.mjs` sui 264 casi |
| S6 | `lib/sil-overlay.ts` (lettore puro, con guardia dell'hash) |
| S7 | test `tests/phase439-*.test.mjs`, misure di costo, report `outputs/phase439-sil-shadow-report.md` |

## 4. Criteri di accettazione

1. Due costruzioni da input identici: tutti i file di output con hash identici.
2. L'overlay si autodisabilita (fail-open) se l'hash della tessera non coincide.
3. Nessun flag «binari assenti» generato da un'estrazione che non ha cercato i binari: verificato su tessere del gruppo storico.
4. Il join DBT riproduce i numeri del riquadro della 4.36 (assi per classe) entro la tolleranza dichiarata, se la cache è disponibile.
5. I 264 payload del benchmark restano **identici** con e senza SIL (il lettore non è collegato: prova per costruzione e per confronto).
6. Costo misurato: byte dell'overlay (grezzi e gzip), memoria analizzata, tempo di ricerca per segmento, tempo di costruzione. Obiettivi della 4.36: bundle ≤ +0,5 MiB, CPU del Durable Object ≤ +5 %.
7. `tsc`, ESLint e test mirati senza errori; suite completa: stessi fallimenti della 4.38 su questo host, nessuno nuovo.
8. `git diff --name-only` contro `6fd4908`: nessun percorso di Roma, nessun file della PR #16, nessun dato di produzione.
9. Report in italiano con: fatti nuovi acquisiti, copertura raggiunta, limiti di licenza e di qualità dei dati, impatto misurato.

## 5. Rilascio

Nessuna pubblicazione. Il commit è locale. Il passaggio a `shadow` nel motore richiede: PR #16 unita, rebase, nuovo benchmark, approvazione.

## 6. Decisioni che richiedono approvazione

- Qualunque richiesta di rete (per esempio i dati DBT dell'intera città: oggi in cache solo il riquadro Lodi) va chiesta con fonte, dimensione e numero di richieste.
- Qualunque collegamento al percorso di produzione.
