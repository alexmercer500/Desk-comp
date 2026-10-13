# Phone link

How Desk Companion on the PC and the Android app talk. Version 1.

The link is **off by default**. Turned on (Settings → Phone), the PC listens on the local network; nothing is announced and nothing goes through the internet. The phone and the PC must be on the same network (Wi-Fi, or the PC on the phone's hotspot).

## Trust

- The PC makes, once, a self-signed **ECDSA P-256** certificate and a random **token** (32 bytes, base64url). Both live in Windows Credential Manager (`DeskCompanion/phone-link`), never in a file.
- The pairing link (shown as a QR code in Settings, only after a click) carries the certificate's **SHA-256 fingerprint** and the token.
- The phone connects with **TLS 1.3** and accepts exactly the certificate whose fingerprint it was given (no certificate authority, no host name). Then it sends the token in its first message. The PC compares it in constant time; a wrong token is answered after a short delay and the connection closed.
- **Pair again** (Settings) makes a new token and drops every phone; the old link stops working. The certificate stays, so the fingerprint doesn't change.
- The PC only talks to peers on private, link-local or loopback addresses.

## Pairing link

```
deskcompanion://pair?v=1&hosts=192.168.1.20,10.42.0.15&port=47822&fp=<64 hex>&token=<43 base64url>&name=<PC name>
```

| Field | |
|---|---|
| `v` | protocol version, `1` |
| `hosts` | the PC's private IPv4 addresses, best first (up to 4) |
| `port` | TCP port, 47822 by default |
| `fp` | SHA-256 of the certificate (DER), lowercase hex |
| `token` | the shared secret |
| `name` | the PC's name, to show the user |

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
| `away` | `on` | away mode switched on the phone |
| `ping` | | every 25 s; the PC drops a phone silent for 90 s |

### PC → phone

| `t` | Fields | |
|---|---|---|
| `welcome` | `v`, `name`, `approvals` | `approvals`: whether Allow / Deny from the phone is on |
| `error` | `code` = `token` \| `version` \| `busy` \| `hello`, `message` | then the PC closes |
| `sessions` | `sessions`: [Session] | the whole list, sent on connect and whenever it changes |
| `decided` | `rid`, `ok` | answer to `decision`, `answer` or `reply`: `ok` false when the request was already gone (answered elsewhere, timed out, no longer held) |
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
  "reply": { "rid": "…", "until": 1760352300000 }
}
```

`approval` and `question` are present only while an agent is waiting for an answer that can be given from here; `reply` only while a finished turn is held for one (until `until`, ms since 1970). A question's text is sent whole: an answer must repeat it exactly. Steps are the last 20, files at most 50, strings shortened.

## Answering

A `decision` is applied only to a request that is still waiting, once. The PC treats it exactly like a click on Allow / Deny in its own bubble: the agent gets the answer through the same relay. Whichever answer comes first (PC, phone, terminal) wins; the others get `decided` with `ok: false`.

Answers to a question go the same way; the relay checks each against what was asked. An answer only reaches a question, a decision only a permission request, a reply only a held turn.

## Replies

Claude Code's Stop hook asks the app whether to hold the finished turn. It holds only when the link is on, answering from the companion is on, a signed-in phone has away mode on, and the PC has had no keyboard or mouse input for 60 s. A held turn waits up to 290 s. It ends at once when someone uses the PC, when no away phone is left, or when the relay gives up. A `reply` goes back as Claude Code's Stop output, `{"decision":"block","reason":"The user replied from their phone: …"}`, and Claude carries on with it. Without a reply the turn ends as if nothing happened.

## Limits

At most 4 phones at once and 8 connections in all; 10 s to say hello; idle phones dropped after 90 s without a message.
