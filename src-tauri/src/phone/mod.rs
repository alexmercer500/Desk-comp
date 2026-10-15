// The phone link (docs/PHONE_LINK.md): Desk Companion for Android pairs with
// this PC by QR code and connects over the local network with TLS, to see the
// sessions and answer permission requests.
//
// Off by default (Settings → Phone, pref `phoneLink`). Turned on, it listens
// on port 47822 for phones on private addresses only. The companion page sends
// the session list (`phone_sessions`); phones get it on connect and on every
// change. A phone's Allow / Deny goes the same way as a click in the bubble:
// to the relay holding the request open (agents::decide); so do answers to
// Claude's questions.
//
// Away from home: with the relay on (Settings → Phone, `phoneRelay` and
// `relayUrl`), the PC also stays connected to the user's relay on the internet,
// and phones that can't reach it directly come through there, end-to-end
// encrypted (relay.rs, docs/RELAY.md).
//
// Replies: while a phone with away mode is signed in, a finished Claude Code
// turn is held for a few minutes (agents.rs); any key or mouse movement on
// this PC lets it go at once. Its session then carries `reply` for phones,
// and a reply from one goes to the relay holding the turn.

mod identity;
mod proto;
mod relay;
mod server;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use identity::Identity;
use relay::RelayStatus;
use server::{Host, PhoneInfo, Shared};

pub use proto::relay_address;

/// The link's state: the shared part outlives restarts; `running` is the server task.
pub struct PhoneLink {
    shared: Arc<Shared>,
    running: Mutex<Option<Running>>,
    /// Why the link couldn't start (port in use, keys not saved), for Settings.
    error: Mutex<Option<String>>,
    /// The page's latest session list, before `reply` is added.
    list: Mutex<Value>,
    /// Turns held for a reply: session id → (request id, until when, ms since 1970).
    holds: Mutex<HashMap<String, (String, u64)>>,
    /// The relay connection's task, and how it's doing.
    relay: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    relay_status: Arc<Mutex<RelayStatus>>,
}

struct Running {
    task: tauri::async_runtime::JoinHandle<()>,
    identity: Identity,
    port: u16,
}

impl Default for PhoneLink {
    fn default() -> Self {
        PhoneLink {
            shared: Shared::new(),
            running: Mutex::new(None),
            error: Mutex::new(None),
            list: Mutex::new(Value::Array(Vec::new())),
            holds: Mutex::new(HashMap::new()),
            relay: Mutex::new(None),
            relay_status: Arc::new(Mutex::new(RelayStatus::off())),
        }
    }
}

/// What the app does with a phone's messages.
struct AppHost(AppHandle);

impl Host for AppHost {
    fn approvals(&self) -> bool {
        let p = crate::system::current(&self.0);
        p.answer_permissions && p.notify_permission
    }
    fn seen(&self, rid: &str) {
        crate::agents::mark_shown(&self.0, rid);
    }
    fn decide(&self, rid: &str, allow: bool) -> bool {
        crate::agents::decide_from_phone(&self.0, rid, if allow { "allow" } else { "deny" })
    }
    fn answer(&self, rid: &str, answers: &[(String, String)]) -> bool {
        crate::agents::answer_from_phone(&self.0, rid, answers)
    }
    fn reply(&self, rid: &str, text: &str) -> bool {
        crate::agents::reply_from_phone(&self.0, rid, text)
    }
    fn set_character(&self, id: &str, look: Option<&str>, theme: Option<&str>, outfit: Option<&str>) -> bool {
        // Same checks as picking it in Settings: unknown names are refused.
        let set = |key: &str, v: &str| crate::system::update(&self.0, key, &Value::String(v.to_string())).is_ok();
        set("character", id)
            && look.is_none_or(|l| set("ruiLook", l))
            && theme.is_none_or(|t| set("ruiTheme", t))
            && outfit.is_none_or(|o| set("dogeshOutfit", o))
    }
    fn addresses(&self) -> Vec<String> {
        hosts()
    }
    fn relay(&self) -> Option<String> {
        relay_url(&self.0)
    }
    fn phones_changed(&self) {
        let _ = self.0.emit("phone-status", status_of(&self.0));
    }
}

