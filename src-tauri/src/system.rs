// What the computer is doing, for the companion side of the character:
// whether the user is at the keyboard, the battery, and finished downloads.
//
// A background poll (every 2 s) turns readings into edge-triggered "system"
// events for the companion window; the page decides what the character does
// (src/desktop/companion.ts). Reads Windows directly, no extra crates.
//
// Preferences (which of these the user wants) live in prefs.json next to the
// saved spot, and are toggled from the tray.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::desktop;

const POLL: Duration = Duration::from_secs(2);
/// No input for this long counts as a break / being away.
const IDLE_SECS: u64 = 180;
const BATTERY_LOW: u8 = 20;
const BATTERY_CRITICAL: u8 = 10;
/// Partial-download suffixes used by browsers; the final name appears when done.
const PARTIAL: &[&str] = &[".crdownload", ".part", ".partial", ".download", ".tmp", ".opdownload"];

// ── Preferences ───────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    pub breaks: bool,
    /// Minutes at the keyboard before a break reminder.
    pub break_minutes: u32,
    pub battery: bool,
    pub downloads: bool,
    pub welcome: bool,
    /// Step aside while a full-screen app (game, video, slideshow) is on the character's display.
    pub hide_fullscreen: bool,
    /// "small" | "medium" | "large"
    pub size: String,
    /// "kulhi" | "hexo" | "glim" | "billu" | "rui" (3D)
    pub character: String,
    /// "corner" (anywhere on the desktop) | "top" (an island at the top edge)
    pub place: String,
    /// Notifications paused until this time (ms since 1970); 0 not paused, −1 until turned back on.
    /// Permission requests still show: an agent is waiting on them.
    pub quiet_until: i64,
    /// Which coding-agent moments get a notification.
    pub notify_done: bool,
    pub notify_permission: bool,
    pub notify_waiting: bool,
    pub notify_errors: bool,
    /// Allow / Deny from the companion. Off: requests go straight to the terminal.
    pub answer_permissions: bool,
    /// The Ask tab (questions about the PC, answered by Claude).
    pub ask_enabled: bool,
    /// Send the short device summary with each question.
    pub share_device: bool,
    /// Look for new versions in the background (installing always needs a click).
    pub auto_update: bool,
    /// Soft chimes for finished tasks, requests and errors.
    pub sounds: bool,
    /// How Rui is drawn: "toy" (soft vinyl) | "anime" (cel shading and outlines).
    pub rui_look: String,
    /// Rui's colour theme (see RUI_THEMES).
    pub rui_theme: String,
    /// While on battery power, show a 2D character instead of Rui (3D).
    pub rui_flat_on_battery: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            breaks: true,
            break_minutes: 50,
            battery: true,
            downloads: true,
            welcome: true,
            hide_fullscreen: true,
            size: "medium".into(),
            character: "kulhi".into(),
            place: "corner".into(),
            quiet_until: 0,
            notify_done: true,
            notify_permission: true,
            notify_waiting: true,
            notify_errors: true,
            answer_permissions: true,
            ask_enabled: true,
            share_device: true,
            auto_update: true,
            sounds: false,
            rui_look: "toy".into(),
            rui_theme: "cream".into(),
            rui_flat_on_battery: false,
        }
    }
}

pub const SIZES: &[&str] = &["small", "medium", "large"];
pub const CHARACTERS: &[&str] = &["kulhi", "hexo", "glim", "billu", "rui"];
pub const PLACES: &[&str] = &["corner", "top"];
pub const RUI_LOOKS: &[&str] = &["toy", "anime"];
pub const RUI_THEMES: &[&str] = &["cream", "mint", "sky", "lavender", "peach", "panda"];
/// Break reminder interval limits, minutes.
const BREAK_MINUTES: (u32, u32) = (15, 180);

