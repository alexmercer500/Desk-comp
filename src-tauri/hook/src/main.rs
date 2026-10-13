//! companion-hook — the relay a coding agent runs on each hook event.
//!
//! Reads the hook JSON on stdin, keeps only the fields the companion shows
//! (event, project folder, tool and what it touches, the prompt, messages),
//! and writes them as one line to the named pipe `\\.\pipe\desk-companion-<user's SID>` (pipe_name.rs).
//! Never file contents or tool output. Everything stays on this machine.
//!
//! Agents speak slightly different dialects (event names, field names, tool
//! names); this translates them all to Claude Code's, so the app sees one shape.
//!
//! Hard rules:
//!   * **Never block the agent.** If the companion isn't running the pipe
//!     doesn't exist: exit at once. Every step runs on a worker thread under a
//!     deadline; if the app stops answering, we abandon it and exit 0.
//!   * **Never allow anything nobody clicked.** Only a permission request (or
//!     a question) from an agent that supports answers waits, up to 110 s, for
//!     the user in the companion. Without an answer we print nothing, and the
//!     agent asks in its terminal exactly as if the companion weren't
//!     installed. Every other event prints nothing at all.
//!
//! Usage: `companion-hook [--agent <name>] [--event <name>] [--wait]` (default
//! agent: claude-code). `--event` names the event for agents that don't put it
//! in the payload (Copilot CLI) or name it their own way (Gemini CLI); it wins
//! over the payload's. `--wait` marks the hook entry that answers questions
//! (Claude Code's AskUserQuestion, and Command Code's through our mod).
//!
//! IDEs too: Cursor (`--agent cursor`, its own hooks.json), Antigravity
//! (`--agent antigravity`) and VS Code's agent (`--agent vscode`, sharing
//! Copilot CLI's hook file). They're status only: nothing here ever answers
//! for them.

use std::io::Read;
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Map, Value};

mod pipe_name;
/// Whole budget for delivering one event.
const DEADLINE: Duration = Duration::from_millis(400);
/// How long a permission or question may wait for the user before the
/// terminal takes over. Keep under the hook's own timeout (120 s).
const DECISION_BUDGET: Duration = Duration::from_secs(110);
/// Hook payloads can carry whole files; we never need more than this.
const MAX_INPUT: u64 = 1 << 20;
/// Longest text forwarded for a message or error.
const MAX_TEXT: usize = 300;
/// A permission is only meaningful with the whole command, so details get more room.
const MAX_DETAIL: usize = 600;
/// The user's prompt, enough to recognise the task.
const MAX_PROMPT: usize = 300;
/// The agent's own "what I did", when it sends one.
const MAX_SUMMARY: usize = 1200;
/// Edit text forwarded for the live diff: per string, and per event. Anything
/// bigger is left out (the app then shows the file without a diff).
const MAX_EDIT_TEXT: usize = 48 * 1024;
const MAX_EDIT_TOTAL: usize = 160 * 1024;
/// Longest answer line we accept from the app (question answers are JSON).
const MAX_ANSWER: u64 = 16 * 1024;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut agent = arg_value(&args, "--agent").unwrap_or("claude-code").to_string();
    let wait_entry = args.iter().any(|a| a == "--wait");
    let debug = std::env::var_os("COMPANION_HOOK_DEBUG").is_some();

    let mut input = String::new();
    if let Err(e) = std::io::stdin().take(MAX_INPUT).read_to_string(&mut input) {
        if debug {
            eprintln!("companion-hook: cannot read stdin: {e}");
        }
        return;
    }
    let mut hook = match serde_json::from_str::<Value>(input.trim_start_matches('\u{feff}')) {
        Ok(Value::Object(hook)) => hook,
        other => {
            if debug {
                eprintln!("companion-hook: not a JSON object ({other:?}): {input:.200}");
            }
            return;
        }
    };
    if let Some(name) = arg_value(&args, "--event") {
        hook.insert("hook_event_name".into(), Value::String(short(name, 64)));
    }
    // Cursor runs Claude Code's hooks too; say who it really is. Once Cursor's
    // own hooks are connected they report it, so this copy would count twice.
    let native_cursor = agent == "cursor";
    if agent == "claude-code" && is_cursor(&hook, std::env::var_os("CURSOR_VERSION").is_some()) {
        if cursor_hooks_connected() {
            return;
        }
        agent = "cursor".into();
    }
    let event = event_name(&hook, &agent);
    if event.is_none() {
        return;
    }
    let tool = tool_name(&hook);

    // Claude Code's questions are reported by the waiting entry only (--wait),
    // so the step isn't counted twice by the ordinary PreToolUse entry.
    let question = is_question(&agent, event.as_deref(), tool.as_deref());
    if question && !wait_entry {
        return;
    }
    let permission = waits_for_decision(&agent, event.as_deref(), tool.as_deref());
    let waits = permission || question;

    let mut summary = summarize(&hook, &agent, event.as_deref(), tool.as_deref());
    if waits {
        // Lets the app match the user's answer to this exact request.
        summary["rid"] = Value::String(request_id(&hook));
    }
    if permission && has_suggestions(&hook) {
        summary["canAlways"] = Value::Bool(true);
    }
    if question {
        summary["questions"] = questions(&hook);
    }
    if native_cursor {
        // Cursor's own transcript isn't Claude Code's; its reply came with AgentResponse.
        summary["transcript"] = Value::Null;
    }
    summary["procs"] = json!(ancestors());
    let line = format!("{summary}\n");

    let (done, wait) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = done.send(talk(&line, waits));
    });
    let outcome = wait.recv_timeout(if waits { DECISION_BUDGET } else { DEADLINE });

    // The only thing ever printed: an answer a person gave (see reply_*()).
    let answer = match &outcome {
        Ok(Ok(Some(d))) => d.as_str(),
        _ => "",
    };
    let out = if question {
        reply_question(answer, &hook)
    } else if permission {
        reply_permission(answer, &hook)
    } else {
        no_opinion(&agent)
    };
    if let Some(out) = out {
        println!("{out}");
    }
    // Silent by design; set COMPANION_HOOK_DEBUG=1 to see what happened (stderr only).
    if debug {
        match outcome {
            Ok(Ok(Some(d))) => eprintln!("companion-hook: delivered, answer {d:?}"),
            Ok(Ok(None)) => eprintln!("companion-hook: delivered"),
            Ok(Err(e)) => eprintln!("companion-hook: not delivered: {e}"),
            Err(_) => eprintln!("companion-hook: timed out"),
        }
    }
    std::process::exit(0);
}

