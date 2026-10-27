# Benchmark Phase 3.2 — metodo e riproduzione

Il benchmark esegue il vero handler `/api/routes` con tre coppie di coordinate fisse nel centro di Milano, ciascuna nei profili auto, moto e bici. Le coordinate identificano punti di prova presso Castello/Missori, San Babila/Cordusio e Brera/Santa Sofia; non sono traiettorie GPS rilevate. Parametri invarianti: `avoid=strong`, `maxExtraMinutes=5`, planner, PoC non richiesto esplicitamente.

## Fonte dei percorsi e confronto

I percorsi arrivano dal provider pubblico configurato nell'applicazione. Ogni richiesta HTTP viene archiviata in `responses/` insieme alla risposta originale, all'URL, al corpo della richiesta, all'istante di acquisizione, alla durata HTTP e ai checksum SHA-256. Nessuna geometria stradale viene costruita per ottenere risultati favorevoli. Le risposte sono acquisite sequenzialmente e non rappresentano uno snapshot atomico del grafo Valhalla.

In entrambi gli algoritmi Overpass restituisce intenzionalmente indisponibile: la classificazione usa esclusivamente l'archivio OSM pilota committato nella Phase 2, identificato dal checksum nei risultati. Questo evita che un aggiornamento di superficie differente falsi il confronto. Non misura l'affidabilità di Overpass né la copertura cittadina.

`baseline/` conserva il sorgente dell'handler e dei moduli modificati rispetto all'inizio della Phase 3.2. Il vecchio PoC rimane disattivato nella baseline, come nell'esperienza predefinita Phase 3.1. La versione successiva usa il codice attuale della workspace. Le istruzioni TypeScript sono trascompilate soltanto per risolvere alias e JSON in Node, come nei test API del progetto: la logica dell'handler non viene riscritta dal benchmark.

## Comandi

Acquisizione iniziale o delle sole richieste mancanti, con accesso alla rete:

```sh
node scripts/benchmark-route-optimization.mjs --phase=before --live
node scripts/benchmark-route-optimization.mjs --phase=after --live
```

Replay offline di entrambi gli algoritmi:

```sh
node scripts/benchmark-route-optimization.mjs
```

Il replay fallisce se manca una risposta richiesta o se un checksum non corrisponde. Gli errori del provider archiviati restano errori: non vengono convertiti in candidati sintetici.

`before.json` e `after.json` contengono le misure aggregate per caso; i file con il nome del caso conservano l'intera risposta API. I file `*-acquisition.json` preservano la prima fase di acquisizione separatamente dal replay.

## Interpretazione

- Pavé: metri fisici confermati o probabili dello scorer Phase 2, non certificazione di comfort. L'ottimizzatore può usare il peso di classificazione nelle decisioni.
- Tempo aggiuntivo: secondi rispetto alla baseline rapida valida dello stesso algoritmo; il limite esplicito è 300 secondi.
- Sconosciuto: metri e quota della lunghezza geometrica classificata dello scorer, non distanza dichiarata dal provider.
- Diversità: disponibilità di un'alternativa selezionata distinta e numero di candidati distinti dalla baseline secondo il relativo contratto API. I checksum delle geometrie permettono di verificare se il percorso selezionato cambia.
- Latenza: nel replay ogni risposta attende la propria durata HTTP registrata; scoring e coda del provider vengono eseguiti e misurati nuovamente. È una misura locale con rete riprodotta, non un percentile del servizio live. Le acquisizioni before/after condividono le risposte di richieste identiche; una nuova richiesta viene acquisita soltanto con `--live`.

Il campione è intenzionalmente piccolo, centrale e riproducibile. Include tutte le nove combinazioni, anche quelle senza beneficio. Non misura traffico in tempo reale, qualità della navigazione GPS, restrizioni non presenti nei dati né completezza della rete sul territorio.
