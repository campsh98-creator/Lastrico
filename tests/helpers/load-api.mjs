import { readFile } from "node:fs/promises";
import ts from "typescript";

// Execute the actual handler with Node's Request/Response support. Only module resolution
// differs from vinext; external fetches remain controlled by each test.
// `fresh: true` gives a new module instance (its own in-memory cache and breakers) per call.
export async function loadApi(relativePath, { fresh = false } = {}) {
  const root = new URL("../../", import.meta.url);
  const file = new URL(relativePath, root);
  let source = await readFile(file, "utf8");
  source = source.replace(/from "([^"]+)"/g, (original, specifier) => {
    if (specifier === "next/server") return `from "${new URL("node_modules/next/server.js", root).href}"`;
    if (specifier.startsWith("@/")) {
      const target = new URL(specifier.slice(2), root);
      return specifier.endsWith(".json") ? `from "${target.href}" with { type: "json" }`
        : /\.(mjs|js|ts)$/.test(specifier) ? `from "${target.href}"` : `from "${target.href}.ts"`;
    }
    if (specifier.startsWith(".")) return `from "${new URL(specifier + ".ts", file).href}"`;
    return original;
  });
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    fileName: file.pathname,
  });
  const code = fresh ? `${outputText}\n// fresh ${Date.now()}-${Math.random()}` : outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

export function encodePolyline(points) {
  let previous = [0, 0];
  return points.map(([lon, lat]) => [lat, lon].map((value, index) => {
    const next = Math.round(value * 1e6);
    const delta = next - previous[index];
    previous[index] = next;
    let number = delta < 0 ? -delta * 2 - 1 : delta * 2;
    let encoded = "";
    while (number >= 32) {
      encoded += String.fromCharCode((number % 32) + 95);
      number = Math.floor(number / 32);
    }
    return encoded + String.fromCharCode(number + 63);
  }).join("")).join("");
}
