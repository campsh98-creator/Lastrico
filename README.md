# Lastrico — Milano senza sobbalzi

![Lastrico social preview](public/og.png)

Lastrico è una PWA sperimentale che confronta il percorso automobilistico più rapido con un’alternativa che riduce le strade in pavé e sanpietrini conosciute a Milano.

La beta permette anche di segnalare tratti mancanti, strade sconnesse, pavimentazioni appena asfaltate ed errori nei dati.

**Ideato e creato da [Domenico Campanella Scali](https://github.com/campsh98-creator).**

**Beta:** [lastrico-milano.cscda39.chatgpt.site](https://lastrico-milano.cscda39.chatgpt.site)

> Lastrico non garantisce un percorso completamente asfaltato. La copertura dipende dai dati disponibili e i tempi non includono il traffico in tempo reale.

## Cosa funziona

- partenza e destinazione libere;
- geocoding degli indirizzi nell’area di Milano;
- selezione dei punti direttamente sulla mappa;
- posizione GPS come partenza;
- confronto tra percorso rapido e percorso anti-pavé;
- tre livelli di evitamento;
- ricalcolo manuale e ricalcolo GPS sperimentale;
- navigazione GPS in primo piano, separata dalla simulazione automatica;
- elenco completo delle svolte con manovra corrente evidenziata;
- guida vocale facoltativa e persistente, disattivata per impostazione iniziale;
- metri di pavé conosciuto, minuti e distanza stimati;
- evidenziazione dei tratti critici;
- segnalazioni comunitarie persistenti con revisione prima della pubblicazione;
- esportazione CSV dei soli contributi verificati;
- installazione su iPhone come web app.

## Prova su iPhone

1. Apri la beta in Safari.
2. Tocca **Condividi**.
3. Seleziona **Aggiungi alla schermata Home**.
4. Attiva **Apri come app web**.
5. Concedi la posizione soltanto quando avvii un test GPS.

La PWA non compare direttamente sul display CarPlay. Una vera integrazione richiederà un’app iPhone nativa, navigazione turn-by-turn e l’autorizzazione CarPlay Navigation di Apple.

## Architettura

| Area | Tecnologia |
| --- | --- |
| Interfaccia | React 19, Next.js/vinext, TypeScript |
| Mappa | MapLibre GL JS con stile vettoriale OpenFreeMap |
| Dati cartografici | OpenStreetMap e OpenFreeMap |
| Routing beta | Valhalla pubblico con fallback OSRM per auto |
| Superfici | dataset OSM incluso e tag `surface` |
| Ricerca indirizzi | Nominatim |
| Segnalazioni | Cloudflare D1 e Drizzle ORM |
| Distribuzione | PWA e Cloudflare Worker tramite Sites |

```text
iPhone / browser
       │
       ▼
Lastrico PWA ──► geocoding Nominatim
       │
       ├──────► alternative Valhalla / OSRM
       ├──────► superfici OSM incluse
       └──────► segnalazioni D1
```

## Sviluppo locale

Requisiti:

- Node.js 22.13 o successivo;
- npm.

```bash
npm install
npm run dev
```

L’app viene esposta su `http://localhost:3000`.

Per creare la build:

```bash
npm run build
```

Per eseguire tutte le verifiche:

```bash
npm run lint
npm test
```

Approfondimenti: [architettura](docs/architecture.md), [sviluppo](docs/development.md),
[governance](GOVERNANCE.md) e [roadmap](ROADMAP.md).

Per rigenerare le migrazioni dopo modifiche allo schema:

```bash
npm run db:generate
```

Il database D1 locale deve essere inizializzato con la migrazione presente in `drizzle/`. Il binding logico usato dall’app è `DB`.

## Limiti della beta gratuita

I servizi pubblici di Nominatim, Valhalla, OSRM e OpenFreeMap sono adatti soltanto a test con pochi utenti e richieste moderate. Non costituiscono un’infrastruttura commerciale gratuita e illimitata.

Le segnalazioni nuove vengono salvate come `pending`, non sono esposte dall’API pubblica o dal CSV finché non vengono verificate e non modificano automaticamente il routing.
Le note inviate servono alla moderazione e non vengono pubblicate nell’API o nel CSV.

Lastrico non salva una cronologia continua della posizione GPS.

La navigazione GPS richiede HTTPS, il permesso di posizione precisa e l’app aperta in primo piano. iOS può sospendere la PWA quando lo schermo viene bloccato o quando si passa a un’altra app. Il ricalcolo è sperimentale e richiede una connessione dati.

## Roadmap

Le priorità correnti sono la validazione su strada, la qualità dei dati, la moderazione, i
test mobile e soltanto in seguito un’esperienza iPhone nativa. Leggi [ROADMAP.md](ROADMAP.md)
per il dettaglio.

## Contribuire

Leggi [CONTRIBUTING.md](CONTRIBUTING.md). Il repository GitHub pubblico è in preparazione;
fino alla pubblicazione la beta resta consultabile dal link sopra. Potrai aprire una
segnalazione per:

- pavé mancante o dato errato;
- problema di routing;
- problema dell’interfaccia mobile;
- proposta per la beta.

## Privacy e sicurezza

Non pubblicare indirizzi personali, targhe, dati di localizzazione precisi riferiti a persone o credenziali. Per problemi di sicurezza segui [SECURITY.md](SECURITY.md).

## Licenza

Codice distribuito con licenza [MIT](LICENSE). I dati OpenStreetMap restano soggetti alla licenza e all’attribuzione dei rispettivi titolari.
