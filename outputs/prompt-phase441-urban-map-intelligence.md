# Phase 4.41 · Piano di esecuzione

Estendere la mappa in un branch da main con un pannello «Elementi mappa». Riutilizzare Liberty per strade, edifici e toponimi e il flusso di destinazione e ricerca Photon/Nominatim già attivo. Mantenere distinti i livelli TomTom e la navigazione. Esaminare i simboli poi di Liberty e disattivarli solo quando il pannello offre una visualizzazione contestuale sostitutiva.

Derivare i dati da snapshot versionati di OpenStreetMap. Conservare ID, fonte, data, perimetro e licenza ODbL. Mostrare semafori, stop, precedenze, attraversamenti, segnali espliciti e limiti numerici solo se mappati. Rispettare i versi indicati e omettere definizioni condizionali o ambigue dalla guida. I semafori indicano ubicazioni. La mancanza di una fonte e l'assenza di elementi nello snapshot ricadono in stati distinti.

Distribuire celle statiche e limitarne caricamenti, memoria e feature visibili. I controlli per categoria devono agire su mappa e ricerca locale. Scaglionare simboli, cluster ed etichette in base a zoom e area visibile. In navigazione mostrare solo gli elementi compatibili sul tratto imminente; nessuna richiesta deve partire dal watcher GPS. Aprire una scheda toccando un POI o scegliendolo dalla ricerca; «Naviga qui» deve confermare la destinazione nel pianificatore esistente.

Verificare parsing e perimetri, limiti espliciti, versi opposti, deduplicazione, cache e regressioni di routing/GPS. Eseguire installazione bloccata, type-check, lint, build, suite completa e test mobile Chromium a 390×844. Rilevare copertura effettiva, volume/costo di rendering e scenari mancanti. Aprire la PR con evidenze e GO/NO-GO. La consegna si ferma alla PR, senza merge o deployment; lastrico-pilot è fuori ambito.
