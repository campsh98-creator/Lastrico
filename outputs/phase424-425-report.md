# Fasi 4.24–4.25 — Qualità dei dati di Milano e percorsi anti-pavé

7 novembre 2026. Branch `fix/mobile-navigation-stability`. Nessun commit, push, merge o deploy: il pilot resta invariato. Il lavoro su Roma (Fase 4.23) è preservato e i dati di Roma e Roccella non sono stati toccati. Prompt di esecuzione: `outputs/prompt-phase424-425-milan-data-quality-routing.md`.

Tutti i numeri qui sotto vengono dagli script, non sono stati trascritti a mano. Per confrontare PRIMA e DOPO, ogni percorso è stato rimisurato con lo stesso archivio e lo stesso calcolo attuali (il "metro comune"). Così nessun miglioramento apparente nasce solo dal dato più accurato.

## 1. Difetti nei dati trovati e corretti

| Difetto | Effetto | Correzione |
|---|---|---|
| Su strade che l'archivio considera vietate o a senso unico "a orario" per un mezzo (es. **via Manzoni, via Torino**; vie pedonali per la bici), il fondo sotto il percorso veniva contato come "sconosciuto" anche se è pavé | Sui 1.695 percorsi reali del benchmark, per questo motivo restavano sconosciuti 30 km in auto, 13 in moto e 24 in bici; ora meno di 1 km per modalità. Pavé confermato rilevato: auto da 233 a 249 km, bici da 219 a 232 km | Il calcolo usa il fondo della strada su cui il percorso passa davvero (entro 2 m). I controlli di legalità non cambiano. Una strada vicina ma diversa non presta mai il suo fondo |
| `paving_stones` con `smoothness` esplicito excellent/good contato come "pavé probabile" (marciapiedi, piazze, Galleria) | 8,5 km, 177 vie | Ora liscio, perché è il tag esplicito a dirlo |
| Asfalto o cemento con `smoothness` bad o peggio contato come "liscio confermato" | 0,7 km, 13 vie | Ora sconosciuto (le due evidenze si contraddicono) |
| `tracktype=grade1` trattato come asfalto | 0,07 km | Ora sconosciuto: il tag non dice il materiale |
| `cobblestone:rounded` non classificato | 0,05 km (via Sirtori) | Ora pavé confermato |
| 258 spezzoni duplicati al bordo dell'area pilota di ottobre | 6,6 km contati due volte | Rimossi. Rete totale da 1.644,7 a 1.638,0 km |

**Restano invariati e documentati come incerti** (nessun tag esplicito li contraddice):
- `pebblestone` resta pavé: 2,25 km, quasi tutto vialetti nei parchi.
- `surface_bike` resta usato quando manca `surface`: 0,7 km.
- `concrete:plates` resta liscio: 13,4 km.
- `sett` con smoothness good resta pavé: 1,45 km.
- Il generico `paved` resta sconosciuto: 11,5 km.

Le nuove regole valgono solo per Milano (versione "2026-11"). Roma e Roccella mantengono le regole precedenti, così i loro archivi restano riproducibili byte per byte.

**Provenienza.** L'archivio di Milano in produzione si ricostruisce identico dalle fonti OSM con checksum: 117 tile più il manifest, identici byte per byte. Anche il nuovo archivio è riproducibile, e un test lo verifica.

**Abbinamento spaziale.** Ho controllato 1.695 percorsi reali, cioè 8.284 km.
- Il 99,97–100% dei metri di pavé è abbinato alla strada su cui passa il percorso (entro 1,5 m).
- Non ci sono etichette che finiscono su strade parallele: al massimo 99 m per modalità su migliaia di km.
- Restano piccoli effetti agli incroci: casi ambigui intorno all'1% e, dopo la correzione, al più lo 0,6% dei metri di pavé ai capi delle vie.

Dettagli in `outputs/phase424-data-quality/` (`audit.json`, `changed-ways.csv`, `matching-before.json`, `matching-after.json`).

