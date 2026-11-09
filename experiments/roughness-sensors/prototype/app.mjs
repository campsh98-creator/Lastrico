/**
 * DOM glue for the developer-only recording prototype. No network calls (the page CSP also sets
 * connect-src 'none'), no persistent storage: data lives in the recorder object in memory.
 */
import { analyseTrace } from "../src/analyse.mjs";
import { createRecorder } from "../src/recorder.mjs";
import { coreScenarios } from "../src/scenarios.mjs";
import { generateTrip } from "../src/synthetic.mjs";

const $ = (id) => document.getElementById(id);
const ui = {
  consent: $("consent-check"), mode: $("mode"), wakeLock: $("wake-lock"),
  start: $("start"), stop: $("stop"), discard: $("discard"), export: $("export"),
  message: $("message"), replayScenario: $("replay-scenario"), replayStart: $("replay-start"),
  results: $("results"), resultsKind: $("results-kind"), resultsSummary: $("results-summary"), resultsBody: $("results-body"),
};

const LABELS_IT = { smooth: "liscio", "rough-periodic": "ruvido-periodico (tipo pavé)", uncertain: "incerto" };
const REASONS_IT = {
  "gps-missing": "GPS assente", "too-slow": "troppo lento", "irregular-sampling": "campionamento irregolare",
  handling: "telefono maneggiato", "orientation-change": "cambio di orientamento", "run-edge": "bordo registrazione",
  "low-sample-rate": "frequenza troppo bassa", "too-few-usable-windows": "dati insufficienti", intermediate: "livello intermedio",
  "rough-not-periodic": "ruvido ma non periodico", "absolute-level-high": "livello assoluto alto (viaggio forse tutto ruvido)",
  "baseline-suspect": "riferimento dubbio", clipping: "sensore saturato", "clipping-lower-bound": "sensore saturato (stima minima)",
};
const BASIS_IT = {
  "low-relative-level": "vibrazione bassa", "sustained-and-periodic": "vibrazione continua e periodica",
  "sustained-only-periodicity-unresolvable": "vibrazione continua (periodicità non misurabile a questa velocità)",
};
const ISSUES_IT = {
  "no-motion-events": "nessun dato dai sensori (permesso negato, sensori assenti o pagina non sicura)",
  "low-sample-rate": "frequenza bassa", "phone-handled": "telefono in movimento in mano", "gps-missing": "GPS senza dati",
  "too-slow": "velocità troppo bassa",
};

let recorder = null;
let motionHandler = null;
let geoWatchId = null;
let wakeLockSentinel = null;
let liveTimer = null;
let replayTimer = null;
let lastTrace = null;
/** Time base of the current recorder: performance.now() live, simulated milliseconds in replay. */
let clock = () => performance.now();

function say(text) {
  ui.message.textContent = text;
}

function selectedGpsMode() {
  return document.querySelector('input[name="gps"]:checked')?.value ?? "off";
}

function setButtons(state) {
  const recording = state === "recording";
  ui.start.disabled = recording;
  ui.replayStart.disabled = recording;
  ui.stop.disabled = !recording;
  ui.discard.disabled = !recorder || state === "idle";
  ui.export.disabled = !lastTrace;
}

function renderLive() {
  if (!recorder) return;
  const stats = recorder.liveStats(clock());
  $("live-state").textContent = { idle: "fermo", recording: "registrazione", stopped: "fermato", full: "limite raggiunto" }[stats.state] ?? stats.state;
  $("live-samples").textContent = String(stats.samples);
  $("live-duration").textContent = `${stats.durationS.toFixed(1)} s`;
  $("live-rate").textContent = stats.rateHz ? `${stats.rateHz.toFixed(1)} Hz` : "—";
  $("live-interval").textContent = stats.reportedInterval === null ? "—" : `${stats.reportedInterval} (${stats.intervalUnit})`;
  $("live-channels").textContent = `${stats.gyroscope ? "sì" : "no"} / ${stats.linearAcceleration ? "sì" : "no"}`;
  $("live-rotation").textContent = stats.rotationPeakDegS === null ? "—" : `${stats.rotationPeakDegS.toFixed(0)} °/s`;
  $("live-gps").textContent = stats.gpsFixes ? `${stats.gpsFixes} fix, ${stats.lastSpeedMs === null ? "velocità n/d" : `${(stats.lastSpeedMs * 3.6).toFixed(0)} km/h`}, ±${stats.lastAccuracyM ?? "?"} m` : "—";
  $("live-memory").textContent = `${(stats.estimatedBytes / 1e6).toFixed(2)} MB`;
  $("live-quality").textContent = stats.issues.length ? stats.issues.map((issue) => ISSUES_IT[issue] ?? issue).join("; ") : "ok";
  if (stats.state === "full") finishRecording("Limite di durata raggiunto: registrazione fermata.");
}

function resetLive() {
  for (const id of ["live-rate", "live-interval", "live-channels", "live-rotation", "live-gps", "live-memory", "live-quality"]) $(id).textContent = "—";
  $("live-state").textContent = "fermo";
  $("live-samples").textContent = "0";
  $("live-duration").textContent = "0 s";
}

