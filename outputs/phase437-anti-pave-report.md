# Lastrico — Fase 4.37: generazione dei candidati anti-pavé (pacchetto P0)

- **Data:** 15 novembre 2026. **Base:** `main` a `3e31da9` (Fase 4.35). **Ramo:** `fix/phase437-anti-pave-candidates`.
- **Stato: implementato e provato in locale. NON rilasciato sul pilota.** Il rilascio richiede il via libera del proprietario
  dopo la PR (scelta predefinita del prompt `outputs/prompt-phase437-anti-pave-candidate-generation.md`).
- Solo Milano. Roma, Roccella e il resto dell'app non cambiano comportamento (verificato, vedi §4).

## 1. In breve

Quattro modifiche piccole alla generazione dei percorsi, scelte dalla Fase 4.36 (traccia GPS del ritorno del 13 novembre):

1. **Soglia del tratto di pietra** della ricerca anti-pavé: da 25 m fissi a `min(riduzione minima della modalità, 15 m)` per Milano
   (auto 15 m, moto 15 m, bici 12 m). Il tratto di Piazzale Lodi misura 24,99 m: prima la ricerca non partiva mai.
2. **Stop anticipato e deviazioni inutili:** un miglioramento «economico» ferma la ricerca del pianificatore solo se non resta pietra
   significativa; dopo un percorso penalizzato pulito non partono più le tre deviazioni geometriche. I ricalcoli in navigazione
   restano veloci come prima.
3. **Messaggio e traccia:** per lo stato `no-pave` il ricalcolo dice «Nuovo percorso · nessun pavé noto di rilievo sul tragitto»
   (non più «nessuna alternativa con meno pavé»); la traccia GPS v3 registra, per ogni percorso, come è stato generato
   (stato anti-pavé, candidati e verdetti, senza coordinate né nomi di vie).
4. **Svolte a U:** costano 60 s nel confronto tra percorsi (mai esclusione). L'aggancio dei punti di passaggio agli incroci (P0-4b,
   facoltativo) **non è stato fatto**.

**Risultato sul benchmark di Milano (264 casi, effetti previsti su dati OSM, non verità a terra):** 244 casi identici, 19 cambiati,
1 senza percorso. La pietra confermata totale sui percorsi mostrati scende da 50.483 m a 47.402 m (**−3.081 m, −6,1 %**) con
lo stesso tempo totale (3.694 → 3.692 min). 14 casi migliorano, 5 peggiorano (spiegati in §3). Richieste al provider: +0,20 per caso.

## 2. File modificati

| File | Modifica |
|---|---|
| `lib/surface-aware-routing.ts` | `penalisedSliceMinimumMeters`, `stopsOnlyWhenClean` (solo Milano) |
| `app/api/routes/route.ts` | soglia del tratto (due punti), stop anticipato, salto delle deviazioni dopo un percorso pulito, `uTurnPenaltySeconds` nella policy di Milano, nuovi campi `antiPave.search.slices/nothingToTarget` e `candidateDiagnostics[].uTurnCount` |
| `lib/route-optimization.ts` | penalità di 60 s per svolta a U nell'utilità (`uTurnCount`, `U_TURN_PENALTY_SECONDS`) |
| `lib/reroute-objective.ts` | ramo `no-pave` |
| `lib/gps-trace.ts`, `app/page.tsx`, `scripts/replay-gps-trace.mjs` | traccia v3 (`generation`), validazione rigorosa, registrazione al piano, al ricalcolo e al cambio percorso, riepilogo nel replay |
| Test | `tests/phase437-candidate-generation.test.mjs` (7), `tests/phase437-trace-generation.test.mjs` (16), `tests/phase431-navigation.test.mjs` (+3), `tests/phase431-anti-pave-gate.test.mjs`, `tests/phase434-diagnostics.test.mjs` (versione 2 → 3) |
| Fixture | `tests/fixtures/phase437/` (2 repliche con incroci pubblici, 5 risposte), 8 nuove risposte in `tests/fixtures/phase431-anti-pave/provider/`, `scripts/record-phase437-fixtures.mjs` |
| Archivio provider | `outputs/phase425-benchmark/provider-responses.tar.gz` (2.280 risposte, SHA-256 `8b6b9ef7…a2300`) e `PROVIDER_ARCHIVE.md` |
| Documenti | `docs/ENGINEERING_STATUS.md` (due righe, «non ancora sul pilota»), questo rapporto, `outputs/phase437/benchmark-before-after.json` |

## 3. Prima e dopo

