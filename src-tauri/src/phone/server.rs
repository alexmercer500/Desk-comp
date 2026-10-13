// The phone link's TLS server. One task accepts connections; each connection
// gets a reader task (lines in, through a channel, so nothing is lost when the
// main loop waits on several things at once) and a loop that sends sessions,
// answers pings and applies decisions.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use serde::Serialize;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch};
use tokio_rustls::TlsAcceptor;

use super::identity::Identity;
use super::proto::{self, FromPhone};

/// A phone signed in right now, for Settings.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneInfo {
    #[serde(skip)]
    id: u64,
    pub device: String,
    pub address: String,
    /// When it signed in, ms since 1970.
    pub since: u64,
    /// Away mode is on: finished turns may be held for a reply from it.
    pub away: bool,
}

/// What the server and its connections share; outlives a restart (Pair again).
pub struct Shared {
    /// The current `sessions` line, replaced whenever the companion page sends a new list.
    pub sessions: watch::Sender<Arc<String>>,
    /// The current `character` line (what the PC shows), replaced when the user changes it.
    pub character: watch::Sender<Arc<String>>,
    /// Bumped to drop every phone (Pair again, link turned off).
    pub kick: watch::Sender<u64>,
    pub phones: Mutex<Vec<PhoneInfo>>,
    connections: AtomicUsize,
    next_id: AtomicU64,
}

impl Shared {
    pub fn new() -> Arc<Shared> {
        Arc::new(Shared {
            sessions: watch::channel(Arc::new(proto::sessions(&serde_json::json!([])))).0,
            character: watch::channel(Arc::new(proto::character("kulhi", "toy", "cream"))).0,
            kick: watch::channel(0).0,
            phones: Mutex::new(Vec::new()),
            connections: AtomicUsize::new(0),
            next_id: AtomicU64::new(1),
        })
    }

    pub fn phones(&self) -> Vec<PhoneInfo> {
        self.phones.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// A phone that wants finished turns held for its reply is signed in.
    pub fn any_away(&self) -> bool {
        self.phones.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|p| p.away)
    }

    /// Closes every phone's connection.
    pub fn kick_all(&self) {
        self.kick.send_modify(|n| *n += 1);
    }
}

/// What the app does with a phone's messages (the real one in mod.rs; a fake in tests).
pub trait Host: Send + Sync + 'static {
    /// Allow / Deny from the phone is accepted right now.
    fn approvals(&self) -> bool;
    /// The phone is showing this request.
    fn seen(&self, rid: &str);
    /// The user's answer; false when the request is already gone.
    fn decide(&self, rid: &str, allow: bool) -> bool;
    /// Answers to a question card; false when it's already gone.
    fn answer(&self, rid: &str, answers: &[(String, String)]) -> bool;
    /// A further prompt for a held turn; false when it's no longer held.
    fn reply(&self, rid: &str, text: &str) -> bool;
    /// The user picked a character on the phone; false when it isn't a known one.
    fn set_character(&self, id: &str, look: Option<&str>, theme: Option<&str>) -> bool;
    /// The list of phones changed.
    fn phones_changed(&self);
}

pub fn tls(id: &Identity) -> Result<TlsAcceptor, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let cert = CertificateDer::from(id.cert_der.clone());
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(id.key_der.clone()));
    let config = rustls::ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|e| e.to_string())?
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)
        .map_err(|e| e.to_string())?;
    Ok(TlsAcceptor::from(Arc::new(config)))
}

/// Accepts connections until the task is aborted.
pub async fn serve(listener: TcpListener, acceptor: TlsAcceptor, token: Arc<String>, name: Arc<String>, shared: Arc<Shared>, host: Arc<dyn Host>) {
    loop {
        let Ok((stream, addr)) = listener.accept().await else {
            tokio::time::sleep(Duration::from_millis(200)).await;
            continue;
        };
        // Strangers from outside the local network never get as far as TLS.
        if !proto::local_peer(addr.ip()) {
            continue;
        }
        if shared.connections.load(Ordering::SeqCst) >= proto::MAX_CONNECTIONS {
            continue;
        }
        let _ = stream.set_nodelay(true);
        let (acceptor, token, name, shared, host) = (acceptor.clone(), token.clone(), name.clone(), shared.clone(), host.clone());
        tokio::spawn(async move {
            shared.connections.fetch_add(1, Ordering::SeqCst);
            let tls = tokio::time::timeout(proto::HELLO_WAIT, acceptor.accept(stream)).await;
            if let Ok(Ok(tls)) = tls {
                connection(tls, addr, &token, &name, &shared, host.as_ref()).await;
            }
            shared.connections.fetch_sub(1, Ordering::SeqCst);
        });
    }
}

