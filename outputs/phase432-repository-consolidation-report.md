# Fase 4.32 — Consolidamento del repository, sincronizzazione con GitHub e vetrina

9 novembre 2026. Prompt di esecuzione: `outputs/prompt-phase432-repository-consolidation.md`.

Non ho fatto nessuna pubblicazione su Cloudflare né merge su `main`, e nessun push forzato. Non ho cambiato
visibilità, ramo predefinito o licenza. Il pilota pubblico resta `03a6776e`.

## 1. Stato prima e dopo

| | Prima | Dopo |
|---|---|---|
| Ramo | `fix/mobile-navigation-stability` | uguale |
| GitHub (`origin`) | `66bdccd`, rilascio Fase 4.26 | lo stesso commit di questo resoconto, uguale al locale |
| Commit solo locali | 7: Roma 4.23/4.27 e Milano 4.28 | 0 |
| Modifiche non salvate | Fasi 4.29–4.31: 20 file modificati, ~1.200 nuovi | nessuna |
| `main` | `19d211a` | `19d211a`, invariato |

## 2. Commit pubblicati

**Già pronti in locale (7):**
- `e084138`, `6b77681`, `2b56e3b` e `7bc22ff`: Roma;
- `cb8fbbe`, `69678e3` e `733518b`: Milano 4.28.

**Nuovi:**
1. `bf2c007`: codice delle Fasi 4.29–4.31, dati ZTL e semafori, test e fixture.
2. `0793bd3`: strumenti di benchmark e archivio compresso delle risposte di routing.
3. `62218f8`: prompt, resoconti e prove delle Fasi 4.29–4.31.
4. `228571f`: README, stato del progetto, architettura e immagini.
5. Questo resoconto.

## 3. Cosa è salvato

- **Tutto il codice, i dati e i test.**
  - Fonti OSM con checksum, riquadri compilati di Milano, Roccella e Roma, dati ZTL e semafori.
  - 440 test e le fixture registrate.
- **L'archivio delle risposte di routing:** 2.160 risposte, 41 MB, salvate compresse in un file da 5,9 MB. Non si può rigenerare, perché il servizio pubblico cambia nel tempo, ed è ciò che rende i benchmark riproducibili. Checksum e istruzioni di ripristino sono in `outputs/phase425-benchmark/PROVIDER_ARCHIVE.md`; ho verificato che estraendolo si ottengono gli stessi file.
- **Esclusi apposta, perché si possono rigenerare:**
  - i risultati dei singoli casi di benchmark (i riepiloghi sono salvati);
  - i riquadri di Roma non compressi;
  - i log.
- **Controlli prima del push:**
  - nessuna chiave, token o password;
  - nessun indirizzo IP;
  - nessuna traccia GPS reale;
  - file più grande 8,2 MB.
  - I luoghi delle prove su strada sono piazze pubbliche, già presenti nei documenti pubblicati in precedenza.

## 4. Verifiche

- **Test automatici:** 440 su 440.
- **TypeScript e lint:** nessun errore. L'unico avviso, in uno script mio, è corretto.
- **Build di produzione:** riuscita.
- **Prove nel browser:** non le ho rifatte, perché il codice di routing e navigazione non è cambiato dall'ultima prova mirata (8 su 8). L'ultima prova completa era stata 81 su 81.
- **App reale per gli screenshot:** l'ho usata in locale con pianificazione, confronto, navigazione con l'avviso sul pavé e pannello ZTL, in tema chiaro e scuro.

## 5. Funzioni: in locale e sul pilota

Tabella completa in `docs/ENGINEERING_STATUS.md`.

**Sul pilota pubblico (Fase 4.28)**
- Percorsi Anti-pavé e Più rapido.
- Navigazione GPS e voce.
- Premium UI 2.0.
- Milano e Roccella.

**Solo in locale**
- GPS più fluido e freccia senza scatti.
- Avvisi sul pavé con il nome della via.
- Ricalcolo anti-pavé continuo.
- Semafori.
- ZTL.
- Inversione A/B.
- Riduzione della CPU.
- Correzione Moscova → Crocetta.

