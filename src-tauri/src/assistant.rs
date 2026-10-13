// The device-help assistant: the user asks about their PC, Claude answers.
//
// Everything that touches the API key stays here, on the Rust side: the key
// lives in Windows Credential Manager, is read only to make the request, and
// never reaches the web pages. The pages see the answer and nothing else.
//
// Each question carries a short, visible summary of the machine (Windows
// version, model, CPU, memory, disk, battery) so answers fit this PC. The
// panel shows the user exactly what that summary says.
//
// The answer comes back as structured JSON — kind, confidence, answer, and
// suggested rephrasings — so the character can react with the spec's states:
// SUCCESS for a confident answer, SUGGESTING for "did you mean…", CONFUSED
// when the question wasn't understood.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const MODEL: &str = "claude-opus-5-5";
/// Chat answers: low effort keeps replies quick; thinking is always on for this model.
const EFFORT: &str = "low";
const MAX_TOKENS: u32 = 16000;
/// Re-runs a request the model declines on Anthropic's recommended fallback model.
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
const CREDENTIAL: &str = "DeskCompanion/anthropic-api-key";
/// Earlier turns sent with each question, oldest dropped first.
const MAX_HISTORY: usize = 12;

/// Who the assistant is, by character. The rest of the prompt is shared.
fn persona(character: &str) -> &'static str {
    match character {
        "hexo" => "You are Hexo, a small hex-nut repair buddy with a glowing screen for a face. You love fixing things.",
        "glim" => "You are Glim, a small firefly whose glowing orb lights the way to answers. You are gentle and calm.",
        "billu" => "You are Billu, a curious ginger cat who flies a little saucer. You are playful but focused, and land every answer neatly.",
        "rui" => "You are Rui, a small cuddly yeti in a cosy hood. You are cheerful and gentle, and explain things simply.",
        _ => "You are Kulhi, a small chai-cup character. You are warm and patient, and never panic.",
    }
}

fn system_prompt(character: &str) -> String {
    format!("{}\n\n{RULES}", persona(character))
}

const RULES: &str = "You live in the corner of the user's \
Windows desktop and help them with their computer and devices: settings, Wi-Fi and Bluetooth, \
printers, displays, sound, battery and power, storage, updates, apps, accounts, files, keyboard \
shortcuts, phones and accessories connected to the PC.

How to answer:
- Be warm and brief. Lead with the fix. Use short numbered steps with the exact menu path \
(for example: Settings > System > Display), naming buttons as they appear on screen.
- Fit the answer to the device details you are given (Windows version, model, battery, free space). \
Don't repeat those details back unless they matter to the answer.
- Reply in the language the user writes in, including Hindi or Hinglish.
- Before any step that can lose data or is hard to undo (resetting, deleting, registry edits, \
disk tools), say so plainly and suggest a safer option first.
- Never ask for passwords, codes or personal data.

Choose `kind`:
- \"answer\": you understood and can help. `confidence` is how sure you are the steps will solve it (0 to 1).
- \"suggestions\": the question could mean a few different things. Put 2 to 4 short, specific \
rephrasings the user can pick from in `suggestions`, and a one-line note in `answer`.
- \"unclear\": you couldn't tell what they need. In `answer`, ask one short question to narrow it down.
- \"off_topic\": not about their computer or devices. Answer briefly and kindly if you can, and \
mention what you're best at.
Leave `suggestions` empty unless `kind` is \"suggestions\".";

