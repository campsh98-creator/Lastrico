# LASTRICO — FASE 4.34: REPORT DI RILASCIO E PROTOCOLLO DI COLLAUDO FISICO

Data rilascio: 11 Novembre 2026  
Ambiente: Cloudflare Workers Free (`lastrico-pilot.campsh.workers.dev`)  
Commit canonico: `336462d468fa78444624dd1fb70cfc2f1bdcff05` (PR #12 su `main`)  
Stato CI GitHub Actions: Run `43011614795` (PASS — 2m 46s)  
Deployment Version ID: `fe69e630-a6ea-4788-a432-1b8c6b885b5f`  
Versione baseline per rollback: `170ac277-2094-4925-9378-1f3ff46aab1c`

---

## 1. Stato di Pre-Rilascio e Quality Gates

Tutti i controlli preliminari e i vincoli di sicurezza stabiliti nel piano `outputs/prompt-phase434-milan-diagnostic-release.md` sono stati verificati con successo:

- **Git & GitHub CI**: `main` sincronizzato al commit `336462d4`. La pipeline di CI (`.github/workflows/ci.yml`) ha validato lint, test e build senza alcun errore.
- **TypeScript**: `npx tsc --noEmit` completato con **0 errori**.
- **Lint**: `npm run lint` completato con **0 errori**.
- **Test di unità e diagnostica (Fase 4.34)**: `tests/phase434-diagnostics.test.mjs` e `tests/phase434-intersection-audit.test.mjs` superati (**27/27 PASS**).
- **Test suite completa su copia isolata Milano**: `npm test` su copia di release `/tmp/lastrico-milan-release-phase434` ha registrato **477 test superati**, 2 saltati (test specifici di Roma esclusi da script di release), **0 falliti**.

---

## 2. Esclusione Completa di Roma e Isolamento Pilot

In conformità ai vincoli di prodotto, Roma rimane esclusivamente nel repository canonico per sviluppo futuro e **non è stata distribuita sul pilot pubblico**:

- **Verifica build**: `findRomeInBuild(distPath)` ha confermato **0 elementi di Roma** nel pacchetto compilato.
- **API Geocoding live**: `GET https://lastrico-pilot.campsh.workers.dev/api/geocode?q=Colosseo&area=rome` restituisce `HTTP 400` (*"Area pilota non valida."*).
- **API Routing live**: `GET https://lastrico-pilot.campsh.workers.dev/api/routes?start=12.49,41.89&end=12.50,41.90&mode=car&area=rome` restituisce `HTTP 400` (*"Coordinate, modalità di trasporto o livello di evitamento non validi."*).
- **Interfaccia utente live**: Il selettore città sulla homepage pre-renderizzata contiene unicamente **Milano** e **Roccella Ionica**.

---

## 3. Dettagli del Deployment Cloudflare Workers

Il rilascio è avvenuto rispettando pienamente il piano gratuito **Cloudflare Workers Free**:

- **URL pubblico**: `https://lastrico-pilot.campsh.workers.dev`
- **Nuovo Version ID**: `fe69e630-a6ea-4788-a432-1b8c6b885b5f` (100% traffico attivo)
- **Snapshot Homepage statica**: `22.896 byte` serviti come file statico edge (`dist/client/index.html`), garantendo **0 ms di CPU Worker** al caricamento iniziale.
- **Caricamento asset statici**: 5 nuovi file aggiornati (`layout-segment-context`, `index`, `manifest`, `page`, `index.html`), 14 asset invariati.
- **Binding attivi confermati**:
  - `env.ROUTE_ENGINE` (Durable Object `RouteEngine` per calcolo isolato senza timeout 10ms)
  - `env.DB` (D1 Database `site-creator-d1`)
- **Tempo di avvio Worker**: 12 ms
- **Comando di rollback immediato** (se necessario):
  ```bash
  npx wrangler rollback 170ac277-2094-4925-9378-1f3ff46aab1c --name lastrico-pilot
  ```

---

## 4. Privacy e Sicurezza della Diagnostica GPS

La funzionalità di diagnostica introdotta nella Fase 4.34 è conforme a rigorosi criteri di riservatezza:

- **Disattivata per impostazione predefinita**: All'avvio dell'applicazione lo stato `traceEnabled` è sempre `false`. Quando disattivata, nessun oggetto recorder viene istanziato e l'overhead di calcolo è nullo.
- **Zero telemetria o invio automatico**: Il codice di `lib/gps-trace.ts` e `lib/trace-diagnosis.ts` non contiene alcuna chiamata di rete (`fetch`, `sendBeacon`, `XMLHttpRequest`, `WebSocket`). Nessuna coordinata GPS viene mai trasmessa a Cloudflare o a server terzi.
- **Conservazione locale rigorosa**:
  - Massimo 3 tracce memorizzate localmente.
  - Limite di spazio complessivo di 2,5 MB nel `localStorage` del dispositivo.
  - Cancellazione automatica dei file dopo 7 giorni (`pruneExpiredGpsTraces`).
  - Pulsante **"Elimina"** per la rimozione manuale istantanea.
  - Pulsanti **"Esporta" (JSON)** e **"GPX"** che consentono all'utente di scaricare il file localmente solo su esplicita richiesta.

---

## 5. Risultati dei Test di Fumo e Verifica Mobile Live

### A. Test di fumo suite (`scripts/post-deploy-smoke.mjs`) — 18/18 PASS
- Homepage HTTP 200 & HTML headers: PASS (356 ms)
- Web App Manifest: PASS (72 ms)
- App assets & Service Worker: PASS (1414 ms)
- Strumenti interni/esperimenti non esposti: PASS (797 ms)
- Rifiuto input routing non valido (400): PASS (449 ms)
- Autocomplete Milano (Porta Romana): PASS (313 ms)
- Autocomplete Milano Sud (Largo Promessi Sposi): PASS (352 ms)
- Autocomplete Roccella (Via Marina): PASS (436 ms)
- Percorso Auto (Porta Romana → Promessi Sposi): PASS (5122 ms)
- Percorso Moto (Porta Romana → Promessi Sposi): PASS (4417 ms)
- Percorso Bici (Porta Romana → Promessi Sposi): PASS (4814 ms)
- Alternativa Anti-Pavé Castello → Missori (Bici): PASS (2764 ms, risparmio pavé accertato)
- Alternativa Anti-Pavé Duomo → Centrale (Moto): PASS (1664 ms, risparmio pavé > 1000m)
- Alternativa Anti-Pavé Duomo → Centrale (Bici): PASS (1381 ms, risparmio pavé > 1000m)
- Richiesta percorso di navigazione (`isNavigation=1`): PASS (2711 ms)
- Routing Roccella Ionica (Auto, Moto, Bici): PASS (153 ms, 169 ms, 85 ms)

### B. Verifica reale Mobile Browser (iPhone 390×844)
- Latenza tasto-suggerimento "Duomo": **819 ms**
- Latenza tasto-suggerimento "Porta Romana": **768 ms**
- Calcolo automatico a tocco singolo: **42 ms** (2 schede percorso visualizzate, nessun modale residuo)
- Controlli diagnostica GPS:
  - Casella disattivata di default: confermata (`checked: false`)
  - Apertura pannello espandibile "Dettagli tecnici e registrazione GPS": confermata
  - Attivazione e disattivazione toggle: verificate
  - Screenshot acquisito: `outputs/live-iphone-diagnostics-controls.png`

### C. Verifica Corridoi di Collaudo Milanesi (A/B e reverse)
1. **Largo Promessi Sposi → M4 Vetra (Auto)**: Distanza 4,307 km, pavé rilevato 231 m.
2. **M4 Vetra → Largo Promessi Sposi (Inverso, Auto)**: Distanza 3,777 km, pavé rilevato 28 m.
3. **Porta Romana → Viale Angelo Filippetti (Auto)**: Distanza 0,873 km, pavé rilevato 349 m.
4. **Piazza Gae Aulenti → Largo Promessi Sposi (Auto)**: Distanza 9,129 km, pavé rilevato 252 m.

---

## 6. Protocollo di Collaudo Fisico su iPhone Reale (Milano)

Questo protocollo è destinato al tester umano per una sessione di guida o bici reale a Milano in condizioni di massima sicurezza.

### A. Lista di controllo pre-partenza
1. **Supporto rigido per smartphone**: Montare l'iPhone su un supporto stabile da auto o manubrio bici, orientato in verticale e ben visibile senza ostruire la visuale di guida.
2. **Batteria e alimentazione**: Assicurarsi che la batteria sia carica o collegare il cavo di alimentazione (il modulo GPS e lo schermo sempre attivo consumano energia).
3. **Permessi di localizzazione iOS**:
   - Aprire Safari su `https://lastrico-pilot.campsh.workers.dev`.
   - Quando richiesto, autorizzare la posizione con l'opzione **"Mentre usi l'app"** e attivare l'interruttore **"Posizione esatta"** nelle impostazioni di sistema di iOS per Safari.
4. **Blocco schermo**: Impostare il blocco automatico dello schermo su "Mai" o assicurarsi che l'app mantenga il display attivo tramite la navigazione attiva.

### B. Corridoi di test raccomandati
- **Corridoio 1: Largo Promessi Sposi ↔ M4 Vetra**
  - *Obiettivo*: Verificare la transizione tra asfalto liscio a sud, attraversamenti tramviari e pavé storico all'ingresso della cerchia interna/ZTL.
- **Corridoio 2: Porta Romana / Viale Angelo Filippetti**
  - *Obiettivo*: Valutare la tempestività degli avvisi sonori e visivi di fondo sconnesso in presenza di lastricato denso e incroci semaforizzati.
- **Corridoio 3: Piazza Gae Aulenti → Largo Promessi Sposi**
  - *Obiettivo*: Test su corridoio esteso nord-sud, attraversamento di molteplici quartieri, coerenza del ricalcolo in caso di deviazione spontanea.

### C. Istruzioni operative passo per passo
1. **Pianificazione**:
   - A veicolo fermo, digitare l'indirizzo di destinazione nel campo "Destinazione".
   - Toccare il suggerimento con un singolo tocco.
2. **Attivazione della registrazione diagnostica**:
   - Toccare **"Fondo stradale e altre opzioni"**.
   - Toccare **"Dettagli tecnici e registrazione GPS"**.
   - Selezionare la casella **"Registra traccia GPS per il collaudo"**.
   - Comparirà la conferma del salvataggio locale (massimo 3 tracce, 2,5 MB, nessun invio a server).
3. **Avvio navigazione**:
   - Toccare il pulsante blu **"Avvia navigazione"**.
   - Sul display comparirà il badge rosso **"REC"**, indicante che la traccia viene memorizzata localmente insieme a velocità, accuratezza e decisioni di ricalcolo.
4. **Durante la marcia — REGOLE DI SICUREZZA ASSOLUTA**:
   - **NON TOCCARE MAI IL TELEFONO DURANTE LA GUIDA.**
   - L'applicazione opera in autonomia: aggiorna il percorso, ricalcola in caso di svolta errata e visualizza gli avvisi di fondo stradale.
5. **Al termine della corsa (a veicolo fermo e spento)**:
   - Toccare **"Arresta"** per fermare la navigazione.
   - Tornare nel menu "Fondo stradale e altre opzioni" → "Dettagli tecnici e registrazione GPS".
   - Nella lista delle tracce comparirà la corsa appena conclusa con orario, numero di rilevazioni e dimensione in kB.
   - Toccare **"Esporta"** (per scaricare il file JSON completo di telemetria e diagnostica) oppure **"GPX"** (per visualizzarlo in qualsiasi viewer cartografico).
   - In caso di necessità di pulizia, toccare **"Elimina"**.

---

## 7. Raccomandazioni per la Fase 4.35

1. **Analisi delle tracce sul campo**: Importare i file `.json` registrati dal tester fisico ed elaborarli con lo script `scripts/replay-gps-trace.mjs` per analizzare eventuali salti GPS, latenze di ricalcolo o falsi positivi negli attraversamenti tramviari.
2. **Taratura avvisi pavé**: Verificare se il preavviso di 180 metri / 15 secondi risulta ottimale alla velocità media del traffico milanese (30-40 km/h).
3. **Estensione a Roma**: A collaudo fisico milanese validato e consolidato, pianificare l'estensione del pilot Cloudflare al dataset di Roma garantendo lo stesso livello di isolamento e rispetto dei limiti di memoria Workers Free.
