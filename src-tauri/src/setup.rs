// Installed-app plumbing: putting the relay in place, connecting Claude Code,
// starting with Windows. All of it runs only when the user asks (tray menu),
// except the relay copy, which only refreshes our own file.
//
// Claude Code's ~/.claude/settings.json belongs to the user and to other
// tools: we take a dated backup first, keep every other key and every other
// tool's hooks exactly as they are (order included), and only add or remove
// the entries that run our relay.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

const RELAY: &str = "companion-hook.exe";
/// Next to the relay: the full path of the app it may talk to. The relay
/// checks that the program on the other end of the pipe is this one before it
/// sends anything or accepts an answer (agents.rs, hook/src/main.rs).
pub const APP_PATH_FILE: &str = "companion.path";

// ── Relay ─────────────────────────────────────────────────────────────────────

/// Where the hooks point: a fixed per-user path that survives app updates.
pub fn relay_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
    Some(base.join("DeskCompanion").join("bin").join(RELAY))
}

/// Copies the relay shipped with the app (or built next to it, in development)
/// to its fixed path, when it's missing or different. A copy that fails because
/// a hook is running right now is retried on the next launch.
pub fn install_relay(app: &AppHandle) -> Option<PathBuf> {
    let dest = relay_path()?;
    let source = [
        app.path().resource_dir().ok().map(|d| d.join(RELAY)),
        std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join(RELAY))),
    ]
    .into_iter()
    .flatten()
    .find(|p| p.is_file());
    let aside = dest.with_extension("old.exe");
    // Left by an earlier update while a hook was still running it.
    let _ = std::fs::remove_file(&aside);
    if let Some(src) = source {
        if differs(&src, &dest) {
            if let Some(dir) = dest.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if std::fs::copy(&src, &dest).is_err() {
                // A hook is running the old copy, so it can't be overwritten,
                // but Windows lets a running program be renamed. Move it aside
                // and put the new one in place: an old relay left behind would
                // keep talking the old way and the app would miss its events.
                if std::fs::rename(&dest, &aside).is_ok() && std::fs::copy(&src, &dest).is_err() {
                    let _ = std::fs::rename(&aside, &dest);
                }
            }
        }
    }
    // Tell the relay which program is the real companion: this one.
    if let (Ok(me), Some(dir)) = (std::env::current_exe(), dest.parent()) {
        let file = dir.join(APP_PATH_FILE);
        let me = me.to_string_lossy().into_owned();
        if std::fs::read_to_string(&file).ok().as_deref() != Some(me.as_str()) {
            let _ = std::fs::create_dir_all(dir);
            let _ = std::fs::write(&file, &me);
        }
    }
    dest.is_file().then_some(dest)
}

// ── Uninstall ─────────────────────────────────────────────────────────────────

/// Run by the uninstaller (`desk-companion.exe --uninstall-cleanup`): takes
/// out everything the app put outside its own folder, so nothing keeps
/// running after it's gone. Claude Code's settings are backed up first, as
/// always; the user's settings and other tools' hooks stay.
pub fn uninstall_cleanup() {
    for (agent, _) in AGENTS {
        let _ = write_agent_hooks(agent, None);
    }
    let _ = set_autostart(false);
    if let Some(dir) = relay_path().and_then(|p| p.parent().map(Path::to_path_buf)) {
        remove_relay_dir(&dir);
    }
}

