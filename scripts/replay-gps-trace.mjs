/** Usage: node scripts/replay-gps-trace.mjs <trace.json> — replays a recorded GPS trace offline. */
import { readFile } from "node:fs/promises";
import { replayGpsTrace } from "../lib/gps-trace.ts";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/replay-gps-trace.mjs <trace.json>");
  process.exit(2);
}
const trace = JSON.parse(await readFile(path, "utf8"));
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
