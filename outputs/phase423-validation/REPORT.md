# Phase 4.23 — Roma: esito locale, 7 novembre 2026

**Implementazione locale verificata; NO-GO per il rilascio nello stato attuale.** Il bundle supera il limite Cloudflare documentato. Nessun commit, push o deploy; pilot esistente invariato.

## Implementazione

- `lib/pilot-areas.ts`, `app/page.tsx`, `components/phase43/LocalFieldFeedback.tsx`: terza area Roma, preset e selezione città. GPS, mappa e navigazione riusano le componenti esistenti.
- `app/api/geocode/route.ts`: località di fallback coerente con Roma. Architettura autocomplete Phase 4.22 preservata.
- `lib/spatial-road-store.ts`, `lib/rome-road-store.ts`, `lib/rome-tile-index.ts`: dizionari separati, import Roma differito, tile e celle con idratazione locale; smoothness OSM esplicita conservata senza inferire il materiale.
- `app/api/routes/route.ts`: alternative Roma ammesse solo con risparmio minimo di pavé confermato, mantenendo Pareto, profili modali e budget esistenti. Avviso esplicito su accessi ZTL non certificati.
- `scripts/osm/build-rome-pilot.mjs`: acquisizione e compilazione riproducibile; archivi autentici in `data/sources/rome-*`, dati compilati in `data/surfaces/rome-*`.
- `scripts/osm/generate-tile-chunks.mjs`: import privo di scritture automatiche. `scripts/osm/build-roccella-pilot.mjs` e relativo test: una ricompilazione temporanea non sovrascrive più l'indice runtime Roccella. I dataset Milano/Roccella e gli esperimenti restano invariati.
- Nuovi test `tests/rome-geocoding.test.mjs`, `tests/rome-runtime.test.mjs`; aggiornati test delle aree. Matrice e harness in `tests/fixtures/phase423-rome-journeys.json`, `scripts/prepare-rome-validation.mjs`, `scripts/validate-rome-pilot.mjs`.

## Copertura e provenienza

Rettangolo **12,40–12,60 E / 41,80–41,97 N**: centro, Monti, Prati/Vaticano, Trastevere, Testaccio, Termini, San Giovanni, Esquilino, Ostiense, Garbatella, EUR e corridoi periferici. Non copre tutto il Comune. **378 tile, 583.970 segmenti, 7.984,30 km** di geometrie lineari OSM; comprende percorsi pedonali e strade vietate ai mezzi. Il denominatore non rappresenta chilometri automobilistici né corsie.

| Evidenza di superficie | km | % lunghezza |
|---|---:|---:|
| Pavé confermato | 201,27 | 2,52 |
| Pavé probabile | 124,62 | 1,56 |
| Liscio confermato | 3.169,99 | 39,70 |
| Non pavimentato/sciolto | 321,24 | 4,02 |
| Sconosciuto | 4.167,19 | 52,19 |

La quota classificata è **47,81%**, inclusa la categoria probabile; non equivale a una verifica sul campo. `paved` resta sconosciuto e `paving_stones` probabile; nessuna previsione ML/CV entra nei dati. Conservati 8.947 segmenti con smoothness, 2.096 con tag condizionali e 530 con permessi auto/moto differenti.

Quattro risposte Overpass autentiche del **6 novembre 2026**, attribuzione OpenStreetMap/ODbL, URL, query, data acquisizione, timestamp del database e SHA-256 in `data/sources/rome-osm.source.json`. Sono acquisizioni sequenziali, non uno snapshot atomico. Checksum dati normalizzati: `63299a52391f6a292d40af7814cc7d8b5a6b5276cfdfc32aed165166a0122407`. Ricompilazione offline: **382/382 file identici**, inclusi tile, metadata, compatto, manifest e indice (`checks/reproducibility.json`).

## Routing e regressioni

