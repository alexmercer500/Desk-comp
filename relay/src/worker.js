// Desk Companion relay: passes messages between one PC and its phones when
// they aren't on the same network. It never sees what the messages say: the
// PC and the phone encrypt everything end to end with a key the relay doesn't
// have (docs/RELAY.md). All it knows is a random room name, who is connected,
// and how big each message is.
//
//   GET /r/<room>   (WebSocket upgrade)   room = 32 lowercase hex characters
//
// First message from each side: {"t":"hello","role":"pc"|"phone","admit":"<64 hex>"}
// The first side ever to join a room fixes its `admit` secret (the relay keeps
// only a hash); anyone else must present the same one. So even someone who
// learned a room name can't take it over.
//
// After hello:
//   phone -> relay: {"t":"msg","d":"<opaque>"}                 relay -> PC: {"t":"msg","from":"p3","d":"<opaque>"}
//   PC    -> relay: {"t":"msg","to":"p3"|null,"d":"<opaque>"}  relay -> phone: {"t":"msg","d":"<opaque>"}
//   relay -> everyone: {"t":"peers","pc":true|false,"phones":["p3",...]} whenever it changes

const ROOM = /^[0-9a-f]{32}$/;
const ADMIT = /^[0-9a-f]{64}$/;
/** Largest message accepted, bytes (a session list is the biggest thing sent). */
const MAX_FRAME = 96 * 1024;
const MAX_PHONES = 4;
/** Messages per second per connection before it's dropped. */
const RATE = 40;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response("Desk Companion relay. It passes encrypted messages and cannot read them.\n", {
        headers: { "content-type": "text/plain" },
      });
    }
    const m = /^\/r\/([^/]+)$/.exec(url.pathname);
    if (!m || !ROOM.test(m[1])) return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const id = env.ROOM.idFromName(m[1]);
    return env.ROOM.get(id).fetch(request);
  },
};

async function sha256Hex(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** One room: the PC and its phones. Hibernates when nobody is sending. */
export class Room {
  constructor(state) {
    this.state = state;
    // Rate counters live in memory only: a hibernated room starts clean.
    this.rate = new Map();
  }

  async fetch() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    // Not admitted until it says hello; until then anything but a valid hello closes it.
    server.serializeAttachment({ role: null, id: null, born: Date.now() });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > MAX_FRAME) return ws.close(1009, "message too big");
    const now = Date.now();
    const r = this.rate.get(ws) ?? { at: now, n: 0 };
    if (now - r.at >= 1000) {
      r.at = now;
      r.n = 0;
    }
    if (++r.n > RATE) return ws.close(4429, "too many messages");
    this.rate.set(ws, r);

    let m;
    try {
      m = JSON.parse(message);
    } catch {
      return ws.close(1003, "not JSON");
    }
    if (m === null || typeof m !== "object") return ws.close(1003, "not an object");
    const a = ws.deserializeAttachment();
    if (a.role === null) return this.hello(ws, a, m);

    if (m.t !== "msg" || typeof m.d !== "string") return;
    if (a.role === "phone") {
      const pc = this.peers("pc")[0];
      if (pc) pc.send(JSON.stringify({ t: "msg", from: a.id, d: m.d }));
    } else {
      const frame = JSON.stringify({ t: "msg", d: m.d });
      for (const p of this.peers("phone")) {
        if (m.to == null || m.to === p.deserializeAttachment().id) p.send(frame);
      }
    }
  }

  async hello(ws, a, m) {
    if (m.t !== "hello" || (m.role !== "pc" && m.role !== "phone") || typeof m.admit !== "string" || !ADMIT.test(m.admit)) {
      return ws.close(4400, "bad hello");
    }
    const hash = await sha256Hex(m.admit);
    const known = await this.state.storage.get("admit");
    if (known === undefined) await this.state.storage.put("admit", hash);
    else if (known !== hash) return ws.close(4401, "wrong room secret");

    if (m.role === "pc") {
      // A newer PC connection replaces an older one (the PC restarted).
      for (const old of this.peers("pc")) old.close(4000, "replaced");
      ws.serializeAttachment({ role: "pc", id: "pc", born: a.born });
    } else {
      if (this.peers("phone").length >= MAX_PHONES) return ws.close(4003, "too many phones");
      const id = "p" + crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
      ws.serializeAttachment({ role: "phone", id, born: a.born });
    }
    this.announce();
  }

  async webSocketClose(ws) {
    this.rate.delete(ws);
    this.announce(ws);
  }

  async webSocketError(ws) {
    this.rate.delete(ws);
    this.announce(ws);
  }

  /** Admitted connections of a role (not counting `except`, which is closing). */
  peers(role, except) {
    return this.state.getWebSockets().filter((ws) => ws !== except && ws.deserializeAttachment()?.role === role);
  }

  /** Tells everyone who is here now. */
  announce(closing) {
    const pc = this.peers("pc", closing).length > 0;
    const phones = this.peers("phone", closing).map((p) => p.deserializeAttachment().id);
    const frame = JSON.stringify({ t: "peers", pc, phones });
    for (const ws of this.state.getWebSockets()) {
      if (ws !== closing && ws.deserializeAttachment()?.role) {
        try {
          ws.send(frame);
        } catch {
          // already gone
        }
      }
    }
  }
}
