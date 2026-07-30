# Architettura

## Confini principali

| Area | Responsabilità | File principali |
| --- | --- | --- |
| UI | pianificazione, percorsi, navigazione, comunità | `app/page.tsx`, `components/` |
| Stato GPS | filtro letture, heading, off-route, simulazione | `lib/navigation-state.ts` |
| Istruzioni | tipi e helper puri delle manovre | `lib/navigation-instructions.ts` |
| Routing | alternative, provider, scoring del pavé | `app/api/routes/route.ts` |
| Superfici | dataset OSM incluso e classificazione | `data/milan-pave-central.json`, `app/api/routes/route.ts` |
| Segnalazioni | validazione, privacy, persistenza, export | `app/api/reports/`, `lib/reporting.ts`, `db/` |
| Mappa | rendering MapLibre e sorgenti GeoJSON | `app/page.tsx` |
| Hosting | Worker, D1 e configurazione Sites | `.openai/hosting.json`, `db/`, `drizzle/` |

`app/page.tsx` è ancora il coordinatore principale, ma sheet delle svolte e pannello
Comunità ricevono dati e callback espliciti e non dipendono direttamente da MapLibre.

## Flusso del percorso

1. Il client invia partenza, destinazione, mezzo e livello di evitamento.
2. L’API chiede alternative ai motori compatibili.
3. Le geometrie vengono confrontate con la copertura di pavé conosciuta.
4. L’API restituisce percorso rapido, alternativa anti-pavé, diagnostica e manovre.
5. Il client mantiene il percorso selezionato come esperienza primaria; le app esterne sono
   solo fallback e ricalcolano un percorso proprio.

## Flusso delle segnalazioni

1. Una CTA esplicita abilita la selezione di inizio e fine sulla mappa.
2. Il form invia soltanto il tratto e i campi compilati.
3. Il server limita dimensione e frequenza, rifiuta duplicati recenti, valida area, lunghezza
   e contenuto e salva lo stato `pending`.
4. Le API pubbliche e il CSV espongono soltanto record `verified`; note di moderazione e
   nickname non vengono pubblicati.
5. Le segnalazioni non verificate non modificano automaticamente il routing.

## Privacy

Lastrico non conserva una cronologia GPS. La posizione usata per routing può essere
trasmessa ai provider esterni indicati nella UI. Non aggiungere telemetria di posizione,
identificatori persistenti o dati personali senza una decisione esplicita e documentata.