async fn connection<S>(stream: S, addr: SocketAddr, token: &str, name: &str, shared: &Shared, host: &dyn Host)
where
    S: tokio::io::AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (read, mut write) = tokio::io::split(stream);
    let (tx, mut rx) = mpsc::channel::<String>(16);
    let reader = tokio::spawn(async move {
        let mut r = BufReader::new(read);
        let mut buf = Vec::new();
        while let Ok(Some(line)) = next_line(&mut r, &mut buf).await {
            if tx.send(line).await.is_err() {
                break;
            }
        }
    });

    let id = 'hello: {
        let Ok(Some(first)) = tokio::time::timeout(proto::HELLO_WAIT, rx.recv()).await else { break 'hello None };
        match proto::parse(&first) {
            Ok(FromPhone::Hello { v, .. }) if v != proto::VERSION => {
                let _ = send(&mut write, &proto::error("version", "Update the app on your phone or on your PC")).await;
                None
            }
            Ok(FromPhone::Hello { token: given, device, away, .. }) => {
                if !proto::same_secret(&given, token) {
                    tokio::time::sleep(proto::WRONG_TOKEN_DELAY).await;
                    let _ = send(&mut write, &proto::error("token", "This phone isn't paired any more. Scan the code in Settings again")).await;
                    break 'hello None;
                }
                let admitted = {
                    let mut phones = shared.phones.lock().unwrap_or_else(|e| e.into_inner());
                    (phones.len() < proto::MAX_PHONES).then(|| {
                        let id = shared.next_id.fetch_add(1, Ordering::SeqCst);
                        phones.push(PhoneInfo { id, device, address: addr.ip().to_string(), since: now_ms(), away });
                        id
                    })
                };
                if admitted.is_none() {
                    let _ = send(&mut write, &proto::error("busy", "Too many phones are linked right now")).await;
                }
                admitted
            }
            _ => {
                let _ = send(&mut write, &proto::error("hello", "Say hello first")).await;
                None
            }
        }
    };
    let Some(id) = id else {
        reader.abort();
        return;
    };
    host.phones_changed();

    let mut sessions = shared.sessions.subscribe();
    let mut kick = shared.kick.subscribe();
    let mut character = shared.character.subscribe();
    let first = sessions.borrow_and_update().clone();
    let look = character.borrow_and_update().clone();
    let mut ok = send(&mut write, &proto::welcome(name, host.approvals())).await.is_ok()
        && send(&mut write, &look).await.is_ok()
        && send(&mut write, &first).await.is_ok();
    let mut deadline = tokio::time::Instant::now() + proto::IDLE_LIMIT;
    while ok {
        tokio::select! {
            line = rx.recv() => {
                let Some(line) = line else { break };
                deadline = tokio::time::Instant::now() + proto::IDLE_LIMIT;
                let reply = match proto::parse(&line) {
                    Ok(FromPhone::Ping) => Some(proto::pong()),
                    Ok(FromPhone::Seen { rid }) => { host.seen(&rid); None }
                    Ok(FromPhone::Decision { rid, allow }) => {
                        let done = host.approvals() && host.decide(&rid, allow);
                        Some(proto::decided(&rid, done))
                    }
                    Ok(FromPhone::Answer { rid, answers }) => {
                        let done = host.approvals() && host.answer(&rid, &answers);
                        Some(proto::decided(&rid, done))
                    }
                    Ok(FromPhone::Reply { rid, text }) => {
                        let done = host.reply(&rid, &text);
                        Some(proto::decided(&rid, done))
                    }
                    Ok(FromPhone::Character { id, look, theme }) => {
                        // The change comes back to every phone through the `character` channel.
                        host.set_character(&id, look.as_deref(), theme.as_deref());
                        None
                    }
                    Ok(FromPhone::Away { on }) => {
                        let mut phones = shared.phones.lock().unwrap_or_else(|e| e.into_inner());
                        if let Some(p) = phones.iter_mut().find(|p| p.id == id) {
                            p.away = on;
                        }
                        None
                    }
                    // A second hello, a newer phone's message, or a bad line: nothing to do.
                    _ => None,
                };
                if let Some(reply) = reply {
                    ok = send(&mut write, &reply).await.is_ok();
                }
            }
            changed = character.changed() => {
                if changed.is_err() { break }
                let line = character.borrow_and_update().clone();
                ok = send(&mut write, &line).await.is_ok();
            }
            changed = sessions.changed() => {
                if changed.is_err() { break }
                let line = sessions.borrow_and_update().clone();
                ok = send(&mut write, &line).await.is_ok();
            }
            _ = kick.changed() => {
                let _ = send(&mut write, &proto::error("token", "Paired again on the PC. Scan the new code")).await;
                break;
            }
            _ = tokio::time::sleep_until(deadline) => break,
        }
    }

    reader.abort();
    let _ = write.shutdown().await;
    shared.phones.lock().unwrap_or_else(|e| e.into_inner()).retain(|p| p.id != id);
    host.phones_changed();
}

