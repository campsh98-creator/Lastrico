# Lastrico — Milano senza sobbalzi

![Lastrico social preview](public/og.png)

Lastrico è una PWA sperimentale che confronta il percorso automobilistico più rapido con un’alternativa che riduce le strade in pavé e sanpietrini conosciute a Milano.

La beta permette anche di segnalare tratti mancanti, strade sconnesse, pavimentazioni appena asfaltate ed errori nei dati.

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
- metri di pavé conosciuto, minuti e distanza stimati;
- evidenziazione dei tratti critici;
- segnalazioni comunitarie persistenti;
- esportazione CSV dei contributi;
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
| Mappa | MapLibre GL JS |
| Dati cartografici | OpenStreetMap |
| Routing beta | OSRM pubblico |
| Superfici | Overpass API e tag OSM `surface` |
| Ricerca indirizzi | Nominatim |
| Segnalazioni | Cloudflare D1 e Drizzle ORM |
| Distribuzione | PWA e Cloudflare Worker tramite Sites |

```text
iPhone / browser
       │
       ▼
Lastrico PWA ──► geocoding
       │
       ├──────► alternative OSRM
       ├──────► superfici Overpass / OSM
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

Per rigenerare le migrazioni dopo modifiche allo schema:

```bash
npm run db:generate
```

Il database D1 locale deve essere inizializzato con la migrazione presente in `drizzle/`. Il binding logico usato dall’app è `DB`.

## Limiti della beta gratuita

I servizi pubblici di Nominatim, OSRM, Overpass e le tile OpenStreetMap sono adatti soltanto a test con pochi utenti e richieste moderate. Non costituiscono un’infrastruttura commerciale gratuita e illimitata.

Le segnalazioni nuove vengono salvate come `pending`, restano separate dai dati verificati e non modificano automaticamente il routing.

Lastrico non salva una cronologia continua della posizione GPS.

## Roadmap

1. Validare 10–15 tragitti reali a Milano.
2. Migliorare moderazione e copertura dei dati.
3. Introdurre istruzioni turn-by-turn e avvisi audio.
4. Creare l’app iPhone nativa.
5. Richiedere ad Apple l’entitlement `com.apple.developer.carplay-maps`.
6. Testare e distribuire l’esperienza CarPlay.

## Contribuire

Leggi [CONTRIBUTING.md](CONTRIBUTING.md). Puoi aprire una segnalazione per:

- pavé mancante o dato errato;
- problema di routing;
- problema dell’interfaccia mobile;
- proposta per la beta.

## Privacy e sicurezza

Non pubblicare indirizzi personali, targhe, dati di localizzazione precisi riferiti a persone o credenziali. Per problemi di sicurezza segui [SECURITY.md](SECURITY.md).

## Licenza

Codice distribuito con licenza [MIT](LICENSE). I dati OpenStreetMap restano soggetti alla licenza e all’attribuzione dei rispettivi titolari.
