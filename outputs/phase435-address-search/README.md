# Fase 4.35 — ricerca indirizzi di Milano: evidenze

Data: 12–13 novembre 2026. Ramo `fix/phase435-milan-address-search`, commit `54bd605`
(PR #14). Pubblicato sul pilot il 13 novembre 2026 come versione `73411cc6`; la versione
precedente è `fe69e630` (Fase 4.34). Report di rilascio: `outputs/phase435-milan-release-report.md`.

| File | Cosa dimostra |
| --- | --- |
| `pilot-reproduction-2026-11-12.json` | Riproduzione dal vivo sul pilot con `wrangler tail`. Dopo una raffica di digitazione, ogni nuova ricerca dà 503 in ~4,3 s (`Geocoding timed out` + `Photon timed out`), mentre Nominatim interrogato direttamente risponde in meno di 1 s. Solo esiti e righe di log del Worker, nessun IP. |
| `street-index-coverage.json` | Copertura dell'indice locale (4.668 vie) sullo stradario ufficiale del Comune (ds2169, 3.945 vie): **98,1 % nella top 5** con criterio rigoroso, più l'elenco delle 73 mancanze, quasi tutte nomi troncati o diversi nel file ufficiale. |
| `stress-before-pilot-frontend.json` | 50 modifiche partenza/destinazione nel frontend del pilot, con guasti simulati del provider. **17 modifiche senza nulla a schermo**, nessun guasto segnalato (0/17). |
| `stress-after.json` | Stesso script, nuovo codice: **50/50 esiti visibili e corretti**, 0 muti, 0 obsoleti, 0 eccezioni. La via attesa è prima in 39/39 ricerche di vie. Include civici e "Riprova". |
| `stress-after-live-providers.json` | 10 modifiche con i provider reali (Photon era fuori servizio): 10/10, percorso finale calcolato. |
| `api-after-argelati.jsonl` | Risposte reali di `/api/geocode` sul nuovo build per le varianti di Via Filippo Argelati, civico 12 compreso. |
| **Dopo il rilascio (pilot `73411cc6`, 13 novembre)** | |
| `pilot-after-release-probe-2026-11-13.jsonl` | Pilot pubblicato: indice delle vie servito (4.668 vie, checksum identico), Argelati e civico 12 trovati in ogni modalità, Roccella risponde, Roma rifiutata. La stessa raffica di digitazione che bloccava la 4.34, poi ricerche nuove: **200 in 0,3–1 s** invece di 503 in 4,3 s. |
| `pilot-photon-throttle-2026-11-13.jsonl` | Esiti e log del Worker (nessun IP) di una raffica di suggerimenti: dopo ~9 richieste in 4 s Photon risponde al pilot HTTP 503; il pilot lo dice (503 `retryable`, poi `photon_cooling_down`) e la lista mostra le vie dell'indice locale. |
| `stress-pilot-73411cc6.json` | 50 modifiche sul pilot pubblicato, in Chrome mobile, con guasti simulati: **50/50**, 0 muti, 0 obsoleti, civici e "Riprova" corretti, percorso finale calcolato. |
| `stress-pilot-73411cc6-live-providers.json` | 10 modifiche sul pilot con i provider reali: **10/10**, 0 errori in console, percorso Via Filippo Argelati → Corso Buenos Aires calcolato. |
| `post-deploy-smoke-73411cc6.txt` | Test di fumo dopo il rilascio: **18/18**. |
| `pilot-iphone-argelati-suggestions.png`, `pilot-iphone-route-calculated.png` | Pilot in Chrome mobile (390×844): "Via F. Argelati" → Via Filippo Argelati per prima; percorso calcolato. |

Riprodurre:

```bash
node scripts/osm/build-milan-street-index.mjs --check
node scripts/measure-street-index-coverage.mjs <stradario_dic2022.csv>
npm run build && npx wrangler dev --config dist/server/wrangler.json --port 8799 --local
node tests/e2e/phase435-address-search.mjs --edits=50
```

Dati © OpenStreetMap contributors (ODbL 1.0). Lo stradario del Comune di Milano (CC BY) serve
solo alla misura e non è incluso nel repository.
