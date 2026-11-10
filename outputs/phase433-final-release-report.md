# Fase 4.33 — rilascio finale: merge, pubblicazione solo Milano/Roccella e verifica in produzione

Data: 9 novembre 2026. Esito: **GO**, con i limiti del §13.

## 1. PR #10

- **Stato:** unita in `main` con un merge normale, alle 19:46 UTC, fissata sulla testa verificata `e3819ef`.
- **Link:** https://github.com/campsh98-creator/Lastrico/pull/10
- **Nessuna riscrittura della storia**, nessun force-push.
- **Nessuna PR di Dependabot unita:** le #4–#8 restano aperte.
- **Prima dell'unione:**
  - destinazione `main`, nessuna revisione o commento aperto;
  - solo commit della Fase 4.33, nessun file di Roma cancellato;
  - nessuna credenziale né traccia GPS;
  - file più grande aggiunto: il riepilogo dei ricalcoli, 334 KB.
- **L'unione non può pubblicare nulla:**
  - l'unico workflow (`ci.yml`) fa lint e test;
  - il repository non ha webhook né deployment;
  - dopo il merge di PR #9 il pilota era rimasto su `03a6776e`.

## 2. Commit di merge

`c31d0733cccf334e0c3f8f1637cf57d0e906ccd7`. Il suo albero è identico a `e3819ef`, la testa verificata.

## 3. GitHub Actions dopo il merge

- **`main`, `c31d073`: verde.** https://github.com/campsh98-creator/Lastrico/actions/runs/42686587543
- **PR, `e3819ef`: verde al secondo tentativo,** 461 test, 0 falliti, 7 saltati su Linux.
  - Il primo tentativo è stato annullato dal limite di 15 minuti: il test dell'interfaccia `phase4181-ui-verification`, che avvia Chrome senza un proprio timeout, si è bloccato sul runner.
  - Il commit cambiava solo documenti e uno script; il test era passato nei due giri precedenti e in quello ripetuto.
  - Lo segnalo, non lo nascondo. Correzione proposta: un timeout nel lanciatore di Chrome (§13).

## 4. Durable Object: affidabilità

- **Nessun calcolo nel Worker principale.** Se il Durable Object non risponde, il Worker non calcola più il percorso da sé, cioè sul percorso limitato a 10 ms.
  - Un errore che Cloudflare segna come ripetibile e non sovraccarico, come il riavvio a ogni pubblicazione, si ripete **una volta** su un altro oggetto: evento `route_engine_retry`.
  - Ogni altro guasto risponde **503** con un messaggio in italiano, `Retry-After: 60` e `no-store`: evento `route_engine_unavailable`.
  - In navigazione l'app mantiene il percorso attuale.
  - Il percorso di guasto è coperto dai test unitari. In produzione non si è mai attivato: nessun evento nei registri.

## 5. Pagina principale e timer

- **Pagina principale.**
  - **Prima:** il rendering di `/` usava 6–37 ms di CPU, oltre i 10 ms. È una pagina senza contenuto per richiesta: due rendering sono identici byte per byte, e `?area=` lo legge il browser.
  - **Ora:** a ogni rilascio la si scrive come file statico (`dist/client/index.html`), servito da Cloudflare prima del Worker.
  - **In produzione:** 0 esecuzioni del Worker per la pagina.
- **Timer in sospeso.**
  - **Causa:** `AbortSignal.timeout` non si può annullare, quindi ogni chiamata al Durable Object restava attiva fino allo scadere dei timer: esattamente 4, 8 o 12,2 s.
  - **Ora:** i timer si annullano a fine chiamata. La scadenza vale ancora durante la lettura della risposta (test).
  - **Tempo attivo fatturato** (Worker di prova, stesse 20 richieste): da 9,7 a **3,6 s per percorso**, cioè da circa 1,2 a **0,44 GB-s**. La quota gratuita è di 13.000 GB-s al giorno.
  - **Durata delle chiamate:** mediana 5,3 s invece di 12,2.

## 6. Test

| Dove | Risultato |
|---|---|
| CI su `main` dopo il merge | verde |
| CI della PR | 461 test, 0 falliti, 7 saltati su Linux |
| Copia di rilascio del merge, lint + `npm test` | 451/452, 1 saltato (quello di Roma, atteso), 0 falliti |
| Riproduzione dai dati archiviati | 264/264 calcoli e 275/275 ricalcoli identici |
| E2E mobile, copia di rilascio in locale | 81/81 (3 ripetuti per porte di Chrome occupate dal primo giro interrotto) |
| E2E mobile contro il pilota pubblico | **81/81** (15 formati chiaro/scuro, GPS simulato, ricalcolo, A/B, semafori, ZTL) |
| Build di ripristino | 367/367 |

Nella cartella di lavoro, `npm test` dà un fallimento solo in locale: `rome-packed-tiles` trova copie di conflitto di iCloud (`1240_4180 2.bin`). Sono 1.433 file non tracciati ("nome 2.json"). Non li ho cancellati; il rilascio ora li esclude.