fn arg_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(String::as_str)
}

// ── Dialects ──────────────────────────────────────────────────────────────────

/// Cursor imports Claude Code's hooks; its payloads carry its own fields.
fn is_cursor(hook: &Map<String, Value>, env: bool) -> bool {
    env || hook.contains_key("cursor_version") || hook.contains_key("conversation_id")
}

/// Cursor's own hooks (not Claude Code's, which Cursor also runs) send us its events.
fn cursor_hooks_connected() -> bool {
    let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) else { return false };
    let path = std::path::Path::new(&home).join(".cursor").join("hooks.json");
    std::fs::read_to_string(path).is_ok_and(|t| t.contains("companion-hook"))
}

/// The event in Claude Code's words. None: an event we don't report.
fn event_name(hook: &Map<String, Value>, agent: &str) -> Option<String> {
    let raw = hook.get("hook_event_name").and_then(Value::as_str)?;
    let has = |k: &str| hook.get(k).and_then(Value::as_str).is_some_and(|s| !s.trim().is_empty());
    let mapped = match (agent, raw) {
        // Cursor's stop says how the turn ended.
        ("cursor", "stop") => match hook.get("status").and_then(Value::as_str) {
            Some("aborted") => "Interrupt",
            Some("error") => "StopFailure",
            _ => "Stop",
        },
        ("cursor", "afterAgentResponse") => "AgentResponse",
        // Antigravity: no prompt text; steps are reported once done (its
        // PreToolUse wants a decision, which we never give).
        ("antigravity", "PreInvocation") => "UserPromptSubmit",
        ("antigravity", "PostToolUse") => "ToolUsed",
        ("antigravity", "Stop") if has("error") => "StopFailure",
        ("antigravity", "PreToolUse" | "PostInvocation") => return None,
        ("gemini", "BeforeAgent") => "UserPromptSubmit",
        ("gemini", "BeforeTool") => "PreToolUse",
        ("gemini", "AfterTool") => "PostToolUse",
        ("gemini", "AfterAgent") => "Stop",
        (_, "beforeSubmitPrompt" | "userPromptSubmitted") => "UserPromptSubmit",
        (_, "stop" | "agentStop") => "Stop",
        (_, "errorOccurred") => "StopFailure",
        (_, "beforeShellExecution" | "beforeMCPExecution" | "beforeReadFile") => "PreToolUse",
        (_, "afterShellExecution" | "afterMCPExecution" | "afterFileEdit") => "PostToolUse",
        (_, other) => {
            // camelCase → PascalCase (preToolUse → PreToolUse), anything else as is.
            let mut c = other.chars();
            return c.next().map(|f| f.to_uppercase().chain(c).collect::<String>()).map(|s| short(&s, 64));
        }
    };
    Some(mapped.into())
}

/// The tool in Claude Code's words, so the app describes every agent's steps alike.
fn tool_name(hook: &Map<String, Value>) -> Option<String> {
    let raw = ["tool_name", "toolName"]
        .iter()
        .find_map(|k| hook.get(*k).and_then(Value::as_str))
        .or_else(|| hook.get("toolCall")?.get("name")?.as_str())?;
    let canonical = match raw {
        "shell" | "Shell" | "bash" | "run_shell_command" | "execute_command" | "local_shell" | "shell_command" | "run_command"
        | "run_in_terminal" => "Bash",
        "write_file" | "write" | "create_file" | "write_to_file" | "Write" => "Write",
        "replace" | "edit" | "edit_file" | "apply_patch" | "str_replace" | "multi_edit" | "replace_string_in_file"
        | "multi_replace_string_in_file" | "insert_edit_into_file" | "replace_file_content" | "multi_replace_file_content"
        | "StrReplace" | "MultiEdit" => "Edit",
        "read_file" | "read" | "view" | "read_many_files" | "read_directory" | "view_file" | "list_dir" | "Read" => "Read",
        "glob" | "file_search" | "find_by_name" | "Glob" => "Glob",
        "grep" | "search_file_content" | "grep_search" | "Grep" => "Grep",
        "web_fetch" | "fetch_webpage" | "read_url_content" => "WebFetch",
        "google_web_search" | "web_search" | "search_web" => "WebSearch",
        other => other,
    };
    Some(short(canonical, 128))
}

