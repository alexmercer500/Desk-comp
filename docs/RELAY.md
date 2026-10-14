# Relay: using the phone away from your network

Status: the relay itself (`relay/`) is built and tested. The PC and phone sides (the encryption and the connection) are **not built yet**; this page is the plan for them, and the setup steps you do.

## What it is

When the phone and the PC aren't on the same network, both connect out to a small relay on the internet. The relay passes messages between them. It can't read them: the PC and the phone encrypt everything with a key the relay never has. The direct network link (`docs/PHONE_LINK.md`) is tried first; the relay is the fallback. It is **off by default** (Settings → Phone → Relay).

The relay is a Cloudflare Worker with one Durable Object per room (a room is one PC and its phones). It runs on Cloudflare's free plan, no domain needed. The address is yours: `https://desk-companion-relay.<your-name>.workers.dev`.

## Setup (you, once, about 10 minutes)

Works from any computer; nothing is tied to the one you deploy from.

1. Sign up at <https://dash.cloudflare.com/sign-up> (free).
2. In a terminal: `cd relay`, then `npm install`.
3. `npx wrangler login` opens a browser to authorise.
4. `npx wrangler deploy`. It prints your address (the `workers.dev` one). The first deploy may ask you to pick a `workers.dev` name; any name is fine.
5. Open that address in a browser. It should say "Desk Companion relay. It passes encrypted messages and cannot read them."
6. When the PC and phone sides are built: paste the address into Settings → Phone → Relay on the PC. The phone gets it from the PC.

Test the relay's rules locally, with no account: `cd relay && npm test` (starts the Worker with `wrangler dev` and runs real WebSocket connections against it).

## What the relay does (built)

`GET /r/<room>` upgrades to a WebSocket. A room name is 32 lowercase hex characters; anything else is a 404. The first message must be `{"t":"hello","role":"pc"|"phone","admit":"<64 hex>"}`.

- The **first side to join a room** fixes its `admit` secret. The relay stores only a SHA-256 of it. Anyone else must present the same secret (close code 4401), so a room name alone isn't enough to take a room over.
- One PC per room; a newer PC connection replaces the older one (close 4000). Up to 4 phones.
- Messages are `{"t":"msg","d":"<opaque string>"}`. The relay tags phone→PC messages with the phone's id (`from`), and the PC can address one phone (`to`) or all.
- Everyone is told who is connected: `{"t":"peers","pc":true,"phones":["p3"]}`.
- Limits: 96 KB per message (close 1009), 40 messages a second per connection (close 4429), a bad hello closes the connection (4400).
- The relay knows: the room name, who is connected, when messages were sent and how big they are. It does not know what they say.

Not covered by the relay itself: an anonymous caller can open connections to random room names. They get nothing (no secret), but each attempt counts as a request on your free plan (100,000 a day). Cloudflare's own rate limiting rules (dashboard, free) can cap that if it ever matters.

## What the PC and phone sides must do (to build)

All of this is in the part that needs care, so it should be built and reviewed on Opus.

**Keys.** The pairing already gives both sides a secret: the 32-byte `token`. From it, with HKDF-SHA256 (salt `desk-companion relay v1`), derive separate keys: the room name (16 bytes), the `admit` secret (32 bytes), and one AES-256-GCM key per direction (`pc>phone`, `phone>pc`). Never use the token itself on the wire, and never reuse one key for two purposes.

**Messages.** Every `d` is an AES-256-GCM encrypted message of the same JSON the direct link sends (`docs/PHONE_LINK.md`), so the PC handles a phone's messages the same way whichever way they arrive. Random 96-bit nonces (a counter would repeat after a restart). Replay protection: each connection picks a random session id, frames carry a sequence number, both are authenticated (as additional data), and a frame is accepted only for the current session pair and only with a higher sequence than the last. A phone id from the relay is a label, not an identity: only a message that decrypts is from the phone.

**What changes on the wire.** There is no certificate pin on this path (the PC isn't the one answering), so identity comes from the key. A relay or an attacker who doesn't have the token can't produce a message that decrypts.

**Pairing.** Phones already paired learn the relay address from the PC over the direct link (a new field in `welcome`). A new pairing carries it in the QR code.

**Behaviour.**
- The direct link is tried first; the relay only when it fails, and the other way round when the phone gets home.
- Same rules as before for Allow, Deny, answers and replies, including the fingerprint on the phone. Pair again on the PC changes the token, so every key changes and old phones can no longer connect.
- The PC connects out to the relay only when the relay is on and a phone is paired; it stays quiet otherwise.

**Open decisions for the build session.**
- Whether to add a short key confirmation step on first use through the relay (both sides show a few words derived from the keys).
- How a phone asleep for hours is woken up. The relay can't push to a phone whose app is stopped. Reliable delivery then needs Google's push service (FCM), which is a separate, bigger step.
- Reconnect behaviour and battery use for the relay socket (keep-alive interval, backoff).

## Cost and limits

The free Cloudflare plan covers this comfortably for one person: Durable Objects with WebSocket hibernation only bill while messages move, and a session list every few seconds is tiny. If a Cloudflare limit is ever hit, the direct link still works.
