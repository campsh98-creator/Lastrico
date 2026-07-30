# Prompt esecutivo — Stabilità, prestazioni e qualità della navigazione

## Mandato

Lavora esclusivamente sul branch `fix/navigation-stability-and-performance` del repository
Lastrico. Preserva la cronologia Git e non modificare, unire o forzare `main`. Esegui prima
diagnosi e misurazioni, poi applica correzioni incrementali con commit logici.

Gli obiettivi prioritari sono:

1. ricalcolo rapido e deterministico dopo una deviazione reale;
2. percorso attivo sempre chiaramente verde e distinguibile dalla mappa;
3. stime e progresso coerenti durante navigazione e ricalcolo;
4. movimento GPS, heading, marker e camera più fluidi senza inventare movimento;
5. classificazione del pavé trasparente, validata e dotata di confidenza;
6. stabilità durante una sessione di navigazione prolungata.

## Limiti e regole

- Non riscrivere l’intera applicazione e non introdurre dipendenze senza necessità misurata.
- Non dichiarare sconosciuta una strada come pavé.
- Non promettere copertura totale o traffico in tempo reale.
- Non usare force push, reset distruttivi o riscrittura della cronologia.
- Non aprire o unire pull request senza approvazione esplicita.
- Non pubblicare token, dump D1, cronologia GPS, indirizzi personali o configurazioni private.
- Lastrico e il percorso selezionato restano primari; le app esterne sono fallback.
- Mantieni l’ultimo percorso valido visibile mentre un ricalcolo è in corso.
- Una risposta asincrona obsoleta non può sostituire una rotta più recente.

## Organizzazione del lavoro

- **Release owner:** integra, misura, verifica i gate e mantiene coerenza del branch.
- **Routing/performance:** deviazione, richieste, timeout, scoring e telemetria temporale.
- **GPS/rendering:** filtraggio, marker, heading, camera e persistenza dello stile.
- **Dati pavé:** geometrie, duplicati, classificazioni, provenienza e confidenza.
- **QA:** regressioni, integrazione, sessione lunga, mobile e produzione.

Gli audit possono procedere in parallelo. Le modifiche ai file condivisi sono integrate dal
release owner.

## Fase A — Baseline

1. Ispeziona stack, provider, sorgenti dati, stato, map layers, test e documentazione.
2. Esegui `npm run lint`, `npm test` e build.
3. Avvia l’app e misura almeno:
   - avvio e inizializzazione mappa;
   - calcolo iniziale del percorso;
   - ricalcolo richiesto dalla navigazione;
   - scoring delle alternative;
   - aggiornamento della sorgente MapLibre.
4. Registra errori, warning e limiti in `docs/BUG_AUDIT.md`.
5. Registra metodologia e baseline in `docs/PERFORMANCE_REPORT.md`.

## Fase B — Controller di ricalcolo

Realizza un unico flusso autorevole che:

- distingue deviazione da rumore GPS usando soglia, accuratezza e letture consecutive;
- applica cooldown/debounce e impedisce loop;
- annulla richieste obsolete quando possibile;
- usa ID di richiesta e sessione per scartare risposte stale;
- mantiene la rotta esistente durante il calcolo;
- espone stato, timeout, retry limitato ed errore comprensibile;
- misura preparazione, rete, parsing/scoring, rendering e tempo totale;
- usa cache solo con limiti e chiavi deterministiche.

### Criteri di accettazione

- una deviazione reale genera una sola richiesta autorevole;
- letture rumorose isolate non ricalcolano;
- una risposta vecchia non sostituisce l’ultima;
- il percorso non scompare durante il ricalcolo;
- i tempi sono misurati e non descritti come istantanei senza evidenza.

## Fase C — Scoring anti-pavé

Centralizza un modello pesato che consideri durata, distanza, metri e percentuale di pavé,
deviazione e confidenza dei dati. Supporta:

- più rapido;
- bilanciato;
- massimo evitamento.

Quando il mezzo è già su pavé, minimizza l’esposizione successiva senza inversioni o
deviazioni assurde. Evita oscillazioni fra alternative equivalenti.

### Criteri di accettazione

- ogni candidato espone distanza, durata, pavé, percentuale, deviazione e confidenza;
- sconosciuto non equivale a pavé;
- il risultato resta entro limiti di deviazione configurati;
- test dedicati coprono entrata, uscita e recupero da un tratto critico.

## Fase D — Dati pavé

Crea `docs/COBBLESTONE_DATA_MODEL.md` e documenta:

- provenienza e data/versione;
- valori normalizzati;
- confermato, probabile, sconosciuto e confermato non-pavé;
- confidenza;
- validazione coordinate/geometrie;
- duplicati, segmenti sospetti e correzioni locali.

Non inventare dati mancanti. Le metriche devono distinguere dati noti da stime.

## Fase E — Rendering

Centralizza token di colore, larghezza, casing, opacità e ordine in un modulo unico.

- percorso attivo verde con outline ad alto contrasto;
- alternativa secondaria e non confondibile;
- rotta sopra le strade ordinarie;
- stile ripristinato dopo load/style reload/ricalcolo/resume;
- nessun colore nero o quasi nero per la rotta attiva;
- comportamento verificato in tema chiaro e scuro.

## Fase F — Progresso, GPS e camera

- Usa timestamp reali e rifiuta letture stale, duplicate o impossibili.
- Filtra in base all’accuratezza senza bloccare movimento valido.
- Interpola visivamente il marker fra letture accettate.
- Smussa l’heading sull’arco più corto.
- Mantieni una sola sottoscrizione GPS.
- Centralizza gli stati camera: overview, following, navigation-following, manual-control,
  recentering e arrival.
- Aggiorna senza valori negativi: durata totale, durata residua, ETA, distanza residua,
  distanza alla manovra e manovra corrente.
- L’arrivo richiede coerenza fra distanza, accuratezza, progresso e letture recenti.

## Fase G — Errori e risorse

Gestisci esplicitamente permessi, GPS assente/debole, offline, timeout, rate limiting,
risposta non valida, rotta vuota, stile mappa, geometria malformata, dati superficie
mancanti, resume e destinazione irraggiungibile.

Libera listener, timer, wake lock, richieste e sottoscrizioni. Non mostrare stack trace o
configurazioni private.

## Test minimi

- deviazione, debounce, cooldown e retry;
- annullamento e scarto risposte stale;
- sostituzione rotta e persistenza stile;
- scoring e confronto alternative;
- recupero da tratto pavé;
- ETA, distanze e arrivo;
- salto GPS, lettura stale e heading 359°→0°;
- transizioni camera;
- offline, timeout e risposta invalida;
- background/resume;
- sessione simulata prolungata senza crescita di timer o richieste.

I test devono esercitare helper e flussi reali, non limitarsi a restituire valori predefiniti
da mock.

## Documenti richiesti

- `docs/BUG_AUDIT.md`
- `docs/COBBLESTONE_DATA_MODEL.md`
- `docs/PERFORMANCE_REPORT.md`

## Gate di rilascio

- prompt versionato;
- baseline e misure dopo le correzioni documentate;
- lint, build e test verdi;
- verifica browser su desktop, 393×852, 320×568 e 568×320;
- sessione lunga simulata completata;
- nessun segreto o dato locale nel diff;
- working tree pulito;
- commit piccoli e descrittivi;
- solo il branch di correzione pubblicato;
- nessun merge o pull request automatico;
- limiti non verificabili dichiarati esplicitamente.
