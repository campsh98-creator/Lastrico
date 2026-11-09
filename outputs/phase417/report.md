# Phase 4.17 — esperimento offline

**NO-GO per l’integrazione nel navigatore.** Nessuna modifica al pilot o alle etichette OSM.

## Dati e metodo

Archivi OSM verificati con SHA-256; © OpenStreetMap contributors, ODbL-1.0. Un campione per way, segmenti conservati per geometria e routing. Nessuna suddivisione casuale. Sett/ciottolato esplicito è positivo; asfalto, cemento e materiali sciolti espliciti sono negativi per il solo target pavé. Paving stones, paved e informazioni ausiliarie sono escluse dal target.

| Area | Way | Pavé esplicito | Non pavé esplicito | Senza evidenza ausiliaria | km totali |
|---|---:|---:|---:|---:|---:|
| milan | 62495 | 2208 | 39025 | 16935 | 3591.07 |
| roccella | 1052 | 0 | 122 | 926 | 197.19 |

Sono lunghezze di way complete degli archivi, anche oltre i bbox di acquisizione: non la copertura delle tile runtime, né km-corsia. Le classi intermedie restano escluse. Le etichette mancanti non sono un campione casuale; le osservazioni OSM non sono rilievi indipendenti sul campo.
milan: 70.72% della lunghezza ha un’etichetta binaria utilizzabile; 24.17% è privo anche di evidenza ausiliaria.
roccella: 23.11% della lunghezza ha un’etichetta binaria utilizzabile; 76.58% è privo anche di evidenza ausiliaria.

Copertura e distribuzioni per lunghezza, materiale e tipo di strada: `results.json`. Quattro settori geografici di Milano, fascia esclusa di 200 m per lato, way che attraversano i confini escluse interamente. Due settori per training, uno per calibrazione sigmoidale, uno per test. Parametri e soglia 0,5 fissi. Le probabilità di test non provengono da modelli addestrati o calibrati nel relativo settore.

Feature: highway, service, junction, bridge, tunnel, oneway, lanes, maxspeed, lit, sidewalk, cycleway, bicycle, access; posizione, lunghezza, sinuosità e orientamento. Esclusi surface e derivati, smoothness, tracktype, nomi, ID, date e materiali dei vicini. Preprocessing addestrato solo sul training.

## Risultati geografici fuori campione

| Modello | Precisione | Recall | F1 | Brier | ECE |
|---|---:|---:|---:|---:|---:|
| prevalence | 0.000 | 0.000 | 0.000 | 0.0451 | 0.0013 |
| highway_frequency | 0.000 | 0.000 | 0.000 | 0.0444 | 0.0038 |
| logistic | 0.750 | 0.002 | 0.003 | 0.0449 | 0.0104 |
| logistic_uncalibrated | 0.058 | 0.074 | 0.065 | 0.0835 | 0.1022 |
| hist_gradient_boosting | 0.000 | 0.000 | 0.000 | 0.0438 | 0.0065 |
| hist_gradient_boosting_uncalibrated | 0.280 | 0.044 | 0.076 | 0.0463 | 0.0240 |

Sensibilità aggiuntiva: soglia che massimizza F1 scelta esclusivamente sul settore di calibrazione, senza ottimizzare sul test. Queste soglie non attivano routing o nuove etichette:

| Modello | Precisione | Recall | F1 |
|---|---:|---:|---:|
| prevalence | 0.047 | 1.000 | 0.090 |
| highway_frequency | 0.059 | 0.233 | 0.094 |
| logistic | 0.050 | 0.603 | 0.092 |
| hist_gradient_boosting | 0.118 | 0.461 | 0.188 |

HGB migliora average precision da 0.078 a 0.115; il vantaggio non basta per l’integrazione. Con soglie scelte in calibrazione, la matrice HGB [[TN, FP], [FN, TP]] è [[28863.0, 5947.0], [931.0, 796.0]]: la maggior parte delle segnalazioni è falsa. Tra 31860 way con p≤0,1, 1096 sono pavé OSM: una probabilità bassa non giustifica dichiarazioni di fondo liscio.

Il normalizzatore corrente, privato dei tag di materiale, non riconosce pavé: F1=0; l’astensione non è una previsione sicura di fondo liscio. Il confronto con frequenze per highway è più informativo. Matrici di confusione, curve di affidabilità, metriche per lunghezza e risultati non calibrati sono in `results.json`.

| Settore di test | Positivi | Precisione HGB | Recall HGB | F1 HGB |
|---|---:|---:|---:|---:|
| SW | 299 | 0.000 | 0.000 | 0.000 |
| SE | 327 | 0.000 | 0.000 | 0.000 |
| NW | 352 | 0.000 | 0.000 | 0.000 |
| NE | 749 | 0.000 | 0.000 | 0.000 |

Roccella: 122 etichette valutabili, nessun pavé positivo; recall/F1 non stimabili. Falsi positivi alla soglia 0,5: 0.

## Routing e limiti

Vedi `results.json:routing`: confronto limitato alle geometrie reali registrate, con controllo di prossimità/direzione e budget. Le predizioni sui tratti davvero sconosciuti non hanno verità verificabile. L’esperimento con etichette mascherate è una sensibilità offline, non una prova su strada. Nessun miglioramento reale di evitamento pavé è certificato.

**Predizioni separate:** `unknown-predictions.json.gz` contiene solo way prive di evidenza di superficie o proxy diretti. `heldout-evaluation.json.gz` contiene esclusivamente predizioni di valutazione su etichette trattenute, mai nuove superfici confermate. Nessuna probabilità bassa autorizza a dichiarare fondo liscio.

La mappa `map.html` è locale, senza tile esterne o telemetria, separata dall’interfaccia consumer. Non è un navigatore.

Prima di considerare GO: rilievi indipendenti su un campione geografico di strade sconosciute, positivi a Roccella, migliore precisione/calibrazione per settore, corpus con più alternative e verifica di deviazioni/benefici su verità esterna. Mantenere l’incertezza nel routing.

Riferimenti metodologici: [calibrazione scikit-learn](https://scikit-learn.org/stable/modules/calibration.html), [HistGradientBoostingClassifier](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.HistGradientBoostingClassifier.html). Brier misura sia calibrazione sia discriminazione: leggere anche i bin di affidabilità.

Comandi riproducibili e test: `experiments/surface-ml/README.md`. Tempi variabili separati in `timings.json`; tutti gli altri risultati sono deterministici nell’ambiente fissato.

Misure routing: 24 scenari, 2 con alternative distinte; 0 cambi causati dalla penalità ML, 0 miglioramenti e 0 peggioramenti nel confronto mascherato; 0 deviazioni aggiuntive senza beneficio misurato. Questo non prova l’assenza di errori su strade sconosciute.
Sui passaggi dei candidati registrati (strade ripetute contano più volte): 79.2% abbinato, 19.6% ambiguo. Nei tratti OOF con p≤0,1, 330.7 m erano pavé OSM su 4834.9 m. Sono falsi segnali di bassa probabilità, non nuove superfici lisce verificate.
