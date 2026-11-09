# Fase 4.31 · revisione delle scelte di percorso: i 7 casi esclusi

9 novembre 2026. Tutto in locale: nessun commit, push o deploy.

**Su cosa si basa**
- **Dati:** benchmark di Milano, lunedì alle 12:00, livello anti-pavé «Forte» (quello predefinito), nessun limite di minuti extra impostato.
- **Risposte del servizio di routing:** registrate e riproducibili.
- **Prove:** `outputs/phase431/rejected-alternatives-*.json`, `outputs/phase425-benchmark/p431-decision-*`.

**Come leggere la tabella**
- **«Disagio»** è il pavé pesato che la scelta confronta: confermato × 1, probabile (masselli) × 0,65, più lo sterrato.
- **La regola indicata** è quella che il motore stesso riporta ora per ogni candidato, nel nuovo campo `selectionVerdict` della diagnostica; non è una mia ricostruzione.
- **Accessi:** tutte le alternative sono legalmente percorribili, senza ZTL o divieti.
- **Limite «Forte»:** tutte e sette stanno entro il suo limite di tempo (+42% e +7 min).

| Caso (mezzo) | Percorso scelto | Alternativa esclusa | Differenza | Regola che la esclude | Decisione |
|---|---|---|---|---|---|
| **Moscova → Crocetta** (auto) | 4,7 km, 15,6 min · 940 m confermati, 388 probabili, 2 m sconosciuti · disagio 1.192 | 5,9 km, 17,3 min · 964 confermati, 0 probabili, 0 sconosciuti · disagio 964 | +99 s · **+24 m confermati, −388 m probabili** · disagio **−19%** | pavé confermato in più (tolleranza fissa 10 m), anche con «Massimo» | **Ora offerta** (regola corretta, sotto) |
| Cadorna → Cinque Giornate (auto) | 4,4 km, 14,0 min · 2 conf., 320 prob. · disagio 210 | 5,9 km, 18,4 min · 0 conf., 62 prob. · disagio 40 | +265 s · solo masselli tolti (−258 m) · disagio −81% | il tempo in più vale più del pavé evitato | Invariata: offerta con «Massimo» (verificato) |
| Cenacolo → Missori (auto) | 3,1 km, 10,9 min · 582 conf., 320 prob. · disagio 790 | 4,3 km, 15,1 min · 475 conf., 226 prob., **+88 m sconosciuti** · disagio 622 | +253 s · −107 conf., −94 prob. · disagio −21% | il tempo in più vale più del pavé evitato | Invariata: offerta con «Massimo» |
| Colonne → Porta Genova (auto) | 2,0 km, 6,8 min · 205 conf., 37 prob., 17 sconosciuti · disagio 229 | 2,6 km, 9,1 min · 85 conf., 7 prob., **151 sconosciuti** · disagio 89 | +134 s · −120 conf. ma +134 m senza dati | tempo, con il fondo sconosciuto penalizzato | Invariata: offerta con «Massimo» |
| Sant'Agostino → Colonne (auto) | 1,3 km, 4,8 min · 223 conf., 42 prob. · disagio 250 | 1,8 km, 6,4 min · 143 conf., 15 prob., **110 sconosciuti** · disagio 152 | +100 s · −80 conf. ma +110 m senza dati | tempo, con il fondo sconosciuto penalizzato | Invariata: offerta con «Massimo» |
| Duomo → Porta Garibaldi (bici) | 2,7 km, 10,0 min · 532 conf., 790 prob., 339 sconosciuti · disagio 1.045 | 3,3 km, 13,6 min · **797 conf.**, 260 prob. · disagio 966 | +218 s · **+265 m confermati** per −530 probabili · disagio solo −8% | pavé confermato in più, e anche il tempo | Invariata: scambio peggiore per chi pedala |
| Lambrate → Cadorna (bici) | 6,5 km, 22,8 min · 334 conf., 509 prob. · disagio 665 | 7,3 km, 26,2 min · **447 conf.**, 98 prob., **326 m di sterrato** | +201 s · +113 conf. e +326 sterrato per −411 probabili · disagio −6% | pavé confermato in più, e anche il tempo | Invariata |

