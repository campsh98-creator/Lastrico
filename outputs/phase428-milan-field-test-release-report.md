# Fase 4.28 — Rilascio pilota di Milano per la prova su strada

7 novembre 2026. Prompt di esecuzione: `outputs/prompt-phase428-milan-field-test-release.md`.

## 1. Cosa è online

- **Pilota:** https://lastrico-pilot.campsh.workers.dev, versione **`03a6776e-cc36-4f87-a963-e0bd0592c906`** (7 novembre 2026, 19:47 UTC).
- **Versione precedente, cioè il punto di ripristino:** `bf3e13d5-51be-41a8-95d9-e72462c69053`. È il rilascio solo Milano della Fase 4.26, del 7 novembre alle 14:50 UTC.
- **Contenuto:** la versione già pubblicata (`66bdccd`) più i due commit di Milano `cb8fbbe` e `69678e3`, cioè la bici che si spinge a piedi sui tratti pedonali all'inizio o alla fine e i relativi resoconti.
- **Roma non c'è.**
  - La copia di rilascio è stata ricavata con `git archive`, senza branch, worktree o modifiche alla storia Git.
  - Differisce dal branch locale esattamente nei 642 file toccati dai 4 commit di Roma, e in nessun altro.
  - Nel pacchetto non ci sono moduli, dati o stringhe di Roma. Online, una richiesta per Roma viene rifiutata (HTTP 400) e il menu delle città non la elenca.
- **Git:** i 4 commit di Roma e i 2 di Milano sono intatti e solo locali. `origin` resta a `66bdccd`: nessun push, nessun merge.

## 2. Verifiche prima della pubblicazione (copia di rilascio)

- TypeScript ed ESLint senza errori.
- **367 test su 367**: i 376 meno quelli di Roma.
- Build riuscita. Pacchetto **12,89 MiB**, contro il limite di 64.
- **Prova mobile** su Worker locale, Chrome emulato, temi chiaro e scuro: **71 scenari su 71**.
  - Il server locale di sviluppo si è bloccato durante la prima esecuzione, a scenari 25/71 superati. Gli altri 46 sono stati ripetuti dopo il riavvio e sono passati tutti.
  - Gli scenari coprono:
    - ricerca indirizzi;
    - scelta del percorso;
    - stati del GPS (attesa, segnale debole, fuori percorso, permesso negato);
    - voce;
    - ricalcolo;
    - arrivo, anche con precisione di ±35 m;
    - impaginazione su 8 formati di schermo.
- **Percorsi reali sul Worker locale:** Milano in auto e in bici, Roccella in auto e in moto, con ricalcolo e riavvio. Centrale → Piazza Fontana in bici ha l'avviso «scendi e prosegui a piedi».

## 3. Verifiche dopo la pubblicazione (HTTPS)

- **Smoke test: 18 su 18.** Comprendono:
  - pagina e risorse dell'app;
  - ricerca indirizzi;
  - Auto, Moto e Bici a Milano e Roccella;
  - avvio della navigazione;
  - rifiuto pulito degli input sbagliati.
- **Prova mobile completa sulla versione pubblicata: 71 scenari su 71.**
- **Percorsi con molto pavé**, impostazione "Forte": 6 casi su 6 identici al benchmark. Esempi:
  - Cordusio → Porta Romana in auto: da 1,91 a 0,67 km di pavé confermato;
  - Corvetto → Duomo in auto: da 2,48 a 0,69 km.
- **Bici Centrale → Piazza Fontana:** percorso con l'alternativa (da 731 a 298 m di pavé confermato) e l'indicazione di 91 m da fare a piedi.
- **Tempo di calcolo su Cloudflare** (42 richieste di percorso):
  - mediana 71 ms, p90 260 ms, massimo 508 ms. È in linea con la versione precedente (93/253/465 ms).
  - **1 richiesta interrotta da Cloudflare** per eccesso di tempo di calcolo (HTTP 503). Era la bici Centrale → Piazza Fontana, alla fine di una serie di percorsi pesanti lanciati a pochi secondi l'uno dall'altro. La stessa richiesta, ripetuta 7 secondi dopo, ha risposto correttamente.
  - Il profilo di calcolo è uguale a quello della versione precedente: il rischio non nasce da questo rilascio.

## 4. Ripristino

```sh
npx wrangler rollback bf3e13d5-51be-41a8-95d9-e72462c69053 --name lastrico-pilot
```

Ho verificato che la versione `bf3e13d5` è tra quelle disponibili.

## 5. Limiti noti

- **Tutte le prove mobili sono in Chrome emulato. Nessuna prova su iPhone fisico finora.**
- Raramente, sotto carico, Cloudflare può interrompere un calcolo pesante: compare un errore di servizio non disponibile e basta riprovare. Durante la navigazione un ricalcolo fallito resta visibile e l'app continua a guidare sul percorso precedente (scenario B4).
- I percorsi in centro con molto pavé richiedono circa 5,5 s, per l'attesa del servizio di routing pubblico.
- "Confermato" significa tag OSM, non rilievo sul campo. ZTL, orari e permessi non sono verificati.
- L'indicazione di proseguire a piedi con la bici è nel pannello del percorso, non nella voce.

## 6. GO/NO-GO

**GO per la prova su iPhone di stasera** sul pilota `03a6776e`.

Cosa controllare sulla strada:
1. Aprire il pilota in Safari, consentire la posizione e provare il tema notte.
2. Cercare partenza e arrivo (per esempio Cadorna → Darsena) e scegliere tra "Anti-pavé" e "Più rapido".
3. Avviare la navigazione e verificare:
   - l'attesa del GPS;
   - le indicazioni a voce (con l'interruttore silenzioso dell'iPhone disattivato);
   - il ricalcolo dopo un'uscita voluta dal percorso;
   - l'arrivo.
4. In bici, Centrale → Piazza Fontana: deve comparire l'avviso dei 91 m a piedi.
5. Se compare un errore di servizio, riprovare dopo qualche secondo e annotare l'orario.

**Sicurezza:** non usare il telefono mentre si guida. Tenerlo su un supporto, oppure lasciare le prove a un passeggero.
