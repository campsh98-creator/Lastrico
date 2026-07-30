# Rapporto prestazioni della navigazione

Data: 30 luglio 2026  
Ambiente iniziale: macOS, Node.js locale, build di produzione vinext/Vite

## Metodo

Le misure sono separate in:

1. controlli locali riproducibili (lint, build e test);
2. tempi server esposti dalla risposta di routing;
3. tempi client per richiesta, parsing/applicazione e aggiornamento della mappa;
4. verifica browser su desktop e viewport mobili;
5. sessione simulata prolungata con conteggio di richieste e timer.

I tempi dei provider pubblici non vengono presentati come garanzie. Le misure di rete devono
riportare data, percorso, modalità e numero di campioni.

## Baseline prima delle correzioni

| Controllo | Risultato |
| --- | ---: |
| `npm run lint` | superato, 3,76 s |
| `npm test` | superato, 3,65 s |
| Test automatici | 24/24 |
| Client references | 374 ms |
| Server references | 150 ms |
| RSC build | 416 ms |
| Client environment | 539 ms |
| SSR build | 462 ms |

Il build segnala chunk client oltre 500 kB minificati. Il valore è coerente con MapLibre e
con l’ampio componente client, ma resta un limite da monitorare.

La baseline applicativa non separa ancora in modo strutturato preparazione, rete, scoring e
rendering. Questa assenza è essa stessa un risultato dell’audit: le correzioni introdurranno
misure monotone senza includere indirizzi o coordinate nei log.

## Obiettivi misurabili

- Una deviazione confermata produce una sola richiesta autorevole.
- Nessuna risposta obsoleta modifica la rotta attiva.
- Il percorso esistente non scompare durante il ricalcolo.
- Nessun timer o watch GPS rimane attivo dopo la fine della sessione.
- Nessun valore residuo o ETA diventa negativo.
- La sessione simulata prolungata termina senza crescita continua di timer o richieste.

## Risultati dopo le correzioni

Da compilare soltanto con misure riproducibili al termine dell’implementazione.

