# Phase 4.2 — Roccella Ionica

Implementare e verificare un pilota locale Roccella riutilizzando dati OSM autentici, normalizzazione e compact tiles, Valhalla/Pareto, GPS e rerouting esistenti. Nessun commit, push o deploy. Conservare integralmente le modifiche iniziali Phase 3/4.1 e i dati di Milano.

Ambito: area rettangolare Roccella 16.36–16.44 E, 38.29–38.35 N (centro, borgo storico, porto e collegamenti locali); confine operativo, non confine amministrativo. Acquisizione API OSM riproducibile, archivi originali gzip, URL, orari e SHA-256. Nessuna superficie inventata. Riutilizzare compilatore compatto con parametri minimi e store separati; scelta geografica deterministica, rifiuto percorsi tra aree distinte. Milano resta default e conserva i contratti.

Interfaccia: selezione area funzionante, ricerca indirizzi nella relativa area, bounds GPS coerenti, nessuna geometria demo milanese attribuita a Roccella. Cambio area invalida richieste e sessioni precedenti. Funzioni di navigazione esistenti mantenute.

Verifica: provenienza/ricostruzione e copertura pesata per lunghezza, isolamento dataset/cache, API e geocoding, provider reali per auto/moto/bici, planner/navigation/reroute, geometrie e istruzioni reali, memoria e latenza. Test mirati più suite completa, TypeScript, lint, build e prova browser mobile. Le prove software non sostituiscono GPS su iPhone fisico; documentare passi HTTPS minimi per deployment successivo senza eseguirlo.

Responsabilità: agente dati possiede pipeline/artefatti Roccella; agente UI possiede page e relativi componenti; coordinatore possiede configurazione aree, API/store e integrazione finale. Non modificare file degli altri agenti senza coordinamento. Documentazione limitata ai risultati misurati e ai blocchi concreti.
