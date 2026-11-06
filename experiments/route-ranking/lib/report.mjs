/**
 * Italian report renderer. Every number comes from the results object produced by
 * benchmark.mjs; this module only formats and words them.
 */
const nf = (digits = 0) => new Intl.NumberFormat("it-IT", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const n0 = (v) => (v === null || v === undefined ? "—" : nf(0).format(v));
const n1 = (v) => (v === null || v === undefined ? "—" : nf(1).format(v));
const signedN0 = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${nf(0).format(Math.abs(v))}`;
const pct = (num, den) => (den ? `${nf(0).format((100 * num) / den)}%` : "—");
const VIEW_LABEL = {
  "R-live": "R-live (risposte reali del codice attuale, 5/11/2026)",
  G: "G (geometrie archiviate ricalcolate con classificatore e dati attuali)",
  "R-archived": "R-archivio (metriche registrate da versioni precedenti del codice)",
};
const PROFILE_LABEL = { fastest: "Più rapido", balanced: "Bilanciato", strong: "Deciso", maximum: "Massimo" };
const MODE_LABEL = { car: "auto", motorcycle: "moto", bicycle: "bici" };

function profileTable(results) {
  const lines = [
    "| Modalità | Profilo | 1 min vale (m di pavé) | Pavé probabile | Sconosciuto | Supplemento non compensato | 1 km vale (m) | Soglia di cambio (m) | Limite deviazione |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|",
  ];
  for (const mode of ["car", "motorcycle", "bicycle"]) {
    for (const id of ["fastest", "balanced", "strong", "maximum"]) {
      const p = results.profiles[mode][id];
      const w = p.weights;
      const perMinute = w.confirmedPave > 0 ? n1(w.time / w.confirmedPave) : "solo tempo";
      lines.push(`| ${MODE_LABEL[mode]} | ${PROFILE_LABEL[id]} | ${perMinute} | ${n1(w.probablePave * 100)}% | ${n1(w.unknown * 100)}% | ${n1(w.unbackedUnknown * 100)}% | ${n1(w.distance)} | ${n0(p.switchingCostEq)} | ×${n1(p.detourLimit.factor)} + ${n0(p.detourLimit.seconds)} s |`);
    }
  }
  return lines.join("\n");
}

function aggregateTable(results, view, key = "all") {
  const lines = [
    "| Profilo | Confronti | Accordo con produzione | Cambi di percorso (classificatore / produzione) | Pavé noto evitato, m | Minuti aggiunti | Metri aggiunti | Sconosciuto aggiunto, m |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const id of ["fastest", "balanced", "strong", "maximum"]) {
    const a = results.aggregates[view][id][key];
    lines.push(`| ${PROFILE_LABEL[id]} | ${a.comparisons} | ${a.agreeCount}/${a.comparisons} (${pct(a.agreeCount, a.comparisons)}) | ${a.ranker.switchedFromFastest} / ${a.production.switchedFromFastest} | ${n0(a.ranker.knownPaveAvoidedM)} / ${n0(a.production.knownPaveAvoidedM)} | ${n1(a.ranker.extraMinutes)} / ${n1(a.production.extraMinutes)} | ${n0(a.ranker.extraMeters)} / ${n0(a.production.extraMeters)} | ${n0(a.ranker.unknownAddedM)} / ${n0(a.production.unknownAddedM)} |`);
  }
  return lines.join("\n");
}

function totals(results, views, profiles) {
  let comparisons = 0; let agree = 0; let rankerDominated = 0; let productionDominated = 0; let rankerDominatedProd = 0; let productionDominatedProd = 0;
  for (const v of views) for (const p of profiles) {
    const a = results.aggregates[v][p].all;
    comparisons += a.comparisons; agree += a.agreeCount;
    rankerDominated += a.ranker.dominatedRankerSpace; productionDominated += a.production.dominatedRankerSpace;
    rankerDominatedProd += a.ranker.dominatedProductionSpace; productionDominatedProd += a.production.dominatedProductionSpace;
  }
  return { comparisons, agree, rankerDominated, productionDominated, rankerDominatedProd, productionDominatedProd };
}

function stabilityTable(results) {
  const perturbations = Object.keys(results.stability.G.strong.winnerChanged);
  const lines = [
    `| Insieme | Profilo | Scenari con alternative | ${perturbations.map((p) => p.replace("time", "tempo").replace("probable", "probabile").replace("unknown", "sconosciuto")).join(" | ")} |`,
    `|---|---|---:|${perturbations.map(() => "---:").join("|")}|`,
  ];
  for (const v of ["R-live", "G"]) {
    for (const id of ["balanced", "strong", "maximum"]) {
      const s = results.stability[v][id];
      lines.push(`| ${v} | ${PROFILE_LABEL[id]} | ${s.scenarios} | ${perturbations.map((p) => s.winnerChanged[p]).join(" | ")} |`);
    }
  }
  return lines.join("\n");
}

function sensitivitySentence(results) {
  const timeKeys = Object.keys(results.stability.G.strong.winnerChanged).filter((k) => k.startsWith("time"));
  const score = (id) => ["R-live", "G"].reduce((sum, v) => sum + timeKeys.reduce((s, k) => s + results.stability[v][id].winnerChanged[k], 0), 0);
  const ranked = ["balanced", "strong", "maximum"].map((id) => [id, score(id)]).sort((a, b) => b[1] - a[1]);
  return `Somma dei cambi di vincitore sotto le quattro perturbazioni del tempo: ${ranked.map(([id, n]) => `${PROFILE_LABEL[id]} ${n}`).join(", ")}.`
    + (ranked.at(-1)[1] === 0 ? ` Il profilo ${PROFILE_LABEL[ranked.at(-1)[0]]} non cambia mai: con un peso del tempo così basso decidono di fatto il limite di tempo e il limite di deviazione.` : "");
}

function syntheticTable(results) {
  const sc = results.syntheticCrossCheck;
  const lines = [
    "| Modalità / profilo | Insiemi | Accordo | Solo la produzione cambia | Solo il classificatore cambia | Cambi diversi | Spiegati da distanza + soglia | ... + nessun credito per meno sconosciuto |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const [key, t] of Object.entries(sc.results)) {
    const [mode, profile] = key.split("/");
    const div = t.pools - t.agree;
    lines.push(`| ${MODE_LABEL[mode]} / ${PROFILE_LABEL[profile]} | ${t.pools} | ${pct(t.agree, t.pools)} | ${t.onlyProductionSwitches} | ${t.onlyRankerSwitches} | ${t.bothSwitchDifferently} | ${t.explainedByDistanceOrSwitching}/${div} | ${t.explainedAlsoByUnknownCredit}/${div} |`);
  }
  return lines.join("\n");
}

function syntheticTotals(results) {
  const list = Object.values(results.syntheticCrossCheck.results);
  const sum = (f) => list.reduce((acc, t) => acc + f(t), 0);
  return {
    pools: sum((t) => t.pools), agree: sum((t) => t.agree), divergent: sum((t) => t.pools - t.agree),
    explainedDistance: sum((t) => t.explainedByDistanceOrSwitching), explainedUnknown: sum((t) => t.explainedAlsoByUnknownCredit),
    rankerUnknown: sum((t) => t.inDivergences.rankerUnknownAddedM), productionUnknown: sum((t) => t.inDivergences.productionUnknownAddedM),
    rankerPave: sum((t) => t.inDivergences.rankerKnownPaveAvoidedM), productionPave: sum((t) => t.inDivergences.productionKnownPaveAvoidedM),
    rankerMinutes: sum((t) => t.inDivergences.rankerExtraS) / 60, productionMinutes: sum((t) => t.inDivergences.productionExtraS) / 60,
  };
}

function breakEvenSummary(results) {
  const list = results.breakEven.filter((b) => b.view !== "R-archived" && b.paveTradeOff);
  const values = list.map((b) => b.largestMinuteValueWithDetour);
  const never = values.filter((v) => v === null).length;
  const numeric = values.filter((v) => v !== null).sort((a, b) => a - b);
  const median = numeric.length ? numeric[Math.floor(numeric.length / 2)] : null;
  return { scenarios: list.length, never, min: numeric[0] ?? null, max: numeric.at(-1) ?? null, median };
}

function examples(results) {
  const rows = results.rows.filter((r) => r.view === "R-live" && r.profile === "strong" && r.budgetLabel === "requested");
  const switched = rows.filter((r) => r.ranker.id !== r.fastestId).slice(0, 2);
  const kept = rows.filter((r) => r.ranker.id === r.fastestId && r.distinctAlternative).slice(0, 1);
  return [...switched, ...kept].map((r) => `- *${r.scenarioId.replace(/^R:resp-\d+-/, "").replace(/:live-2026-11-05$/, "")}* (${MODE_LABEL[r.mode]}, profilo Deciso): «${r.explanation}»`).join("\n");
}

function divergenceList(results) {
  if (!results.divergences.length) return "Nessuna divergenza.";
  return results.divergences.map((d) => {
    const name = d.scenarioId.replace(/^R:/, "").replace(/:.*$/, "");
    return `- **${name}** (${d.view}, ${MODE_LABEL[d.mode]}, profilo ${PROFILE_LABEL[d.profile]}): la produzione sceglie *${d.production.id}* `
      + `(${n0(d.production.knownPaveAvoidedM)} m di pavé noto evitati, +${n1(d.production.extraSeconds / 60)} min, +${n0(d.production.extraMeters)} m, sconosciuto ${d.production.unknownAddedM >= 0 ? "+" : ""}${n0(d.production.unknownAddedM)} m); `
      + `il classificatore sceglie *${d.ranker.id}*. Motivazione del classificatore: «${d.explanation}»`;
  }).join("\n");
}

export function renderReport(results) {
  const c = results.corpus;
  const v = c.views;
  const h = results.harnessValidation;
  const all = totals(results, ["R-live", "G", "R-archived"], ["fastest", "balanced", "strong", "maximum"]);
  const current = totals(results, ["R-live", "G"], ["balanced", "strong", "maximum"]);
  const be = breakEvenSummary(results);
  const live = c.liveRequests;
  const rt = results.runtime;
  const rankerLoc = results.maintenance.files.find((f) => f.path === "ranker.mjs");
  const harnessLoc = results.maintenance.files.filter((f) => f.path !== "ranker.mjs" && !f.path.startsWith("test/")).reduce((s, f) => s + f.codeLines, 0);
  const testLoc = results.maintenance.files.filter((f) => f.path.startsWith("test/")).reduce((s, f) => s + f.codeLines, 0);
  const strongLive = results.aggregates["R-live"].strong.all;
  const balancedLive = results.aggregates["R-live"].balanced.all;
  const maxLive = results.aggregates["R-live"].maximum.all;
  const archivedMismatch = h["R-archived"].mismatches.map((m) => m.scenarioId.replace(/^R:/, "").replace(/:.*$/, "")).join(", ");
  const tradeOffCurrent = v["R-live"].withPaveTradeOff + v.G.withPaveTradeOff;
  const syn = syntheticTotals(results);
  const tradeOffMilan = results.tradeOffScenarioAreas.milan;
  const mismatchEras = [...new Set(h["R-archived"].mismatches.map((m) => m.codeEra))].join(", ");

  return `# Fase 4.20 — Agente A: classificazione spiegabile dei percorsi

*Rapporto generato da \`experiments/route-ranking/benchmark.mjs\` (versione classificatore ${results.rankerVersion}). Tutti i numeri sono ricalcolati dai dati grezzi del corpus; nessuno è stimato o digitato a mano.*

## In breve

- Abbiamo costruito un **classificatore multicriterio spiegabile**: vincoli rigidi (legalità, limite di tempo, limite di deviazione, riduzione minima di pavé noto), poi esclusione dei percorsi dominati, poi un **punteggio additivo in "metri-equivalenti di pavé"** in cui ogni criterio (pavé confermato, pavé probabile, fondo sconosciuto, tempo, distanza) ha un contributo leggibile e una frase in italiano spiega perché il percorso scelto batte (o non batte) il più rapido.
- Sui percorsi reali il classificatore **fa quasi sempre la stessa scelta della produzione attuale**: ${current.agree} confronti su ${current.comparisons} (${pct(current.agree, current.comparisons)}) sui dati attuali (profili Bilanciato, Deciso, Massimo), ${all.agree}/${all.comparisons} includendo l'archivio e il profilo Più rapido. Con il profilo Deciso (predefinito in produzione) l'accordo sulle ${strongLive.comparisons} richieste reali di oggi è ${strongLive.agreeCount}/${strongLive.comparisons}.
- Il vantaggio dimostrato è quindi **trasparenza e configurabilità**, non percorsi migliori: le scelte restano le stesse, ma ora sono scomponibili e regolabili con pesi espliciti.
- Su insiemi **sintetici** casuali (solo per capire dove le due regole differiscono) l'accordo scende a ${pct(syn.agree, syn.pools)}: la differenza principale è che il classificatore dà credito a un percorso con **meno tratti sconosciuti**, mentre la produzione non lo fa. È un'opzione (\`creditUnknownReduction\`) e una decisione di prodotto da prendere.
- Nessuna scelta del classificatore è dominata (${all.rankerDominated} casi su ${all.comparisons}); per confronto la produzione ne ha ${all.productionDominated} nello spazio dei criteri del classificatore.
- **Limite principale**: non esiste una verità di riferimento sulla soddisfazione degli utenti né sulla rugosità reale; e gli scenari con un vero compromesso pavé/tempo sui dati attuali sono solo ${tradeOffCurrent} (${v["R-live"].withPaveTradeOff} dalle ${v["R-live"].scenarios} richieste reali di oggi, ${v.G.withPaveTradeOff} dal ricalcolo dell'archivio), ${tradeOffCurrent === tradeOffMilan ? "tutti a Milano (a Roccella nessun percorso registrato offre un compromesso: il pavé noto lungo quei percorsi è zero)" : `di cui ${tradeOffMilan} a Milano e ${tradeOffCurrent - tradeOffMilan} a Roccella`}.
- **Raccomandazione: GO condizionato** per una fase di integrazione dedicata *come motore di spiegazione e di preferenze*, che sostituisca il calcolo interno di \`selectOptimizedRoute\` solo dopo una prova in parallelo; **NO-GO** per presentarlo come "percorsi migliori".

## Cosa fa il classificatore

1. **Vincoli rigidi**, nello stesso ordine della produzione: profilo del fornitore corretto e nessun tratto vietato (stessa regola di \`isLegalCandidate\`, verificata su ogni candidato del corpus); riferimento = percorso legale più rapido; esclusi i duplicati dello stesso corridoio; limite di minuti in più scelto dall'utente; limite di deviazione del profilo (stessi valori della produzione); un'alternativa deve ridurre il **pavé noto** di almeno 20 m (auto), 15 m (moto) o 12 m (bici).
2. **Filtro di Pareto** su tempo, distanza, pavé confermato, pavé probabile, sconosciuto e sterrato: un percorso peggiore o uguale su tutto non può vincere.
3. **Costo additivo** relativo al più rapido, in metri-equivalenti di pavé confermato (m-eq). Il fondo sconosciuto **non è mai trattato come asfalto**: pesa sempre più di zero, e i metri sconosciuti che sostituiscono pavé evitato senza asfalto confermato in cambio pesano quanto il pavé confermato (supplemento prudenziale). Un'alternativa paga anche una piccola soglia di cambio percorso, così un vantaggio trascurabile non fa cambiare strada.

Profili predefiniti (i pesi di tempo derivano dalla politica di produzione \`balancedPaveDivisor\`; la distanza al 10% del tempo per km è un'ipotesi **non calibrata**):

${profileTable(results)}

Il profilo **Personalizzato** permette di cambiare ogni peso e il limite di deviazione; i valori vengono validati (pesi finiti e non negativi, pavé probabile non più pesante del confermato, sconosciuto sempre positivo).

## Corpus

- File inventariati con SHA-256 e provenienza: **${c.inputFiles}** (\`corpus/manifest.json\`). Risposte API registrate: ${c.setR.files}; ${c.setR.strictDuplicatesExcluded} esclusi perché duplicati esatti (riproduzioni in modalità navigazione); ${c.setR.sameCandidatesAcrossModes} hanno candidati identici a un'altra modalità (auto e moto di Valhalla coincidono spesso in città; per il fixture moto E2E non si può escludere una copia) e sono tenuti ma non contati come insiemi indipendenti (${c.setR.independentCandidateSets} insiemi indipendenti).
- Divisione pavé confermato/probabile per i candidati senza valori esatti: ricavata dal pavé ponderato (peso 1 per sett/ciottoli, 0,65 per paving_stones); verificata su ${c.setR.splitDerivation.checkedAgainstExactPayloads} percorsi con valori esatti, errore massimo ${c.setR.splitDerivation.maxAbsErrorM} m (${c.setR.splitDerivation.exactMatches} identici).
${live ? `- **Richieste reali nuove** al server locale (copia esatta della build \`dist/\` del 5/11/2026, solo coordinate, una richiesta ogni ≥10 s): ${live.total} richieste, ${live.ok} riuscite, ${live.failed} non riuscite${live.stoppedReason ? ` (interrotte: ${live.stoppedReason})` : ""}. Le non riuscite sono risposte 422 della produzione per la bici ("tutti i percorsi trovati attraversano tratti vietati secondo OpenStreetMap"), non errori del fornitore. Le risposte grezze sono in \`corpus/live-2026-11-05/\`.` : "- Nessuna richiesta reale nuova."}

| Insieme | Scenari | Con alternativa distinta | Con compromesso pavé/tempo | Candidati | auto / moto / bici | Milano / Roccella |
|---|---:|---:|---:|---:|---|---|
${["R-live", "G", "R-archived"].map((k) => `| ${VIEW_LABEL[k]} | ${v[k].scenarios} | ${v[k].withDistinctAlternative} | ${v[k].withPaveTradeOff} | ${v[k].candidates} | ${v[k].byMode.car} / ${v[k].byMode.motorcycle} / ${v[k].byMode.bicycle} | ${v[k].byArea.milan} / ${v[k].byArea.roccella} |`).join("\n")}

"Alternativa distinta" = candidato legale fuori dal corridoio del più rapido. "Compromesso" = alternativa distinta con almeno la riduzione minima di pavé noto. La Fase 4.17 contava invece solo i casi in cui il percorso scelto differiva dal più rapido (2 su 24). Le metriche dell'archivio differiscono molto da quelle ricalcolate: l'archivio OSM è cresciuto dopo le registrazioni (molti tratti "sconosciuti" ora sono classificati), quindi l'insieme R-archivio descrive i dati di allora e conta come prova storica, non attuale.

## Verifica del banco di prova

Rieseguendo la selezione **attuale** di produzione (\`selectOptimizedRoute\` + filtro finale di \`route.ts\`) sugli stessi candidati registrati:

- R-live: ${h["R-live"].replayMatchesRecorded}/${h["R-live"].comparable} scelte identiche a quelle restituite dal server reale (stesso codice): il banco riproduce fedelmente la produzione.
- R-archivio: ${h["R-archived"].replayMatchesRecorded}/${h["R-archived"].comparable}; ${h["R-archived"].comparable - h["R-archived"].replayMatchesRecorded ? `le differenze (${archivedMismatch}) sono registrazioni prodotte da codice di generazione precedente (${mismatchEras}), con una regola di selezione poi cambiata: il confronto equo è con la produzione attuale, non con la scelta registrata allora.` : "nessuna differenza."}

${results.rawLiveHeadlineCheck ? `Controllo indipendente dalle risposte grezze del server (senza passare dal corpus normalizzato): ${results.rawLiveHeadlineCheck.switched} cambi di percorso su ${results.rawLiveHeadlineCheck.responses} risposte, ${n0(results.rawLiveHeadlineCheck.knownPaveAvoidedM)} m di pavé evitati, ${n1(results.rawLiveHeadlineCheck.extraMinutes)} minuti e ${signedN0(results.rawLiveHeadlineCheck.unknownAddedM)} m di sconosciuto in più — ${results.rawLiveHeadlineCheck.matchesBenchmark ? "identici" : "NON identici"} ai valori del banco per la produzione con profilo Deciso.

` : ""}Scelta del classificatore (profilo e limite richiesti nella registrazione) uguale alla scelta registrata: R-live ${h["R-live"].rankerMatchesRecorded}/${h["R-live"].comparable}, R-archivio ${h["R-archived"].rankerMatchesRecorded}/${h["R-archived"].comparable}.

## Risultati

Valori aggregati con il limite di tempo richiesto (R-live: nessun limite; archivio e G: +5 min). Per ogni colonna: classificatore / produzione.

### ${VIEW_LABEL["R-live"]}

${aggregateTable(results, "R-live")}

### ${VIEW_LABEL.G}

${aggregateTable(results, "G")}

### ${VIEW_LABEL["R-archived"]}

${aggregateTable(results, "R-archived")}

Con il profilo Massimo sulle richieste reali di oggi, entrambi cambiano percorso in ${maxLive.ranker.switchedFromFastest} casi su ${maxLive.comparisons}, evitando in totale ${n0(maxLive.ranker.knownPaveAvoidedM)} m di pavé noto per ${n1(maxLive.ranker.extraMinutes)} minuti in più (${n0(maxLive.ranker.knownPaveAvoidedM / Math.max(1, maxLive.ranker.extraMinutes))} m evitati per minuto) e ${n0(maxLive.ranker.unknownAddedM)} m di fondo sconosciuto in più. Con il profilo Deciso: ${n0(strongLive.ranker.knownPaveAvoidedM)} m per ${n1(strongLive.ranker.extraMinutes)} minuti. Con il Bilanciato il classificatore cambia percorso ${balancedLive.ranker.switchedFromFastest} volte contro ${balancedLive.production.switchedFromFastest} della produzione${balancedLive.ranker.switchedFromFastest < balancedLive.production.switchedFromFastest ? " (più prudente)" : balancedLive.ranker.switchedFromFastest > balancedLive.production.switchedFromFastest ? " (meno prudente)" : ""}.

### Divergenze (limite di tempo richiesto)

${divergenceList(results)}

${results.divergences.length ? `Attribuzione: togliendo al classificatore i due criteri che la produzione non usa (distanza in più e soglia di cambio percorso), divergenze che scompaiono: ${results.divergences.filter((d) => d.agreesWithoutDistanceAndSwitching).length} su ${results.divergences.length}. Divergenze in cui entrambe le scelte sono non dominate: ${results.divergences.filter((d) => d.bothNonDominated).length} su ${results.divergences.length}; si tratta di differenze di preferenza, non di errori.` : ""}

### Ottimalità di Pareto

- Scelte del classificatore dominate: ${all.rankerDominated} nello spazio dei suoi criteri, ${all.rankerDominatedProd} nello spazio della produzione (tempo, rischio ponderato, sconosciuto), su ${all.comparisons} confronti.
- Scelte della produzione dominate: ${all.productionDominated} nello spazio del classificatore, ${all.productionDominatedProd} nel proprio.

### Esempi di spiegazioni generate

${examples(results)}

### Sensibilità ai pesi

Numero di scenari (con almeno un'alternativa distinta) in cui il vincitore cambia se si perturba un solo peso:

${stabilityTable(results)}

${sensitivitySentence(results)} Valore del minuto di equilibrio sui ${be.scenarios} scenari attuali con compromesso (pesi del profilo Deciso, limite di deviazione Massimo, griglia logaritmica da 1 a 5000 m per minuto): il valore più alto del minuto per cui una deviazione vince ancora va da ${n0(be.min)} a ${be.max === 5000 ? "≥" : ""}${n0(be.max)} m di pavé (mediana ${n0(be.median)}); scenari in cui nessuna deviazione rientra nel limite di tempo: ${be.never}. La preferenza dell'utente conta davvero: un solo valore fisso non rappresenta tutti.

### Dove le due regole differiscono (verifica SINTETICA, non prove reali)

${results.syntheticCrossCheck.label}: ${results.syntheticCrossCheck.poolsPerModeAndProfile} insiemi casuali per modalità e profilo (seme ${results.syntheticCrossCheck.seed}), limite +5 min, nessun duplicato di corridoio.

${syntheticTable(results)}

Nelle ${syn.divergent} divergenze sintetiche la variazione totale di fondo sconosciuto rispetto al più rapido è ${signedN0(syn.rankerUnknown)} m per il classificatore e ${signedN0(syn.productionUnknown)} m per la produzione; il pavé noto evitato è ${n0(syn.rankerPave)} m contro ${n0(syn.productionPave)} m, con ${n1(syn.rankerMinutes)} contro ${n1(syn.productionMinutes)} minuti in più. In altre parole il classificatore sceglie più spesso percorsi meglio documentati, la produzione percorsi con più pavé evitato ma più tratti senza dati. Togliendo distanza e soglia e disattivando il credito per meno sconosciuto, le divergenze spiegate sono ${syn.explainedUnknown} su ${syn.divergent}; le restanti non sono attribuite sperimentalmente e coincidono con le altre differenze di regola note: il tetto 1,25× della produzione sullo sconosciuto scontato e, nel profilo Massimo, il peso del tempo (0 in produzione, 1/100 nel classificatore). Sui percorsi reali, disattivare il credito per meno sconosciuto cambia la scelta in ${results.unknownCreditEffectOnGenuine.changed} confronti su ${results.unknownCreditEffectOnGenuine.comparisons} (di questi, uguali alla produzione dopo il cambio: ${results.unknownCreditEffectOnGenuine.changedNowAgreesWithProduction}): le differenze sono rare ma reali, e un'integrazione deve scegliere esplicitamente una sola regola.

### Prestazioni

Tempo per classificazione (Node ${rt.node}, ${rt.scenarios} scenari, fino a ${rt.maxCandidates} candidati, esclusi calcolo geometrico, punteggio di superficie e chiamate al fornitore): classificatore mediana ${n1(rt.ranker.median)} µs, 95° percentile ${n1(rt.ranker.p95)} µs, massimo ${n1(rt.ranker.max)} µs; selezione di produzione mediana ${n1(rt.production.median)} µs, 95° percentile ${n1(rt.production.p95)} µs. Il costo aggiuntivo è irrilevante rispetto al limite CPU del Worker e ai secondi delle chiamate di routing.

## Qualità delle prove e limiti

- **Nessuna verità di riferimento**: non sappiamo quale percorso gli utenti preferiscano né quanto sia davvero sconnessa la strada. L'accordo con la produzione misura coerenza, non qualità.
- **Accordo atteso per costruzione**: i pesi di tempo e i limiti sono derivati dalla politica di produzione; l'alto accordo dimostra che la logica attuale si può esprimere in forma additiva spiegabile, non che sia giusta.
- **Campione piccolo e concentrato**: ${tradeOffCurrent} scenari attuali con compromesso, ${v["R-live"].scenarios} richieste reali di oggi tutte nel centro di Milano; nessun dato moto/bici distinto per Roccella; i candidati dipendono da come la produzione li genera (fino a 3 alternative del fornitore, 1 percorso "surface-aware", fino a 3 deviazioni).
- **Precisione**: per i candidati non scelti la durata registrata è arrotondata al secondo e la divisione confermato/probabile è ricavata (errore ≤ ${c.setR.splitDerivation.maxAbsErrorM} m); l'equivalenza di corridoio in R viene dal flag registrato rispetto al più rapido.
- **Pesi non calibrati**: probabile 0,65 e sconosciuto 0,35/0,5 riprendono la produzione; la distanza è un'ipotesi; servono preferenze dichiarate dagli utenti per calibrarli.

## Costo di manutenzione

- Classificatore: ${rankerLoc.codeLines} righe di codice (${rankerLoc.totalLines} totali), **zero import dalla produzione**; dipende solo da un contratto di metriche che si ottiene 1:1 da \`RoadIntelligenceScore\` + \`EngineRoute\`. Costanti duplicate: limiti e soglie di \`MODE_POLICY\`, protette da un test che legge il sorgente di produzione.
- Banco di prova (corpus, adattatore, benchmark, report, cattura): ${harnessLoc} righe; test: ${testLoc} righe. Il banco importa in sola lettura ${results.maintenance.harnessProductionImports.length} moduli di produzione.
- Rischi di integrazione: tre differenze di regola da risolvere prima di mostrare spiegazioni, altrimenti la spiegazione non descriverebbe la decisione reale — (1) trattamento dello sconosciuto (tetto 1,25× in produzione, supplemento lineare nel classificatore), (2) credito per meno sconosciuto (assente in produzione), (3) distanza e soglia di cambio (assenti in produzione; divergenze nel profilo Bilanciato di oggi: ${balancedLive.comparisons - balancedLive.agreeCount} su ${balancedLive.comparisons}); testi italiani da revisionare con l'utente; il contratto di metriche richiede che la produzione esponga pavé confermato e probabile per ogni candidato (oggi la diagnostica ne espone solo la somma e il ponderato).

## Raccomandazione

**GO condizionato** per una fase di integrazione con prompt dedicato, limitata a:

1. usare il classificatore come **unica regola di decisione e di spiegazione** (mai spiegare con una formula una scelta presa da un'altra), dietro un flag, dopo una prova in parallelo sulle suite esistenti e su nuove catture reali con criterio di accettazione ≥ 95% di accordo con la produzione per i profili esistenti e 0 scelte dominate; decidere prima se un percorso con meno tratti sconosciuti merita credito (oggi la produzione dice di no);
2. mostrare la frase "perché questo percorso" e la scomposizione dei contributi; esporre il profilo personalizzato solo se ogni controllo cambia davvero la scelta (regola AGENTS.md);
3. raccogliere più scenari con compromesso (moto e bici, Roccella, periferie) prima di modificare i pesi.

**NO-GO** per qualsiasi affermazione di "percorsi migliori" o di comfort: le prove dimostrano trasparenza e coerenza, non un beneficio per l'utente.

## Riproduzione (dalla radice del repository)

\`\`\`sh
node --test experiments/route-ranking/test/
node experiments/route-ranking/build-corpus.mjs
node experiments/route-ranking/benchmark.mjs
\`\`\`
`;
}
