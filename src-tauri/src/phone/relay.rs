// The internet relay (relay/, docs/RELAY.md), not to be confused with the hook
// relay: when the phone isn't on this PC's network, both connect out to a
// relay the user runs on Cloudflare, which passes messages between them. It
// can't read them: everything is sealed with keys derived from the pairing
// token, which the relay never sees.
//
// Each phone that comes through the relay gets the same handling as one on the
// local network: its decrypted lines go into a pipe, and `server::connection`
// reads and answers them there, hello and token check included. Only the
// transport differs.
//
// Frames (the `d` of a relay message), base64 of:
//   version (1) | kind (1) | sender session (16) | receiver session (16) | sequence (8, big-endian)
//   | nonce (12) | AES-256-GCM ciphertext and tag
// The first 42 bytes are authenticated as additional data. Each direction has
// its own key, so a frame can't be sent back to where it came from.
//
// Sessions stop replays: the phone opens with a `hi` frame carrying a fresh
// session id; the PC answers `hi` with its own fresh id and the phone's. From
// then on each data frame names both ids and a higher sequence number than the
// last, so a frame recorded earlier (from this or an older session) is refused.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::hkdf;
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

use super::proto;
use super::server::{self, Host, Shared};

const SALT: &[u8] = b"desk-companion relay v1";
const FRAME_VERSION: u8 = 1;
pub const HI: u8 = 1;
pub const DATA: u8 = 2;
const SESSION: usize = 16;
const HEADER: usize = 2 + SESSION * 2 + 8;
const NONCE: usize = 12;
const TAG: usize = 16;
/// The relay drops anything bigger than 96 KB; a frame is never near that (lines are at most 64 KB).
const MAX_FRAME_TEXT: usize = 96 * 1024;
/// Messages a second this PC sends the relay at most (it drops a connection over 40).
const SEND_RATE: u32 = 30;
const CONNECT_WAIT: Duration = Duration::from_secs(15);
/// A WebSocket ping this often keeps the connection (and anything between) awake.
const PING_EVERY: Duration = Duration::from_secs(30);
/// Nothing at all from the relay for this long (pings are answered): the connection is gone.
const SILENCE_LIMIT: Duration = Duration::from_secs(75);

type Session = [u8; SESSION];
const NO_SESSION: Session = [0; SESSION];

/// Everything derived from the pairing token for the relay.
pub struct Keys {
    /// The room's name on the relay, 32 hex characters.
    pub room: String,
    /// The secret that lets this PC and its phones into the room, 64 hex characters.
    pub admit: String,
    to_phone: LessSafeKey,
    to_pc: LessSafeKey,
}

struct Len(usize);
impl hkdf::KeyType for Len {
    fn len(&self) -> usize {
        self.0
    }
}

fn expand(prk: &hkdf::Prk, info: &str, len: usize) -> Vec<u8> {
    let mut out = vec![0u8; len];
    // Only fails for lengths over 255 × 32 bytes.
    prk.expand(&[info.as_bytes()], Len(len)).and_then(|okm| okm.fill(&mut out)).expect("short HKDF output");
    out
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

impl Keys {
    /// HKDF-SHA256 over the token's 32 bytes: a separate value for each use.
    pub fn derive(token: &str) -> Result<Keys, String> {
        let secret = URL_SAFE_NO_PAD.decode(token).ok().filter(|b| b.len() == 32).ok_or("the pairing token isn't 32 bytes")?;
        let prk = hkdf::Salt::new(hkdf::HKDF_SHA256, SALT).extract(&secret);
        let key = |info: &str| LessSafeKey::new(UnboundKey::new(&AES_256_GCM, &expand(&prk, info, 32)).expect("32-byte key"));
        Ok(Keys {
            room: hex(&expand(&prk, "room", 16)),
            admit: hex(&expand(&prk, "admit", 32)),
            to_phone: key("pc>phone"),
            to_pc: key("phone>pc"),
        })
    }
}

/// The authenticated part of a frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Header {
    pub kind: u8,
    pub from: Session,
    pub to: Session,
    pub seq: u64,
}