function startLive() {
  clearInterval(liveTimer);
  liveTimer = setInterval(renderLive, 500);
}

function releaseResources() {
  if (motionHandler) window.removeEventListener("devicemotion", motionHandler);
  motionHandler = null;
  if (geoWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(geoWatchId);
  geoWatchId = null;
  if (wakeLockSentinel) wakeLockSentinel.release().catch(() => {});
  wakeLockSentinel = null;
  clearInterval(replayTimer);
  replayTimer = null;
}

function renderAnalysis(trace) {
  ui.results.hidden = false;
  ui.resultsBody.replaceChildren();
  const synthetic = trace.dataKind === "synthetic";
  ui.resultsKind.textContent = synthetic
    ? "DATI SINTETICI — generati al computer, non una strada reale"
    : "Registrazione dal dispositivo — risultato sperimentale, non verificato";
  let analysis;
  try {
    analysis = analyseTrace(trace);
  } catch (error) {
    ui.resultsSummary.textContent = `Analisi non possibile: ${error.message}`;
    return;
  }
  const counts = analysis.summary.labelCounts;
  ui.resultsSummary.textContent = `${analysis.segments.length} tratti: ${counts.smooth} lisci, ${counts["rough-periodic"]} ruvidi-periodici, ${counts.uncertain} incerti. `
    + `Frequenza ${analysis.sampling.rateHz?.toFixed?.(1) ?? "?"} Hz, riferimento ${analysis.baseline.source === "trip-percentile" ? "dal viaggio" : "predefinito"}. `
    + "LRI = indice relativo non calibrato (non IRI).";
  for (const segment of analysis.segments) {
    const row = document.createElement("tr");
    const cells = [
      String(segment.index + 1),
      (segment.startMs / 1000).toFixed(1),
      segment.lengthM === null ? "—" : segment.lengthM.toFixed(0),
      segment.medianSpeedMs === null ? "—" : (segment.medianSpeedMs * 3.6).toFixed(0),
      LABELS_IT[segment.label],
      segment.lri === null ? "—" : segment.lri.toFixed(2),
      segment.label === "uncertain" ? segment.reasons.map((reason) => REASONS_IT[reason] ?? reason).join(", ") : BASIS_IT[segment.basis] ?? segment.basis,
      segment.events.length ? segment.events.map((event) => (event.kind === "slow-heave" ? "dosso" : "urto")).join(", ") : "",
    ];
    cells.forEach((text, index) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      if (index === 4) cell.className = `label-${segment.label}`;
      row.append(cell);
    });
    ui.resultsBody.append(row);
  }
}

function finishRecording(note) {
  if (!recorder || (recorder.state !== "recording" && recorder.state !== "full")) return;
  recorder.stop(performance.now());
  releaseResources();
  lastTrace = recorder.toTrace();
  renderLive();
  clearInterval(liveTimer);
  setButtons(recorder.state);
  say(note);
  renderAnalysis(lastTrace);
}

function beginRecording(config) {
  clock = () => performance.now();
  recorder = createRecorder(config);
  lastTrace = null;
  recorder.start(performance.now(), { userAgentClass: /iPhone|iPad/.test(navigator.userAgent) ? "ios" : /Android/.test(navigator.userAgent) ? "android" : "other" });
  motionHandler = (event) => recorder.addMotion(event, event.timeStamp);
  window.addEventListener("devicemotion", motionHandler);
  setButtons("recording");
  startLive();
}

/**
 * Click handler. DeviceMotionEvent.requestPermission() is called synchronously inside the user
 * gesture, before any await: WebKit rejects the request with NotAllowedError otherwise.
 */
