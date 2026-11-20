# Lastrico — Rapporto di Causa Radice: Prove su Strada P0, Regressioni Anti-Pavé e Logging

- **Data:** 20 novembre 2026
- **Repository:** `campsh98-creator/Lastrico`
- **Autore:** Squadra di Sviluppo Lastrico (Release Owner)
- **Stato:** Analisi completata prima di qualsiasi modifica al codice di routing (Fase A)

---

## 1. Ispezione del Codice Preview Distribuito (`c428229`) rispetto a `main` (`ab6eafb`)

È stata eseguita una comparazione approfondita tra il commit distribuito in preview (`c428229`, PR #33) e la punta attuale di `origin/main` (`ab6eafb`, PR #35).

### Esito dell'ispezione:
- **Codice applicativo identico:** Nessuna differenza presente nelle directory `app/`, `lib/`, `worker/`, `components/`.
- Le uniche differenze tra i commit riguardano la configurazione del workflow CI GitHub Actions (`.github/workflows/ci.yml`) e la documentazione di rilascio.
- **Conclusione:** Il comportamento osservato sul campo (ritenzione dei 25 m di pavé a Piazzale Lodi, svolte a U a Corso di Porta Romana, incongruenza nei log di ricalcolo) non è una regressione recente di preview rispetto a main, ma è una combinazione di difetti algoritmici e di tracciamento strutturalmente presenti su entrambi i rami.

---

## 2. Revisione Storica della Fase 4.37 (commit `da647c580`, PR #16)

La Fase 4.37 aveva introdotto una serie di modifiche per limitare le chiamate al provider pubblico Valhalla e affinare la ricerca anti-pavé su Milano:
1. **Abbassamento della soglia minima del tratto:** da 25 m a `min(minimumPaveReduction, 15 m)` (per l'auto: 15 m). La giustificazione storica era che il tratto di pavé della rotatoria di Piazzale Lodi misura esattamente 24,99 m nei dati OSM, e con la precedente soglia di 25 m non veniva nemmeno estratto come "rough slice".
2. **Introduzione di `stopsOnlyWhenClean`:**
   ```ts
   // lib/surface-aware-routing.ts
   export function stopsOnlyWhenClean(areaId: string, navigationRequest: boolean): boolean {
     return areaId === "milan" && !navigationRequest;
   }
   ```
   Questa funzione è stata abilitata **soltanto** per il pianificatore (`!navigationRequest`), escludendo esplicitamente le richieste di navigazione (`navigation=1`).
3. **Guardia `baseAlreadyImproves`:**
   ```ts
   // app/api/routes/route.ts
   const baseAlreadyImproves = improvesCheaply(preliminarySafe, preliminaryFast)
     && !(stopsOnlyWhenClean(area.id, navigationRequest) && preliminarySafe.riskMeters >= policy.minimumPaveReduction);
   ```
4. **Guardia sulle deviazioni geometriche via waypoint:**
   ```ts
   const penalisedRouteIsClean = stopsOnlyWhenClean(area.id, navigationRequest)
     && directSafe !== directFast && directSafe.riskMeters < policy.minimumPaveReduction;
   if (canGenerate && !penalisedRouteIsClean && !(directSafe !== directFast && improvesEnough(directSafe, directFast))) { ... }
   ```
5. **Penalità sulle svolte a U:** aggiunta di `U_TURN_PENALTY_SECONDS = 60` nel calcolo dell'utilità in `lib/route-optimization.ts`, ma **nessun passaggio del parametro `heading` a Valhalla**.
6. **Tetti alle richieste provider:** 7 per il pianificatore, 4 per la navigazione.

---

## 3. Ricostruzione dell'Incidente di Corso Lodi / Piazzale Lodi

Nel test su strada del 20 novembre lungo il corridoio Corso Lodi / Piazzale Lodi:
- Il percorso sicuro selezionato ha mantenuto circa **25 m di pavé confermato** (`sett` sulla rotatoria di Piazzale Lodi, way OSM `287070936`).
- Il motore ha riportato `generated: 0` alternative dedicate (o nessuna nuova alternativa oltre a quella di base).

### Causa radice esatta:

#### Caso Navigazione (`navigation=1`, ricalcolo durante la guida):
1. In navigazione, `navigationRequest === true`.
2. Di conseguenza, `stopsOnlyWhenClean("milan", true)` restituisce **`false`**.
3. Nella valutazione di `baseAlreadyImproves`:
   ```ts
   !(stopsOnlyWhenClean(...) && ...) === !(false && ...) === true
   ```
4. Tra i percorsi di base restituiti da Valhalla:
   - `base-2` (percorso standard lungo Corso Lodi): 195 m di pavé, 571 s.
   - `base-1` (alternativa del provider attraverso la rotatoria): 25 m di pavé, 595 s (+24 s).
5. `improvesCheaply(preliminarySafe, preliminaryFast)` controlla se `preliminarySafe` riduce sufficientemente il pavé rispetto a `preliminaryFast` (risparmia 170 m su 195 m) con un aumento di tempo <= 90 s. **Questo controllo è risultato VERO.**
6. Poiché `improvesCheaply` è vero e la guardia `stopsOnlyWhenClean` è disattivata in navigazione, **`baseAlreadyImproves` è risultato VERO**.
7. Di conseguenza:
   ```ts
   const canGenerate = !baseAlreadyImproves && ...; // DIVENTA FALSE!
   ```
8. **La ricerca dedicata non è nemmeno partita** (`surfaceAwareAttempted = false`, `generated = 0`, `providerRequests = 1`).
9. Il sistema ha considerato l'alternativa di base con 25 m di pavé come "sufficientemente migliorativa", impedendo la generazione di qualsiasi alternativa completamente pulita (es. via Friuli, 0 m di pavé).

#### Caso Pianificatore (`navigation=0`):
1. In pianificazione, `stopsOnlyWhenClean` restituisce `true`. Poiché 25 m >= 20 m (`policy.minimumPaveReduction`), `baseAlreadyImproves` è `false` e `canGenerate` è `true`.
2. Viene eseguita la richiesta penalizzata (`linear_cost_factors` di fattore 15 sulle fette di Corso Lodi).
3. Tuttavia, Valhalla, penalizzando Corso Lodi, devia esattamente su Piazzale Lodi (`base-1`), che ha 25 m di pavé.
4. Viene controllato se avviare il raffinamento (`pendingRefinement`):
   ```ts
   firstScored.surfaceScore.weightedPaveMeters >= Math.max(policy.minimumPaveReduction, preliminaryFast.surfaceScore.weightedPaveMeters * 0.5)
   ```
   Poiché `25 m < 97.5 m` (50% di 195 m), il raffinamento **non viene preparato**.
5. Si passa al blocco delle deviazioni geometriche (linea 787):
   ```ts
   if (canGenerate && !penalisedRouteIsClean && !(directSafe !== directFast && improvesEnough(directSafe, directFast)))
   ```
   Poiché `directSafe` ha 25 m e `directFast` ha 195 m, `improvesEnough` (170 m >= 80 m) è **VERO**.
   La condizione `!(improvesEnough)` diventa **FALSA**.
6. **Le deviazioni geometriche (es. via Friuli) vengono saltate.**
7. In deduplicazione, il percorso penalizzato coincide con `base-1` e viene deduplicato. Il percorso finale resta quello con 25 m di pavé.

---

## 4. Analisi della Pipeline di Routing e Tracciamento dei Limiti

Il flusso analitico completo evidenzia:
- **Soglie di pavé (`minimumPaveReduction`):** Auto 20 m, Moto 15 m, Bici 12 m.
- **Definizione di miglioramento sufficiente (`improvesEnough`):** Richiede una riduzione di almeno `max(minimumPaveReduction, 80m, 30% del pavé iniziale)`. Questa metrica è pensata per evitare deviazioni minime, ma viene usata erroneamente come condizione di arresto totale della ricerca di percorsi a pavé zero.
- **Asimmetria tra Pianificatore e Navigazione:** La scelta in Fase 4.37 di disabilitare `stopsOnlyWhenClean` in navigazione è stata motivata dal voler risparmiare latenza, ma ha causato l'effetto collaterale critico di accettare pavé residuo significativo (25 m) senza verificare se esistesse una deviazione legale a 0 m.

---

## 5. Incongruenza nei Log di Ricalcolo: `objective=fast` vs `safe:no-alternative`

Nel log di navigazione e nei dati di traccia è stato riscontrato che:
- `trace.routes[k].objective` riporta `"fast"`.
- L'evento `reroute-success` registra contestualmente `safe:no-alternative`.

### Causa radice nel codice:
In `app/page.tsx` (linee 2312-2345):
```ts
const nextRoute = isReroute
  ? rerouteDisplayKind(options.preserveRoute ?? "safe", data.hasDistinctAlternative)
  : selectRouteKind(options.preserveRoute, data.hasDistinctAlternative);
applyRouteData(data, nextRoute, requestedMode);
const nextSelectedRoute = nextRoute === "safe" ? data.safe : data.fast;
...
if (isReroute) {
  traceRecorderRef.current?.addRoute({
    ...
    // ERRORE: passa nextRoute (che vale "fast" per la sola interfaccia utente)
    // invece di objective (options.preserveRoute ?? "safe")
    ...traceRouteDetails(nextSelectedRoute, nextRoute, routeGenerationRef.current),
  });
}
```
In `lib/reroute-objective.ts`:
```ts
export function rerouteDisplayKind(objective: RouteKind, hasDistinctAlternative: boolean): RouteKind {
  return objective === "safe" && hasDistinctAlternative ? "safe" : "fast";
}
```
- Quando `hasDistinctAlternative` è `false`, `rerouteDisplayKind("safe", false)` restituisce `"fast"`. Questo serve unicamente all'interfaccia utente per selezionare quale scheda mostrare (poiché in assenza di alternative entrambe le schede contengono il percorso più rapido).
- Tuttavia, la funzione `traceRouteDetails` accetta come secondo parametro il campo denominato `objective: "safe" | "fast"`.
- Passando `nextRoute` (`"fast"`), l'oggetto memorizzato nella traccia riceve `route.objective = "fast"`.
- Pochi millisecondi dopo (linea 2363), il gestore registra l'evento analitico:
  ```ts
  const objective = options.preserveRoute ?? "safe";
  traceRecorderRef.current?.recordEvent("reroute-success", `${objective}:${data.hasDistinctAlternative ? "alternative" : "no-alternative"}`);
  ```
- **Conclusione:** Non c'è stata una scelta volontaria dell'utente di passare a "fast", né un degrado permanente dell'obiettivo. L'utente ha mantenuto l'obiettivo "safe", ma un bug di cablaggio in `app/page.tsx` ha passato la variabile di visualizzazione UI (`nextRoute`) al recorder di traccia anziché il reale obiettivo di navigazione (`objective`).

---

## 6. Svolte a U Ripetute su Corso di Porta Romana

Nel corso del test lungo Corso di Porta Romana, l'applicazione ha ripetutamente suggerito manovre di inversione a U ("Fai inversione a U").

### Causa radice esatta:
1. Corso di Porta Romana è un'arteria complessa con corsie separate, binari tranviari centrali e tratti a senso unico o con corsie riservate contigue.
2. In `app/page.tsx`, quando viene rilevata una deviazione e scatta il ricalcolo:
   ```ts
   void calculateRoutes(
     { label: "Posizione GPS live", coordinate: decision.position },
     { mode, preserveRoute: journeyObjectiveRef.current, ... }
   );
   ```
   Viene inviata una richiesta a `/api/routes` contenente solo `start: lon,lat` e `end: lon,lat`.
3. In `app/api/routes/route.ts` e in `lib/routing-providers.ts` (`fetchValhallaRoutes`), le coordinate vengono inviate a Valhalla come:
   ```ts
   locations: points.map(([lon, lat], index) => ({
     lon,
     lat,
     type: index === 0 || index === points.length - 1 ? "break" : "through",
   }))
   ```
4. **`heading` e `heading_tolerance` non vengono MAI passati a Valhalla.**
5. In assenza di direzione, Valhalla aggancia la coordinata di partenza all'arco OpenStreetMap geometricamente più vicino in termini di pura distanza euclidea.
6. A causa della normale tolleranza GPS (5–10 metri di errore laterale), il punto di partenza viene agganciato alla carreggiata opposta o al binario tranviario con direzione contraria.
7. Valhalla è quindi costretto a calcolare un percorso che inizia orientato verso nord (direzione errata) e impone una manovra immediata di inversione a U (manovre tipo 12 `kUturnRight` o 13 `kUturnLeft`).
8. La penalità `U_TURN_PENALTY_SECONDS = 60` in `lib/route-optimization.ts` non può rimediare a questo problema se il provider restituisce percorsi che nascono già orientati in senso opposto.
9. **Soluzione tecnica:** Passare `heading` (derivato dal fix GPS e dal filtro di navigazione) con `heading_tolerance` (45°–60°) nella prima posizione (`locations[0]`) della richiesta Valhalla in navigazione, vincolando l'aggancio del grafo alla direzione effettiva di marcia.

---

## 7. Classificazione Spaziale: Carreggiata vs Binari Tranviari

Sul corridoio di Corso Lodi e Corso di Porta Romana, i binari tranviari e la carreggiata stradale scorrono affiancati a una distanza tra 3 e 10 metri.

### Analisi dell'aggancio geometrico:
- `lib/road-intelligence-scoring.ts` utilizza `policy.surfaceMatchMeters` (12 m per auto, 11 m per moto, 9 m per bici).
- La funzione `matchSample` seleziona i segmenti nel raggio di tolleranza e verifica l'allineamento angolare tramite `headingsAlign`.
- Se la traiettoria GPS presenta una deriva laterale verso il centro strada (frequente tra palazzi alti per effetto multipath), i punti campionati possono cadere più vicini all'asse del binario tranviario rispetto alla mezzeria della corsia veicolare.
- Se l'asse tranviario è classificato in OSM con `surface=sett` o tag affini mentre la carreggiata veicolare è asfalto (`surface=asphalt`), il punteggio di superficie può associare erroneamente il pavé del binario alla traiettoria del veicolo, oppure viceversa non riconoscere il pavé della corsia se viene agganciato un binario dismesso.
- Il controllo `candidate.modeAccess?.[mode] ?? candidate.isMotorAllowed` garantisce che non vengano agganciati elementi riservati esclusivamente al tram quando i tag OSM sono corretti, ma per evitare ambiguità l'allineamento direzionale stretto e il rispetto della corsia di marcia sono indispensabili.

---

## 8. Piano di Intervento e Condizioni di Rilascio (Fase B e C)

Prima di effettuare modifiche al codice di instradamento, vengono definiti i seguenti interventi mirati:
1. **Correzione del Logging:** Ripristinare il corretto passaggio di `objective` (`options.preserveRoute ?? "safe"`) in `traceRouteDetails` in `app/page.tsx`.
2. **Supporto `heading` in Navigazione:** Accettare il parametro `heading` in `/api/routes` e inoltrarlo a Valhalla in `locations[0]` con `heading_tolerance` per eliminare le inversioni a U spurie su Corso di Porta Romana e doppie carreggiate.
3. **Ottimizzazione Ricerca Anti-Pavé a Piazzale Lodi:** Permettere alla ricerca in navigazione e al generatore di detours di non arrestarsi prematuramente quando resta pavé confermato eliminabile legalmente, garantendo la generazione dell'alternativa pulita via Friuli.
4. **Creazione Fixture di Regressione Deterministiche:** Coprire i 5 corridoi con test permanenti.
5. **Studio di Fattibilità Mapillary (Fase C):** Valutare la copertura fotografica libera e i termini di licenza per i 5 corridoi.