/// Whether to hold a finished turn for a reply: the link is on, a phone with
/// away mode is signed in, and answering from the companion is on. Away mode
/// is the user saying they're away; there's no wait for the PC to go idle
/// first (that made replies impossible to try from a PC in use). Someone at
/// the PC loses nothing: their next key or mouse movement lets the turn go
/// (keep_holding).
pub fn should_hold(app: &AppHandle) -> bool {
    let p = crate::system::current(app);
    let link = app.state::<PhoneLink>();
    let running = link.running.lock().unwrap_or_else(|e| e.into_inner()).is_some();
    p.phone_link && p.answer_permissions && running && link.shared.any_away()
}

/// Seconds since the last input on this PC. Debug builds can pretend nobody's
/// there (DESK_COMPANION_ASSUME_AWAY=1), to test held turns from a busy PC.
fn idle_secs() -> Option<u64> {
    #[cfg(debug_assertions)]
    if std::env::var_os("DESK_COMPANION_ASSUME_AWAY").is_some() {
        return Some(u64::MAX);
    }
    crate::system::idle_secs()
}

/// Whether a held turn should go on waiting: still a phone to reply from, and
/// still nobody at the PC (any key or mouse movement lets it go).
pub fn keep_holding(app: &AppHandle) -> bool {
    let link = app.state::<PhoneLink>();
    let running = link.running.lock().unwrap_or_else(|e| e.into_inner()).is_some();
    running && link.shared.any_away() && idle_secs().is_none_or(|s| s >= 1)
}

pub fn hold_started(app: &AppHandle, session: &str, rid: &str, until: u64) {
    let link = app.state::<PhoneLink>();
    link.holds.lock().unwrap_or_else(|e| e.into_inner()).insert(session.to_string(), (rid.to_string(), until));
    let _ = publish(&link);
}

pub fn hold_ended(app: &AppHandle, session: &str, rid: &str) {
    let link = app.state::<PhoneLink>();
    {
        let mut holds = link.holds.lock().unwrap_or_else(|e| e.into_inner());
        if holds.get(session).is_some_and(|(r, _)| r == rid) {
            holds.remove(session);
        }
    }
    let _ = publish(&link);
}

/// Sends phones the page's list, with `reply` on each session held for one.
fn publish(link: &PhoneLink) -> Result<(), String> {
    let mut list = link.list.lock().unwrap_or_else(|e| e.into_inner()).clone();
    {
        let holds = link.holds.lock().unwrap_or_else(|e| e.into_inner());
        for s in list.as_array_mut().into_iter().flatten() {
            let held = s.get("id").and_then(Value::as_str).and_then(|id| holds.get(id)).cloned();
            if let (Some((rid, until)), Some(o)) = (held, s.as_object_mut()) {
                o.insert("reply".into(), serde_json::json!({ "rid": rid, "until": until }));
            }
        }
    }
    let line = proto::sessions(&list);
    if line.len() > MAX_SESSIONS_BYTES.min(proto::MAX_LINE) {
        return Err("session list too long".into());
    }
    link.shared.sessions.send_if_modified(|current| {
        if **current == line {
            return false;
        }
        *current = Arc::new(line);
        true
    });
    Ok(())
}

/// The character (or Rui's look or colour, or Dogesh Bhai's outfit) changed on the PC: tell the phones.
pub fn character_changed(app: &AppHandle) {
    let p = crate::system::current(app);
    let line = proto::character(&p.character, &p.rui_look, &p.rui_theme, &p.dogesh_outfit);
    app.state::<PhoneLink>().shared.character.send_if_modified(|current| {
        if **current == line {
            return false;
        }
        *current = Arc::new(line);
        true
    });
}

/// Starts or stops the link to match the setting. Called at start-up and when it changes.
pub fn apply(app: &AppHandle) {
    character_changed(app);
    if crate::system::current(app).phone_link {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let result = start(&app, None).await;
            *app.state::<PhoneLink>().error.lock().unwrap_or_else(|e| e.into_inner()) = result.err();
            let _ = app.emit("phone-status", status_of(&app));
        });
    } else {
        stop(app);
        *app.state::<PhoneLink>().error.lock().unwrap_or_else(|e| e.into_inner()) = None;
        let _ = app.emit("phone-status", status_of(app));
    }
}

