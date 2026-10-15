// Renders the pictures the Android app shows for the 2D characters
// (android/app/src/main/res/drawable-nodpi/char_<id>_<mood>.webp, and Dogesh
// Bhai's in every outfit: dogesh_<mood>_<outfit>.webp), with
// headless Chrome (or Edge) and the Vite dev server. Rui's come from his own
// stills (scripts/make-rui-stills.mjs) and are copied by this script too.
// Run it again whenever a character's drawing changes.
//
//   node scripts/make-phone-pictures.mjs

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "android", "app", "src", "main", "res", "drawable-nodpi");

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const browser = BROWSERS.find((b) => existsSync(b));
if (!browser) throw new Error("Needs Chrome or Edge installed.");

const PORT = 5189;
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { port: PORT, strictPort: true },
  logLevel: "warn",
});
await server.listen();
const profile = mkdtempSync(join(tmpdir(), "phone-stills-"));
const DEBUG_PORT = 9339;
const chrome = spawn(
  browser,
  [
    "--headless=new",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    "--disable-extensions",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
try {
  const url = `http://localhost:${PORT}/phone-stills.html`;
  const text = await renderIn(url);
  const pictures = JSON.parse(text);
  const bytes = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");

  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (/^(char|rui|dogesh)_.*\.webp$/.test(f)) rmSync(join(outDir, f));
  let total = 0;
  for (const [name, dataUrl] of Object.entries(pictures)) {
    if (!dataUrl.startsWith("data:image/webp")) throw new Error(`${name} isn't a WebP picture`);
    const b = bytes(dataUrl);
    total += b.length;
    // dogesh-<mood>-<outfit> → dogesh_<mood>_<outfit>; the others char_<id>_<mood>.
    const file = name.startsWith("dogesh-") ? name.replaceAll("-", "_") : `char_${name.replace("-", "_")}`;
    writeFileSync(join(outDir, `${file}.webp`), b);
  }
  // Rui's own stills, as they are: rui_<pose>_<look>_<colour>.
  const ruiDir = join(root, "src", "assets", "rui");
  let ruiCount = 0;
  for (const f of readdirSync(ruiDir)) {
    if (!f.endsWith(".webp")) continue;
    copyFileSync(join(ruiDir, f), join(outDir, `rui_${f.replaceAll("-", "_")}`));
    ruiCount++;
  }
  console.log(`${Object.keys(pictures).length} character pictures (${Math.round(total / 1024)} KB) and ${ruiCount} of Rui's in ${outDir}`);
} finally {
  chrome.kill();
  await server.close();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}

/** Opens `url` in the headless browser and waits for the page to put its pictures in #out. */
async function renderIn(url) {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page");
    } catch {
      // not up yet
    }
    if (!target) await new Promise((r) => setTimeout(r, 200));
  }
  if (!target) throw new Error("The headless browser didn't start.");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = fail;
  });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
  };
  const call = (method, params = {}) =>
    new Promise((ok) => {
      waiting.set(++id, ok);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await call("Page.navigate", { url });
  // Ask every half second until the page has put its pictures out (or reports an error).
  const started = Date.now();
  let value = "";
  while (!value) {
    if (Date.now() - started > 300_000) throw new Error("Timed out. Open /phone-stills.html with `npm run dev` to see why.");
    await new Promise((r) => setTimeout(r, 500));
    const res = await call("Runtime.evaluate", {
      expression: `location.href === ${JSON.stringify(url)} ? (document.getElementById("out")?.textContent ?? "") : ""`,
      returnByValue: true,
    });
    value = typeof res.result?.result?.value === "string" ? res.result.result.value : "";
  }
  ws.close();
  if (value.startsWith("ERROR ")) throw new Error(value);
  return value;
}