impl Prefs {
    /// Only known values: anything else is refused, not saved.
    fn check(&self) -> Result<(), String> {
        if !SIZES.contains(&self.size.as_str()) {
            return Err(format!("unknown size {:?}", self.size));
        }
        if !CHARACTERS.contains(&self.character.as_str()) {
            return Err(format!("unknown character {:?}", self.character));
        }
        if !PLACES.contains(&self.place.as_str()) {
            return Err(format!("unknown place {:?}", self.place));
        }
        if !RUI_LOOKS.contains(&self.rui_look.as_str()) {
            return Err(format!("unknown look {:?}", self.rui_look));
        }
        if !RUI_THEMES.contains(&self.rui_theme.as_str()) {
            return Err(format!("unknown colour {:?}", self.rui_theme));
        }
        if !(BREAK_MINUTES.0..=BREAK_MINUTES.1).contains(&self.break_minutes) {
            return Err(format!("break interval must be {}–{} minutes", BREAK_MINUTES.0, BREAK_MINUTES.1));
        }
        Ok(())
    }

    /// The same prefs with one setting (by its camelCase name) changed. The
    /// new value must have the same JSON type as the old one.
    fn with(&self, key: &str, value: &Value) -> Result<Prefs, String> {
        let mut obj = serde_json::to_value(self).map_err(|e| e.to_string())?;
        let slot = obj.get_mut(key).ok_or_else(|| format!("unknown setting {key:?}"))?;
        let same_type = matches!(
            (&*slot, value),
            (Value::Bool(_), Value::Bool(_)) | (Value::Number(_), Value::Number(_)) | (Value::String(_), Value::String(_))
        );
        if !same_type {
            return Err(format!("wrong kind of value for {key:?}"));
        }
        *slot = value.clone();
        let next: Prefs = serde_json::from_value(obj).map_err(|e| e.to_string())?;
        next.check()?;
        Ok(next)
    }

    /// A switch by its camelCase name (the tray reads its check marks this way).
    pub fn flag(&self, key: &str) -> Option<bool> {
        serde_json::to_value(self).ok()?.get(key)?.as_bool()
    }
}

#[derive(Default)]
pub struct PrefsState(pub Mutex<Prefs>);

pub fn current(app: &AppHandle) -> Prefs {
    app.state::<PrefsState>().0.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Changes one setting (from the Settings tab or the tray), saves it, applies
/// it, and tells every window and the tray menu.
pub fn update(app: &AppHandle, key: &str, value: &Value) -> Result<Prefs, String> {
    let state = app.state::<PrefsState>();
    let mut prefs = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let before = prefs.clone();
    let next = before.with(key, value)?;
    *prefs = next.clone();
    save_prefs(app, &next);
    drop(prefs);

    if next.size != before.size {
        desktop::resize(app, desktop::side_for(&next.size));
    }
    if next.place != before.place {
        desktop::set_place(app, next.place == "top");
    }
    if before.hide_fullscreen && !next.hide_fullscreen {
        desktop::set_hidden(app, false);
    }
    broadcast(app);
    Ok(next)
}

/// Tells every window the settings (may have) changed, and re-ticks the tray.
pub fn broadcast(app: &AppHandle) {
    let _ = app.emit("prefs", current(app));
    crate::tray::sync(app);
}

/// Flips a switch (tray menu). Returns the new value.
pub fn toggle(app: &AppHandle, key: &str) -> Option<bool> {
    let now = current(app).flag(key)?;
    update(app, key, &Value::Bool(!now)).ok().map(|p| p.flag(key).unwrap_or(!now))
}

fn prefs_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("prefs.json"))
}

pub fn load_prefs(app: &AppHandle) -> Prefs {
    prefs_file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<Prefs>(&t).ok())
        .filter(|p| p.check().is_ok())
        .unwrap_or_default()
}