impl Header {
    fn bytes(&self) -> [u8; HEADER] {
        let mut b = [0u8; HEADER];
        b[0] = FRAME_VERSION;
        b[1] = self.kind;
        b[2..2 + SESSION].copy_from_slice(&self.from);
        b[2 + SESSION..2 + 2 * SESSION].copy_from_slice(&self.to);
        b[2 + 2 * SESSION..].copy_from_slice(&self.seq.to_be_bytes());
        b
    }

    fn read(b: &[u8; HEADER]) -> Header {
        let mut from = NO_SESSION;
        let mut to = NO_SESSION;
        from.copy_from_slice(&b[2..2 + SESSION]);
        to.copy_from_slice(&b[2 + SESSION..2 + 2 * SESSION]);
        let mut seq = [0u8; 8];
        seq.copy_from_slice(&b[2 + 2 * SESSION..]);
        Header { kind: b[1], from, to, seq: u64::from_be_bytes(seq) }
    }
}

fn seal(key: &LessSafeKey, h: &Header, plain: &[u8]) -> Result<String, String> {
    let mut nonce = [0u8; NONCE];
    SystemRandom::new().fill(&mut nonce).map_err(|_| "no randomness available")?;
    let head = h.bytes();
    let mut body = plain.to_vec();
    key.seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from(&head), &mut body)
        .map_err(|_| "couldn't encrypt")?;
    let mut out = Vec::with_capacity(HEADER + NONCE + body.len());
    out.extend_from_slice(&head);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&body);
    Ok(STANDARD.encode(out))
}

/// The header and plain text of a frame, or None unless it decrypts with `key`.
fn open(key: &LessSafeKey, d: &str) -> Option<(Header, Vec<u8>)> {
    if d.len() > MAX_FRAME_TEXT {
        return None;
    }
    let raw = STANDARD.decode(d).ok()?;
    if raw.len() < HEADER + NONCE + TAG || raw[0] != FRAME_VERSION {
        return None;
    }
    let head: [u8; HEADER] = raw[..HEADER].try_into().ok()?;
    let nonce = Nonce::try_assume_unique_for_key(&raw[HEADER..HEADER + NONCE]).ok()?;
    let mut body = raw[HEADER + NONCE..].to_vec();
    let plain = key.open_in_place(nonce, Aad::from(&head), &mut body).ok()?;
    Some((Header::read(&head), plain.to_vec()))
}

impl Keys {
    pub fn seal_to_phone(&self, h: &Header, plain: &[u8]) -> Result<String, String> {
        seal(&self.to_phone, h, plain)
    }
    pub fn open_from_phone(&self, d: &str) -> Option<(Header, Vec<u8>)> {
        open(&self.to_pc, d)
    }
    /// What a phone does (for tests, and the simulator).
    #[cfg(test)]
    pub fn seal_to_pc(&self, h: &Header, plain: &[u8]) -> Result<String, String> {
        seal(&self.to_pc, h, plain)
    }
    #[cfg(test)]
    pub fn open_from_pc(&self, d: &str) -> Option<(Header, Vec<u8>)> {
        open(&self.to_phone, d)
    }
}

fn new_session() -> Session {
    let mut s = NO_SESSION;
    // Without randomness nothing else works either; an all-zero id is refused by the phone.
    let _ = SystemRandom::new().fill(&mut s);
    s
}

// ── The connection to the relay ──────────────────────────────────────────────

/// How the relay connection is doing, for Settings.
#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RelayStatus {
    /// "off" | "connecting" | "connected" | "retrying"
    pub state: &'static str,
    pub error: Option<String>,
}

impl RelayStatus {
    pub fn off() -> RelayStatus {
        RelayStatus { state: "off", error: None }
    }
    fn of(state: &'static str, error: Option<String>) -> RelayStatus {
        RelayStatus { state, error }
    }
}

