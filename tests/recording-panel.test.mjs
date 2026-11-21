import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("the recorder is offered in the preferences next to the other options, before any destination or navigation", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /import \{ RecordingPanel, useFreeRecording \} from "@\/components\/RecordingPanel"/);
  assert.match(page, /const freeRecording = useFreeRecording\(\)/, "the recording lives in the page, so folding the panel does not stop it");
  const panel = page.indexOf("<RecordingPanel recording={freeRecording} />");
  for (const neighbour of ['data-testid="tram-preference"', 'data-testid="traffic-preference"', 'data-testid="ztl-settings"']) {
    const at = page.indexOf(neighbour);
    assert.ok(at > 0 && panel > 0, neighbour);
  }
  assert.ok(panel > page.indexOf('data-testid="tram-preference"') && panel < page.indexOf('data-testid="ztl-settings"'), "between Binari and ZTL, in the same panel");
});

test("the panel exposes every control the recorder promises, and says honestly what a web page cannot do", async () => {
  const source = await read("components/RecordingPanel.tsx");
  for (const id of ["recording-start", "recording-pause", "recording-resume", "recording-stop", "recording-export-gpx", "recording-export-geojson", "recording-import", "recording-discard", "recording-recovered"]) {
    assert.ok(source.includes(`data-testid="${id}"`), id);
  }
  assert.match(source, /watchPosition/);
  assert.match(source, /recoverActiveRecording/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /markPageHidden/);
  assert.match(source, /iPhone sospende la pagina/, "no background-recording claim");
  assert.ok(!/background recording|in background/i.test(source.replace(/\/\*[\s\S]*?\*\//g, "")), "never claims background recording");
});

test("a recovered recording is offered, never resumed on its own", async () => {
  const source = await read("components/RecordingPanel.tsx");
  const recovery = source.slice(source.indexOf("recoverActiveRecording(store"), source.indexOf("}, [refresh]);"));
  assert.ok(!recovery.includes("arm()"), "recovery does not start the GPS watch");
});