fn save_prefs(app: &AppHandle, prefs: &Prefs) {
    let Some(path) = prefs_file(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string_pretty(prefs) {
        let _ = std::fs::write(path, text);
    }
}

#[tauri::command]
pub async fn get_prefs(prefs: State<'_, PrefsState>) -> Result<Prefs, String> {
    Ok(prefs.0.lock().unwrap_or_else(|e| e.into_inner()).clone())
}

/// Everything the Settings tab shows: the prefs, plus the switches whose real
/// state lives outside the app.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    prefs: Prefs,
    claude_connected: bool,
    agents: Vec<crate::setup::AgentStatus>,
    autostart: bool,
    version: String,
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<Settings, String> {
    Ok(Settings {
        prefs: current(&app),
        claude_connected: crate::setup::claude_connected(),
        agents: crate::setup::agents_status(),
        autostart: crate::setup::autostart_enabled(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
pub async fn set_setting(app: AppHandle, key: String, value: Value) -> Result<Prefs, String> {
    update(&app, &key, &value)
}

/// Connects or disconnects a coding agent; returns what happened, in words.
#[tauri::command]
pub async fn set_agent_connected(app: AppHandle, agent: String, on: bool) -> Result<String, String> {
    let result = crate::setup::set_agent(&app, &agent, on);
    broadcast(&app);
    result
}

#[tauri::command]
pub async fn set_autostart(app: AppHandle, on: bool) -> Result<(), String> {
    let result = crate::setup::set_autostart(on).map_err(|e| format!("Couldn't change that: {e}"));
    broadcast(&app);
    result
}

// ── Events ────────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum SystemEvent {
    /// No input for IDLE_SECS.
    Idle,
    /// Input again after being idle; `idle_secs` is how long the user was gone.
    Active { idle_secs: u64 },
    BatteryLow { percent: u8, critical: bool },
    PluggedIn { percent: u8 },
    Unplugged { percent: u8 },
    BatteryFull,
    Download { name: String, count: usize },
}

/// Running on battery power right now (a laptop unplugged).
static ON_BATTERY: AtomicBool = AtomicBool::new(false);

/// For trying the battery behaviour on a PC without one: DESK_COMPANION_FAKE_BATTERY=1.
fn fake_battery() -> bool {
    std::env::var_os("DESK_COMPANION_FAKE_BATTERY").is_some_and(|v| v == "1")
}

fn read_on_battery() -> bool {
    fake_battery() || win::battery().is_some_and(|b| !b.plugged)
}

/// Whether the PC runs on battery now (Rui draws less often then). Read
/// fresh: the page may ask before the poll below has taken its first reading.
#[tauri::command]
pub async fn on_battery() -> Result<bool, String> {
    Ok(read_on_battery())
}

pub fn spawn(app: AppHandle) {
    ON_BATTERY.store(read_on_battery(), Ordering::Relaxed);
    std::thread::spawn(move || {
        let mut presence = Presence::default();
        let mut power = Power::default();
        let mut downloads = app.path().download_dir().ok().map(Downloads::new);
        loop {
            let prefs = app.state::<PrefsState>().0.lock().map(|p| p.clone()).unwrap_or_default();
            let mut out = Vec::new();
            presence.poll(&mut out);
            if prefs.battery {
                power.poll(&mut out);
            }
            if prefs.downloads {
                if let Some(d) = downloads.as_mut() {
                    d.poll(&mut out);
                }
            }
            for ev in out {
                let _ = app.emit_to(desktop::LABEL, "system", ev);
            }
            // Plugged in or not, whatever the battery notifications are set to.
            let unplugged = read_on_battery();
            if ON_BATTERY.swap(unplugged, Ordering::Relaxed) != unplugged {
                let _ = app.emit_to(desktop::LABEL, "power", unplugged);
            }
            if prefs.hide_fullscreen {
                let covered = desktop::character_center(&app)
                    .is_some_and(|c| win::fullscreen_display().is_some_and(|r| r.contains(c)));
                desktop::set_hidden(&app, covered);
            }
            std::thread::sleep(POLL);
        }
    });
}

// ── Presence ──────────────────────────────────────────────────────────────────

#[derive(Default)]
struct Presence {
    idle: bool,
    longest: u64,
}

impl Presence {
    fn poll(&mut self, out: &mut Vec<SystemEvent>) {
        let Some(secs) = win::idle_secs() else { return };
        if !self.idle && secs >= IDLE_SECS {
            self.idle = true;
            out.push(SystemEvent::Idle);
        }
        if self.idle {
            if secs >= self.longest {
                self.longest = secs;
            } else {
                // Input happened: the idle counter restarted.
                out.push(SystemEvent::Active { idle_secs: self.longest });
                self.idle = false;
                self.longest = 0;
            }
        }
    }
}

// ── Power ─────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct Power {
    last: Option<win::Battery>,
    /// Lowest threshold already announced on this discharge (so each fires once).
    warned: Option<u8>,
    full_announced: bool,
}

impl Power {
    fn poll(&mut self, out: &mut Vec<SystemEvent>) {
        let Some(now) = win::battery() else { return }; // desktop PC, or unknown
        if let Some(prev) = self.last {
            if now.plugged && !prev.plugged {
                out.push(SystemEvent::PluggedIn { percent: now.percent });
                self.warned = None;
            } else if !now.plugged && prev.plugged {
                out.push(SystemEvent::Unplugged { percent: now.percent });
                self.full_announced = false;
            }
        }
        if !now.plugged {
            for level in [BATTERY_LOW, BATTERY_CRITICAL] {
                if now.percent <= level && self.warned.is_none_or(|w| level < w) {
                    self.warned = Some(level);
                    out.push(SystemEvent::BatteryLow { percent: now.percent, critical: level == BATTERY_CRITICAL });
                }
            }
        } else if now.percent >= 100 && !self.full_announced && self.last.is_some() {
            self.full_announced = true;
            out.push(SystemEvent::BatteryFull);
        }
        if now.percent >= 100 {
            self.full_announced = true;
        }
        self.last = Some(now);
    }
}

// ── Downloads ─────────────────────────────────────────────────────────────────

struct Downloads {
    dir: PathBuf,
    /// Names seen so far (existing files never announce).
    known: HashSet<String>,
    /// New files waiting to stop growing: name → (size, polls stable).
    pending: HashMap<String, (u64, u8)>,
    modified: Option<SystemTime>,
}

impl Downloads {
    fn new(dir: PathBuf) -> Self {
        let known = list(&dir).into_iter().map(|(n, _)| n).collect();
        let modified = dir_modified(&dir);
        Downloads { dir, known, pending: HashMap::new(), modified }
    }

    fn poll(&mut self, out: &mut Vec<SystemEvent>) {
        // Rescan only when the folder changed or something is still settling.
        let modified = dir_modified(&self.dir);
        if modified == self.modified && self.pending.is_empty() {
            return;
        }
        self.modified = modified;

        let entries = list(&self.dir);
        let names: HashSet<&str> = entries.iter().map(|(n, _)| n.as_str()).collect();
        for (name, size) in &entries {
            if self.known.contains(name) || is_partial(name) {
                continue;
            }
            self.pending.entry(name.clone()).or_insert((*size, 0));
        }

        let mut finished = Vec::new();
        self.pending.retain(|name, (size, stable)| {
            let Some((_, now)) = entries.iter().find(|(n, _)| n == name) else { return false };
            let still_writing = PARTIAL.iter().any(|ext| names.contains(format!("{name}{ext}").as_str()));
            if *now != *size || *now == 0 || still_writing {
                *size = *now;
                *stable = 0;
                return true;
            }
            *stable += 1;
            if *stable >= 2 {
                finished.push(name.clone());
                return false;
            }
            true
        });
        for name in &finished {
            self.known.insert(name.clone());
        }
        // Forget files that were deleted, so a re-download announces again.
        self.known.retain(|n| names.contains(n.as_str()));

        if let Some(name) = finished.first() {
            out.push(SystemEvent::Download { name: name.clone(), count: finished.len() });
        }
    }
}

fn is_partial(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    name.starts_with('.') || name.starts_with('~') || lower == "desktop.ini" || PARTIAL.iter().any(|e| lower.ends_with(e))
}

fn list(dir: &Path) -> Vec<(String, u64)> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    rd.flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            meta.is_file().then(|| (e.file_name().to_string_lossy().into_owned(), meta.len()))
        })
        .collect()
}

