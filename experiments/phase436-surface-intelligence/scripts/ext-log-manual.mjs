/** Append a manual request-log line for fetches done through WebFetch/WebSearch (tool, url-or-query, note). */
import { logManual } from "./ext-http.mjs";
const [tool, target, ...note] = process.argv.slice(2);
await logManual({ method: tool, url: target, note: note.join(" "), via: "agent-tool (not the Node helper)" });