**Gate della Fase 4.31 (6 casi, gestore reale su risposte registrate):** 6/6 superati. Quattro casi hanno chiesto una richiesta nuova
(8 risposte registrate in tutto). Un risultato cambia, con motivo: *Porta Romana / Filippetti* (`porta-vittoria-car`): il percorso più
rapido passa da 567 m di pietra confermata a 111 m ed è 8 s più veloce (la ricerca penalizzata ora considera anche i tratti da 15 a 25 m);
l'alternativa anti-pavé resta a 74 m. L'asserzione del test è stata aggiornata di conseguenza.

**Repliche con incroci pubblici (auto, pianificatore):**

| Replica | Prima (`3e31da9`) | Dopo |
|---|---|---|
| Ritorno (Via Lazzaro Papi nord → Alzaia Naviglio Pavese) | ricerca anti-pavé **non tentata**, 1 richiesta; veloce 195 m, anti-pavé 25 m | ricerca **tentata** (2 tratti), 2 richieste; esito invariato (195 / 25 m) |
| Andata (percorso inverso) | ricerca tentata, 2 richieste; 280 / 50 m | stessa scelta e stesse richieste (3 tratti); un percorso a 0 m esiste ma resta dietro il filtro di raffinamento (scelta di prodotto, fuori da questa fase) |

**Corpus di Milano (88 viaggi × auto/moto/bici, livello «strong», lunedì 9 novembre 2026 ore 12:00):**