fn dir_modified(dir: &Path) -> Option<SystemTime> {
    std::fs::metadata(dir).and_then(|m| m.modified()).ok()
}

/// Battery percent and whether it's plugged in, or None without a battery.
pub fn battery_now() -> Option<(u8, bool)> {
    win::battery().map(|b| (b.percent, b.plugged))
}

// ── Windows readings ──────────────────────────────────────────────────────────

#[cfg(windows)]
mod win {
    #[repr(C)]
    struct LastInputInfo {
        cb_size: u32,
        dw_time: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct SystemPowerStatus {
        ac_line_status: u8,
        battery_flag: u8,
        battery_life_percent: u8,
        system_status_flag: u8,
        battery_life_time: u32,
        battery_full_life_time: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct MonitorInfo {
        cb_size: u32,
        monitor: Rect,
        work: Rect,
        flags: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
        fn GetForegroundWindow() -> isize;
        fn GetWindowRect(hwnd: isize, rect: *mut Rect) -> i32;
        fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
        fn GetClassNameW(hwnd: isize, name: *mut u16, max: i32) -> i32;
        fn MonitorFromWindow(hwnd: isize, flags: u32) -> isize;
        fn GetMonitorInfoW(monitor: isize, info: *mut MonitorInfo) -> i32;
    }

    /// A display rectangle, physical px.
    pub struct Display {
        left: f64,
        top: f64,
        right: f64,
        bottom: f64,
    }

    impl Display {
        pub fn contains(&self, p: (f64, f64)) -> bool {
            p.0 >= self.left && p.0 < self.right && p.1 >= self.top && p.1 < self.bottom
        }
    }

    /// The display a full-screen app is covering right now, if any: the
    /// foreground window fills its whole monitor, taskbar included. Maximised
    /// windows stop at the taskbar, so they don't count; neither do the
    /// desktop, the taskbar, or our own windows.
    pub fn fullscreen_display() -> Option<Display> {
        // SAFETY: plain Win32 queries with valid out-parameters.
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd == 0 {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == std::process::id() {
                return None;
            }
            let mut class = [0u16; 64];
            let n = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32).max(0) as usize;
            let class = String::from_utf16_lossy(&class[..n]);
            if matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
                return None;
            }
            let mut r = Rect::default();
            if GetWindowRect(hwnd, &mut r) == 0 {
                return None;
            }
            let monitor = MonitorFromWindow(hwnd, 2 /* MONITOR_DEFAULTTONEAREST */);
            let mut info = MonitorInfo {
                cb_size: std::mem::size_of::<MonitorInfo>() as u32,
                monitor: Rect::default(),
                work: Rect::default(),
                flags: 0,
            };
            if monitor == 0 || GetMonitorInfoW(monitor, &mut info) == 0 {
                return None;
            }
            let m = info.monitor;
            let covers = r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom;
            covers.then(|| Display {
                left: m.left as f64,
                top: m.top as f64,
                right: m.right as f64,
                bottom: m.bottom as f64,
            })
        }
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount() -> u32;
        fn GetSystemPowerStatus(status: *mut SystemPowerStatus) -> i32;
    }