/// The tool's input, wherever this agent puts it (Copilot may send it as a JSON string).
fn tool_input(hook: &Map<String, Value>) -> Option<Map<String, Value>> {
    ["tool_input", "toolInput", "toolArgs"]
        .iter()
        .find_map(|k| match hook.get(*k)? {
            Value::Object(o) => Some(o.clone()),
            Value::String(s) => serde_json::from_str::<Value>(s).ok().and_then(|v| v.as_object().cloned()),
            _ => None,
        })
        // Antigravity's toolCall.args.
        .or_else(|| hook.get("toolCall")?.get("args")?.as_object().cloned())
}

/// The reply an agent needs when we have nothing to say. Antigravity reads a
/// JSON object after every hook; everyone else, nothing at all.
fn no_opinion(agent: &str) -> Option<String> {
    (agent == "antigravity").then(|| "{}".to_string())
}

// ── What waits for the user ───────────────────────────────────────────────────

/// Permission requests are answered from the companion for agents whose answer
/// format we know (Claude Code's, which Codex shares). AskUserQuestion also
/// arrives as a permission request, but "allow" without answers would skip the
/// question, so that one is answered through PreToolUse instead (is_question).
fn waits_for_decision(agent: &str, event: Option<&str>, tool: Option<&str>) -> bool {
    matches!(agent, "claude-code" | "codex") && event == Some("PermissionRequest") && tool != Some("AskUserQuestion")
}

/// The agent asking the user a multiple-choice question: Claude Code's
/// AskUserQuestion, or Command Code's ask_user_question as our mod reports it
/// (in Claude Code's shape; the mod reads the same answer back).
fn is_question(agent: &str, event: Option<&str>, tool: Option<&str>) -> bool {
    matches!(agent, "claude-code" | "commandcode") && event == Some("PreToolUse") && tool == Some("AskUserQuestion")
}

fn request_id(hook: &Map<String, Value>) -> String {
    let session = hook.get("session_id").and_then(Value::as_str).unwrap_or("?");
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{session}:{nanos}:{}", std::process::id())
}

/// Claude Code offers the rule its own "don't ask again" would add.
fn has_suggestions(hook: &Map<String, Value>) -> bool {
    hook.get("permission_suggestions").and_then(Value::as_array).is_some_and(|a| !a.is_empty())
}

/// The questions, trimmed to what the companion shows.
fn questions(hook: &Map<String, Value>) -> Value {
    let qs = tool_input(hook).and_then(|t| t.get("questions").and_then(Value::as_array).cloned()).unwrap_or_default();
    Value::Array(
        qs.iter()
            .filter_map(|q| {
                let text = q.get("question")?.as_str()?;
                let options: Vec<Value> = q
                    .get("options")?
                    .as_array()?
                    .iter()
                    .filter_map(|o| {
                        let label = o.get("label")?.as_str()?;
                        Some(json!({ "label": short(label, 120), "description": o.get("description").and_then(Value::as_str).map(|d| short(d, 200)) }))
                    })
                    .collect();
                Some(json!({
                    "question": short(text, MAX_TEXT),
                    "header": q.get("header").and_then(Value::as_str).map(|h| short(h, 40)),
                    "multiSelect": q.get("multiSelect").and_then(Value::as_bool).unwrap_or(false),
                    "options": options,
                }))
            })
            .collect(),
    )
}

/// The documented PermissionRequest output, for a decision the user clicked.
/// "always" also applies the rule Claude Code itself suggested (what "don't
/// ask again" in the terminal would add). Anything else — no answer, a
/// timeout, garbage — prints nothing, and the agent asks in its terminal.
fn reply_permission(decision: &str, hook: &Map<String, Value>) -> Option<String> {
    let decision = match decision.trim() {
        "allow" => json!({ "behavior": "allow" }),
        "always" => match hook.get("permission_suggestions").and_then(Value::as_array) {
            Some(rules) if !rules.is_empty() => json!({ "behavior": "allow", "updatedPermissions": rules }),
            _ => json!({ "behavior": "allow" }),
        },
        "deny" => json!({ "behavior": "deny", "message": "Denied from the desktop companion" }),
        _ => return None,
    };
    Some(json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": decision } }).to_string())
}

/// Longest answer typed by hand ("Other…").
const MAX_OTHER: usize = 500;

/// Answers to Claude Code's question, from the app as `{"answers":{question: answer}}`.
/// Each must be for a question that was asked. An answer is the offered
/// option(s) (several, comma-separated, where more than one may be picked) or,
/// as Claude Code always allows, something the person typed ("Other…"): any
/// text up to MAX_OTHER characters with no control characters. Anything else
/// prints nothing and the question stays in the terminal.
fn reply_question(answer: &str, hook: &Map<String, Value>) -> Option<String> {
    let given = serde_json::from_str::<Value>(answer.trim()).ok()?;
    let given = given.get("answers")?.as_object()?;
    let mut input = tool_input(hook)?;
    let asked = input.get("questions")?.as_array()?.clone();
    if given.is_empty() {
        return None;
    }
    for (question, value) in given {
        asked.iter().find(|q| q.get("question").and_then(Value::as_str) == Some(question.as_str()))?;
        let text = value.as_str()?;
        if text.trim().is_empty() || text.chars().count() > MAX_OTHER || text.chars().any(char::is_control) {
            return None;
        }
    }
    input.insert("answers".into(), Value::Object(given.clone()));
    Some(
        json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "allow", "updatedInput": input } })
            .to_string(),
    )
}