/// Deletes the relay's folder (`…\DeskCompanion\bin`) and its parent if that
/// is then empty. A hook running at this very moment can hold the file for a
/// split second, so try a few times.
fn remove_relay_dir(dir: &Path) {
    for _ in 0..5 {
        if std::fs::remove_dir_all(dir).is_ok() || !dir.exists() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    if let Some(parent) = dir.parent() {
        let _ = std::fs::remove_dir(parent); // only succeeds when empty
    }
}

fn differs(a: &Path, b: &Path) -> bool {
    match (std::fs::read(a), std::fs::read(b)) {
        (Ok(x), Ok(y)) => x != y,
        _ => true,
    }
}

// ── Coding agents' hooks ──────────────────────────────────────────────────────
//
// Each agent keeps its hooks in its own user-level file. For the files other
// tools share (Claude Code's, Codex's, Gemini's settings) we back up first and
// only add or remove the entries that run our relay. Copilot CLI reads a folder
// of hook files, so it gets a file of its own. Command Code gets a mod (a
// script of ours in its mods folder, integrations/commandcode-mod.ts): its
// plain hooks can't tell us about interrupted or failed runs, permission
// prompts or questions.
//
// IDEs: Cursor has its own hooks.json; Antigravity (IDE, 2.0 and CLI) a named
// group in ~/.gemini/config/hooks.json; VS Code's agent reads Copilot CLI's
// hook folder, so the Copilot file serves both (each entry has a `powershell`
// command for Copilot CLI and a `windows` one for VS Code, so each says who
// it is and neither runs twice).
//
// Each agent runs hook commands through its own shell on Windows, and each
// shell needs the relay's path written its own way (see `relay_cmd`):
//   Claude Code: Git Bash.  Codex: cmd.  Gemini CLI, VS Code: PowerShell.
//   Copilot CLI: its `powershell` field (and `bash` elsewhere).
//   Cursor, Antigravity: not documented, so a form every shell runs (Shell::Any).

/// The agents the app can connect, in the order Settings lists them.
pub const AGENTS: &[(&str, &str)] = &[
    ("claude-code", "Claude Code"),
    ("codex", "Codex"),
    ("copilot", "GitHub Copilot (CLI and VS Code)"),
    ("gemini", "Gemini CLI"),
    ("commandcode", "Command Code"),
    ("cursor", "Cursor"),
    ("antigravity", "Antigravity"),
];

/// Antigravity's hooks are named groups; ours is this one.
const ANTIGRAVITY_GROUP: &str = "desk-companion";

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

/// The agent's own folder: its being there means the agent is installed.
fn agent_dir(agent: &str) -> Option<PathBuf> {
    let dir = match agent {
        "claude-code" => ".claude",
        "codex" => ".codex",
        "copilot" => ".copilot",
        "gemini" => ".gemini",
        "commandcode" => ".commandcode",
        "cursor" => ".cursor",
        "antigravity" => ".gemini/config",
        _ => return None,
    };
    home().map(|h| h.join(dir))
}

/// The agent is on this PC.
fn installed(agent: &str) -> bool {
    let Some(home) = home() else { return false };
    match agent {
        // The IDE's folder, Antigravity 2.0's, or the CLI's.
        "antigravity" => [".antigravity", ".gemini/antigravity", ".gemini/antigravity-cli"].iter().any(|d| home.join(d).is_dir()),
        // VS Code counts for the Copilot file too.
        "copilot" => agent_dir(agent).is_some_and(|d| d.is_dir()) || home.join(".vscode").is_dir(),
        _ => agent_dir(agent).is_some_and(|d| d.is_dir()),
    }
}

/// The file our hooks go in.
fn agent_file(agent: &str) -> Option<PathBuf> {
    let dir = agent_dir(agent)?;
    Some(match agent {
        "codex" | "cursor" | "antigravity" => dir.join("hooks.json"),
        "copilot" => dir.join("hooks").join("desk-companion.json"),
        "commandcode" => dir.join("mods").join(COMMANDCODE_MOD_FILE),
        _ => dir.join("settings.json"),
    })
}

/// Our Command Code mod, as installed (the relay path filled in at install).
const COMMANDCODE_MOD_FILE: &str = "desk-companion.ts";
const COMMANDCODE_MOD: &str = include_str!("../../integrations/commandcode-mod.ts");
const COMMANDCODE_RELAY_SLOT: &str = "\"__DESK_COMPANION_RELAY__\"";

/// The mod with `relay` written in (as a string literal).
fn commandcode_mod(relay: &str) -> String {
    let literal = serde_json::to_string(relay).unwrap_or_else(|_| "\"\"".into());
    COMMANDCODE_MOD.replacen(COMMANDCODE_RELAY_SLOT, &literal, 1)
}

/// How each agent's shell needs the relay written (Windows).
#[derive(Clone, Copy)]
enum Shell {
    /// Git Bash (Claude Code), and `bash` fields: a double-quoted path.
    Sh,
    /// `powershell -Command`: a quoted path alone is just a string, `&` runs it.
    PowerShell,
    /// cmd, or a program started directly (Codex): a double-quoted path.
    Cmd,
    /// Whatever the agent uses: the bare path when nothing in it needs quoting
    /// (cmd, PowerShell, bash and a direct start all run that), else quoted.
    Any,
}

/// The relay followed by `args`, as one command line for `shell`.
fn relay_cmd(relay: &str, shell: Shell, args: &str) -> String {
    let exe = match shell {
        Shell::Sh | Shell::Cmd => format!("\"{relay}\""),
        Shell::PowerShell => format!("& '{}'", relay.replace('\'', "''")),
        Shell::Any if relay.chars().all(|c| c.is_ascii_alphanumeric() || "/\\:._-".contains(c)) => relay.to_string(),
        Shell::Any => format!("\"{relay}\""),
    };
    if args.is_empty() {
        exe
    } else {
        format!("{exe} {args}")
    }
}

fn read_settings(path: &Path) -> Result<Value, String> {
    let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
    match std::fs::read_to_string(path) {
        Ok(text) if text.trim().is_empty() => Ok(json!({})),
        Ok(text) => serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| format!("{name} isn't valid JSON ({e}); left untouched")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(e.to_string()),
    }
}

/// A hook group (or a flat hook entry) that runs our relay.
fn is_ours(group: &Value) -> bool {
    let runs_relay = |h: &Value| ["command", "exec", "powershell", "bash"].iter().any(|k| h[*k].as_str().is_some_and(|c| c.contains(RELAY)));
    runs_relay(group) || group["hooks"].as_array().is_some_and(|hooks| hooks.iter().any(runs_relay))
}

/// Our entries for one agent: (event, the group or entry to add). The relay
/// command is quoted; agents run it through a shell.
fn agent_hooks(agent: &str, relay: &str) -> Vec<(&'static str, Value)> {
    let cmd = |extra: &str| relay_cmd(relay, Shell::Sh, extra);
    let group = |matcher: Option<&str>, hook: Value| {
        let mut g = Map::new();
        if let Some(m) = matcher {
            g.insert("matcher".into(), json!(m));
        }
        g.insert("hooks".into(), json!([hook]));
        Value::Object(g)
    };
    match agent {
        "claude-code" => {
            let mut out: Vec<(&'static str, Value)> = CLAUDE_EVENTS
                .iter()
                .map(|event| {
                    // PermissionRequest waits for the click in the companion; every
                    // other event is fire-and-forget and never holds the agent up.
                    let hook = if *event == "PermissionRequest" {
                        json!({ "type": "command", "command": cmd(""), "timeout": 120 })
                    } else {
                        json!({ "type": "command", "command": cmd(""), "timeout": 5, "async": true })
                    };
                    let matcher = (event.contains("ToolUse") || *event == "PermissionRequest").then_some("*");
                    (*event, group(matcher, hook))
                })
                .collect();
            // Claude's multiple-choice questions, answered from the companion.
            out.push(("PreToolUse", group(Some("AskUserQuestion"), json!({ "type": "command", "command": cmd("--wait"), "timeout": 120 }))));
            out
        }
        "codex" => {
            // Codex starts hooks through cmd; timeouts in seconds; no `async` key (Codex
            // runs them alongside anyway). PermissionRequest waits for the companion.
            let c = relay_cmd(relay, Shell::Cmd, "--agent codex");
            [
                ("SessionStart", 10), ("UserPromptSubmit", 10), ("PreToolUse", 10), ("PermissionRequest", 120),
                ("PostToolUse", 10), ("Stop", 10), ("Interrupt", 3), ("SessionEnd", 3),
            ]
            .iter()
            .map(|(event, timeout)| {
                let mut hook = json!({ "type": "command", "command": c, "timeout": timeout });
                if *event == "PermissionRequest" {
                    hook["statusMessage"] = json!("Waiting for your answer in Desk Companion");
                }
                (*event, group(None, hook))
            })
            .collect()
        }
        "gemini" => {
            // PowerShell on Windows; timeouts in milliseconds; the event, in Claude
            // Code's words, on the command line.
            [
                ("SessionStart", "SessionStart", 10000), ("BeforeAgent", "UserPromptSubmit", 5000),
                ("BeforeTool", "PreToolUse", 5000), ("AfterTool", "PostToolUse", 5000),
                ("AfterAgent", "Stop", 5000), ("Notification", "Notification", 5000), ("SessionEnd", "SessionEnd", 10000),
            ]
            .iter()
            .map(|(event, said, timeout)| {
                let hook = json!({
                    "type": "command",
                    "command": relay_cmd(relay, Shell::PowerShell, &format!("--agent gemini --event {said}")),
                    "name": "desk-companion",
                    "timeout": timeout,
                });
                (*event, group(Some("*"), hook))
            })
            .collect()
        }
        // A mod, not hooks (see write_agent_hooks).
        "commandcode" => Vec::new(),
        "copilot" => {
            // camelCase events; Copilot doesn't say which event in the payload, so
            // it goes on the command line. It runs `powershell` on Windows, `bash`
            // elsewhere. Status only: permissionRequest is fail-closed in Copilot,
            // so it stays in its terminal.
            //
            // VS Code's agent reads this folder too, maps these names to Claude
            // Code's, and prefers `windows` (run with Windows PowerShell), which
            // Copilot CLI doesn't read: so each reports as itself, once.
            [
                ("sessionStart", "SessionStart", 10), ("userPromptSubmitted", "UserPromptSubmit", 10),
                ("preToolUse", "PreToolUse", 10), ("postToolUse", "PostToolUse", 10), ("agentStop", "Stop", 10),
                ("errorOccurred", "StopFailure", 10), ("notification", "Notification", 10), ("sessionEnd", "SessionEnd", 3),
            ]
            .iter()
            .map(|(event, said, timeout)| {
                let args = format!("--agent copilot --event {event}");
                let entry = json!({
                    "type": "command",
                    "bash": relay_cmd(relay, Shell::Sh, &args),
                    "powershell": relay_cmd(relay, Shell::PowerShell, &args),
                    "windows": relay_cmd(relay, Shell::PowerShell, &format!("--agent vscode --event {said}")),
                    "timeoutSec": timeout,
                });
                (*event, entry)
            })
            .collect()
        }
        "cursor" => {
            // camelCase events, flat entries, timeouts in seconds. Status only:
            // the relay prints nothing, which Cursor takes as "carry on".
            let c = |event: &str| relay_cmd(relay, Shell::Any, &format!("--agent cursor --event {event}"));
            CURSOR_EVENTS.iter().map(|event| (*event, json!({ "command": c(event), "timeout": 10 }))).collect()
        }
        // A named group, not per-event entries (see write_agent_hooks).
        "antigravity" => Vec::new(),
        _ => Vec::new(),
    }
}

const CURSOR_EVENTS: &[&str] = &[
    "sessionStart", "beforeSubmitPrompt", "preToolUse", "postToolUse", "postToolUseFailure", "afterAgentResponse", "stop",
    "sessionEnd",
];

/// Our group in Antigravity's hooks.json. Steps are reported once done
/// (PostToolUse): its PreToolUse reads no decision as a denial, and we never
/// decide for it. PreInvocation starts a turn; Stop ends it.
fn antigravity_group(relay: &str) -> Value {
    let handler = |event: &str| {
        json!({ "type": "command", "command": relay_cmd(relay, Shell::Any, &format!("--agent antigravity --event {event}")), "timeout": 10 })
    };
    json!({
        "PreInvocation": [handler("PreInvocation")],
        "PostToolUse": [{ "matcher": "*", "hooks": [handler("PostToolUse")] }],
        "Stop": [handler("Stop")],
    })
}

const CLAUDE_EVENTS: &[&str] = &[
    "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
    "PermissionRequest", "Notification", "Stop", "StopFailure", "SessionEnd",
];

/// Every event any agent of ours uses, so removing finds ours wherever it is.
const ALL_EVENTS: &[&str] = &[
    "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest",
    "Notification", "Stop", "StopFailure", "SessionEnd", "BeforeAgent", "BeforeTool", "AfterTool", "AfterAgent",
    "Interrupt", "sessionStart", "beforeSubmitPrompt", "preToolUse", "postToolUse", "postToolUseFailure",
    "afterAgentResponse", "stop", "sessionEnd",
];

/// Adds (`ours` = Some) or removes (None) our entries in a `{"hooks": {...}}`
/// settings object. Everything else is left as it was, order included.
fn merge_groups(settings: &mut Value, ours: Option<&[(&str, Value)]>) {
    if !settings.is_object() {
        *settings = json!({});
    }
    let root = settings.as_object_mut().unwrap();
    let hooks = root.entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks = hooks.as_object_mut().unwrap();
    for event in ALL_EVENTS {
        let mut groups: Vec<Value> = hooks
            .get(*event)
            .and_then(Value::as_array)
            .map(|a| a.iter().filter(|g| !is_ours(g)).cloned().collect())
            .unwrap_or_default();
        for (_, g) in ours.unwrap_or(&[]).iter().filter(|(e, _)| e == event) {
            groups.push(g.clone());
        }
        if groups.is_empty() {
            hooks.remove(*event);
        } else {
            hooks.insert((*event).to_string(), Value::Array(groups));
        }
    }
    if hooks.is_empty() {
        root.remove("hooks");
    }
}

/// Claude Code's settings: add (command = Some(relay path)) or remove our hooks.
#[cfg(test)]
pub fn merge_hooks(settings: &mut Value, command: Option<&str>) {
    let ours = command.map(|c| agent_hooks("claude-code", c.trim_matches('"')));
    merge_groups(settings, ours.as_deref());
}

pub fn agent_connected(agent: &str) -> bool {
    let Some(path) = agent_file(agent) else { return false };
    if agent == "commandcode" {
        return std::fs::read_to_string(&path).is_ok_and(|t| t.contains(RELAY));
    }
    if agent == "antigravity" {
        return read_settings(&path).is_ok_and(|s| s.get(ANTIGRAVITY_GROUP).is_some_and(|g| g.to_string().contains(RELAY)));
    }
    read_settings(&path).is_ok_and(|s| {
        s["hooks"].as_object().is_some_and(|h| h.values().any(|v| v.as_array().is_some_and(|a| a.iter().any(is_ours))))
    })
}

pub fn claude_connected() -> bool {
    agent_connected("claude-code")
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    id: &'static str,
    name: &'static str,
    /// Its folder exists on this PC.
    installed: bool,
    connected: bool,
}

pub fn agents_status() -> Vec<AgentStatus> {
    AGENTS
        .iter()
        .map(|(id, name)| AgentStatus {
            id,
            name,
            installed: installed(id),
            connected: agent_connected(id),
        })
        .collect()
}

/// Brings every connected agent's hooks up to this version's format, on start:
/// a fix to how an agent's shell runs the relay (Gemini CLI's PowerShell, say)
/// then reaches people who connected it before. Command Code connected with
/// the plain hooks of earlier versions moves to the mod. Files only change
/// (after a backup) when they differ.
pub fn refresh_agents() {
    let Some(relay) = relay_path().filter(|p| p.is_file()) else { return };
    let relay = relay.to_string_lossy().replace('\\', "/");
    for (agent, _) in AGENTS {
        let old_commandcode = *agent == "commandcode" && old_commandcode_hooks();
        if agent_connected(agent) || old_commandcode {
            let _ = write_agent_hooks(agent, Some(&relay));
        }
    }
}

/// Command Code's settings still have our plain hooks (versions before the mod).
fn old_commandcode_hooks() -> bool {
    agent_dir("commandcode")
        .map(|d| d.join("settings.json"))
        .and_then(|p| read_settings(&p).ok())
        .is_some_and(|s| s["hooks"].as_object().is_some_and(|h| h.values().any(|v| v.as_array().is_some_and(|a| a.iter().any(is_ours)))))
}

/// Connects (or disconnects) Claude Code. Returns a short message for the user.
pub fn set_claude(app: &AppHandle, connect: bool) -> Result<String, String> {
    set_agent(app, "claude-code", connect)
}

/// Connects (or disconnects) one agent. Returns a short message for the user.
pub fn set_agent(app: &AppHandle, agent: &str, connect: bool) -> Result<String, String> {
    let name = AGENTS.iter().find(|(id, _)| *id == agent).map(|(_, n)| *n).ok_or("Unknown agent.")?;
    let relay = if connect {
        let relay = install_relay(app).ok_or("The relay isn't available; reinstall the app.")?;
        Some(relay.to_string_lossy().replace('\\', "/"))
    } else {
        None
    };
    write_agent_hooks(agent, relay.as_deref()).map(|done| match (done, connect) {
        (false, true) => format!("{name} was already connected."),
        (false, false) => format!("{name} wasn't connected."),
        (true, true) => match agent {
            "codex" => "Connected. Codex asks you to approve the new hook once: run /hooks in Codex and trust it.".into(),
            "gemini" => "Connected. New Gemini CLI sessions will show up here (restart any that are open).".into(),
            "commandcode" => "Connected. New Command Code sessions will show up here (in open ones, run /reload).".into(),
            "cursor" => "Connected. Restart Cursor, then its agent's sessions show up here.".into(),
            "antigravity" => "Connected. New Antigravity conversations will show up here.".into(),
            "copilot" => "Connected. New Copilot CLI sessions and VS Code agent chats will show up here.".into(),
            _ => format!("Connected. New {name} sessions will show up here."),
        },
        (true, false) => format!("Disconnected from {name}."),
    })
}

/// Writes our hooks into (Some(relay)) or out of (None) one agent's file.
/// Returns whether anything changed.
fn write_agent_hooks(agent: &str, relay: Option<&str>) -> Result<bool, String> {
    let path = agent_file(agent).ok_or("Couldn't find your user folder.")?;
    let ours = relay.map(|r| agent_hooks(agent, r));

    if agent == "commandcode" {
        // Hooks from versions before the mod: out, either way.
        let old = remove_old_commandcode_hooks()?;
        let changed = match relay {
            None if path.is_file() => {
                std::fs::remove_file(&path).map_err(|e| e.to_string())?;
                // The mods folder too, if it was only there for us.
                if let Some(dir) = path.parent() {
                    let _ = std::fs::remove_dir(dir);
                }
                true
            }
            None => false,
            Some(r) => {
                let text = commandcode_mod(r);
                if std::fs::read_to_string(&path).ok().as_deref() == Some(text.as_str()) {
                    false
                } else {
                    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
                    std::fs::write(&path, text).map_err(|e| format!("Couldn't write {}: {e}", path.display()))?;
                    true
                }
            }
        };
        return Ok(changed || old);
    }

    if agent == "copilot" {
        // A file of our own in Copilot's hooks folder.
        return match ours {
            None if path.is_file() => {
                std::fs::remove_file(&path).map_err(|e| e.to_string())?;
                // The hooks folder too, if it was only there for us.
                if let Some(dir) = path.parent() {
                    let _ = std::fs::remove_dir(dir);
                }
                Ok(true)
            }
            None => Ok(false),
            Some(entries) => {
                let mut hooks = Map::new();
                for (event, entry) in entries {
                    hooks.insert(event.to_string(), json!([entry]));
                }
                let text = serde_json::to_string_pretty(&json!({ "version": 1, "hooks": hooks })).map_err(|e| e.to_string())? + "\n";
                if std::fs::read_to_string(&path).ok().as_deref() == Some(text.as_str()) {
                    return Ok(false);
                }
                std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
                std::fs::write(&path, text).map(|_| true).map_err(|e| format!("Couldn't write {}: {e}", path.display()))
            }
        };
    }

    let mut settings = read_settings(&path)?;
    let before = settings.clone();
    if agent == "antigravity" {
        set_antigravity_group(&mut settings, relay)?;
    } else {
        merge_groups(&mut settings, ours.as_deref());
        if agent == "cursor" && settings.get("hooks").is_some() {
            // Cursor's file needs its version.
            settings.as_object_mut().unwrap().entry("version").or_insert(json!(1));
        }
    }
    if settings == before {
        return Ok(false);
    }
    let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
    if relay.is_none() && matches!(agent, "cursor" | "antigravity") && only_a_stub(&settings) {
        // A hooks file that only ever held ours: nothing to keep.
        std::fs::remove_file(&path).map_err(|e| format!("Couldn't remove {name}: {e}"))?;
        return Ok(true);
    }
    if path.is_file() {
        let b = path.with_file_name(format!("{name}.bak-{}", stamp()));
        std::fs::copy(&path, &b).map_err(|e| format!("Couldn't back up {name}: {e}"))?;
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())? + "\n";
    std::fs::write(&path, text).map_err(|e| format!("Couldn't write {name}: {e}"))?;
    Ok(true)
}

/// Nothing left in a hooks file but Cursor's `version`.
fn only_a_stub(settings: &Value) -> bool {
    settings.as_object().is_some_and(|o| o.keys().all(|k| k == "version"))
}

/// Adds (Some(relay)) or removes our named group in Antigravity's hooks.json.
/// A group by that name that isn't ours is left alone.
fn set_antigravity_group(settings: &mut Value, relay: Option<&str>) -> Result<(), String> {
    if !settings.is_object() {
        *settings = json!({});
    }
    let root = settings.as_object_mut().unwrap();
    let ours = |g: &Value| g.to_string().contains(RELAY);
    if root.get(ANTIGRAVITY_GROUP).is_some_and(|g| !ours(g)) {
        return Err(format!("Antigravity already has a hook group called \"{ANTIGRAVITY_GROUP}\" that isn't mine; left it alone."));
    }
    match relay {
        Some(r) => {
            root.insert(ANTIGRAVITY_GROUP.into(), antigravity_group(r));
        }
        None => {
            root.remove(ANTIGRAVITY_GROUP);
        }
    }
    Ok(())
}

/// Takes our plain hooks (from before the mod) out of Command Code's settings.
fn remove_old_commandcode_hooks() -> Result<bool, String> {
    let Some(path) = agent_dir("commandcode").map(|d| d.join("settings.json")) else { return Ok(false) };
    if !path.is_file() {
        return Ok(false);
    }
    let mut settings = read_settings(&path)?;
    let before = settings.clone();
    merge_groups(&mut settings, None);
    if settings == before {
        return Ok(false);
    }
    let b = path.with_file_name(format!("settings.json.bak-{}", stamp()));
    std::fs::copy(&path, &b).map_err(|e| format!("Couldn't back up Command Code's settings: {e}"))?;
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())? + "\n";
    std::fs::write(&path, text).map_err(|e| format!("Couldn't write Command Code's settings: {e}"))?;
    Ok(true)
}

/// YYYYMMDD-HHMMSS in UTC, for backup names.
fn stamp() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}{m:02}{d:02}-{:02}{:02}{:02}", rem / 3600, rem % 3600 / 60, rem % 60)
}

