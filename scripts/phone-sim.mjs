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
// --character ID (pick a character from the "phone"; for Rui also --look, --theme),
// --relay (go through the relay in the link, end-to-end encrypted, as a phone
// away from home does; docs/RELAY.md).

import tls from "node:tls";
import crypto from "node:crypto";

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
const viaRelay = args.includes("--relay");

let onLine = () => {};
/** The connection: `write(text)` and `end()`; it calls `onLine` for each line from the PC. */
const wire = viaRelay ? relayLink() : directLink();

function signIn() {
  send({ t: "hello", v: 1, token, device: "phone-sim", away });
  if (character) setTimeout(() => send({ t: "character", id: character, look: opt("--look"), theme: opt("--theme") }), 1500);
  setInterval(() => send({ t: "ping" }), 25_000).unref();
}

function directLink() {
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
    signIn();
  });
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      onLine(line);
    }
  });
  socket.on("close", () => {
    console.log("closed");
    process.exit(process.exitCode ?? 0);
  });
  socket.on("error", (e) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
  return { write: (text) => socket.write(text), end: () => socket.end() };
}

/** The relay: keys from the token (HKDF-SHA256), frames sealed with AES-256-GCM, as the phone app does. */
function relayLink() {
  const relay = q.get("relay");
  if (!relay) {
    console.error("this pairing link has no relay address (turn the relay on in Settings → Phone, then copy the link again)");
    process.exit(2);
  }
  const secret = Buffer.from(token, "base64url");
  const derive = (info, n) => Buffer.from(crypto.hkdfSync("sha256", secret, Buffer.from("desk-companion relay v1"), Buffer.from(info), n));
  const room = derive("room", 16).toString("hex");
  const admit = derive("admit", 32).toString("hex");
  const toPc = derive("phone>pc", 32);
  const toPhone = derive("pc>phone", 32);
  const mine = crypto.randomBytes(16);
  let theirs = null;
  let seqOut = 0n;
  let lastIn = 0n;
  const header = (kind, from, to, seq) => {
    const h = Buffer.alloc(42);
    h[0] = 1;
    h[1] = kind;
    from.copy(h, 2);
    to.copy(h, 18);
    h.writeBigUInt64BE(seq, 34);
    return h;
  };
  const seal = (h, plain) => {
    const nonce = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", toPc, nonce);
    c.setAAD(h);
    return Buffer.concat([h, nonce, c.update(plain), c.final(), c.getAuthTag()]).toString("base64");
  };
  const open = (d) => {
    try {
      const raw = Buffer.from(d, "base64");
      const h = raw.subarray(0, 42);
      const c = crypto.createDecipheriv("aes-256-gcm", toPhone, raw.subarray(42, 54));
      c.setAAD(h);
      c.setAuthTag(raw.subarray(raw.length - 16));
      const plain = Buffer.concat([c.update(raw.subarray(54, raw.length - 16)), c.final()]);
      return { kind: h[1], from: h.subarray(2, 18), to: h.subarray(18, 34), seq: h.readBigUInt64BE(34), plain };
    } catch {
      return null;
    }
  };
  console.log(`connecting to ${q.get("name")} through the relay ${relay}`);
  const ws = new WebSocket(`wss://${relay.replace(/^https:\/\//, "")}/r/${room}`);
  ws.onopen = () => ws.send(JSON.stringify({ t: "hello", role: "phone", admit }));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === "peers") {
      console.log(`relay: PC ${m.pc ? "here" : "not here"}, ${m.phones.length} phone(s)`);
      if (m.pc && !theirs) ws.send(JSON.stringify({ t: "msg", d: seal(header(1, mine, Buffer.alloc(16), 0n), Buffer.alloc(0)) }));
      if (!m.pc && theirs) ws.close();
    } else if (m.t === "msg") {
      const f = open(m.d);
      if (!f) return console.log("(a frame that doesn't open: ignored)");
      if (f.kind === 1 && !theirs && f.to.equals(mine)) {
        theirs = Buffer.from(f.from);
        console.log("relay: the PC answered; encrypted session started");
        signIn();
      } else if (f.kind === 2 && theirs && f.from.equals(theirs) && f.to.equals(mine) && f.seq > lastIn) {
        lastIn = f.seq;
        onLine(f.plain.toString("utf8"));
      }
    }
  };
  ws.onclose = (e) => {
    console.log(`closed (${e.code})`);
    process.exit(process.exitCode ?? 0);
  };
  ws.onerror = () => console.error("relay connection failed");
  return {
    write: (text) => {
      if (!theirs) return;
      seqOut += 1n;
      ws.send(JSON.stringify({ t: "msg", d: seal(header(2, mine, theirs, seqOut), Buffer.from(text.replace(/\n$/, ""))) }));
    },
    end: () => ws.close(),
  };
}

const answered = new Set();
onLine = (line) => {
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
};

function send(m) {
  console.log(`> ${JSON.stringify(m)}`);
  wire.write(JSON.stringify(m) + "\n");
}

if (quitAfter) setTimeout(() => wire.end(), quitAfter * 1000);