// ── The pipe ──────────────────────────────────────────────────────────────────

/// Sends the event; for a permission or question, then waits for the app's one-line answer.
#[cfg(windows)]
fn talk(line: &str, wait_for_answer: bool) -> std::io::Result<Option<String>> {
    use std::io::{BufRead, BufReader, Write};
    let mut pipe = std::fs::OpenOptions::new().read(true).write(true).open(pipe_name::pipe_name())?;
    // Anything could have opened a pipe with this name first. Only the real
    // companion gets the event, and only its answer is ever used.
    if !genuine(&pipe) {
        return Err(std::io::Error::other("the program on the pipe isn't Desk Companion"));
    }
    pipe.write_all(line.as_bytes())?;
    pipe.flush()?;
    if !wait_for_answer {
        return Ok(None);
    }
    let mut answer = String::new();
    BufReader::new(pipe).take(MAX_ANSWER).read_line(&mut answer)?;
    Ok(Some(answer.trim().to_string()))
}

#[cfg(not(windows))]
fn talk(_line: &str, _wait_for_answer: bool) -> std::io::Result<Option<String>> {
    // Unix socket transport comes with the macOS/Linux port.
    Ok(None)
}

/// Next to the relay, written by the app: its own full path.
const APP_PATH_FILE: &str = "companion.path";

/// True when the process serving the pipe is the app that installed this
/// relay (the path it recorded in `companion.path`).
#[cfg(windows)]
fn genuine(pipe: &std::fs::File) -> bool {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetNamedPipeServerProcessId(pipe: *mut c_void, pid: *mut u32) -> i32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn QueryFullProcessImageNameW(process: *mut c_void, flags: u32, name: *mut u16, size: *mut u32) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    let Some(expected) = std::env::current_exe()
        .ok()
        .and_then(|me| std::fs::read_to_string(me.with_file_name(APP_PATH_FILE)).ok())
    else {
        return false;
    };
    let mut pid = 0u32;
    // SAFETY: a valid pipe handle and a pointer to a u32.
    if unsafe { GetNamedPipeServerProcessId(pipe.as_raw_handle(), &mut pid) } == 0 {
        return false;
    }
    // SAFETY: plain call; a null handle means no access, which we treat as "not genuine".
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return false;
    }
    let mut buf = vec![0u16; 1024];
    let mut len = buf.len() as u32;
    // SAFETY: buf holds `len` u16s; the call writes at most that many and updates len.
    let ok = unsafe { QueryFullProcessImageNameW(process, 0, buf.as_mut_ptr(), &mut len) } != 0;
    // SAFETY: the handle came from OpenProcess above.
    unsafe { CloseHandle(process) };
    ok && same_path(&String::from_utf16_lossy(&buf[..len as usize]), &expected)
}

