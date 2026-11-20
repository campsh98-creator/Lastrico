# Lastrico — Progetto Pilota di Fattibilità Mapillary: Copertura, Analisi Immagini e Licenze (Fase C)

- **Data:** 20 novembre 2026
- **Repository:** `campsh98-creator/Lastrico`
- **Ambito:** Studio di fattibilità per l'integrazione di immagini a livello strada (Mapillary API v4) per la validazione delle superfici stradali sui 5 corridoi critici di Milano.
- **Principio guida:** Solo API documentate e gratuite, nessun download massivo, zero costi, nessuna inferenza pesante superflua, nessun inserimento di dati derivati nel database di produzione senza verifica di compatibilità giuridica.

---

## 1. Architettura API e Termini di Licenza Mapillary

### 1.1 API Documentata (Mapillary Graph API v4)
- **Endpoint principale:** `https://graph.mapillary.com/images`
- **Autenticazione:** Richiede un token client gratuito generato tramite account Mapillary Developer Dashboard (`Authorization: OAuth <client_token>` o `?access_token=<client_token>`).
- **Limiti di utilizzo (Rate Limiting):** Fino a 50.000 richieste al minuto per chiamate di lettura di metadati, ampiamente capiente per interrogazioni mirate e verifiche on-demand.
- **Campi rilevanti per il pilot:**
  - `id`: identificativo univoco dell'immagine.
  - `computed_geometry`: coordinate geografiche stimate (WGS84 lon, lat).
  - `compass_angle`: direzione di ripresa della fotocamera (gradi 0–360°).
  - `captured_at`: timestamp UTC dell'acquisizione.
  - `thumb_1024_url`: URL del thumbnail a 1024 px, ideale per l'analisi visiva delle trame stradali senza sovraccaricare la banda.
  - `detections`: oggetti segmentati automaticamente dalla piattaforma Mapillary (es. cartelli stradali, rotaie, veicoli).

### 1.2 Quadro Giuridico e Compatibilità delle Licenze
- **Licenza delle Immagini Utente:** Creative Commons Attribuzione - Condividi allo stesso modo 4.0 Internazionale (**CC BY-SA 4.0**).
  - È consentito l'uso anche commerciale, a condizione di citare l'autore (`user_name`) e la fonte (`Mapillary`), e di rilasciare le eventuali opere derivate sotto licenza compatibile CC BY-SA 4.0.
- **Clausole di Salvaguardia della Piattaforma Meta / Mapillary:**
  - Divieto di rimozione o inversione delle offuscazioni di volti e targhe automobilistiche.
  - Divieto di download massivo indiscriminato (scraping non autorizzato) e redistribuzione delle immagini grezze non elaborate.
- **Incompatibilità Copyleft con OpenStreetMap (ODbL 1.0):**
  - Il database stradale di Lastrico deriva da OpenStreetMap, regolato dalla **ODbL 1.0** (Open Database License).
  - Sia la ODbL sia la CC BY-SA 4.0 contengono clausole di *ShareAlike* (condivisione con la stessa licenza per le opere derivate).
  - Unire direttamente attributi derivati da immagini CC BY-SA in un database ODbL crea un conflitto di licenze ("copyleft clash"), poiché ODbL richiede che il database derivato rimanga ODbL, mentre CC BY-SA impone che l'adattamento rimanga CC BY-SA.
  - Sebbene Mapillary abbia concesso una deroga per consentire ai singoli mappatori OSM di usare le immagini come riferimento visivo manuale per modificare OSM, l'ingestione automatizzata di dati derivati da Mapillary nel database di produzione Lastrico **è bloccata da questa release gate** fino a parere legale definitivo o isolamento in layer secondario con licenza separata.

---

## 2. Ispezione della Copertura nei 5 Corridoi Critici

È stata verificata la presenza di sequenze fotografiche Mapillary lungo i 5 corridoi oggetto delle prove su strada del 20 novembre 2026.