## 7. Pacchetto solo Milano/Roccella

- **Origine:** `node scripts/prepare-milan-release.mjs <cartella> --commit=c31d073`, cioè `git archive` del commit esatto.
  - Rimossi 634 file di Roma e puliti 7 file condivisi.
  - Nessun file non tracciato copiato.
- **Pubblicazione:** con `npm run deploy:pilot` nella copia, che fa build, istantanea della pagina, controllo Roma e configurazione del pilota.
- **Stesso artefatto della prova:** uguale a quello verificato sul Worker di prova, stessa dimensione (13.339,26 KiB).
  - Cambiano solo gli ID di build, la configurazione del pilota e lo stato locale di `wrangler dev`, che non viene caricato.

## 8. Esclusione di Roma

- `findRomeInBuild` sul pacchetto finale: **0 elementi**. Controlla:
  - nessun modulo `.bin`;
  - nessun letterale `rome` in server, browser o pagina, con apici o backtick.
- Menu delle città pubblicato: solo `milan` e `roccella`.
- `GET /api/routes?area=rome…` in produzione: **400**.
- Roma resta intatta su `main` e su GitHub.

## 9. Pubblicazione Cloudflare

- **Versione attiva:** `170ac277-2094-4925-9378-1f3ff46aab1c`, al 100 %, alle 19:51 UTC.
- **Versione precedente:** `03a6776e-cc36-4f87-a963-e0bd0592c906`.
- **Collegamenti:**
  - lo stesso D1 `50683df2…`, non modificato: nessuna migrazione;
  - in più, il Durable Object `ROUTE_ENGINE`, migrazione `v1-route-engine`;
  - nessuna variabile o segreto.
- **Altri Worker:** nessuno toccato. `lastrico-free-test` resta separato, ora sulla versione di prova `28b211de`.
- **Piano:** nessun acquisto, nessun cambio di piano, DNS o domini.
  - Che il piano sia ancora quello gratuito non è leggibile con il token di wrangler.
  - Lo indicano le interruzioni a 10 ms dell'8 novembre.

## 10. Verifiche sull'indirizzo pubblico

| Verifica | Esito |
|---|---|
| Pagina e file statici (10) | ✅ 200, pagina servita senza Worker |
| Ricerca indirizzi con un tocco (Milano, Roccella, e a mano nel browser) | ✅ |
| Porta Vittoria → Promessi Sposi (Viale Filippetti) | ✅ anti-pavé 20,8 min con 74 m di pavé contro 20,5 min con 567 m |
| Moscova → Crocetta | ✅ 964 m confermati e 0 probabili, contro 940 + 388 m |
| Anti-pavé contro più rapido, 20 percorsi | ✅ 20/20 identici alla prova; dove nessuna alternativa conviene, lo dice |
| Ricalcolo continuo in navigazione (4 punti) | ✅ |
| Avvisi di pavé e semafori OSM | ✅ 4 e 2 tratti, 7 e 10 semafori sul percorso Filippetti |
| ZTL | ✅ senza autorizzazione 422 con messaggio chiaro; con autorizzazione 200 |
| Roccella | ✅ |
| A/B inverso, GPS simulato, guasto simulato del servizio di routing | ✅ nell'E2E in produzione: A/B (G4), GPS dall'attesa all'arrivo (B1–B15), richiesta senza risposta (A11), ricalcolo fallito che continua sull'ultimo percorso (B4) |
| Raffica di 6, 2 e 4 richieste in parallelo | ✅ tutte 200, tutte nel Durable Object |

Il guasto del servizio di routing è simulato solo nel browser: non si può provocare in produzione.

## 11. CPU, latenza ed errori (produzione, versione `170ac277`)

Fonte: `wrangler tail` dalle 19:51 alle 20:03 UTC, 200 esecuzioni, e le statistiche Cloudflare del Worker (`outputs/phase433/pilot-170ac277-*`).

| Misura | Valore |
|---|---|
| Richieste del Worker | 141 riuscite, 0 errori, 1 chiusa dal browser |
| Interruzioni per CPU (`exceededResources`, errore 1102) | **0** |
| Risposte 503 o eccezioni | **0** |
| Eventi `route_engine_retry` / `route_engine_unavailable` | 0 |
| Percorsi | 52/52 ok (200, 422 ZTL, 400 Roma), tutti nel Durable Object |
| CPU del Worker per i percorsi | 0–3 ms |
| CPU del Durable Object | mediana 85 ms, massimo 345 ms |
| Durata del Durable Object | mediana 1,2 s, massimo 5,5 s: non supera più la risposta |
| Latenza dei percorsi per la persona | 0,3–6,2 s; i calcoli pesanti 5–6 s, per l'attesa del servizio di routing |
| CPU del Worker, tutte le richieste | p50 2,7 ms, p99 11,5 ms, massimo 26 ms (`/api/reports`) |
| Pagina principale | 0 esecuzioni del Worker |

