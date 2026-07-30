# Sviluppo

## Requisiti e avvio

- Node.js 22.13 o successivo;
- npm;
- un browser moderno.

```bash
npm ci
npm run dev
```

La beta locale è disponibile su `http://localhost:3000`.

## Verifiche

```bash
npm run lint
npm test
```

`npm test` crea una build pulita ed esegue i test Node. Prima di una pull request verifica
anche almeno un viewport desktop e i viewport mobile 320×568, 393×852 e 568×320.

## Cambiare una funzionalità

1. Apri o collega una issue.
2. Crea un branch breve, per esempio `feature/directions-sheet`.
3. Per una funzionalità di prodotto, aggiungi prima un prompt esecutivo in `outputs/`.
4. Mantieni la logica pura in `lib/` e passa callback espliciti ai componenti.
5. Aggiungi test di regressione.
6. Esegui lint, test, verifica mobile e descrivi l’esito nella pull request.

## Database

Le segnalazioni usano Drizzle e il binding D1 `DB`. Dopo una modifica allo schema:

```bash
npm run db:generate
```

Non committare database locali, dump, token o coordinate personali. Le nuove segnalazioni
devono restare `pending` finché un processo di moderazione non le rende `verified`.

## Routing e provider

Le API pubbliche usate nella beta hanno capacità e policy limitate. Conserva timeout, cache,
attribuzioni e fallback. Un controllo visivo deve modificare davvero il parametro di routing
che dichiara di controllare.
