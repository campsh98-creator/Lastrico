// Workaround for a V8 Maglev miscompilation observed on Node 24.18.0 (V8 13.6.233.17-node.50) during this
// experiment: when build() ran twice in the same process, the Maglev-compiled buildExperimentalLayer() returned
// floating-point accumulators (predicted metres, mean/max p) from the PREVIOUS invocation. Reproduced with Maglev
// on; not reproduced with --no-maglev or --jitless. The determinism test caught it. Disabling Maglev before any
// hot code runs restores correct results; build.mjs additionally re-checks the affected values independently
// and aborts on any mismatch, so a silent corruption cannot reach dist/.
import v8 from "node:v8";

export const JIT_WORKAROUND = "--no-maglev (set at runtime by lib/jit-guard.mjs)";
v8.setFlagsFromString("--no-maglev");
