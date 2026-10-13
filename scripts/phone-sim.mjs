#!/usr/bin/env node
// Pretends to be Desk Companion for Android, for testing the PC's phone link
// (docs/PHONE_LINK.md) without a phone. Pins the certificate from the pairing
// link, says hello with its token, prints what the PC sends.
//
//   node scripts/phone-sim.mjs "<pairing link>"                    watch
//   node scripts/phone-sim.mjs "<pairing link>" --decide deny      answer the first request
//   node scripts/phone-sim.mjs "<pairing link>" --token wrong      try a wrong token
//
// Options: --decide allow|deny, --seen (report requests as shown), --token X,
// --host H (instead of the link's first), --quit-after N (seconds).

import tls from "node:tls";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const raw = args.find((a) => a.startsWith("deskcompanion://"));
if (!raw) {
  console.error('usage: node scripts/phone-sim.mjs "deskcompanion://pair?..." [--decide allow|deny] [--seen]');
  process.exit(2);
}
const link = new URL(raw);
const q = link.searchParams;
const hosts = (q.get("hosts") ?? "").split(",").filter(Boolean);
const host = opt("--host") ?? hosts[0];
const port = Number(q.get("port"));
const fp = (q.get("fp") ?? "").toLowerCase();
const token = opt("--token") ?? q.get("token");
const decide = opt("--decide");
const seen = args.includes("--seen") || Boolean(decide);
const quitAfter = Number(opt("--quit-after") ?? 0);

console.log(`connecting to ${q.get("name")} at ${host}:${port}`);
const socket = tls.connect({
  host,
  port,
  minVersion: "TLSv1.3",
  // Trust exactly the pinned certificate, nothing else (no CA, no host name).
  rejectUnauthorized: false,
  checkServerIdentity: () => undefined,
});

socket.on("secureConnect", () => {
  const got = socket.getPeerCertificate().fingerprint256.replace(/:/g, "").toLowerCase();
  if (got !== fp) {
    console.error(`certificate fingerprint ${got} isn't the paired one ${fp}: refusing`);
    socket.destroy();
    process.exit(3);
  }
  console.log(`TLS ${socket.getProtocol()}, certificate pinned`);
  send({ t: "hello", v: 1, token, device: "phone-sim" });
  setInterval(() => send({ t: "ping" }), 25_000).unref();
});

const answered = new Set();
let buffer = "";
socket.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    const m = JSON.parse(line);
    if (m.t === "sessions") {
      console.log(`sessions (${m.sessions.length}):`);
      for (const s of m.sessions) {
        console.log(`  ${s.project} · ${s.agent} · ${s.status} · ${s.line}${s.approval ? `  [request ${s.approval.rid}: ${s.approval.action} ${s.approval.detail}]` : ""}`);
        const rid = s.approval?.rid;
        if (rid && !answered.has(rid)) {
          answered.add(rid);
          if (seen) send({ t: "seen", rid });
          if (decide) send({ t: "decision", rid, decision: decide });
        }
      }
    } else {
      console.log(JSON.stringify(m));
    }
    if (m.t === "error") process.exitCode = 4;
  }
});

function send(m) {
  console.log(`> ${JSON.stringify(m)}`);
  socket.write(JSON.stringify(m) + "\n");
}

socket.on("close", () => {
  console.log("closed");
  process.exit(process.exitCode ?? 0);
});
socket.on("error", (e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
if (quitAfter) setTimeout(() => socket.end(), quitAfter * 1000);
