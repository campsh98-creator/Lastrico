# Revisione indipendente di sicurezza e rilascio - PR36

Data: 20 novembre 2026. Destinazione: lastrico-preview-437. Pilot escluso da ogni operazione.

## Verdetto
CHANGES REQUIRED come proposta di recupero del preview esistente. I due difetti confermati sono corretti nel ramo, ma il meccanismo di reset anticipato resta superfluo per questo incidente e non deve essere unito/distribuito come soluzione. Preferire la scadenza naturale del blocco, senza ricostruire o modificare lo stato storico. Conservare PR/documentazione come evidenza e, se utile, estrarre in una successiva proposta minima le protezioni contro risposte tardive e redirect. Nessun merge, chiusura PR o deploy effettuato da questa revisione.

## Evidenze e correzioni
- main e ultimo sorgente pubblicato non registrano l'identita della chiave rifiutata. Sostituire il segreto non azzera un blocco persistente di sei ore. Dal ledger storico non si puo distinguere la vecchia chiave dalla sostituzione; non fabbricare un fingerprint di migrazione. Lo status non prova che la nuova chiave sia stata interrogata o rifiutata.
- Difetto riprodotto: dopo la scadenza, una richiesta ordinaria con una nuova chiave aggiorna il fingerprint prima dell'esito; un404/500 puo mantenere la ragione di rifiuto della vecchia chiave ma attribuirla alla nuova. Ora il fingerprint associato al breaker viene aggiornato soltanto da successo o vero401/403; tentativi non autenticanti aggiornano solo la cronologia osservata. Il legacy non acquisisce una falsa identita rifiutata.
- Difetto riprodotto: HTTP200 JSON veniva memorizzato e marcato verified. Ora un probe richiede HTTP200, MIME binario/PBF, decodifica MVT, layer Traffic flow e almeno un livello relativo numerico finito tra0 e1; valori numerici fuori intervallo invalidano il probe. Payload non verificabili non vengono memorizzati, consumano l'unico tentativo e mantengono il blocco. Un tile vuoto resta inconcludente; non dimostra credenziale non valida e non va ritentato automaticamente.
- Hash SHA-256 con separazione di dominio, token operatore confrontato in tempo costante, nessun digest/credenziale nelle risposte o nei log applicativi, spesa quota e claim prima dell'I/O, replay bloccato, nessun bypass pubblico del probe rilevato. Serializzazione valida nel singolo Durable Object. Limiti giornalieri4000/mensili60000 e quota overlay1500 preservati; nessun reset remoto.
- Limite di design: probeOnly blocca anche il tentativo normale dopo scadenza per legacy senza fingerprint. pending/verified/failed sono fermi permanenti senza percorso di riattivazione; nemmeno una nuova chiave li rimuove. Sono protezioni intenzionali, ma richiedono altro codice/autorita per tornare operativi: complessita evitabile per questa ripresa naturale. Non introdurre uno sblocco che manipoli lo stato per compensare tale limite.

## Stato corrente e deployment
Lettura read-only durante questa revisione: configured=true, available=false, reason=key-rejected, remainingToday=3998, remainingThisMonth=59998. Provider request della revisione: ZERO. I due usi storici rimangono invariati. Nessun test live eseguito perche il circuito non risulta riaperto.

Ultimo publish riuscito registrato:19 novembre2026 16:45UTC, sorgente c42822926fbbad92d052cbb5b502daf232b2052e, versione cf2c9c77-ea7b-45a5-a21a-2e112b602027, run https://github.com/campsh98-creator/Lastrico/actions/runs/44568733325 . Questo e lo storico workflow, non una lettura indipendente della versione Cloudflare dopo sostituzione manuale del segreto. Pin approvato invariato. Preview e pilot non distribuiti/modificati. TLS, trust store, SentinelOne e autenticazione non alterati.

