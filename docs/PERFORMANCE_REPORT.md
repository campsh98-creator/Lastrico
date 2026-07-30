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

### Micro-benchmark locale

Indice superficie costruito una volta sull’intero snapshot da 1.530 way:

| Misura | Risultato |
| --- | ---: |
| Costruzione indice, 1.023 celle | 6,851 ms |
| Score sintetico 50 punti, p95 su 30 iterazioni | 3,473 ms |
| Score sintetico 200 punti, p95 su 30 iterazioni | 1,097 ms |
| Score sintetico 500 punti, p95 su 30 iterazioni | 0,950 ms |

Il percorso sintetico mantiene approssimativamente la stessa lunghezza al variare dei punti;
serve a misurare l’effetto della densità della geometria, non la latenza di rete. La baseline
equivalente senza indice misurava 21 ms per 50 punti, 88,5 ms per 200 e 221 ms per 500.

Modello progresso con 5.000 punti e 100 istruzioni:

| Misura | Risultato |
| --- | ---: |
| Precalcolo | 18,073 ms |
| Aggiornamento mediano | 0,131 ms |
| Aggiornamento p95 | 0,231 ms |

### Verifica browser

- Desktop: ricerca indirizzi, selezione risultati e percorso reale completati.
- Percorso Duomo → Porta Venezia: 5 candidati reali, nessun errore console applicativo.
- Viewport verificate: 393×852, 320×568 e 568×320.
- Interazioni principali presenti anche nei layout compatti; a 320×568 e in orizzontale il
  pannello richiede scorrimento per raggiungere tutti i controlli.
- Sessione simulata mobile di circa 73 secondi: completata automaticamente, messaggio di
  arrivo mostrato, nessun errore browser.

Il campione di routing usa provider pubblici e non costituisce un SLA. Il controllo GPS reale
su strada resta necessario prima di dichiarare la navigazione pronta per uso generale.

### Stato finale dei controlli locali

- lint superato;
- build superata;
- 35 test su 35 superati;
- resta l’avviso non bloccante sui chunk client oltre 500 kB minificati.
