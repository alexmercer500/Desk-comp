// Renders Rui's still pictures (src/assets/rui/*.webp) for the Settings panel
// and the session tiles, with headless Chrome (or Edge) and the Vite dev
// server. Run it again whenever Rui's model, looks or colours change.
//
//   node scripts/make-rui-stills.mjs              write the pictures
//   node scripts/make-rui-stills.mjs --sheet F    write a contact sheet of the poses over time to F (PNG)

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src", "assets", "rui");
const sheetAt = process.argv.indexOf("--sheet");
const sheetFile = sheetAt > 0 ? resolve(process.argv[sheetAt + 1]) : null;

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const browser = BROWSERS.find((b) => existsSync(b));
if (!browser) throw new Error("Needs Chrome or Edge installed.");

const PORT = 5188;
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { port: PORT, strictPort: true },
  logLevel: "warn",
});
await server.listen();
const profile = mkdtempSync(join(tmpdir(), "rui-stills-"));
const DEBUG_PORT = 9338;
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
  const url = `http://localhost:${PORT}/rui-stills.html${sheetFile ? "?sheet" : ""}`;
  const text = await renderIn(url);
  const pictures = JSON.parse(text);
  const bytes = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");

  if (sheetFile) {
    writeFileSync(sheetFile, bytes(pictures.sheet));
    console.log(`Contact sheet: ${sheetFile}`);
  } else {
    mkdirSync(outDir, { recursive: true });
    for (const f of readdirSync(outDir)) if (f.endsWith(".webp")) rmSync(join(outDir, f));
    let total = 0;
    for (const [name, dataUrl] of Object.entries(pictures)) {
      if (!dataUrl.startsWith("data:image/webp")) throw new Error(`${name} isn't a WebP picture`);
      const b = bytes(dataUrl);
      total += b.length;
      writeFileSync(join(outDir, `${name}.webp`), b);
    }
    console.log(`${Object.keys(pictures).length} pictures in src/assets/rui (${Math.round(total / 1024)} KB)`);
  }
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
    if (Date.now() - started > 300_000) throw new Error("Timed out. Open /rui-stills.html with `npm run dev` to see why.");
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