/// Everything a phone's handling needs, shared by every phone that comes through.
#[derive(Clone)]
pub struct Context {
    pub keys: Arc<Keys>,
    pub token: Arc<String>,
    pub name: Arc<String>,
    pub shared: Arc<Shared>,
    pub host: Arc<dyn Host>,
}

/// Stays connected to the relay at `base` (`https://host[:port]`), reconnecting
/// with growing waits, until the task is aborted.
pub async fn run(base: String, cx: Context, report: Arc<dyn Fn(RelayStatus) + Send + Sync>) {
    let url = match base.strip_prefix("https://") {
        Some(rest) => format!("wss://{rest}/r/{}", cx.keys.room),
        None => format!("ws://{}/r/{}", base.trim_start_matches("http://"), cx.keys.room),
    };
    let mut wait = Duration::from_secs(2);
    loop {
        report(RelayStatus::of("connecting", None));
        let (reached, why) = once(&url, &cx, &report).await;
        if reached {
            wait = Duration::from_secs(2);
        }
        let slow = why.slow;
        report(RelayStatus::of("retrying", Some(why.text)));
        tokio::time::sleep(if slow { Duration::from_secs(300) } else { wait }).await;
        wait = (wait * 2).min(Duration::from_secs(60));
    }
}

/// Why a connection ended. `slow`: no point retrying soon (another copy of the
/// app took the room, or the relay refused this PC).
struct Ended {
    text: String,
    slow: bool,
}

impl Ended {
    fn new(text: impl Into<String>) -> Ended {
        Ended { text: text.into(), slow: false }
    }
}

fn client_tls() -> Result<rustls::ClientConfig, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    // Windows' own certificate check, as browsers and the updater use. A built-in root
    // list rejected the certificate that antivirus HTTPS scanning (Avast, AVG, ESET…)
    // puts in front of the relay's, so the link failed or kept retrying on those PCs.
    let verifier = rustls_platform_verifier::Verifier::new(provider.clone()).map_err(|e| e.to_string())?;
    Ok(rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth())
}

/// A phone signed in through the relay.
struct Peer {
    /// Its session id and ours, as agreed in the `hi` frames.
    phone: Session,
    pc: Session,
    /// The highest sequence number taken from it so far.
    last_in: u64,
    /// Its decrypted lines, to its handling. Dropping this ends the phone's connection.
    inbound: mpsc::Sender<String>,
    /// Reads the handling's answers, seals them and sends them out.
    pump: JoinHandle<()>,
}

impl Drop for Peer {
    fn drop(&mut self) {
        // With the pump gone too, the pipe closes and the handling ends (and tidies up).
        self.pump.abort();
    }
}

