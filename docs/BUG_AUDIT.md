# Audit iniziale — stabilità della navigazione

Data della baseline: 30 luglio 2026  
Branch: `fix/navigation-stability-and-performance`

## Stato verificato

- Lint: superato.
- Build: superata.
- Test automatici: 24 su 24 superati.
- Avviso di build: alcuni chunk client superano 500 kB minificati.
- La rotta precedente rimane visibile durante un ricalcolo.
- Le risposte di routing hanno già un identificatore locale e vengono scartate se appartengono
  a una sessione di navigazione terminata.

## Problemi prioritari

### P0 — Stato asincrono del ricalcolo non completamente centralizzato

`app/page.tsx` coordina in un unico componente richiesta HTTP, abort, sessione, cooldown,
stato GPS, messaggi e sostituzione della rotta. Le protezioni esistenti sono utili, ma la
combinazione di più ref e flag rende difficile dimostrare che ogni transizione sia atomica.
Mancano test diretti per timeout, retry, risposta obsoleta e un solo ricalcolo autorevole.

Condizione di chiusura: controller puro e testato con ID monotono, sessione, cooldown,
timeout, retry limitato e scarto esplicito delle risposte obsolete.

### P0 — Letture GPS prive di controllo temporale e di velocità plausibile

La lettura viene filtrata per coordinate, accuratezza e area di Milano, ma il timestamp della
posizione non partecipa alla decisione. Un fix vecchio o un salto incompatibile col tempo
trascorso può quindi essere accettato. Il limite di 250 metri applicato al conteggio percorso
riduce il danno contabile, ma non impedisce al marker di saltare.

Condizione di chiusura: rifiuto di letture stale/duplicate e dei salti fisicamente
implausibili, senza bloccare movimento valido.

### P1 — Camera aggiornata a ogni variazione React

Posizione, heading e accuratezza possono invocare `easeTo` con una nuova animazione da 650 ms.
Se i fix arrivano più rapidamente dell’animazione, le transizioni si sovrappongono e possono
produrre jitter. Non esiste ancora una macchina a stati esplicita per overview, follow,
controllo manuale, ricentraggio e arrivo.

Condizione di chiusura: politica camera centralizzata, aggiornamenti limitati e transizioni
testabili.

### P1 — Stile del percorso dipendente dal ciclo iniziale della mappa

Sorgenti, layer e token visivi sono creati direttamente nel componente. Colori e larghezze
sono ripetuti tra creazione e selezione. Lo stile non dispone ancora di un ripristino
idempotente dopo un eventuale reload di MapLibre.

Condizione di chiusura: token e builder centralizzati, rotta attiva verde con casing ad alto
contrasto, installazione idempotente e test di persistenza.

### P1 — Scoring pavé costoso e con confidenza implicita

Ogni segmento della rotta viene confrontato con tutti i segmenti pavé ritenuti rilevanti.
La provenienza OSM è comunicata, ma ogni geometria locale ha di fatto lo stesso peso e la
risposta non espone percentuale nota, copertura o confidenza. `unknown` non viene marcato
come pavé, correttamente, ma non è misurato separatamente.

Condizione di chiusura: indice spaziale leggero, modello di confidenza dichiarato e
diagnostica per candidato con percentuale, deviazione e copertura nota.

### P2 — Componente principale molto concentrato

`app/page.tsx` supera 99 kB e contiene pianificazione, mappa, GPS, voce, segnalazioni e
rendering. Questo aumenta il rischio di regressioni e contribuisce al chunk client grande.

Condizione di chiusura per questa fase: estrarre soltanto logica pura e configurazioni ad alto
valore, senza riscrittura generale dell’interfaccia.

## Limiti della verifica iniziale

- La precisione GPS reale richiede prove su dispositivo e all’aperto.
- I provider pubblici Valhalla, OSRM e Overpass hanno latenza e disponibilità esterne.
- La beta non usa traffico in tempo reale.
- La copertura del fondo stradale dipende dalla qualità dei dati OpenStreetMap disponibili.

