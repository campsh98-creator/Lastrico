# Phase 3.2 — esecuzione

## Ambito e preservazione

Integrare il PoC Phase 3.1 già presente senza eliminare modifiche precedenti. Stato iniziale: HEAD f06b433; route.ts, routing-providers.ts e modulo/test/piano surface-aware non committati. Copia di confronto in /tmp/lastrico-phase32-baseline. Le modifiche iniziali risultano ferme dal 26 ottobre; ricontrollare prima di ogni integrazione. Nessun cambiamento UI, infrastruttura, servizio a pagamento, commit, push o deploy.

## Implementazione

Verificare le evidenze Phase 3.1 e il supporto effettivo di linear_cost_factors. Riutilizzare il provider e i profili esistenti soltanto se verificati; gli errori di edge-walk devono consentire i tentativi di deviazione già disponibili entro la scadenza esistente. Conservare i limiti navigation/planner e il fallback esclusivamente auto.

Selezionare un fronte Pareto deterministico su secondi, esposizione ruvida nota ponderata e metri sconosciuti. La quota sconosciuta resta esplicita nelle diagnostiche: non considerare l'assenza di dati come miglioramento certo. Filtrare prima i vincoli di modalità, restrizioni accertabili e tempo massimo, conservando la baseline più rapida valida. Restituire fast/safe come oggi; safe deve essere un percorso reale, geograficamente distinto, non dominato e con riduzione significativa. Nessuna geometria inventata.

## Accettazione e verifica

Test mirati di dominanza, trade-off con dati mancanti, ordinamento deterministico, budget esatto, profili distinti, restrizioni, candidati duplicati, errore/timeout del PoC e integrazione handler. Benchmark prima/dopo su almeno tre coppie di coordinate milanesi e sulle tre modalità, conservando richieste/risposte reali e archivio OSM fisso per il replay; riportare riduzione del pavé, tempo aggiuntivo, sconosciuto, diversità e latenza, inclusi casi senza miglioramento. Separare misure live e replay.

Eseguire test, lint, TypeScript, build e verifica browser locale compatibile con lo scopo. Release soltanto locale: nessuna dichiarazione di completezza cittadina, legalità certificata o validazione GPS sul campo. Documentare limiti e blocchi, senza distribuirla.
