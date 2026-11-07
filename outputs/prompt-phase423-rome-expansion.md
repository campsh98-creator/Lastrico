# Phase 4.23 — Roma, implementazione locale

## Ambito
Integrare Roma come terza area senza cambiare architettura, dati Milano/Roccella o ricerca sperimentale. Branch esistente fix/mobile-navigation-stability, HEAD iniziale ef0a54388888f7d97dacd18efe76a850e0d7d260, working tree pulito. Nessun commit, push, merge o deploy. Il pilot Cloudflare rimane invariato.

## Esecuzione
Acquisire archivi OSM autentici nei limiti 12.40–12.60 E, 41.80–41.97 N (centro e corridoi fino a EUR), con provenienza ODbL, timestamp e checksum. Riutilizzare normalizzazione, tile compatte, celle preindicizzate e caricamento lazy. Separare estensione geografica da percentuale di superficie classificata; paved resta ignoto, paving_stones probabile, nessuna inferenza ML/CV.

Integrare area, ricerca inline, selezione one-tap, mappe, scoring e routing modale preservando baseline/Pareto e limiti di tempo. Verificare restrizioni OSM e dichiarare limiti di ZTL/permessi/orari: il provider non certifica accesso legale. Consultare fonti ufficiali sulle ZTL senza inventare una copertura delle restrizioni assente dai dati.

## Responsabilità separate
Dataset/pipeline; configurazione geografica/UI/autocomplete; matrice di validazione e ricerca ZTL; integrazione runtime e verifica finale gestite separatamente, senza sovrascrivere modifiche concorrenti.

## Accettazione e verifiche
Almeno 20 itinerari reali, 60 combinazioni modali dove applicabili, richieste seriali rispettose dei limiti, risposte provider registrate e distinte dai replay. Verificare geometrie, accounting superfici, alternative e risparmi confermati, limiti accesso e copertura. Ripetere casi rappresentativi Milano/Roccella e regressioni Phase4.22. Eseguire suite completa, TypeScript, lint, build e browser su ricerca, mappa e navigazione start/stop/restart; GPS simulato distinto da iPhone fisico. Misurare bundle e memoria/tempi locali senza chiamarli CPU Cloudflare. Correggere difetti riproducibili direttamente pertinenti.

## Condizioni di rilascio
Rapporto numerico con copertura, checksum, matrice, regressioni e limiti. GO solo per eventuale deploy controllato separatamente autorizzato; nessun deploy durante questa fase. Fallimenti provider, lacune ZTL, mancata verifica fisica o limiti di risorse devono essere espliciti, non sostituiti da dati fittizi.
