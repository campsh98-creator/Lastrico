# Fase 4.40: integrazione del Surface Intelligence Layer nel runtime, in modalità ombra. Prompt di esecuzione

Data: 15 novembre 2026. Base: **commit locale `b5ba991`** (Fase 4.39b, ramo `feat/phase439b-dbt-citywide`), non `main` e non la PR #16.
Ramo: `feat/phase440-sil-runtime-shadow`, worktree separato accanto ai precedenti (che restano intatti).
Stato della PR #16 al momento della stesura: aperta, CI verde, non unita (testa `1a5d8e9`). Non la tocco.

## Obiettivo

Far leggere al motore dei percorsi di Milano, in sola lettura, gli overlay SIL già costruiti, e produrre diagnostica
sensibile alla fonte (`diagnostics.sil`) **senza cambiare nessuna decisione**: candidati, ordinamento, penalità di superficie,
tempi stimati, penalità di inversione a U, obiettivo di navigazione, avvisi, validazione di legalità e reroute restano identici.

## Ambito

1. **Separazione delle fonti.** L'overlay 4.39b fonde in un'unica parola di bit i fatti OSM (ODbL 1.0), DBT del Comune (CC BY, versione in conflitto 2.5 IT / 4.0) e ATM (CC BY 4.0). Rifattorizzazione minima: la costruzione emette **strati separati per fonte**
   (A: OSM, B: DBT, C: ATM) più uno strato D di **metadati di associazione derivati, solo interni** (qualità dell'aggancio, esito del risolutore). Ogni file porta fonte, licenza, attribuzione e data. Gli artefatti 4.39b non cambiano byte per byte.
2. **Lettore e adattatore.** `lib/sil-layers.ts` (tipi, validazione, apertura con controllo dell'identità della tessera di base) e `lib/sil-shadow.ts` (aggancio del percorso alle tuple, composizione degli strati, contatori). Caricamento pigro per tessera e per fonte, tramite un **provider** (nessun `fs`, nessuna rete, nessun D1).
3. **Aggancio al motore.** Un solo punto in `app/api/routes/route.ts`, dopo che la risposta è decisa: `diagnostics.sil` aggiunto alla risposta, solo se la modalità è `shadow` e l'area è Milano. Con `off` la risposta è identica byte per byte a quella senza SIL (nessuna chiave `diagnostics`).
4. **Fail-safe.** Qualunque problema (overlay assente, versione, hash/impronta della tessera, copertura mancante, metadati di fonte incompatibili, errore di parsing) → il routing prosegue; la diagnostica dice «non disponibile» o «incerta» con il motivo; mai «nessun binario», mai «asfalto liscio».
5. **Spegnibile** senza riscrivere i dataset: `off` è il default.
6. **Misure.** Crescita del bundle, memoria, caricamento pigro, CPU per richiesta, latenza della diagnostica, numero di ricerche di tessera, richieste esterne inattese, memoria su richieste ripetute. Misure locali riproducibili. Nessuna misura Cloudflare inventata.
7. **Benchmark controllato.** 264 casi del corpus di Milano, risposte archiviate del provider, stesse tessere. A = baseline 4.39b senza SIL; B = SIL in ombra. Invarianti: stato, geometrie, percorso scelto, pavé confermato / probabile / sconosciuto, durata e distanza, legalità, richieste al provider. Roccella: nessuna modifica. Roma: non toccata.

## Limiti e divieti

- Nessun deploy, nessuna risorsa Cloudflare, nessun push, nessun merge in `main`, nessuna modifica alla PR #16.
- Nessun cambio di penalità di instradamento. Nessun avviso utente sui binari. Nessuna classificazione di binari o di fondo attivata.
- **Nessuna pubblicazione di un dataset OSM+DBT+ATM combinato.** I dati degli strati non vengono versionati in Git (ignorati) finché la questione delle licenze non è chiarita; si versiona solo il codice e un indice vuoto.
- I binari sono **evidenza da dati aperti datati** (DBT marzo/aprile 2020, ATM 24 luglio 2026, OSM): mai «presenza fisica oggi», mai «rugosità misurata».
- «Sconosciuto» non è mai assenza. «Cercato e non mappato» non è prova di assenza.
- Nessuna coordinata né traccia GPS nella diagnostica.
- Il lavoro di chiusura della Fase 4.36 resta in un commit solo documentale, in un ramo separato (`docs/phase436-closure`).

## Criteri di accettazione

| # | Criterio | Come si verifica |
|---|---|---|
| 1 | Con `off` la risposta è identica a quella senza il codice 4.40 | test + benchmark |
| 2 | Con `shadow` l'unica differenza è la chiave additiva `diagnostics.sil` e i tempi | test + 264 casi |
| 3 | Gli strati OSM / DBT / ATM sono file distinti, ognuno con la sua licenza, e non si mescolano nel caricamento | test di separazione e di provenienza |
| 4 | Ogni fallimento elencato sopra lascia il routing intatto | test di fallback |
| 5 | Nessuna richiesta esterna aggiunta dalla diagnostica | test + benchmark |
| 6 | Caricamento compatibile con i Worker (niente `node:*` nei moduli di runtime, solo `import()` dinamici di JSON) | test statico + build |
| 7 | Corso Lodi: binari DBT conservati; Piazzale Lodi: nessun binario inventato; Via Lazzaro Papi: nessuna ereditarietà da geometrie vicine; Via Friuli: infrastruttura storica distinta dal servizio ATM; conflitti visibili; copertura sconosciuta mai letta come assenza | script dei corridoi + test |
| 8 | `tsc`, ESLint, build, test mirati e suite completa; i fallimenti già presenti sulla baseline Windows sono confrontati, non presentati come regressioni | esecuzione e confronto |
| 9 | Roccella invariata; Roma esclusa | test |

## Test da scrivere

Caricamento statico degli strati, separazione delle fonti, provenienza, metadati di licenza, semantica della copertura, controllo di versione/impronta della tessera, ripiego grazioso, compatibilità delle diagnostiche dell'API, invarianza del routing, nessuna richiesta esterna, caricamento compatibile con i Worker, non regressione Roccella, esclusione di Roma dalla copia di rilascio.

## Condizioni di rilascio

Lo stato massimo di questa fase è **GO per la revisione tecnica e la validazione controllata in ombra**. Prima di qualsiasi avviso o penalità sui binari servono: chiarimento delle licenze (versione CC BY del DBT, testo di attribuzione, ODbL), unione della PR #16 e rebase, misura della CPU del Durable Object su Cloudflare con approvazione, verifica sul campo della presenza fisica, e una decisione di prodotto sull'uso delle diagnostiche.
