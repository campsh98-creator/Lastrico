# Fase 4.38 · Prompt di esecuzione

## Mandato

Implementare P1-1 della decisione 4.36. La compilazione deve associare i segmenti di Milano alla provenienza OSM verificabile e produrre geometrie ferroviarie e topologia riutilizzabili per la fase 4.39. La ricerca 4.36 resta nella copia originale in sola lettura. La PR #16 è aperta al commit `1a5d8e9`. Lavorare sul ramo `feat/phase438-osm-foundation` a partire da `main` remoto `3e31da9`. La fase 4.37 è indipendente.

## Ambito e limiti

- Estrarre i medesimi otto settori. Leggere le risposte in cache e permettere aggiornamenti espliciti per singolo settore con richieste seriali e arresto in caso di errore o limite. Verificare hash, copertura dichiarata e metadati. Contrassegnare le lacune dei dati storici. Versioni, date e osservazioni richiedono una fonte.
- Conservare ID, versione, timestamp e changeset delle entità pertinenti, sequenze dei nodi, attributi rilevanti, relazioni e binari. Collegare ogni segmento geometrico a una provenienza con risoluzione esplicita delle divergenze tra snapshot.
- Compilare un artefatto separato, partizionato come le tessere compatte, destinato a elaborazioni locali. Collegarlo con hash delle tessere. Il bundle Worker mantiene il suo schema. Conservare classificazioni di fondo, copertura geografica e le regole 4.35 per la generazione delle alternative. Correggere il senso di marcia circolare e verificare precedenza di vincoli espliciti, accesso per modalità e restrizioni di svolta. La topologia con condizioni o copertura incompleta deve rimanere identificabile come incerta.
- Versionare il contratto per i join. Usare ID dei nodi e hash della geometria, gestire verso invertito, modifiche, split, merge, cancellazioni e versioni incompatibili. Validare i riferimenti tra snapshot e ricompilare gli artefatti di join in caso di incompatibilità.
- Escludere dal pilota Roma e gli artefatti OSM per elaborazioni locali. Nessuna distribuzione, merge, variazione di produzione o nuova fonte esterna per il fondo.

## Accettazione e prove

- Usare i casi documentati di Piazzale Lodi e fixture pubbliche o sintetiche per versioni OSM, rotaie, tag dei nodi, turni via nodo/via via, accessi espliciti e rieffettuazione dell’estrazione. Testare le tre modalità e le eccezioni. Confermare che i segmenti parziali non ottengano identità di vertici senza prova.
- Ricompilare due volte da input identici e confrontare gli hash. Controllare la classificazione e le identità di base sul dataset effettivo. Eseguire il corpus registrato di Milano e i casi Roccella, test unitari, lint, tipi, build e scenari mobile browser locali.
- Misurare byte grezzi e compressi dell’artefatto base e di provenienza, confronto payload/bundle del pilota e memoria osservata localmente. Usare il processo esistente per escludere Roma e misurare il Worker. Distinguere le metriche locali dalla CPU/memoria misurata sulla piattaforma.
- Dichiarare GO per integrazione soltanto con prove riproducibili e nessuna regressione attribuibile. Dichiarare esplicitamente le lacune geografiche, il livello di completezza della raccolta e i prerequisiti per il rilascio. Registrare esiti reali e limiti in `outputs/phase438-osm-foundation-report.md`. Eventuale commit/push/PR dopo la verifica. Nessuna operazione di rilascio.