**Un'altra categoria contro il disagio complessivo**
- In quattro casi l'alternativa toglie molto di **una** categoria ma poco disagio complessivo:
  - le due in bici scambiano masselli con pavé confermato o sterrato (−8% e −6%);
  - Colonne → Porta Genova e Sant'Agostino → Colonne tolgono pavé confermato, ma aggiungono più fondo sconosciuto di quanto ne tolgano.
- Solo **Moscova → Crocetta** riduce davvero il disagio complessivo (−19%), con un aumento minimo di pavé confermato (+2,6%), senza fondo sconosciuto e senza vincoli di accesso. Era esclusa a **ogni** livello, anche «Massimo».

**Quanto pesa il tempo con «Forte».** Un minuto in più deve togliere almeno circa 50 m di pavé pesato. Le quattro alternative in auto escluse per il tempo costano tra 34 e 50 m pesati per minuto.

## Decisione e correzione

**L'unica regola che escludeva senza motivo un percorso nettamente migliore** era la tolleranza fissa di 10 m sul pavé confermato in più.
- **Nuova regola** (`lib/route-optimization.ts`): un aumento di pavé confermato è accettato se è al massimo il 10% del pavé probabile tolto, e mai oltre 50 m.
- **Protezione mantenuta:** gli scambi grandi per cui la regola era nata (fino a +326 m nella Fase 4.25) restano esclusi. Lo verificano i test, compresi i due casi in bici.

**Effetto misurato**
- **Percorsi calcolati prima della partenza** (354 risposte):
  - cambia **solo Moscova → Crocetta in auto**, che ora ha l'alternativa;
  - la frase mostrata è onesta: «Evita 388 m di pavé probabile ma aggiunge 24 m confermati, con 1,6 minuti e 1,2 km in più»;
  - in moto la scelta non cambia, ma servono 3 richieste in meno al servizio di routing;
  - alternative offerte: da 137 a **138 su 264**; pavé noto mostrato: da 80,9 a 80,5 km.
- **Ricalcoli durante la navigazione:** 0 cambiamenti su 263, nessuna richiesta in più.

**Le altre regole restano come sono.** Sono coerenti e i loro esiti si possono già ottenere:
- quelle sul tempo funzionano come previsto, e chi accetta più tempo ottiene quelle alternative scegliendo «Massimo»;
- quelle sul fondo sconosciuto evitano di scambiare pavé noto con strade senza dati.

**Gli altri 3 casi oltre i 7** (stessa soglia: almeno 100 m di pavé in meno entro +5 min) sono esclusi giustamente:
- Gae Aulenti → Porta Romana in bici: +681 m di fondo sconosciuto.
- Lorenteggio → Lambrate in auto: +26 km di fondo sconosciuto.
- Porta Genova → San Babila in moto: è stata offerta un'alternativa più conveniente.

## Verifiche

- **Test automatici: 440/440.**
  - 4 nuovi in `tests/phase431-selection-review.test.mjs`: Moscova → Crocetta offerto, scambi grandi ancora esclusi, la regola del tempo invariata con «Massimo» che offre ciò che «Forte» rifiuta, una regola registrata per ogni candidato.
  - Ancora validi i test della Fase 4.25 sulla regola originale e i 6 della verifica Filippetti.
- **TypeScript ed ESLint:** nessun errore.
- **Prove nel browser, mirate: 8/8.**
  - H1 Filippetti offerto e seguito, H2 «Più rapido e anti-pavé», H3 spiegazioni distinte.
  - G1 anti-pavé mantenuto nei ricalcoli, G4 inversione A/B con ZTL e minuti extra, A8 scelta del percorso.
  - E1 e E3: viaggi reali a Milano, in auto e in bici, con il servizio di routing vero.
- **Preservato:** Filippetti, ZTL, inversione A/B, GPS, popup sul fondo, ricalcolo anti-pavé continuo.
- **Costo di esecuzione:** nessuna richiesta in più al servizio di routing (meno, nel caso moto). Il controllo della regola costa trascurabile CPU, nessuna misura su Cloudflare.

## GO/NO-GO

**GO per la qualità del prodotto.** Dei 7 casi:
- l'unico escluso a torto ora viene offerto, senza regressioni misurate;
- gli altri 6 sono scelte coerenti, spiegate nell'app e ottenibili con «Massimo» quando il problema è solo il tempo.

Il rilascio solo Milano resta legato alle condizioni già note: Workers Paid, la tua autorizzazione per commit e deploy, il metodo che esclude Roma, le verifiche in produzione e una prova su iPhone.