// ── Start with Windows ────────────────────────────────────────────────────────

#[cfg(windows)]
mod run_key {
    const HKCU: isize = 0x8000_0001u32 as i32 as isize;
    const REG_SZ: u32 = 1;
    const RRF_RT_REG_SZ: u32 = 2;
    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const VALUE: &str = "DeskCompanion";

    #[link(name = "advapi32")]
    extern "system" {
        fn RegSetKeyValueW(hkey: isize, sub: *const u16, value: *const u16, kind: u32, data: *const u8, len: u32) -> i32;
        fn RegDeleteKeyValueW(hkey: isize, sub: *const u16, value: *const u16) -> i32;
        fn RegGetValueW(hkey: isize, sub: *const u16, value: *const u16, flags: u32, kind: *mut u32, data: *mut std::ffi::c_void, len: *mut u32) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn enabled() -> bool {
        let (k, v) = (wide(KEY), wide(VALUE));
        let mut len = 0u32;
        // SAFETY: size query only (null data pointer).
        unsafe { RegGetValueW(HKCU, k.as_ptr(), v.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), std::ptr::null_mut(), &mut len) == 0 }
    }

    pub fn set(on: bool) -> std::io::Result<()> {
        let (k, v) = (wide(KEY), wide(VALUE));
        let rc = if on {
            let exe = std::env::current_exe()?;
            let data = wide(&format!("\"{}\"", exe.display()));
            // SAFETY: data is a NUL-terminated UTF-16 string; len is its size in bytes.
            unsafe { RegSetKeyValueW(HKCU, k.as_ptr(), v.as_ptr(), REG_SZ, data.as_ptr().cast(), (data.len() * 2) as u32) }
        } else {
            // SAFETY: plain call with NUL-terminated names.
            let rc = unsafe { RegDeleteKeyValueW(HKCU, k.as_ptr(), v.as_ptr()) };
            if rc == 2 { 0 } else { rc } // already absent is fine
        };
        if rc == 0 { Ok(()) } else { Err(std::io::Error::from_raw_os_error(rc)) }
    }
}

