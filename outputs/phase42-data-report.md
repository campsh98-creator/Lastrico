# Roccella Ionica — dati OSM autentici

Acquisizione: 2026-10-29T14:32:33.598Z–2026-10-29T14:32:35.310Z. Quattro risposte dell'API ufficiale OpenStreetMap, archiviate losslessly con URL, timestamp e SHA-256 in data/sources/roccella-pilot-osm.source.json. Sono risposte sequenziali, non uno snapshot temporale atomico. I timestamp degli elementi sono date di modifica OSM, non rilievi sul campo.

Area operativa: 16.36–16.44 E, 38.29–38.35 N. Include centro, strade del borgo, lungomare e porto; non coincide con il confine comunale. Sono conservate tutte le highway, anche senza superficie. Denominatore: 1052 way lineari, 8105 segmenti, 176.542 km ritagliati ai bounds; percorsi pedonali, scale, piste, strade e track inclusi. 8 poligoni area=yes esclusi. La disponibilità di dati per una modalità è valutata dal routing e dallo scorer.

| Categoria | km | Quota |
| --- | ---: | ---: |
| unknown | 137.071 | 77.64% |
| confirmed_smooth | 30.921 | 17.51% |
| unpaved_loose | 8.160 | 4.62% |
| probable_rough | 0.390 | 0.22% |

Classificazione disponibile: **22.36%**; sconosciuto **77.64%**. Evidenza ciclabile: **1.64%**. Zero rough confermato significa assenza di tale classificazione nell'estratto, non assenza reale di pietra o dissesto. Via Giuseppe Garibaldi e Via Umberto I hanno tratti privi di surface: non vengono inventati attributi per il borgo.

Formato compatto: **1,201,601 byte**, 40 tile; normalizzato 13,528,398 byte; archivi originali 711,807 byte. Si preservano tutti i rawTags per accessi, direzioni, condizionali e ambiguità di livello; le way con geometria identica restano separate.

Riproduzione offline: `node scripts/osm/build-roccella-pilot.mjs`. Per nuova acquisizione esplicita: aggiungere `--download`. Il compilatore compact è lo stesso di Milano, estratto come funzione senza scritture all'importazione; il percorso CLI Milano resta invariato. I dati di Milano non vengono riscritti dal builder Roccella.

SHA-256 normalizzato: `57da5fa77701e0caa9bcaa4115a87c622ed7239a3dca0663c435dad59d2e62d5`.
SHA-256 compact: `a298371f8e441d32cb618e051a8d9670f782ccc0a678d9277b4a82521e1c5246`.

Quattro test verificano autenticità/ricostruzione delle fonti, checksum e proprietà compact, separazione delle way sovrapposte, ricostruzione byte-per-byte in directory temporanea senza modificare Milano. Le misure non certificano completezza OSM rispetto alla rete sul territorio. Dati © OpenStreetMap contributors, ODbL1.0.
