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
// The agent only waits for a card someone can see: the page must report the
// card on screen (`permission_shown`) within SHOW_WAIT. If it doesn't —
// notifications paused, a full-screen app, the window busy or gone — the relay
// is let go at once and the agent asks in its terminal, instead of sitting
// there for two minutes waiting on a card nobody saw.
//
// A finished Claude Code turn (`hold`) asks whether to wait for a reply from
// the phone (phone::should_hold). We answer "hold" or not straight away. A
// held turn waits up to HOLD_WAIT for a reply, and is let go at once when
// someone uses this PC or no phone is left to reply from. A reply goes back
// to the relay, and the page sees it as the session's next prompt.
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
/// How long the page has to put the card on screen before the agent is let go.
const SHOW_WAIT: Duration = Duration::from_secs(2);
/// How long a finished turn is held for a reply: a little under the relay's 300 s.
const HOLD_WAIT: Duration = Duration::from_secs(290);
/// How often a held turn checks whether someone is back at the PC.
const HOLD_CHECK: Duration = Duration::from_millis(400);

/// What a waiting request is, so an answer of one kind never reaches another.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Permission,
    Question,
    /// A finished turn held for a reply (only the phone answers these).
    Hold,
}

/// Requests waiting for the user: request id → where to send the answer.
#[derive(Default)]
pub struct Pending(Mutex<HashMap<String, (Answer, Kind)>>);

impl Pending {
    fn insert(&self, rid: String, tx: Answer, kind: Kind) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).insert(rid, (tx, kind));
    }
    /// Removes the request, whatever it is.
    fn remove(&self, rid: &str) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(rid);
    }
    /// Takes the request only if it is one of `kinds`.
    fn take(&self, rid: &str, kinds: &[Kind]) -> Option<Answer> {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if !map.get(rid).is_some_and(|(_, k)| kinds.contains(k)) {
            return None;
        }
        map.remove(rid).map(|(tx, _)| tx)
    }
}

/// Requests whose card hasn't been reported on screen yet: request id → the signal.
#[derive(Default)]
pub struct Shown(Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>);

impl Shown {
    fn insert(&self, rid: String, tx: tokio::sync::oneshot::Sender<()>) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).insert(rid, tx);
    }
    fn take(&self, rid: &str) -> Option<tokio::sync::oneshot::Sender<()>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(rid)
    }
}

/// The page put the card for this request on screen, with its buttons.
#[tauri::command]
pub fn permission_shown(shown: State<'_, Shown>, rid: String) {
    if let Some(tx) = shown.take(&rid) {
        let _ = tx.send(());
    }
}

/// A phone is showing this request: like the card on screen, the agent keeps waiting for it.
pub fn mark_shown(app: &AppHandle, rid: &str) {
    if let Some(tx) = app.state::<Shown>().take(rid) {
        let _ = tx.send(());
    }
}

/// Allow or Deny from the phone (phone/). Goes the same way as a click: to the
/// relay holding the request. The page is told first, so its card closes as
/// answered rather than as "answer in the terminal". False when the request
/// is already gone (answered elsewhere, timed out).
pub fn decide_from_phone(app: &AppHandle, rid: &str, word: &str) -> bool {
    debug_assert!(word == "allow" || word == "deny");
    let Some(tx) = app.state::<Pending>().take(rid, &[Kind::Permission]) else { return false };
    let _ = app.emit_to(desktop::LABEL, "phone:decided", serde_json::json!({ "rid": rid, "decision": word }));
    tx.try_send(Some(word.to_string())).is_ok()
}

/// Answers to Claude's question card from the phone (already checked for
/// shape in phone/proto.rs; the relay checks them against what was asked).
pub fn answer_from_phone(app: &AppHandle, rid: &str, answers: &[(String, String)]) -> bool {
    let map: serde_json::Map<String, Value> = answers.iter().map(|(q, a)| (q.clone(), Value::String(a.clone()))).collect();
    let line = serde_json::json!({ "answers": map }).to_string();
    if line.len() > 15 * 1024 {
        return false;
    }
    let Some(tx) = app.state::<Pending>().take(rid, &[Kind::Question]) else { return false };
    let _ = app.emit_to(desktop::LABEL, "phone:answered", rid);
    tx.try_send(Some(line)).is_ok()
}

/// A reply from the phone to a held turn (checked in phone/proto.rs and again by the relay).
pub fn reply_from_phone(app: &AppHandle, rid: &str, text: &str) -> bool {
    let line = serde_json::json!({ "reply": text }).to_string();
    let Some(tx) = app.state::<Pending>().take(rid, &[Kind::Hold]) else { return false };
    tx.try_send(Some(line)).is_ok()
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
    Ok(pending.take(&rid, &[Kind::Permission, Kind::Question]).is_some_and(|tx| tx.try_send(Some(word)).is_ok()))
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
    Ok(pending.take(&rid, &[Kind::Question]).is_some_and(|tx| tx.try_send(Some(line)).is_ok()))
}