- **20 itinerari × 3 modalità: 59 risposte HTTP 200, una HTTP 422**; auto 19/20, moto e bici 20/20. Provider Valhalla reale, richieste serializzate con almeno 1.100 ms tra avvii; 165 chiamate complessive, 157 nuove acquisizioni, le altre risposte già registrate. Gli endpoint dei casi provengono da vertici di strade OSM identificabili.
- **24 alternative distinte** (7 auto, 8 moto, 9 bici), con media **305,75 m** di pavé confermato evitato e **77,10 s** aggiuntivi, fra 13,22 e 293,78 s: tutte entro +5 minuti. Le medie riguardano solo i casi con alternativa e non una valutazione rappresentativa di tutti i viaggi romani.
- Latenza del handler locale nella matrice live: mediana **1.822 ms**, massimo **8.070 ms**; include il provider, l'accodamento e alcune risposte registrate. Non è latenza cloud né CPU Worker.
- Corso→Cavour auto: il percorso primario presenta accesso bloccante OSM; gli altri candidati registrati superano il budget rispetto al primario. Il sistema rifiuta il viaggio. Evidenza in `corso-cavour-car-rejection-evidence.json`; non dimostra l'assenza assoluta di un itinerario legale.
- Sei richieste aggiuntive navigazione/ricalcolo: cinque HTTP 200 e lo stesso rifiuto auto. Replay offline: **zero risposte mancanti, zero invarianti fallite** sulle 64 risposte valide complessive. Il comando termina con codice 1 perché tratta anche i due rifiuti 422 come esiti non riusciti: non va presentato come suite completamente verde.
- `summary-live.json` conserva quattro falsi negativi del primo controllo `honestUnknown`: il test non considerava l'arrotondamento della percentuale a un decimale. Corretto solo il controllo; `summary-replay.json` verifica le stesse risposte, senza alterare i dati di superficie.
- Milano e Roccella, ricerca e routing sul Worker locale costruito: **4/4 HTTP 200**. Tempi Milano 766/728 ms, Roccella 222/191 ms (`existing-cities-live.json`).

## Browser, GPS e controlli

Browser locale a **390×844**: selezione Roma, suggerimenti inline e conferma a un tap, calcolo automatico Prati→Vaticano, percorso visibile, avvio/stop/riavvio navigazione. In assenza di posizione il sistema resta correttamente in attesa GPS. Nessun test su iPhone fisico o riproduzione vocale reale: non sono certificati funzionamento in background, GPS su strada o consegna audio iOS.

Separatamente, posizioni sintetiche verificano accettazione GPS, progressione, arrivo, riavvio e trigger fuori percorso. Non equivalgono a un percorso realmente navigato.

**366/366 test automatici passati**, build e lint superati, TypeScript superato con `NODE_OPTIONS=--max-old-space-size=8192` (il limite heap predefinito non bastava). Dopo l'aggiunta dell'asserzione di isolamento Roccella, altri **4/4 test mirati** passati. Log in `checks/`. `git diff --check` superato.

## Limiti e condizioni di rilascio

1. **Bundle: 69.376,05 KiB = 67,75 MiB non compressi**, gzip 13,05 MiB (13.363,75 KiB). Il dry-run Wrangler termina senza upload, ma non prova l'ammissibilità lato server. La [documentazione Cloudflare](https://developers.cloudflare.com/workers/platform/limits/#worker-size), consultata il 7 novembre 2026, indica **64 MiB non compressi**, senza limite gzip. Serve ridurre almeno **3,75 MiB**, conservando i dati necessari; poi ripetere build, dry-run e regressioni. L'indice Roma conserva anche tag OSM non usati dal ranking: una proiezione dei soli attributi necessari nel runtime, con archivio originale intatto e test di equivalenza, è una possibile ottimizzazione mirata da verificare.
2. **CPU/memoria cloud non misurate.** Heap Node live: 19,87 MiB prima dell'import, 26,81 dopo, 275,84 a fine matrice; comprende harness, risposte e cache. Non è memoria del Worker e non prova un superamento dei 128 MB. Il limite Free CPU documentato è 10 ms: la build e il server locale non lo certificano. Dopo la riduzione del bundle occorre una verifica controllata, separatamente autorizzata, di startup, richieste fredde/calde e sequenze multicittà.
3. **Legalità parziale:** restrizioni locali OSM e profilo provider controllati; calendario ZTL, permessi e restrizioni di svolta complete non sono certificati indipendentemente. Il Tridente A1 riguarda anche le moto. Avvisi presenti nell'API; fonti ufficiali e limiti in `legal-access.md`.
4. **Test fisico iPhone ancora necessario**, dopo autorizzazione separata al rilascio controllato: ricerca a un tap, percorso selezionato, voce, GPS, ricalcolo, stop/riavvio e comportamento dopo perdita rete/foreground.

## Riproduzione offline

```sh
node --max-old-space-size=6144 scripts/osm/build-rome-pilot.mjs
node scripts/prepare-rome-validation.mjs
node scripts/validate-rome-pilot.mjs
npm run lint
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit --incremental false
npm run build
node --test tests/*.test.mjs
npx wrangler deploy --dry-run --config dist/server/wrangler.json
```

Il replay usa le risposte in `responses/`; i 422 descritti producono codice 1. L'opzione `--download` del builder acquisisce un nuovo snapshot e modifica i checksum: non serve per riprodurre questa misura. Nessuno dei comandi sopra pubblica una versione.