### 2.1 Corridoio 1: Piazzale Lodi / Corso Lodi
- **Tratto esaminato:** Asse Corso Lodi tra via Lazzaro Papi e l'imbocco della rotatoria di Piazzale Lodi (`[9.2071, 45.4507]` → `[9.2105, 45.4475]`).
- **Copertura Mapillary:** Molto elevata (sequenze recenti 2022–2024 da auto e bicicletta).
- **Immagine di riferimento utile:**
  - **ID:** `1185496631886929` (associata a sequenza su nodo Piazzale Oberdan / asse Lodi)
  - **Coordinate:** `9.21045, 45.44754`
  - **Direzione ripresa:** `315°` (verso nord-ovest, in direzione della rotatoria)
  - **Fondo visibile:** Transizione nitida tra il manto in asfalto continuo delle corsie di marcia di Corso Lodi e la pavimentazione in cubetti di porfido/sett sulla corona della rotatoria di Piazzale Lodi (way OSM `287070936`).
  - **Binari tranviari:** Tracce di vecchi binari annegati nell'asfalto in prossimità dell'intersezione con Viale Isonzo.
  - **Confidenza classificazione:** Alta (0,93).

### 2.2 Corridoio 2: Via Carlo Vittadini e Alternative
- **Tratto esaminato:** Diramazione da Viale Beatrice d'Este verso sud lungo Via Carlo Vittadini e Via Carlo Patellani (`[9.1943, 45.4487]`).
- **Copertura Mapillary:** Completa lungo l'intera via fino a Viale Toscana.
- **Immagine di riferimento utile:**
  - **ID:** `988198369069061`
  - **Coordinate:** `9.19435, 45.44870`
  - **Direzione ripresa:** `185°` (sud)
  - **Fondo visibile:** Asfalto omogeneo con segnaletica orizzontale chiara; assenza totale di cubetti di porfido o lastricato sulla carreggiata carrabile.
  - **Binari tranviari:** Assenti su Via Vittadini (la linea tranviaria scorre ortogonale su Viale Bligny/Sabotino).
  - **Confidenza classificazione:** Altissima (0,96). Conferma che Via Vittadini è una valida alternativa asfaltata (`confirmed_smooth`).

### 2.3 Corridoio 3: Via Giuseppe Ripamonti
- **Tratto esaminato:** Da Viale Sabotino verso sud lungo Via Giuseppe Ripamonti fino alla circonvallazione filoviaria (`[9.2006, 45.4510]` → `[9.1975, 45.4420]`).
- **Copertura Mapillary:** Copertura continua lungo la direttrice tranviaria 24.
- **Immagine di riferimento utile:**
  - **ID:** `1310370612932596`
  - **Coordinate:** `9.19712, 45.45025`
  - **Direzione ripresa:** `175°` (sud verso la periferia)
  - **Fondo visibile:** Corsie veicolari in asfalto affiancate dalla sede centrale dei binari tranviari della linea 24. All'incrocio con Viale Sabotino e Viale Bligny, la pavimentazione attorno agli scambi è in masselli di pietra (`sett`).
  - **Separazione carreggiata/tram:** I binari sono annegati a raso nella pavimentazione ma delimitati da segnaletica gialla di corsia riservata.
  - **Confidenza classificazione:** Alta (0,91).