/// Writes one line, giving up on a phone that stops reading.
async fn send<W: AsyncWrite + Unpin>(w: &mut W, line: &str) -> std::io::Result<()> {
    tokio::time::timeout(Duration::from_secs(10), async {
        w.write_all(line.as_bytes()).await?;
        w.flush().await
    })
    .await
    .map_err(|_| std::io::Error::other("phone stopped reading"))?
}

/// The next line (without its newline), refusing lines over MAX_LINE.
/// None at the end of the stream.
async fn next_line<R: AsyncBufRead + Unpin>(r: &mut R, buf: &mut Vec<u8>) -> std::io::Result<Option<String>> {
    buf.clear();
    loop {
        let available = r.fill_buf().await?;
        if available.is_empty() {
            return Ok(None);
        }
        if let Some(i) = available.iter().position(|&b| b == b'\n') {
            buf.extend_from_slice(&available[..i]);
            r.consume(i + 1);
            break;
        }
        let n = available.len();
        buf.extend_from_slice(available);
        r.consume(n);
        if buf.len() > proto::MAX_LINE {
            return Err(std::io::Error::other("line too long"));
        }
    }
    if buf.len() > proto::MAX_LINE {
        return Err(std::io::Error::other("line too long"));
    }
    String::from_utf8(std::mem::take(buf)).map(Some).map_err(|_| std::io::Error::other("not UTF-8"))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    #[derive(Default)]
    struct FakeHost {
        decisions: Mutex<Vec<(String, bool)>>,
        seen: Mutex<Vec<String>>,
        answers: Mutex<Vec<(String, Vec<(String, String)>)>>,
        replies: Mutex<Vec<(String, String)>>,
        characters: Mutex<Vec<(String, Option<String>, Option<String>)>>,
    }
    impl Host for FakeHost {
        fn approvals(&self) -> bool {
            true
        }
        fn seen(&self, rid: &str) {
            self.seen.lock().unwrap().push(rid.into());
        }
        fn decide(&self, rid: &str, allow: bool) -> bool {
            self.decisions.lock().unwrap().push((rid.into(), allow));
            rid == "waiting"
        }
        fn answer(&self, rid: &str, answers: &[(String, String)]) -> bool {
            self.answers.lock().unwrap().push((rid.into(), answers.to_vec()));
            rid == "asked"
        }
        fn reply(&self, rid: &str, text: &str) -> bool {
            self.replies.lock().unwrap().push((rid.into(), text.into()));
            rid == "held"
        }
        fn set_character(&self, id: &str, look: Option<&str>, theme: Option<&str>) -> bool {
            self.characters.lock().unwrap().push((id.into(), look.map(Into::into), theme.map(Into::into)));
            id != "bogus"
        }
        fn phones_changed(&self) {}
    }

    async fn read_line<R: AsyncBufRead + Unpin>(r: &mut R) -> serde_json::Value {
        let mut buf = Vec::new();
        let line = tokio::time::timeout(Duration::from_secs(2), next_line(r, &mut buf)).await.unwrap().unwrap().unwrap();
        serde_json::from_str(&line).unwrap()
    }

    fn rt() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap()
    }

    #[test]
    fn a_paired_phone_gets_welcome_and_sessions_and_its_decisions_are_applied() {
        rt().block_on(async {
            let shared = Shared::new();
            shared.sessions.send_replace(Arc::new(proto::sessions(&serde_json::json!([{ "id": "s1" }]))));
            let host = Arc::new(FakeHost::default());
            let (phone, pc) = duplex(64 * 1024);
            let (s, h) = (shared.clone(), host.clone());
            let task = tokio::spawn(async move { connection(pc, "192.168.1.9:5000".parse().unwrap(), "secret", "PC", &s, h.as_ref()).await });
            let (r, mut w) = tokio::io::split(phone);
            let mut r = BufReader::new(r);

            w.write_all(b"{\"t\":\"hello\",\"v\":1,\"token\":\"secret\",\"device\":\"Pixel\"}\n").await.unwrap();
            assert_eq!(read_line(&mut r).await["t"], "welcome");
            assert_eq!(read_line(&mut r).await["t"], "character");
            assert_eq!(read_line(&mut r).await["sessions"][0]["id"], "s1");
            assert_eq!(shared.phones().len(), 1);
            assert_eq!(shared.phones()[0].device, "Pixel");

            // A new list goes out as soon as the page sends one.
            shared.sessions.send_replace(Arc::new(proto::sessions(&serde_json::json!([{ "id": "s2" }]))));
            assert_eq!(read_line(&mut r).await["sessions"][0]["id"], "s2");

            w.write_all(b"{\"t\":\"seen\",\"rid\":\"waiting\"}\n{\"t\":\"decision\",\"rid\":\"waiting\",\"decision\":\"deny\"}\n").await.unwrap();
            let d = read_line(&mut r).await;
            assert_eq!((d["t"].as_str(), d["ok"].as_bool()), (Some("decided"), Some(true)));
            w.write_all(b"{\"t\":\"decision\",\"rid\":\"gone\",\"decision\":\"allow\"}\n").await.unwrap();
            assert_eq!(read_line(&mut r).await["ok"], false);
            assert_eq!(*host.seen.lock().unwrap(), vec!["waiting".to_string()]);
            assert_eq!(*host.decisions.lock().unwrap(), vec![("waiting".to_string(), false), ("gone".to_string(), true)]);

            // Picking a character on the phone goes to the host; a change on the PC reaches the phone.
            w.write_all(b"{\"t\":\"character\",\"id\":\"glim\"}\n").await.unwrap();
            shared.character.send_replace(Arc::new(proto::character("glim", "toy", "cream")));
            let c = read_line(&mut r).await;
            assert_eq!((c["t"].as_str(), c["id"].as_str()), (Some("character"), Some("glim")));
            assert_eq!(host.characters.lock().unwrap()[0].0, "glim");

            // Answers and replies go to the host; away mode is kept per phone.
            assert!(!shared.any_away());
            w.write_all(b"{\"t\":\"away\",\"on\":true}\n{\"t\":\"answer\",\"rid\":\"asked\",\"answers\":{\"Which?\":\"Blue\"}}\n").await.unwrap();
            assert_eq!(read_line(&mut r).await["ok"], true);
            assert!(shared.any_away());
            w.write_all(b"{\"t\":\"reply\",\"rid\":\"held\",\"text\":\"Now the docs\"}\n").await.unwrap();
            assert_eq!(read_line(&mut r).await["ok"], true);
            w.write_all(b"{\"t\":\"reply\",\"rid\":\"over\",\"text\":\"Too late\"}\n").await.unwrap();
            assert_eq!(read_line(&mut r).await["ok"], false);
            assert_eq!(host.answers.lock().unwrap()[0], ("asked".to_string(), vec![("Which?".to_string(), "Blue".to_string())]));
            assert_eq!(host.replies.lock().unwrap().len(), 2);

            w.write_all(b"{\"t\":\"ping\"}\n").await.unwrap();
            assert_eq!(read_line(&mut r).await["t"], "pong");

            // Pair again: the phone is told and dropped.
            shared.kick_all();
            assert_eq!(read_line(&mut r).await["code"], "token");
            task.await.unwrap();
            assert!(shared.phones().is_empty());
        });
    }

    #[test]
    fn a_wrong_token_or_no_hello_gets_nothing() {
        rt().block_on(async {
            for (first, code) in [
                ("{\"t\":\"hello\",\"v\":1,\"token\":\"guess\"}\n", "token"),
                ("{\"t\":\"hello\",\"v\":9,\"token\":\"secret\"}\n", "version"),
                ("{\"t\":\"decision\",\"rid\":\"waiting\",\"decision\":\"allow\"}\n", "hello"),
            ] {
                let shared = Shared::new();
                let host = Arc::new(FakeHost::default());
                let (phone, pc) = duplex(64 * 1024);
                let (s, h) = (shared.clone(), host.clone());
                let task = tokio::spawn(async move { connection(pc, "10.0.0.2:1".parse().unwrap(), "secret", "PC", &s, h.as_ref()).await });
                let (r, mut w) = tokio::io::split(phone);
                let mut r = BufReader::new(r);
                w.write_all(first.as_bytes()).await.unwrap();
                let reply = read_line(&mut r).await;
                assert_eq!((reply["t"].as_str(), reply["code"].as_str()), (Some("error"), Some(code)), "{first}");
                task.await.unwrap();
                assert!(host.decisions.lock().unwrap().is_empty());
                assert!(shared.phones().is_empty());
            }
        });
    }

    #[test]
    fn overlong_lines_are_refused() {
        rt().block_on(async {
            let data = vec![b'x'; proto::MAX_LINE + 10];
            let mut r = BufReader::new(&data[..]);
            let mut buf = Vec::new();
            assert!(next_line(&mut r, &mut buf).await.is_err());
        });
    }
}
