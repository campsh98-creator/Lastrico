# Prompt esecutivo — Direzioni, segnalazioni e apertura open source

## Mandato

Agisci come un team autonomo coordinato da un solo release owner. Migliora Lastrico con tre
risultati integrati:

1. il banner della manovra durante la navigazione apre l’elenco completo delle svolte e non
   può mai avviare o riaprire il flusso delle segnalazioni;
2. le segnalazioni hanno un accesso dedicato e riconoscibile, un flusso robusto e una sezione
   comunità più utile e piacevole;
3. il codice e la documentazione sono pronti per un repository GitHub pubblico al quale sia
   semplice contribuire.

Non dichiarare completato il lavoro dopo il solo codice. Continua con test automatici,
verifica mobile, pubblicazione della beta, smoke test di produzione e, se l’autenticazione
GitHub lo consente, pubblicazione del repository pubblico.

## Regole di prodotto

- Lastrico e il percorso anti-pavé restano l’esperienza primaria.
- Durante la guida le interazioni devono essere poche, grandi e comprensibili.
- Una segnalazione è sempre un’azione esplicita; nessun click sulla rotta, sulla mappa o sul
  banner delle direzioni può iniziarla accidentalmente.
- Le segnalazioni `pending` non modificano automaticamente il routing e devono essere
  descritte come “da verificare”.
- Non raccogliere una cronologia GPS, email o altri dati non necessari.
- Non pubblicare segreti, token, file `.env`, dati personali o esportazioni di produzione.
- Il progetto deve restare MIT e attribuire sia l’autore sia i contributori.

## Organizzazione del team

- **Release owner:** integra, verifica scope e condizioni di rilascio.
- **UX navigazione:** progetta banner, sheet svolte, focus, touch e sicurezza durante la guida.
- **Community UX:** ridisegna dashboard, CTA e creazione segnalazioni.
- **Open source maintainer:** prepara struttura, documentazione, template, CI e onboarding.
- **QA:** costruisce test di regressione, mobile E2E e smoke test.

Gli audit possono essere paralleli. La modifica dei file condivisi e l’integrazione finale
restano responsabilità del release owner.

---

## Fase 1 — Correggere la separazione tra direzioni e segnalazioni

### Prompt della fase

Analizza lo stato `picking`, i riferimenti MapLibre e tutte le funzioni che aprono il form di
segnalazione. Garantisci che:

- solo il pulsante dedicato “Segnala strada” chiami l’avvio del report;
- selezionato il secondo punto del tratto, `picking` e `pickingRef` vengano azzerati prima di
  aprire il form;
- chiusura, annullamento, invio riuscito o fallito non lascino la mappa in modalità report;
- il click sul banner direzioni abbia una funzione separata;
- una nuova navigazione chiuda qualsiasi stato UI relativo alle segnalazioni;
- il cursore della mappa e la modalità compatta tornino sempre allo stato normale.

### Acceptance criteria

- dopo una segnalazione, dieci click successivi su mappa o percorso non riaprono il form;
- il banner manovra non richiama mai `startReport`, `setPicking("reportStart")` o il form;
- la CTA segnalazione usa un’icona riconoscibile, testo visibile e `aria-label`;
- il flusso report resta completabile con touch su mobile.

---

## Fase 2 — Elenco completo delle svolte

### Prompt della fase

Trasforma il banner della manovra in un vero pulsante accessibile. Al click apri un bottom
sheet/modal leggero con tutte le istruzioni del percorso attivo:

- intestazione con destinazione, percorso selezionato, minuti e distanza residui;
- elenco ordinato delle manovre restituito dal provider;
- icona semantica per sinistra, destra, dritto, rotonda, inversione, partenza e arrivo;
- testo, nome strada e distanza della singola istruzione;
- manovra corrente evidenziata e marcata `aria-current="step"`;
- istruzioni già percorse rese secondarie, senza scomparire;
- chiusura con pulsante grande, click sul backdrop ed Escape;
- sheet scrollabile senza fermare navigazione, GPS, simulazione o wake lock;
- nessun cambio del percorso o della posizione quando si apre/chiude il sheet.

Calcola l’indice corrente in modo deterministico usando la stessa proiezione impiegata dal
progresso di navigazione. Non duplicare la logica di identificazione della prossima manovra.

### Acceptance criteria

- il banner dichiara “Mostra tutte le svolte” e ha `aria-expanded`;
- l’elenco contiene tutte e sole le istruzioni del percorso attivo;
- dopo un ricalcolo mostra le istruzioni nuove, non quelle della rotta annullata;
- cambio tra rapido e anti-pavé prima dell’avvio mostra le istruzioni corrette;
- aprire e chiudere il foglio non cambia il timer della simulazione;
- su 320×568, 393×852 e landscape l’elenco è leggibile e chiudibile.

---

## Fase 3 — Ridisegnare segnalazioni e comunità

### Prompt della fase

Ridisegna la sezione Comunità come una superficie di prodotto, non come un gruppo di
contatori e link:

- titolo “Mappa collaborativa” e spiegazione breve del valore delle segnalazioni;
- CTA primaria “Segnala una strada” con icona di strada/avviso comprensibile;
- statistiche: contributi totali, verificati, da verificare e metri di fondo critico;
- card “Come funziona” con tre passi: seleziona tratto, descrivi, verifica comunitaria;
- elenco compatto degli ultimi contributi, con tipo, severità, stato, lunghezza e data;
- stato vuoto, caricamento e indisponibilità distinti;
- legenda chiara fra `Da verificare` e `Verificata`;
- link open source separato dagli strumenti dati e con destinazione GitHub reale;
- esportazione CSV descritta come strumento per analisi, non come azione primaria.