## Contratto ufficiale e incertezze
Flow GET https://api.tomtom.com/traffic/map/4/tile/flow/relative/14/8610/5863.pbf ; Incidents GET https://api.tomtom.com/traffic/map/4/tile/incidents/14/8610/5863.pbf con t=-1. La chiave viene fornita soltanto dal Worker tramite il segreto esistente, mai tramite browser, shell o report. I servizi richiedono una chiave valida per il servizio richiesto. Verificare nel pannello proprietario il prodotto Traffic Flow & Incidents Vector Tiles per TomTom Maps/map v4 e le restrizioni configurate; non presumere che un entitlement Orbis o un altro prodotto sia equivalente. Un403 non distingue da solo chiave invalida, restrizione o servizio non autorizzato.

Documentazione ufficiale: formato vector/PBF, MIME image/pbf, layer Traffic flow, traffic_level relativo0..1; Incidents layer Traffic incidents flow/Traffic incidents POI. Il proxy esistente normalizza il MIME a application/x-protobuf, quindi il test pubblico non osserva direttamente gli header del provider. Nessun accesso al pannello proprietario e stato effettuato: abilitazioni, piano Freemium e consumo condiviso dell'account restano da confermare. La tariffa pubblica indica200000 vector tile/mese; il ledger di un Worker non misura l'eventuale uso di altri sistemi dello stesso account.

Fonti:
- https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/traffic-flow/vector-flow-tiles
- https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/traffic-incidents/vector-incident-tiles
- https://docs.tomtom.com/platform/documentation/api-best-practices/api-key-management-best-practices
- https://docs.tomtom.com/pricing
- https://docs.tomtom.com/platform/documentation/my-tomtom/freemium-and-pay-as-you-grow-faqs

## Procedura minima di attivazione - senza distribuire PR36
1. Confermare nel pannello TomTom le abilitazioni Flow/Incidents map v4, il piano gratuito e almeno una richiesta gratuita residua considerando tutti i consumatori. Non acquistare crediti o cambiare piano. Non inviare chiavi o schermate con segreti.
2. Chiudere overlay, UI e altri test del preview; coordinare una finestra senza altri consumatori. Il preview attuale applica quote ma NON un tetto globale di una sola richiesta: se non si puo garantire una finestra controllata, fermarsi. Non creare infrastruttura per aggirare questo vincolo.
3. Leggere esclusivamente GET https://lastrico-preview-437.campsh.workers.dev/api/traffic/status . Nessuna richiesta provider e nessuna modifica al ledger. Se available=false o quota insufficiente: STOP. Attendere la normale scadenza senza polling aggressivo; non resettare lo stato. Lo status attuale non espone openUntil, quindi l'ora precisa di riapertura e ignota.
4. Solo con status riaperto, effettuare UNA SOLA GET https://lastrico-preview-437.campsh.workers.dev/api/traffic/tile?kind=flow&z=14&x=8610&y=5863 attraverso il proxy esistente. Nessun routing completo, UI o scripts/traffic-live-check.mjs: quest'ultimo fa due chiamate dirette. Non estrarre il segreto Cloudflare, non contattare direttamente TomTom da questo PC e non usare retry/redirect automatici.
5. Verificare HTTP del proxy, MIME PBF normalizzato, dimensione<=512KiB, decodifica MVT/layer Traffic flow, traffic_level numerico0..1 e X-Traffic-Fetched-At. Registrare soltanto statistiche e codici; non corpi errore arbitrari, URL provider o header completi. Rileggere lo status e confrontare i contatori prima/dopo nella stessa giornata/mese UTC. Una richiesta effettiva deve consumare esattamente una unita giornaliera e mensile; il proxy usa la quota overlay, senza modificarne il limite. Delta0 indica possibile cache: risultato inconcludente, NON autorizza un secondo tentativo. Delta>1 indica altra attivita: STOP e nessun GO. La contabilita aggregata da sola non attribuisce richieste concorrenti alla propria chiamata.
6. In caso di503/key-rejected: STOP immediato, lasciare al codice il blocco401/403 di sei ore. In caso429, timeout, corpo non valido o esito ambiguo: STOP, nessun nuovo test o reset, non dichiarare la chiave respinta da un errore di parsing. Lo schema attuale non espone il codice originario TomTom separatamente: non inventarlo dal solo HTTP del proxy.
7. Se la singola prova Flow e fresca, valida e conteggiata correttamente, proporre una separata prova Incidents tramite lo stesso proxy, massimo una richiesta aggiuntiva soltanto dopo approvazione esplicita. Nessuna chiamata Incidents inclusa nella presente autorizzazione. Non dichiarare traffico live completo dopo la sola prova Flow.

