// Coding-agent events: the named pipe the `companion-hook` relay writes to.
//
// Each connection carries JSON lines (one per hook event). We check the shape
// and forward each event to the companion window as "agent"; the page keeps
// track of sessions and decides how the character reacts.
//
// When a turn ends (Stop) the relay passes the transcript's path; we read the
// agent's last reply from the end of that local file, so the panel can say
// what was done. The path itself never reaches the page.
//
// A permission request (it carries a request id, `rid`) keeps its connection
// open: the relay is waiting for the user's Allow or Deny. The page answers
// through `answer_permission`; we write the one word back and close. If the
// relay goes away first (answered in the terminal, timed out) we tell the page
// with "permission-closed" so the buttons disappear.
//
// The pipe's default security only lets the current user (and admins) write
// to it, and tokio rejects remote clients by default.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;

/// Ends one waiting permission: Some(word) from a click, None when it's over without one.
type Answer = mpsc::Sender<Option<String>>;

use crate::desktop;

/// A little longer than the relay's own 110 s budget, so the relay always gives up first.
const DECISION_WAIT: Duration = Duration::from_secs(115);

/// Permission requests waiting for a click: request id → where to send the answer.
#[derive(Default)]
pub struct Pending(Mutex<HashMap<String, Answer>>);

impl Pending {
    fn insert(&self, rid: String, tx: Answer) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).insert(rid, tx);
    }
    fn take(&self, rid: &str) -> Option<Answer> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(rid)
    }
}

/// The user's answer to a permission request: "allow", "always" (allow, and
/// the rule the agent suggested so it won't ask again) or "deny";
/// "terminal" lets the agent ask in its terminal instead.
/// Returns false when the request is already gone.
#[tauri::command]
pub async fn answer_permission(pending: State<'_, Pending>, rid: String, decision: String) -> Result<bool, String> {
    let word = match decision.as_str() {
        "allow" | "always" | "deny" => decision,
        "terminal" => String::new(),
        other => return Err(format!("unknown decision {other:?}")),
    };
    Ok(pending.take(&rid).is_some_and(|tx| tx.try_send(Some(word)).is_ok()))
}

/// The user's answers to Claude Code's question: question → chosen option(s).
/// The relay checks them against what was asked before passing them on.
#[tauri::command]
pub async fn answer_question(
    pending: State<'_, Pending>,
    rid: String,
    answers: serde_json::Map<String, Value>,
) -> Result<bool, String> {
    if answers.is_empty() || !answers.values().all(Value::is_string) {
        return Err("each question needs an answer".into());
    }
    let line = serde_json::json!({ "answers": answers }).to_string();
    if line.len() > 15 * 1024 {
        return Err("answers too long".into());
    }
    Ok(pending.take(&rid).is_some_and(|tx| tx.try_send(Some(line)).is_ok()))
}

pub const PIPE: &str = r"\\.\pipe\desk-companion";
/// Longest line we accept; the relay sends at most a few kilobytes.
const MAX_LINE: usize = 64 * 1024;
/// How much of the transcript's end we read to find the last reply.
const TRANSCRIPT_TAIL: u64 = 512 * 1024;
/// Longest summary passed on.
const MAX_SUMMARY: usize = 1200;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AgentEvent {
    agent: String,
    event: Option<String>,
    session: Option<String>,
    cwd: Option<String>,
    tool: Option<String>,
    detail: Option<String>,
    prompt: Option<String>,
    message: Option<String>,
    error: Option<String>,
    kind: Option<String>,
    /// Input only: read here, never forwarded.
    #[serde(default, skip_serializing)]
    transcript: Option<String>,
    /// The agent's last reply, filled in for Stop.
    #[serde(default)]
    summary: Option<String>,
    /// Set when the relay is waiting for the user's Allow or Deny (or answers).
    #[serde(default)]
    rid: Option<String>,
    /// The agent suggested a rule for "always allow this".
    #[serde(default, rename = "canAlways")]
    can_always: bool,
    /// Claude Code's multiple-choice questions, to answer from the companion.
    #[serde(default)]
    questions: Option<Value>,
    /// The relay's parent processes, nearest first: the agent's terminal or
    /// editor is among them (focus.rs brings it forward).
    #[serde(default)]
    procs: Option<Vec<u32>>,
}