**Tempo attivo fatturato in produzione.** Alle 20:10 UTC le statistiche aggregate di Cloudflare per il Durable Object del pilota erano ancora parziali: 7 richieste su 52 registrate, 0 errori, 4,3 s attivi. Non le uso come misura.
- La misura completa resta quella del Worker di prova (§5): 3,6 s per percorso.
- Il registro del pilota è coerente: nessuna esecuzione del Durable Object dura più della risposta.

## 12. Ripristino

- **Non è servito.**
- **Perché non basta `wrangler rollback`:** Cloudflare non permette di tornare a una versione precedente alla creazione del Durable Object, quindi `wrangler rollback 03a6776e` sarebbe rifiutato.
- **Il ripristino pronto:**
  ```bash
  node scripts/prepare-pilot-rollback.mjs <cartella-vuota-fuori-dal-repo>
  ```
  poi `npm run deploy:pilot` in quella cartella.
- **Cosa contiene:** il codice di `03a6776e` con la stessa classe, inutilizzata.
- **Verifiche:**
  - modulo per modulo uguale al pacchetto pubblicato, a parte gli ID di build e la classe;
  - 367/367 test;
  - accettato da Cloudflare sul Worker di prova;
  - prova a vuoto per `lastrico-pilot` riuscita.
- **Tra versioni con il Durable Object**, come `170ac277` e le successive, `wrangler rollback` funziona normalmente.

## 13. Limiti che restano

- **Nessuna capacità giornaliera garantita.** Le prove sono 60 percorsi in tutto. Se una quota gratuita finisce, i percorsi rispondono 503 fino al rinnovo.
- **Ancora nel Worker principale:**
  - **elenco delle segnalazioni** (`/api/reports`): 9–26 ms di CPU in produzione;
  - **ricerca indirizzi:** 2–10 ms.
  - Passano grazie alla tolleranza di Cloudflare, ma un'interruzione è possibile.
- **Il servizio di routing gratuito FOSSGIS** resta il limite di velocità: i calcoli pesanti richiedono 5–6 s.
- **Nessuna prova su iPhone fisico.** Il GPS è stato verificato solo in simulazione.
- **Dati OSM:**
  - semafori e svolte non sono verificati sul campo;
  - un tratto senza etichetta resta sconosciuto, non liscio.
- **Il test di Chrome in CI non ha un timeout proprio:** se Chrome si blocca, il CI aspetta 15 minuti.
- **README e stato tecnico su `main`** descrivono ancora il pilota come Fase 4.28: serve una piccola PR di documentazione.

## 14. Decisione

**GO.** La versione solo Milano/Roccella con Durable Object è pubblica sul piano gratuito:
- tutti i controlli sono passati;
- nessuna interruzione di CPU e nessun errore 1102 o 503;
- percorsi anti-pavé identici a quelli verificati;
- ripristino pronto e verificato.

## 15. Lista per la prova su iPhone

1. **Apertura e installazione.** Apri https://lastrico-pilot.campsh.workers.dev in Safari, aggiungilo alla schermata Home e riaprilo da lì.
2. **Permessi.** Concedi la posizione con «Posizione esatta» attiva.
3. **Ricerca.** Scrivi partenza e destinazione e scegli con un tocco: il calcolo parte da solo.
4. **Filippetti.**
   - In auto, da Porta Vittoria a Largo Promessi Sposi: verifica che l'anti-pavé passi per Viale Filippetti.
   - Usa A/B inverso e controlla anche il ritorno.
5. **Moscova → Crocetta,** in auto e in moto.
6. **Navigazione.** Avvia la navigazione e verifica:
   - indicazioni vocali;
   - freccia che segue la posizione;
   - nessun ricalcolo con il GPS che oscilla sulla strada parallela.
7. **Ricalcolo.** Esci di proposito dal percorso: deve ricalcolare entro pochi secondi, restando anti-pavé.
8. **Avvisi e semafori.** Controlla che gli avvisi di pavé e i semafori compaiano dove ti aspetti. Annota quelli sbagliati.
9. **ZTL.** Imposta una destinazione nel Quadrilatero in orario attivo: deve avvisare. Con l'autorizzazione attiva il percorso deve entrare.
10. **Schermo e sfondo.**
    - Blocca lo schermo per 30 s in navigazione, poi riapri.
    - Passa un'altra app in primo piano e torna.
    - Controlla che la navigazione riprenda.
11. **Rete.** In un punto con rete debole, verifica il messaggio e che resti l'ultimo percorso.
12. **Arrivo.** Arriva a destinazione: messaggio di arrivo, GPS rilasciato.
13. **Roccella Ionica.** Ripeti un percorso breve, se possibile.
14. **Annota** per ogni punto: ora, via e cosa non torna. Nessuna traccia GPS viene salvata o inviata, a meno che non attivi tu la registrazione.
