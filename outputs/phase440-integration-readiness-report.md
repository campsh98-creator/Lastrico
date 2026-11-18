# Lastrico · Fase 4.40 · Prontezza all'integrazione Git (15 novembre 2026)

Nessun push, merge o deploy; nessuna risorsa Cloudflare; nessun dato degli strati pubblicato. Il Strato Surface Intelligence **non è dichiarato pronto per la produzione**.

## 1. Stato verificato

| Elemento | Stato |
|---|---|
| `main` / `origin/main` | `3e31da9`, allineati |
| PR #16 | **aperta**, unibile, CI «Lint, test and build» riuscita, testa `1a5d8e9`, 8 commit avanti a `main` |
| `feat/phase438-osm-foundation` | `6fd4908`, 1 commit da `main` |
| `feat/phase439-surface-intelligence-shadow` | `bca48c1` |
| `feat/phase439b-dbt-citywide` | `b5ba991` (catena 4.38→4.39→4.39b, 3 commit da `main`) |
| `feat/phase440-sil-runtime-shadow` | `d9f24b0` (+2 sopra `b5ba991` di codice, 5 in tutto: `ac17c0d`, `f66bd41`, `de3848c`, `2ec753f`, `d9f24b0`) |
| `docs/phase436-closure` | `1dd00e7`, **6 commit da `main`**: contiene anche 4.38–4.39b. **Non usare per la PR documentale.** |
| **`docs/phase436-archive-clean`** (nuovo) | `5462147`, da `main`, 3 commit |

Tutti i worktree e i commit precedenti sono intatti (nessuno modificato); l'unico worktree creato è `Lastrico-phase436-docs-pr`. Un worktree di prova temporaneo è stato rimosso.

## 2. Ramo documentale pulito

`docs/phase436-archive-clean` = `main` + cherry-pick di `54245de`→`3a57ada`, `28bfa37`→`061a803`, `1dd00e7`→`5462147`. Nessun conflitto.
- 221 file: 1 in `docs/` (`ENGINEERING_STATUS.md`), 128 in `outputs/phase436-surface-intelligence/`, 92 script di ricerca in `experiments/phase436-surface-intelligence/scripts/`.
- **Nessun file fuori da queste tre aree:** zero in `lib/`, `app/`, `worker/`, `tests/`, `data/`.
- **Nessun dato GPS privato:** i soli file con «gps» nel nome sono lo script di analisi, il rapporto e il riepilogo redatto (celle di ~2 km, senza tracce); verifica già fatta in 4.36. I dati scaricati (178 MB) non sono inclusi.
- Test `experiments-isolation` e `open-source-readiness` sul ramo: 9 superati, 0 falliti.
- **Attenzione:** gli script in `experiments/` sono codice di ricerca, mai importato dal runtime; se «solo documentazione» va inteso in senso stretto, vanno esclusi (i rapporti li citano). Il commit di stato cita il ramo 4.40 (`ac17c0d`, `f66bd41`) che non è su `main`: va riscritto o accettato.
- `docs/ENGINEERING_STATUS.md` è modificato anche dalla PR #16: dopo la sua unione la tabella va ricontrollata.

## 3. Rebase della catena 4.38–4.40 dopo la PR #16

Prova eseguita (poi rimossa): ramo temporaneo dalla testa della PR #16 con cherry-pick di tutti i 7 commit (`6fd4908`, `bca48c1`, `b5ba991`, `ac17c0d`, `f66bd41`, `de3848c`, `2ec753f`, più il test `d9f24b0`): **nessun conflitto**. Su quell'albero: `tsc` pulito; 92 test mirati (4.39, 4.39b, 4.40, API dei percorsi, 4.37) → un solo fallimento, un test della 4.40 fragile alle fini riga CRLF dei checkout Windows. **Corretto** in `d9f24b0` (solo test) e riverificato (26 superati, 3 saltati perché mancano gli strati locali).