#[derive(Clone, Debug, Deserialize)]
pub struct Turn {
    role: String,
    text: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Answer {
    kind: String,
    confidence: f64,
    answer: String,
    suggestions: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskError {
    /// no_key | auth | rate_limit | overloaded | network | refused | api
    kind: &'static str,
    message: String,
}

impl AskError {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        AskError { kind, message: message.into() }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    has_key: bool,
    model: &'static str,
    /// The device summary sent with each question, shown to the user.
    device: String,
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn assistant_status() -> Result<Status, String> {
    Ok(Status { has_key: credential::read().is_some(), model: MODEL, device: device_summary() })
}

#[tauri::command]
pub async fn assistant_set_key(key: String) -> Result<(), String> {
    let key = key.trim();
    if !key.starts_with("sk-ant-") || key.len() < 20 || key.chars().any(char::is_whitespace) {
        return Err("That doesn't look like an Anthropic API key (they start with sk-ant-).".into());
    }
    credential::write(key).map_err(|e| format!("Couldn't save the key: {e}"))
}

#[tauri::command]
pub async fn assistant_forget_key() -> Result<(), String> {
    credential::delete();
    Ok(())
}

#[tauri::command]
pub async fn assistant_ask(app: tauri::AppHandle, question: String, history: Vec<Turn>, character: String) -> Result<Answer, AskError> {
    let prefs = crate::system::current(&app);
    if !prefs.ask_enabled {
        return Err(AskError::new("api", "Ask is turned off in Settings."));
    }
    let key = credential::read().ok_or_else(|| AskError::new("no_key", "Add your Anthropic API key first."))?;
    let question = question.trim();
    if question.is_empty() {
        return Err(AskError::new("api", "Empty question."));
    }

    let mut messages: Vec<Value> = history
        .iter()
        .rev()
        .take(MAX_HISTORY)
        .rev()
        .filter(|t| (t.role == "user" || t.role == "assistant") && !t.text.trim().is_empty())
        .map(|t| json!({ "role": t.role, "content": t.text }))
        .collect();
    // The conversation must start with the user.
    while messages.first().is_some_and(|m| m["role"] != "user") {
        messages.remove(0);
    }
    // Device details ride with the newest question, so the cached prefix stays
    // stable; only when the user lets them (Settings).
    let content = if prefs.share_device {
        format!("<device>\n{}\n</device>\n\n{question}", device_summary())
    } else {
        question.to_string()
    };
    messages.push(json!({ "role": "user", "content": content }));

    let body = json!({
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "fallbacks": "default",
        "system": [{ "type": "text", "text": system_prompt(&character), "cache_control": { "type": "ephemeral" } }],
        "output_config": {
            "effort": EFFORT,
            "format": { "type": "json_schema", "schema": answer_schema() },
        },
        "messages": messages,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| AskError::new("network", e.to_string()))?;
    let res = client
        .post(API_URL)
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-beta", FALLBACK_BETA)
        .json(&body)
        .send()
        .await
        .map_err(|e| AskError::new("network", format!("Couldn't reach Anthropic: {e}")))?;

    let status = res.status().as_u16();
    let payload: Value = res.json().await.map_err(|e| AskError::new("api", format!("Unreadable response: {e}")))?;
    if status != 200 {
        let message = payload.pointer("/error/message").and_then(Value::as_str).unwrap_or("Request failed").to_string();
        let kind = match status {
            401 | 403 => "auth",
            429 => "rate_limit",
            529 | 503 => "overloaded",
            _ => "api",
        };
        return Err(AskError::new(kind, message));
    }
    if payload["stop_reason"] == "refusal" {
        return Err(AskError::new("refused", "I can't help with that one."));
    }
    if payload["stop_reason"] == "max_tokens" {
        return Err(AskError::new("api", "The answer got cut off. Try asking something narrower."));
    }

    // The JSON answer is the last text block (thinking and fallback blocks come before it).
    let text = payload["content"]
        .as_array()
        .and_then(|blocks| blocks.iter().rev().find(|b| b["type"] == "text"))
        .and_then(|b| b["text"].as_str())
        .ok_or_else(|| AskError::new("api", "No answer in the response."))?;
    let mut answer: Answer =
        serde_json::from_str(text).map_err(|e| AskError::new("api", format!("Unexpected answer format: {e}")))?;
    answer.confidence = answer.confidence.clamp(0.0, 1.0);
    answer.suggestions.truncate(4);
    Ok(answer)
}

fn answer_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "kind": { "type": "string", "enum": ["answer", "suggestions", "unclear", "off_topic"] },
            "confidence": { "type": "number" },
            "answer": { "type": "string" },
            "suggestions": { "type": "array", "items": { "type": "string" } },
        },
        "required": ["kind", "confidence", "answer", "suggestions"],
        "additionalProperties": false,
    })
}

// ── Device summary ────────────────────────────────────────────────────────────