/// Windows paths compare without regard to case, slash direction or a `\\?\` prefix.
fn same_path(a: &str, b: &str) -> bool {
    let norm = |p: &str| p.trim().trim_start_matches(r"\\?\").replace('/', "\\").to_lowercase();
    !a.trim().is_empty() && norm(a) == norm(b)
}

/// Our parent, its parent and so on (process ids, nearest first): the app
/// finds the agent's terminal or editor window among them, to bring it forward.
#[cfg(windows)]
fn ancestors() -> Vec<u32> {
    use std::collections::HashMap;
    use std::ffi::c_void;

    #[repr(C)]
    struct ProcessEntry {
        size: u32,
        usage: u32,
        pid: u32,
        heap: usize,
        module: u32,
        threads: u32,
        parent: u32,
        priority: i32,
        flags: u32,
        exe: [u16; 260],
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> *mut c_void;
        fn Process32FirstW(snapshot: *mut c_void, entry: *mut ProcessEntry) -> i32;
        fn Process32NextW(snapshot: *mut c_void, entry: *mut ProcessEntry) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    const TH32CS_SNAPPROCESS: u32 = 0x2;

    // SAFETY: plain call; an invalid handle (-1) is checked below.
    let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snap.is_null() || snap as isize == -1 {
        return Vec::new();
    }
    let mut parent_of = HashMap::new();
    // SAFETY: zeroed is a valid bit pattern for this plain-data struct; size is set as the API requires.
    let mut entry: ProcessEntry = unsafe { std::mem::zeroed() };
    entry.size = std::mem::size_of::<ProcessEntry>() as u32;
    // SAFETY: snap is a valid snapshot handle and entry is correctly sized.
    let mut more = unsafe { Process32FirstW(snap, &mut entry) } != 0;
    while more {
        parent_of.insert(entry.pid, entry.parent);
        // SAFETY: as above.
        more = unsafe { Process32NextW(snap, &mut entry) } != 0;
    }
    // SAFETY: the handle came from CreateToolhelp32Snapshot.
    unsafe { CloseHandle(snap) };

    let mut chain = Vec::new();
    let mut pid = std::process::id();
    while let Some(&parent) = parent_of.get(&pid) {
        if parent == 0 || chain.contains(&parent) || chain.len() >= 12 {
            break;
        }
        chain.push(parent);
        pid = parent;
    }
    chain
}

#[cfg(not(windows))]
fn ancestors() -> Vec<u32> {
    Vec::new()
}

// ── Summary ───────────────────────────────────────────────────────────────────

/// The fields the companion uses, nothing else (no file contents, no outputs).
fn summarize(hook: &Map<String, Value>, agent: &str, event: Option<&str>, tool: Option<&str>) -> Value {
    let text = |keys: &[&str], max: usize| keys.iter().find_map(|k| hook.get(*k).and_then(Value::as_str)).map(|s| short(s, max));
    let input = tool_input(hook);
    // What the tool is touching: a file, a command, a pattern, a URL.
    let detail = input.as_ref().and_then(|t| {
        [
            "file_path", "notebook_path", "absolute_path", "filePath", "TargetFile", "AbsolutePath", "path", "DirectoryPath",
            "command", "CommandLine", "pattern", "Pattern", "url", "Url", "urls", "query", "Query", "description", "prompt",
        ]
            .iter()
            .find_map(|k| match t.get(*k)? {
                Value::String(s) => Some(s.trim().to_string()),
                // Some agents send a command as its argument list.
                Value::Array(parts) => Some(parts.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" ")),
                _ => None,
            })
            .map(|s| short(&s, MAX_DETAIL))
    });
    // Cursor's conversation spans its session's events; its sessionStart also has a session_id.
    let session = text(&["conversation_id", "conversationId", "session_id", "sessionId"], 128);
    let roots = ["workspace_roots", "workspacePaths"]
        .iter()
        .find_map(|k| hook.get(*k)?.as_array()?.first()?.as_str())
        .map(|s| short(s, 1024));
    let cwd = text(&["cwd"], 1024)
        .filter(|c| !c.is_empty())
        .or(roots)
        .or_else(|| ["CURSOR_PROJECT_DIR", "COMMANDCODE_CWD"].iter().find_map(|k| std::env::var(k).ok()));
    let stop = event == Some("Stop");
    // The agent's own last reply, when it sends it; Claude Code (and Cursor)
    // keep it in the transcript instead, which the app reads locally.
    let summary = match event {
        Some("Stop") => text(&["last_assistant_message", "prompt_response"], MAX_SUMMARY),
        // Cursor's reply, which comes just before its stop.
        Some("AgentResponse") => text(&["text"], MAX_SUMMARY),
        _ => None,
    };
    let transcript = (stop && summary.is_none() && matches!(agent, "claude-code" | "cursor"))
        .then(|| text(&["transcript_path"], 1024))
        .flatten();
    // Gemini's permission notification, in Claude Code's words.
    let kind = text(&["notification_type", "notificationType"], 64).map(|k| if k == "ToolPermission" { "permission_prompt".into() } else { k });

    // Only once the tool has run, so a refused edit never shows up as a change.
    let edits = (event == Some("PostToolUse") && detail.is_some()).then(|| input.as_ref().and_then(edit_parts)).flatten();

    json!({
        "agent": agent,
        "event": event,
        "session": session,
        "cwd": cwd,
        "tool": tool,
        "detail": detail,
        "prompt": text(&["prompt"], MAX_PROMPT),
        "message": text(&["message"], MAX_TEXT),
        "error": text(&["error", "error_message", "stopReason"], MAX_TEXT),
        "kind": kind,
        "summary": summary,
        "transcript": transcript,
        "edits": edits,
    })
}

/// What an edit tool changed, as `[{old, new}]`: `old` is null for a whole-file write.
/// Covers Claude Code's Edit / MultiEdit / Write and the same shapes other agents use.
fn edit_parts(t: &Map<String, Value>) -> Option<Value> {
    const OLD: &[&str] = &["old_string", "oldString", "old_str", "oldText"];
    const NEW: &[&str] = &["new_string", "newString", "new_str", "newText"];
    const FULL: &[&str] = &["content", "file_text", "contents"];
    fn first<'a>(m: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a str> {
        keys.iter().find_map(|k| m.get(*k).and_then(Value::as_str))
    }
    let mut parts: Vec<(Option<&str>, &str)> = Vec::new();
    if let Some(list) = t.get("edits").and_then(Value::as_array) {
        for e in list {
            let e = e.as_object()?;
            parts.push((first(e, OLD), first(e, NEW)?));
        }
    } else if let Some(new) = first(t, NEW) {
        parts.push((first(t, OLD), new));
    } else if let Some(full) = first(t, FULL) {
        parts.push((None, full));
    }
    if parts.is_empty() {
        return None;
    }
    let size = |(o, n): &(Option<&str>, &str)| o.map_or(0, str::len) + n.len();
    if parts.iter().map(size).sum::<usize>() > MAX_EDIT_TOTAL
        || parts.iter().any(|(o, n)| n.len() > MAX_EDIT_TEXT || o.is_some_and(|o| o.len() > MAX_EDIT_TEXT))
    {
        return None;
    }
    Some(Value::Array(parts.iter().map(|(o, n)| json!({ "old": o, "new": n })).collect()))
}

