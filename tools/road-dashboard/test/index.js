// Entry point so that `node --test tools/road-dashboard/test/` works: Node 24 resolves a directory
// argument to its index.js. Each suite also runs standalone via the glob "tools/road-dashboard/test/*.test.mjs".
import "./unit.test.mjs";
import "./serve.test.mjs";
import "./build.test.mjs";
