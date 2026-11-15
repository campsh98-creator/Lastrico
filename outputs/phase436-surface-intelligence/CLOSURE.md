# Fase 4.36 · Chiusura formale e archiviazione

- **Data di chiusura:** 15 novembre 2026.
- **Stato:** **COMPLETATA — ricerca e fattibilità.** Nessuna nuova indagine è stata condotta per questa chiusura.
- **Ramo e base:** `docs/phase436-closure`, creato da `b5ba991` (Fase 4.39b) in un worktree separato. Questo commit è solo documentale/archivistico: nessun file di `lib/`, `app/`, `components/`, `worker/`, `data/`, `tests/` o `package.json` è toccato.
- **Originali:** i file in `outputs/phase436-surface-intelligence/` e `experiments/phase436-surface-intelligence/` della copia di lavoro principale **non sono stati modificati né eliminati**. Questo archivio contiene copie **identiche byte per byte** (218 file, verificate con SHA-256 prima del commit). Il `README.md` qui accanto è l'originale e dice ancora "nothing is committed": era vero alla fine della Fase 4.36; questo file (`CLOSURE.md`) è l'unica aggiunta, insieme a `MANIFEST.sha256`.

## 1. Che cosa è stato verificato

### 1.1 Rapporti (nove file di primo livello)

| # | File | Righe | Ruolo | Sezione conclusiva presente |
|---|---|---:|---|---|
| 1 | `README.md` | 58 | indice, ingressi, come riprodurre | Safety record |
| 2 | `final-decision-report.md` (italiano) | 166 | decisione finale | K. Registro di sicurezza |
| 3 | `gps-trace-forensics.md` | 154 | analisi GPS del ritorno del 13 nov | 8. Andata: che cosa la traccia non può dire |
| 4 | `routing-forensics.md` | 229 | candidati, ranking, navigazione | 12. Indice delle prove e comandi |
| 5 | `osm-data-audit.md` | 196 | tag OSM, tessere compilate, aggancio | 11. Riproduzione |
| 6 | `external-data-audit.md` | 159 | DBT 2020, ATM, Lombardia, immagini | 9. Riproduzione |
| 7 | `routing-experiments.md` | 332 | esperimenti di punteggio e candidati | 13. Da riconciliare |
| 8 | `surface-intelligence-design.md` | 277 | architettura dello strato SIL | 17. Riproduzione e limiti |
| 9 | `smartphone-sensor-feasibility.md` | 231 | sensori e protocollo di campo | 15. Riproduzione e prove |

Tutti e nove esistono, non sono vuoti, hanno titolo e sezione conclusiva, e non contengono segnaposto di lavoro incompleto. L'unica occorrenza di "TBD" (`PROJECT-CONTRIBUTION-TBD`, in `surface-intelligence-design.md`) è una decisione di licenza **volutamente aperta**, non un buco del rapporto.

Più `evidence/` (117 file, 1,8 MB) con le prove compatte per rapporto.

### 1.2 Script, fonti e riproducibilità

- 92 file in `experiments/phase436-surface-intelligence/scripts/` (90 `.mjs`, 2 `.overpassql`).
- Tutti i percorsi di script citati nei rapporti esistono (85 script distinti citati, 0 mancanti). Due moduli di appoggio (`exp-patches.mjs`, `exp-smoke.mjs`) non sono nominati da alcun rapporto: sono strumenti interni, non prove.
- Nessun `import` relativo irrisolvibile. Solo moduli integrati di Node 26; nessuna dipendenza installata.
- I comandi esatti per riprodurre ogni numero sono accanto al numero nei rapporti; l'elenco di partenza è nella sezione "Reproduce" del `README.md`.
- Le fonti sono documentate con URL, orari UTC e dimensioni in `evidence/*/request-log.jsonl` e nelle sezioni "Reproduce" dei rapporti.
- **Dati scaricati (non archiviati):** `experiments/phase436-surface-intelligence/data/` (2.577 file, circa 178 MB: shapefile DBT 2020, percorsi ATM, specifiche PDF, immagini di prova, cache degli esperimenti) resta **solo in locale ed è ignorato da Git** (`/experiments/*/data/`). Si rigenera con gli script `ext-*` e `osm-*` indicati nei rapporti; serve rete. Gli esperimenti che leggono le cache dei provider vanno quindi rieseguiti con nuove richieste, non con questi file.

### 1.3 Privacy e materiale non necessario

| Controllo | Esito |
|---|---|
| Traccia GPS grezza (`lastrico-gps-trace-2026-11-13-18-26.json`) | **Assente.** Mai copiata nel repository. Nell'archivio solo `evidence/gps-trace-summary.redacted.json`. |
| Contenuto del riepilogo redatto | Nessun array di coordinate né di fix. Partenza e arrivo sono solo **celle di 0,025 gradi** (circa 2 km) con `redacted: true`. Restano conteggi, tempi relativi e statistiche di precisione. |
| Coordinate nei rapporti, nelle prove e negli script | Solo punti di riferimento **pubblici** (Corso Lodi, Piazzale Lodi, Via Friuli, Via Lazzaro Papi, nodi OSM), riquadri di ricerca, metadati pubblici di foto stradali e il punto pubblico di Largo Promessi Sposi già presente in file committati. Nessuna coordinata della traccia. |
| Cronologia di spostamenti sensibile | Nessuna. Il rapporto sull'andata dichiara che l'andata non ha traccia e non è stata dedotta. |
| Dataset scaricati e cache | **Esclusi dall'archivio**: restano in `data/`, ignorata da Git (vedi 1.2). Le cache dei provider contengono nei testi delle manovre il nome della via di partenza: non vanno mai pubblicate. |
| File temporanei | Nessuno nell'archivio (in `scripts/` solo `.mjs` e `.overpassql`; nessun `.cache`, `.tmp`, `node_modules`). |
| Immagini di terzi | Nessuna nell'archivio (le foto di prova sono in `data/`, ignorata). `evidence/` contiene **solo metadati** (identificativi e posizioni di foto Panoramax CC BY-SA, sonde KartaView) ed estratti derivati molto piccoli del DBT del Comune e dei percorsi ATM limitati al riquadro di Piazzale Lodi. |

