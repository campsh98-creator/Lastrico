# Lastrico — Fase 4.35: report di rilascio (ricerca indirizzi di Milano)

- **Data:** 13 novembre 2026, 01:01 UTC.
- **Ambiente:** Cloudflare Workers Free, `lastrico-pilot.campsh.workers.dev`, solo Milano e Roccella.
- **Codice:** commit `54bd605` (ramo `fix/phase435-milan-address-search`, PR #14, **non ancora unita a `main`**).
- **CI GitHub:** "Lint, test and build" superata (run `43329685052`).
- **Versione pubblicata:** `73411cc6-a8a5-4377-9852-c2ca54438f0b`.
- **Versione precedente:** `fe69e630-a6ea-4788-a432-1b8c6b885b5f` (Fase 4.34).
- **Approvazione:** rilascio approvato esplicitamente dall'utente il 13 novembre 2026, con CI verde.

Il difetto, le cause e le correzioni sono descritti in `outputs/phase435-address-search/README.md`
e nella PR #14. Questo report copre solo il rilascio e le verifiche sul pilot.

## 1. Controlli prima del rilascio

| Controllo | Esito |
| --- | --- |
| TypeScript, ESLint | 0 errori |
| `npm test` sul repository | 512 test: 511 superati, 1 saltato di proposito |
| Copia di rilascio solo Milano (`prepare-milan-release.mjs --commit=54bd605`) | 1.672 file esportati, 634 file di Roma rimossi, 7 file condivisi ripuliti senza conflitti |
| `npm test` nella copia di rilascio | 503 test: **501 superati, 0 falliti**, 2 saltati (test di Roma) |
| Prova di pubblicazione (`deploy:pilot --dry-run`) | Nessun elemento di Roma nel build; homepage statica di 12.449 byte; Worker di 13.379,79 KiB (gzip 3.358,41 KiB), +40,5 KiB (+0,3 %) rispetto alla Fase 4.33 |
| Indice delle vie nel build | `dist/client/data/milan-streets-v1.json`, 263.459 byte, checksum `7a312924…ad778c` identico al repository |

Il pacchetto del Worker non contiene modifiche a Durable Object, migrazioni o configurazione
Cloudflare.

## 2. Pubblicazione

```text
npm run deploy:pilot   (nella copia di rilascio)
Uploaded lastrico-pilot (15.39 sec)
Current Version ID: 73411cc6-a8a5-4377-9852-c2ca54438f0b   (100 % del traffico)
```

## 3. Verifiche sul pilot pubblicato

### A. Test di fumo — 18/18

`scripts/post-deploy-smoke.mjs`: homepage, manifest, asset e service worker, strumenti interni non
esposti, input non valido rifiutato. Superati anche autocompletamento Milano e Roccella, percorsi
auto, moto e bici, alternative anti-pavé, richiesta di navigazione e percorsi a Roccella
(`outputs/phase435-address-search/post-deploy-smoke-73411cc6.txt`).

### B. Ricerca indirizzi e regressione del blocco

Dati in `pilot-after-release-probe-2026-11-13.jsonl`.

| Verifica | Esito |
| --- | --- |
| Indice delle vie servito come file statico | 200, 4.668 vie, checksum identico, compresso (br) |
| "Via Filippo Argelati", ricerca esplicita | 200, prima riga "Via Filippo Argelati, Navigli · 20143 · Milano", 290 ms |
| "Via Filippo Argelati, Milano" | 200, stessa prima riga |
| "Via Filippo Argelati 12" | 200, civico esatto "Via Filippo Argelati 12" |
| "Via Filippo Argelati" durante la digitazione e senza modalità (vecchie pagine) | 200, stessa prima riga |
| "Via Marina" a Roccella | 200, "Via Marina, 89047 · Roccella Ionica" |
| Area Roma | 400 "Area pilota non valida." |
| **La raffica di digitazione che bloccava la 4.34**, poi ricerche nuove | Via Tortona **200 in 968 ms**, Corso Lodi **200 in 331 ms** (prima: 503 dopo ~4,3 s) |
| Raffica con la nuova modalità di digitazione, poi una ricerca esplicita | Viale Monza 100: 200 in 237 ms |

### C. Browser mobile (Chrome 390×844, motore di Microsoft Edge)

| Test | Esito |
| --- | --- |
| 50 modifiche partenza/destinazione con guasti simulati (timeout, 429, 503, 502 HTML, connessione interrotta, risposte vuote o fuori ordine) | **50/50** esiti visibili e corretti, 0 muti, 0 obsoleti, 0 eccezioni; via attesa prima in 39/39; percorso finale calcolato (`stress-pilot-73411cc6.json`) |
| Civici | 12 → posizione esatta; 14 → "Civico 14 non trovato: uso Via Filippo Argelati, senza numero civico." |
| "Riprova" dopo un guasto | Esegue davvero una nuova ricerca e mostra il risultato |
| 10 modifiche con i provider reali | **10/10**, 0 errori in console; percorso Via Filippo Argelati → Corso Buenos Aires calcolato (`stress-pilot-73411cc6-live-providers.json`) |
| `scripts/verify-live-iphone.mjs` | Superato: suggerimenti "Duomo" in 22 ms e "Porta Romana" in 4 ms, percorso calcolato in 5,0 s senza tocchi aggiuntivi |
| "Via F. Argelati" | Via Filippo Argelati per prima, poi due luoghi da Photon (`pilot-iphone-argelati-suggestions.png`) |

## 4. Cosa ho osservato e resta aperto

- **Photon limita i suggerimenti del pilot.**
  - In una raffica di digitazione, dopo circa 9 richieste in 4 s Photon ha risposto al Worker HTTP 503; alle chiamate dirette rispondeva normalmente (`pilot-photon-throttle-2026-11-13.jsonl`).
  - Per almeno 20 s il pilot non interroga Photon e lo dichiara (`photon_cooling_down`). La lista mostra le vie dell'indice locale con il messaggio "Luoghi e numeri civici non disponibili ora: mostro le vie."
  - Le vie restano trovabili, mentre i luoghi richiedono una ricerca esplicita.
  - La pagina vera invia meno richieste di questa raffica, perché aspetta 320 ms di pausa nella digitazione.
  - Una possibile fase successiva: interrogare Photon direttamente dal telefono anziché dal Worker. È una scelta di prodotto e di policy, da valutare a parte.
- **La PR #14 non è unita a `main`.** Il pilot gira sul commit `54bd605` del ramo. Finché la PR non è unita, `main` non contiene il codice pubblicato.
- **Nessun iPhone fisico** ha ancora usato la Fase 4.35. Le verifiche mobile sono in emulazione.
- **Limiti invariati dalla PR:** copertura dell'indice 98,1 % dello stradario ufficiale; limitatore e interruttori per singola istanza; Roccella usa ancora Nominatim durante la digitazione.

## 5. Ripiego

Non ci sono modifiche a Durable Object fra le due versioni, quindi il ripiego è immediato:

```bash
npx wrangler rollback fe69e630-a6ea-4788-a432-1b8c6b885b5f --name lastrico-pilot
```

Così però tornerebbe anche il blocco della ricerca indirizzi della Fase 4.34. In alternativa si
può ricostruire la 4.34 con `node scripts/prepare-milan-release.mjs <cartella> --commit=336462d`,
poi lanciare `npm run deploy:pilot` in quella cartella. `scripts/prepare-pilot-rollback.mjs` serve
solo per tornare alla Fase 4.28.
