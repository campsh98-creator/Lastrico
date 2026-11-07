# Fase 4.27 — Pacchetto di Roma sotto il limite Cloudflare

7 novembre 2026. Branch `fix/mobile-navigation-stability` a `66bdccd`. Prompt di esecuzione: `outputs/prompt-phase427-rome-package-size.md`.

Nessun commit, push o deploy: il pilota resta alla versione `bf3e13d5`, cioè Milano e Roccella senza Roma.

## 1. Risultato

| | Prima | Dopo |
|---|---:|---:|
| Pacchetto del Worker con Roma (non compresso) | 67,73 MiB | **26,54 MiB** |
| Limite Cloudflare | 64 MiB | 64 MiB |
| Controllo dei tipi con la memoria normale | esaurisce la memoria | passa |

Dal 4 settembre 2026 Cloudflare applica un solo limite, 64 MiB sul pacchetto non compresso, sia nel piano gratuito sia in quello a pagamento. Il limite sulla dimensione compressa è stato tolto. Fonti: [limiti dei Workers](https://developers.cloudflare.com/workers/platform/limits/) e [annuncio](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/).

## 2. Come

- Le 378 tile stradali di Roma (50,01 MiB di JSON) entrano nel pacchetto compresse con gzip: in tutto 8,96 MiB.
- Ogni tile viene decompressa solo quando un percorso di Roma ne ha bisogno, e poi resta in memoria come prima.
- **Nessun dato cambia.** Ogni file compresso contiene esattamente i byte della tile originale. Non sono stati toccati tag, coordinate, classificazioni, l'area coperta o la copertura.
- Le tile JSON originali e l'archivio compatto sono file intermedi: si ricostruiscono identici byte per byte dalle fonti OSM con `build-rome-pilot.mjs` (verificato il 7 novembre 2026). Restano sul disco ma non sono salvati in Git. Quando mancano, i test in Node leggono direttamente le tile compresse. L'impronta SHA-256 di ogni tile originale è in `rome-tiles-packed/SHA256SUMS.json`.
- Milano e Roccella non cambiano.

**File:**
- `lib/rome-tile-codec.ts`: decompressione, con lo stesso codice nel Worker e nei test.
- `scripts/osm/pack-rome-tiles.mjs`: compressione e indice. La build di Roma (`build-rome-pilot.mjs`) ora lo chiama in automatico.
- `lib/rome-tile-index.ts`: rigenerato, carica solo le tile compresse.
- `data/surfaces/rome-tiles-packed/`: le 378 tile compresse.
- `types/binary-modules.d.ts`: il tipo dei moduli binari.
- `tests/rome-packed-tiles.test.mjs`: il test.

## 3. Verifiche

- **Integrità.** Tutte le 378 tile compresse, decompresse con lo stesso codice del Worker, sono identiche byte per byte alle originali. L'indice non carica più nessuna tile JSON.
- **Pacchetto.** La simulazione di pubblicazione (dry-run) riesce, a 26,54 MiB. Nel pacchetto ci sono le 378 tile compresse e nessuna tile JSON di Roma.
- **Percorsi di Roma.**
  - Ho confrontato 30 casi (10 itinerari della Fase 4.23 × Auto, Moto e Bici) tra il Worker locale, che usa le tile compresse, e il calcolo in Node, che usa le tile originali.
  - Tutti i 30 casi hanno lo stesso percorso e le stesse misure: pavé confermato e probabile, liscio, sconosciuto, distanza, tempo e scelta dell'alternativa.
  - Corso → Cavour in auto viene rifiutato in entrambi, come nella Fase 4.23, perché via del Corso è pedonale.
  - Dettagli in `outputs/phase427-rome-package/`.
- **Milano e Roccella sullo stesso Worker.** Cordusio → Porta Romana in auto dà lo stesso pavé confermato della versione pubblicata (da 1.914 a 671 m). Roccella risponde normalmente.
- **Controlli automatici.**
  - TypeScript senza errori con la memoria normale.
  - ESLint senza errori.
  - 373 test su 373, compresi quelli di Roma.

## 4. Limiti

- I percorsi di Roma con molto pavé, come Milano, richiedono circa 4,5–5,5 s, soprattutto per l'attesa del servizio di routing pubblico.
- La decompressione aggiunge un piccolo costo di CPU la prima volta che una tile viene usata. La CPU reale va misurata su Cloudflare dopo la pubblicazione.
- Per Roma valgono ancora i limiti dichiarati nella Fase 4.23:
  - ZTL, orari e permessi non sono verificati;
  - Roma usa ancora le regole dei fondi precedenti ("2026-10"), non quelle corrette per Milano;
  - "confermato" significa tag OSM, non rilievo sul campo.
- Il lavoro su Roma (4.23 e questa fase) è salvato in commit locali, non inviati su GitHub. In Git ci sono le fonti OSM (11 MB), la provenienza, i metadati e le tile compresse (9 MB). I file intermedi riproducibili (circa 105 MB) restano esclusi.
- Nessuna prova su iPhone fisico.

## 5. GO/NO-GO

- **GO tecnico:** con Roma l'app ora sta nel limite di Cloudflare, con circa 37 MiB di margine.
- **Per pubblicare Roma servono:**
  1. la tua autorizzazione;
  2. l'invio dei commit di Roma su GitHub;
  3. smoke test in produzione, compresi percorsi di Roma, CPU e latenza;
  4. una prova su iPhone.
