// Starts the relay locally (wrangler dev, no Cloudflare account needed) and
// checks its rules with real WebSocket connections.
//   npm test    (from relay/)
import { spawn } from "node:child_process";

const PORT = 8799;
const base = `ws://127.0.0.1:${PORT}`;
const room = "0123456789abcdef0123456789abcdef";
const admit = "a".repeat(64);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const server = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--local", "--port", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

function open(path = `/r/${room}`) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base + path);
    const got = [];
    let closed = null;
    ws.onmessage = (e) => got.push(JSON.parse(e.data));
    ws.onclose = (e) => (closed = e.code);
    ws.onopen = () => resolve({ ws, got, closed: () => closed, send: (o) => ws.send(JSON.stringify(o)) });
    ws.onerror = () => reject(new Error("connect failed"));
  });
}

try {
  for (let i = 0; i < 80 && !/Ready on/.test(log); i++) await sleep(500);
  if (!/Ready on/.test(log)) throw new Error("wrangler didn't start:\n" + log.slice(-800));

  const root = await fetch(`http://127.0.0.1:${PORT}/`);
  check("the front page says what it is", (await root.text()).includes("cannot read"));
  check("an odd room name is refused", (await fetch(`http://127.0.0.1:${PORT}/r/nope`)).status === 404);
  check("a plain request to a room wants a WebSocket", (await fetch(`http://127.0.0.1:${PORT}/r/${room}`)).status === 426);

  const pc = await open();
  pc.send({ t: "hello", role: "pc", admit });
  await sleep(400);
  check("the PC is announced to itself", pc.got.at(-1)?.t === "peers" && pc.got.at(-1).pc === true && pc.got.at(-1).phones.length === 0);

  const phone = await open();
  phone.send({ t: "hello", role: "phone", admit });
  await sleep(400);
  const id = pc.got.at(-1).phones[0];
  check("the PC learns of the phone", pc.got.at(-1).phones.length === 1 && typeof id === "string");
  check("the phone sees the PC", phone.got.at(-1)?.pc === true);

  phone.send({ t: "msg", d: "ciphertext-1" });
  await sleep(300);
  check("phone to PC, with the phone's id", pc.got.some((m) => m.t === "msg" && m.d === "ciphertext-1" && m.from === id));
  pc.send({ t: "msg", to: id, d: "ciphertext-2" });
  await sleep(300);
  check("PC to that phone", phone.got.some((m) => m.t === "msg" && m.d === "ciphertext-2"));

  const second = await open();
  second.send({ t: "hello", role: "phone", admit });
  await sleep(400);
  pc.send({ t: "msg", to: id, d: "only-first" });
  pc.send({ t: "msg", to: null, d: "everyone" });
  await sleep(400);
  check("a message to one phone doesn't reach another", !second.got.some((m) => m.d === "only-first") && phone.got.some((m) => m.d === "only-first"));
  check("a message to nobody in particular reaches every phone", second.got.some((m) => m.d === "everyone") && phone.got.some((m) => m.d === "everyone"));

  const thief = await open();
  thief.send({ t: "hello", role: "phone", admit: "b".repeat(64) });
  await sleep(500);
  check("someone with the wrong room secret is refused", thief.closed() === 4401, `code ${thief.closed()}`);

  const bad = await open();
  bad.send({ t: "hello", role: "admin", admit });
  await sleep(400);
  check("a bad hello is refused", bad.closed() === 4400, `code ${bad.closed()}`);

  const early = await open();
  early.send({ t: "msg", d: "x" });
  await sleep(400);
  check("messages before hello are refused", early.closed() !== null);

  const big = await open();
  big.send({ t: "hello", role: "phone", admit });
  await sleep(400);
  big.ws.send("x".repeat(100 * 1024));
  await sleep(400);
  check("an oversized message drops the connection", big.closed() === 1009, `code ${big.closed()}`);

  const flood = await open();
  flood.send({ t: "hello", role: "phone", admit });
  await sleep(400);
  for (let i = 0; i < 80; i++) flood.send({ t: "msg", d: "f" });
  await sleep(600);
  check("flooding drops the connection", flood.closed() === 4429, `code ${flood.closed()}`);

  const pc2 = await open();
  pc2.send({ t: "hello", role: "pc", admit });
  await sleep(500);
  check("a new PC connection replaces the old one", pc.closed() === 4000, `code ${pc.closed()}`);

  const other = await open(`/r/${"f".repeat(32)}`);
  other.send({ t: "hello", role: "phone", admit: "c".repeat(64) });
  await sleep(400);
  check("rooms are separate (a new room takes its own secret)", other.closed() === null && other.got.at(-1)?.t === "peers");
} catch (e) {
  failed++;
  console.log("ERROR " + e.message);
} finally {
  server.kill();
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
}
