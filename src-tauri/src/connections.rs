// Whether each coding agent can really reach the app.
//
// Writing an agent's hooks says nothing about whether they run: the agent may
// not load them, or an antivirus may hold or block the relay (it's unsigned).
// Both used to look like silence. So the app keeps two things:
//
//   * when it last heard from each agent (heard.json in its data folder), and
//   * a relay test: it runs companion-hook.exe the way an agent does, with a
//     "Ping" event, and waits for it on the pipe. The answer says what went
//     wrong in words: missing, blocked, held up for a scan, or not reaching us.
//
// The test runs once at start-up (when an agent is connected), after
// connecting one, and from Settings.

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::{desktop, setup};

/// The agent name the relay test sends; never shown as a session.
pub const PING_AGENT: &str = "ping";
/// Longer than this and something (an antivirus scan, usually) held the relay up.
const RELAY_RUN_LIMIT: Duration = Duration::from_secs(15);
/// After the relay exits, how long its ping may take to arrive.
const PING_WAIT: Duration = Duration::from_secs(3);
/// heard.json is written at most this often (a busy agent sends many events).
const SAVE_EVERY: Duration = Duration::from_secs(30);
/// The start-up test waits for the app to settle (and an update's relay copy to land).
const FIRST_TEST: Duration = Duration::from_secs(20);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayTest {
    pub ok: bool,
    /// What went wrong, in words, when not ok.
    pub problem: Option<String>,
    /// When the test ran (ms since 1970).
    pub at: u64,
    /// How long the relay took, start to arrival.
    pub ms: u64,
}

pub struct Connections {
    heard: Mutex<HashMap<String, u64>>,
    saved: Mutex<Option<Instant>>,
    pings: tokio::sync::watch::Sender<u64>,
    test: Mutex<Option<RelayTest>>,
    /// One test at a time.
    testing: tokio::sync::Mutex<()>,
    /// Command Code sessions our mod reports: their plain-hook copies are dropped (see `duplicate`).
    commandcode_mod_sessions: Mutex<Vec<String>>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn heard_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("heard.json"))
}

impl Connections {
    pub fn load(app: &AppHandle) -> Self {
        let heard = heard_file(app)
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|t| serde_json::from_str(t.trim_start_matches('\u{feff}')).ok())
            .unwrap_or_default();
        Connections {
            heard: Mutex::new(heard),
            saved: Mutex::new(None),
            pings: tokio::sync::watch::channel(0).0,
            test: Mutex::new(None),
            testing: tokio::sync::Mutex::new(()),
            commandcode_mod_sessions: Mutex::new(Vec::new()),
        }
    }

    /// When the app last heard from the agent the relay calls `agent` (ms since 1970).
    pub fn last_heard(&self, agent: &str) -> Option<u64> {
        self.heard.lock().unwrap_or_else(|e| e.into_inner()).get(agent).copied()
    }

    pub fn last_test(&self) -> Option<RelayTest> {
        self.test.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

/// An event arrived from `agent`: remember when (saved now and then).
pub fn heard(app: &AppHandle, agent: &str) {
    let c = app.state::<Connections>();
    let mut heard = c.heard.lock().unwrap_or_else(|e| e.into_inner());
    let first = heard.insert(agent.to_string(), now_ms()).is_none();
    let mut saved = c.saved.lock().unwrap_or_else(|e| e.into_inner());
    if first || saved.is_none_or(|t| t.elapsed() >= SAVE_EVERY) {
        *saved = Some(Instant::now());
        if let (Some(path), Ok(text)) = (heard_file(app), serde_json::to_string(&*heard)) {
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(path, text);
        }
    }
}

/// The relay test's ping arrived.
pub fn pinged(app: &AppHandle) {
    app.state::<Connections>().pings.send_modify(|n| *n += 1);
}

/// Command Code reports through our mod (CLI, desktop app) and through plain
/// hooks (the only thing its VS Code chat panel runs). Where the mod runs, both
/// arrive for the same session: the mod's are richer, so the hooks' copies go.
/// `via_hooks` marks an event from the plain hooks.
pub fn duplicate(app: &AppHandle, agent: &str, session: Option<&str>, via_hooks: bool) -> bool {
    let Some(session) = session.filter(|s| !s.is_empty() && agent == "commandcode") else { return false };
    let c = app.state::<Connections>();
    let mut seen = c.commandcode_mod_sessions.lock().unwrap_or_else(|e| e.into_inner());
    seen_from_mod(&mut seen, session, via_hooks)
}

/// The mod's sessions so far (the latest 200): a hooks event for one of them is a copy.
fn seen_from_mod(seen: &mut Vec<String>, session: &str, via_hooks: bool) -> bool {
    if via_hooks {
        return seen.iter().any(|s| s == session);
    }
    if !seen.iter().any(|s| s == session) {
        if seen.len() >= 200 {
            seen.remove(0);
        }
        seen.push(session.to_string());
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hooks_copies_go_only_where_the_mod_reported_the_session() {
        let mut seen = Vec::new();
        // The VS Code chat panel: hooks only, all kept.
        assert!(!seen_from_mod(&mut seen, "panel", true));
        assert!(!seen_from_mod(&mut seen, "panel", true));
        // The CLI: the mod reports first, then the hooks' copy is dropped.
        assert!(!seen_from_mod(&mut seen, "cli", false));
        assert!(seen_from_mod(&mut seen, "cli", true));
        assert!(!seen_from_mod(&mut seen, "cli", false), "the mod's own events always pass");
        // Only the latest 200 sessions are remembered.
        for i in 0..200 {
            seen_from_mod(&mut seen, &format!("s{i}"), false);
        }
        assert!(!seen_from_mod(&mut seen, "cli", true));
        assert_eq!(seen.len(), 200);
    }
}

/// Runs the relay as an agent would and waits for its ping. Saves and returns the result.
pub async fn test_relay(app: &AppHandle) -> RelayTest {
    let c = app.state::<Connections>();
    let _one = c.testing.lock().await;
    let mut pings = c.pings.subscribe();
    pings.mark_unchanged();
    let started = Instant::now();
    let ran = tauri::async_runtime::spawn_blocking(run_relay).await.unwrap_or_else(|e| Err(e.to_string()));
    let problem = match ran {
        Err(problem) => Some(problem),
        Ok(()) => {
            let left = PING_WAIT.max(Duration::from_millis(500));
            match tokio::time::timeout(left, pings.changed()).await {
                Ok(Ok(())) => None,
                _ => Some(
                    "The relay ran but didn't reach me. Another copy of Desk Companion may be running, or this one was moved: restart it."
                        .into(),
                ),
            }
        }
    };
    let result = RelayTest { ok: problem.is_none(), problem, at: now_ms(), ms: started.elapsed().as_millis() as u64 };
    *c.test.lock().unwrap_or_else(|e| e.into_inner()) = Some(result.clone());
    let _ = app.emit("connections", ());
    result
}

/// Starts the relay with a ping on stdin, no window, and waits for it to finish.
fn run_relay() -> Result<(), String> {
    let relay = setup::relay_path().filter(|p| p.is_file()).ok_or_else(|| {
        "The relay (companion-hook.exe) is missing. If your antivirus removed it, restore it or allow it, then restart Desk Companion.".to_string()
    })?;
    let mut cmd = std::process::Command::new(&relay);
    cmd.args(["--agent", PING_AGENT])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| {
        format!("Windows wouldn't start the relay ({e}). Your antivirus may be blocking companion-hook.exe: allow it, or add {} to its exceptions.", folder(&relay))
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(br#"{"hook_event_name":"Ping","session_id":"desk-companion-test"}"#);
    }
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) if started.elapsed() < RELAY_RUN_LIMIT => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                return Err(format!(
                    "The relay was held up for over {} s, so agents wait on every step. An antivirus is probably scanning it (Avast's CyberCapture does this to new programs): allow companion-hook.exe, or add {} to its exceptions.",
                    RELAY_RUN_LIMIT.as_secs(),
                    folder(&relay)
                ));
            }
            Err(e) => return Err(format!("Couldn't tell whether the relay ran: {e}")),
        }
    }
}