#[cfg(not(windows))]
mod run_key {
    pub fn enabled() -> bool {
        false
    }
    pub fn set(_on: bool) -> std::io::Result<()> {
        Err(std::io::Error::other("not supported yet on this system"))
    }
}

pub use run_key::{enabled as autostart_enabled, set as set_autostart};

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> Value {
        serde_json::from_str(
            r#"{
              "hooks": {
                "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "other-tool.exe" }] }],
                "Stop": [{ "hooks": [{ "type": "command", "command": "coucou-hook.exe Stop" }] }]
              },
              "theme": "dark",
              "enabledPlugins": { "b": true, "a": true }
            }"#,
        )
        .unwrap()
    }

    #[test]
    fn connecting_adds_ours_and_keeps_everything_else_in_order() {
        let mut s = settings();
        merge_hooks(&mut s, Some("\"C:/x/companion-hook.exe\""));
        let keys: Vec<&String> = s.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["hooks", "theme", "enabledPlugins"]);
        let plugins: Vec<&String> = s["enabledPlugins"].as_object().unwrap().keys().collect();
        assert_eq!(plugins, ["b", "a"], "other keys keep their order");
        assert_eq!(s["hooks"]["UserPromptSubmit"][0]["hooks"][0]["command"], "other-tool.exe");
        assert_eq!(s["hooks"]["Stop"][0]["hooks"][0]["command"], "coucou-hook.exe Stop");
        assert!(is_ours(&s["hooks"]["Stop"][1]));
        assert_eq!(s["hooks"]["PermissionRequest"][0]["hooks"][0]["timeout"], 120);
        assert!(s["hooks"]["PermissionRequest"][0]["hooks"][0].get("async").is_none());
        assert_eq!(s["hooks"]["PreToolUse"][0]["hooks"][0]["async"], true);
    }

    #[test]
    fn connecting_twice_changes_nothing_and_disconnecting_restores() {
        let original = settings();
        let mut s = original.clone();
        merge_hooks(&mut s, Some("relay/companion-hook.exe"));
        let once = s.clone();
        merge_hooks(&mut s, Some("relay/companion-hook.exe"));
        assert_eq!(s, once);
        merge_hooks(&mut s, None);
        assert_eq!(s, original);
    }

    #[test]
    fn claude_questions_get_a_waiting_entry_of_their_own() {
        let mut s = json!({});
        merge_hooks(&mut s, Some("C:/x/companion-hook.exe"));
        let pre = s["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre.len(), 2);
        assert_eq!(pre[1]["matcher"], "AskUserQuestion");
        assert_eq!(pre[1]["hooks"][0]["command"], "\"C:/x/companion-hook.exe\" --wait");
        assert!(pre[1]["hooks"][0].get("async").is_none(), "it waits for the answer");
    }

    #[test]
    fn other_agents_get_their_own_dialect_and_come_out_cleanly() {
        let relay = "C:/x/companion-hook.exe";
        for agent in ["codex", "gemini"] {
            let original = json!({ "theme": "dark", "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "mine.exe" }] }] } });
            let mut s = original.clone();
            let ours = agent_hooks(agent, relay);
            merge_groups(&mut s, Some(&ours));
            let text = s.to_string();
            assert!(text.contains(&format!("--agent {agent}")), "{agent}: {text}");
            assert_eq!(s["hooks"]["Stop"].as_array().map(|a| a[0]["hooks"][0]["command"].clone()), Some(json!("mine.exe")), "{agent}");
            merge_groups(&mut s, None);
            assert_eq!(s, original, "{agent}");
        }
        let gemini = agent_hooks("gemini", relay);
        let events: Vec<&str> = gemini.iter().map(|(e, _)| *e).collect();
        assert!(events.contains(&"BeforeTool") && events.contains(&"AfterAgent"));
        let before_tool = &gemini.iter().find(|(e, _)| *e == "BeforeTool").unwrap().1;
        assert_eq!(before_tool["matcher"], "*");
        assert_eq!(before_tool["hooks"][0]["timeout"], 5000, "Gemini counts milliseconds");
        // PowerShell runs a quoted path only with `&`; the event goes on the command line.
        assert_eq!(before_tool["hooks"][0]["command"], "& 'C:/x/companion-hook.exe' --agent gemini --event PreToolUse");

        let codex = agent_hooks("codex", relay);
        assert!(codex.iter().all(|(_, g)| g["hooks"][0].get("async").is_none()), "Codex gets no async key");
        let perm = &codex.iter().find(|(e, _)| *e == "PermissionRequest").unwrap().1;
        assert_eq!(perm["hooks"][0]["timeout"], 120);
        assert_eq!(perm["hooks"][0]["command"], "\"C:/x/companion-hook.exe\" --agent codex");
        assert!(codex.iter().any(|(e, _)| *e == "Interrupt"), "Esc in Codex ends the turn");

        let copilot = agent_hooks("copilot", relay);
        let (event, entry) = &copilot[0];
        assert_eq!(*event, "sessionStart");
        assert_eq!(entry["powershell"], "& 'C:/x/companion-hook.exe' --agent copilot --event sessionStart");
        assert_eq!(entry["bash"], "\"C:/x/companion-hook.exe\" --agent copilot --event sessionStart");
        assert!(is_ours(entry));
        assert!(!copilot.iter().any(|(e, _)| *e == "permissionRequest"), "Copilot's permission hook is fail-closed");
    }

    #[test]
    fn copilots_file_serves_vs_code_too() {
        let copilot = agent_hooks("copilot", "C:/x/companion-hook.exe");
        let stop = &copilot.iter().find(|(e, _)| *e == "agentStop").unwrap().1;
        assert_eq!(stop["powershell"], "& 'C:/x/companion-hook.exe' --agent copilot --event agentStop");
        assert_eq!(stop["windows"], "& 'C:/x/companion-hook.exe' --agent vscode --event Stop");
    }

    #[test]
    fn cursor_gets_flat_camel_case_entries() {
        let relay = "C:/Users/me/AppData/Local/DeskCompanion/bin/companion-hook.exe";
        let ours = agent_hooks("cursor", relay);
        let events: Vec<&str> = ours.iter().map(|(e, _)| *e).collect();
        assert_eq!(events, CURSOR_EVENTS);
        assert_eq!(ours[0].1["command"], format!("{relay} --agent cursor --event sessionStart"), "a bare path every shell runs");
        let original = json!({ "version": 1, "hooks": { "stop": [{ "command": "mine.exe" }] } });
        let mut s = original.clone();
        merge_groups(&mut s, Some(&ours));
        assert_eq!(s["hooks"]["stop"].as_array().unwrap().len(), 2);
        assert!(is_ours(&s["hooks"]["preToolUse"][0]));
        merge_groups(&mut s, None);
        assert_eq!(s, original);
    }

    #[test]
    fn antigravity_gets_a_named_group_and_leaves_others_alone() {
        let relay = "C:/x/companion-hook.exe";
        let mut s = json!({ "my-linter": { "PostToolUse": [] } });
        set_antigravity_group(&mut s, Some(relay)).unwrap();
        let g = &s[ANTIGRAVITY_GROUP];
        assert_eq!(g["PostToolUse"][0]["matcher"], "*");
        assert_eq!(g["Stop"][0]["command"], "C:/x/companion-hook.exe --agent antigravity --event Stop");
        assert!(g.get("PreToolUse").is_none(), "no decision is ever given for Antigravity");
        set_antigravity_group(&mut s, None).unwrap();
        assert_eq!(s, json!({ "my-linter": { "PostToolUse": [] } }));

        let mut theirs = json!({ ANTIGRAVITY_GROUP: { "Stop": [{ "command": "someone-else.exe" }] } });
        assert!(set_antigravity_group(&mut theirs, Some(relay)).is_err());
        assert!(set_antigravity_group(&mut theirs, None).is_err());
    }

    #[test]
    fn a_hooks_file_with_nothing_else_in_it_is_a_stub() {
        assert!(only_a_stub(&json!({})));
        assert!(only_a_stub(&json!({ "version": 1 })));
        assert!(!only_a_stub(&json!({ "version": 1, "hooks": { "stop": [] } })));
        assert!(!only_a_stub(&json!({ "my-linter": {} })));
    }

    #[test]
    fn paths_that_need_quoting_get_them() {
        assert_eq!(relay_cmd("C:/A B/companion-hook.exe", Shell::Any, "x"), "\"C:/A B/companion-hook.exe\" x");
        assert_eq!(relay_cmd("C:/a&b/companion-hook.exe", Shell::Any, ""), "\"C:/a&b/companion-hook.exe\"");
        assert_eq!(relay_cmd("C:/ab/companion-hook.exe", Shell::Any, ""), "C:/ab/companion-hook.exe");
    }

    #[test]
    fn powershell_paths_with_quotes_stay_one_string() {
        assert_eq!(relay_cmd("C:/O'Brien/companion-hook.exe", Shell::PowerShell, "x"), "& 'C:/O''Brien/companion-hook.exe' x");
        assert_eq!(relay_cmd("C:/A B/companion-hook.exe", Shell::Cmd, ""), "\"C:/A B/companion-hook.exe\"");
    }

    #[test]
    fn command_code_gets_the_mod_with_the_relay_written_in() {
        assert!(agent_hooks("commandcode", "C:/x/companion-hook.exe").is_empty());
        let text = commandcode_mod("C:/Users/A B/companion-hook.exe");
        assert!(text.contains(r#"const RELAY: string = "C:/Users/A B/companion-hook.exe";"#), "the path is a string literal");
        assert!(!text.contains("__DESK_COMPANION_RELAY__\";"), "the slot is filled");
        assert!(text.contains("export default function"));
        assert!(text.contains(RELAY), "agent_connected finds it");
    }

    #[test]
    fn stamp_looks_like_a_date() {
        let s = stamp();
        assert_eq!(s.len(), 15, "{s}");
        assert!(s.starts_with("20"), "{s}");
    }
}

#[cfg(test)]
mod uninstall_tests {
    use super::*;

    #[test]
    fn the_relay_folder_goes_and_its_parent_only_when_empty() {
        let base = std::env::temp_dir().join(format!("dc-uninstall-{}", std::process::id()));
        let bin = base.join("DeskCompanion").join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join(RELAY), b"relay").unwrap();
        std::fs::write(bin.join(APP_PATH_FILE), br"C:\app.exe").unwrap();
        remove_relay_dir(&bin);
        assert!(!bin.exists());
        assert!(!base.join("DeskCompanion").exists(), "empty parent removed");

        // Something else of ours in the parent: the parent stays.
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(base.join("DeskCompanion").join("notes.txt"), b"keep").unwrap();
        remove_relay_dir(&bin);
        assert!(!bin.exists());
        assert!(base.join("DeskCompanion").join("notes.txt").exists());
        let _ = std::fs::remove_dir_all(&base);
    }
}