**Dove una verifica sul campo rende di più** (dalla dashboard e dall'uso nei percorsi del benchmark):
- **Pavé confermato più attraversato:** Foro Buonaparte, via Francesco Sforza, corso Magenta, piazza Cordusio, piazza Fontana, via Orefici.
- **Pavé probabile:** via De Amicis, via Molino delle Armi, piazza della Resistenza Partigiana, piazza della Scala, via Santa Margherita, via dell'Orso, via Torino.
- **Sconosciuto:** piazza del Duomo, via Orefici, via Santa Maria alla Porta, piazzale Selinunte, via Carlo Maratta, via Pattari.
- **Asfaltature riportate dalla stampa nel 2025–26, da controllare per prime:** corso Magenta, via Meravigli, via Torino, via Cesare Correnti. Non sono verificate e i dati non sono stati modificati.

## 2. Dataset pubblici valutati

Nessuno è utilizzabile per sapere se una via di Milano è asfalto o pavé. Il dettaglio è in `outputs/phase424-data-quality/public-datasets.md`.
- **Database topografici del Comune (2012, 2020) e della Regione:** il campo "fondo" distingue solo pavimentato e non pavimentato, e a Milano vale sempre "pavimentato".
- **Itinerari ciclabili:** non hanno un campo sul fondo.
- **Avvisi di manomissione** (CC BY): hanno un campo materiale, ma sono pochi punti recenti (3 su 214 dicono "Pietra"), dichiarati dalle aziende e quasi tutti su marciapiede. Al massimo possono segnalare cosa ricontrollare.
- **Strati GIS di AMAT e altri uffici:** sono protetti da credenziali. Servirebbe un accordo con il Comune.

Nessun dataset è stato integrato.

## 3. Copertura di Milano per modalità

| | Rete con fondo noto, prima → dopo | Percorsi del benchmark: tratti sconosciuti, prima → dopo |
|---|---|---|
| Auto | 88,6% → 88,6% | 21,3% → 20,4% |
| Moto | 88,0% → 88,0% | 6,5% → 6,2% |
| Bici | 88,2% → 88,1% | 6,3% → 5,3% |

La copertura della rete non è stata gonfiata: le correzioni oneste la lasciano quasi uguale. Sui percorsi migliora perché il pavé già presente nell'archivio ora viene letto. In auto la quota sconosciuta resta alta soprattutto perché i tragitti lunghi escono dall'area archiviata, sulle tangenziali.

## 4. Benchmark prima e dopo

Il benchmark comprende:
- 88 coppie origine–destinazione × 3 modalità, cioè 264 casi:
  - 14 già validate nelle fasi precedenti;
  - 71 nuove tra centro e periferia, brevi, medie e lunghe;
  - 3 fuori dall'archivio.
- 90 casi con partenza e arrivo spostati di circa 22 m.

Le risposte reali del provider sono registrate, con richieste distanziate di almeno 1,1 s (`outputs/phase425-benchmark/`).

| Misura | PRIMA | DOPO |
|---|---:|---:|
| Percorsi validi e legali | 261/264 | 261/264 (stessi 3 rifiuti bici) |
| Alternative scelte | 130 | 137 |
| Pavé confermato sui percorsi scelti | 56,7 km | **51,8 km (−8,7%)** |
| Pavé confermato evitato rispetto al più rapido | 48,3 km | 52,7 km |
| Pavé probabile evitato | 13,4 km | 12,3 km |
| Tempo extra ogni 100 m di pavé confermato evitato | 29,6 s | 31,1 s |
| Tempo extra totale delle alternative | 14.298 s | 16.421 s |
| Deviazioni inutili | 7 | 1 |
| Alternative che aggiungono pavé confermato | 6 | 0 |
| Quota sconosciuta sui percorsi scelti | 7,7% | 7,7% |
| Casi con molto pavé (≥100 m) che ricevono un'alternativa | 117/154 | 122/154 |
| Esito stabile con coordinate spostate | 71/90 | 70/90 |

**Per modalità, pavé confermato sui percorsi scelti:**

| Modalità | Prima | Dopo | Variazione |
|---|---:|---:|---:|
| Auto | 19,6 km | 17,6 km | −10% |
| Moto | 20,2 km | 18,1 km | −10% |
| Bici | 16,9 km | 16,0 km | −6% |

Le modifiche al calcolo dei percorsi sono due:
1. **Mai più pavé confermato in cambio di pavé probabile.** Prima, per esempio, la bici da Lambrate a Cadorna riceveva +326 m di pavé certo per evitarne di probabile.
2. **Una ricerca di rifinitura.** Si attiva solo quando la ricerca esistente, deviazioni comprese, lascia ancora metà del pavé. Penalizza anche il pavé già visto sugli altri percorsi del provider e aggiunge un candidato senza toglierne nessuno.

Ho confrontato e scartato due varianti che sostituivano la ricerca esistente o venivano prima delle deviazioni. Facevano risparmiare fino a 1,4 km di pavé in più, ma peggioravano più casi già buoni.

## 5. Miglioramenti reali e casi invariati o peggiori

- **22 casi migliorano:** −5,2 km di pavé confermato, per 2.467 s in più in totale.
  - Cordusio–Porta Romana in auto: −720 m.
  - Brera–Darsena in moto: −574 m.
  - Gae Aulenti–Porta Romana in auto: −525 m senza tempo in più.
  - Duomo–Porta Garibaldi in bici: −583 m.
- **235 casi restano invariati.** Questo comprende quasi tutta la periferia, che ha poco pavé.
- **4 casi peggiorano (+249 m in tutto, ma 445 s più veloci):**
  - **Gae Aulenti–Porta Romana in bici:** +173 m di pavé confermato, 195 s più veloce. Dipende dalla correzione dei dati: 189 m di masselli ora risultano lisci, quindi la vecchia ricerca non li evita più.
  - **Duomo–Isola in bici:** +48 m di pavé confermato, −155 m di probabile e +151 m di sconosciuto.
  - **San Siro–Città Studi in auto e in moto:** +14 m ciascuno, entro il margine di misura, 104 s più veloci.
- **Restano senza alternativa utile 23 casi con molto pavé (erano 29).** Spesso partenza o arrivo sono dentro zone di pavé, come Duomo–Brera e Missori–Crocetta in auto. Lì un'alternativa non esiste.
- **Stabilità invariata.** L'instabilità con coordinate spostate dipende soprattutto dal provider, che cambia il percorso rapido (13 casi su 90). Restano 9 casi, quasi tutti in bici in centro, in cui cambia la scelta di Lastrico.

## 6. Test e prestazioni

**Test e verifiche (tutto superato):**
- 371 test automatici su 371, più 62 test della dashboard e dell'esperimento di ranking.
- TypeScript e ESLint senza errori.
- Build di produzione e dry-run di Wrangler riusciti.
- Browser mobile: 63 scenari simulati su 63; 3 viaggi reali su 3 (Milano in auto e in bici, Roccella in auto) con ricerca, percorso, navigazione, ricalcolo e riavvio.
- Un percorso di Roma calcolato correttamente sul Worker locale.

**Prestazioni:**
- **Calcolo** (CPU di Node, senza rete, 21 casi pesanti): a freddo la mediana passa da 220 a 213 ms; a caldo da 71 a 67 ms. La coda a caldo sale da 455 a 506 ms. Non è una misura della CPU Cloudflare.
- **Chiamate al provider per richiesta:** in media da 2,58 a 2,87 (+11%). Il massimo sale da 5 a 6, e 70 casi su 264 arrivano a 6 chiamate.
- **Worker locale con provider reale** (13 richieste, tempo misurato dentro il calcolo): la mediana resta a 2,3 s; la coda sale da 4,3 a 5,3 s. I tempi visti dal client nel secondo giro sono gonfiati dai riavvii del server locale, causati dalla sincronizzazione dei file appena ricompilati nella cartella Documenti. Non è un effetto dell'app.
- **Bundle del Worker:** 67,73 MiB non compressi (gzip 13,05 MiB). **Supera ancora il limite Cloudflare di 64 MiB a causa di Roma.** I dati di Milano sono scesi di circa 20 KB. Roma non è stata rimossa.

## 7. Limiti residui

- **"Confermato" vuol dire tag OSM, non rilievo sul campo.** Alcune vie del centro potrebbero essere state asfaltate dopo l'ultimo aggiornamento dei tag.
- **Legalità solo parziale:** su ZTL, permessi e divieti di svolta conta quello che sa il provider.
- **Latenza:** in circa un quarto delle richieste con molto pavé la risposta richiede circa 1–1,5 s in più. Il carico sul servizio pubblico di routing cresce dell'11%.
- **Mancano CPU e memoria reali su Cloudflare e una prova fisica su iPhone.**
- **Le regole corrette non sono ancora applicate a Roma e Roccella.** Serve una ricompilazione separata.

## 8. GO/NO-GO

- **NO-GO per pubblicare l'albero attuale così com'è:** con Roma il bundle supera i 64 MiB.
- **GO per un rilascio pilota separato delle sole modifiche di Milano, alle condizioni seguenti:**
  1. una build senza Roma, oppure dopo aver ridotto il pacchetto di Roma;
  2. la tua autorizzazione esplicita;
  3. uno smoke test in produzione con controllo di CPU e latenza;
  4. un giro di verifica su iPhone.

## Riproduzione (offline, nessuna pubblicazione)

```sh
node --max-old-space-size=6144 scripts/osm/compile-compact-tiles.mjs       # archivio Milano (regole 2026-11)
node --max-old-space-size=6144 scripts/osm/audit-milan-surfaces.mjs        # audit regole e copertura
node --max-old-space-size=6144 scripts/osm/audit-milan-matching.mjs --label=after
node --max-old-space-size=6144 scripts/benchmark-milan-routing.mjs --label=after   # replay delle risposte registrate
node scripts/analyze-milan-benchmark.mjs before after --yardstick
node scripts/measure-milan-latency.mjs --label=after
```

Le cartelle `before` e `data` del benchmark sono state registrate con il codice e i dati di partenza (copia di lavoro fuori dal repository). Le varianti scartate sono in `variant-corridor-first` e `variant-refine-before-detours`.
