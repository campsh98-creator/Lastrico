/** HTTP HEAD for the resources whose sizes are needed (no body downloaded). Usage: node ext-head.mjs <url>... */
import { request } from "./ext-http.mjs";
for (const url of process.argv.slice(2)) {
  try {
    const r = await request(url, { method: "HEAD" });
    console.log(r.status, url, "\n  content-length:", r.headers["content-length"], "| type:", r.headers["content-type"], "| last-modified:", r.headers["last-modified"], "| etag:", r.headers["etag"], "| accept-ranges:", r.headers["accept-ranges"]);
  } catch (e) { console.log("ERR", url, e.message, e.cause && e.cause.code); }
}