**Sperimentale:** Roma, mai pubblicata.

**Da provare su iPhone:** tutto ciò che è solo in locale.

## 6. Problemi aperti

1. **Il pilota pubblico quasi non calcola percorsi.** Il piano gratuito di Cloudflare limita la CPU a 10 ms per richiesta. Serve Workers Paid.
2. **Nessuna prova su iPhone delle Fasi 4.29–4.31.**
3. **Il lungo tratto di pavé verso Porta Garibaldi non è ancora identificato.** Serve una traccia della prossima prova.
4. **ZTL incomplete.**
   - Area C non è gestita.
   - Mancano gli orari dei varchi di Garibaldi e Ticinese.
   - Festivi ed eccezioni non sono gestiti.
5. **Semafori solo in centro.** Non sono stati verificati uno per uno.
6. **Dati OSM, non rilievi su strada.**
7. **Indirizzo di contatto vecchio.** Il servizio di indirizzi e quello di routing ricevono ancora l'indirizzo della vecchia beta, che oggi risponde 401.

## 7. README e immagini

- **Il README è riscritto in inglese,** con queste sezioni:
  - cosa fa Lastrico e perché è diverso;
  - capacità e schermate;
  - come sceglie il percorso;
  - città e disponibilità;
  - architettura e installazione;
  - test, dati e licenze;
  - limiti.
- **Il README non dà per online ciò che è solo in locale.**
- **10 immagini in `docs/assets/readme/`:**
  - un'immagine d'apertura con tre schermate;
  - schermate telefono in tema chiaro e scuro;
  - due schermate desktop.
- **Sono tutte schermate reali dell'app in locale,** con percorsi registrati dal servizio di routing vero e GPS simulato. Lo dicono la didascalia e `PROVENANCE.md`, e due script le rigenerano.
- **Pesano tra 133 e 497 KB.**
- **Sul browser:** le immagini si vedono su GitHub da desktop e da telefono, senza scorrimento orizzontale della pagina.

## 8. Dati del repository su GitHub

- **Descrizione:** aggiornata al testo richiesto.
- **Argomenti:** aggiunti `geospatial`, `smart-mobility` e `cycling`, mantenendo gli 11 esistenti, che erano tutti pertinenti.
- **Invariati:** visibilità (pubblico), licenza (MIT) e ramo predefinito (`main`).

## 9. Sincronizzazione

- **Testa remota:** uguale a quella locale, verificata con `git ls-remote` e con l'API di GitHub.
- **File sul ramo remoto:** README, immagini, archivio e dati ZTL ci sono, con dimensioni identiche.

## 10. La pagina principale di GitHub

**No, non mostra ancora la nuova presentazione.** GitHub mostra il README di `main`, che è rimasto quello vecchio.
- Sulla pagina principale si vedono già la nuova descrizione e i nuovi argomenti.
- Il README nuovo si vede scegliendo il ramo `fix/mobile-navigation-stability`.

## 11. Copie di sicurezza: cosa manca

- **Tutto ciò che sta in Git ora ha una copia su GitHub.** Non ci sono rami, modifiche messe da parte o tag rimasti solo in locale.
- **Mancano:**
  - **Segnalazioni della community nel database di produzione** (Cloudflare D1). Non hanno ancora una procedura di esportazione.
  - **Copie fuori da GitHub.** Su questo Mac non è configurato Time Machine. La cartella Documenti risulta legata a iCloud, ma non ho verificato che la sincronizzazione sia completa.

## 12. Passi consigliati (non eseguiti)

1. **Rendere visibile il README sulla pagina principale:** aprire una pull request verso `main` e farne il merge dopo la tua revisione.
2. **Attivare Workers Paid,** poi preparare il rilascio solo Milano, senza Roma.
3. **Fare la prova su iPhone** con la traccia di collaudo, per i casi A e C.
4. **Aggiornare l'indirizzo di contatto** del servizio di indirizzi e di quello di routing.
5. **Definire un'esportazione periodica** del database di produzione.
