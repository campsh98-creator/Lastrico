# Fase 4.39b: copertura DBT cittadina per i binari, prompt di esecuzione

Data: 15 novembre 2026. Base: commit `bca48c1` (Fase 4.39). Ramo `feat/phase439b-dbt-citywide`, worktree separato.

## Scopo
Portare la copertura dei binari tranviari da «riquadro Lodi» a «tutto il Comune» con dati ufficiali del Comune di Milano (DBT 2020), senza toccare il comportamento dei percorsi.

## Limiti
- Nessuna modifica a pilota pubblico, PR #16, tessere di produzione, pesi, ordinamento dei percorsi, navigazione. Nessun push, merge, deploy.
- Prima verificare la licenza; se blocca, fermarsi e riferire. Nessuna distribuzione di un dataset combinato.
- Acquisizione limitata: richieste seriali, tetto per esecuzione, pausa ≥ 1,3 s tra gli avvii, nessun nuovo tentativo, cache su disco, registro di ogni richiesta, User-Agent onesto.
- Tre affermazioni separate: binari del Comune (DBT), servizio ATM, binari OSM. «Mappato», «cercato e non mappato» e «sconosciuto» restano distinti. L'assenza da una fonte non completa è debole.

## Accettazione
1. Audit di licenza (DBT, OSM/ODbL) con la lettura dei testi.
2. Endpoint, conteggi, copertura e dimensioni stimate prima di scaricare.
3. Assi tram di tutta la città e classificazione carreggiata/sede propria, in cache e riproducibili.
4. Metriche: corrispondenze, giunzioni ambigue, guadagno di copertura, segmenti non agganciati, conflitti.
5. Casi Piazzale Lodi, Corso Lodi, Via Lazzaro Papi, Via Friuli convalidati.
6. 264 casi del benchmark: payload identici.
7. Costruzione deterministica; dimensione, memoria, tempi; fattibilità su Workers Free.
8. Report in italiano con prima/dopo, nuove prove, problemi aperti e GO/NO-GO.
