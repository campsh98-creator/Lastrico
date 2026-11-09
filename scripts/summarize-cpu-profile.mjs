/**
 * Summarise a V8 `.cpuprofile` (node --cpu-prof): top self time and top inclusive time of the
 * app's own functions (lib/, app/, the data-URL routes handler). The benchmark harness is excluded
 * from the inclusive list, so what remains is the handler's own work.
 *
 *   node scripts/summarize-cpu-profile.mjs <file.cpuprofile> [top=25]
 */
import { readFileSync } from "node:fs";

const [file, topArg] = process.argv.slice(2);
const top = Number(topArg ?? 25);
const profile = JSON.parse(readFileSync(file, "utf8"));
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parent = new Map();
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);

// Sample durations: timeDeltas[i] is the time before sample i.
const self = new Map();
for (let index = 0; index < profile.samples.length; index += 1) {
  const id = profile.samples[index];
  self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
}
const shortUrl = (url) => url.startsWith("data:") ? "route.ts(data-url)"
  : url.replace(/^file:\/\/.*?\/Lastrico-App-Anti-Pave\//, "").replace(/^node:/, "node:");
const key = (frame) => `${frame.functionName || "(anonymous)"}  ${shortUrl(frame.url)}:${frame.lineNumber + 1}`;
const own = (frame) => /^(lib\/|app\/|route\.ts\(data-url\))/.test(shortUrl(frame.url));

const selfByKey = new Map();
const inclusiveByKey = new Map();
let total = 0;
for (const [id, ms] of self) {
  total += ms;
  const frame = nodes.get(id).callFrame;
  selfByKey.set(key(frame), (selfByKey.get(key(frame)) ?? 0) + ms);
  // Inclusive: credit each distinct own function on the stack once.
  const seen = new Set();
  for (let cursor = id; cursor !== undefined; cursor = parent.get(cursor)) {
    const callFrame = nodes.get(cursor).callFrame;
    if (!own(callFrame)) continue;
    const k = key(callFrame);
    if (seen.has(k)) continue;
    seen.add(k);
    inclusiveByKey.set(k, (inclusiveByKey.get(k) ?? 0) + ms);
  }
}
const print = (title, map) => {
  console.log(title);
  for (const [k, ms] of [...map].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    console.log(`${Math.round(ms).toString().padStart(8)} ms ${(100 * ms / total).toFixed(1).padStart(5)}%  ${k}`);
  }
};
console.log(`total sampled ${Math.round(total)} ms`);
print("TOP SELF:", selfByKey);
print("TOP INCLUSIVE (lib/app only):", inclusiveByKey);