#[path = "../hook/src/pipe_name.rs"]
mod pipe_name;
/// Longest line we accept; the relay sends at most a few kilobytes.
const MAX_LINE: usize = 256 * 1024;
/// How much of the transcript's end we read to find the last reply.
const TRANSCRIPT_TAIL: u64 = 512 * 1024;
/// Longest summary passed on.
const MAX_SUMMARY: usize = 1200;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
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
    /// What an edit tool changed, `[{old, new}]`, sent after the tool ran (for the live diff).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    edits: Option<serde_json::Value>,
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
    /// Input only: a finished turn the relay can hold for a reply (with `rid`).
    #[serde(default, skip_serializing)]
    hold: bool,
    /// Input only: "hooks" for Command Code's plain hooks, which run next to our mod.
    #[serde(default, skip_serializing)]
    via: Option<String>,
}

#[cfg(windows)]
pub fn spawn(app: AppHandle) {
    use tokio::net::windows::named_pipe::ServerOptions;

    let pipe = pipe_name::pipe_name();
    tauri::async_runtime::spawn(async move {
        let mut first = true;
        loop {
            // Only one app may own the pipe (first_pipe_instance refuses a name that's taken).
            // Taken at start-up usually means the copy this one replaces (an install or an
            // update) hasn't quite let go yet, so keep trying: giving up here left the app
            // running but deaf to every agent until it was restarted.
            let server = match ServerOptions::new().first_pipe_instance(first).create(&pipe) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[agents] cannot open {pipe}: {e}");
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
        // The relay test (connections.rs): it got here, that's all it needed.
        if ev.agent == crate::connections::PING_AGENT {
            crate::connections::pinged(&app);
            continue;
        }
        crate::connections::heard(&app, &ev.agent);
        if crate::connections::duplicate(&app, &ev.agent, ev.session.as_deref(), ev.via.as_deref() == Some("hooks")) {
            continue;
        }
        // A finished turn: say at once whether it's held, before anything slow.
        let mut held = None;
        if ev.hold {
            let rid = ev.rid.take();
            let session = ev.session.clone().filter(|s| !s.is_empty());
            let hold = rid.is_some() && session.is_some() && crate::phone::should_hold(&app);
            let _ = write.write_all(if hold { b"hold\n" as &[u8] } else { b"\n" }).await;
            let _ = write.flush().await;
            if hold {
                held = rid.zip(session);
            }
        }
        if let Some(path) = ev.transcript.take() {
            let (summary, prompt) = summary_from(&path).await;
            ev.summary = summary;
            // Command Code's chat panel has no prompt hook: its Stop is all we hear of the turn.
            ev.prompt = ev.prompt.take().or(prompt);
        }
        if let Some((rid, session)) = held {
            let next = AgentEvent { agent: ev.agent.clone(), session: ev.session.clone(), cwd: ev.cwd.clone(), procs: ev.procs.clone(), ..Default::default() };
            let _ = app.emit_to(desktop::LABEL, "agent", ev);
            hold_for_reply(&app, &mut write, lines, rid, session, next).await;
            return;
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
        let (shown_tx, shown_rx) = tokio::sync::oneshot::channel::<()>();
        if let Some(rid) = &rid {
            let kind = if ev.questions.is_some() { Kind::Question } else { Kind::Permission };
            app.state::<Pending>().insert(rid.clone(), tx.clone(), kind);
            app.state::<Shown>().insert(rid.clone(), shown_tx);
        }
        let _ = app.emit_to(desktop::LABEL, "agent", ev);

        let Some(rid) = rid else { continue };
        // Wait for the click, the relay hanging up (answered in the terminal,
        // timed out), or our own deadline — whichever comes first.
        let hangup = tauri::async_runtime::spawn(async move {
            let _ = lines.next_line().await;
            let _ = tx.send(None).await;
        });
        let seen = tokio::time::timeout(SHOW_WAIT, shown_rx).await.is_ok_and(|r| r.is_ok());
        app.state::<Shown>().take(&rid);
        let answer = if seen {
            tokio::time::timeout(DECISION_WAIT, rx.recv()).await.ok().flatten().flatten()
        } else {
            // Nobody saw a card. A click that somehow got in (the panel) still counts.
            rx.try_recv().ok().flatten()
        };
        hangup.abort();
        app.state::<Pending>().remove(&rid);
        if let Some(word) = answer {
            let _ = write.write_all(format!("{word}\n").as_bytes()).await;
            let _ = write.flush().await;
        }
        let _ = app.emit_to(desktop::LABEL, "permission-closed", rid);
        return; // one request per connection
    }
}

/// Holds a finished turn until a reply comes from the phone, someone uses the
/// PC, the phones go, the relay hangs up, or HOLD_WAIT runs out. A reply goes
/// to the relay (Claude carries on with it) and to the page as the session's
/// next prompt (`next`, filled in here).
#[cfg(windows)]
async fn hold_for_reply<W, R>(app: &AppHandle, write: &mut W, mut lines: tokio::io::Lines<R>, rid: String, session: String, mut next: AgentEvent)
where
    W: tokio::io::AsyncWrite + Unpin,
    R: tokio::io::AsyncBufRead + Unpin + Send + 'static,
{
    use tokio::io::AsyncWriteExt;

    let (tx, mut rx) = mpsc::channel::<Option<String>>(2);
    app.state::<Pending>().insert(rid.clone(), tx.clone(), Kind::Hold);
    let until = std::time::SystemTime::now()
        .checked_add(HOLD_WAIT)
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64);
    crate::phone::hold_started(app, &session, &rid, until);
    let hangup = tauri::async_runtime::spawn(async move {
        let _ = lines.next_line().await;
        let _ = tx.send(None).await;
    });
    let deadline = tokio::time::Instant::now() + HOLD_WAIT;
    let reply = loop {
        tokio::select! {
            r = rx.recv() => break r.flatten(),
            _ = tokio::time::sleep_until(deadline) => break None,
            _ = tokio::time::sleep(HOLD_CHECK) => {
                if !crate::phone::keep_holding(app) {
                    break None;
                }
            }
        }
    };
    hangup.abort();
    app.state::<Pending>().remove(&rid);
    crate::phone::hold_ended(app, &session, &rid);
    let Some(line) = reply else { return };
    if write.write_all(format!("{line}\n").as_bytes()).await.is_err() || write.flush().await.is_err() {
        return;
    }
    let text = serde_json::from_str::<Value>(&line).ok().and_then(|v| v.get("reply")?.as_str().map(str::to_string));
    next.event = Some("UserPromptSubmit".into());
    next.prompt = text.map(|t| clip(&t, 300));
    let _ = app.emit_to(desktop::LABEL, "agent", next);
}

/// The last reply in a transcript, and (Command Code's only) the prompt it
/// answered. The file may still be flushing when Stop fires, so look twice
/// before giving up.
async fn summary_from(path: &str) -> (Option<String>, Option<String>) {
    let mut found = (None, None);
    for attempt in 0..2 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
        let p = path.to_string();
        found = tauri::async_runtime::spawn_blocking(move || last_reply(Path::new(&p))).await.unwrap_or_default();
        if found.0.is_some() {
            break;
        }
    }
    found
}

/// Reads the end of a JSONL transcript: the text of the last assistant message
/// that has any, and for Command Code's transcripts the prompt before it.
///
/// Claude Code writes `{"type":"assistant","message":{...}}`; Command Code
/// writes `{"type":"message","message":{"role":"assistant"|"user",...}}`, with
/// what you typed marked `"meta":{"source":"user"}`.
fn last_reply(path: &Path) -> (Option<String>, Option<String>) {
    if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return (None, None);
    }
    let Some(text) = transcript_tail(path) else { return (None, None) };
    let mut reply = None;
    for line in text.lines().rev() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue }; // first line may be cut
        let kind = v.get("type").and_then(Value::as_str);
        let role = v.pointer("/message/role").and_then(Value::as_str);
        let said = || {
            let content = v.pointer("/message/content").and_then(Value::as_array)?;
            let parts: Vec<&str> = content
                .iter()
                .filter(|c| c.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|c| c.get("text").and_then(Value::as_str))
                .collect();
            Some(parts.join("\n").trim().to_string()).filter(|s| !s.is_empty())
        };
        let assistant = kind == Some("assistant") || (kind == Some("message") && role == Some("assistant"));
        if assistant && reply.is_none() {
            reply = said().map(|r| clip(&r, MAX_SUMMARY));
            if reply.is_some() && kind == Some("assistant") {
                return (reply, None); // Claude Code: its prompt came with UserPromptSubmit
            }
        } else if kind == Some("message") && role == Some("user") && v.pointer("/message/meta/source").and_then(Value::as_str) == Some("user") {
            return (reply, said().map(|p| clip(&p, 300)));
        }
    }
    (reply, None)
}