/// One connection to the relay, until it ends. Returns whether the relay let
/// this PC in, and why it ended.
async fn once(url: &str, cx: &Context, report: &Arc<dyn Fn(RelayStatus) + Send + Sync>) -> (bool, Ended) {
    let request = match url.into_client_request() {
        Ok(r) => r,
        Err(e) => return (false, Ended::new(format!("Bad relay address ({e})"))),
    };
    let tls = match client_tls() {
        Ok(t) => t,
        Err(e) => return (false, Ended::new(e)),
    };
    let mut config = WebSocketConfig::default();
    config.max_message_size = Some(128 * 1024);
    config.max_frame_size = Some(128 * 1024);
    let connector = tokio_tungstenite::Connector::Rustls(Arc::new(tls));
    let connecting = tokio_tungstenite::connect_async_tls_with_config(request, Some(config), true, Some(connector));
    let ws = match tokio::time::timeout(CONNECT_WAIT, connecting).await {
        Ok(Ok((ws, _))) => ws,
        Ok(Err(e)) => return (false, Ended::new(format!("Couldn't reach the relay ({e})"))),
        Err(_) => return (false, Ended::new("Couldn't reach the relay (no answer)")),
    };
    let (mut sink, mut stream) = ws.split();
    let hello = json!({ "t": "hello", "role": "pc", "admit": cx.keys.admit }).to_string();
    if sink.send(Message::Text(hello)).await.is_err() {
        return (false, Ended::new("The relay closed the connection"));
    }

    let (out_tx, mut out_rx) = mpsc::channel::<String>(64);
    let (ended_tx, mut ended_rx) = mpsc::unbounded_channel::<(String, Session)>();
    let mut peers: HashMap<String, Peer> = HashMap::new();
    let mut admitted = false;
    let mut ping = tokio::time::interval(PING_EVERY);
    let mut heard = tokio::time::Instant::now();
    let mut window = tokio::time::Instant::now();
    let mut sent = 0u32;

    let why = loop {
        tokio::select! {
            m = stream.next() => {
                heard = tokio::time::Instant::now();
                match m {
                    Some(Ok(Message::Text(t))) => {
                        let Ok(v) = serde_json::from_str::<Value>(&t) else { continue };
                        match v.get("t").and_then(Value::as_str) {
                            Some("peers") => {
                                if !admitted {
                                    admitted = true;
                                    report(RelayStatus::of("connected", None));
                                }
                                // A phone that left the room: its handling ends.
                                let here: HashSet<&str> = v.get("phones").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).collect();
                                peers.retain(|id, _| here.contains(id.as_str()));
                            }
                            Some("msg") => {
                                let (Some(from), Some(d)) = (v.get("from").and_then(Value::as_str), v.get("d").and_then(Value::as_str)) else { continue };
                                if let Some(reply) = on_frame(cx, &mut peers, &out_tx, &ended_tx, from, d) {
                                    let _ = out_tx.try_send(reply);
                                }
                            }
                            _ => {}
                        }
                    }
                    Some(Ok(Message::Close(frame))) => break closed(frame.map(|f| u16::from(f.code))),
                    Some(Ok(_)) => {} // pings are answered by the library, pongs just count as heard
                    Some(Err(e)) => break Ended::new(format!("Lost the relay ({e})")),
                    None => break Ended::new("Lost the relay"),
                }
            }
            line = out_rx.recv() => {
                let Some(line) = line else { break Ended::new("stopped") };
                // Stay under the relay's limit (it closes a connection that sends too fast).
                let now = tokio::time::Instant::now();
                if now - window >= Duration::from_secs(1) {
                    window = now;
                    sent = 0;
                }
                if sent >= SEND_RATE {
                    tokio::time::sleep_until(window + Duration::from_secs(1)).await;
                    window = tokio::time::Instant::now();
                    sent = 0;
                }
                sent += 1;
                if sink.send(Message::Text(line)).await.is_err() {
                    break Ended::new("Lost the relay");
                }
            }
            ended = ended_rx.recv() => {
                // A phone's handling ended on our side (Pair again, or it went quiet).
                if let Some((id, session)) = ended {
                    if peers.get(&id).is_some_and(|p| p.pc == session) {
                        peers.remove(&id);
                    }
                }
            }
            _ = ping.tick() => {
                if heard.elapsed() > SILENCE_LIMIT {
                    break Ended::new("The relay stopped answering");
                }
                if sink.send(Message::Ping(Vec::new())).await.is_err() {
                    break Ended::new("Lost the relay");
                }
            }
        }
    };
    drop(peers);
    let _ = sink.close().await;
    (admitted, why)
}

/// What a close code from the relay means.
fn closed(code: Option<u16>) -> Ended {
    match code {
        Some(4401) => Ended { text: "The relay refused this PC (the room has a different secret). Pair the phone again.".into(), slow: true },
        Some(4000) => Ended { text: "Another copy of Desk Companion with the same pairing is using the relay.".into(), slow: true },
        Some(4429) => Ended::new("Sent the relay too much at once"),
        Some(1009) => Ended::new("A message was too big for the relay"),
        _ => Ended::new("The relay closed the connection"),
    }
}

