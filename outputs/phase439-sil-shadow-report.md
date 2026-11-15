# Lastrico · Fase 4.39 · Strato Surface Intelligence offline, in modalità ombra

- **Data:** 15 novembre 2026. **Base:** commit locale `6fd4908` (Fase 4.38). Ramo `feat/phase439-surface-intelligence-shadow`, worktree separato `…\Lastrico-phase439`. Il worktree della 4.38, la PR #16 e i file della ricerca 4.36 non sono stati modificati.
- **Stato: implementata e verificata in locale. Nessun push, merge o deploy.** Il motore dei percorsi **non legge** l'overlay: nessuna penalità, nessuna tessera di produzione riscritta.
- **Decisione:** **GO** per proseguire con il collegamento in ombra al motore **dopo l'unione della PR #16** (§9). **NO-GO** per l'attivazione in produzione.
- Tutti i numeri sui binari sono **effetti previsti da dati aperti** (OSM, DBT 2020, ATM), non una verifica sul posto.

## 1. Avvertenza sulle istruzioni originali

Il messaggio di avvio conteneva solo il contesto e i vincoli. Le istruzioni «originali» della 4.39 non erano visibili in questa sessione. Ho ricostruito l'ambito dalla «fase minima» del progetto SIL della 4.36 (§11–§13), dal report 4.38 e dai vincoli del messaggio, e l'ho scritto in `outputs/prompt-phase439-sil-shadow.md`. **Se le istruzioni originali differiscono, prevalgono: dimmi quali.**

## 2. Verifiche preliminari

| Controllo | Esito |
|---|---|
| Cartella 4.38 e commit `6fd4908d5f11333da02abacf77414854a0faf5d2` | Esistono; ramo `feat/phase438-osm-foundation`; albero pulito; i 20 file della 4.38 coincidono con il report |
| Worktree 4.39 | Creato da `6fd4908` con `git worktree add -b`; il worktree 4.38 resta a 0 modifiche |
| Ricerca 4.36 | Letti `surface-intelligence-design.md`, `external-data-audit.md` e il prototipo `si-*.mjs` (non tracciato), in sola lettura |
| Cache esterne usate | Solo dal repository originale, in lettura: riquadro DBT Lodi (3 file, SHA-256 nel manifesto) e file ATM ds538 (`4c0469fc…bec0`). Il campione Lodi 4.36 viene dal `work/` del worktree 4.38, in lettura |
| Traccia GPS grezza | **Non letta, non copiata, non citata.** Si usano solo vie pubbliche |

## 3. Che cosa è stato costruito

| Pezzo | File | Funzione |
|---|---|---|
| Nucleo | `scripts/sil/sil-core.mjs` | Porting del prototipo 4.36: validatore, risolutore dei conflitti, riancoraggio. **Comportamento invariato** (`si-resolver-0.1.0`) |
| Copertura | `scripts/sil/sil-coverage.mjs` | Che cosa ogni fonte ha **richiesto** (dalla richiesta, non dalla risposta) e dove; corridoi «attorno a una via» |
| Binari | `scripts/sil/sil-rails.mjs` | Join geometrico generico; assi OSM dal sidecar 4.38; DBT 2020 classificato per **codice di specifica** (non per le etichette `_d` scambiate); ATM solo come «servizio» |
| Costruzione | `scripts/sil/sil-build.mjs` | Registro, viste, overlay per tessera, manifesto, copertura, fatti. Deterministica |
| Ombra | `scripts/sil/sil-shadow-replay.mjs`, `sil-landmarks.mjs`, `sil-measure.mjs` | Replay sui 264 casi, esito per vie pubbliche, costi |
| Lettore | `lib/sil-overlay.ts` | Puro, con guardia dell'hash; **non importato** da `app/`, `worker/`, `components/` o altro `lib/` (c'è un test) |
| Schema e politica | `scripts/sil/sil.schema.json`, `policy.v0.json` | Overlay 0.2 e manifesto 0.2; la politica aggiunge solo i bit 13 e 14 (servizio), tutto il resto invariato |
| Test | `tests/phase439-sil.test.mjs` | 9 test |