/// A few lines describing this PC. Nothing personal: no names, files or accounts.
pub fn device_summary() -> String {
    let mut lines = Vec::new();
    if let Some(os) = device::os() {
        lines.push(format!("OS: {os}"));
    }
    if let Some(model) = device::model() {
        lines.push(format!("Device: {model}"));
    }
    if let Some(cpu) = device::cpu() {
        lines.push(format!("CPU: {cpu}"));
    }
    if let Some((total, avail)) = device::memory() {
        lines.push(format!("Memory: {} GB ({} GB free)", gb(total), gb(avail)));
    }
    if let Some((total, free)) = device::system_disk() {
        lines.push(format!("System drive: {} GB free of {} GB", gb(free), gb(total)));
    }
    match crate::system::battery_now() {
        Some((percent, plugged)) => {
            lines.push(format!("Battery: {percent}%{}", if plugged { ", plugged in" } else { ", on battery" }))
        }
        None => lines.push("Battery: none (desktop PC or unknown)".into()),
    }
    lines.join("\n")
}

fn gb(bytes: u64) -> String {
    let v = bytes as f64 / 1_073_741_824.0;
    if v >= 10.0 { format!("{v:.0}") } else { format!("{v:.1}") }
}

#[cfg(windows)]
mod device {
    use std::ffi::c_void;

    const HKLM: isize = 0x8000_0002u32 as i32 as isize;
    const RRF_RT_REG_SZ: u32 = 0x0000_0002;

