# Contribuire a Lastrico

Grazie per voler migliorare Lastrico.

## Prima di iniziare

- Controlla che non esista già una issue equivalente.
- Per pavé o dati stradali usa il template dedicato.
- Non inserire dati personali o informazioni che possano identificare gli spostamenti di una persona.
- Ricorda che una segnalazione comunitaria non è automaticamente un dato verificato.

## Modifiche al codice

1. Installa Node.js 22.13 o successivo ed esegui `npm ci`.
2. Crea un branch descrittivo: `fix/…`, `feature/…`, `docs/…` o `data/…`.
3. Per una nuova funzionalità, descrivi prima scope, limiti, acceptance criteria e test in
   un prompt sotto `outputs/`.
4. Mantieni l’interfaccia mobile accessibile e i controlli durante la guida grandi e
   sinceri rispetto alla funzione sottostante.
5. Aggiungi o aggiorna i test.
6. Esegui `npm run lint` e `npm test`.
7. Verifica almeno 320×568, 393×852, 568×320 e un viewport desktop.
8. Spiega nella pull request cosa cambia, come è stato verificato e gli eventuali limiti.

Consulta [docs/development.md](docs/development.md) per il flusso completo e
[docs/architecture.md](docs/architecture.md) per scegliere il modulo corretto.

## Pull request

- Mantieni una pull request focalizzata su un unico problema.
- Non includere refactoring non necessari o dipendenze senza motivazione.
- Aggiungi screenshot per cambiamenti visivi.
- Segnala qualsiasi impatto su privacy, routing, GPS, moderazione o servizi esterni.
- Non considerare completata una funzione dopo la sola compilazione: servono test e verifica
  del comportamento mobile.

Le issue adatte ai primi contributi useranno `good first issue`; quelle che richiedono aiuto
esterno useranno `help wanted`. Le aree principali sono `data`, `navigation` e `ux`.

## Principi del prodotto

- sicurezza e semplicità durante la guida;
- trasparenza sui limiti dei dati;
- nessuna promessa di copertura totale;
- raccolta minima dei dati personali;
- compatibilità con infrastruttura gratuita soltanto per la fase beta.

## Licenza dei contributi

Il codice inviato sarà distribuito con licenza MIT. Per dati derivati da OpenStreetMap
mantieni attribuzione e condizioni ODbL. Non inviare materiale con licenza incompatibile.