#[cfg(windows)]
pub fn spawn(app: AppHandle) {
    use tokio::net::windows::named_pipe::ServerOptions;

    tauri::async_runtime::spawn(async move {
        let mut first = true;
        loop {
            // Only one app may own the pipe; a second instance fails here and stays quiet.
            let server = match ServerOptions::new().first_pipe_instance(first).create(PIPE) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[agents] cannot open {PIPE}: {e}");
                    if first {
                        return;
                    }
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }
            };
            first = false;
            if server.connect().await.is_err() {
                continue;
            }
            let app = app.clone();
            tauri::async_runtime::spawn(async move { read_events(server, app).await });
        }
    });
}

#[cfg(not(windows))]
pub fn spawn(_app: AppHandle) {}

#[cfg(windows)]
async fn read_events(pipe: tokio::net::windows::named_pipe::NamedPipeServer, app: AppHandle) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let (read, mut write) = tokio::io::split(pipe);
    let mut lines = BufReader::new(read).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.len() > MAX_LINE {
            continue;
        }
        let mut ev = match serde_json::from_str::<AgentEvent>(&line) {
            Ok(ev) => ev,
            Err(e) => {
                eprintln!("[agents] bad event: {e}");
                continue;
            }
        };
        if let Some(path) = ev.transcript.take() {
            ev.summary = summary_from(&path).await;
        }
        if ev.rid.is_some() {
            let prefs = crate::system::current(&app);
            if !(prefs.answer_permissions && prefs.notify_permission) {
                // Not answered from here (Settings): let the relay go at once
                // with no decision, so the agent asks in its terminal as usual.
                ev.rid = None;
                let _ = write.write_all(b"\n").await;
                let _ = write.flush().await;
            }
        }
        let rid = ev.rid.clone();
        let (tx, mut rx) = mpsc::channel::<Option<String>>(2);
        if let Some(rid) = &rid {
            app.state::<Pending>().insert(rid.clone(), tx.clone());
        }
        let _ = app.emit_to(desktop::LABEL, "agent", ev);

        let Some(rid) = rid else { continue };
        // Wait for the click, the relay hanging up (answered in the terminal,
        // timed out), or our own deadline — whichever comes first.
        let hangup = tauri::async_runtime::spawn(async move {
            let _ = lines.next_line().await;
            let _ = tx.send(None).await;
        });
        let answer = tokio::time::timeout(DECISION_WAIT, rx.recv()).await.ok().flatten().flatten();
        hangup.abort();
        app.state::<Pending>().take(&rid);
        if let Some(word) = answer {
            let _ = write.write_all(format!("{word}\n").as_bytes()).await;
            let _ = write.flush().await;
        }
        let _ = app.emit_to(desktop::LABEL, "permission-closed", rid);
        return; // one request per connection
    }
}

/// The last reply in a transcript. The file may still be flushing when Stop
/// fires, so look twice before giving up.
async fn summary_from(path: &str) -> Option<String> {
    for attempt in 0..2 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
        let p = path.to_string();
        let found = tauri::async_runtime::spawn_blocking(move || last_reply(Path::new(&p))).await.ok().flatten();
        if found.is_some() {
            return found;
        }
    }
    None
}

/// Reads the end of a JSONL transcript and returns the text of the last
/// assistant message that has any.
fn last_reply(path: &Path) -> Option<String> {
    if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return None;
    }
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(TRANSCRIPT_TAIL);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(TRANSCRIPT_TAIL).read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes);

    for line in text.lines().rev() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue }; // first line may be cut
        if v.get("type").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let Some(content) = v.pointer("/message/content").and_then(Value::as_array) else { continue };
        let reply: Vec<&str> = content
            .iter()
            .filter(|c| c.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|c| c.get("text").and_then(Value::as_str))
            .collect();
        let reply = reply.join("\n").trim().to_string();
        if !reply.is_empty() {
            return Some(clip(&reply, MAX_SUMMARY));
        }
    }
    None
}

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max - 1).collect();
    out.push('…');
    out
}