/// Handles one frame from a phone. Returns a message to send back, if any.
fn on_frame(
    cx: &Context,
    peers: &mut HashMap<String, Peer>,
    out: &mpsc::Sender<String>,
    ended: &mpsc::UnboundedSender<(String, Session)>,
    from: &str,
    d: &str,
) -> Option<String> {
    // Only a frame that decrypts is from a phone; the relay's id is just a label.
    let (h, plain) = cx.keys.open_from_phone(d)?;
    if from.is_empty() || from.len() > 32 {
        return None;
    }
    match h.kind {
        HI if h.to == NO_SESSION && h.seq == 0 && h.from != NO_SESSION && plain.is_empty() => {
            if !peers.contains_key(from) && peers.len() >= proto::MAX_PHONES {
                return None;
            }
            // A new session (the phone connected again): the old one ends.
            let pc = new_session();
            peers.remove(from);
            peers.insert(from.to_string(), start_peer(cx, out.clone(), ended.clone(), from.to_string(), h.from, pc));
            let hi = cx.keys.seal_to_phone(&Header { kind: HI, from: pc, to: h.from, seq: 0 }, b"").ok()?;
            Some(msg_to(from, &hi))
        }
        DATA => {
            let p = peers.get_mut(from)?;
            if h.from != p.phone || h.to != p.pc || h.seq <= p.last_in {
                return None; // another session's frame, or one seen before
            }
            p.last_in = h.seq;
            let line = String::from_utf8(plain).ok()?;
            if line.contains('\n') || line.len() > proto::MAX_LINE {
                return None;
            }
            // A phone sending faster than its handling reads loses lines, not the link.
            let _ = p.inbound.try_send(line);
            None
        }
        _ => None,
    }
}

fn msg_to(id: &str, d: &str) -> String {
    json!({ "t": "msg", "to": id, "d": d }).to_string()
}

