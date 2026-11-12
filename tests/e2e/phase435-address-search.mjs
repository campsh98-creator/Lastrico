/**
 * Phase 4.35 browser stress test of the address search, in real Chrome (Chromium, the engine of
 * Microsoft Edge). It drives the planner like a person and checks what is on screen after every
 * edit, while /api/geocode and /api/routes are answered by a programmable fake provider:
 * normal, slow and out of order, empty, HTTP 429, HTTP 503, an HTML 502, a dropped connection and
 * a request that never answers.
 *
 *   npm run build && npx wrangler dev --config dist/server/wrangler.json --port 8799 --local
 *   node tests/e2e/phase435-address-search.mjs [--edits=50] [--out=results.json] [--live]
 *
 * LASTRICO_E2E_BASE points it elsewhere (for a before/after comparison against an older build).
 * With --live, the address API is not faked: the real providers answer (a few requests only).
 *
 * Every edit is judged on what the person sees:
 *   rows     the list shows rows for the current text only (a provider row carries the text it was
 *            asked for, so a stale or out-of-order answer is detected);
 *   status   when the provider failed or found nothing, the list says so;
 *   silent   nothing at all on screen: the Phase 4.34 failure;
 *   stale    a row for older text is on screen.
 */
import { writeFileSync } from "node:fs";
import { BASE, openApp, sleep, waitForPhase } from "./helpers.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=");
  return [key, value];
}));
const EDITS = Number(args.edits ?? 50);
const LIVE = args.live === "true";
const OUT = args.out ?? null;
const PORT = Number(args.port ?? 9435);
const fixture = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("fixtures/milan-car.json", import.meta.url), "utf8"));

// Streets the local index must find whatever the provider does, and places only a provider knows.
const STREETS = [
  { text: "Via Filippo Argelati", expect: "Via Filippo Argelati" },
  { text: "Argelati", expect: "Via Filippo Argelati" },
  { text: "Via F. Argelati", expect: "Via Filippo Argelati" },
  { text: "via filippo argelati, milano", expect: "Via Filippo Argelati" },
  { text: "Corso Buenos Aires", expect: "Corso Buenos Aires" },
  { text: "Viale Monza", expect: "Viale Monza" },
  { text: "Via Savona", expect: "Via Savona" },
  { text: "Via dei Missaglia", expect: "Via dei Missaglia" },
  { text: "Via Gallarate", expect: "Via Gallarate" },
  { text: "Via Ucelli di Nemi", expect: "Via Guido Ucelli di Nemi" },
  { text: "Piazza XXIV Maggio", expect: "Piazza Ventiquattro Maggio" },
  { text: "p.za duomo", expect: "Piazza del Duomo" },
];
const PLACES = ["Darsena", "Stazione Centrale", "Navigli", "Porta Romana"];
const MODES = ["ok", "ok", "slow", "empty", "429", "503", "html502", "network", "hang"];

const provider = {
  mode: "ok",
  calls: [],
  answer(url) {
    const q = url.searchParams.get("q");
    const purpose = url.searchParams.get("purpose");
    this.calls.push({ q, purpose, mode: this.mode, at: Date.now() });
    const row = (suffix, coordinate = [9.18, 45.46]) => ({
      id: `fake:${q}:${suffix}`,
      label: `${q} ${suffix}, Fornitore`,
      primary: `${q} ${suffix}`,
      secondary: `Fornitore · ${q}`,
      coordinate,
      type: "place",
    });
    // Only number 12 exists at the fake provider; 14 is a civic number it does not know.
    const house = /\b12\b/.test(q) ? [{ id: `fake:${q}:house`, label: "Via Filippo Argelati 12, Navigli · 20144 · Milano", primary: "Via Filippo Argelati 12", secondary: "Navigli · 20144 · Milano", coordinate: [9.1712, 45.4489], type: "house" }] : [];
    switch (this.mode) {
      case "ok": return { body: { results: [...house, row("(luogo)")] } };
      case "slow": return { body: { results: [...house, row("(luogo)")] }, delayMs: 200 + Math.floor(Math.random() * 1400) };
      case "empty": return { body: { results: [] } };
      case "429": return { status: 429, body: { error: "Troppe richieste.", retryable: true, reason: "rate_limited" } };
      case "503": return { status: 503, body: { error: "La ricerca indirizzi è temporaneamente indisponibile.", retryable: true, reason: "providers_unavailable" } };
      case "html502": return { status: 502, body: "<html><body>502 Bad Gateway</body></html>" };
      case "network": return { abort: "ConnectionReset" };
      case "hang": return { body: { results: [row("(tardiva)")] }, delayMs: 9_500 };
      default: throw new Error(this.mode);
    }
  },
};