fn short(s: &str, max: usize) -> String {
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

    fn obj(s: &str) -> Map<String, Value> {
        serde_json::from_str::<Value>(s).unwrap().as_object().unwrap().clone()
    }

    #[test]
    fn edits_are_forwarded_only_after_the_tool_ran() {
        let edit = r#"{"hook_event_name":"X","tool_name":"Edit","tool_input":{"file_path":"C:/p/a.ts","old_string":"a","new_string":"b"}}"#;
        let after = summarize(&obj(edit), "claude-code", Some("PostToolUse"), Some("Edit"));
        assert_eq!(after["edits"], json!([{ "old": "a", "new": "b" }]));
        let before = summarize(&obj(edit), "claude-code", Some("PreToolUse"), Some("Edit"));
        assert!(before["edits"].is_null());
    }

    #[test]
    fn multi_edits_and_writes_are_understood_and_big_ones_dropped() {
        let multi = obj(r#"{"tool_name":"MultiEdit","tool_input":{"file_path":"a","edits":[{"old_string":"x","new_string":"y"},{"old_string":"p","new_string":"q"}]}}"#);
        let e = summarize(&multi, "claude-code", Some("PostToolUse"), Some("MultiEdit"));
        assert_eq!(e["edits"].as_array().unwrap().len(), 2);
        let write = obj(r#"{"tool_name":"Write","tool_input":{"file_path":"a","content":"hello"}}"#);
        let w = summarize(&write, "claude-code", Some("PostToolUse"), Some("Write"));
        assert_eq!(w["edits"], json!([{ "old": null, "new": "hello" }]));
        let big = format!(r#"{{"tool_name":"Write","tool_input":{{"file_path":"a","content":"{}"}}}}"#, "z".repeat(MAX_EDIT_TEXT + 1));
        assert!(summarize(&obj(&big), "claude-code", Some("PostToolUse"), Some("Write"))["edits"].is_null());
        let shell = obj(r#"{"tool_name":"Bash","tool_input":{"command":"ls"}}"#);
        assert!(summarize(&shell, "claude-code", Some("PostToolUse"), Some("Bash"))["edits"].is_null());
    }

    #[test]
    fn nothing_is_allowed_without_a_clicked_decision() {
        let hook = obj(r#"{"tool_name":"Bash"}"#);
        for not_a_decision in ["", "ask", "maybe", "ALLOW", "allow please", "{\"behavior\":\"allow\"}", "never"] {
            assert_eq!(reply_permission(not_a_decision, &hook), None, "{not_a_decision:?}");
        }
    }

    #[test]
    fn allow_and_deny_use_the_documented_shape() {
        let hook = obj(r#"{"tool_name":"Bash"}"#);
        let allow: Value = serde_json::from_str(&reply_permission("allow", &hook).unwrap()).unwrap();
        assert_eq!(allow["hookSpecificOutput"]["hookEventName"], "PermissionRequest");
        assert_eq!(allow["hookSpecificOutput"]["decision"]["behavior"], "allow");
        assert!(allow["hookSpecificOutput"]["decision"].get("updatedPermissions").is_none());
        let deny: Value = serde_json::from_str(&reply_permission(" deny\n", &hook).unwrap()).unwrap();
        assert_eq!(deny["hookSpecificOutput"]["decision"]["behavior"], "deny");
        assert!(deny["hookSpecificOutput"]["decision"]["message"].is_string());
    }

    #[test]
    fn always_applies_claude_codes_own_suggested_rule() {
        let hook = obj(
            r#"{"tool_name":"Bash","permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"npm run lint"}],"behavior":"allow","destination":"localSettings"}]}"#,
        );
        assert!(has_suggestions(&hook));
        let out: Value = serde_json::from_str(&reply_permission("always", &hook).unwrap()).unwrap();
        let d = &out["hookSpecificOutput"]["decision"];
        assert_eq!(d["behavior"], "allow");
        assert_eq!(d["updatedPermissions"][0]["rules"][0]["ruleContent"], "npm run lint");
        // Without a suggestion it is a plain allow, never a made-up rule.
        let plain = obj(r#"{"tool_name":"Bash"}"#);
        let out: Value = serde_json::from_str(&reply_permission("always", &plain).unwrap()).unwrap();
        assert!(out["hookSpecificOutput"]["decision"].get("updatedPermissions").is_none());
    }

    #[test]
    fn question_answers_are_offered_options_or_typed_text() {
        let hook = obj(
            r#"{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","tool_input":{"questions":[
                {"question":"Which framework?","header":"Framework","multiSelect":false,"options":[{"label":"React"},{"label":"Vue"}]},
                {"question":"Extras?","multiSelect":true,"options":[{"label":"Tests"},{"label":"Docs"}]}]}}"#,
        );
        let ok = reply_question(r#"{"answers":{"Which framework?":"Vue","Extras?":"Tests, Docs"}}"#, &hook).unwrap();
        let out: Value = serde_json::from_str(&ok).unwrap();
        assert_eq!(out["hookSpecificOutput"]["hookEventName"], "PreToolUse");
        assert_eq!(out["hookSpecificOutput"]["permissionDecision"], "allow");
        assert_eq!(out["hookSpecificOutput"]["updatedInput"]["answers"]["Which framework?"], "Vue");
        assert_eq!(out["hookSpecificOutput"]["updatedInput"]["questions"][0]["header"], "Framework");
        // Something typed by hand ("Other…") is an answer too.
        let typed = reply_question(r#"{"answers":{"Which framework?":"Svelte, with SSR"}}"#, &hook).unwrap();
        let typed: Value = serde_json::from_str(&typed).unwrap();
        assert_eq!(typed["hookSpecificOutput"]["updatedInput"]["answers"]["Which framework?"], "Svelte, with SSR");
        let long = format!(r#"{{"answers":{{"Which framework?":"{}"}}}}"#, "x".repeat(MAX_OTHER + 1));
        for bad in [
            "",
            "allow",
            r#"{"answers":{}}"#,
            r#"{"answers":{"Something else?":"React"}}"#,
            r#"{"answers":{"Which framework?":""}}"#,
            r#"{"answers":{"Which framework?":"   "}}"#,
            r#"{"answers":{"Which framework?":"ab"}}"#,
            r#"{"answers":{"Which framework?":"line one
line two"}}"#,
            r#"{"answers":{"Which framework?":3}}"#,
            long.as_str(),
        ] {
            assert_eq!(reply_question(bad, &hook), None, "{bad:?}");
        }
        let qs = questions(&hook);
        assert_eq!(qs[0]["options"][1]["label"], "Vue");
        assert_eq!(qs[1]["multiSelect"], true);
    }

    #[test]
    fn the_app_is_recognised_by_its_exact_path() {
        let app = r"C:\Users\Me\AppData\Local\Desk Companion\desk-companion.exe";
        assert!(same_path(app, app));
        assert!(same_path(r"\\?\C:\USERS\me\AppData\Local\Desk Companion\desk-companion.exe", app));
        assert!(same_path("C:/Users/Me/AppData/Local/Desk Companion/desk-companion.exe\n", app));
        assert!(!same_path(r"C:\Users\Me\Downloads\desk-companion.exe", app), "same name elsewhere");
        assert!(!same_path("", ""), "nothing recorded");
    }

    #[test]
    fn what_waits_for_the_user() {
        assert!(waits_for_decision("claude-code", Some("PermissionRequest"), Some("Bash")));
        assert!(waits_for_decision("codex", Some("PermissionRequest"), Some("Bash")));
        assert!(!waits_for_decision("claude-code", Some("PermissionRequest"), Some("AskUserQuestion")));
        assert!(!waits_for_decision("claude-code", Some("PreToolUse"), Some("Bash")));
        for status_only in ["gemini", "copilot", "commandcode", "cursor", "antigravity", "vscode"] {
            assert!(!waits_for_decision(status_only, Some("PermissionRequest"), Some("Bash")), "{status_only}");
        }
        assert!(is_question("claude-code", Some("PreToolUse"), Some("AskUserQuestion")));
        assert!(is_question("commandcode", Some("PreToolUse"), Some("AskUserQuestion")));
        assert!(!is_question("cursor", Some("PreToolUse"), Some("AskUserQuestion")));
        assert!(!is_question("commandcode", Some("PermissionRequest"), Some("AskUserQuestion")));
    }

    #[test]
    fn dialects_become_claude_codes() {
        let gemini = obj(r#"{"hook_event_name":"AfterAgent","session_id":"g1","cwd":"C:/p","prompt_response":"Done: fixed it."}"#);
        assert_eq!(event_name(&gemini, "gemini").as_deref(), Some("Stop"));
        let s = summarize(&gemini, "gemini", Some("Stop"), None);
        assert_eq!(s["summary"], "Done: fixed it.");
        assert!(s["transcript"].is_null());

        let tool = obj(r#"{"hook_event_name":"BeforeTool","tool_name":"run_shell_command","tool_input":{"command":"npm test"}}"#);
        assert_eq!(event_name(&tool, "gemini").as_deref(), Some("PreToolUse"));
        assert_eq!(tool_name(&tool).as_deref(), Some("Bash"));
        assert_eq!(summarize(&tool, "gemini", Some("PreToolUse"), Some("Bash"))["detail"], "npm test");

        let note = obj(r#"{"hook_event_name":"Notification","notification_type":"ToolPermission","message":"Allow shell?"}"#);
        assert_eq!(summarize(&note, "gemini", Some("Notification"), None)["kind"], "permission_prompt");

        let cursor = obj(r#"{"hook_event_name":"beforeSubmitPrompt","conversation_id":"c1","workspace_roots":["C:/proj"],"prompt":"hi"}"#);
        assert!(is_cursor(&cursor, false));
        assert_eq!(event_name(&cursor, "cursor").as_deref(), Some("UserPromptSubmit"));
        let s = summarize(&cursor, "cursor", Some("UserPromptSubmit"), None);
        assert_eq!(s["session"], "c1");
        assert_eq!(s["cwd"], "C:/proj");
        assert!(!is_cursor(&obj(r#"{"session_id":"x"}"#), false));

        let codex = obj(r#"{"hook_event_name":"Stop","session_id":"x","last_assistant_message":"All tests pass.","transcript_path":"t.jsonl"}"#);
        let s = summarize(&codex, "codex", Some("Stop"), None);
        assert_eq!(s["summary"], "All tests pass.");
        assert!(s["transcript"].is_null(), "the agent's own words win over the transcript");

        let copilot = obj(r#"{"hook_event_name":"preToolUse","sessionId":"k","toolName":"bash","toolArgs":"{\"command\":\"ls\"}"}"#);
        assert_eq!(event_name(&copilot, "copilot").as_deref(), Some("PreToolUse"));
        assert_eq!(summarize(&copilot, "copilot", Some("PreToolUse"), Some("Bash"))["detail"], "ls");

        // Command Code's tool names, as our mod reports them.
        let cc = obj(r#"{"hook_event_name":"PreToolUse","tool_name":"shell_command","tool_input":{"command":"git push"}}"#);
        assert_eq!(tool_name(&cc).as_deref(), Some("Bash"));
        assert_eq!(summarize(&cc, "commandcode", Some("PreToolUse"), Some("Bash"))["detail"], "git push");

        // Copilot and Gemini name the event on the command line (--event), which wins.
        let mut named = obj(r#"{"toolName":"bash"}"#);
        named.insert("hook_event_name".into(), Value::String("preToolUse".into()));
        assert_eq!(event_name(&named, "copilot").as_deref(), Some("PreToolUse"));

        let claude = obj(r#"{"hook_event_name":"Stop","session_id":"x","transcript_path":"C:/t.jsonl"}"#);
        assert_eq!(summarize(&claude, "claude-code", Some("Stop"), None)["transcript"], "C:/t.jsonl");
    }

    #[test]
    fn ides_become_claude_code_too() {
        // Cursor's own hooks: how a turn ended, and its reply.
        for (status, said) in [("completed", "Stop"), ("aborted", "Interrupt"), ("error", "StopFailure")] {
            let stop = obj(&format!(r#"{{"hook_event_name":"stop","conversation_id":"c","status":"{status}"}}"#));
            assert_eq!(event_name(&stop, "cursor").as_deref(), Some(said), "{status}");
        }
        let reply = obj(r#"{"hook_event_name":"afterAgentResponse","conversation_id":"c","text":"Renamed it everywhere."}"#);
        assert_eq!(event_name(&reply, "cursor").as_deref(), Some("AgentResponse"));
        assert_eq!(summarize(&reply, "cursor", Some("AgentResponse"), None)["summary"], "Renamed it everywhere.");
        let start = obj(r#"{"hook_event_name":"sessionStart","conversation_id":"c","session_id":"other","workspace_roots":["C:/w"]}"#);
        let s = summarize(&start, "cursor", Some("SessionStart"), None);
        assert_eq!(s["session"], "c", "one session, whichever event");
        assert_eq!(s["cwd"], "C:/w");
        let failed = obj(r#"{"hook_event_name":"postToolUseFailure","tool_name":"Shell","tool_input":{"command":"npm test"},"error_message":"exit 1"}"#);
        assert_eq!(event_name(&failed, "cursor").as_deref(), Some("PostToolUseFailure"));
        assert_eq!(tool_name(&failed).as_deref(), Some("Bash"));
        assert_eq!(summarize(&failed, "cursor", Some("PostToolUseFailure"), Some("Bash"))["error"], "exit 1");

        // Antigravity: camelCase fields, the tool in toolCall, steps once done.
        let used = obj(
            r#"{"hook_event_name":"PostToolUse","conversationId":"a1","workspacePaths":["C:/ag"],"toolCall":{"name":"run_command","args":{"CommandLine":"cargo check"}}}"#,
        );
        assert_eq!(event_name(&used, "antigravity").as_deref(), Some("ToolUsed"));
        assert_eq!(tool_name(&used).as_deref(), Some("Bash"));
        let s = summarize(&used, "antigravity", Some("ToolUsed"), Some("Bash"));
        assert_eq!((s["session"].as_str(), s["cwd"].as_str(), s["detail"].as_str()), (Some("a1"), Some("C:/ag"), Some("cargo check")));
        let write = obj(r#"{"hook_event_name":"PostToolUse","toolCall":{"name":"write_to_file","args":{"TargetFile":"C:/ag/a.rs"}}}"#);
        assert_eq!(tool_name(&write).as_deref(), Some("Write"));
        assert_eq!(summarize(&write, "antigravity", Some("ToolUsed"), Some("Write"))["detail"], "C:/ag/a.rs");
        assert_eq!(event_name(&obj(r#"{"hook_event_name":"PreInvocation"}"#), "antigravity").as_deref(), Some("UserPromptSubmit"));
        assert_eq!(event_name(&obj(r#"{"hook_event_name":"Stop","error":""}"#), "antigravity").as_deref(), Some("Stop"));
        assert_eq!(event_name(&obj(r#"{"hook_event_name":"Stop","error":"quota"}"#), "antigravity").as_deref(), Some("StopFailure"));
        for skipped in ["PreToolUse", "PostInvocation"] {
            assert_eq!(event_name(&obj(&format!(r#"{{"hook_event_name":"{skipped}"}}"#)), "antigravity"), None);
        }

        // VS Code's agent: Claude Code's shape, its own tool names.
        for (tool, said) in [
            ("run_in_terminal", "Bash"), ("replace_string_in_file", "Edit"), ("create_file", "Write"),
            ("read_file", "Read"), ("grep_search", "Grep"), ("file_search", "Glob"), ("fetch_webpage", "WebFetch"),
        ] {
            assert_eq!(tool_name(&obj(&format!(r#"{{"tool_name":"{tool}"}}"#))).as_deref(), Some(said), "{tool}");
        }
        let edit = obj(r#"{"hook_event_name":"PreToolUse","session_id":"v","tool_name":"replace_string_in_file","tool_input":{"filePath":"C:/v/a.ts","oldString":"x"}}"#);
        assert_eq!(summarize(&edit, "vscode", Some("PreToolUse"), Some("Edit"))["detail"], "C:/v/a.ts");
    }

    #[test]
    fn only_antigravity_gets_an_empty_reply() {
        // Never a decision: "{}" is Antigravity's "no opinion" (it's never sent on PreToolUse).
        assert_eq!(no_opinion("antigravity").as_deref(), Some("{}"));
        for quiet in ["claude-code", "codex", "cursor", "vscode", "copilot", "gemini"] {
            assert_eq!(no_opinion(quiet), None, "{quiet}");
        }
    }

    #[test]
    fn ancestors_start_with_our_parent() {
        let chain = ancestors();
        if cfg!(windows) {
            assert!(!chain.is_empty());
            assert!(!chain.contains(&std::process::id()));
        }
    }
}