/// (Re)starts the server, with `identity` or the stored one.
async fn start(app: &AppHandle, identity: Option<Identity>) -> Result<(), String> {
    let link = app.state::<PhoneLink>();
    if identity.is_none() && link.running.lock().unwrap_or_else(|e| e.into_inner()).is_some() {
        return Ok(()); // already on
    }
    let identity = match identity {
        Some(i) => i,
        None => tauri::async_runtime::spawn_blocking(Identity::load_or_create).await.map_err(|e| e.to_string())??,
    };
    stop(app);
    let acceptor = server::tls(&identity)?;
    let port = proto::DEFAULT_PORT;
    // After Pair again the old listener may take a moment to close.
    let mut tries = 0;
    let listener = loop {
        match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
            Ok(l) => break l,
            Err(_) if tries < 20 => {
                tries += 1;
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            Err(e) => return Err(format!("Couldn't listen on port {port} ({e}). Is another copy of the app running?")),
        }
    };
    let token = Arc::new(identity.token.clone());
    let name = Arc::new(pc_name());
    let host: Arc<dyn Host> = Arc::new(AppHost(app.clone()));
    let task = tauri::async_runtime::spawn(server::serve(listener, acceptor, token, name, link.shared.clone(), host));
    *link.running.lock().unwrap_or_else(|e| e.into_inner()) = Some(Running { task, identity, port });
    start_relay(app);
    Ok(())
}

fn stop(app: &AppHandle) {
    let link = app.state::<PhoneLink>();
    stop_relay(&link);
    if let Some(r) = link.running.lock().unwrap_or_else(|e| e.into_inner()).take() {
        r.task.abort();
    }
    link.shared.kick_all();
}

/// The relay built into this copy at build time (`DESK_COMPANION_RELAY`, see
/// build.rs), made plain; None when it was built without one.
pub fn built_in_relay() -> Option<String> {
    let given = env!("DESK_COMPANION_RELAY_BUILT_IN");
    (!given.is_empty()).then(|| proto::relay_address(given).ok()).flatten()
}

/// The relay's address while it should be used: switched on, with the address
/// from Settings, or else the built-in one.
fn relay_url(app: &AppHandle) -> Option<String> {
    let p = crate::system::current(app);
    if !(p.phone_link && p.phone_relay) {
        return None;
    }
    if p.relay_url.is_empty() { built_in_relay() } else { Some(p.relay_url) }
}

/// Connects to the relay if it's on (and the link is running), with the current pairing's keys.
fn start_relay(app: &AppHandle) {
    let link = app.state::<PhoneLink>();
    stop_relay(&link);
    let token = {
        let running = link.running.lock().unwrap_or_else(|e| e.into_inner());
        match running.as_ref() {
            Some(r) => r.identity.token.clone(),
            None => return,
        }
    };
    let Some(url) = relay_url(app) else { return };
    let keys = match relay::Keys::derive(&token) {
        Ok(k) => Arc::new(k),
        Err(e) => {
            *link.relay_status.lock().unwrap_or_else(|e| e.into_inner()) = RelayStatus { state: "retrying", error: Some(e) };
            return;
        }
    };
    let cx = relay::Context {
        keys,
        token: Arc::new(token),
        name: Arc::new(pc_name()),
        shared: link.shared.clone(),
        host: Arc::new(AppHost(app.clone())),
    };
    let (status, handle) = (link.relay_status.clone(), app.clone());
    let report = Arc::new(move |s: RelayStatus| {
        let changed = {
            let mut now = status.lock().unwrap_or_else(|e| e.into_inner());
            let changed = *now != s;
            *now = s;
            changed
        };
        if changed {
            let _ = handle.emit("phone-status", status_of(&handle));
        }
    });
    *link.relay.lock().unwrap_or_else(|e| e.into_inner()) = Some(tauri::async_runtime::spawn(relay::run(url, cx, report)));
}

fn stop_relay(link: &PhoneLink) {
    if let Some(task) = link.relay.lock().unwrap_or_else(|e| e.into_inner()).take() {
        // Dropping the task drops its phones' handling; each one ends and tidies up.
        task.abort();
    }
    *link.relay_status.lock().unwrap_or_else(|e| e.into_inner()) = RelayStatus::off();
}

/// The relay was switched on or off, or its address changed.
pub fn relay_changed(app: &AppHandle) {
    start_relay(app);
    // Phones signed in now get a fresh welcome with the new address (or none).
    app.state::<PhoneLink>().shared.tell_news();
    let _ = app.emit("phone-status", status_of(app));
}