const session = await openApp({ port: PORT, width: 390, height: 844, mobile: true });
const result = { base: BASE, live: LIVE, edits: [], summary: null, console: [], exceptions: [] };

try {
  if (!LIVE) {
    await session.intercept(/\/api\/geocode\?/, (request) => provider.answer(new URL(request.url)));
  }
  await session.intercept(/\/api\/routes\?/, () => ({ body: fixture, delayMs: 1_200 }));

  const ui = () => session.evaluate(`(() => {
    const list = document.querySelector("[data-testid=address-suggestions]");
    const rows = list ? [...list.querySelectorAll("[role=option]")].map((row) => ({
      primary: row.querySelector("b")?.textContent ?? "",
      secondary: row.querySelector("small")?.textContent ?? "",
      source: row.dataset.source ?? null,
    })) : [];
    const status = list?.querySelector("[data-testid=address-search-status]");
    return {
      start: document.querySelector("#start-search")?.value ?? null,
      end: document.querySelector("#end-search")?.value ?? null,
      listFor: list?.dataset.target ?? (list ? list.closest(".route-field-wrapper")?.querySelector("input")?.id?.replace("-search", "") : null),
      rows,
      status: status ? { kind: status.dataset.kind, text: status.textContent.trim(), retry: Boolean(status.querySelector("[data-testid=address-search-retry]")) } : null,
      appStatus: document.querySelector("[data-testid=status-text]")?.innerText ?? null,
      planner: Boolean(document.querySelector("#start-search")),
    };
  })()`);

  async function ensurePlanner() {
    // A calculation from typed text can open the "Scegli l’indirizzo" picker (several matches):
    // a person chooses there before typing again, so the test does too.
    if (await session.evaluate(`Boolean(document.querySelector("[data-testid=address-picker] .address-picker-results button"))`)) {
      result.pickerChoices = (result.pickerChoices ?? 0) + 1;
      await session.tap("[data-testid=address-picker] .address-picker-results button");
      await sleep(400);
    }
    if (await session.evaluate(`Boolean(document.querySelector("#start-search"))`)) return;
    if (await session.evaluate(`Boolean(document.querySelector("[data-testid=edit-route]"))`)) await session.tap("[data-testid=edit-route]");
    await session.waitFor(`Boolean(document.querySelector("#start-search"))`, 8_000, "planner inputs");
  }

  const setValue = (field, value) => session.evaluate(`(() => {
    const input = document.querySelector("#${field}-search");
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);

  async function type(field, text, { perChar = 60, clear = true } = {}) {
    await ensurePlanner();
    if (clear) await setValue(field, "");
    for (let length = 1; length <= text.length; length += 1) {
      await setValue(field, text.slice(0, length));
      if (perChar) await sleep(perChar);
    }
  }

  async function erase(field, count, perChar = 40) {
    const current = (await ui())[field] ?? "";
    for (let index = 1; index <= count && index <= current.length; index += 1) {
      await setValue(field, current.slice(0, current.length - index));
      await sleep(perChar);
    }
  }

  // Settled: the provider was asked for exactly this text and its answer (or failure, or the
  // client's 8 s timeout for a hanging request) has had time to reach the screen. Live: no spinner.
  const ANSWER_MS = { ok: 300, slow: 1_900, empty: 300, 429: 300, 503: 300, html502: 300, network: 300, hang: 8_600, live: 4_800 };
  async function settle(field, text, mode, since, ms = 11_000) {
    const started = Date.now();
    const query = text.trim();
    let asked = null;
    let last = await ui();
    while (Date.now() - started < ms) {
      last = await ui();
      asked ??= LIVE ? (last.status?.kind !== "searching" && (last.rows.length || last.status) ? Date.now() : null)
        : provider.calls.find((call) => call.at >= since && call.q === query)?.at ?? null;
      if (asked && Date.now() - asked >= (ANSWER_MS[mode] ?? 600) && last.status?.kind !== "searching") return { ...last, asked: true };
      // No request at all: the answer came from the page's five-minute cache of this exact text.
      if (!LIVE && !asked && Date.now() - started > 1_500 && last.rows.length) return { ...last, asked: false };
      await sleep(120);
    }
    return { ...last, asked: Boolean(asked) };
  }

  function judge(field, text, state, mode, expect) {
    const query = text.trim();
    const own = state.listFor === field;
    const providerRows = own ? state.rows.filter((row) => row.source === "provider" || row.secondary.startsWith("Fornitore")) : [];
    const stale = providerRows.some((row) => row.secondary.startsWith("Fornitore") && row.secondary !== `Fornitore · ${query}`);
    const localFirst = own && state.rows[0] && expect ? state.rows[0].primary.startsWith(expect) : null;
    let outcome;
    if (stale) outcome = "stale";
    else if (own && state.rows.length) outcome = "rows";
    else if (own && state.status) outcome = "status";
    else outcome = "silent";
    const failure = ["429", "503", "html502", "network", "hang"].includes(mode);
    const honest = outcome === "stale" ? false
      : failure ? Boolean(own && state.status && ["partial", "unavailable"].includes(state.status.kind))
        : mode === "empty" ? Boolean(own && (state.rows.length || state.status?.kind === "empty"))
          : outcome === "rows"; // ok, slow, cached
    return { outcome, honest, localFirst, statusKind: own ? state.status?.kind ?? null : null, rows: own ? state.rows.length : 0 };
  }

  async function pick(field) {
    try {
      await session.tap(`[data-testid=address-suggestions][data-target=${field}] [data-testid=address-suggestion-0]`);
    } catch {
      await session.tap(`[data-testid=address-suggestions] [data-testid=address-suggestion-0]`);
    }
    await sleep(400);
    return (await ui())[field];
  }

  let seed = 435;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const choose = (items) => items[Math.floor(random() * items.length)];

  for (let n = 1; n <= EDITS; n += 1) {
    const field = n % 2 ? "start" : "end";
    const action = n % 10 === 0 ? "swap-then-edit" : n % 7 === 0 ? "rapid" : n % 5 === 0 ? "erase-retype" : n % 3 === 0 ? "place" : "street";
    const mode = LIVE ? "live" : choose(MODES);
    provider.mode = mode === "live" ? "ok" : mode;
    const target = action === "place" ? { text: choose(PLACES), expect: null } : choose(STREETS);
    const started = Date.now();
    if (action === "swap-then-edit") {
      await ensurePlanner();
      await session.tap("[data-testid=swap-locations]").catch(() => {});
      await sleep(LIVE ? 2_500 : 120);
      await ensurePlanner();
    }
    if (action === "rapid") {
      await type(field, target.text, { perChar: 15 });
    } else if (action === "erase-retype") {
      await type(field, target.text, { perChar: 50 });
      await erase(field, 4);
      const current = (await ui())[field];
      await type(field, target.text.slice(current.length), { perChar: 50, clear: false });
      await setValue(field, target.text);
    } else {
      await type(field, target.text, { perChar: 70 });
    }
    const state = await settle(field, target.text, mode, started);
    const verdict = judge(field, target.text, state, state.asked || LIVE ? mode : "cached", target.expect);
    let picked = null;
    // Pick on most edits so routes get calculated and the next edit happens during or after one.
    if (verdict.rows && n % 4 !== 0) picked = await pick(field).catch((error) => `TAP-FAIL ${error.message}`);
    const record = { n, field, action, mode: state.asked || LIVE ? mode : `${mode}→cached`, text: target.text, ms: Date.now() - started, ...verdict, status: state.status?.text ?? null, firstRow: state.rows[0]?.primary ?? null, picked };
    result.edits.push(record);
    console.log(`#${String(n).padStart(2)} ${field.padEnd(5)} ${action.padEnd(14)} ${record.mode.padEnd(14)} ${JSON.stringify(target.text).padEnd(32)} → ${verdict.outcome.padEnd(6)} honest=${verdict.honest} first=${JSON.stringify(record.firstRow)} status=${record.statusKind ?? "-"}${picked ? ` picked=${JSON.stringify(picked).slice(0, 60)}` : ""}`);
  }

  // Civic numbers: exact position when the provider has it, the street (said plainly) when not.
  const civic = {};
  if (!LIVE) {
    await ensurePlanner();
    provider.mode = "ok";
    let since = Date.now();
    await type("start", "Via Filippo Argelati 12", { perChar: 30 });
    let state = await settle("start", "Via Filippo Argelati 12", "ok", since);
    civic.knownNumberFirstRow = state.rows[0] ?? null;
    await pick("start");
    civic.knownNumberLabel = (await ui()).start;

    provider.mode = "empty";
    since = Date.now();
    await type("end", "Via Filippo Argelati 14", { perChar: 30 });
    state = await settle("end", "Via Filippo Argelati 14", "empty", since);
    civic.unknownNumberRow = state.rows[0] ?? null;
    const beforeTap = provider.calls.length;
    await session.tap(`[data-testid=address-suggestions] [data-testid=address-suggestion-0]`);
    await session.waitFor(`document.querySelector("#end-search") === null || !document.activeElement || document.querySelector("#end-search").value.includes("Conchetta")`, 10_000, "civic lookup").catch(() => {});
    await sleep(600);
    civic.unknownNumberLookup = provider.calls.slice(beforeTap).map((call) => `${call.purpose}:${call.q}`);
    civic.unknownNumberStatus = (await ui()).appStatus;
    await ensurePlanner();
    civic.unknownNumberLabel = (await ui()).end;

    // A failed typing search offers Riprova, which really searches again, as an explicit search.
    provider.mode = "503";
    since = Date.now();
    await type("end", "Arco della Pace", { perChar: 30 });
    state = await settle("end", "Arco della Pace", "503", since);
    civic.placeFailure = state.status;
    provider.mode = "ok";
    const beforeRetry = provider.calls.length;
    since = Date.now();
    if (state.status?.retry) await session.tap("[data-testid=address-search-retry]");
    state = await settle("end", "Arco della Pace", "ok", since);
    civic.retryRequests = provider.calls.slice(beforeRetry).map((call) => `${call.purpose}:${call.q}`);
    civic.afterRetryFirstRow = state.rows[0] ?? null;
  }

  // Final journey with every provider down: streets still found, selected and routed.
  await ensurePlanner();
  provider.mode = "503";
  let since = Date.now();
  await type("start", "Via Filippo Argelati", { perChar: 40 });
  let final = await settle("start", "Via Filippo Argelati", LIVE ? "live" : "503", since);
  const finalStartRow = final.rows[0]?.primary ?? null;
  await pick("start");
  since = Date.now();
  await type("end", "Corso Buenos Aires", { perChar: 40 });
  final = await settle("end", "Corso Buenos Aires", LIVE ? "live" : "503", since);
  const finalEndRow = final.rows[0]?.primary ?? null;
  await pick("end");
  let routed = false;
  try {
    await waitForPhase(session, "route-ready", 15_000);
    routed = true;
  } catch { /* reported below */ }
  result.finalJourney = { finalStartRow, finalEndRow, routed, ...(await ui()) };
  result.civic = civic;
  result.purposes = provider.calls.reduce((counts, call) => ({ ...counts, [call.purpose ?? "none"]: (counts[call.purpose ?? "none"] ?? 0) + 1 }), {});

  const edits = result.edits;
  result.summary = {
    edits: edits.length,
    honest: edits.filter((edit) => edit.honest).length,
    silent: edits.filter((edit) => edit.outcome === "silent").length,
    stale: edits.filter((edit) => edit.outcome === "stale").length,
    streetEditsWithIndexRowFirst: edits.filter((edit) => edit.localFirst === true).length,
    streetEdits: edits.filter((edit) => edit.localFirst !== null).length,
    tapFailures: edits.filter((edit) => String(edit.picked).startsWith("TAP-FAIL")).length,
    byMode: Object.fromEntries([...new Set(edits.map((edit) => edit.mode))].sort().map((mode) => [mode, {
      edits: edits.filter((edit) => edit.mode === mode).length,
      honest: edits.filter((edit) => edit.mode === mode && edit.honest).length,
    }])),
  };
} finally {
  result.console = session.consoleErrors.slice(-30);
  result.exceptions = session.exceptions.slice(-20);
  if (OUT) writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  await session.close();
}
console.log("\nSUMMARY", JSON.stringify(result.summary));
console.log("CIVIC", JSON.stringify(result.civic));
console.log("FINAL", JSON.stringify({ ...result.finalJourney, rows: undefined }));
console.log("PURPOSES", JSON.stringify(result.purposes), "console errors", result.console.length, "exceptions", result.exceptions.length);
console.log("CONSOLE", JSON.stringify([...new Set(result.console.map((entry) => entry.text.slice(0, 90)))]));