    #[repr(C)]
    struct MemoryStatusEx {
        length: u32,
        memory_load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn RegGetValueW(
            hkey: isize,
            sub_key: *const u16,
            value: *const u16,
            flags: u32,
            kind: *mut u32,
            data: *mut c_void,
            data_len: *mut u32,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
        fn GetDiskFreeSpaceExW(dir: *const u16, avail: *mut u64, total: *mut u64, free: *mut u64) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn reg_string(sub_key: &str, value: &str) -> Option<String> {
        let (k, v) = (wide(sub_key), wide(value));
        let mut buf = vec![0u16; 512];
        let mut len = (buf.len() * 2) as u32;
        // SAFETY: buffers are valid and `len` is their size in bytes.
        let rc = unsafe {
            RegGetValueW(HKLM, k.as_ptr(), v.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut len)
        };
        if rc != 0 {
            return None;
        }
        let chars = (len as usize / 2).saturating_sub(1);
        let s = String::from_utf16_lossy(&buf[..chars.min(buf.len())]).trim().to_string();
        (!s.is_empty()).then_some(s)
    }

    pub fn os() -> Option<String> {
        const KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
        let build: u32 = reg_string(KEY, "CurrentBuild")?.parse().ok()?;
        let edition = reg_string(KEY, "EditionID").unwrap_or_default();
        // ProductName still says "Windows 10" on Windows 11; the build number tells them apart.
        let name = if build >= 22000 { "Windows 11" } else { "Windows 10" };
        let version = reg_string(KEY, "DisplayVersion").map(|v| format!(" {v}")).unwrap_or_default();
        let edition = if edition.is_empty() { String::new() } else { format!(" {edition}") };
        Some(format!("{name}{edition}{version} (build {build})"))
    }

    pub fn model() -> Option<String> {
        const KEY: &str = r"HARDWARE\DESCRIPTION\System\BIOS";
        let maker = reg_string(KEY, "SystemManufacturer").unwrap_or_default();
        let product = reg_string(KEY, "SystemProductName").unwrap_or_default();
        let placeholder = |s: &str| s.is_empty() || s.to_ascii_lowercase().contains("to be filled");
        match (placeholder(&maker), placeholder(&product)) {
            (true, true) => None,
            (true, false) => Some(product),
            (false, true) => Some(maker),
            (false, false) => Some(format!("{maker} {product}")),
        }
    }

    pub fn cpu() -> Option<String> {
        reg_string(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString")
    }

    pub fn memory() -> Option<(u64, u64)> {
        let mut m = MemoryStatusEx {
            length: std::mem::size_of::<MemoryStatusEx>() as u32,
            memory_load: 0,
            total_phys: 0,
            avail_phys: 0,
            total_page_file: 0,
            avail_page_file: 0,
            total_virtual: 0,
            avail_virtual: 0,
            avail_extended_virtual: 0,
        };
        // SAFETY: correctly sized out-parameter.
        (unsafe { GlobalMemoryStatusEx(&mut m) } != 0).then_some((m.total_phys, m.avail_phys))
    }

    pub fn system_disk() -> Option<(u64, u64)> {
        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        let root = wide(&format!("{drive}\\"));
        let (mut avail, mut total, mut free) = (0u64, 0u64, 0u64);
        // SAFETY: valid path and out-parameters.
        let ok = unsafe { GetDiskFreeSpaceExW(root.as_ptr(), &mut avail, &mut total, &mut free) } != 0;
        ok.then_some((total, avail))
    }
}

#[cfg(not(windows))]
mod device {
    pub fn os() -> Option<String> {
        Some(std::env::consts::OS.to_string())
    }
    pub fn model() -> Option<String> {
        None
    }
    pub fn cpu() -> Option<String> {
        None
    }
    pub fn memory() -> Option<(u64, u64)> {
        None
    }
    pub fn system_disk() -> Option<(u64, u64)> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_summary_has_no_blank_lines_and_reads_this_machine() {
        let s = device_summary();
        println!("{s}");
        assert!(s.lines().all(|l| l.contains(": ")), "{s}");
        assert!(s.contains("Battery:"));
    }

    #[test]
    fn answer_schema_is_strict() {
        let s = answer_schema();
        assert_eq!(s["additionalProperties"], false);
        assert_eq!(s["required"].as_array().unwrap().len(), 4);
    }
}

// ── Windows Credential Manager ────────────────────────────────────────────────

#[cfg(windows)]
mod credential {
    use std::ffi::c_void;

    use super::CREDENTIAL;

    const CRED_TYPE_GENERIC: u32 = 1;
    const CRED_PERSIST_LOCAL_MACHINE: u32 = 2;

    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    #[repr(C)]
    struct CredentialW {
        flags: u32,
        kind: u32,
        target_name: *mut u16,
        comment: *mut u16,
        last_written: FileTime,
        blob_size: u32,
        blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut c_void,
        target_alias: *mut u16,
        user_name: *mut u16,
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn CredWriteW(credential: *const CredentialW, flags: u32) -> i32;
        fn CredReadW(target: *const u16, kind: u32, flags: u32, credential: *mut *mut CredentialW) -> i32;
        fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
        fn CredFree(buffer: *mut c_void);
    }

    fn target() -> Vec<u16> {
        CREDENTIAL.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn write(secret: &str) -> std::io::Result<()> {
        let mut name = target();
        let mut user: Vec<u16> = "api-key".encode_utf16().chain(std::iter::once(0)).collect();
        let mut blob = secret.as_bytes().to_vec();
        let cred = CredentialW {
            flags: 0,
            kind: CRED_TYPE_GENERIC,
            target_name: name.as_mut_ptr(),
            comment: std::ptr::null_mut(),
            last_written: FileTime { low: 0, high: 0 },
            blob_size: blob.len() as u32,
            blob: blob.as_mut_ptr(),
            persist: CRED_PERSIST_LOCAL_MACHINE,
            attribute_count: 0,
            attributes: std::ptr::null_mut(),
            target_alias: std::ptr::null_mut(),
            user_name: user.as_mut_ptr(),
        };
        // SAFETY: every pointer refers to a live buffer for the duration of the call.
        if unsafe { CredWriteW(&cred, 0) } != 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }

    pub fn read() -> Option<String> {
        let name = target();
        let mut out: *mut CredentialW = std::ptr::null_mut();
        // SAFETY: on success Windows hands us a buffer we must release with CredFree.
        if unsafe { CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut out) } == 0 || out.is_null() {
            return None;
        }
        let secret = unsafe {
            let c = &*out;
            let bytes = std::slice::from_raw_parts(c.blob, c.blob_size as usize);
            let s = String::from_utf8(bytes.to_vec()).ok();
            CredFree(out.cast());
            s
        };
        secret.filter(|s| !s.is_empty())
    }

    pub fn delete() {
        let name = target();
        // SAFETY: plain call with a valid, NUL-terminated name.
        unsafe { CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0) };
    }
}

#[cfg(not(windows))]
mod credential {
    pub fn write(_secret: &str) -> std::io::Result<()> {
        Err(std::io::Error::other("secret storage comes with the macOS/Linux port"))
    }
    pub fn read() -> Option<String> {
        None
    }
    pub fn delete() {}
}