function onStartClick() {
  if (!ui.consent.checked) {
    say("Per iniziare conferma di aver letto le informazioni sopra.");
    return;
  }
  const permission = typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function"
    ? DeviceMotionEvent.requestPermission()
    : Promise.resolve("not-required");
  const gpsMode = selectedGpsMode();
  const config = { mode: ui.mode.value, gpsMode, dataKind: "field-recording" };
  if (gpsMode !== "off" && navigator.geolocation) {
    geoWatchId = navigator.geolocation.watchPosition(
      (position) => recorder?.addPosition(position, position.timestamp - performance.timeOrigin),
      (error) => say(`GPS non disponibile (${error.code === 1 ? "permesso negato" : "errore"}). La registrazione dei sensori continua.`),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }
  if (ui.wakeLock.checked && navigator.wakeLock?.request) {
    navigator.wakeLock.request("screen").then((sentinel) => { wakeLockSentinel = sentinel; }).catch(() => say("Lo schermo potrebbe spegnersi: la registrazione si interrompe quando lo schermo si blocca."));
  }
  if (!window.isSecureContext) say("Attenzione: la pagina non è servita in HTTPS. Sul telefono i sensori verranno negati.");
  permission.then((state) => {
    if (state === "granted" || state === "not-required") {
      beginRecording(config);
      say("Registrazione avviata. Tieni la pagina aperta e visibile.");
      setTimeout(() => {
        if (recorder?.state === "recording" && recorder.rowCount === 0) {
          say("Nessun dato dai sensori: questo dispositivo potrebbe non avere sensori di movimento (es. computer o simulatore) oppure il permesso è stato negato. Prova la traccia sintetica.");
        }
      }, 2500);
    } else {
      releaseResources();
      say("Permesso per i sensori negato. Su iPhone: chiudi e riapri la pagina (o Safari) e consenti l'accesso a movimento e orientamento.");
    }
  }).catch((error) => {
    releaseResources();
    say(`Richiesta di permesso non riuscita (${error.name}). Deve partire da un tocco sul pulsante, su una pagina HTTPS.`);
  });
}

function onStopClick() {
  finishRecording("Registrazione fermata. I dati sono solo in questa pagina.");
}

function onDiscardClick() {
  releaseResources();
  recorder?.discard();
  recorder = null;
  lastTrace = null;
  clearInterval(liveTimer);
  ui.results.hidden = true;
  ui.resultsBody.replaceChildren();
  resetLive();
  setButtons("idle");
  say("Dati eliminati dalla memoria di questa pagina.");
}

function onExportClick() {
  if (!lastTrace) return;
  const blob = new Blob([JSON.stringify(lastTrace)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lastrico-vibrazioni-${lastTrace.dataKind}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say("File JSON creato sul dispositivo. Nessun dato è stato inviato.");
}

const REPLAY_IDS = ["car-mixed-p0.15-v8", "bike-mixed-p0.15-v3", "car-asphalt-events", "car-hand-mixed", "car-rough-asphalt-confounder"];
const replayScenarios = coreScenarios().filter((scenario) => REPLAY_IDS.includes(scenario.spec.id));
for (const scenario of replayScenarios) {
  const option = document.createElement("option");
  option.value = scenario.spec.id;
  option.textContent = `${scenario.spec.id} (${scenario.group})`;
  ui.replayScenario.append(option);
}

/** Feeds a synthetic trip through the same recorder and analysis, at 20x speed. */
function onReplayClick() {
  const scenario = replayScenarios.find((item) => item.spec.id === ui.replayScenario.value);
  if (!scenario) return;
  releaseResources();
  const { trace } = generateTrip(scenario.spec);
  recorder = createRecorder({ mode: trace.meta.mode, gpsMode: trace.meta.gpsMode, dataKind: "synthetic" });
  lastTrace = null;
  const origin = performance.now();
  recorder.start(0, { synthetic: trace.meta.synthetic, notice: trace.meta.notice });
  const motion = trace.motion.rows;
  const gps = trace.gps.rows;
  let motionIndex = 0;
  let gpsIndex = 0;
  let simulatedMs = 0;
  clock = () => simulatedMs;
  setButtons("recording");
  startLive();
  say("Riproduzione di una traccia SINTETICA (velocità 20×)…");
  replayTimer = setInterval(() => {
    simulatedMs += 1000;
    while (motionIndex < motion.length && motion[motionIndex][0] <= simulatedMs) {
      const [t, ax, ay, az, lx, ly, lz, ra, rb, rg] = motion[motionIndex];
      recorder.addMotion({
        accelerationIncludingGravity: { x: ax, y: ay, z: az },
        acceleration: { x: lx, y: ly, z: lz },
        rotationRate: { alpha: ra, beta: rb, gamma: rg },
        interval: 1000 / 60,
      }, t);
      motionIndex += 1;
    }
    while (gpsIndex < gps.length && gps[gpsIndex][0] <= simulatedMs) {
      const [t, latitude, longitude, accuracy, speed, heading] = gps[gpsIndex];
      recorder.addPosition({ coords: { latitude, longitude, accuracy, speed, heading } }, t);
      gpsIndex += 1;
    }
    if (motionIndex >= motion.length) {
      clearInterval(replayTimer);
      replayTimer = null;
      recorder.stop(simulatedMs);
      lastTrace = recorder.toTrace();
      clearInterval(liveTimer);
      renderLive();
      setButtons(recorder.state);
      say(`Traccia sintetica riprodotta in ${((performance.now() - origin) / 1000).toFixed(1)} s.`);
      renderAnalysis(lastTrace);
    }
  }, 50);
}

document.addEventListener("visibilitychange", () => {
  if (!recorder || recorder.state !== "recording" || replayTimer) return;
  recorder.addEvent(document.visibilityState === "hidden" ? "page-hidden" : "page-visible", performance.now());
  if (document.visibilityState === "visible") say("La pagina è stata nascosta: in quel periodo i sensori non hanno registrato (buco nei dati).");
});

ui.start.addEventListener("click", onStartClick);
ui.stop.addEventListener("click", onStopClick);
ui.discard.addEventListener("click", onDiscardClick);
ui.export.addEventListener("click", onExportClick);
ui.replayStart.addEventListener("click", onReplayClick);
setButtons("idle");