| Misura | Prima | Dopo |
|---|---|---|
| Casi identici / cambiati / senza percorso | — | 244 / 19 / 1 |
| Pietra confermata totale sui percorsi mostrati | 50.483 m | 47.402 m (−6,1 %) |
| Tempo totale dei percorsi mostrati | 3.694 min | 3.692 min |
| Richieste al provider (dall'archivio) | 817 | 869 (+52, +0,20 per caso) |

I 14 casi migliorati (pietra mostrata in calo o alternativa nuova/più veloce) includono Brera → Darsena (bici, −730 m per +104 s),
Duomo → Isola (auto, −600 m per +114 s), Castello → Porta Romana (bici, −447 m per +66 s), Greco → Lambrate (auto/moto, −63 m e −141/−170 s),
Cadorna → Darsena (bici, −365 m per +76 s). Cinque casi superano +90 s sul percorso mostrato (Brera → Darsena, Duomo → Isola auto, Duomo → Porta Garibaldi bici, Repubblica → Sant'Ambrogio
auto e moto): sono alternative offerte e restano nei limiti del livello «strong»; ciascuna toglie almeno 150 m di pietra (circa 1 s per metro,
il cambio attuale). Il percorso più veloce non diventa mai più lento in nessun caso.

**I 5 casi peggiorati, con motivo (criterio 2):**

| Caso | Cambiamento | Motivo |
|---|---|---|
| Colonne → Porta Genova (moto) | alternativa persa: mostrato 85 m → 205 m (−134 s) | l'alternativa contiene una svolta a U: con 60 s di penalità non conviene più (effetto previsto dalla Fase 4.36; verificato sui candidati) |
| Cadorna → Cinque Giornate (moto) | alternativa persa: 0 m → 2 m (−269 s) | l'alternativa contiene una svolta a U e toglieva solo 2 m di pietra per +269 s: non offrirla è corretto |
| San Siro → Città Studi (bici) | +6 m, +1 s | altra alternativa quasi equivalente |
| De Angeli → San Babila (auto, moto) | il percorso «più rapido» ora ha più pietra (85 → 258 m e 85 → 511 m) ma è 29 e 27 s più veloce; l'alternativa anti-pavé è invariata | un percorso della ricerca penalizzata è più veloce di quello del provider; PLAUSIBILE che dipenda anche dal grafo più recente |

## 4. Verifiche

- `tsc --noEmit` e ESLint sui file toccati: 0 errori. `vinext build`: riuscita.
- Test nuovi: 7 + 16 superati (il test con la traccia privata del 13 novembre ha girato con la traccia reale: 0 differenze di decisione,
  1 ricalcolo, 930 rilevazioni accettate). Gate Fase 4.31: 6/6.
- Suite completa, file per file, su Windows: **31 test falliscono, gli stessi 31 sul `HEAD` (`3e31da9`) in una copia di lavoro separata**
  (percorsi `URL.pathname` e fine riga CRLF di questa macchina; sono 9 file). Nessun fallimento nuovo, nessuno risolto.
  La CI GitHub su Linux («Lint, test and build») è il controllo definitivo.
- Bundle compilato servito dal Worker locale (workerd) con richieste reali al provider: pianificatore → ricerca tentata, 2 tratti,
  `uTurnCount` presente; navigazione → ricerca non tentata (stessa regola di prima), 302 ms; moto → stessa risposta.
- Roma e Roccella: soglia 25 m e regole precedenti per costruzione (`areaId === "milan"`); nessun file di Roma toccato; le righe che
  la preparazione della copia solo-Milano riconosce (`scripts/milan-release.mjs`) non sono state modificate.

## 5. Criteri di accettazione del prompt

| # | Criterio | Esito |
|---|---|---|
| 1 | Fixture che riproduce il difetto (24,99 m) | Superato in due forme: test sulla geometria (assente a 25 m, presente a 15 m) e replica end-to-end (ricerca tentata solo dopo) |
| 2 | Corpus: nessuna regressione senza motivo | Superato con 5 peggioramenti spiegati (§3); nessun caso aggiunge più di +90 s al percorso veloce |
| 3 | Richieste ≤ +0,35 per caso, budget invariati | +0,20 per caso; budget 18 s e 5,5 s invariati |
| 4 | Navigazione invariata, traccia reale senza differenze | Superato (0 differenze; v1/v2 ancora leggibili) |
| 5 | Svolte a U: nessuna esclusione, ≤ 5 scelte cambiate su 298 | Nessuna esclusione; cambiano 2 scelte sul corpus per la sola penalità (Colonne → Porta Genova, Cadorna → Cinque Giornate, entrambe in moto) |
| 6 | Messaggio `no-pave` onesto | Superato (testo da confermare) |
| 7 | Roma e Roccella invariate | Superato per costruzione e per test; da riconfermare dalla CI e dalla copia di rilascio |
| 8 | Fallback sicuro | Nessuna nuova classe di errore nei test dei guasti del provider |

## 6. Non fatto o non verificato

- **E2E su telefono/Chrome mobile non eseguito.** La suite del repository (`tests/e2e/acceptance.mjs`) su questa macchina Windows ha aperto
  centinaia di processi Chrome senza produrre un risultato in oltre 30 minuti: l'ho interrotta e ho chiuso solo i processi che aveva avviato.
  Resta da fare su macOS/Linux o sul telefono prima del rilascio. Il comportamento della pagina (registrazione `generation`, riga del
  ricalcolo) è coperto solo da test sul sorgente.
- **iPhone fisico:** non provato.
- **P0-4b** (aggancio dei punti di passaggio agli incroci) non fatto; nessuna marca temporale del grafo del provider nella traccia
  (richiederebbe una richiesta in più).
- **Formulazione** del messaggio `no-pave`: «…nessun pavé noto di rilievo…» (aggiunto «di rilievo» perché `no-pave` ammette pochi metri
  noti); il proprietario non l'ha ancora confermata.
- Il confronto prima/dopo mescola due grafi del provider: 2.160 risposte del 7–8 novembre e 120 nuove del 14 novembre.
- Effetti previsti su dati OSM, non verità a terra; nessuna misura di comfort reale.

## 7. Richieste al provider pubblico (FOSSGIS Valhalla, solo coordinate pubbliche)

- Fixture dei gate: 8. Repliche di Piazzale Lodi: 5. Corpus: **126** (82 mancanti dal primo confronto offline, approvate dal proprietario,
  più 44 a cascata e ritentativi dopo risposte transitorie): **sopra le 82 approvate**, da segnalare. Totale 139, tutte distanziate di almeno
  1,2 s. Il prompt prevedeva 25: l'estensione per il corpus è stata approvata dal proprietario nella conversazione.
- Le 120 risposte del corpus sono nell'archivio versionato (§2); le cartelle dei risultati del benchmark restano fuori da Git.

## 8. Per il rilascio

1. PR verso `main`; CI verde (lint, test su Linux, build). 2. Copia di rilascio solo-Milano (`scripts/prepare-milan-release.mjs`) e test al suo
interno. 3. E2E mobile e controllo su telefono. 4. Via libera del proprietario, poi la procedura della Fase 4.35
(`deploy:pilot`, `post-deploy-smoke.mjs`; smoke sulla replica con incroci pubblici: `search.attempted = true`).
**Rollback:** soglia a 25 m e regola dello stop anticipato come prima (due modifiche di una riga in `lib/surface-aware-routing.ts` e `route.ts`),
`scripts/prepare-pilot-rollback.mjs` per la versione precedente del pilota (da annotare prima del deploy).