Esempio eseguibile dalla radice repository con Node>=24, soltanto nella finestra controllata descritta sopra (NON eseguito durante questa revisione):

```js
import { decodeMvt } from './lib/traffic/mvt.ts';
const base = 'https://lastrico-preview-437.campsh.workers.dev';
const readStatus = async () => {
  const r = await fetch(base + '/api/traffic/status', { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('status unavailable');
  return r.json();
};
const before = await readStatus();
if (!before.configured || !before.available || before.remainingToday < 1 || before.remainingThisMonth < 1) {
  console.log('STOP: circuito o quota non disponibili');
} else {
  const utcDay = new Date().toISOString().slice(0, 10);
  // Unico fetch tile; nessun loop, redirect, retry o richiesta Incidents.
  const r = await fetch(base + '/api/traffic/tile?kind=flow&z=14&x=8610&y=5863', {
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  let valid = false;
  let features = 0;
  if (r.status === 200 && r.headers.get('content-type')?.startsWith('application/x-protobuf')) {
    try {
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > 512 * 1024) throw new Error('oversized tile');
      const layer = decodeMvt(bytes).layers['Traffic flow'];
      const levels = layer?.features.map(f => f.properties.traffic_level) ?? [];
      features = layer?.features.length ?? 0;
      valid = levels.some(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
        && !levels.some(v => typeof v === 'number' && (!Number.isFinite(v) || v < 0 || v > 1));
    } catch { valid = false; }
  } else { await r.body?.cancel(); }
  const after = await readStatus();
  const dailyDelta = before.remainingToday - after.remainingToday;
  const monthlyDelta = before.remainingThisMonth - after.remainingThisMonth;
  const countedOnce = utcDay === new Date().toISOString().slice(0, 10) && dailyDelta === 1 && monthlyDelta === 1;
  const fetchedAtPresent = Number(r.headers.get('x-traffic-fetched-at')) > 0;
  console.log(JSON.stringify({ status: r.status, valid, features, dailyDelta, monthlyDelta, fetchedAtPresent,
    outcome: valid && countedOnce && fetchedAtPresent && after.available ? 'Flow only: candidate for separate Incidents approval' : 'STOP: no retry' }));
}
```

Non ripetere lo snippet dopo un esito o errore: un timeout del client puo avvenire dopo una richiesta gia conteggiata. Nessuna lettura/scrittura diretta dello stato remoto e necessaria.

## Validazione e decisione
La CI iniziale11f3001 era verde:687 test,675 passati,12 saltati,zero fallimenti. La revisione aggiunge regressioni di provenienza della credenziale e formato della tile; esiti finali e commit correttivo sono riportati nella PR e nella consegna. NO-GO live ora: circuito ancora chiuso, abilitazioni e consumo condiviso non verificati. Il divieto di merge/deploy resta esplicito anche se tutti i test sono verdi.

Controlli locali ripetuti:Gruppo selezionato traffic-auth-recovery, traffic-hub, traffic-core, traffic-route e preview-workflow:72/72 PASS, senza skip o fallimenti; include45 regressioni recovery e6 controlli preview. Lint:0 errori e53 warning preesistenti. TypeScript e build verificati separatamente; CI Linux del commit correttivo da seguire fino a conclusione prima della consegna.
