// The phone link (docs/PHONE_LINK.md): Desk Companion for Android pairs with
// this PC by QR code and connects over the local network with TLS, to see the
// sessions and answer permission requests.
//
// Off by default (Settings → Phone, pref `phoneLink`). Turned on, it listens
// on port 47822 for phones on private addresses only. The companion page sends
// the session list (`phone_sessions`); phones get it on connect and on every
// change. A phone's Allow / Deny goes the same way as a click in the bubble:
// to the relay holding the request open (agents::decide).

mod identity;
mod proto;
mod server;

use std::sync::{Arc, Mutex};

use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use identity::Identity;
use server::{Host, PhoneInfo, Shared};

/// The link's state: the shared part outlives restarts; `running` is the server task.
pub struct PhoneLink {
    shared: Arc<Shared>,
    running: Mutex<Option<Running>>,
    /// Why the link couldn't start (port in use, keys not saved), for Settings.
    error: Mutex<Option<String>>,
}

struct Running {
    task: tauri::async_runtime::JoinHandle<()>,
    identity: Identity,
    port: u16,
}

impl Default for PhoneLink {
    fn default() -> Self {
        PhoneLink { shared: Shared::new(), running: Mutex::new(None), error: Mutex::new(None) }
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
    fn phones_changed(&self) {
        let _ = self.0.emit("phone-status", status_of(&self.0));
    }
}

/// Starts or stops the link to match the setting. Called at start-up and when it changes.
pub fn apply(app: &AppHandle) {
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
    Ok(())
}

fn stop(app: &AppHandle) {
    let link = app.state::<PhoneLink>();
    if let Some(r) = link.running.lock().unwrap_or_else(|e| e.into_inner()).take() {
        r.task.abort();
    }
    link.shared.kick_all();
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
    if hosts.is_empty() {
        return Err("This PC isn't on a network a phone can reach. Connect to Wi-Fi (or your phone's hotspot) first.".into());
    }
    let name = pc_name();
    let text = proto::pairing_link(&hosts, port, &fingerprint, &token, &name);
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
    let line = proto::sessions(&sessions);
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
