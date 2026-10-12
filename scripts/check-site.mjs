// One measurement per invocation. Schedule externally every five minutes for NFR06.
import { appendFileSync, mkdirSync } from "node:fs";
const url = process.argv[2];
if (!url || !url.startsWith("https://"))
  throw Error("Usage: node scripts/check-site.mjs https://your-site/");
const started = Date.now();
let ok = false,
  status = 0,
  reason = "";
try {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  status = r.status;
  const html = await r.text();
  ok = status === 200 && html.includes('data-app="oral-practice"');
  if (!ok) reason = "HTTP status or app marker failed";
} catch (e) {
  reason = e.message;
}
const row = {
  time: new Date().toISOString(),
  url,
  status,
  ok,
  elapsedMs: Date.now() - started,
  reason,
};
mkdirSync("monitoring", { recursive: true });
appendFileSync("monitoring/probes.jsonl", JSON.stringify(row) + "\n");
console.log(JSON.stringify(row));
process.exitCode = ok ? 0 : 1;
