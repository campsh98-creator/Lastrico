# Phase 4.41 · Urban Map Intelligence

## Copertura misurata

Gli asset derivano dagli estratti OpenStreetMap già presenti nel repository. Il manifest versionato in `public/urban-map/v1` riporta perimetri, date, conteggi e provenienza. Lo script `node scripts/urban-map-build.mjs` riproduce gli asset a partire dagli estratti verificati.

| Estratto | Semafori | Stop | Precedenze | Attraversamenti | Altri segnali | Record di limite |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Milano | 302 | 38 | 206 | 2.045 | 269 | 7.809 |
| Roccella Ionica | 0 | 1 | 0 | 57 | 0 | 33 |
| Roma, estratto stradale | — | — | — | — | — | 16.997 |

Milano centrale e Roccella Ionica hanno estratti per i punti di interesse. Le aree milanesi coperte dai soli estratti stradali e Roma offrono limiti espliciti. I conteggi rappresentano record mappati, inclusi i versi distinti per uno stesso tratto. Gli zero descrivono lo snapshot interrogato. L’assenza effettiva sul terreno richiede un riscontro indipendente.

Liberty rimane la base per strade, geometrie, parchi e toponimi. Le categorie già visibili in Liberty restano disponibili dove il livello locale non le rappresenta. Gli aeroporti provengono dall’etichetta aerodromo di Liberty e dalla ricerca per nome, perché gli estratti locali non contengono aeroporti. La ricerca esplicita riusa Photon e Nominatim e accetta solo risultati riconducibili a tag OSM pertinenti. La disponibilità di ricerca e tile Liberty dipende dai rispettivi servizi pubblici.

Durante la guida vengono mostrati al massimo tre elementi nei prossimi 160 m con progressi GPS validi o simulati. La verifica direzionale usa la geometria e le informazioni OSM disponibili. I limiti concorrenti senza un’associazione sufficientemente precisa vengono omessi. I segnali generici senza verso e associazione alla strada sono consultabili sulla mappa. I semafori indicano la posizione registrata. Attribuzione e licenza sono disponibili nel pannello e nel manifest.

## Prestazioni

Le interrogazioni puntano a tile statiche, con cache LRU da 32 asset e fino a 16 richieste simultanee. Un viewport copre al massimo 12 celle. I luoghi e la segnaletica sono separati, così la consultazione a zoom intermedio e la guida caricano solo il gruppo pertinente. Il navigatore riusa il progresso esistente, aggiorna la selezione ogni 10 m, rivaluta la finestra geografica ogni 100 m e invia dati a MapLibre solo quando cambia l’insieme di elementi imminenti.

A 390×844, sul centro di Milano senza rotazione o inclinazione, i POI pesano circa 111 kB gzip a zoom 13,3 e 81 kB a zoom 14. A zoom 16 i due gruppi pesano circa 115 kB gzip complessivi. Il manifest pesa circa 3 kB gzip. Il parsing dei POI a zoom 13,3 ha richiesto 1,47 ms in mediana e 2,35 ms al 95° percentile su Node desktop. Questi tempi misurano il parsing JSON e non includono latenza di rete, WebGL o lavoro del GPS su un telefono.

Fonti: [OpenStreetMap e licenza](https://www.openstreetmap.org/copyright), [tag traffic_sign](https://wiki.openstreetmap.org/wiki/Key:traffic_sign), [tag maxspeed](https://wiki.openstreetmap.org/wiki/Key:maxspeed), [stile Liberty](https://tiles.openfreemap.org/styles/liberty).

## Verifica mobile

Chromium headless a 390×844 con gli asset OSM del branch e risposte riproducibili per itinerario e geocodifica. Passano l’espansione del cluster, il tocco di un’icona, la ricerca locale, l’indipendenza delle categorie, la scheda di un POI e la selezione come destinazione. In navigazione il test osserva al massimo un watcher GPS, cinque richieste agli asset urbani nell’intero scenario, nessuna richiesta aggiuntiva durante la sequenza di fix nello stesso tratto e la scomparsa degli avvisi alla perdita del fix. Si tratta di un test browser con GPS simulato.

## Revisione sicurezza PR #64

Il matcher distingue la posizione di un semaforo o attraversamento da un’indicazione che si applica a una strada. Uno stop, una precedenza, un segnale o un limite richiede lo stesso ID OSM nel dato sorgente e nel tratto restituito dal provider. Coordinate e verso rimangono controlli di posizionamento. I provider attuali restituiscono geometrie senza questo ID. Le indicazioni stradali interessate sono quindi consultabili come elementi di mappa e omesse in anteprima del percorso e in guida. L’API itinerari conserva le sole ubicazioni dei semafori nel riepilogo legacy.

I POI mantengono una coordinata rappresentativa distinta dall’accesso. Il generatore verifica l’associazione OSM dell’ingresso al luogo, il nodo condiviso con una strada raggiungibile e il verso d’ingresso, applicando le restrizioni motoristiche presenti. Sui 3.598 POI attuali è emerso un solo accesso per auto e moto, al Policlinico di Milano. La scheda dichiara quando l’accesso manca o non è verificato per la bici. In questi casi il pianificatore richiede una scelta manuale. Il dato OSM descrive l’accesso mappato al momento dello snapshot.

Confronto gzip livello 6 sul branch rispetto a `12e496c8`, a parità di tile. I 12 tile POI passano da 116.033 a 116.048 byte, **+15 B**. I 126 tile stradali passano da 948.823 a 951.040 byte, **+2.217 B**. Il tile stradale del centro campionato passa da 51.226 a 52.467 byte, **+1.241 B**. Le dimensioni di questi asset escludono i tempi di rete e il rendering.

Fonti per l’interpretazione dei tag [entrance](https://wiki.openstreetmap.org/wiki/Key:entrance) e [access](https://wiki.openstreetmap.org/wiki/Key:access).
