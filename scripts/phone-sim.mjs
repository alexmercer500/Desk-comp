#!/usr/bin/env node
// Pretends to be Desk Companion for Android, for testing the PC's phone link
// (docs/PHONE_LINK.md) without a phone. Pins the certificate from the pairing
// link, says hello with its token, prints what the PC sends.
//
//   node scripts/phone-sim.mjs "<pairing link>"                    watch
//   node scripts/phone-sim.mjs "<pairing link>" --decide deny      answer the first request
//   node scripts/phone-sim.mjs "<pairing link>" --token wrong      try a wrong token
//
//   node scripts/phone-sim.mjs "<pairing link>" --away --reply "Now add a test"
//                                                                 reply to the first held turn
//   node scripts/phone-sim.mjs "<pairing link>" --answer "Blue"    answer the first question (every item)
//
// Options: --decide allow|deny, --seen (report requests as shown), --token X,
// --host H (instead of the link's first), --quit-after N (seconds), --away
// (away mode: finished turns may be held for a reply), --reply TEXT, --answer TEXT,
// --character ID (pick a character from the "phone"; for Rui also --look, --theme).

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
const reply = opt("--reply");
const answer = opt("--answer");
const character = opt("--character");
const away = args.includes("--away") || Boolean(reply);

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
  send({ t: "hello", v: 1, token, device: "phone-sim", away });
  if (character) setTimeout(() => send({ t: "character", id: character, look: opt("--look"), theme: opt("--theme") }), 1500);
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
        console.log(`  ${s.project} · ${s.agent} · ${s.status} · ${s.line}${s.approval ? `  [request ${s.approval.rid}: ${s.approval.action} ${s.approval.detail}]` : ""}${s.question ? `  [question ${s.question.rid}: ${s.question.questions.map((x) => x.question).join(" / ")}]` : ""}${s.reply ? `  [held for a reply ${s.reply.rid} until ${new Date(s.reply.until).toLocaleTimeString()}]` : ""}`);
        const qid = s.question?.rid;
        if (qid && !answered.has(qid)) {
          answered.add(qid);
          if (seen || answer) send({ t: "seen", rid: qid });
          if (answer) send({ t: "answer", rid: qid, answers: Object.fromEntries(s.question.questions.map((x) => [x.question, answer])) });
        }
        const hid = s.reply?.rid;
        if (hid && reply && !answered.has(hid)) {
          answered.add(hid);
          send({ t: "reply", rid: hid, text: reply });
        }
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
