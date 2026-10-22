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
//! Usage: `companion-hook [--agent <name>] [--event <name>] [--wait] [--via hooks]` (default
//! agent: claude-code). `--event` names the event for agents that don't put it
//! in the payload (Copilot CLI) or name it their own way (Gemini CLI); it wins
//! over the payload's. `--wait` marks the hook entry that answers questions
//! (Claude Code's AskUserQuestion, and Command Code's through our mod).
//! `--via hooks` marks Command Code's plain hooks, which run next to our mod
//! and are all its VS Code chat panel runs.
//! The app also runs this relay itself (`--agent ping`) to test that agents
//! can reach it (connections.rs).
//!
//! **Replies from the phone.** When Claude Code finishes a turn while the user
//! is away (a phone with away mode is linked and the PC has been idle), the
//! app may ask us to hold the Stop for a few minutes. A reply typed on the
//! phone then comes back as Claude Code's documented Stop output (`decision:
//! block` with the reply as the reason), and Claude carries on with it. The app
//! says within HOLD_ACK whether to hold at all; anything else, or no reply in
//! time, prints nothing and the turn simply ends. Command Code's Stop hook
//! (`--via hooks`) is held the same way; its reply goes back as the text on
//! stderr with exit code 2, which Command Code passes on as the next message.
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
/// What a step touches (a file, a command), as the panel's timeline shows it.
const MAX_DETAIL: usize = 600;
/// Everything a permission request will run, shown in full before Allow.
/// Longer than this and it's cut, and the app offers no Allow for it: the
/// terminal shows the whole thing.
const MAX_INPUT_SHOWN: usize = 16 * 1024;
/// The rule "Always" adds, in words.
const MAX_RULE: usize = 300;
/// The user's prompt, enough to recognise the task.
const MAX_PROMPT: usize = 300;
/// The agent's own "what I did", when it sends one.
const MAX_SUMMARY: usize = 1200;
/// Edit text forwarded for the live diff: per string, and per event. Anything
/// bigger is left out (the app then shows the file without a diff).
const MAX_EDIT_TEXT: usize = 48 * 1024;
const MAX_EDIT_TOTAL: usize = 160 * 1024;
/// Longest answer line we accept from the app (question answers and replies are JSON).
const MAX_ANSWER: u64 = 16 * 1024;
/// How long the app has to say whether to hold a finished turn for a reply.
const HOLD_ACK: Duration = Duration::from_millis(1500);
/// How long a held turn waits for a reply. Keep under the Stop hook's timeout (setup.rs).
const HOLD_BUDGET: Duration = Duration::from_secs(300);
/// Longest reply passed on to the agent.
const MAX_REPLY: usize = 4000;
/// Claude Code's "plan ready" tool: its card approves the plan and picks how
/// the work after it goes (see plan_mode).
const PLAN_TOOL: &str = "ExitPlanMode";
/// What Claude reads when the plan is turned down from the card: as the
/// terminal's "No, keep planning", it stays in plan mode and asks.
const KEEP_PLANNING: &str =
    "Not yet: keep planning. The user wants changes to this plan before you start; ask them what to change.";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut agent = arg_value(&args, "--agent").unwrap_or("claude-code").to_string();
    let wait_entry = args.iter().any(|a| a == "--wait");
    let via_hooks = arg_value(&args, "--via") == Some("hooks");
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
    let holdable = can_hold(&agent, event.as_deref(), via_hooks);
    let waits = permission || question;

    let mut summary = summarize(&hook, &agent, event.as_deref(), tool.as_deref());
    if waits || holdable {
        // Lets the app match the user's answer to this exact request.
        summary["rid"] = Value::String(request_id(&hook));
    }
    if holdable {
        summary["hold"] = Value::Bool(true);
    }
    if permission {
        // All of it, so what's allowed is what was seen (the detail above is a summary).
        let (input, cut) = if is_plan(&hook) { plan_text(&hook) } else { full_input(&hook) };
        summary["input"] = Value::String(input);
        if cut {
            summary["cut"] = Value::Bool(true);
        }
        let rules = if is_plan(&hook) { vec![plan_mode("acceptEdits")] } else { always_rules(&hook) };
        if !rules.is_empty() {
            summary["canAlways"] = Value::Bool(true);
            summary["alwaysRule"] = Value::String(describe_rules(&rules));
        }
    }
    if question {
        summary["questions"] = questions(&hook);
    }
    if native_cursor {
        // Cursor's own transcript isn't Claude Code's; its reply came with AgentResponse.
        summary["transcript"] = Value::Null;
    }
    if via_hooks {
        // Command Code's plain hooks, next to our mod: the app keeps these only
        // where the mod doesn't run (its VS Code chat panel).
        summary["via"] = Value::String("hooks".into());
    }
    summary["procs"] = json!(ancestors());
    let line = format!("{summary}\n");

    let mode = if waits { Talk::Answer } else if holdable { Talk::Hold } else { Talk::Tell };
    let (done, wait) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = done.send(talk(&line, mode, &done));
    });
    let outcome = match mode {
        Talk::Tell => wait.recv_timeout(DEADLINE),
        Talk::Answer => wait.recv_timeout(DECISION_BUDGET),
        // First the app's "hold" (or not), then, only if it holds, the reply.
        Talk::Hold => match wait.recv_timeout(HOLD_ACK) {
            Ok(Ok(Some(ack))) if ack == "hold" => wait.recv_timeout(HOLD_BUDGET),
            other => other,
        },
    };

    // The only thing ever printed: an answer a person gave (see reply_*()).
    let answer = match &outcome {
        Ok(Ok(Some(d))) => d.as_str(),
        _ => "",
    };
    // Command Code's plain hooks can't hand over answers the way Claude Code's
    // can: a question is answered by declining it with the answers as the
    // reason, and a reply is a Stop hook's exit code 2 with the reply on stderr.
    let command_code = agent == "commandcode" && via_hooks;
    let out = if question {
        if command_code { reply_question_as_reason(answer, &hook) } else { reply_question(answer, &hook) }.map(Out::Print)
    } else if holdable {
        if command_code { reply_text(answer).map(Out::Continue) } else { reply_stop(answer).map(Out::Print) }
    } else if permission {
        reply_permission(answer, &hook).map(Out::Print)
    } else {
        no_opinion(&agent).map(Out::Print)
    };
    match out {
        Some(Out::Print(out)) => println!("{out}"),
        // Nothing else may go to stderr: the agent reads all of it as the reply.
        Some(Out::Continue(reply)) => {
            eprint!("{reply}");
            std::process::exit(2);
        }
        None => {}
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
        // Command Code's questions (its VS Code chat panel reports them through plain hooks).
        "ask_user_question" => "AskUserQuestion",
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
/// AskUserQuestion, or Command Code's ask_user_question, from our mod (in
/// Claude Code's shape; the mod reads the same answer back) or from its plain
/// hooks (`--via hooks`, answered with reply_question_as_reason).
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

/// The rules Claude Code suggests for its own "don't ask again" that "Always"
/// may add: allow rules, folders, and accepting edits. Anything else it might
/// suggest (another mode, removing or replacing rules, ask or deny rules) is
/// left out: "Always" never does more than the card says.
fn always_rules(hook: &Map<String, Value>) -> Vec<Value> {
    let nonempty = |s: &Value, k: &str| s.get(k).and_then(Value::as_array).is_some_and(|a| !a.is_empty());
    hook.get("permission_suggestions")
        .and_then(Value::as_array)
        .map(|all| {
            all.iter()
                .filter(|s| match s.get("type").and_then(Value::as_str) {
                    Some("addRules") => s.get("behavior").and_then(Value::as_str) == Some("allow") && nonempty(s, "rules"),
                    Some("addDirectories") => nonempty(s, "directories"),
                    Some("setMode") => s.get("mode").and_then(Value::as_str) == Some("acceptEdits"),
                    _ => false,
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

/// What "Always" will add, in words: "allow Bash(npm run lint) in this project".
fn describe_rules(rules: &[Value]) -> String {
    let parts: Vec<String> = rules
        .iter()
        .filter_map(|s| {
            let place = match s.get("destination").and_then(Value::as_str) {
                Some("session" | "cliArg") => "for this session",
                Some("localSettings" | "projectSettings") => "in this project",
                Some("userSettings") => "in every project",
                _ => "from now on",
            };
            let what = match s.get("type")?.as_str()? {
                "addRules" => {
                    let rules: Vec<String> = s
                        .get("rules")?
                        .as_array()?
                        .iter()
                        .filter_map(|r| {
                            let tool = r.get("toolName")?.as_str()?;
                            Some(match r.get("ruleContent").and_then(Value::as_str).filter(|c| !c.is_empty()) {
                                Some(content) => format!("{tool}({content})"),
                                None => tool.to_string(),
                            })
                        })
                        .collect();
                    format!("allow {}", rules.join(", "))
                }
                "addDirectories" => {
                    let dirs: Vec<&str> = s.get("directories")?.as_array()?.iter().filter_map(Value::as_str).collect();
                    format!("allow access to {}", dirs.join(", "))
                }
                "setMode" => "accept every edit".to_string(),
                _ => return None,
            };
            Some(format!("{what} {place}"))
        })
        .collect();
    short(&reveal(&parts.join("; ")), MAX_RULE)
}

/// Everything the tool is about to be given, as the user should read it before
/// allowing it: the command as it will run, then every other field (`key:
/// value`), with nothing invisible left in (see reveal). True when it was too
/// long to show and had to be cut.
fn full_input(hook: &Map<String, Value>) -> (String, bool) {
    /// The command, in each agent's words.
    const COMMAND: &[&str] = &["command", "CommandLine", "cmd"];
    /// Shown first, in this order, when present: what the tool works on.
    const FIRST: &[&str] = &[
        "file_path", "notebook_path", "absolute_path", "filePath", "TargetFile", "AbsolutePath", "path", "DirectoryPath", "url", "Url",
    ];
    /// Bookkeeping that doesn't change what a command does.
    const NOISE: &[&str] = &["description", "timeout", "run_in_background"];
    let Some(input) = tool_input(hook) else { return (String::new(), false) };
    let as_text = |v: &Value| match v {
        Value::String(s) => s.clone(),
        // A command as its argument list.
        Value::Array(parts) if parts.iter().all(Value::is_string) => parts.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "),
        other => other.to_string(),
    };
    let command = COMMAND.iter().find_map(|k| input.get(*k).map(|v| (*k, v)));
    let mut keys: Vec<&str> = FIRST.iter().copied().filter(|k| input.contains_key(*k)).collect();
    // The rest alphabetically, whatever order the map keeps (serde_json's depends on its features).
    let mut others: Vec<&str> = input.keys().map(String::as_str).filter(|k| !FIRST.contains(k)).collect();
    others.sort_unstable();
    keys.extend(others);
    let rest: Vec<&str> = keys
        .into_iter()
        .filter(|k| Some(*k) != command.map(|(c, _)| c) && !(command.is_some() && NOISE.contains(k)))
        .collect();

    let mut parts: Vec<String> = Vec::new();
    if let Some((_, v)) = command {
        parts.push(as_text(v).trim().to_string());
    }
    if command.is_none() && rest.len() == 1 {
        // One field (a path, a URL): just its value.
        parts.push(as_text(&input[rest[0]]));
    } else {
        for k in rest {
            let v = as_text(&input[k]);
            parts.push(if v.contains('\n') { format!("{k}:\n{v}") } else { format!("{k}: {v}") });
        }
    }
    let all = reveal(&parts.join("\n"));
    if all.chars().count() <= MAX_INPUT_SHOWN {
        return (all, false);
    }
    (short(&all, MAX_INPUT_SHOWN), true)
}

/// Text with every character that could hide or disguise part of it (bidi
/// overrides, zero-width spaces, control characters other than line breaks and
/// tabs) written out as `⟨U+202E⟩`, so what's on the card is what will run.
fn reveal(s: &str) -> String {
    let s = s.replace("\r\n", "\n");
    if !s.chars().any(hidden) {
        return s;
    }
    let mut out = String::with_capacity(s.len() + 16);
    for c in s.chars() {
        if hidden(c) {
            out.push_str(&format!("⟨U+{:04X}⟩", c as u32));
        } else {
            out.push(c);
        }
    }
    out
}

/// Invisible, or able to make the text around it read differently than it is.
/// Joiners (U+200C, U+200D) and variation selectors stay: emoji need them.
fn hidden(c: char) -> bool {
    (c.is_control() && c != '\n' && c != '\t')
        || matches!(
            c as u32,
            0x00AD | 0x034F | 0x061C | 0x115F | 0x1160 | 0x17B4 | 0x17B5 | 0x180B..=0x180E | 0x200B | 0x200E | 0x200F
                | 0x2028..=0x202E | 0x2060..=0x206F | 0x3164 | 0xFEFF | 0xFFA0 | 0xFFF9..=0xFFFB | 0xE0000..=0xE0FFF
        )
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
/// "always" also applies the rules Claude Code itself suggested (what "don't
/// ask again" in the terminal would add), only those always_rules() keeps:
/// the ones the card spelled out. Anything else — no answer, a timeout,
/// garbage — prints nothing, and the agent asks in its terminal.
fn reply_permission(decision: &str, hook: &Map<String, Value>) -> Option<String> {
    if is_plan(hook) {
        return reply_plan(decision, hook);
    }
    let decision = match decision.trim() {
        "allow" => json!({ "behavior": "allow" }),
        "always" => match always_rules(hook) {
            rules if !rules.is_empty() => json!({ "behavior": "allow", "updatedPermissions": rules }),
            _ => json!({ "behavior": "allow" }),
        },
        "deny" => json!({ "behavior": "deny", "message": "Denied from the desktop companion" }),
        _ => return None,
    };
    Some(json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": decision } }).to_string())
}

fn is_plan(hook: &Map<String, Value>) -> bool {
    tool_name(hook).as_deref() == Some(PLAN_TOOL)
}

/// The mode the work after a plan runs in, as Claude Code's own "setMode" update (this session only).
fn plan_mode(mode: &str) -> Value {
    json!({ "type": "setMode", "mode": mode, "destination": "session" })
}

/// A plan card's answer, as the terminal's plan dialog would give it: Allow is
/// "Yes, manually approve edits", Always "Yes, auto-accept edits", Deny "No,
/// keep planning". Claude Code only takes an allow for this tool with the
/// tool's input handed back (updatedInput, unchanged); a bare allow leaves its
/// dialog waiting.
fn reply_plan(decision: &str, hook: &Map<String, Value>) -> Option<String> {
    let input = Value::Object(tool_input(hook).unwrap_or_default());
    let decision = match decision.trim() {
        "allow" => json!({ "behavior": "allow", "updatedInput": input, "updatedPermissions": [plan_mode("default")] }),
        "always" => json!({ "behavior": "allow", "updatedInput": input, "updatedPermissions": [plan_mode("acceptEdits")] }),
        "deny" => json!({ "behavior": "deny", "message": KEEP_PLANNING }),
        _ => return None,
    };
    Some(json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": decision } }).to_string())
}

/// The plan itself (Markdown), as the card shows it: the plan file's path and
/// other bookkeeping don't change what's approved. Cut like full_input.
fn plan_text(hook: &Map<String, Value>) -> (String, bool) {
    let Some(plan) = tool_input(hook).and_then(|t| t.get("plan").and_then(Value::as_str).map(str::to_string)) else {
        return full_input(hook);
    };
    let all = reveal(plan.trim());
    if all.chars().count() <= MAX_INPUT_SHOWN {
        return (all, false);
    }
    (short(&all, MAX_INPUT_SHOWN), true)
}

/// What the relay hands back to the agent.
enum Out {
    /// A line on stdout (the agent's JSON hook output).
    Print(String),
    /// Command Code's "carry on with this": the text on stderr and exit code 2.
    Continue(String),
}

/// A turn ending, held for a reply from the phone when the app says so:
/// Claude Code's (not Cursor running Claude Code's hooks: the agent is renamed
/// by then), and Command Code's from its plain hooks (where its Stop hook
/// waits for us; our mod's Stop is only a report).
fn can_hold(agent: &str, event: Option<&str>, via_hooks: bool) -> bool {
    event == Some("Stop") && (agent == "claude-code" || (agent == "commandcode" && via_hooks))
}

/// A reply from the phone, from the app as `{"reply": text}`, as the agent
/// should read it. Text only: not empty, at most MAX_REPLY characters, no
/// control characters but line breaks and tabs. Anything else is None and the
/// turn ends as usual.
fn reply_text(answer: &str) -> Option<String> {
    let given = serde_json::from_str::<Value>(answer.trim()).ok()?;
    let text = given.get("reply")?.as_str()?.trim();
    if text.is_empty() || text.chars().count() > MAX_REPLY || text.chars().any(|c| c.is_control() && c != '\n' && c != '\t') {
        return None;
    }
    Some(format!("The user replied from their phone:\n\n{text}"))
}

/// Claude Code's documented Stop output that makes it carry on, with the reply as the reason.
fn reply_stop(answer: &str) -> Option<String> {
    Some(json!({ "decision": "block", "reason": reply_text(answer)? }).to_string())
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
    let (mut input, given) = checked_answers(answer, hook)?;
    input.insert("answers".into(), Value::Object(given));
    Some(
        json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "allow", "updatedInput": input } })
            .to_string(),
    )
}

/// The same answers for Command Code's plain hooks, which can't change a
/// tool's input: its question is declined (so its own card never shows) with
/// the answers as the reason, which is what the model reads instead.
fn reply_question_as_reason(answer: &str, hook: &Map<String, Value>) -> Option<String> {
    let (input, given) = checked_answers(answer, hook)?;
    // In the order they were asked, as Command Code's own answer lists them.
    let lines: Vec<String> = input
        .get("questions")?
        .as_array()?
        .iter()
        .filter_map(|q| {
            let question = q.get("question")?.as_str()?;
            Some(format!("{question} → {}", given.get(question)?.as_str()?))
        })
        .collect();
    let reason = format!(
        "The user already answered these questions in the Desk Companion app, so Command Code's own question card wasn't shown:\n\n{}\n\nThat is their answer: continue with it in mind and don't ask these questions again.",
        lines.join("\n")
    );
    Some(
        json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason } })
            .to_string(),
    )
}

/// The question's input and the app's answers to it, if every answer is for a
/// question that was asked and is an acceptable answer (see reply_question).
fn checked_answers(answer: &str, hook: &Map<String, Value>) -> Option<(Map<String, Value>, Map<String, Value>)> {
    let given = serde_json::from_str::<Value>(answer.trim()).ok()?;
    let given = given.get("answers")?.as_object()?.clone();
    let input = tool_input(hook)?;
    let asked = input.get("questions")?.as_array()?;
    if given.is_empty() {
        return None;
    }
    for (question, value) in &given {
        asked.iter().find(|q| q.get("question").and_then(Value::as_str) == Some(question.as_str()))?;
        let text = value.as_str()?;
        if text.trim().is_empty() || text.chars().count() > MAX_OTHER || text.chars().any(char::is_control) {
            return None;
        }
    }
    Some((input, given))
}

// ── The pipe ──────────────────────────────────────────────────────────────────

/// What we wait for after sending the event.
#[derive(Clone, Copy, PartialEq)]
enum Talk {
    /// Nothing: report and go.
    Tell,
    /// The user's answer (a permission or a question): one line.
    Answer,
    /// A turn's end: the app's "hold" or not (a line), then, if held, the reply.
    Hold,
}

type Heard = std::io::Result<Option<String>>;

/// Sends the event, then reads what `mode` waits for. For Hold the first line
/// goes out through `early` (the caller times it separately) and the second
/// is returned.
#[cfg(windows)]
fn talk(line: &str, mode: Talk, early: &mpsc::Sender<Heard>) -> Heard {
    use std::io::{BufRead, BufReader, Write};
    let mut pipe = open_pipe()?;
    // Anything could have opened a pipe with this name first. Only the real
    // companion gets the event, and only its answer is ever used.
    if !genuine(&pipe) {
        return Err(std::io::Error::other("the program on the pipe isn't Desk Companion"));
    }
    pipe.write_all(line.as_bytes())?;
    pipe.flush()?;
    if mode == Talk::Tell {
        return Ok(None);
    }
    let mut reader = BufReader::new(pipe);
    let mut answer = String::new();
    (&mut reader).take(MAX_ANSWER).read_line(&mut answer)?;
    if mode == Talk::Hold {
        let ack = answer.trim().to_string();
        let held = ack == "hold";
        let _ = early.send(Ok(Some(ack)));
        if !held {
            return Ok(None);
        }
        answer.clear();
        (&mut reader).take(MAX_ANSWER).read_line(&mut answer)?;
    }
    Ok(Some(answer.trim().to_string()))
}

/// How long to keep trying a pipe that's busy (another relay connecting at the
/// same moment: parallel tool calls, hooks that start together).
#[cfg(windows)]
const BUSY_RETRY: Duration = Duration::from_secs(2);

/// Opens the app's pipe. Busy means the app is between two connections (it
/// readies the next one at once): wait for it rather than drop the event. The
/// caller's own deadline still applies on top of this.
#[cfg(windows)]
fn open_pipe() -> std::io::Result<std::fs::File> {
    #[link(name = "kernel32")]
    extern "system" {
        fn WaitNamedPipeW(name: *const u16, timeout_ms: u32) -> i32;
    }
    const ERROR_PIPE_BUSY: i32 = 231;
    let name = pipe_name::pipe_name();
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let started = std::time::Instant::now();
    loop {
        match std::fs::OpenOptions::new().read(true).write(true).open(&name) {
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && started.elapsed() < BUSY_RETRY => {
                // SAFETY: `wide` is a NUL-terminated UTF-16 string that outlives the call.
                // Returns when an instance is free or after 100 ms; either way we try again.
                unsafe { WaitNamedPipeW(wide.as_ptr(), 100) };
            }
            other => return other,
        }
    }
}

#[cfg(not(windows))]
fn talk(_line: &str, _mode: Talk, _early: &mpsc::Sender<Heard>) -> Heard {
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
            .map(|s| short(&reveal(&s), MAX_DETAIL))
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
    // Command Code's plain hooks (its VS Code chat panel) send a transcript too; its mod sends the reply.
    let transcript = (stop && summary.is_none() && matches!(agent, "claude-code" | "cursor" | "commandcode"))
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
        // The agent's permission mode ("default", "plan", "auto-accept" …), where it says.
        "mode": text(&["permission_mode"], 32).filter(|m| !m.is_empty()),
        // The session's own name (Claude Code's /rename or --name), on its start and its prompts.
        "title": text(&["session_title"], 80).map(|t| reveal(t.trim())).filter(|t| !t.is_empty()),
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
    fn only_held_turn_ends_wait_and_only_a_real_reply_continues_them() {
        assert!(can_hold("claude-code", Some("Stop"), false));
        assert!(can_hold("commandcode", Some("Stop"), true), "Command Code's plain Stop hook");
        assert!(!can_hold("commandcode", Some("Stop"), false), "our mod's Stop is only a report");
        assert!(!can_hold("cursor", Some("Stop"), false));
        assert!(!can_hold("codex", Some("Stop"), false));
        assert!(!can_hold("claude-code", Some("StopFailure"), false));
        let out: Value = serde_json::from_str(&reply_stop(r#"{"reply":"  Now add a test\nfor it  "}"#).unwrap()).unwrap();
        assert_eq!(out["decision"], "block");
        assert!(out["reason"].as_str().unwrap().ends_with("Now add a test\nfor it"));
        assert_eq!(reply_text(r#"{"reply":"Ship it"}"#).as_deref(), Some("The user replied from their phone:\n\nShip it"));
        let long = format!(r#"{{"reply":"{}"}}"#, "a".repeat(MAX_REPLY + 1));
        for no in ["", "hold", "allow", r#"{"reply":""}"#, r#"{"reply":"   "}"#, r#"{"reply":"a\u0007b"}"#, r#"{"reply":3}"#, r#"{"answers":{}}"#, long.as_str()] {
            assert_eq!(reply_stop(no), None, "{no:?}");
            assert_eq!(reply_text(no), None, "{no:?}");
        }
    }

    #[test]
    fn command_codes_questions_are_answered_by_declining_them_with_the_answers() {
        // As Command Code's VS Code chat panel sends it.
        let hook = obj(
            r#"{"hook_event_name":"PreToolUse","session_id":"s","permission_mode":"default","tool_name":"ask_user_question","tool_display_name":"QUESTION","tool_input":{"questions":[
                {"question":"Which part?","header":"Part","options":[{"label":"Hooks","description":"the relay"},{"label":"UI"}]},
                {"question":"Extras?","multiSelect":true,"options":[{"label":"Tests"},{"label":"Docs"}]}]}}"#,
        );
        assert_eq!(tool_name(&hook).as_deref(), Some("AskUserQuestion"));
        assert!(is_question("commandcode", Some("PreToolUse"), Some("AskUserQuestion")));
        assert_eq!(questions(&hook)[0]["options"][0]["description"], "the relay");
        assert_eq!(summarize(&hook, "commandcode", Some("PreToolUse"), Some("AskUserQuestion"))["mode"], "default");
        let out: Value =
            serde_json::from_str(&reply_question_as_reason(r#"{"answers":{"Extras?":"Tests, Docs","Which part?":"UI"}}"#, &hook).unwrap()).unwrap();
        let hso = &out["hookSpecificOutput"];
        assert_eq!(hso["hookEventName"], "PreToolUse");
        assert_eq!(hso["permissionDecision"], "deny", "the only decision Command Code's hooks honour");
        let reason = hso["permissionDecisionReason"].as_str().unwrap();
        assert!(reason.contains("Which part? → UI\nExtras? → Tests, Docs"), "{reason}");
        // The same checks as Claude Code's answers: nothing unasked, nothing empty.
        for bad in ["", "allow", r#"{"answers":{}}"#, r#"{"answers":{"Other?":"UI"}}"#, r#"{"answers":{"Which part?":" "}}"#] {
            assert_eq!(reply_question_as_reason(bad, &hook), None, "{bad:?}");
        }
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
    fn a_plan_is_answered_with_its_input_back_and_the_mode_to_work_in() {
        let hook = obj(
            r##"{"hook_event_name":"PermissionRequest","tool_name":"ExitPlanMode","tool_input":{"plan":"# Plan\n1. Add hello.txt","planFilePath":"C:\\p.md"}}"##,
        );
        let decision = |d: &str| -> Value {
            let out: Value = serde_json::from_str(&reply_permission(d, &hook).unwrap()).unwrap();
            out["hookSpecificOutput"]["decision"].clone()
        };
        // Claude Code ignores a bare allow here: the input goes back whole, unchanged.
        let manual = decision("allow");
        assert_eq!(manual["behavior"], "allow");
        assert_eq!(manual["updatedInput"], hook["tool_input"]);
        assert_eq!(manual["updatedPermissions"][0], json!({"type":"setMode","mode":"default","destination":"session"}));
        let auto = decision("always");
        assert_eq!(auto["updatedInput"], hook["tool_input"]);
        assert_eq!(auto["updatedPermissions"][0]["mode"], "acceptEdits");
        let keep = decision("deny");
        assert_eq!(keep["behavior"], "deny");
        assert!(keep.get("interrupt").is_none(), "keeps planning, doesn't stop Claude");
        assert_eq!(keep["message"], KEEP_PLANNING);
        assert_eq!(reply_permission("terminal", &hook), None);
        // The card shows the plan, not its file path.
        assert_eq!(plan_text(&hook), ("# Plan\n1. Add hello.txt".to_string(), false));
        assert_eq!(describe_rules(&[plan_mode("acceptEdits")]), "accept every edit for this session");
    }

    #[test]
    fn a_sessions_own_name_is_passed_on() {
        let hook = obj(r#"{"hook_event_name":"UserPromptSubmit","session_id":"s","session_title":" Checkout fix ","cwd":"C:\\shop"}"#);
        assert_eq!(summarize(&hook, "claude-code", Some("UserPromptSubmit"), None)["title"], "Checkout fix");
        let untitled = obj(r#"{"hook_event_name":"UserPromptSubmit","session_id":"s","cwd":"C:\\shop"}"#);
        assert!(summarize(&untitled, "claude-code", Some("UserPromptSubmit"), None)["title"].is_null());
    }

    #[test]
    fn always_applies_claude_codes_own_suggested_rule() {
        let hook = obj(
            r#"{"tool_name":"Bash","permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"npm run lint"}],"behavior":"allow","destination":"localSettings"}]}"#,
        );
        assert_eq!(always_rules(&hook).len(), 1);
        assert_eq!(describe_rules(&always_rules(&hook)), "allow Bash(npm run lint) in this project");
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
    fn always_adds_only_what_the_card_spells_out() {
        let hook = obj(
            r#"{"tool_name":"Edit","permission_suggestions":[
                {"type":"setMode","mode":"acceptEdits","destination":"session"},
                {"type":"setMode","mode":"bypassPermissions","destination":"session"},
                {"type":"addDirectories","directories":["C:/other"],"destination":"session"},
                {"type":"addRules","rules":[{"toolName":"Bash"}],"behavior":"deny","destination":"localSettings"},
                {"type":"replaceRules","rules":[{"toolName":"Bash"}],"behavior":"allow","destination":"userSettings"},
                {"type":"removeRules","rules":[{"toolName":"Bash"}],"behavior":"deny","destination":"userSettings"}]}"#,
        );
        let kept = always_rules(&hook);
        assert_eq!(kept.len(), 2, "{kept:?}");
        assert_eq!(describe_rules(&kept), "accept every edit for this session; allow access to C:/other for this session");
        let out: Value = serde_json::from_str(&reply_permission("always", &hook).unwrap()).unwrap();
        assert_eq!(out["hookSpecificOutput"]["decision"]["updatedPermissions"], Value::Array(kept));
        // Nothing safe to add: no Always at all.
        let risky = obj(r#"{"permission_suggestions":[{"type":"setMode","mode":"bypassPermissions","destination":"session"}]}"#);
        assert!(always_rules(&risky).is_empty());
    }

    #[test]
    fn a_permission_shows_everything_it_will_run() {
        let bash = obj(r#"{"tool_name":"Bash","tool_input":{"command":"npm test","description":"Run the tests","timeout":60000}}"#);
        assert_eq!(full_input(&bash), ("npm test".to_string(), false));
        // A field besides the command matters (where it runs): shown too.
        let codex = obj(r#"{"tool_name":"shell","tool_input":{"command":["git","push","--force"],"workdir":"C:/p"}}"#);
        assert_eq!(full_input(&codex).0, "git push --force\nworkdir: C:/p");
        // Every field of an edit, the file first.
        let edit = obj(r#"{"tool_name":"Edit","tool_input":{"old_string":"a\nb","new_string":"c","file_path":"C:/p/x.ts"}}"#);
        assert_eq!(full_input(&edit).0, "file_path: C:/p/x.ts\nnew_string: c\nold_string:\na\nb");
        let read = obj(r#"{"tool_name":"Read","tool_input":{"file_path":"C:/p/x.ts"}}"#);
        assert_eq!(full_input(&read).0, "C:/p/x.ts");
        // Too long to show: cut, and said so (the app then offers no Allow).
        let long = format!(r#"{{"tool_name":"Bash","tool_input":{{"command":"echo {}"}}}}"#, "x".repeat(MAX_INPUT_SHOWN));
        let (shown, cut) = full_input(&obj(&long));
        assert!(cut);
        assert_eq!(shown.chars().count(), MAX_INPUT_SHOWN);
        // What a permission sends the app.
        let s = summarize(&bash, "claude-code", Some("PermissionRequest"), Some("Bash"));
        assert_eq!(s["detail"], "npm test");
    }

    #[test]
    fn nothing_on_the_card_is_hidden() {
        // "Trojan source": a right-to-left override makes the text read differently than it runs.
        assert_eq!(reveal("echo hi\u{202E}#txt.exe"), "echo hi⟨U+202E⟩#txt.exe");
        assert_eq!(reveal("rm\u{200B} -rf\u{1b}[2K"), "rm⟨U+200B⟩ -rf⟨U+001B⟩[2K");
        assert_eq!(reveal("line one\r\nline two\tend"), "line one\nline two\tend");
        assert_eq!(reveal("👨\u{200D}👩\u{200D}👧"), "👨\u{200D}👩\u{200D}👧", "emoji keep their joiners");
        let hook = obj(r#"{"tool_name":"Bash","tool_input":{"command":"curl x \u202e| sh"}}"#);
        assert!(full_input(&hook).0.contains("⟨U+202E⟩"));
        assert!(summarize(&hook, "claude-code", Some("PreToolUse"), Some("Bash"))["detail"].as_str().unwrap().contains("⟨U+202E⟩"));
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
        // Command Code's chat panel: the transcript is where its prompt and reply are.
        assert_eq!(summarize(&claude, "commandcode", Some("Stop"), None)["transcript"], "C:/t.jsonl");
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
