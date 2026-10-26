# Phase 2 — correzione dei blocchi verificati

Ambito: sostituire i campioni manuali attribuiti a OSM con un estratto reale e riproducibile; collegare Road Intelligence all'API esistente; correggere matching ciclabile, accessi e direzioni direttamente pertinenti. Preservare le correzioni locali della review.

Concorrenza verificata prima delle modifiche: Antigravity lavora nello stesso checkout su `app/page.tsx`, `app/globals.css`, `tests/rendered-html.test.mjs` e relativo prompt UI. Questi file sono esclusi dalle modifiche Codex. Controllare lo stato prima dell'integrazione; rinviare nuovi conflitti senza ripristinare file altrui.

Limiti: nessun nuovo servizio, refactoring esteso, cambiamento alle preferenze di routing, profili, fallback o budget Phase 1. Nessun commit, push o deploy. Dati sintetici utilizzabili solo come fixture esplicitamente etichettate. Se l'acquisizione reale fallisce, dichiarare il blocco senza inventare una fonte alternativa.

Accettazione: fonte OSM con query, area, data e checksum verificabili; metriche rapportate all'effettivo estratto comprendente superfici sconosciute; output positivo dei nuovi attributi dal vero handler GET; contratti legacy e limiti temporali conservati; nessuna associazione ciclabile distante o con direzione ambigua; restrizioni modali e eccezioni biciclette rispettate dal matching.

Verifica: test di regressione su geometrie, provenienza, riproducibilità e handler reale con provider controllato; suite completa, lint, TypeScript e build. Misurare dimensioni e copertura effettive; distinguere risultati locali da disponibilità dei provider e validazione mobile. Integrare solo i file assegnati e riportare gli eventuali blocchi rimanenti.

Estensione richiesta dall'utente: riconciliare il nuovo pannello UI con il backend, comprese distanze, percentuali, sterrato noto e separazione demo/OSM. Prima di intervenire sulla UI è stato verificato che Antigravity avesse concluso il suo lavoro. Preservare layout, CSS e flussi esistenti; correggere solo incongruenze riprodotte. Verificare il vero handler attraverso il componente React condiviso e il comportamento mobile, senza commit, push o deploy.