    /// Seconds since the last keyboard or mouse input, system-wide.
    pub fn idle_secs() -> Option<u64> {
        let mut info = LastInputInfo { cb_size: std::mem::size_of::<LastInputInfo>() as u32, dw_time: 0 };
        // SAFETY: plain out-parameter call with a correctly sized struct.
        let ok = unsafe { GetLastInputInfo(&mut info) } != 0;
        if !ok {
            return None;
        }
        let now = unsafe { GetTickCount() };
        Some(u64::from(now.wrapping_sub(info.dw_time)) / 1000)
    }

    #[derive(Clone, Copy, Debug)]
    pub struct Battery {
        pub percent: u8,
        pub plugged: bool,
    }

    /// None on machines without a battery, or when Windows doesn't know.
    pub fn battery() -> Option<Battery> {
        let mut s = SystemPowerStatus::default();
        // SAFETY: plain out-parameter call with a correctly sized struct.
        if unsafe { GetSystemPowerStatus(&mut s) } == 0 {
            return None;
        }
        let no_battery = s.battery_flag == 128 || s.battery_flag == 255 || s.battery_life_percent == 255;
        if no_battery {
            return None;
        }
        Some(Battery { percent: s.battery_life_percent.min(100), plugged: s.ac_line_status == 1 })
    }
}

