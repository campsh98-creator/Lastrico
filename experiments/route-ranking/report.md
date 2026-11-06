# Fase 4.20 — Agente A: classificazione spiegabile dei percorsi

*Rapporto generato da `experiments/route-ranking/benchmark.mjs` (versione classificatore 0.1.0). Tutti i numeri sono ricalcolati dai dati grezzi del corpus; nessuno è stimato o digitato a mano.*

## In breve

- Abbiamo costruito un **classificatore multicriterio spiegabile**: vincoli rigidi (legalità, limite di tempo, limite di deviazione, riduzione minima di pavé noto), poi esclusione dei percorsi dominati, poi un **punteggio additivo in "metri-equivalenti di pavé"** in cui ogni criterio (pavé confermato, pavé probabile, fondo sconosciuto, tempo, distanza) ha un contributo leggibile e una frase in italiano spiega perché il percorso scelto batte (o non batte) il più rapido.
- Sui percorsi reali il classificatore **fa quasi sempre la stessa scelta della produzione attuale**: 188 confronti su 189 (99%) sui dati attuali (profili Bilanciato, Deciso, Massimo), 399/400 includendo l'archivio e il profilo Più rapido. Con il profilo Deciso (predefinito in produzione) l'accordo sulle 34 richieste reali di oggi è 34/34.
- Il vantaggio dimostrato è quindi **trasparenza e configurabilità**, non percorsi migliori: le scelte restano le stesse, ma ora sono scomponibili e regolabili con pesi espliciti.
- Su insiemi **sintetici** casuali (solo per capire dove le due regole differiscono) l'accordo scende a 96%: la differenza principale è che il classificatore dà credito a un percorso con **meno tratti sconosciuti**, mentre la produzione non lo fa. È un'opzione (`creditUnknownReduction`) e una decisione di prodotto da prendere.
- Nessuna scelta del classificatore è dominata (0 casi su 400); per confronto la produzione ne ha 0 nello spazio dei criteri del classificatore.
- **Limite principale**: non esiste una verità di riferimento sulla soddisfazione degli utenti né sulla rugosità reale; e gli scenari con un vero compromesso pavé/tempo sui dati attuali sono solo 36 (28 dalle 34 richieste reali di oggi, 8 dal ricalcolo dell'archivio), tutti a Milano (a Roccella nessun percorso registrato offre un compromesso: il pavé noto lungo quei percorsi è zero).
- **Raccomandazione: GO condizionato** per una fase di integrazione dedicata *come motore di spiegazione e di preferenze*, che sostituisca il calcolo interno di `selectOptimizedRoute` solo dopo una prova in parallelo; **NO-GO** per presentarlo come "percorsi migliori".

## Cosa fa il classificatore

1. **Vincoli rigidi**, nello stesso ordine della produzione: profilo del fornitore corretto e nessun tratto vietato (stessa regola di `isLegalCandidate`, verificata su ogni candidato del corpus); riferimento = percorso legale più rapido; esclusi i duplicati dello stesso corridoio; limite di minuti in più scelto dall'utente; limite di deviazione del profilo (stessi valori della produzione); un'alternativa deve ridurre il **pavé noto** di almeno 20 m (auto), 15 m (moto) o 12 m (bici).
2. **Filtro di Pareto** su tempo, distanza, pavé confermato, pavé probabile, sconosciuto e sterrato: un percorso peggiore o uguale su tutto non può vincere.
3. **Costo additivo** relativo al più rapido, in metri-equivalenti di pavé confermato (m-eq). Il fondo sconosciuto **non è mai trattato come asfalto**: pesa sempre più di zero, e i metri sconosciuti che sostituiscono pavé evitato senza asfalto confermato in cambio pesano quanto il pavé confermato (supplemento prudenziale). Un'alternativa paga anche una piccola soglia di cambio percorso, così un vantaggio trascurabile non fa cambiare strada.

Profili predefiniti (i pesi di tempo derivano dalla politica di produzione `balancedPaveDivisor`; la distanza al 10% del tempo per km è un'ipotesi **non calibrata**):

| Modalità | Profilo | 1 min vale (m di pavé) | Pavé probabile | Sconosciuto | Supplemento non compensato | 1 km vale (m) | Soglia di cambio (m) | Limite deviazione |
|---|---|---:|---:|---:|---:|---:|---:|---|
| auto | Più rapido | solo tempo | 0,0% | 0,0% | 0,0% | 0,0 | 20 | ×1,2 + 180 s |
| auto | Bilanciato | 500,0 | 65,0% | 35,0% | 65,0% | 50,0 | 20 | ×1,2 + 180 s |
| auto | Deciso | 50,0 | 65,0% | 35,0% | 65,0% | 5,0 | 20 | ×1,4 + 420 s |
| auto | Massimo | 5,0 | 65,0% | 50,0% | 50,0% | 0,5 | 20 | ×1,7 + 720 s |
| moto | Più rapido | solo tempo | 0,0% | 0,0% | 0,0% | 0,0 | 15 | ×1,3 + 240 s |
| moto | Bilanciato | 330,0 | 65,0% | 35,0% | 65,0% | 33,0 | 15 | ×1,3 + 240 s |
| moto | Deciso | 33,0 | 65,0% | 35,0% | 65,0% | 3,3 | 15 | ×1,6 + 540 s |
| moto | Massimo | 3,3 | 65,0% | 50,0% | 50,0% | 0,3 | 15 | ×1,9 + 900 s |
| bici | Più rapido | solo tempo | 0,0% | 0,0% | 0,0% | 0,0 | 12 | ×1,3 + 300 s |
| bici | Bilanciato | 260,0 | 65,0% | 35,0% | 65,0% | 26,0 | 12 | ×1,3 + 300 s |
| bici | Deciso | 26,0 | 65,0% | 35,0% | 65,0% | 2,6 | 12 | ×1,6 + 720 s |
| bici | Massimo | 2,6 | 65,0% | 50,0% | 50,0% | 0,3 | 12 | ×2,1 + 1200 s |

Il profilo **Personalizzato** permette di cambiare ogni peso e il limite di deviazione; i valori vengono validati (pesi finiti e non negativi, pavé probabile non più pesante del confermato, sconosciuto sempre positivo).

## Corpus

- File inventariati con SHA-256 e provenienza: **136** (`corpus/manifest.json`). Risposte API registrate: 74; 3 esclusi perché duplicati esatti (riproduzioni in modalità navigazione); 6 hanno candidati identici a un'altra modalità (auto e moto di Valhalla coincidono spesso in città; per il fixture moto E2E non si può escludere una copia) e sono tenuti ma non contati come insiemi indipendenti (65 insiemi indipendenti).
- Divisione pavé confermato/probabile per i candidati senza valori esatti: ricavata dal pavé ponderato (peso 1 per sett/ciottoli, 0,65 per paving_stones); verificata su 106 percorsi con valori esatti, errore massimo 2 m (50 identici).
- **Richieste reali nuove** al server locale (copia esatta della build `dist/` del 5/11/2026, solo coordinate, una richiesta ogni ≥10 s): 36 richieste, 34 riuscite, 2 non riuscite. Le non riuscite sono risposte 422 della produzione per la bici ("tutti i percorsi trovati attraversano tratti vietati secondo OpenStreetMap"), non errori del fornitore. Le risposte grezze sono in `corpus/live-2026-11-05/`.

| Insieme | Scenari | Con alternativa distinta | Con compromesso pavé/tempo | Candidati | auto / moto / bici | Milano / Roccella |
|---|---:|---:|---:|---:|---|---|
| R-live (risposte reali del codice attuale, 5/11/2026) | 34 | 34 | 28 | 158 | 12 / 12 / 10 | 34 / 0 |
| G (geometrie archiviate ricalcolate con classificatore e dati attuali) | 29 | 22 | 8 | 84 | 12 / 8 / 9 | 15 / 14 |
| R-archivio (metriche registrate da versioni precedenti del codice) | 37 | 33 | 13 | 120 | 14 / 11 / 12 | 23 / 14 |

"Alternativa distinta" = candidato legale fuori dal corridoio del più rapido. "Compromesso" = alternativa distinta con almeno la riduzione minima di pavé noto. La Fase 4.17 contava invece solo i casi in cui il percorso scelto differiva dal più rapido (2 su 24). Le metriche dell'archivio differiscono molto da quelle ricalcolate: l'archivio OSM è cresciuto dopo le registrazioni (molti tratti "sconosciuti" ora sono classificati), quindi l'insieme R-archivio descrive i dati di allora e conta come prova storica, non attuale.

## Verifica del banco di prova

Rieseguendo la selezione **attuale** di produzione (`selectOptimizedRoute` + filtro finale di `route.ts`) sugli stessi candidati registrati:

- R-live: 34/34 scelte identiche a quelle restituite dal server reale (stesso codice): il banco riproduce fedelmente la produzione.
- R-archivio: 35/37; le differenze (before-castello-missori-bicycle, before-castello-missori-car) sono registrazioni prodotte da codice di generazione precedente (phase3.1), con una regola di selezione poi cambiata: il confronto equo è con la produzione attuale, non con la scelta registrata allora.

Controllo indipendente dalle risposte grezze del server (senza passare dal corpus normalizzato): 23 cambi di percorso su 34 risposte, 11.884 m di pavé evitati, 57,6 minuti e +269 m di sconosciuto in più — identici ai valori del banco per la produzione con profilo Deciso.

Scelta del classificatore (profilo e limite richiesti nella registrazione) uguale alla scelta registrata: R-live 34/34, R-archivio 35/37.

## Risultati

Valori aggregati con il limite di tempo richiesto (R-live: nessun limite; archivio e G: +5 min). Per ogni colonna: classificatore / produzione.

### R-live (risposte reali del codice attuale, 5/11/2026)

| Profilo | Confronti | Accordo con produzione | Cambi di percorso (classificatore / produzione) | Pavé noto evitato, m | Minuti aggiunti | Metri aggiunti | Sconosciuto aggiunto, m |
|---|---:|---:|---:|---:|---:|---:|---:|
| Più rapido | 34 | 34/34 (100%) | 0 / 0 | 0 / 0 | 0,0 / 0,0 | 0 / 0 | 0 / 0 |
| Bilanciato | 34 | 33/34 (97%) | 7 / 8 | 3222 / 4330 | 6,6 / 9,6 | 1275 / 2312 | -187 / -143 |
| Deciso | 34 | 34/34 (100%) | 23 / 23 | 11.884 / 11.884 | 57,6 / 57,6 | 15.626 / 15.626 | 269 / 269 |
| Massimo | 34 | 34/34 (100%) | 28 / 28 | 12.594 / 12.594 | 76,5 / 76,5 | 20.835 / 20.835 | 504 / 504 |

### G (geometrie archiviate ricalcolate con classificatore e dati attuali)

| Profilo | Confronti | Accordo con produzione | Cambi di percorso (classificatore / produzione) | Pavé noto evitato, m | Minuti aggiunti | Metri aggiunti | Sconosciuto aggiunto, m |
|---|---:|---:|---:|---:|---:|---:|---:|
| Più rapido | 29 | 29/29 (100%) | 0 / 0 | 0 / 0 | 0,0 / 0,0 | 0 / 0 | 0 / 0 |
| Bilanciato | 29 | 29/29 (100%) | 5 / 5 | 2058 / 2058 | 2,3 / 2,3 | 838 / 838 | -11 / -11 |
| Deciso | 29 | 29/29 (100%) | 7 / 7 | 3152 / 3152 | 9,0 / 9,0 | 2900 / 2900 | -95 / -95 |
| Massimo | 29 | 29/29 (100%) | 7 / 7 | 3152 / 3152 | 9,0 / 9,0 | 2900 / 2900 | -95 / -95 |

### R-archivio (metriche registrate da versioni precedenti del codice)

| Profilo | Confronti | Accordo con produzione | Cambi di percorso (classificatore / produzione) | Pavé noto evitato, m | Minuti aggiunti | Metri aggiunti | Sconosciuto aggiunto, m |
|---|---:|---:|---:|---:|---:|---:|---:|
| Più rapido | 37 | 37/37 (100%) | 0 / 0 | 0 / 0 | 0,0 / 0,0 | 0 / 0 | 0 / 0 |
| Bilanciato | 37 | 37/37 (100%) | 5 / 5 | 2152 / 2152 | 2,1 / 2,1 | 254 / 254 | 252 / 252 |
| Deciso | 37 | 37/37 (100%) | 9 / 9 | 3976 / 3976 | 10,6 / 10,6 | 1723 / 1723 | 1034 / 1034 |
| Massimo | 37 | 37/37 (100%) | 9 / 9 | 3976 / 3976 | 10,6 / 10,6 | 1723 / 1723 | 1034 / 1034 |

Con il profilo Massimo sulle richieste reali di oggi, entrambi cambiano percorso in 28 casi su 34, evitando in totale 12.594 m di pavé noto per 76,5 minuti in più (165 m evitati per minuto) e 504 m di fondo sconosciuto in più. Con il profilo Deciso: 11.884 m per 57,6 minuti. Con il Bilanciato il classificatore cambia percorso 7 volte contro 8 della produzione (più prudente).

### Divergenze (limite di tempo richiesto)

- **resp-05-duomo-porta-garibaldi-motorcycle** (R-live, moto, profilo Bilanciato): la produzione sceglie *base-3* (1108 m di pavé noto evitati, +3,1 min, +1037 m, sconosciuto +44 m); il classificatore sceglie *base-2*. Motivazione del classificatore: «Mantengo il percorso più rapido (base-2): la migliore alternativa (base-3) evita 898 m di pavé confermato e 210 m di pavé probabile, con +3,1 min e +1,0 km; i tratti senza dati aumentano di 44 m (contati come rischio, mai come asfalto). Con il profilo «Bilanciato» (1 minuto vale 330 m di pavé confermato) il saldo è +48 m-eq, quindi non conviene.»

Attribuzione: togliendo al classificatore i due criteri che la produzione non usa (distanza in più e soglia di cambio percorso), divergenze che scompaiono: 1 su 1. Divergenze in cui entrambe le scelte sono non dominate: 1 su 1; si tratta di differenze di preferenza, non di errori.

### Ottimalità di Pareto

- Scelte del classificatore dominate: 0 nello spazio dei suoi criteri, 0 nello spazio della produzione (tempo, rischio ponderato, sconosciuto), su 400 confronti.
- Scelte della produzione dominate: 0 nello spazio del classificatore, 0 nel proprio.

### Esempi di spiegazioni generate

- *castello-porta-venezia-car* (auto, profilo Deciso): «Scelgo base-2 invece del più rapido (base-1): evita 728 m di pavé confermato, con +1,1 min e +0,2 km; i tratti senza dati aumentano di 311 m (contati come rischio, mai come asfalto). Saldo −455 m-eq di pavé con il profilo «Deciso» (1 minuto vale 50 m di pavé confermato). Supplemento prudenziale: 136 m sconosciuti sostituiscono pavé senza asfalto confermato.»
- *castello-porta-venezia-motorcycle* (moto, profilo Deciso): «Scelgo base-2 invece del più rapido (base-1): evita 526 m di pavé confermato e aggiunge 117 m di pavé probabile, con +1,1 min e +0,2 km; i tratti senza dati calano di 8 m. Saldo −401 m-eq di pavé con il profilo «Deciso» (1 minuto vale 33 m di pavé confermato).»
- *duomo-porta-garibaldi-car* (auto, profilo Deciso): «Mantengo il percorso più rapido (base-1): nessuna alternativa supera i vincoli (5 senza riduzione sufficiente del pavé noto).»

### Sensibilità ai pesi

Numero di scenari (con almeno un'alternativa distinta) in cui il vincitore cambia se si perturba un solo peso:

| Insieme | Profilo | Scenari con alternative | tempo x0.5 | tempo x0.8 | tempo x1.25 | tempo x2 | probabile 0.4 | probabile 0.9 | sconosciuto 0.2 | sconosciuto 0.6 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| R-live | Bilanciato | 34 | 7 | 5 | 3 | 4 | 0 | 2 | 0 | 0 |
| R-live | Deciso | 34 | 2 | 0 | 3 | 6 | 2 | 0 | 0 | 2 |
| R-live | Massimo | 34 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| G | Bilanciato | 22 | 1 | 0 | 1 | 3 | 1 | 0 | 0 | 0 |
| G | Deciso | 22 | 0 | 0 | 1 | 2 | 1 | 0 | 0 | 0 |
| G | Massimo | 22 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Somma dei cambi di vincitore sotto le quattro perturbazioni del tempo: Bilanciato 24, Deciso 14, Massimo 0. Il profilo Massimo non cambia mai: con un peso del tempo così basso decidono di fatto il limite di tempo e il limite di deviazione. Valore del minuto di equilibrio sui 36 scenari attuali con compromesso (pesi del profilo Deciso, limite di deviazione Massimo, griglia logaritmica da 1 a 5000 m per minuto): il valore più alto del minuto per cui una deviazione vince ancora va da 10 a ≥5000 m di pavé (mediana 200); scenari in cui nessuna deviazione rientra nel limite di tempo: 1. La preferenza dell'utente conta davvero: un solo valore fisso non rappresenta tutti.

### Dove le due regole differiscono (verifica SINTETICA, non prove reali)

SYNTHETIC — seeded random candidate pools, not genuine routes: 2000 insiemi casuali per modalità e profilo (seme 20261105), limite +5 min, nessun duplicato di corridoio.

| Modalità / profilo | Insiemi | Accordo | Solo la produzione cambia | Solo il classificatore cambia | Cambi diversi | Spiegati da distanza + soglia | ... + nessun credito per meno sconosciuto |
|---|---:|---:|---:|---:|---:|---:|---:|
| auto / Bilanciato | 2000 | 97% | 16 | 28 | 7 | 14/51 | 49/51 |
| auto / Deciso | 2000 | 96% | 17 | 40 | 27 | 10/84 | 63/84 |
| auto / Massimo | 2000 | 95% | 25 | 21 | 60 | 10/106 | 64/106 |
| moto / Bilanciato | 2000 | 97% | 16 | 42 | 7 | 16/65 | 64/65 |
| moto / Deciso | 2000 | 97% | 5 | 32 | 32 | 3/69 | 48/69 |
| moto / Massimo | 2000 | 95% | 19 | 23 | 65 | 6/107 | 65/107 |
| bici / Bilanciato | 2000 | 98% | 10 | 27 | 4 | 10/41 | 41/41 |
| bici / Deciso | 2000 | 96% | 8 | 45 | 28 | 8/81 | 59/81 |
| bici / Massimo | 2000 | 95% | 20 | 22 | 67 | 3/109 | 51/109 |

Nelle 713 divergenze sintetiche la variazione totale di fondo sconosciuto rispetto al più rapido è −203.873 m per il classificatore e +127.784 m per la produzione; il pavé noto evitato è 228.769 m contro 297.384 m, con 1162,7 contro 963,7 minuti in più. In altre parole il classificatore sceglie più spesso percorsi meglio documentati, la produzione percorsi con più pavé evitato ma più tratti senza dati. Togliendo distanza e soglia e disattivando il credito per meno sconosciuto, le divergenze spiegate sono 504 su 713; le restanti non sono attribuite sperimentalmente e coincidono con le altre differenze di regola note: il tetto 1,25× della produzione sullo sconosciuto scontato e, nel profilo Massimo, il peso del tempo (0 in produzione, 1/100 nel classificatore). Sui percorsi reali, disattivare il credito per meno sconosciuto cambia la scelta in 1 confronti su 300 (di questi, uguali alla produzione dopo il cambio: 0): le differenze sono rare ma reali, e un'integrazione deve scegliere esplicitamente una sola regola.

### Prestazioni

Tempo per classificazione (Node v24.18.0, 100 scenari, fino a 7 candidati, esclusi calcolo geometrico, punteggio di superficie e chiamate al fornitore): classificatore mediana 4,6 µs, 95° percentile 7,8 µs, massimo 8,7 µs; selezione di produzione mediana 1,3 µs, 95° percentile 2,4 µs. Il costo aggiuntivo è irrilevante rispetto al limite CPU del Worker e ai secondi delle chiamate di routing.

## Qualità delle prove e limiti

- **Nessuna verità di riferimento**: non sappiamo quale percorso gli utenti preferiscano né quanto sia davvero sconnessa la strada. L'accordo con la produzione misura coerenza, non qualità.
- **Accordo atteso per costruzione**: i pesi di tempo e i limiti sono derivati dalla politica di produzione; l'alto accordo dimostra che la logica attuale si può esprimere in forma additiva spiegabile, non che sia giusta.
- **Campione piccolo e concentrato**: 36 scenari attuali con compromesso, 34 richieste reali di oggi tutte nel centro di Milano; nessun dato moto/bici distinto per Roccella; i candidati dipendono da come la produzione li genera (fino a 3 alternative del fornitore, 1 percorso "surface-aware", fino a 3 deviazioni).
- **Precisione**: per i candidati non scelti la durata registrata è arrotondata al secondo e la divisione confermato/probabile è ricavata (errore ≤ 2 m); l'equivalenza di corridoio in R viene dal flag registrato rispetto al più rapido.
- **Pesi non calibrati**: probabile 0,65 e sconosciuto 0,35/0,5 riprendono la produzione; la distanza è un'ipotesi; servono preferenze dichiarate dagli utenti per calibrarli.

## Costo di manutenzione

- Classificatore: 417 righe di codice (520 totali), **zero import dalla produzione**; dipende solo da un contratto di metriche che si ottiene 1:1 da `RoadIntelligenceScore` + `EngineRoute`. Costanti duplicate: limiti e soglie di `MODE_POLICY`, protette da un test che legge il sorgente di produzione.
- Banco di prova (corpus, adattatore, benchmark, report, cattura): 1295 righe; test: 403 righe. Il banco importa in sola lettura 6 moduli di produzione.
- Rischi di integrazione: tre differenze di regola da risolvere prima di mostrare spiegazioni, altrimenti la spiegazione non descriverebbe la decisione reale — (1) trattamento dello sconosciuto (tetto 1,25× in produzione, supplemento lineare nel classificatore), (2) credito per meno sconosciuto (assente in produzione), (3) distanza e soglia di cambio (assenti in produzione; divergenze nel profilo Bilanciato di oggi: 1 su 34); testi italiani da revisionare con l'utente; il contratto di metriche richiede che la produzione esponga pavé confermato e probabile per ogni candidato (oggi la diagnostica ne espone solo la somma e il ponderato).

## Raccomandazione

**GO condizionato** per una fase di integrazione con prompt dedicato, limitata a:

1. usare il classificatore come **unica regola di decisione e di spiegazione** (mai spiegare con una formula una scelta presa da un'altra), dietro un flag, dopo una prova in parallelo sulle suite esistenti e su nuove catture reali con criterio di accettazione ≥ 95% di accordo con la produzione per i profili esistenti e 0 scelte dominate; decidere prima se un percorso con meno tratti sconosciuti merita credito (oggi la produzione dice di no);
2. mostrare la frase "perché questo percorso" e la scomposizione dei contributi; esporre il profilo personalizzato solo se ogni controllo cambia davvero la scelta (regola AGENTS.md);
3. raccogliere più scenari con compromesso (moto e bici, Roccella, periferie) prima di modificare i pesi.

**NO-GO** per qualsiasi affermazione di "percorsi migliori" o di comfort: le prove dimostrano trasparenza e coerenza, non un beneficio per l'utente.

## Riproduzione (dalla radice del repository)

```sh
node --test experiments/route-ranking/test/
node experiments/route-ranking/build-corpus.mjs
node experiments/route-ranking/benchmark.mjs
```
