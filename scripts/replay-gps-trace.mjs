/**
 * Replays a recorded GPS trace offline, deterministically.
 *
 *   node scripts/replay-gps-trace.mjs <trace.json>              replay summary (JSON)
 *   node scripts/replay-gps-trace.mjs <trace.json> --diagnose   Phase 4.34 findings by category (JSON)
 *   node scripts/replay-gps-trace.mjs <trace.json> --text       the same findings, readable (Italian)
 *   node scripts/replay-gps-trace.mjs <trace.json> --gpx=<out>  also writes the trace as GPX
 *
 * The file is validated first (lib/gps-trace.ts parseGpsTrace). Nothing is sent anywhere.
 */
import { readFile, writeFile } from "node:fs/promises";
import { gpsTraceToGpx, parseGpsTrace, replayGpsTrace } from "../lib/gps-trace.ts";
import { diagnoseGpsTrace } from "../lib/trace-diagnosis.ts";

const args = process.argv.slice(2);
const path = args.find((arg) => !arg.startsWith("--"));
if (!path) {
  console.error("Usage: node scripts/replay-gps-trace.mjs <trace.json> [--diagnose | --text] [--gpx=<out.gpx>]");
  process.exit(2);
}
const trace = parseGpsTrace(await readFile(path, "utf8"));
const gpx = args.find((arg) => arg.startsWith("--gpx="))?.slice("--gpx=".length);
if (gpx) await writeFile(gpx, gpsTraceToGpx(trace));

const LABELS = {
  "gps-accuracy": "Precisione GPS",
  "map-matching": "Aggancio alla strada",
  "wrong-turn-detection": "Riconoscimento della svolta sbagliata",
  "routing-api": "Servizio di routing",
  "instructions": "Indicazioni",
  "pave-evidence": "Dati sul pavé",
  "app-interruption": "Interruzioni dell'app",
  "behaviour-changed": "Comportamento cambiato",
};

if (args.includes("--diagnose") || args.includes("--text")) {
  const diagnosis = diagnoseGpsTrace(trace);
  if (args.includes("--text")) {
    const lines = [
      `Traccia ${diagnosis.traceId}${diagnosis.synthetic ? " (sintetica)" : ""} · ${diagnosis.area} · ${diagnosis.mode} · ${diagnosis.fixes} rilevazioni · ${Math.round(diagnosis.durationSeconds / 60)} min`,
      `Riproduzione: ${diagnosis.replay.reroutes} ricalcoli, ${diagnosis.replay.decisionDifferences} decisioni diverse, arrivo ${diagnosis.replay.arrived ? "sì" : "no"}`,
      "",
    ];
    for (const finding of diagnosis.findings) {
      const where = finding.coordinate ? ` [${finding.coordinate.join(", ")}]` : "";
      lines.push(`${finding.at ?? "-"} #${finding.fromFix}${finding.toFix !== finding.fromFix ? `–${finding.toFix}` : ""} · ${LABELS[finding.category]} · ${finding.certainty === "measured" ? "misurato" : "possibile"}${where}`);
      lines.push(`  ${finding.check}`);
      lines.push(`  ${JSON.stringify(finding.evidence)}`);
    }
    if (!diagnosis.findings.length) lines.push("Nessuna anomalia rilevata dalla traccia. Non significa che il percorso fosse corretto.");
    console.log(lines.join("\n"));
  } else {
    console.log(JSON.stringify(diagnosis, null, 2));
  }
} else {
  const { differences, ...summary } = replayGpsTrace(trace);
  console.log(JSON.stringify({
    id: trace.id,
    synthetic: trace.synthetic === true,
    startedAt: trace.startedAt,
    area: trace.area,
    mode: trace.mode,
    ...summary,
    decisionDifferences: differences.length,
    firstDifferences: differences.slice(0, 5),
  }, null, 2));
}