**Residui a basso rischio, lasciati intatti perché gli originali non si modificano:**

1. Tre file citano il percorso locale Windows della traccia (`evidence/shared-context.md`, `routing-experiments.md`, `routing-forensics.md`): rivelano il nome utente di sistema, non una posizione.
2. `README.md`, `gps-trace-forensics.md` e `evidence/gps-trace-summary.redacted.json` riportano il nome del file della traccia, la dimensione, l'hash SHA-256 e l'ora di inizio (13 novembre 2026, 18:26 UTC). Non permettono di ricostruire il percorso.

Se l'archivio dovrà essere pubblicato oltre il repository privato di lavoro, valutare di rimuovere questi riferimenti in una copia di pubblicazione e non negli originali.

**Licenze (rinvio):** l'archivio non ridistribuisce i dataset del Comune, di ATM o di OSM. Le questioni di attribuzione e di versione di licenza (CC BY 2.5 IT contro 4.0 per il DBT; ODbL per OSM) sono trattate in `outputs/phase439b-dbt-citywide-report.md` e restano aperte per la Fase 4.40.

## 2. Passaggio di consegne verso le fasi successive

La Fase 4.36 ha consegnato diagnosi e raccomandazioni; non ha implementato nulla. Ogni raccomandazione del rapporto finale (sezione G) ha ora un destinatario:

| Raccomandazione 4.36 | Fase destinataria | Stato al 15 novembre 2026 |
|---|---|---|
| P0-1 soglia del tratto da targettizzare (tetto 15 m) | 4.37, PR #16 | Implementata. PR aperta, CI verde, validazione sul pilota in attesa. |
| P0-2 stop anticipato più prudente | 4.37, PR #16 | Implementata (stessa PR). |
| P0-3 messaggio `no-pave` e traccia v3 | 4.37, PR #16 | Implementata (stessa PR). |
| P0-4 penalità di 60 s per svolta a U (mai rifiuto) | 4.37, PR #16 | Implementata (stessa PR). |
| P1-1 ri-estrazione OSM con provenienza; correzione `junction=circular` | 4.38 | Implementata, commit locale (`6fd4908`). |
| P1-2 join DBT → binari e SIL in ombra, offline | 4.39 e 4.39b | Implementate, commit locali (`bca48c1`, `b5ba991`). Copertura DBT cittadina. |
| P1-2 `diagnostics.sil` nel runtime, payload byte-identici | **4.40** | **In corso** finché i test di accettazione non passano. |
| Decisione del proprietario sulla licenza mista | prima di qualsiasi distribuzione | **Aperta.** Nessun overlay combinato OSM/DBT/ATM va pubblicato. |
| P2 verifiche sul campo (rotatoria 111768010 e 111767966, Corso Lodi, Via Fra Cristoforo) | squadra | **Non avviate.** Unica via per chiudere le domande dati-contro-realtà. |
| P3 classifica in ombra con valore atteso; opzioni Pareto; prova sensori | dopo P0–P2 | **Non avviata.** Sensori: NO-GO per qualsiasi registratore nell'app; GO condizionato solo a una Fase 1 interna, in attesa della decisione del proprietario. |

**Non si riapre la Fase 4.36** perché l'integrazione in produzione non è completa: l'indagine è chiusa; l'integrazione è lavoro delle fasi 4.37–4.40 e successive.

## 3. Integrità

`MANIFEST.sha256` elenca l'hash SHA-256 e il percorso (dalla radice del repository) di tutti i 218 file archiviati: 126 sotto `outputs/phase436-surface-intelligence/` (escluso `CLOSURE.md` e il manifest stesso) e 92 script sotto `experiments/phase436-surface-intelligence/scripts/`. Per verificare, dalla radice del repository:

```sh
sha256sum -c outputs/phase436-surface-intelligence/MANIFEST.sha256
```

Due avvertenze sulla verifica:

- Gli hash sono quelli dei file **come consegnati** (fine riga LF). Un checkout Windows con `core.autocrlf=true` riscrive i file con CRLF e il controllo fallirebbe: in quel caso confrontare i blob (`git cat-file -p HEAD:<percorso> | sha256sum`).
- **Un solo file** differisce dall'originale nel blob: `evidence/external-data-audit/dbt-shp-field-population.txt`, un registro di testo con fine riga mista (CRLF e LF). Git lo ha normalizzato a LF alla registrazione. L'hash del manifest è quello dell'originale (`27283069…cbe`); quello del blob è `03ce6eb2…d65`. Il contenuto testuale è lo stesso; l'originale non è stato toccato.
