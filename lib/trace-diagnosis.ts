/**
 * Phase 4.34 — triage of a recorded field trace. It replays the trace (lib/gps-trace.ts) and lists
 * findings by category, each with its evidence and what to check, so a road test can tell a weak
 * GPS from a matching problem, a late wrong-turn detection, a provider failure, a doubtful
 * instruction, missing pavé evidence or the phone suspending the app.
 *
 * It cannot know the ground truth. "measured" means the trace shows it directly (a gap, a failed
 * request, a warning that never appeared); "possible" means it is one plausible reading among
 * others. Nothing here concludes that the route itself was wrong. Pure and deterministic: the same
 * trace always gives the same report (tests/phase434-diagnostics.test.mjs).
 */
import { ACCURATE_FIX_METERS, distanceMeters, NAVIGATION_POLICY, type NavigationTransportMode } from "./navigation-fix-processor.ts";
import { replayGpsTrace, type GpsTrace, type TraceDecision, type TraceRoute } from "./gps-trace.ts";
import { PAVE_WARNING_POLICY } from "./pave-warnings.ts";
import { buildRouteProgressModel, type ProgressInstruction } from "./route-progress.ts";

export const DIAGNOSIS_CATEGORIES = [
  "gps-accuracy",
  "map-matching",
  "wrong-turn-detection",
  "routing-api",
  "instructions",
  "pave-evidence",
  "app-interruption",
  "behaviour-changed",
] as const;
export type DiagnosisCategory = (typeof DIAGNOSIS_CATEGORIES)[number];

export type DiagnosisFinding = {
  category: DiagnosisCategory;
  certainty: "measured" | "possible";
  /** First and last fix the finding covers (indices into trace.fixes). */
  fromFix: number;
  toFix: number;
  /** Device time of the first fix, ISO; null when the trace has no fix there. */
  at: string | null;
  coordinate: [number, number] | null;
  evidence: Record<string, number | string | boolean>;
  /** Italian: what a person should check, on the map or on site. */
  check: string;
};

export type TraceDiagnosis = {
  traceId: string;
  version: number;
  synthetic: boolean;
  area: string;
  mode: string;
  fixes: number;
  routes: number;
  durationSeconds: number;
  replay: { accepted: number; reroutes: number; decisionDifferences: number; arrived: boolean };
  counts: Record<DiagnosisCategory, number>;
  findings: DiagnosisFinding[];
};

/** Thresholds, exported so the tests and the report state them. */
export const DIAGNOSIS_POLICY = {
  /** Consecutive inaccurate fixes that make a weak-GPS stretch. */
  poorAccuracyRun: 3,
  /** A silence this long between fixes is an interruption (GPS loss or the app suspended). */
  gapSeconds: 10,
  /** Speed between two accurate fixes that no vehicle in town reaches. */
  implausibleSpeed: 70,
  /** Accurate fixes this far from the route, but not far enough to leave it, for this many fixes. */
  ambiguousOffRouteMeters: 15,
  ambiguousRun: 5,
  /** Progress held back (a pending jump) for this many fixes. */
  heldRun: 3,
  /** Off route beyond the mode's threshold for longer than this before a reroute. */
  lateDetectionSeconds: 15,
  /** A reroute after fixes all closer than this share of the threshold may be a false trigger. */
  falseTriggerShare: 0.6,
  /** A reroute answer slower than this is reported (the app's reroute timeout is 8 s). */
  slowRerouteSeconds: 8,
  /** A deviation starting this soon after a manoeuvre point is worth checking against it. */
  deviationAfterManoeuvreMeters: 80,
} as const;

const PAVE_NOTE_KINDS = new Set(["unmapped_pave", "false_pave_smooth", "incorrect_pave_warning", "hazardous_surface"]);

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

type Accepted = Extract<TraceDecision, { outcome: "accepted" }>;
const accepted = (decision: TraceDecision | undefined): decision is Accepted => decision?.outcome === "accepted";

