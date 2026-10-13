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
| `hello` | `v`, `token`, `device` | must be the first line, within 10 s |
| `seen` | `rid` | the phone is showing this request (counts as "on screen": the agent keeps waiting for an answer) |
| `decision` | `rid`, `decision` = `allow` \| `deny` | the user's answer. There is no "always" from the phone |
| `ping` | | every 25 s; the PC drops a phone silent for 90 s |

### PC → phone

| `t` | Fields | |
|---|---|---|
| `welcome` | `v`, `name`, `approvals` | `approvals`: whether Allow / Deny from the phone is on |
| `error` | `code` = `token` \| `version` \| `busy` \| `hello`, `message` | then the PC closes |
| `sessions` | `sessions`: [Session] | the whole list, sent on connect and whenever it changes |
| `decided` | `rid`, `ok` | answer to `decision`: `ok` false when the request was already gone (answered elsewhere, timed out) |
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
  "approval": { "rid": "…", "tool": "Bash", "action": "run", "detail": "npm test", "canAlways": true }
}
```

`approval` is present only while an agent is waiting for an answer that can be given from here. Steps are the last 20, files at most 50, strings shortened.

## Answering

A `decision` is applied only to a request that is still waiting, once. The PC treats it exactly like a click on Allow / Deny in its own bubble: the agent gets the answer through the same relay. Whichever answer comes first (PC, phone, terminal) wins; the others get `decided` with `ok: false`.

## Limits

At most 4 phones at once and 8 connections in all; 10 s to say hello; idle phones dropped after 90 s without a message.
