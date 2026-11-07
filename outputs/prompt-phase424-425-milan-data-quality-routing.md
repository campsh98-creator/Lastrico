# Phase 4.24–4.25 — Qualità dati Milano e ottimizzazione anti-pavé

## Stato di partenza
Branch esistente `fix/mobile-navigation-stability`, HEAD `ef0a543`. Working tree con il lavoro Roma (Phase 4.23) non committato: file Roma, modifiche a `app/api/routes/route.ts`, `lib/spatial-road-store.ts`, `lib/pilot-areas.ts`, `app/page.tsx`, geocoding, script OSM e test. Tutto va preservato. Nessun commit, push, merge, deploy, nuovo branch o worktree. Il pilot Cloudflare resta invariato.

## Ambito 4.24 — qualità dati Milano
1. Audit del dataset di superficie Milano in produzione (117 tile, ~1.645 km) e della sua provenienza: archivi Overpass in `data/sources/milan-*`, dataset pilota `data/surfaces/milan-central.json`, tile compatte `data/surfaces/milan-tiles/`.
2. Verifica delle regole di classificazione `surface=*`, `smoothness=*`, `tracktype=*` e attributi collegati (`cycleway:surface`, `footway:surface`, valori multipli/non standard). Ricalcolo indipendente della categoria di ogni segmento dai tag OSM grezzi e confronto con il runtime.
3. Cinque categorie distinte: pavé confermato, pavé probabile, liscio confermato, sciolto/non pavimentato, sconosciuto. `surface=paved` generico non diventa mai asfalto confermato; `tracktype=grade1` non è prova di asfalto.
4. Segmenti sospetti e incoerenze: conflitti tra `surface` e `smoothness`, valori non mappati, frammenti isolati, divergenza tra dataset pilota e snapshot citywide, errori di abbinamento spaziale (etichette che oltrepassano incroci o finiscono su strade adiacenti), misurati sui percorsi reali del benchmark confrontando la via abbinata con il nome di via del provider.
5. Copertura separata per Auto, Moto e Bici (rete accessibile per modalità e esposizione sui percorsi).
6. Uso della dashboard interna per individuare dove una verifica indipendente rende di più.
7. Ricerca di dataset pubblici riutilizzabili di Milano (geoportale/open data comunali, manutenzione strade). Integrazione solo se autentico, accessibile, con licenza compatibile, geometria e attributi abbinabili in modo affidabile, provenienza e timestamp registrati, senza assunzioni non supportate sul fondo.
8. Nessuna classificazione inventata per aumentare la copertura.

## Ambito 4.25 — ottimizzazione anti-pavé
1. Benchmark riproducibile su almeno 75 coppie origine–destinazione distinte a Milano: centro e periferia; tragitti brevi, medi e lunghi; corridoi con pavé confermato, corridoi lisci, strade con molto sconosciuto; Auto, Moto e Bici.
2. Risposte reali del provider registrate una volta (coda seriale, ≥1,1 s tra richieste) e riprodotte offline attraverso il vero handler `/api/routes`; più un campione live limitato.
3. Metriche: percorsi validi e alternative, pavé confermato evitato, tempo extra per 100 m di pavé confermato evitato, deviazioni inutili, esposizione allo sconosciuto, legalità e geometria, stabilità con coordinate leggermente spostate, latenza a freddo e a caldo (mediana e coda), copertura Milano per modalità, regressioni sui percorsi già validati (corpus `experiments/route-ranking/corpus/`, fixture E2E).
4. Modifiche a generazione, filtraggio o punteggio dei candidati solo dove il benchmark mostra un beneficio reale. Baseline di routing e vincoli legali preservati. Nessuna alternativa fabbricata; il pavé probabile non è mai descritto come confermato. Non si ottimizza il numero di alternative.

## Limiti
Nessun ML speculativo, nessun redesign, nessuna rimozione di dati Roma o altri dati per far passare la build. Le regressioni su autocomplete 4.22, UI 2.0, GPS/voce, routing Milano/Roccella, dati Roma locali e ottimizzazioni memoria/CPU Cloudflare sono bloccanti. Rispetto del limite FOSSGIS (~1 richiesta/s).

## Criteri di accettazione
- Ogni correzione di classificazione è motivata da tag OSM espliciti, documentata e coperta da test; ricompilazione dei dati Milano riproducibile con checksum.
- Confronto PRIMA/DOPO sullo stesso benchmark registrato, con numeri calcolati dagli script e non trascritti a mano.
- Una modifica di routing entra solo se migliora il pavé confermato evitato o riduce deviazioni inutili senza peggiorare legalità, stabilità o percorsi già validati; se non batte la baseline, viene dichiarato e la baseline resta.

## Test e verifiche
Test unitari e di integrazione pertinenti, suite completa, TypeScript, ESLint, build di produzione, E2E browser mobile rappresentativo, dimensione del bundle Worker e controlli di runtime locali. Se Roma porta il bundle oltre i limiti Cloudflare, va riportato chiaramente.

## Condizioni di rilascio
Rapporto finale in italiano: difetti trovati e corretti, dataset pubblici valutati, copertura per modalità prima/dopo, benchmark prima/dopo, miglioramenti reali e casi invariati o peggiori, test e prestazioni, limiti residui, GO/NO-GO per un rilascio pilota separato. Nessun deploy in questa fase.
