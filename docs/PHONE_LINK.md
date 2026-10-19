# Phone link

How Desk Companion on the PC and the Android app talk. Version 1.

The link is **off by default**. Turned on (Settings → Phone), the PC listens on the local network; nothing is announced. The phone and the PC must be on the same network (Wi-Fi, or the PC on the phone's hotspot), unless the relay is on: then the same messages also go end-to-end encrypted through the user's own relay on the internet (`docs/RELAY.md`).

## Trust

- The PC makes, once, a self-signed **ECDSA P-256** certificate and a random **token** (32 bytes, base64url). Both live in Windows Credential Manager (`DeskCompanion/phone-link`), never in a file.
- The pairing link (shown as a QR code in Settings, only after a click) carries the certificate's **SHA-256 fingerprint** and the token.
- The phone connects with **TLS 1.3** and accepts exactly the certificate whose fingerprint it was given (no certificate authority, no host name). Then it sends the token in its first message. The PC compares it in constant time; a wrong token is answered after a short delay and the connection closed.
- **Pair again** (Settings) makes a new token and drops every phone; the old link stops working. The certificate stays, so the fingerprint doesn't change.
- The PC only talks to peers on private, link-local or loopback addresses.

## Pairing link

```
deskcompanion://pair?v=1&hosts=192.168.1.20,10.42.0.15&port=47822&fp=<64 hex>&token=<43 base64url>&name=<PC name>[&relay=<https address>]
```

| Field | |
|---|---|
| `v` | protocol version, `1` |
| `hosts` | the PC's private IPv4 addresses, best first (up to 4) |
| `port` | TCP port, 47822 by default |
| `fp` | SHA-256 of the certificate (DER), lowercase hex |
| `token` | the shared secret |
| `name` | the PC's name, to show the user |
| `relay` | only while the relay is on: its address, `https://host[:port]` (percent-encoded) |

## Messages

TCP + TLS, one JSON object per line (UTF-8, `\n`), at most 64 KiB per line. Every message has a type `t`. Unknown types and unknown fields are ignored (so either side can add things later).

### Phone → PC

| `t` | Fields | |
|---|---|---|
| `hello` | `v`, `token`, `device`, `away` | must be the first line, within 10 s. `away` (optional, default false): away mode is on |
| `seen` | `rid` | the phone is showing this request or question (counts as "on screen": the agent keeps waiting for an answer) |
| `decision` | `rid`, `decision` = `allow` \| `deny` | the user's answer. There is no "always" from the phone |
| `answer` | `rid`, `answers` = {question: answer} | answers to a question card: 1–8, each one line of at most 500 characters (an option's label, several joined by ", ", or typed text) |
| `reply` | `rid`, `text` | a further prompt for a held turn (`reply` on its session), up to 4000 characters; line breaks allowed |
| `replying` | `rid` | the user is writing a reply to that held turn (sent every 15 s or so while they type): the PC keeps holding it for 30 s more even while the PC is in use (phones from Android 0.5.2) |
| `away` | `on` | away mode switched on the phone |
| `character` | `id`, `look`?, `theme`? | the user picked a character on the phone (Rui's look and colour only for Rui). The PC checks the names against its own lists; unknown ones change nothing |
| `peek` | `session` | a picture of that session's window, please (Peek). At most one every 1.5 s per phone |
| `ping` | | every 25 s; the PC drops a phone silent for 90 s |

### PC → phone

| `t` | Fields | |
|---|---|---|
| `welcome` | `v`, `name`, `approvals`, `hosts`, `relay` | `approvals`: whether Allow / Deny from the phone is on. `hosts`: the PC's addresses right now (the phone saves them). `relay`: the relay's address while it's on, else `null` (the phone saves or forgets it). Sent again whenever the relay is switched or its address changes |
| `error` | `code` = `token` \| `version` \| `busy` \| `hello`, `message` | then the PC closes |
| `sessions` | `sessions`: [Session] | the whole list, sent on connect and whenever it changes |
| `decided` | `rid`, `ok` | answer to `decision`, `answer` or `reply`: `ok` false when the request was already gone (answered elsewhere, timed out, no longer held) |
| `character` | `id`, `look`, `theme` | the character in use on the PC, sent after `welcome` and whenever it changes (from either side) |
| `peek` | `session`, `part`, `parts`, `data`; on part 0 also `width`, `height`, `title`, `at` | a picture of the session's window: a JPEG in base64, split into `parts` lines of at most 48 KiB of `data` each (so every line fits the 64 KiB limit and a relay frame). Or `session`, `error`: why there's no picture (minimized, not found, Peek off) |
| `pong` | | |

### Session

```json
{
  "id": "…", "agent": "Claude Code", "project": "shop-app",
  "status": "working | waiting | done | error | idle",
  "line": "Editing cart.ts",
  "prompt": "…", "summary": "…",
  "steps": [{ "tool": "Edit", "detail": "src/cart.ts", "failed": false }],
  "files": [{ "path": "src/cart.ts", "add": 12, "del": 3 }],
  "updatedAt": 1760352000000,
  "approval": { "rid": "…", "tool": "Bash", "action": "run", "detail": "npm test", "canAlways": true },
  "question": { "rid": "…", "questions": [{ "question": "Which one?", "header": "Pick", "multiSelect": false,
                "options": [{ "label": "A", "description": "…" }] }] },
  "ask": { "headline": "Plan ready for review", "where": "Command Code", "questions": [ …as in question… ] },
  "reply": { "rid": "…", "until": 1760352300000 }
}
```

`approval` and `question` are present only while an agent is waiting for an answer that can be given from here; `ask` while it waits for one that can only be given at the PC (`where`), such as Command Code's plan review, shown with its choices (phones from Android 0.4.5); `reply` only while a finished turn is held for one (until `until`, ms since 1970). A question's text is sent whole: an answer must repeat it exactly. Steps are the last 20, files at most 50, strings shortened.

## Answering

A `decision` is applied only to a request that is still waiting, once. The PC treats it exactly like a click on Allow / Deny in its own bubble: the agent gets the answer through the same relay. Whichever answer comes first (PC, phone, terminal) wins; the others get `decided` with `ok: false`.

Answers to a question go the same way; the relay checks each against what was asked. An answer only reaches a question, a decision only a permission request, a reply only a held turn.

## Replies

Claude Code's Stop hook asks the app whether to hold the finished turn. It holds only when the link is on, answering from the companion is on, and a signed-in phone has away mode on (away mode is the user saying they're away; the PC doesn't wait to go idle first). A held turn waits up to 290 s. It ends when someone uses the PC for 3 seconds without a break (typing, working: a nudge of the mouse doesn't count, PC 0.15.2 and later; before, any key or mouse movement ended it), except while a phone says a reply is being written (`replying`); when no away phone is left; or when the relay gives up. A `reply` goes back as Claude Code's Stop output, `{"decision":"block","reason":"The user replied from their phone: …"}`, and Claude carries on with it. Without a reply the turn ends as if nothing happened.

## Peek

A `peek` asks for a picture of one session's window. The PC finds that window the way "Show window" does (the relay's parent processes, the project's name in the title), has Windows draw just that window (it works when other windows cover it; a minimized one is reported, not restored), scales it to at most 1600 × 1600 and sends it as a JPEG under 600 KB. Only that window, never the whole screen; nothing is kept. Each picture shows a short notice on the PC ("Your phone took a look at …"). Settings → Phone → "Peek from the phone" turns it off (on by default while the link is on). The page sends each session's `procs` with its list for this; the PC removes them before the list goes to phones.

## Finding the PC again

Addresses change, a phone hotspot most of all. The phone keeps the address that last worked first, then the ones the PC sent in `welcome`. When none of them answers, it searches its own local networks: every address in the /24 around each of its private IPv4 addresses (the network itself when smaller), never more, and never anything outside private, carrier-grade NAT or link-local ranges. It opens TLS to each address that accepts a connection on the port and keeps the first one that shows the paired certificate. The certificate is checked during the handshake, before anything is sent, so other machines never see the token. A search happens at most every 30 seconds. The phone also tries again at once when its networks change, when its hotspot is turned on or off, and when the app is opened.

## Through the relay

Away from the PC's network, the same lines travel inside encrypted frames through the relay, and the PC handles them exactly as above (hello and token included). The frames, keys and replay rules are in `docs/RELAY.md`. Such a phone's address shows as `relay`.

## Limits

At most 4 phones at once and 8 connections in all; 10 s to say hello; idle phones dropped after 90 s without a message.