Migliora anche il form:

- titolo e copy sintetici;
- tipi di fondo con icone testuali/coerenti;
- severità con spiegazione dell’effetto;
- pulsante submit con stile reale e target minimo 44×44;
- riepilogo della lunghezza del tratto;
- privacy e moderazione esplicite;
- errori e invio annunciati senza perdere i dati compilati.

### Acceptance criteria

- nessuna statistica mostra zero mentre sta ancora caricando;
- massimo cinque contributi recenti, senza coordinate precise esposte nel testo;
- stato e tipo sono comprensibili senza affidarsi solo al colore;
- CTA dedicata visibile sia nella testata sia nella sezione Comunità;
- nessuna segnalazione `pending` viene descritta come già usata dal routing.

---

## Fase 4 — Rendere il codice evolutivo

### Prompt della fase

Riduci l’accoppiamento del componente principale senza una riscrittura totale:

- sposta tipi e metadati delle segnalazioni in un modulo condiviso;
- crea componenti dedicati per sheet delle svolte e pannello Comunità;
- passa dati e callback espliciti; evita dipendenze nascoste da MapLibre;
- esporta helper puri per indice istruzione, formattazione e stato report;
- aggiungi test unitari sugli helper;
- documenta in `docs/architecture.md` i confini tra UI, GPS, routing, pavé, report e hosting;
- documenta in `docs/development.md` setup, comandi, test e flusso di una modifica.

Non introdurre uno state manager o una libreria UI senza necessità dimostrata.

---

## Fase 5 — Preparazione open source e GitHub

### Prompt della fase

Prepara il repository pubblico `campsh98-creator/lastrico-milano`:

- README con obiettivo, demo, screenshot/social preview, limiti, architettura, quick start,
  roadmap e come contribuire;
- LICENSE MIT già presente e coerente;
- CONTRIBUTING con setup riproducibile, convenzioni branch, test richiesti, dati sensibili,
  issue e pull request;
- CODE_OF_CONDUCT e SECURITY con contatto privato verificabile;
- `GOVERNANCE.md` con maintainer, processo decisionale e stato dei contributi;
- `ROADMAP.md` con beta, dati, app nativa e infrastruttura;
- `.env.example` solo se esistono variabili realmente supportate e mai con valori reali;
- template issue per bug, proposta e dato stradale;
- template PR con test, mobile, privacy e screenshot opzionali;
- workflow GitHub Actions per installazione pulita, lint, build e test su Node supportato;
- Dependabot per npm e Actions;
- label/documentazione per `good first issue`, `help wanted`, `data`, `navigation`, `ux`.

Prima della pubblicazione esegui una scansione per token, password, email private, dump D1,
coordinate personali e file generati. Il dataset OSM e le attribuzioni devono restare
compatibili con le rispettive licenze.

Se GitHub CLI e connector non consentono creazione/push:

1. completa comunque codice, documentazione, commit, Sites e smoke test;
2. non inventare che il repository sia online;
3. comunica un’unica azione necessaria: autenticare GitHub;
4. dopo l’autenticazione crea il repository pubblico e pubblica il branch principale.

La creazione del repository pubblico è autorizzata da questa richiesta, ma non autorizza la
pubblicazione di segreti o dati non destinati al codice open source.

---

## Test automatici minimi

- reset completo dello stato report dopo secondo punto, annullamento e invio;
- il banner manovra apre solo lo sheet delle svolte;
- indice istruzione corrente prima, durante e dopo una manovra;
- lista aggiornata dopo cambio rotta o ricalcolo;
- stato report loading/empty/error/available;
- metadati tipo/severità/stato report;
- test statici per documentazione, CI, licenza e link GitHub;
- suite esistente senza regressioni.

## Verifica mobile E2E

1. calcola un percorso e avvia simulazione;
2. tocca il banner: appare l’elenco completo delle svolte;
3. scorri, identifica la manovra corrente, chiudi e verifica che il viaggio continui;
4. ripeti dopo cambio percorso;
5. apri Comunità e verifica statistiche, stati e contributi recenti;
6. avvia report soltanto dalla CTA dedicata;
7. seleziona due punti, chiudi il form e tocca mappa/percorso: il form non riappare;
8. completa una prova non distruttiva senza inviare dati di produzione;
9. verifica 320×568, 393×852 e 568×320;
10. verifica produzione dopo il deploy.

## Gate di rilascio

- prompt presente in `outputs/`;
- lint, build e test tutti verdi;
- E2E mobile dei flussi P0 completato;
- nessun errore browser o Worker nello smoke test;
- nessun dato sensibile nel commit;
- versione Sites salvata e distribuita con successo;
- repository GitHub realmente pubblico oppure blocco di autenticazione dichiarato con
  istruzione precisa;
- README e link in-app non devono puntare a un repository inesistente.

## Output finali

- beta di produzione;
- prompt esecutivo;
- codice modulare e test;
- documentazione open source;
- URL GitHub pubblico, se l’autenticazione è disponibile;
- elenco breve delle prove sul campo ancora necessarie.
