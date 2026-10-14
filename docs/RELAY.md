# Relay: using the phone away from your network

Status: built and tested end to end through a deployed relay (the desktop app, the Android app on an emulator, and `scripts/phone-sim.mjs --relay`). Not yet tried from a real phone on mobile data.

## What it is

When the phone and the PC aren't on the same network, both connect out to a small relay on the internet. The relay passes messages between them. It can't read them: the PC and the phone encrypt everything with keys the relay never has. The direct network link (`docs/PHONE_LINK.md`) is always tried first; the relay is the fallback. It is **off by default** (Settings → Phone → **Reach your phone anywhere**).

The relay is a Cloudflare Worker with one Durable Object per room (a room is one PC and its phones). It runs on Cloudflare's free plan, no domain needed. The address is yours: `https://desk-companion-relay.<your-name>.workers.dev`.

## Setup (you, once, about 10 minutes)

Works from any computer; nothing is tied to the one you deploy from.

1. Sign up at <https://dash.cloudflare.com/sign-up> (free).
2. In a terminal: `cd relay`, then `npm install`.
3. `npx wrangler login` opens a browser to authorise.
4. `npx wrangler deploy`. It prints your address (the `workers.dev` one). The first deploy may ask you to pick a `workers.dev` name; any name is fine. A brand-new address can take a minute or two before it answers.
5. Open that address in a browser. It should say "Desk Companion relay. It passes encrypted messages and cannot read them."
6. On the PC: Settings → Phone, with **Link a phone** on, paste the address into **Relay address**, click **Save**, and turn on **Reach your phone anywhere**. The line under it should say "Relay: connected".
7. The phone learns the address the next time it connects to the PC on the same network (or from a new pairing code). Nothing to type on the phone.

Test the relay's rules locally, with no account: `cd relay && npm test` (starts the Worker with `wrangler dev` and runs real WebSocket connections against it). Test the whole path without a phone: copy the pairing link (Settings → Phone → Show pairing code) and run `node scripts/phone-sim.mjs "<link>" --relay`.

The address isn't built into the app: each person runs their own relay, on their own free allowance.

## What the relay does

`GET /r/<room>` upgrades to a WebSocket. A room name is 32 lowercase hex characters; anything else is a 404. The first message must be `{"t":"hello","role":"pc"|"phone","admit":"<64 hex>"}`.

- The **first side to join a room** fixes its `admit` secret. The relay stores only a SHA-256 of it. Anyone else must present the same secret (close code 4401), so a room name alone isn't enough to take a room over.
- One PC per room; a newer PC connection replaces the older one (close 4000). Up to 4 phones (4003).
- Messages are `{"t":"msg","d":"<opaque string>"}`. The relay tags phone→PC messages with the phone's id (`from`), and the PC can address one phone (`to`) or all.
- Everyone is told who is connected: `{"t":"peers","pc":true,"phones":["p3"]}`.
- Limits: 96 KB per message (close 1009), 40 messages a second per connection (close 4429), a bad hello closes the connection (4400).
- The relay knows: the room name, who is connected, when messages were sent and how big they are. It does not know what they say, which PC it is, or the pairing token.

Not covered by the relay itself: an anonymous caller can open connections to random room names. They get nothing (no secret), but each attempt counts as a request on your free plan (100,000 a day). Cloudflare's own rate limiting rules (dashboard, free) can cap that if it ever matters.

## The encryption (PC: `src-tauri/src/phone/relay.rs`, phone: `link/RelayCrypto.kt`, `link/RelayWire.kt`)

**Keys.** The pairing already gives both sides a secret: the 32-byte `token`. HKDF-SHA256 over it (salt `desk-companion relay v1`) gives a separate value for each use, by its `info` label:

| info | length | use |
| --- | --- | --- |
| `room` | 16 bytes | the room name (hex) |
| `admit` | 32 bytes | the room secret given to the relay (hex) |
| `pc>phone` | 32 bytes | AES-256-GCM key, PC to phone |
| `phone>pc` | 32 bytes | AES-256-GCM key, phone to PC |

The token itself is never sent to the relay. **Pair again** on the PC makes a new token, so every key and the room change, and old phones can't reach the PC through the relay either.

**Frames.** Every `d` is base64 of:

```
version (1) | kind (1) | sender session (16) | receiver session (16) | sequence (8, big-endian) | nonce (12) | ciphertext + tag (16)
```

The first 42 bytes are authenticated (AES-GCM additional data). Nonces are random (a counter would repeat after a restart). Each direction has its own key, so a frame can't be bounced back to the side that sent it. Kind 1 is `hi`, kind 2 is data.

**Sessions and replays.**
1. When the relay says the PC is in the room, the phone sends `hi`: a fresh random session id, receiver all zeros, sequence 0, nothing inside.
2. The PC answers `hi` with its own fresh session id and the phone's. (A new `hi` from a phone starts a new session and ends its old one.)
3. From then on each data frame names both session ids and carries a sequence number higher than the last one accepted. Anything else is dropped: a frame recorded earlier, from this session or an old one, never opens a door twice.

A relay phone id is only a label for addressing. Only a frame that decrypts with the phone→PC key is from a paired phone.

**What's inside.** Exactly the lines of the direct link (`docs/PHONE_LINK.md`): `hello` with the token, `welcome`, `sessions`, `decision`, and so on. The PC feeds them into the same handling as a phone on the network, so every rule is the same: Allow / Deny / answers / replies only for requests still waiting, the fingerprint or screen lock on the phone, away mode and held turns. In Settings such a phone shows as "connected (through the relay)".

There is no certificate pin on this path (the PC isn't the one answering the connection); identity comes from the keys. Someone without the token can't produce a frame that opens, and can't read one.

## Behaviour

- **PC.** With the link on, the relay on and an address saved, the PC keeps one WebSocket to its room: a ping every 30 s; nothing heard for 75 s means the connection is gone. Reconnects after 2 s, doubling up to 60 s; after "another copy took the room" or "wrong room secret" it waits 5 minutes. It never sends faster than 30 messages a second (the relay's limit is 40). Turning the relay off or changing the address reconnects at once, and phones signed in at that moment get a fresh `welcome` with the new address (or none).
- **Phone.** On a local network (Wi-Fi, hotspot, USB; not mobile data) it tries the PC's addresses, then searches the network as before. Only then, and only when the PC has given it a relay address, does it go through the relay: it waits up to 12 s for the PC to answer there. While linked through the relay it tries the PC's own addresses every 5 minutes and whenever the network changes, and moves back to the direct link as soon as one answers. OkHttp pings the relay every 30 s.
- **Where the phone gets the address.** In the pairing link (`&relay=https%3A%2F%2F…`) when the relay is on at pairing time, and in every `welcome` (`"relay": "https://…"` or `null`). Only `https://` addresses are accepted on the phone.

## Decided in the build session (14 October 2026)

- **No key-confirmation words.** The keys aren't negotiated over the network: both sides derive them from the token in the QR code, which never crossed the internet. There's nothing for a relay in the middle to substitute, so a "compare these words" step would add a chore and no protection.
- **No push service (FCM) for now.** The phone app keeps its connection in a foreground service (and "Stay linked while the phone sleeps" lets it through Doze). A phone that has stopped the app entirely won't hear about requests until it's opened. Waking a stopped app needs Google's push service, which means a Firebase project and a server key; that's a separate step if it turns out to be needed.
- **Keep-alive and backoff** as above.

## Cost and limits

The free Cloudflare plan covers this comfortably for one person: Durable Objects with WebSocket hibernation only bill while messages move, and a session list every few seconds is tiny. If a Cloudflare limit is ever hit, the direct link still works.
