# Lastrico · Fase 4.39b · Copertura DBT cittadina per i binari (offline, in ombra)

- **Data:** 15 novembre 2026. **Base:** commit `bca48c1` (Fase 4.39). Ramo `feat/phase439b-dbt-citywide`, worktree separato `…\Lastrico-phase439b-dbt`.
- **Stato:** implementata e verificata in locale. Nessun push, merge o deploy. Pilota pubblico, PR #16, tessere di produzione, pesi, ordinamento e navigazione **non toccati**: i 264 payload del benchmark sono identici.
- **Decisione:** **GO** per la futura integrazione **in ombra** (dopo l'unione della PR #16 e con le condizioni di §9). **NO-GO** per l'attivazione in produzione e **NO-GO** per distribuire un overlay combinato (§1).
- I binari sono **effetti previsti da dati aperti del 2020 (DBT), del luglio 2026 (ATM) e di OSM**, non verifiche sul posto.

## 1. Audit di licenza (prima di scaricare)

| Fonte | Che cosa dicono i testi | Esito |
|---|---|---|
| **DBT 2020, scheda CKAN DS2889** | `license_id: cc-by` (generico); **risorsa**: `A25_CCBY25IT` = **CC BY 2.5 Italia** | |
| **DBT 2020, servizio REST** | La descrizione del servizio dice «CC-BY 4.0»; `copyrightText: Comune di Milano` | **Incoerenza interna del Comune**: 4.0 contro 2.5 IT. Correggo il report 4.39, che indicava solo «CC BY 4.0» |
| **ATM ds538** | `cc-by`, risorse `A21_CCBY40` = CC BY 4.0 | Coerente |
| **CC BY 2.5 IT** (testo letto oggi) | «Non puoi concedere l'Opera in sublicenza»; una «Collezione di Opere» non è opera derivata; l'«Opera derivata» è un'opera basata sull'Opera | Solo attribuzione, ma **vieta la sublicenza dell'opera**: i dati DBT non vanno ri-licenziati ODbL |
| **ODbL 1.0** (testo letto oggi) | §4.4: una Derivative Database usata **pubblicamente** deve restare ODbL; §4.5: non lo sono le **Collective Databases**, le Produced Works e l'uso **interno** | L'uso interno e offline non ha vincoli di condivisione |

**Conclusioni (lettura dei testi, non consulenza legale):**
1. **Acquisire e usare i dati DBT offline è consentito** (attribuzione «Comune di Milano, Database Topografico 2020»). Il blocco non scatta.
2. **Mescolare i fatti DBT dentro un file ODbL e distribuirlo** rischia la sublicenza vietata dal CC BY 2.5 IT. Mescolare i fatti OSM dentro un file CC BY non risulta ammesso dall'ODbL se il file è usato pubblicamente (§4.4: serve ODbL o una licenza compatibile).
3. Strada prudente: **tre strati separati** (OSM sotto ODbL, DBT con attribuzione, ATM con attribuzione), cioè una *Collective Database*, e mai un unico file fuso. Oggi l'overlay in ombra **fonde** i bit nello stesso file: va bene per l'uso interno, **non** per distribuirlo né per includerlo in un pacchetto pubblico. Il manifesto indica fonte e licenza di ogni evidenza.
4. Da confermare con il Comune: versione esatta (4.0 o 2.5 IT) e testo di attribuzione. Il valore di licenza nel registro è `CC-BY-VERSION-CONFLICT`, con la nota.

## 2. Endpoint, conteggi, dimensioni

Servizio: `https://gisportal.comune.milano.it/federated/rest/services/DBGT/Milano_2020_DBGT/MapServer`, `maxRecordCount` 2000, JSON/GeoJSON/PBF, già descritto dalla ricerca 4.36.

| Livello | Contenuto | Elementi | Scaricato | Richieste |
|---|---|---:|---|---:|
| 19 | Assi tranviari (`EL_TRV`) | **3.094** | tutti, 2,16 MB | 2 |
| 45 | Sede ferroviaria (`SD_FER`), poligoni | 915 | tutti, 1,67 MB | 1 |
| 39 | Aree veicolari (`AC_VEI`), poligoni | 37.892 | **1.843 sotto gli assi** (4,9 %), 5,23 MB | 33 (31 gruppi di 100 assi + 2 prove) |
| 0 | Limite comunale | 145 tratti (106 di Milano) | 0,70 MB | 1 |

- Scaricare tutto il livello 39 sarebbe costato circa 50 MB e almeno 19 richieste (stima 1,3 KB per poligono, misurata su 20): non necessario. Ho scaricato solo i poligoni entro 2 m dagli assi, con richieste POST di 100 assi.
- **37 richieste, tutte HTTP 200**, 9,76 MB, circa 100 s; seriali, almeno 1,3 s tra gli avvii, nessun nuovo tentativo, tetto per esecuzione, cache su disco. Registro in `outputs/phase439b/dbt-acquisition-log.jsonl` (solo UTC, livello, nomi dei parametri, hash, esito, byte). In più 2 pagine pubbliche di licenza.
- **Copertura geografica dichiarata:** il DBT interroga l'intero Comune. L'area «interrogata» è il **confine comunale** ricostruito dai 106 tratti di Milano (un solo anello chiuso, 108,9 km). Fuori da esso il DBT non dice nulla.
- Gli assi sono 274,5 km, tutti «in esercizio» (`el_trv_sta=01`), 44.606 vertici. Nessun binario dismesso è registrato: non vuol dire che non esistano.

## 3. Che cosa è stato costruito

Riuso della pipeline 4.39 (ingestione, copertura, provenienza, overlay deterministico), con:
- `scripts/sil/sil-dbt-fetch.mjs`: acquisizione con tetto, cache e registro (testata con un servizio simulato: budget, cache, nessun nuovo tentativo, paginazione);
- `scripts/sil/sil-dbt-cache.mjs`: lettura verificata della cache (hash di ogni risposta contro il registro), anello comunale, punto-in-poligono indicizzato;
- `scripts/sil/sil-rails.mjs`: classificazione cittadina «carreggiata condivisa / sede propria» con il **codice di specifica** (non le etichette `_d` scambiate), giunzione con mancati agganci;
- `scripts/sil/sil-build.mjs`: area DBT = comune; metriche di qualità; **ottimizzazione**: punto-in-poligono indicizzato e risolutore per via (output **identico byte per byte** alla versione lenta: 122 file; la costruzione è passata da 7 minuti a 5 secondi);
- schema: nuovi valori di licenza (`CC-BY-2.5-IT`, `CC-BY-VERSION-CONFLICT`).
Le tre affermazioni restano **separate** nel registro: DBT (presenza, carreggiata/sede), ATM (solo servizio), OSM (presenza), ciascuna con la sua fonte, data e licenza.

## 4. Copertura: prima e dopo

| Misura | Prima (4.39) | Dopo |
|---|---:|---:|
| Assi tram DBT usati | 36 (riquadro Lodi) | **3.094** (tutto il Comune) |
| Metri compilati con binari «richiesti» da almeno una fonte | 495.959 (30,3 %) | **1.637.718 (99,98 %)** |
| **Sconosciuti per copertura** | 1.142.015 m (69,7 %) | **256 m (19 segmenti)**, fuori dal confine comunale |
| Segmenti con binari DBT lungo la carreggiata | 112 (2,3 km) | **6.458 (106,2 km)** |
| Tratti con evidenza DBT / evidenza ATM sul servizio | 49 / 1.053 | **2.346 / 3.350** |
| Voci dell'overlay / tessere con overlay | 2.762 / 26 | **6.766 / 117** |

**Attenzione al significato:** «richiesti» vuol dire che il DBT 2020 ha un inventario completo degli assi tram del Comune. Dove non c'è asse, il segmento è **«cercato e non mappato»**: **non è prova di assenza**, perché il DBT è del 2020, «frequenza di aggiornamento: non pianificato», e non è dichiarato completo. La regola «assenza da fonte non completa = debole» resta in vigore.

## 5. Nuove evidenze verificate e qualità dell'aggancio

**Nuove (da dati ufficiali, non sul posto):**
- **Carreggiata condivisa 5.583 segmenti** (la maggior parte dei 6.458), sede propria 696, classe sconosciuta 179.
- **Assi per classe:** 1.540 «carreggiata condivisa», 1.277 «sede propria», 277 sconosciuti (241 senza poligono dominante, 18 in entrambi, 14 con POS 01 su carreggiata, 4 con POS 02 su sede).
- **Servizio ATM sulle tratte con binari:** 2.561 in servizio entro 12 m, **789 senza linea programmata**.

**Aggancio (segmenti e assi):**
| Misura | Valore |
|---|---|
| Asse lungo ≥ 50 % del segmento (≤ 5 m, ≤ 30°) | 6.458 segmenti |
| **Giunzioni ambigue:** segmenti con assi di classe diversa | **398** |
| Segmenti con più assi (binario doppio o assi sovrapposti) | 4.256 |
| Quasi-agganci (20–50 %), non marcati | 204 |
| **Assi non agganciati:** metri d'asse entro 5 m da un segmento compilato | carreggiata condivisa **87,0 %** di 151.988 m; sede propria **14,3 %** di 110.290 m (attesi: stanno fuori dalla carreggiata); sconosciuti 40,7 % di 10.778 m; totale 55,8 % di 273.056 m |
| Percorsi del benchmark senza segmento allineato entro 12 m | 6,75 % della lunghezza (invariato) |

Il 13 % circa dei metri d'asse «condivisi» non agganciato (100 % − 87 %) indica tratti dove la rete compilata non ha la carreggiata (per esempio solo pedonale o fuori dal recinto delle strade compilate): da indagare.

**Conflitti fra fonti (dentro il Comune):**
| Esito | Segmenti |
|---|---:|
| Binari in DBT **e** OSM | 2.479 |
| DBT sì; OSM aveva cercato e non ha mappato | **469** |
| DBT sì; OSM non aveva cercato (estrazione storica solo strade) | 3.510 |
| Solo OSM | 142 |
Evidenze di assenza debole generate: 229 tratti dove OSM non vede e DBT sì, 91 dove DBT non vede e OSM sì. Compiti di revisione: **74 P1 (contesi)**, 962 P2 (dissenso debole); 2.278 segmenti da rivedere, 7 contesi.

## 6. Casi noti convalidati

| Via | Segmenti (m) | Binari mappati | Note |
|---|---|---|---|
| **Corso Lodi** | 238 (5.100) | **34 (683 m)** | **Identico** al riquadro 4.39; tutti «carreggiata condivisa»; 33 senza linea ATM; tutti in revisione per il disaccordo con OSM |
| **Piazzale Lodi** | 107 (373) | **0** | Cercati da DBT e dal campione OSM: nessun asse. Non è prova di assenza |
| **Via Lazzaro Papi** | 12 (274) | **0** | Idem |
| **Via Friuli** | 38 (1.244) | 3 (72 m, servizio attivo) | Ora tutta interrogata (prima 13 segmenti sconosciuti) |
| Viale Umbria | 182 (4.475) | **17 (340 m)** | prima 2 (17 m); 15 senza linea ATM: **non spiegato** (il tram 19 corre sulla sede propria, a più di 12 m dalla carreggiata?) |
| Via Fra Cristoforo | 41 (509) | 0 | prima tutta sconosciuta, ora cercata |
| Viale Monte Nero | 103 (2.367) | 29 (652 m) | tutti in servizio |

## 7. Benchmark e decisioni sui percorsi

- **264 casi su 264 identici** al benchmark della 4.39 (263 × 200 e 1 × 422, come prima), con 817 richieste dall'archivio, 0 mancanti.
- Il motore non legge l'overlay (un test lo verifica): nessuna decisione cambia per costruzione e per confronto.
- **Replay in ombra** (526 percorsi, 2.223,6 km): binari mappati **13,74 %** (prima 6,57 %), cercati e non mappati 79,51 %, sconosciuti **0 %** (prima 56,31 %), senza aggancio 6,75 %. 428 percorsi su 526 toccano binari (prima 272). L'alternativa anti-pavé ha **meno** binari mappati in 104 casi su 138 e **più** in 28 (prima 80 e 22): informazione per una decisione futura, **non una decisione**.

## 8. Dimensioni, determinismo, memoria, prestazioni, Workers Free

| Misura | Valore |
|---|---|
| Cache DBT (fuori da Git) | 9,76 MB, 36 risposte |
| Overlay | **158.578 B grezzi / 36.528 B gzip** (117 file), 1,8 % delle tessere base |
| Rispetto al Worker (gzip 3.357,80 KiB; grezzo 13.370 KiB) | **+1,06 %** gzip (+35,7 KiB); ≈ +1,2 % grezzo; limite non compresso Free 64 MiB (da report precedenti) |
| Registro (solo offline, non nel bundle) | 7,2 MB |
| Costruzione | **≈ 5,0 s**, picco di memoria 487 MiB (solo build locale); prima dell'ottimizzazione 7 min |
| Determinismo | Due costruzioni da input identici: **122 file con hash identici** (e identici alla versione non ottimizzata) |
| Heap dopo analisi, 117 tessere | ≈ 1,08 MB (su 128 MB dell'isolate: ≈ 0,8 %) |
| Ricerca per segmento | 65–78 ns |
| Apertura delle 117 tessere (con hash delle tessere base) | 35–45 ms; con hash precalcolati sarebbe molto meno |
| Richieste esterne a runtime | 0; nessun nuovo subrequest |
| CPU del Durable Object | **non misurata** (il motore non legge l'overlay): da misurare al collegamento, obiettivo ≤ +5 % |

**Fattibilità su Workers Free:** compatibile sulla carta (bundle, memoria e CPU di ricerca trascurabili), ma **non verificata su workerd/Cloudflare**.

## 9. Test e controlli

| Controllo | Esito |
|---|---|
| `tsc --noEmit`, ESLint | 0 errori, 0 avvisi |
| Test nuovi `phase439b-dbt` | 7/7: punto-in-poligono indicizzato = test semplice (12.000 punti, con buchi), anello comunale, budget e cache dell'acquisizione, nessun nuovo tentativo, lettore della cache con controllo degli hash, classificazione per codice, quasi-agganci |
| Test 4.39 | 9/9 (invariati, compreso l'isolamento dal motore) |
| Suite completa (Windows, Node 26) | 514 superati, **23 falliti**, 7 saltati su 544; **stesso insieme di falliti** della 4.39 e della 4.38 (già presenti sulla baseline su questo host); nessun fallimento nuovo |
| Diff dal commit `bca48c1` | Solo file nuovi o dello strato SIL: nessun percorso di Roma, nessun file della PR #16, nessun dato di produzione |

## 10. Problemi aperti

1. **Licenza DBT:** versione 4.0 o 2.5 IT? E testo di attribuzione. Da chiedere al Comune.
2. **Overlay fuso:** separare in tre strati (OSM, DBT, ATM) prima di qualsiasi distribuzione o pacchetto pubblico.
3. **DBT del 2020:** nessuna garanzia che i binari esistano ancora; nessun binario dismesso registrato.
4. **789 tratti con binari ma senza linea ATM** (fra cui 15 segmenti di Viale Umbria): cause non verificate (depositi, binari fuori servizio, variazioni).
5. **277 assi di classe sconosciuta** e **398 segmenti con classi miste**: la classificazione per poligoni ha ancora zone grigie.
6. Il **13 % dei metri d'asse condivisi** non ha un segmento compilato entro 5 m.
7. I 3.510 segmenti dove DBT vede binari e OSM non ha mai cercato (estrazione storica solo strade): serve l'estrazione arricchita di OSM per un confronto.
8. Nessun sopralluogo: la presenza fisica, il tipo di incasso (a filo/sporgente) e le condizioni dei binari restano **non verificati**.
9. Restrizioni di svolta: copertura calcolata, nessun uso.

## 11. Raccomandazione: GO / NO-GO per la futura integrazione in ombra

- **GO** (condizionato): collegare in ombra l'overlay al motore con `mode: off|shadow` e contatori in `diagnostics`, **dopo** l'unione della PR #16 e il rebase di 4.38, 4.39 e 4.39b, con nuovo benchmark, misura della CPU del Durable Object su Cloudflare (con approvazione) e passaggio dai test della copia di rilascio solo-Milano per `lib/spatial-road-store.ts` (file condiviso con Roma).
- **Condizioni:** separare i tre strati prima di includerli in un pacchetto pubblico; scrivere l'attribuzione del Comune; non presentare «cercato e non mappato» come «assenti».
- **NO-GO:** attivazione in produzione, penalità o avvisi sui binari, distribuzione di un overlay fuso.

## 12. Riproduzione

```bash
# Acquisizione (37 richieste, tetti e cache; serve la rete)
node scripts/sil/sil-dbt-fetch.mjs --cache=work/dbt-cache --step=axes --max-requests=6
node scripts/sil/sil-dbt-fetch.mjs --cache=work/dbt-cache --step=beds --max-requests=4
node scripts/sil/sil-dbt-fetch.mjs --cache=work/dbt-cache --step=vehicular --max-requests=45 --batch=100
node scripts/sil/sil-dbt-fetch.mjs --cache=work/dbt-cache --step=boundary --max-requests=3
# Overlay in ombra, offline
node scripts/sil/sil-build.mjs --foundation=work/base-supp/osm-foundation --tiles=work/base-supp/milan-tiles \
  --production-tiles=data/surfaces/milan-tiles --dbt-citywide-cache=work/dbt-cache --atm=<atm-tpl_percorsi.geojson> --output=work/sil-city
```