fn transcript_tail(path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(TRANSCRIPT_TAIL);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(TRANSCRIPT_TAIL).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max - 1).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transcript(name: &str, lines: &[&str]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("desk-companion-{name}-{}.jsonl", std::process::id()));
        std::fs::write(&path, lines.join("\n")).unwrap();
        path
    }

    #[test]
    fn command_codes_transcript_gives_the_reply_and_the_prompt() {
        let path = transcript("cc", &[
            r#"{"type":"session","version":3,"id":"s"}"#,
            r#"{"type":"message","message":{"role":"user","content":[{"type":"text","text":"old prompt"}],"meta":{"source":"user"}}}"#,
            r#"{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"old reply"}]}}"#,
            r#"{"type":"message","message":{"role":"user","content":[{"type":"text","text":"give me a story"}],"meta":{"source":"user"}}}"#,
            r#"{"type":"message","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hm"},{"type":"text","text":"The lighthouse keeper…"}]}}"#,
            r#"{"type":"effort_change","effort":"off"}"#,
        ]);
        assert_eq!(last_reply(&path), (Some("The lighthouse keeper…".into()), Some("give me a story".into())));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn claude_codes_transcript_gives_the_reply_only() {
        let path = transcript("claude", &[
            r#"{"type":"user","message":{"role":"user","content":"fix it"}}"#,
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Fixed."}]}}"#,
        ]);
        assert_eq!(last_reply(&path), (Some("Fixed.".into()), None));
        let _ = std::fs::remove_file(path);
    }
}