fn pc_name() -> String {
    std::env::var("COMPUTERNAME").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "This PC".into())
}

/// The PC's addresses a phone on the same network could use.
fn hosts() -> Vec<String> {
    let candidates = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.ip() {
            std::net::IpAddr::V4(v4) => Some((i.name, v4)),
            _ => None,
        })
        .collect();
    proto::rank_hosts(candidates)
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneStatus {
    /// The setting.
    on: bool,
    /// Actually listening.
    listening: bool,
    port: u16,
    hosts: Vec<String>,
    phones: Vec<PhoneInfo>,
    error: Option<String>,
    relay: RelayStatus,
}

fn status_of(app: &AppHandle) -> PhoneStatus {
    let link = app.state::<PhoneLink>();
    let running = link.running.lock().unwrap_or_else(|e| e.into_inner());
    let error = link.error.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let status = PhoneStatus {
        on: crate::system::current(app).phone_link,
        listening: running.is_some(),
        port: running.as_ref().map_or(proto::DEFAULT_PORT, |r| r.port),
        hosts: if running.is_some() { hosts() } else { Vec::new() },
        phones: link.shared.phones(),
        error,
        relay: link.relay_status.lock().unwrap_or_else(|e| e.into_inner()).clone(),
    };
    status
}

#[tauri::command]
pub async fn phone_status(app: AppHandle) -> Result<PhoneStatus, String> {
    Ok(status_of(&app))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pairing {
    link: String,
    /// The link as a QR code, an SVG data URL.
    qr: String,
    name: String,
    hosts: Vec<String>,
}

/// The pairing code. Settings asks for it only when the user clicks "Show pairing code".
#[tauri::command]
pub async fn phone_pairing(app: AppHandle) -> Result<Pairing, String> {
    let link = app.state::<PhoneLink>();
    let (fingerprint, token, port) = {
        let running = link.running.lock().unwrap_or_else(|e| e.into_inner());
        let r = running.as_ref().ok_or("Turn the phone link on first.")?;
        (r.identity.fingerprint(), r.identity.token.clone(), r.port)
    };
    let hosts = hosts();
    let relay = relay_url(&app);
    // With the relay on, a phone can pair from anywhere; without it, it must share a network with this PC.
    if hosts.is_empty() && relay.is_none() {
        return Err("This PC isn't on a network a phone can reach. Connect to Wi-Fi (or your phone's hotspot) first, or turn on Reach your phone anywhere.".into());
    }
    let name = pc_name();
    let text = proto::pairing_link(&hosts, port, &fingerprint, &token, &name, relay.as_deref());
    let code = qrcode::QrCode::with_error_correction_level(text.as_bytes(), qrcode::EcLevel::M).map_err(|e| e.to_string())?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(240, 240)
        .dark_color(qrcode::render::svg::Color("#14151a"))
        .light_color(qrcode::render::svg::Color("#ffffff"))
        .build();
    let qr = format!("data:image/svg+xml;base64,{}", base64::engine::general_purpose::STANDARD.encode(svg));
    Ok(Pairing { link: text, qr, name, hosts })
}

/// New token: every paired phone is dropped and must scan the new code.
#[tauri::command]
pub async fn phone_pair_again(app: AppHandle) -> Result<PhoneStatus, String> {
    let current = {
        let link = app.state::<PhoneLink>();
        let running = link.running.lock().unwrap_or_else(|e| e.into_inner());
        running.as_ref().map(|r| r.identity.clone()).ok_or("Turn the phone link on first.")?
    };
    let next = tauri::async_runtime::spawn_blocking(move || current.with_new_token()).await.map_err(|e| e.to_string())??;
    start(&app, Some(next)).await?;
    let status = status_of(&app);
    let _ = app.emit("phone-status", status.clone());
    Ok(status)
}

/// Longest session list accepted from the page.
const MAX_SESSIONS_BYTES: usize = 256 * 1024;

/// The companion page's current session list, in the shape the phone reads.
#[tauri::command]
pub async fn phone_sessions(link: State<'_, PhoneLink>, sessions: Value) -> Result<(), String> {
    if !sessions.is_array() {
        return Err("sessions must be a list".into());
    }
    *link.list.lock().unwrap_or_else(|e| e.into_inner()) = sessions;
    publish(&link)
}