#[cfg(not(windows))]
mod win {
    pub struct Display;
    impl Display {
        pub fn contains(&self, _p: (f64, f64)) -> bool {
            false
        }
    }
    pub fn fullscreen_display() -> Option<Display> {
        None
    }
    #[derive(Clone, Copy, Debug)]
    pub struct Battery {
        pub percent: u8,
        pub plugged: bool,
    }
    pub fn idle_secs() -> Option<u64> {
        None
    }
    pub fn battery() -> Option<Battery> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_setting_changes_by_name() {
        let p = Prefs::default();
        let next = p.with("notifyDone", &json!(false)).unwrap();
        assert!(!next.notify_done);
        assert_eq!(next.with("breakMinutes", &json!(30)).unwrap().break_minutes, 30);
        assert_eq!(p.with("character", &json!("billu")).unwrap().character, "billu");
        assert_eq!(p.with("character", &json!("rui")).unwrap().character, "rui");
        assert_eq!(p.with("quietUntil", &json!(-1)).unwrap().quiet_until, -1);
        assert_eq!(p.with("ruiLook", &json!("anime")).unwrap().rui_look, "anime");
        assert_eq!(p.with("ruiTheme", &json!("panda")).unwrap().rui_theme, "panda");
    }

    #[test]
    fn unknown_names_wrong_kinds_and_bad_values_are_refused() {
        let p = Prefs::default();
        assert!(p.with("noSuchThing", &json!(true)).is_err());
        assert!(p.with("notifyDone", &json!("yes")).is_err());
        assert!(p.with("character", &json!("dragon")).is_err());
        assert!(p.with("place", &json!(1)).is_err());
        assert!(p.with("breakMinutes", &json!(2)).is_err());
        assert!(p.with("breakMinutes", &json!(-5)).is_err());
        assert!(p.with("ruiLook", &json!("clay")).is_err());
        assert!(p.with("ruiTheme", &json!("tartan")).is_err());
        assert!(p.with("ruiTheme", &json!(3)).is_err());
    }

    #[test]
    fn old_prefs_files_get_the_new_settings_switched_on() {
        let old: Prefs = serde_json::from_str(r#"{"breaks":false,"size":"large","character":"glim"}"#).unwrap();
        assert!(!old.breaks);
        assert!(old.answer_permissions && old.notify_permission && old.ask_enabled && old.share_device);
        assert_eq!(old.break_minutes, 50);
        assert_eq!((old.rui_look.as_str(), old.rui_theme.as_str()), ("toy", "cream"));
        assert!(!old.rui_flat_on_battery);
        assert_eq!(old.flag("breaks"), Some(false));
        assert_eq!(old.flag("size"), None);
    }
}
