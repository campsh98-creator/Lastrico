# Fase 4.26 — Rilascio pilota delle sole modifiche di Milano (Fasi 4.24–4.25)

7 novembre 2026. Prompt di esecuzione: `outputs/prompt-phase426-milan-pilot-release.md`. Il rilascio è stato autorizzato esplicitamente dall'utente.

## 1. Cosa è stato pubblicato

- **Pilota** `lastrico-pilot` (https://lastrico-pilot.campsh.workers.dev).
  - Versione attiva: `bf3e13d5-51be-41a8-95d9-e72462c69053`, del 7 novembre 2026 alle 14:50 UTC.
  - Versione precedente: `f61513e2-4e7c-481f-8b9f-8cf801d632ff`.
- **Branch** `fix/mobile-navigation-stability`, inviato su GitHub. `main` non è stato toccato e non c'è stato nessun force-push. Commit:
  - `1b61304`: regole dei fondi di Milano "2026-11", abbinamento del fondo sulla strada percorsa, divieto di aggiungere pavé confermato e ricerca di rifinitura, con i relativi test.
  - `f21613a`: correzione di un test del browser (vedi sezione 3).
  - `749aa14`: strumenti di audit e benchmark, riepiloghi e resoconti. Le registrazioni grezze del benchmark (43 MB) restano solo in locale.
- **Contenuto:** le modifiche di Milano descritte in `outputs/phase424-425-report.md`. Il pavé confermato sui percorsi scelti è sceso da 56,7 a 51,8 km nel benchmark.

## 2. Roma esclusa

- Roma (Fase 4.23) **non è nel rilascio**: niente voce "Roma", percorsi suggeriti, dati o codice dedicato.
- Nella cartella di lavoro il lavoro su Roma resta com'era: non salvato su Git e intatto.
- Senza Roma il pacchetto del Worker pesa **13,18 MiB** (gzip 3,29 MiB), contro 67,73 MiB con Roma. Il limite Cloudflare è 64 MiB.
- Con Roma nella cartella, il controllo dei tipi TypeScript esaurisce la memoria con le impostazioni normali; senza Roma passa. Da affrontare quando si riprende Roma.

## 3. Verifiche prima della pubblicazione

Le verifiche sono state fatte su una copia separata, identica ai commit pubblicati.

- **Controlli automatici:**
  - TypeScript ed ESLint senza errori.
  - 364 test su 364.
  - Dashboard: 36 su 36. Esperimento di ranking: 26 su 26.
  - Build di produzione e dry-run di Wrangler riusciti.
- **Prova mobile nel browser** (Chrome emulato, Worker locale), 70 scenari nei temi chiaro e scuro:
  - Tutti passano.
  - Due controlli legati al caricamento della mappa sono falliti una volta ciascuno, poi sono passati 5 volte su 5. Un altro fallimento è avvenuto mentre il server di sviluppo locale si era bloccato.
  - Lo scenario dei percorsi suggeriti falliva anche sulla versione online del 6 novembre. Il test chiudeva il pannello che era rimasto aperto; è stato corretto in `f21613a`.

## 4. Verifiche dopo la pubblicazione (HTTPS)

- **Smoke test** (`scripts/post-deploy-smoke.mjs`): 18 su 18. Comprendono pagina, PWA, ricerca indirizzi, Auto/Moto/Bici a Milano e Roccella, e avvio della navigazione.
- **Prova mobile completa sulla versione pubblicata:** 70 su 70, con i viaggi reali:
  - Milano in auto e in bici;
  - Roccella in auto e in moto;
  - ricalcolo e riavvio.
- **Percorsi con molto pavé**, con l'impostazione predefinita "Forte": 7 casi su 7 danno lo stesso pavé confermato del benchmark. Esempi:
  - Cordusio → Porta Romana in auto: 1,91 → 0,67 km.
  - Corvetto → Duomo in auto: 2,48 → 0,69 km.
  - Con "Bilanciato", che dà più peso al tempo, alcune deviazioni lunghe non vengono proposte. Su Cordusio → Porta Romana, per esempio, la deviazione costerebbe 8,7 minuti in più.
- **CPU su Cloudflare** (48 richieste di percorso):
  - mediana 93 ms, p90 253 ms, massimo 465 ms;
  - le altre richieste: mediana 5 ms;
  - nessun errore né eccezione. Una sola richiesta di ricerca indirizzo è stata annullata dal browser mentre si digitava.
- **Latenza:**
  - percorsi normali: 0,3–1,3 s;
  - percorsi in centro con molto pavé: 5,4–5,7 s, in gran parte attesa del servizio di routing pubblico.

## 5. Ripristino

Se serve tornare indietro:

```sh
npx wrangler rollback f61513e2-4e7c-481f-8b9f-8cf801d632ff --name lastrico-pilot
```

## 6. Limiti residui

- **Nessuna prova su iPhone fisico.** Tutte le prove mobili sono in Chrome emulato.
- "Confermato" significa tag OSM, non rilievo sul campo.
- Nei percorsi del centro con molto pavé la risposta richiede circa 5,5 s.
- Roma non è pubblicata. Prima serve ridurne il pacchetto.
- Le regole corrette valgono solo per Milano. Roccella resta sulle regole precedenti.

## 7. GO/NO-GO

**GO per la prova su iPhone fisico** sul pilota pubblicato. Da controllare in particolare:
- i percorsi suggeriti;
- un percorso in centro con molto pavé (per esempio Cordusio → Porta Romana in auto), compresi l'attesa e l'alternativa anti-pavé;
- la navigazione con il GPS reale.