export function diagnoseGpsTrace(trace: GpsTrace): TraceDiagnosis {
  const replay = replayGpsTrace(trace);
  const mode = trace.mode as NavigationTransportMode;
  const policy = NAVIGATION_POLICY[mode];
  const accurate = ACCURATE_FIX_METERS[mode];
  const findings: DiagnosisFinding[] = [];

  const fixTime = (index: number) => trace.fixes[index]?.[0] ?? null;
  const fixCoordinate = (index: number): [number, number] | null => {
    const fix = trace.fixes[Math.min(Math.max(index, 0), trace.fixes.length - 1)];
    return fix ? [round(fix[1], 6), round(fix[2], 6)] : null;
  };
  const add = (finding: Omit<DiagnosisFinding, "at" | "coordinate"> & { coordinateFix?: number }) => {
    const { coordinateFix, ...rest } = finding;
    const time = fixTime(finding.fromFix);
    findings.push({
      ...rest,
      at: time === null ? null : new Date(time).toISOString(),
      coordinate: fixCoordinate(coordinateFix ?? finding.fromFix),
    });
  };
  /** Events record how many fixes came before them: an event at atFix happened after fix atFix − 1. */
  const eventFix = (atFix: number) => Math.max(0, Math.min(atFix - 1, trace.fixes.length - 1));
  const eventTime = (atFix: number) => fixTime(eventFix(atFix));

  // The route active at each fix, and its manoeuvre positions, for instruction and pavé checks.
  const routeAt = (index: number): { route: TraceRoute; number: number } | null => {
    let found: { route: TraceRoute; number: number } | null = null;
    trace.routes.forEach((route, number) => { if (route.atFix <= index) found = { route, number }; });
    return found;
  };
  const models = new Map<number, ReturnType<typeof buildRouteProgressModel<ProgressInstruction & { id?: string }>>>();
  const modelFor = (number: number) => {
    if (!models.has(number)) {
      const route = trace.routes[number];
      models.set(number, buildRouteProgressModel(route.coordinates, route.instructions, distanceMeters));
    }
    return models.get(number)!;
  };

  // 1. GPS accuracy: runs of inaccurate fixes, rejected fixes, impossible jumps.
  for (let index = 0; index < trace.fixes.length;) {
    if (trace.fixes[index][3] <= accurate) { index += 1; continue; }
    let end = index;
    while (end + 1 < trace.fixes.length && trace.fixes[end + 1][3] > accurate) end += 1;
    if (end - index + 1 >= DIAGNOSIS_POLICY.poorAccuracyRun) {
      const values = trace.fixes.slice(index, end + 1).map((fix) => fix[3]).sort((a, b) => a - b);
      add({
        category: "gps-accuracy", certainty: "measured", fromFix: index, toFix: end,
        evidence: { fixes: end - index + 1, seconds: round(((fixTime(end) ?? 0) - (fixTime(index) ?? 0)) / 1000), medianAccuracyMeters: round(values[values.length >> 1]), worstAccuracyMeters: round(values.at(-1)!) },
        check: `Precisione GPS peggiore di ${accurate} m: posizione mostrata come approssimativa. Verifica se il punto è tra edifici alti, in galleria o sotto portici.`,
      });
    }
    index = end + 1;
  }
  const rejectedBy = new Map<string, number[]>();
  trace.decisions.forEach((decision, index) => {
    if (decision?.outcome === "rejected") rejectedBy.set(decision.reason, [...(rejectedBy.get(decision.reason) ?? []), index]);
  });
  for (const [reason, indices] of [...rejectedBy].sort(([a], [b]) => a.localeCompare(b))) {
    add({
      category: "gps-accuracy", certainty: "measured", fromFix: indices[0], toFix: indices.at(-1)!,
      evidence: { reason, fixes: indices.length },
      check: reason === "implausible"
        ? "Rilevazioni scartate perché incompatibili con il movimento: tipico dei riflessi del segnale tra palazzi."
        : `Rilevazioni scartate (${reason}): il telefono ha consegnato posizioni vecchie, ripetute o non valide.`,
    });
  }
  for (let index = 1; index < trace.fixes.length; index += 1) {
    const [timeA, lonA, latA, accuracyA] = trace.fixes[index - 1];
    const [timeB, lonB, latB, accuracyB] = trace.fixes[index];
    const seconds = (timeB - timeA) / 1000;
    if (seconds <= 0 || accuracyA > accurate || accuracyB > accurate) continue;
    const speed = distanceMeters([lonA, latA], [lonB, latB]) / seconds;
    if (speed > DIAGNOSIS_POLICY.implausibleSpeed) {
      add({
        category: "gps-accuracy", certainty: "possible", fromFix: index - 1, toFix: index,
        evidence: { impliedSpeedMetersPerSecond: round(speed), seconds: round(seconds) },
        check: "Salto di posizione con precisione dichiarata buona: probabile riflesso (multipath). Controlla se la freccia è saltata su una via vicina.",
      });
    }
  }

  // 2. App interruption: silences between fixes, with what the page reported meanwhile.
  const eventsBetween = (from: number, to: number, type: string) => trace.events.filter((event) => event.type === type && event.atFix > from && event.atFix <= to).length;
  for (let index = 1; index < trace.fixes.length; index += 1) {
    const seconds = (trace.fixes[index][0] - trace.fixes[index - 1][0]) / 1000;
    if (seconds < DIAGNOSIS_POLICY.gapSeconds) continue;
    const hidden = eventsBetween(index - 1, index, "page-hidden");
    const signalLoss = eventsBetween(index - 1, index, "signal-loss");
    const rearm = eventsBetween(index - 1, index, "gps-rearm");
    add({
      category: "app-interruption", certainty: hidden ? "measured" : "possible", fromFix: index - 1, toFix: index,
      evidence: { seconds: round(seconds), pageHidden: hidden > 0, signalLoss: signalLoss > 0, gpsRearm: rearm > 0 },
      check: hidden
        ? `Nessuna rilevazione per ${round(seconds, 0)} s mentre la pagina era nascosta: schermo bloccato o app in secondo piano. iOS sospende la navigazione web in background.`
        : `Nessuna rilevazione per ${round(seconds, 0)} s con la pagina visibile: perdita del segnale GPS o aggiornamenti sospesi dal sistema.`,
    });
  }
  for (const event of trace.events.filter((item) => item.type === "wake-lock" && item.detail === "false")) {
    add({
      category: "app-interruption", certainty: "measured", fromFix: eventFix(event.atFix), toFix: eventFix(event.atFix),
      evidence: { wakeLock: false },
      check: "Il blocco dello schermo acceso è stato rilasciato: lo schermo può spegnersi e sospendere la navigazione.",
    });
  }

  // 3. Map matching: accurate fixes near the route but not on it, and progress held back.
  for (let index = 0; index < trace.decisions.length;) {
    const near = (i: number) => {
      const candidate = trace.decisions[i];
      return accepted(candidate) && trace.fixes[i][3] <= accurate && candidate.offRouteMeters !== null
        && candidate.offRouteMeters >= DIAGNOSIS_POLICY.ambiguousOffRouteMeters && candidate.offRouteMeters < policy.offRouteMeters
        && !candidate.shouldRecalculate;
    };
    if (!near(index)) { index += 1; continue; }
    let end = index;
    while (end + 1 < trace.decisions.length && near(end + 1)) end += 1;
    if (end - index + 1 >= DIAGNOSIS_POLICY.ambiguousRun) {
      const distances = trace.decisions.slice(index, end + 1).map((item) => (item as Accepted).offRouteMeters ?? 0);
      add({
        category: "map-matching", certainty: "possible", fromFix: index, toFix: end,
        evidence: { fixes: end - index + 1, maxOffRouteMeters: round(Math.max(...distances)), thresholdMeters: policy.offRouteMeters },
        check: "Posizioni precise a 15–" + policy.offRouteMeters + " m dal percorso per diversi secondi: strada parallela, controviale o geometria del percorso spostata. Controlla su quale carreggiata eri.",
      });
    }
    index = end + 1;
  }
  for (let index = 0; index < trace.decisions.length;) {
    const held = (i: number) => accepted(trace.decisions[i]) && (trace.decisions[i] as Accepted).pendingJump !== null;
    if (!held(index)) { index += 1; continue; }
    let end = index;
    while (end + 1 < trace.decisions.length && held(end + 1)) end += 1;
    if (end - index + 1 >= DIAGNOSIS_POLICY.heldRun) {
      add({
        category: "map-matching", certainty: "measured", fromFix: index, toFix: end,
        evidence: { fixes: end - index + 1, jumpToMeters: round((trace.decisions[end] as Accepted).pendingJump!.progressMeters) },
        check: "L'avanzamento è stato trattenuto: la posizione indicava un punto molto più avanti sul percorso. Controlla se il percorso passa due volte vicino allo stesso punto.",
      });
    }
    index = end + 1;
  }

  // 4. Wrong-turn detection: late or missing detection, and possibly false triggers.
  const rerouteFixes = new Set(trace.decisions.flatMap((decision, index) => accepted(decision) && decision.shouldRecalculate ? [index] : []));
  // While a calculation runs or the reroute cooldown lasts, the app rightly does not start another.
  const mayReroute = (i: number) => {
    const [, , , , , , now, lastCalculationAt, calculating, cooldownMs] = trace.fixes[i];
    return calculating === 0 && now - lastCalculationAt >= cooldownMs;
  };
  for (let index = 0; index < trace.decisions.length;) {
    const off = (i: number) => {
      const candidate = trace.decisions[i];
      return accepted(candidate) && trace.fixes[i][3] <= accurate && (candidate.offRouteMeters ?? 0) > policy.offRouteMeters
        && mayReroute(i);
    };
    if (!off(index)) { index += 1; continue; }
    let end = index;
    while (end + 1 < trace.decisions.length && off(end + 1) && !rerouteFixes.has(end)) end += 1;
    const detectedAt = [...rerouteFixes].find((fix) => fix >= index && fix <= end + 1);
    const seconds = ((fixTime(detectedAt ?? end) ?? 0) - (fixTime(index) ?? 0)) / 1000;
    if (detectedAt === undefined && end - index + 1 >= policy.readings + 2) {
      add({
        category: "wrong-turn-detection", certainty: "measured", fromFix: index, toFix: end,
        evidence: { fixes: end - index + 1, seconds: round(seconds), thresholdMeters: policy.offRouteMeters, detected: false },
        check: "Fuori percorso con GPS preciso senza ricalcolo: verifica se eri davvero fuori strada o se il percorso mostrato era sbagliato in quel punto.",
      });
    } else if (detectedAt !== undefined && seconds > DIAGNOSIS_POLICY.lateDetectionSeconds) {
      add({
        category: "wrong-turn-detection", certainty: "measured", fromFix: index, toFix: detectedAt,
        evidence: { seconds: round(seconds), thresholdMeters: policy.offRouteMeters, detected: true },
        check: `L'uscita dal percorso è stata riconosciuta dopo ${round(seconds, 0)} s: verifica se la svolta sbagliata era su una via parallela vicina.`,
      });
    }
    index = end + 1;
  }
  for (const fix of [...rerouteFixes].sort((a, b) => a - b)) {
    const previous = trace.decisions.slice(Math.max(0, fix - 3), fix + 1).filter(accepted);
    if (previous.length < 2) continue;
    const farthest = Math.max(...previous.map((item) => item.offRouteMeters ?? 0));
    if (farthest < policy.offRouteMeters * DIAGNOSIS_POLICY.falseTriggerShare) {
      add({
        category: "wrong-turn-detection", certainty: "possible", fromFix: fix, toFix: fix,
        evidence: { maxOffRouteMeters: round(farthest), thresholdMeters: policy.offRouteMeters },
        check: "Ricalcolo partito con posizioni vicine al percorso (svolta riconosciuta dalla direzione): verifica se avevi davvero lasciato il percorso.",
      });
    }
  }

  // 5. Routing API: failures and slow answers.
  for (const event of trace.events.filter((item) => item.type === "reroute-failure")) {
    add({
      category: "routing-api", certainty: "measured", fromFix: eventFix(event.atFix), toFix: eventFix(event.atFix),
      evidence: { result: event.detail ?? "unknown" },
      check: event.detail === "timeout"
        ? "Il ricalcolo non ha risposto in tempo: servizio di routing lento o rete debole. L'app ha continuato sull'ultimo percorso."
        : `Il ricalcolo è fallito (${event.detail ?? "errore"}): problema del servizio o della rete, non del percorso.`,
    });
  }
  const starts = trace.events.filter((item) => item.type === "reroute-start");
  for (const start of starts) {
    const answer = trace.events.find((item) => (item.type === "reroute-success" || item.type === "reroute-failure") && item.atFix >= start.atFix);
    if (!answer || answer.type !== "reroute-success") continue;
    const begin = eventTime(start.atFix), end = eventTime(answer.atFix);
    if (begin === null || end === null) continue;
    const seconds = (end - begin) / 1000;
    if (seconds > DIAGNOSIS_POLICY.slowRerouteSeconds) {
      add({
        category: "routing-api", certainty: "possible", fromFix: eventFix(start.atFix), toFix: eventFix(answer.atFix),
        evidence: { secondsUntilNewRoute: round(seconds) },
        check: "Il nuovo percorso è arrivato tardi (misurato tra le rilevazioni, quindi approssimato): servizio di routing lento o rete debole.",
      });
    }
  }

  // 6. Instructions: skipped manoeuvres, late voice prompts, deviations right after a manoeuvre.
  for (const id of [...new Set(replay.skippedInstructions)].sort()) {
    const fix = trace.decisions.findIndex((decision) => accepted(decision) && decision.instructionId === id);
    add({
      category: "instructions", certainty: "measured", fromFix: Math.max(0, fix), toFix: Math.max(0, fix),
      evidence: { instructionId: id },
      check: "Un'indicazione è stata saltata da un avanzamento improvviso: verifica sul posto se la manovra era necessaria.",
    });
  }
  for (const event of trace.events.filter((item) => item.type === "voice-spoken" && item.detail)) {
    const fix = eventFix(event.atFix);
    const decision = trace.decisions[fix];
    const active = routeAt(fix);
    if (!accepted(decision) || decision.progressMeters === null || !active) continue;
    const manoeuvre = modelFor(active.number).instructions.find(({ instruction }) => instruction.id === event.detail);
    if (manoeuvre && decision.progressMeters > manoeuvre.progressMeters + 10) {
      add({
        category: "instructions", certainty: "measured", fromFix: fix, toFix: fix,
        evidence: { instructionId: event.detail!, passedByMeters: round(decision.progressMeters - manoeuvre.progressMeters) },
        check: "L'indicazione vocale è arrivata dopo il punto della manovra: verifica il ritardo del GPS in quel tratto.",
      });
    }
  }
  for (let index = 1; index < trace.decisions.length; index += 1) {
    const decision = trace.decisions[index];
    const previous = trace.decisions[index - 1];
    if (!accepted(decision) || !accepted(previous) || !decision.shouldRecalculate || decision.progressMeters === null) continue;
    const active = routeAt(index);
    if (!active) continue;
    const before = modelFor(active.number).instructions
      .filter(({ progressMeters }) => progressMeters <= decision.progressMeters! + 5 && decision.progressMeters! - progressMeters <= DIAGNOSIS_POLICY.deviationAfterManoeuvreMeters)
      .at(-1);
    if (before?.instruction.id) {
      add({
        category: "instructions", certainty: "possible", fromFix: index, toFix: index,
        evidence: { instructionId: before.instruction.id, metersAfterManoeuvre: round(decision.progressMeters - before.progressMeters) },
        check: "Uscita dal percorso subito dopo una manovra: controlla se l'indicazione corrispondeva alla strada (svolta vietata, corsia, nome della via).",
      });
    }
  }

  // 7. Pavé evidence: warnings shown before each rough section, and the tester's own notes.
  const shown = trace.events.filter((item) => item.type === "pave-warning-shown" && item.detail).map((item) => {
    const [start, distance] = item.detail!.split(":").map(Number);
    return { atFix: item.atFix, start, distance };
  });
  trace.routes.forEach((route, number) => {
    const until = trace.routes[number + 1]?.atFix ?? trace.fixes.length;
    for (const section of route.roughSections ?? []) {
      const entered = trace.decisions.findIndex((decision, index) => index >= route.atFix && index < until
        && accepted(decision) && decision.progressMeters !== null && decision.progressMeters >= section.startMeters);
      if (entered < 0) continue;
      const warning = shown.find((item) => item.atFix >= route.atFix && item.atFix <= entered + 1 && Math.abs(item.start - section.startMeters) < 1);
      const lead = PAVE_WARNING_POLICY[mode].hudMeters;
      if (!warning) {
        add({
          category: "pave-evidence", certainty: "measured", fromFix: entered, toFix: entered,
          evidence: { sectionStartMeters: round(section.startMeters), confirmedMeters: section.confirmedMeters, probableMeters: section.probableMeters, ...(section.name ? { street: section.name } : {}), warningShown: false },
          check: "Sei entrato in un tratto di pavé previsto senza che l'avviso fosse mostrato prima: verifica se l'avviso è comparso sullo schermo.",
        });
      } else if (warning.distance < lead / 2 && section.startMeters - route.progressMeters >= lead / 2) {
        // Late only if the route gave room for an earlier warning: a reroute or start just before
        // the section cannot warn from farther away.
        add({
          category: "pave-evidence", certainty: "measured", fromFix: eventFix(warning.atFix), toFix: entered,
          evidence: { sectionStartMeters: round(section.startMeters), warnedAtMeters: warning.distance, expectedFromMeters: lead },
          check: "L'avviso di pavé è comparso a poca distanza dal tratto: verifica se c'era tempo per prepararsi.",
        });
      }
    }
  });
  for (const event of trace.events.filter((item) => item.type === "field-note" && item.detail && PAVE_NOTE_KINDS.has(item.detail))) {
    add({
      category: "pave-evidence", certainty: "possible", fromFix: eventFix(event.atFix), toFix: eventFix(event.atFix),
      evidence: { noteKind: event.detail! },
      check: event.detail === "unmapped_pave"
        ? "Hai segnalato pavé non in mappa qui: verifica il tag surface di OSM e fotografa il tratto."
        : event.detail === "false_pave_smooth"
          ? "Hai segnalato asfalto dove la mappa indica pavé: verifica se la strada è stata rifatta."
          : event.detail === "incorrect_pave_warning"
            ? "Hai segnalato un avviso di pavé sbagliato qui: confronta la posizione dell'avviso con il tratto reale."
            : "Hai segnalato un fondo pericoloso qui: verifica il tratto sul posto.",
    });
  }

  // 8. Behaviour changed since the recording.
  if (replay.differences.length) {
    add({
      category: "behaviour-changed", certainty: "measured", fromFix: replay.differences[0].atFix, toFix: replay.differences.at(-1)!.atFix,
      evidence: { fixes: replay.differences.length },
      check: "Il codice attuale decide queste rilevazioni diversamente dall'app che le ha registrate: rileggi la traccia con questa versione prima di concludere.",
    });
  }

  findings.sort((a, b) => a.fromFix - b.fromFix || DIAGNOSIS_CATEGORIES.indexOf(a.category) - DIAGNOSIS_CATEGORIES.indexOf(b.category) || a.toFix - b.toFix);
  const counts = Object.fromEntries(DIAGNOSIS_CATEGORIES.map((category) => [category, findings.filter((item) => item.category === category).length])) as Record<DiagnosisCategory, number>;
  const first = fixTime(0), last = fixTime(trace.fixes.length - 1);
  return {
    traceId: trace.id,
    version: trace.version,
    synthetic: trace.synthetic === true,
    area: trace.area,
    mode: trace.mode,
    fixes: trace.fixes.length,
    routes: trace.routes.length,
    durationSeconds: first === null || last === null ? 0 : round((last - first) / 1000),
    replay: { accepted: replay.accepted, reroutes: replay.reroutes, decisionDifferences: replay.differences.length, arrived: replay.arrived },
    counts,
    findings,
  };
}