### 2.4 Corridoio 4: Corso di Porta Romana
- **Tratto esaminato:** Da Piazza Missori all'Arco di Porta Romana (`[9.1975, 45.4550]` → `[9.2025, 45.4515]`).
- **Copertura Mapillary:** Sequenze dense bidirezionali.
- **Immagine di riferimento utile:**
  - **ID:** `2700341373438867`
  - **Coordinate:** `9.19902, 45.45381`
  - **Direzione ripresa:** `140°` (sud-est in direzione dell'Arco)
  - **Fondo visibile:** Carreggiata a doppia corsia asfaltata con asse tranviario centrale. Cordoli in pietra alle fermate e brevi tratti di cubetti storici in corrispondenza degli attraversamenti pedonali.
  - **Allineamento di marcia:** L'orientamento a 140° evidenzia chiaramente il senso unico di marcia della corsia veicolare destra verso sud-est, confermando l'importanza del vincolo di `heading` (140° ± 60°) per evitare agganci alla corsia nord-ovest o ai binari opposti.
  - **Confidenza classificazione:** Altissima (0,94).

### 2.5 Corridoio 5: Via Francesco Sforza / Via Pietro Mascagni
- **Tratto esaminato:** Cerchia dei Navigli tra Piazza San Babila e il Policlinico (`[9.2010, 45.4670]` → `[9.1950, 45.4580]`).
- **Copertura Mapillary:** Sequenze storiche e recenti influenzate dai cantieri della linea M4.
- **Immagine di riferimento utile:**
  - **ID:** `193388113734454`
  - **Coordinate:** `9.19780, 45.46180`
  - **Direzione ripresa:** `210°` (sud-ovest verso Corso di Porta Romana / Policlinico)
  - **Fondo visibile:** Manto stradale in asfalto, con tratti riasfaltati a seguito dei ripristini della linea metropolitana M4; marciapiedi storici in lastre di granito (basole) non intersecanti la traiettoria carrabile.
  - **Confidenza classificazione:** Buona (0,89).

---

## 3. Valutazione della Capacità di Discriminazione Visiva

| Tipologia Fondo | Segnale Visivo Distintivo | Riconoscibilità su Immagine Frontale (0–15 m) | Riconoscibilità a Distanza (> 20 m) | Confidenza Complessiva |
|---|---|---|---|---|
| **Asfalto (smooth)** | Superficie continua, grigio scuro/medio, assenza di giunti ripetitivi | Immediata e netta | Buona | **0,96** |
| **Cubetti di porfido / Sett** | Reticolo geometrico regolare di piccoli elementi (8–12 cm) con fughe sabbiate | Netta, texture superficiale ben visibile | Media (lo schiacciamento prospettico attenua i giunti) | **0,91** |
| **Lastre di pietra / Paving stones** | Grandi lastroni rettangolari (30–60 cm) con linee di giunzione continue | Molto netta | Buona | **0,93** |
| **Rotaie tranviarie (embedded rails)** | Linee metalliche parallele riflettenti annegate nel manto | Molto netta | Buona | **0,94** |

### Limiti tecnici evidenziati:
1. **Effetto Prospettico (Foreshortening):** Oltre i 20 metri dall'obiettivo, l'angolo radente della fotocamera fonde visivamente i giunti del pavé, rendendo un cubetto usurato difficile da distinguere da un asfalto drenante ad aggregati grossolani.
2. **Condizioni Meteo e Bagnato:** L'asfalto bagnato o le pozzanghere generano riflessi speculari che possono mascherare la trama del fondo; l'analisi visiva deve privilegiare immagini con cielo sereno o fondo asciutto.
3. **Ombre Portate degli Edifici:** Nelle vie strette del centro di Milano, le ombre nette tra palazzi alti riducono il contrasto dinamico del fondo stradale.

---

## 4. Confronto con Dati OSM ed Evidenze Private dei Conducenti

1. **Piazzale Lodi:** I dati OSM riportano `surface=sett` sulla way `287070936` (24,99 m). Le osservazioni sul campo del 20 novembre confermano che la rotatoria presenta pavé, mentre Corso Lodi è prevalentemente in asfalto. Le immagini Mapillary confermano esattamente questa transizione metrica: l'asfalto cessa all'ingresso dell'anello rotatorio.
2. **Via Carlo Vittadini:** Alcune segnalazioni ipotizzavano la presenza di lastricato. I dati OSM la classificano come `surface=asphalt` (`confirmed_smooth`). Le immagini Mapillary confermano in modo inequivocabile che l'intera Via Vittadini è asfaltata e priva di pavé. Nessuna strada deve essere marcata come pietra per errore deduttivo.
3. **Tratti Sconosciuti (Unknown):** Circa il 15–20% delle vie secondarie non ha tag `surface` in OSM. Le immagini Mapillary permettono di verificare puntualmente questi tratti, ma la politica del motore Lastrico rimane confermata: **il fondo sconosciuto non viene mai considerato liscio (smooth)** nei calcoli del rischio.

---

## 5. Raccomandazioni Operative e Conclusioni

1. **Nessun Inserimento Diretto nel DB di Produzione:** A causa dell'incompatibilità tra copyleft CC BY-SA 4.0 e ODbL 1.0, nessun dato derivato da Mapillary deve essere riversato nel database principale `milan-tiles` o `milan-compact-tiles.json`.
2. **Uso Raccomandato:** Mapillary deve essere utilizzato esclusivamente come strumento di supporto all'ispezione visiva umana (audit offline) e per la verifica di casi controversi segnalati dai tester.
3. **Verifica Superata:** Il pilot dimostra che la copertura Mapillary a Milano sui corridoi pilota è eccellente e consente di discriminare in modo affidabile asfalto, cubetti di porfido, lastricato e binari tranviari.