fn folder(relay: &std::path::Path) -> String {
    relay.parent().map(|p| p.display().to_string()).unwrap_or_default()
}

/// The start-up test: only when an agent is connected, and a notice if it fails.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_TEST).await;
        if !setup::AGENTS.iter().any(|(id, _)| setup::agent_connected(id)) {
            return;
        }
        let result = test_relay(&app).await;
        if let Some(problem) = result.problem {
            eprintln!("[connections] relay test failed: {problem}");
            let _ = app.emit_to(
                desktop::LABEL,
                "notice",
                serde_json::json!({ "title": "Your agents can't reach me", "text": problem, "kind": "error", "action": "settings" }),
            );
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionsView {
    agents: Vec<setup::AgentStatus>,
    relay: Option<RelayTest>,
    /// Nothing connected yet, something to connect, and the setup card not put away.
    offer_setup: bool,
}

pub fn view(app: &AppHandle) -> ConnectionsView {
    let agents = setup::agents_status(app);
    let offer_setup = !crate::system::current(app).agent_setup_dismissed
        && !agents.iter().any(|a| a.connected)
        && agents.iter().any(|a| a.installed);
    ConnectionsView { agents, relay: app.state::<Connections>().last_test(), offer_setup }
}

/// The agents' connection status, for the Activity tab's badges and setup card.
#[tauri::command]
pub async fn agent_connections(app: AppHandle) -> ConnectionsView {
    view(&app)
}

/// Settings → Coding agents → Test.
#[tauri::command]
pub async fn test_connection(app: AppHandle) -> RelayTest {
    test_relay(&app).await
}

/// The setup card's "Connect": every agent found on this PC, then a relay test.
/// Returns what happened, in words.
#[tauri::command]
pub async fn connect_found_agents(app: AppHandle) -> Result<String, String> {
    let found: Vec<(&str, &str)> = setup::AGENTS.iter().copied().filter(|(id, _)| setup::is_installed(id)).collect();
    let mut done = Vec::new();
    let mut failed = Vec::new();
    for (id, name) in &found {
        match setup::set_agent(&app, id, true) {
            Ok(_) => done.push(*name),
            Err(e) => failed.push(format!("{name}: {e}")),
        }
    }
    crate::system::broadcast(&app);
    let test = test_relay(&app).await;
    let mut words = if done.is_empty() { "Nothing was connected.".to_string() } else { format!("Connected {}.", done.join(", ")) };
    if !failed.is_empty() {
        words.push_str(&format!(" Couldn't connect {}.", failed.join("; ")));
    }
    match test.problem {
        None => words.push_str(" Test passed: they can reach me. Open sessions need a restart to load the hooks."),
        Some(p) => words.push_str(&format!(" But: {p}")),
    }
    Ok(words)
}