Ordine dopo l'unione della PR #16: aggiornare `main`; rebase di 4.38 → 4.39 → 4.39b → 4.40 in sequenza; file in comune da riguardare: `app/api/routes/route.ts` e `scripts/benchmark-milan-routing.mjs`. Dopo ogni passo: i test elencati nel §G6 del rapporto 4.40; dopo l'ultimo, il benchmark da 264 casi con **nuova baseline** (PR #16) e parità spento/ombra. **Non ancora eseguiti** sull'albero rebasato: suite completa, build, benchmark.

## 4. Strategia di verifica su Linux

Esiste un solo flusso, `.github/workflows/ci.yml` («Lint, test and build»): Ubuntu, Node 24, `npm ci`, `npm run lint`, `npm test` (= `vinext build` + `node --test tests/*.test.mjs`); parte su ogni `pull_request` e su `push` a `main`. **Può validare la catena** per lint, tipi indiretti (build), tutti i test e i 22 test oggi falliti su Windows, ma:
- **Non** esegue il benchmark da 264 casi (serve l'archivio dei provider, che nella suite fa fallire `phase434-intersection-audit`) e **non** vede gli strati reali (non versionati): la parità con strati reali resta locale, quella con provider fabbricato è nei test.
- Parte solo con un push o una PR: **richiede autorizzazione**.
Strategia: (1) PR documentale pulita → CI; (2) dopo la PR #16, PR in bozza della catena → CI (deve passare, compresi i 22 attuali falliti Windows; ogni fallimento è una regressione); (3) job opzionale di benchmark separato con l'archivio (da aggiungere solo se approvato); (4) controllo che `git ls-files data/surfaces/sil-layers` sia vuoto e che la build solo-Milano non contenga Roma.

## 5. Misure Cloudflare ancora necessarie (nessuna eseguita)

`wrangler dev` locale con workerd, poi un Worker di prova isolato con Durable Object (mai il pilota): CPU del Durable Object per richiesta (p50, p95, max) con `off` e `shadow` alternati; costo della prima richiesta a freddo e dell'`import()` dei 276 pezzi; memoria (nessuna terminazione ai 128 MB, nessuna crescita su 500 richieste); richieste secondarie (≤ 50); arrivo di `LASTRICO_SIL_MODE` a `process.env`; `wrangler deploy --dry-run`. Superamento: risposte identiche salvo `diagnostics`, CPU ≤ +5 % in p50 e nessun p95 oltre +10 ms. Gli strati usati vanno rimossi a fine prova.

## 6. Che cosa è pronto, che cosa è solo locale

- **Pronto per la revisione:** `docs/phase436-archive-clean` (dopo la scelta sugli script e sul commit di stato).
- **Solo locale, non su GitHub:** tutti i rami 4.38, 4.39, 4.39b, 4.40, `docs/phase436-closure` e `docs/phase436-archive-clean`.
- **Non pronto:** la catena 4.38–4.40 come PR: manca l'unione della PR #16, il rebase vero, la CI Linux e il benchmark sulla nuova baseline.

## 7. Dipendenze, conflitti, blocchi

1. PR #16 deve essere unita prima di ogni rebase (nessun conflitto testuale previsto, provato).
2. Blocchi di licenza invariati (versione CC BY del DBT, contatore composto OSM+DBT, termini del portale, canale di consegna dei dati): nessuno strato può essere pubblicato.
3. Nessuna misura su Cloudflare; CI Linux non eseguita.
4. `docs/phase436-closure` non va usato per una PR (porterebbe codice 4.38–4.39b).

## 8. Prossima azione che richiede approvazione esplicita

**Autorizzare il push di `docs/phase436-archive-clean` e l'apertura della PR documentale verso `main`** (per far girare la CI Linux), dopo la tua scelta su: (a) includere o no i 92 script di ricerca; (b) riscrivere o tenere il commit di stato che nomina il ramo 4.40. Nessun'altra azione di push, unione o Cloudflare è stata eseguita o è prevista senza un tuo via libera.