**Regole di copertura, applicate dal codice e dai test:**
1. Una fonte che non ha chiesto i binari **non** può dire «assenti». Il gruppo storico `legacy-citywide` (query `way["highway"]`) ha 0 binari **per costruzione**: i suoi segmenti sono «sconosciuti per copertura».
2. Il campione Lodi ha un riquadro grande (45,40–45,55 × 9,05–9,32) che serve solo a trovare le vie per nome. I binari sono stati chiesti **solo attorno** a Piazzale Lodi (80 m), Corso Lodi e Via Lazzaro Papi (30 m). Quel riquadro **non** è copertura: sarebbe stato un errore di tutta la città. Il test lo verifica.
3. Un segmento è `mapped`, `asked-none` (qualcuno ha cercato e non c'è nulla: **non è una prova**, le fonti non sono complete) oppure `unknown`. Il lettore non restituisce mai «assente».
4. La data di una via OSM è l'ultima modifica della via, **non** una data di rilievo: `observedAt` resta nullo.

## 4. Fatti nuovi acquisiti sull'infrastruttura di Milano

(Tutti da dati archiviati; **nessuna nuova richiesta di rete** in questa fase.)

**Binari OSM (sidecar 4.38, riquadri pilota):**
- 916 vie ferroviarie nelle estrazioni che le hanno chieste; **661 sono tram operativi** (`railway=tram`), 255 di altro tipo. Tutti i 661 hanno tutti i vertici.
- Fra i 661 tram: **47 con `service=siding`** (raccordi o depositi, non binari di strada), 13 in galleria o su ponte, 18 con `layer` ≠ 0 (16 a +1, 2 a −1).
- Agganciati ai segmenti compilati (≤ 5 m, ≤ 30°, ≥ 50 % del segmento): **2.621 segmenti, 37,5 km** di segmenti con un asse tram OSM lungo la carreggiata.

**DBT 2020 (riquadro Lodi, 1,2 × 1,3 km):** 36 assi tram (22 con codice POS 02, 14 con POS 01); classificati per poligoni: 18 «carreggiata condivisa», 14 «sede propria», 4 sconosciuti. **112 segmenti, 2.268 m** con binari lungo la carreggiata: coincide con il prototipo 4.36 (112 segmenti, 2.264 m).

**ATM ds538 (file del 24 luglio 2026):** 45 percorsi tram su 16 linee. Su 1.053 tratti con binari mappati: **841 hanno una linea in servizio entro 12 m, 212 no** (nessuna linea programmata: raccordi, binari fuori servizio o variazioni di linea; **la causa non è verificata**).

**OSM contro DBT nel riquadro Lodi** (2.139 segmenti; OSM ha chiesto i binari su 1.009):
| Esito | Segmenti |
|---|---:|
| Entrambi mostrano binari | 11 |
| DBT sì, OSM cercato e non mappato | **48** |
| DBT sì, OSM non ha chiesto | 28 |
| Solo OSM | 1 |

Cioè: **dove DBT vede i binari, OSM quasi sempre non li ha mappati.** Su Corso Lodi: 238 segmenti (5.100 m) con binari richiesti dal campione, **34 segmenti (683 m) con binari mappati** (tutti da DBT, tutti «carreggiata condivisa»); 33 su 34 senza linea ATM programmata; tutti 34 in revisione per il disaccordo con OSM.

**Vie pubbliche (copertura e binari):**
| Via | Segmenti | Binari richiesti | Mappati | Note |
|---|---:|---:|---:|---|
| Corso Lodi | 238 (5.100 m) | 238 | 34 (683 m) | sopra |
| Piazzale Lodi | 107 (373 m) | 107 | **0** | cercati e non trovati; non è prova |
| Via Lazzaro Papi | 12 (274 m) | 12 | **0** | idem |
| Via Friuli | 38 (1.244 m) | 25 | 3 (72 m, servizio attivo) | 13 segmenti (484 m) **sconosciuti per copertura** |
| Viale Umbria | 182 (4.475 m) | 90 | 2 (17 m, servizio attivo) | 92 segmenti (2.091 m) sconosciuti |
| Via Fra Cristoforo | 41 (509 m) | **0** | 0 | tutta sconosciuta per copertura |

**Esposizione dei percorsi mostrati (replay in ombra, 264 casi, 526 percorsi, 2.223,6 km, nessun effetto sulle risposte):**
| Stato di 10 m di percorso | Quota |
|---|---:|
| Binari mappati | **6,57 %** (146,2 km) |
| Binari cercati e non mappati (non è prova) | 30,37 % |
| **Sconosciuto per copertura** | **56,31 %** |
| Nessun segmento allineato entro 12 m | 6,75 % |
272 dei 526 percorsi toccano almeno un tratto con binari mappati. Su 138 casi con alternativa anti-pavé: l'alternativa ha **meno** binari mappati in 80 casi, **più** in 22 (differenza da −1.383 m a +475 m). È una misura in ombra: **non decide nulla**.

## 5. Copertura raggiunta

| Misura | Segmenti | Metri | Quota dei 1.637.974 m |
|---|---:|---:|---:|
| Binari richiesti da estrazione OSM (riquadri pilota e corridoi Lodi) | 36.862 | 472.569 | 28,9 % |
| Riquadro DBT (Lodi) | 2.139 | 36.649 | 2,2 % |
| **Richiesti da almeno una fonte** | **37.992** | **495.959** | **30,3 %** |
| **Sconosciuti per copertura** | **64.036** | **1.142.015** | **69,7 %** |

- 102.028 segmenti unici su 117 tessere; 26 tessere con overlay.
- **Restrizioni di svolta:** le 11 fonti pilota le hanno chieste (220 restrizioni); le 8 storiche no. **Non sono usate in questa fase** (nessun consumatore).
- **Compatibilità con le tessere di produzione:** 109 tessere su 117 hanno hash identico, le altre 8 (direzione circolare, 4.38) hanno lo **stesso ordine e le stesse coordinate**: l'overlay è compatibile per indice con entrambe. Si lega all'hash delle tessere 4.38; una tessera diversa lo disattiva (fail-open).

## 6. Impatto misurato (locale, Node 26; **non** workerd né Cloudflare)

| Misura | Valore | Obiettivo 4.36 |
|---|---|---|
| Overlay su disco, 26 file | 96.307 B grezzi / **23.026 B gzip** | — |
| Rispetto alle tessere base (8.829.464 B) | 1,09 % | — |
| Rispetto al Worker (gzip 3.357,80 KiB, dry-run 4.38) | **0,67 %** (+22,5 KiB) | bundle ≤ +0,5 MiB: **rispettato** |
| Heap dopo analisi (GC forzato) | ≈ 0,69 MB (2.762 voci, 4.015 intervalli) | ≈ 2 MiB stimati |
| Apertura delle 26 tessere (con hash) | ≈ 11 ms | — |
| Ricerca per segmento | ≈ 80–83 ns | tipicamente decine di µs per percorso |
| Costruzione (senza la compilazione 4.38 di ≈ 20 s) | ≈ 2,5 s | — |
| CPU del Durable Object | **non misurata**: il motore non legge l'overlay | ≤ +5 %: **da misurare al collegamento** |
| 264 payload del benchmark, prima e dopo | **264/264 identici** (263 × 200, 1 × 422 come prima) | identici |

L'identità dei payload è per costruzione: nessun file di `app/`, `worker/` o `lib/` esistente è cambiato.

## 7. Test e controlli

| Controllo | Esito |
|---|---|
| `tsc --noEmit`, ESLint | 0 errori, 0 avvisi |
| Test 4.39 | 9/9: capacità dalla richiesta, corridoio ≠ riquadro, intervalli, asse lungo/trasversale/lontano, assenza debole, lettore fail-open, bit allineati alla politica, **costruzione end-to-end su un sidecar sintetico** (mappato / cercato e non trovato / sconosciuto, due costruzioni identiche), isolamento dal motore |
| Costruzione su dati reali | Due costruzioni da input identici: **31 file con hash identici** |
| Suite completa (Windows, Node 26) | 507 superati, **23 falliti**, 7 saltati su 537; l'insieme dei falliti è **identico** a quello della 4.38 (stessi nomi), nessun fallimento nuovo. I 23 sono già presenti sulla baseline `3e31da9` su questo host (Node 26 o zlib, CRLF); la CI Linux su Node 24 è il confronto autorevole |
| `git diff --name-only 6fd4908` | Solo file nuovi: nessun percorso di Roma, nessun file della PR #16, nessun dato di produzione |

## 8. Limiti noti di licenza e qualità dei dati

**Licenze (lettura dei testi, non consulenza legale):**
1. L'overlay mescola fatti derivati da OSM (**ODbL 1.0**) e dal DBT/ATM (**CC BY**, CKAN `cc-by`; la versione 4.0 non è riverificata). Se un unico file venisse distribuito pubblicamente, resta aperta la questione della **condivisione alla pari** dell'ODbL. In questa fase non si distribuisce nulla; il manifesto elenca fonti, licenze e attribuzioni.
2. I dati DBT/ATM vanno mantenuti come strato separato con la propria provenienza e **mai scritti in OSM**.
3. Le segnalazioni utente non hanno ancora termini di contributo: **non incluse** (nessuna evidenza «riportata» nel registro).

**Qualità dei dati:**
1. **Il DBT in cache copre solo il riquadro Lodi** (2,2 % dei metri). Il resto della città non ha classi «carreggiata condivisa / sede propria»: sono sconosciute. Il DBT cittadino (3.096 assi) **non è stato acquisito** (§10).
2. DBT è del 2020 (rilievo marzo/aprile); ATM del 24 luglio 2026. Non si sa se i binari di Corso Lodi esistano ancora fisicamente.
3. OSM non ha mappato i binari dove DBT li vede (48 contro 11 segmenti nel riquadro): l'assenza OSM è **debole** per regola.
4. 47 vie tram OSM sono raccordi (`siding`): non vanno lette come binari di strada senza controllo; l'aggancio geometrico (≤ 5 m) può includerli.
5. Il campione Lodi copre solo corridoi attorno a tre vie; fuori da essi, e fuori dai riquadri pilota, i binari sono sconosciuti.
6. L'aggancio ai segmenti usa soglie (5 m, 30°, 50 %) non calibrate su rilievi di campo. Nessun «embedding» (a filo o sporgente) è noto: resta sconosciuto.
7. «Nessuna linea ATM programmata» non vuol dire «binari rimossi».

## 9. Ordine di integrazione e prerequisiti

1. La PR #16 segue il suo percorso (anteprima, collaudo, pilota, unione). **Non è stata toccata.**
2. Rebase di 4.38 e 4.39 su `main` dopo l'unione; si rieseguono benchmark e test.
3. Collegamento **in ombra** (fuori ambito qui): lettura opzionale dell'overlay in `lib/spatial-road-store.ts` e contatori additivi in `diagnostics.sil`, con `mode: off|shadow`; il file `lib/spatial-road-store.ts` è condiviso con Roma e va passato dai test della copia di rilascio solo-Milano.
4. Misura della CPU del Durable Object e del bundle su Cloudflare, con approvazione.
5. Attivazione in produzione: **vietata** finché la copertura non è verificata: i binari sono noti o richiesti solo sul 30,3 % dei metri.

## 10. Che cosa non è stato fatto, e che cosa richiede approvazione

- **DBT dell'intera città:** non acquisito. Servirebbero richieste al servizio REST del Comune (layer 19, assi tram: 3.096 record, poche richieste paginate) e, per la classificazione «condivisa / propria», i poligoni dei layer 39 e 45, molto più grandi (il riquadro Lodi da solo: 730 KB). **Chiedo approvazione** indicando fonte, dimensione e numero di richieste prima di procedere.
- Sopralluoghi, foto con metro, verifica fisica dei binari di Corso Lodi e dell'anello di Piazzale Lodi.
- Nessun overlay per superficie o rugosità (solo binari): la politica P-A/P-B resta una decisione del proprietario.
- Restrizioni di svolta: copertura calcolata, nessun uso.
- Nessuna misura su Cloudflare.

## 11. Riproduzione

```bash
# 1. Sidecar 4.38 con il campione Lodi come gruppo supplementare (percorso del manifesto: lettura)
node scripts/osm/compile-compact-tiles.mjs --output-dir=work/phase439/base-supp --foundation-manifest=<q2-extraction>/milan-citywide-expansion.source.json
# 2. Overlay in ombra (DBT e ATM facoltativi)
node scripts/sil/sil-build.mjs --foundation=work/phase439/base-supp/osm-foundation --tiles=work/phase439/base-supp/milan-tiles \
  --production-tiles=data/surfaces/milan-tiles --dbt-cache=<cache DBT> --atm=<atm-tpl_percorsi.geojson> --output=work/phase439/sil-final
# 3. Misure
node scripts/sil/sil-landmarks.mjs --sil=work/phase439/sil-final --tiles=work/phase439/base-supp/milan-tiles
node scripts/sil/sil-shadow-replay.mjs --sil=work/phase439/sil-final --tiles=work/phase439/base-supp/milan-tiles --cases=outputs/phase425-benchmark/<etichetta>/cases
node --expose-gc scripts/sil/sil-measure.mjs --sil=work/phase439/sil-final --tiles=work/phase439/base-supp/milan-tiles
```