/// Starts a phone's handling: `server::connection` on one end of a pipe; this
/// side feeds it the phone's lines and sends its answers out sealed.
fn start_peer(cx: &Context, out: mpsc::Sender<String>, ended: mpsc::UnboundedSender<(String, Session)>, id: String, phone: Session, pc: Session) -> Peer {
    let (ours, theirs) = tokio::io::duplex(256 * 1024);
    let (read, mut write) = tokio::io::split(ours);

    let c = cx.clone();
    tokio::spawn(async move {
        server::connection(theirs, "relay".to_string(), &c.token, &c.name, &c.shared, c.host.as_ref()).await;
    });

    let (inbound, mut lines) = mpsc::channel::<String>(32);
    tokio::spawn(async move {
        while let Some(mut line) = lines.recv().await {
            line.push('\n');
            if write.write_all(line.as_bytes()).await.is_err() {
                break;
            }
        }
        // Dropping `write` here; the handling sees the end once the pump has gone too.
    });

    let keys = cx.keys.clone();
    let pump = tokio::spawn(async move {
        let mut r = BufReader::new(read);
        let mut buf = Vec::new();
        let mut seq = 0u64;
        while let Ok(Some(line)) = server::next_line(&mut r, &mut buf).await {
            seq += 1;
            let Ok(d) = keys.seal_to_phone(&Header { kind: DATA, from: pc, to: phone, seq }, line.as_bytes()) else { break };
            if out.send(msg_to(&id, &d)).await.is_err() {
                break;
            }
        }
        let _ = ended.send((id, pc));
    });
    Peer { phone, pc, last_in: 0, inbound, pump }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"; // bytes 0..31

    #[test]
    fn keys_are_derived_from_the_token_the_same_way_everywhere() {
        // The same values are checked in the phone's tests (RelayCryptoTest) and by node (docs/RELAY.md).
        let k = Keys::derive(TOKEN).unwrap();
        assert_eq!(k.room, "22494d1d6c8b9ae8aa0209dd0dbb9b95");
        assert_eq!(k.admit, "7d2f88774354b599914d1cce1898e20acbb4c9c879e4ae29164e48caf283dbb1");
        // Frames sealed by node with a fixed nonce (bytes 0..11) open here.
        let from_phone = "AQIBAQEBAQEBAQEBAQEBAQEBAgICAgICAgICAgICAgICAgAAAAAAAAAHAAECAwQFBgcICQoL07RJESzNc/lfbKy0r1FYmQj7u4LqnEGZdSdLyw==";
        assert_eq!(k.open_from_phone(from_phone), Some((Header { kind: DATA, from: [1; 16], to: [2; 16], seq: 7 }, b"{\"t\":\"ping\"}".to_vec())));
        let from_pc = "AQEDAwMDAwMDAwMDAwMDAwMDBAQEBAQEBAQEBAQEBAQEBAAAAAAAAAAAAAECAwQFBgcICQoLJD7cMpmRUOdq39aiqu1ZsA==";
        assert_eq!(k.open_from_pc(from_pc), Some((Header { kind: HI, from: [3; 16], to: [4; 16], seq: 0 }, Vec::new())));
        assert!(Keys::derive("short").is_err());
        assert_ne!(Keys::derive(&URL_SAFE_NO_PAD.encode([7u8; 32])).unwrap().room, k.room);
    }

    #[test]
    fn frames_open_only_with_the_right_key_and_unchanged() {
        let k = Keys::derive(TOKEN).unwrap();
        let h = Header { kind: DATA, from: [1; 16], to: [2; 16], seq: 7 };
        let d = k.seal_to_phone(&h, b"{\"t\":\"pong\"}").unwrap();
        assert_eq!(k.open_from_pc(&d), Some((h, b"{\"t\":\"pong\"}".to_vec())));
        // Not in the other direction, and not with another pairing's keys.
        assert_eq!(k.open_from_phone(&d), None);
        assert_eq!(Keys::derive(&URL_SAFE_NO_PAD.encode([7u8; 32])).unwrap().open_from_pc(&d), None);
        // Any changed byte (header, nonce or body) is refused.
        let raw = STANDARD.decode(&d).unwrap();
        for i in [1, 5, 30, 41, 45, raw.len() - 1] {
            let mut bad = raw.clone();
            bad[i] ^= 1;
            assert_eq!(k.open_from_pc(&STANDARD.encode(bad)), None, "byte {i}");
        }
        assert_eq!(k.open_from_pc("not base64!"), None);
        assert_eq!(k.open_from_pc(""), None);
        // Two seals of the same thing differ (random nonces).
        assert_ne!(k.seal_to_phone(&h, b"x").unwrap(), k.seal_to_phone(&h, b"x").unwrap());
    }

    struct Pc;
    impl Host for Pc {
        fn approvals(&self) -> bool {
            true
        }
        fn seen(&self, _: &str) {}
        fn decide(&self, rid: &str, _: bool) -> bool {
            rid == "waiting"
        }
        fn answer(&self, _: &str, _: &[(String, String)]) -> bool {
            false
        }
        fn reply(&self, _: &str, _: &str) -> bool {
            false
        }
        fn set_character(&self, _: &str, _: Option<&str>, _: Option<&str>, _: Option<&str>) -> bool {
            false
        }
        fn addresses(&self) -> Vec<String> {
            Vec::new()
        }
        fn relay(&self) -> Option<String> {
            Some("https://r.example".into())
        }
        fn phones_changed(&self) {}
    }

    /// The next message the PC sends the relay, opened as the phone would.
    async fn next_out(k: &Keys, out: &mut mpsc::Receiver<String>) -> (Header, Value) {
        let m = tokio::time::timeout(Duration::from_secs(2), out.recv()).await.expect("nothing sent").unwrap();
        let m: Value = serde_json::from_str(&m).unwrap();
        assert_eq!(m["to"], "p1");
        let (h, plain) = k.open_from_pc(m["d"].as_str().unwrap()).expect("doesn't open");
        (h, if plain.is_empty() { Value::Null } else { serde_json::from_slice(&plain).unwrap() })
    }

    #[test]
    fn a_phone_through_the_relay_gets_the_same_handling_and_replays_are_refused() {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            let k = Arc::new(Keys::derive(TOKEN).unwrap());
            let shared = Shared::new();
            let cx = Context { keys: k.clone(), token: Arc::new(TOKEN.into()), name: Arc::new("PC".into()), shared: shared.clone(), host: Arc::new(Pc) };
            let (out_tx, mut out) = mpsc::channel(64);
            let (ended_tx, _ended) = mpsc::unbounded_channel();
            let mut peers = HashMap::new();
            let frame = |peers: &mut HashMap<String, Peer>, d: &str| {
                if let Some(reply) = on_frame(&cx, peers, &out_tx, &ended_tx, "p1", d) {
                    out_tx.try_send(reply).unwrap();
                }
            };

            // hi, answered with the PC's own session, naming the phone's.
            let phone = [9u8; 16];
            frame(&mut peers, &k.seal_to_pc(&Header { kind: HI, from: phone, to: NO_SESSION, seq: 0 }, b"").unwrap());
            let (h, _) = next_out(&k, &mut out).await;
            assert_eq!((h.kind, h.to, h.seq), (HI, phone, 0));
            let pc = h.from;
            assert_ne!(pc, NO_SESSION);

            // Then the usual sign-in, with the token, inside the encryption.
            let data = |seq: u64, line: &str| k.seal_to_pc(&Header { kind: DATA, from: phone, to: pc, seq }, line.as_bytes()).unwrap();
            let hello = format!(r#"{{"t":"hello","v":1,"token":"{TOKEN}","device":"Pixel"}}"#);
            frame(&mut peers, &data(1, &hello));
            let (h, welcome) = next_out(&k, &mut out).await;
            assert_eq!((h.kind, h.from, h.to, h.seq), (DATA, pc, phone, 1));
            assert_eq!((welcome["t"].as_str(), welcome["relay"].as_str()), (Some("welcome"), Some("https://r.example")));
            assert_eq!(next_out(&k, &mut out).await.1["t"], "character");
            assert_eq!(next_out(&k, &mut out).await.1["t"], "sessions");
            assert_eq!(shared.phones()[0].address, "relay");

            let allow = data(2, r#"{"t":"decision","rid":"waiting","decision":"allow"}"#);
            frame(&mut peers, &allow);
            let (h, d) = next_out(&k, &mut out).await;
            assert_eq!((h.seq, d["t"].as_str(), d["ok"].as_bool()), (4, Some("decided"), Some(true)));

            // The same frame again, an older number, or one from another session: nothing happens.
            frame(&mut peers, &allow);
            frame(&mut peers, &data(2, r#"{"t":"ping"}"#));
            frame(&mut peers, &k.seal_to_pc(&Header { kind: DATA, from: [8; 16], to: pc, seq: 9 }, br#"{"t":"ping"}"#).unwrap());
            frame(&mut peers, &k.seal_to_pc(&Header { kind: DATA, from: phone, to: [8; 16], seq: 9 }, br#"{"t":"ping"}"#).unwrap());
            // Sealed the wrong way round (as if from the PC): refused.
            frame(&mut peers, &k.seal_to_phone(&Header { kind: DATA, from: phone, to: pc, seq: 10 }, br#"{"t":"ping"}"#).unwrap());
            assert!(tokio::time::timeout(Duration::from_millis(300), out.recv()).await.is_err(), "answered a replay");

            frame(&mut peers, &data(3, r#"{"t":"ping"}"#));
            assert_eq!(next_out(&k, &mut out).await.1["t"], "pong");

            // The phone leaves the room: its handling ends and it's no longer listed.
            peers.clear();
            for _ in 0..50 {
                if shared.phones().is_empty() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            assert!(shared.phones().is_empty());
        });
    }

    #[test]
    fn relay_addresses_become_room_urls() {
        // (run() builds them; checked through the same rule here)
        let k = Keys::derive(TOKEN).unwrap();
        let base = proto::relay_address("https://r.example.workers.dev/").unwrap();
        assert_eq!(format!("wss://{}/r/{}", base.strip_prefix("https://").unwrap(), k.room), "wss://r.example.workers.dev/r/22494d1d6c8b9ae8aa0209dd0dbb9b95");
    }
}
