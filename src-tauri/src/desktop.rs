// The character's window: a small transparent square that floats above other
// windows, wherever the user put it. Or, in top mode, a wider strip at the top
// edge of the screen where the character lives in a little island, the way
// coucou does on Windows: tucked away when nothing is going on, sliding out
// when the user hovers the edge or an agent is busy (src/desktop/island.ts).
//
// A background poll (≈20 Hz idle, ≈120 Hz while moving) does three jobs:
//   * click-through: the window ignores the mouse except over the character's
//     body, so the transparent margin never blocks what's underneath;
//   * gaze: it reports the cursor, in window-local logical px, as "cursor";
//   * motion: it carries the window during a drag and plays position tweens
//     (settling after a drop, little hops while pottering about).
//
// Locking rule: never hold `Desk.inner` while calling a window method. Window
// calls from this thread wait on the main thread, which may be waiting on the
// lock inside a command — that would deadlock.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub const LABEL: &str = "companion";
/// The speech bubble's own small window, beside the character.
pub const BUBBLE_LABEL: &str = "bubble";

/// The activity panel: sessions, what they did, what they're asking.
pub const PANEL_LABEL: &str = "panel";

/// The Desk Companion window: a normal window with every page (app.html).
pub const HOME_LABEL: &str = "home";

/// Bubble window size, logical px. The card inside is usually smaller; the
/// rest is transparent and click-through.
const BUBBLE_W: f64 = 340.0;
const BUBBLE_H: f64 = 330.0;
/// Panel window size, logical px.
const PANEL_W: f64 = 380.0;
const PANEL_H: f64 = 540.0;
/// Top mode: the panel is the island grown big, as wide as this and as tall as
/// its content (between the two limits), logical px.
const PANEL_TOP_W: f64 = 640.0;
const PANEL_TOP_MIN_H: f64 = 160.0;
const PANEL_TOP_MAX_H: f64 = 620.0;
/// Its last measured height.
static PANEL_TOP_H: AtomicU64 = AtomicU64::new(300f64.to_bits());

/// The panel window's size for the current mode, logical px.
fn panel_size() -> (f64, f64) {
    if is_top() {
        (PANEL_TOP_W, f64::from_bits(PANEL_TOP_H.load(Ordering::Relaxed)))
    } else {
        (PANEL_W, PANEL_H)
    }
}
/// Windows never hides the bubble: it parks it off-screen, so showing it again
/// never takes the keyboard focus from whatever the user is typing in.
const PARKED: (f64, f64) = (-32000.0, -32000.0);

/// Side of the square window, logical px. Changes with the size setting.
static SIDE: AtomicU64 = AtomicU64::new(160f64.to_bits());

fn side() -> f64 {
    f64::from_bits(SIDE.load(Ordering::Relaxed))
}

/// Extra see-through room round the character's square in the corner, as
/// fractions of its side: on the left and right each, and above. Rui (3D) asks
/// for it so a scene (the wardrobe, a longer stroll) can spill past his square
/// without the window having to move mid-animation. The 2D characters don't.
static ROOM_X: AtomicU64 = AtomicU64::new(0);
static ROOM_TOP: AtomicU64 = AtomicU64::new(0);

/// The room in logical px (none at the top edge).
fn room() -> (f64, f64) {
    if is_top() {
        return (0.0, 0.0);
    }
    let s = side();
    (s * f64::from_bits(ROOM_X.load(Ordering::Relaxed)), s * f64::from_bits(ROOM_TOP.load(Ordering::Relaxed)))
}

/// True while the character lives at the top edge instead of a corner.
static TOP: AtomicBool = AtomicBool::new(false);
/// Window size in top mode, logical px: room for the island at its biggest (a
/// notification card). Whatever the island doesn't cover is transparent and
/// click-through.
const ISLAND_W: f64 = 600.0;
const ISLAND_H: f64 = 300.0;
/// Bottom of the open island, logical px from the window top: bubbles and the
/// panel open just below it.
const ISLAND_BOTTOM: f64 = 44.0;
/// Where the island sits by default, as a fraction of the display's width.
const TOP_DEFAULT_AT: f64 = 0.75;

/// The window's size, logical px: the island strip, or the character's square plus any room round it.
fn dims() -> (f64, f64) {
    if is_top() {
        (ISLAND_W, ISLAND_H)
    } else {
        let (rx, rt) = room();
        (side() + 2.0 * rx, side() + rt)
    }
}

/// What the hit rect is measured in, logical px: the island strip, or the
/// character's square (without the room).
fn hit_dims() -> (f64, f64) {
    if is_top() {
        (ISLAND_W, ISLAND_H)
    } else {
        (side(), side())
    }
}

pub fn is_top() -> bool {
    TOP.load(Ordering::Relaxed)
}

/// Window side for each size setting, logical px.
pub fn side_for(size: &str) -> f64 {
    match size {
        "small" => 120.0,
        "large" => 210.0,
        _ => 160.0,
    }
}
/// How close to a screen edge (logical px) a drop must land to snap onto it.
const EDGE_MAGNET: f64 = 120.0;
/// How far (logical px) the character may potter from where the user left it.
const WANDER_RADIUS: f64 = 110.0;
/// Gap from the right edge for the default spot, logical px.
const DEFAULT_INSET: f64 = 16.0;

/// The clickable part of the window (the character's body, or the island), as
/// fractions of the window's width and height.
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct HitRect {
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
}

/// The visible card inside the bubble window, logical px from its top-left.
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct CardRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Clone, Copy)]
enum Ease {
    OutBack,
    InOutSine,
}

impl Ease {
    fn apply(self, p: f64) -> f64 {
        match self {
            // Same curves as the animation spec (Section 5).
            Ease::OutBack => {
                let (c1, c3) = (1.70158, 2.70158);
                1.0 + c3 * (p - 1.0).powi(3) + c1 * (p - 1.0).powi(2)
            }
            Ease::InOutSine => -((std::f64::consts::PI * p).cos() - 1.0) / 2.0,
        }
    }
}

#[derive(Clone, Copy)]
struct Tween {
    from: (f64, f64),
    to: (f64, f64),
    start: Instant,
    ms: f64,
    ease: Ease,
}

#[derive(Clone, Copy)]
struct Drag {
    /// Cursor minus window origin at grab time, physical px.
    offset: (f64, f64),
    /// Top mode: the island slides along the top edge only (y, min x, max x).
    rail: Option<(f64, f64, f64)>,
    /// Window origin at grab time, physical px.
    from: (f64, f64),
}

#[derive(Default)]
struct Inner {
    hit: Option<HitRect>,
    drag: Option<Drag>,
    tween: Option<Tween>,
    /// Where the user last put the character (window origin, physical px).
    home: Option<(f64, f64)>,
    clickable: bool,
    last_report: Option<(f64, f64)>,
    /// Set while the bubble is on screen.
    card: Option<CardRect>,
    card_clickable: bool,
    /// Where the character was before stepping aside for a full-screen app.
    parked_from: Option<(f64, f64)>,
}

#[derive(Default)]
pub struct Desk {
    inner: Mutex<Inner>,
}

impl Desk {
    fn with<R>(&self, f: impl FnOnce(&mut Inner) -> R) -> R {
        f(&mut self.inner.lock().unwrap_or_else(|e| e.into_inner()))
    }
}

// ── Screen geometry ───────────────────────────────────────────────────────────

/// A display's work area (no taskbar), physical px.
#[derive(Clone, Copy, Debug)]
struct Area {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    scale: f64,
}

impl Area {
    fn contains(&self, p: (f64, f64)) -> bool {
        p.0 >= self.x && p.0 < self.x + self.w && p.1 >= self.y && p.1 < self.y + self.h
    }

    fn center(&self) -> (f64, f64) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }

    /// Range of window origins that keep the character on this display. The
    /// window has transparent margins, so it may hang a little past the edges;
    /// the base sits just above the taskbar.
    fn bounds(&self) -> ((f64, f64), (f64, f64)) {
        let side = side() * self.scale;
        (
            (self.x - 0.2 * side, self.x + self.w - 0.8 * side),
            (self.y - 0.3 * side, self.y + self.h - 0.9 * side),
        )
    }

    fn clamp(&self, p: (f64, f64)) -> (f64, f64) {
        let ((x0, x1), (y0, y1)) = self.bounds();
        (p.0.clamp(x0, x1), p.1.clamp(y0, y1))
    }

    /// Where a dropped window settles: on the display, pulled onto any edge it is near.
    fn settle(&self, p: (f64, f64)) -> (f64, f64) {
        let ((x0, x1), (y0, y1)) = self.bounds();
        let (mut x, mut y) = self.clamp(p);
        let magnet = EDGE_MAGNET * self.scale;
        if x - x0 < magnet {
            x = x0;
        } else if x1 - x < magnet {
            x = x1;
        }
        if y - y0 < magnet {
            y = y0;
        } else if y1 - y < magnet {
            y = y1;
        }
        (x, y)
    }

    /// Bottom-right corner, the default home.
    fn default_spot(&self) -> (f64, f64) {
        let ((_, x1), (_, y1)) = self.bounds();
        (x1 - DEFAULT_INSET * self.scale, y1)
    }

    /// Top mode: window origins along the top edge (y, min x, max x).
    fn rail(&self) -> (f64, f64, f64) {
        (self.y, self.x, self.x + self.w - ISLAND_W * self.scale)
    }

    /// Top mode: the island at `x`, on the top edge. By default three quarters
    /// of the way across: clear of coucou's island in the middle and of the
    /// window buttons in the corner.
    fn top_spot(&self, x: Option<f64>) -> (f64, f64) {
        let (y, x0, x1) = self.rail();
        let default = self.x + self.w * TOP_DEFAULT_AT - ISLAND_W * self.scale / 2.0;
        (x.unwrap_or(default).clamp(x0, x1.max(x0)), y)
    }
}

fn areas(app: &AppHandle) -> Vec<Area> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let wa = m.work_area();
            Area {
                x: wa.position.x as f64,
                y: wa.position.y as f64,
                w: wa.size.width as f64,
                h: wa.size.height as f64,
                scale: m.scale_factor(),
            }
        })
        .collect()
}

fn primary_area(app: &AppHandle) -> Option<Area> {
    let m = app.primary_monitor().ok().flatten()?;
    let wa = m.work_area();
    Some(Area {
        x: wa.position.x as f64,
        y: wa.position.y as f64,
        w: wa.size.width as f64,
        h: wa.size.height as f64,
        scale: m.scale_factor(),
    })
}

/// The display under `p`, or the nearest one.
fn area_near(app: &AppHandle, p: (f64, f64)) -> Option<Area> {
    let all = areas(app);
    all.iter().copied().find(|a| a.contains(p)).or_else(|| {
        all.iter().copied().min_by(|a, b| {
            let d = |c: (f64, f64)| (c.0 - p.0).powi(2) + (c.1 - p.1).powi(2);
            d(a.center()).total_cmp(&d(b.center()))
        })
    })
}

/// Centre of the character's body (or the island) for a window origin, physical px.
fn body_center(origin: (f64, f64), scale: f64) -> (f64, f64) {
    if is_top() {
        return (origin.0 + ISLAND_W * scale * 0.5, origin.1 + ISLAND_BOTTOM * scale * 0.5);
    }
    let side = side() * scale;
    (origin.0 + side * 0.5, origin.1 + side * 0.65)
}

// ── Saved spot ────────────────────────────────────────────────────────────────

/// Where the user left the character in each mode (window origins, physical px).
#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Spot {
    x: Option<f64>,
    y: Option<f64>,
    /// Top mode: where along the top edge (None: the default spot).
    top_x: Option<f64>,
}

fn spot_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("spot.json"))
}

fn read_spot(app: &AppHandle) -> Spot {
    spot_file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_spot(app: &AppHandle, spot: &Spot) {
    let Some(path) = spot_file(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string(spot) {
        let _ = std::fs::write(path, text);
    }
}

fn save_spot(app: &AppHandle, p: (f64, f64)) {
    let mut s = read_spot(app);
    (s.x, s.y) = (Some(p.0), Some(p.1));
    write_spot(app, &s);
}

fn save_top_x(app: &AppHandle, x: Option<f64>) {
    let mut s = read_spot(app);
    s.top_x = x;
    write_spot(app, &s);
}

/// The corner spot to go back to: `home` if it is still on a display, else the default.
fn corner_spot(app: &AppHandle, home: Option<(f64, f64)>, scale: f64) -> (f64, f64) {
    let side = side() * scale;
    home.and_then(|p| {
        let body = (p.0 + side * 0.5, p.1 + side * 0.65);
        area_near(app, body).filter(|a| a.contains(body)).map(|a| a.clamp(p))
    })
    .or_else(|| primary_area(app).map(|a| a.default_spot()))
    .unwrap_or((100.0, 100.0))
}

/// The top-edge spot: `x` if it is on a display (else the default spot on
/// `area`, or on the primary display).
fn top_spot(app: &AppHandle, area: Option<Area>, x: Option<f64>) -> (f64, f64) {
    let on = |a: &Area, x: f64| x >= a.x && x < a.x + a.w;
    let area = match (area, x) {
        (Some(a), _) => Some(a),
        (None, Some(x)) => areas(app).into_iter().find(|a| on(a, x)),
        (None, None) => None,
    }
    .or_else(|| primary_area(app));
    let Some(a) = area else { return (100.0, 0.0) };
    a.top_spot(x.filter(|x| on(&a, *x)))
}

// ── Window ────────────────────────────────────────────────────────────────────

pub fn create_window(app: &AppHandle) -> tauri::Result<()> {
    let (size, place) = app
        .state::<crate::system::PrefsState>()
        .0
        .lock()
        .map(|p| (p.size.clone(), p.place.clone()))
        .unwrap_or_default();
    SIDE.store(side_for(&size).to_bits(), Ordering::Relaxed);
    TOP.store(place == "top", Ordering::Relaxed);
    let (w, h) = dims();

    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("companion.html".into()))
        .title("Companion")
        .inner_size(w, h)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()?;

    // Restore the saved spot if it is still on a connected display.
    let scale = win.scale_factor().unwrap_or(1.0);
    let saved = read_spot(app);
    let corner = corner_spot(app, saved.x.zip(saved.y), scale);
    let spot = if is_top() { top_spot(app, None, saved.top_x) } else { corner };

    put(&win, spot);
    win.set_ignore_cursor_events(true)?;
    win.show()?;
    app.state::<Desk>().with(|s| s.home = Some(corner));

    let bubble = WebviewWindowBuilder::new(app, BUBBLE_LABEL, WebviewUrl::App("bubble.html".into()))
        .title("Companion bubble")
        .inner_size(BUBBLE_W, BUBBLE_H)
        .position(PARKED.0, PARKED.1)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .build()?;
    bubble.set_ignore_cursor_events(true)?;
    // Windows doesn't always honour a creation position this far off-screen and
    // puts the window at its default spot instead; park it explicitly.
    bubble.set_position(PhysicalPosition::new(PARKED.0, PARKED.1))?;

    // The panel is made the first time it's opened (panel_window): until then
    // it costs nothing, not even a browser process.
    Ok(())
}

/// The panel window, made on first use.
fn panel_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(p) = app.get_webview_window(PANEL_LABEL) {
        return Ok(p);
    }
    let (w, h) = panel_size();
    let panel = WebviewWindowBuilder::new(app, PANEL_LABEL, WebviewUrl::App("panel.html".into()))
        .title("Companion activity")
        .inner_size(w, h)
        .position(PARKED.0, PARKED.1)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(panel)
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Any window's top-left corner, physical px.
fn origin(win: &WebviewWindow) -> Option<(f64, f64)> {
    win.outer_position().ok().map(|p| (p.x as f64, p.y as f64))
}

/// Where the character's square is: the companion window's corner, inside any
/// room round it, physical px. Everything that places the character (spots,
/// drags, tweens, the bubble and panel beside it) works in these.
fn square(win: &WebviewWindow) -> Option<(f64, f64)> {
    let (rx, rt) = room();
    let scale = win.scale_factor().unwrap_or(1.0);
    origin(win).map(|p| (p.0 + rx * scale, p.1 + rt * scale))
}

/// Moves the companion window so its square's corner lands on `p` (physical px).
fn put(win: &WebviewWindow, p: (f64, f64)) {
    let (rx, rt) = room();
    let scale = win.scale_factor().unwrap_or(1.0);
    let _ = win.set_position(PhysicalPosition::new((p.0 - rx * scale).round(), (p.1 - rt * scale).round()));
}

fn cursor(win: &WebviewWindow) -> Option<(f64, f64)> {
    win.cursor_position().ok().map(|p| (p.x, p.y))
}

fn start_tween(app: &AppHandle, from: (f64, f64), to: (f64, f64), ms: f64, ease: Ease) {
    app.state::<Desk>().with(|s| {
        s.tween = Some(Tween { from, to, start: Instant::now(), ms, ease });
    });
}

/// Changes the window size, keeping the character's base where it was.
pub fn resize(app: &AppHandle, new_side: f64) {
    let old_side = side();
    if (new_side - old_side).abs() < 0.5 {
        return;
    }
    let win = window(app);
    // Where the square is, measured before its size (and the room, which scales with it) changes.
    let before = win.as_ref().and_then(square);
    SIDE.store(new_side.to_bits(), Ordering::Relaxed);
    if is_top() {
        return; // the island keeps its size; the corner uses the new one on the way back
    }
    let Some(win) = win else { return };
    let scale = win.scale_factor().unwrap_or(1.0);
    let (w, h) = dims();
    let _ = win.set_size(LogicalSize::new(w, h));
    if HIDDEN.load(Ordering::Relaxed) {
        return; // restored to the right spot when the full-screen app goes away
    }
    let Some(pos) = before else { return };
    // The base sits at the horizontal centre, 88% down the window.
    let d = (old_side - new_side) * scale;
    let mut to = (pos.0 + d * 0.5, pos.1 + d * 0.88);
    if let Some(area) = area_near(app, body_center(to, scale)) {
        to = area.clamp(to);
    }
    put(&win, to);
    app.state::<Desk>().with(|s| {
        s.home = Some(to);
        s.tween = None;
    });
    save_spot(app, to);
}

/// Sets the see-through room round the character's square (fractions of its
/// side, see ROOM_X), keeping the square where it is on screen.
#[tauri::command]
pub async fn set_room(app: AppHandle, x: f64, top: f64) -> Result<(), String> {
    if !(0.0..=1.0).contains(&x) || !(0.0..=1.0).contains(&top) {
        return Err("room must be 0 to 1".into());
    }
    let same = |a: &AtomicU64, v: f64| (f64::from_bits(a.load(Ordering::Relaxed)) - v).abs() < 1e-6;
    if same(&ROOM_X, x) && same(&ROOM_TOP, top) {
        return Ok(());
    }
    let win = window(&app).ok_or("no window")?;
    let before = square(&win);
    ROOM_X.store(x.to_bits(), Ordering::Relaxed);
    ROOM_TOP.store(top.to_bits(), Ordering::Relaxed);
    if is_top() {
        return Ok(()); // used on the way back to the corner
    }
    let (w, h) = dims();
    let _ = win.set_size(LogicalSize::new(w, h));
    if !HIDDEN.load(Ordering::Relaxed) {
        if let Some(p) = before {
            put(&win, p);
        }
    }
    Ok(())
}

/// Moves the character between its corner and the top edge of the screen, on
/// the display it is on now.
pub fn set_place(app: &AppHandle, top: bool) {
    let Some(win) = window(app) else { return };
    let scale = win.scale_factor().unwrap_or(1.0);
    let hidden = HIDDEN.load(Ordering::Relaxed);
    let now = if hidden { app.state::<Desk>().with(|s| s.parked_from) } else { square(&win) };
    // Which display, judged in the old mode, before the window changes shape.
    let area = now.and_then(|p| area_near(app, body_center(p, scale)));
    if TOP.swap(top, Ordering::Relaxed) == top {
        return;
    }
    let home = app.state::<Desk>().with(|s| {
        s.drag = None;
        s.tween = None;
        s.hit = None; // the page sends the new one
        s.card = None;
        s.home
    });
    let to = if top { top_spot(app, area, read_spot(app).top_x) } else { corner_spot(app, home, scale) };
    let (w, h) = dims();
    let _ = win.set_size(LogicalSize::new(w, h));
    if hidden {
        app.state::<Desk>().with(|s| s.parked_from = Some(to));
    } else {
        put(&win, to);
    }
    for label in [BUBBLE_LABEL, PANEL_LABEL] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.set_ignore_cursor_events(true);
            let _ = w.set_position(PhysicalPosition::new(PARKED.0, PARKED.1));
        }
    }
}

// ── Full-screen apps ──────────────────────────────────────────────────────────

/// True while a full-screen app covers the character's display.
static HIDDEN: AtomicBool = AtomicBool::new(false);

/// Steps aside for a full-screen app (game, video, slideshow) and comes back
/// to the same spot afterwards. Windows are parked off-screen, never hidden, so
/// coming back never steals focus.
pub fn set_hidden(app: &AppHandle, hide: bool) {
    if HIDDEN.swap(hide, Ordering::Relaxed) == hide {
        return;
    }
    let Some(win) = window(app) else { return };
    if hide {
        let pos = square(&win);
        app.state::<Desk>().with(|s| {
            s.parked_from = pos;
            s.drag = None;
            s.tween = None;
            s.card = None;
        });
        let _ = win.set_position(PhysicalPosition::new(PARKED.0, PARKED.1));
        for label in [BUBBLE_LABEL, PANEL_LABEL] {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.set_ignore_cursor_events(true);
                let _ = w.set_position(PhysicalPosition::new(PARKED.0, PARKED.1));
            }
        }
    } else if let Some(back) = app.state::<Desk>().with(|s| s.parked_from.take()) {
        put(&win, back);
    }
    let _ = win.emit("fullscreen", hide);
}

/// The display the character is on, for the full-screen check (physical px).
pub fn character_center(app: &AppHandle) -> Option<(f64, f64)> {
    let win = window(app)?;
    let scale = win.scale_factor().unwrap_or(1.0);
    let pos = if HIDDEN.load(Ordering::Relaxed) {
        app.state::<Desk>().with(|s| s.parked_from)?
    } else {
        square(&win)?
    };
    Some(body_center(pos, scale))
}

/// Sends the character back to the default corner of the primary display.
pub fn reset(app: &AppHandle) {
    let (Some(win), Some(area)) = (window(app), primary_area(app)) else { return };
    let Some(from) = square(&win) else { return };
    if is_top() {
        start_tween(app, from, area.top_spot(None), 450.0, Ease::InOutSine);
        save_top_x(app, None);
        return;
    }
    let to = area.default_spot();
    start_tween(app, from, to, 450.0, Ease::InOutSine);
    app.state::<Desk>().with(|s| s.home = Some(to));
    save_spot(app, to);
}

// ── Poll ──────────────────────────────────────────────────────────────────────

pub fn spawn_poll(app: AppHandle) {
    std::thread::spawn(move || loop {
        // Nothing to track while a full-screen app has the display.
        if HIDDEN.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(250));
            continue;
        }
        let busy = tick(&app);
        std::thread::sleep(Duration::from_millis(if busy { 8 } else { 50 }));
    });
}

/// One poll step. Returns true while the window is moving (poll faster).
fn tick(app: &AppHandle) -> bool {
    let Some(win) = window(app) else { return false };
    let (Some(cur), Some(mut pos)) = (cursor(&win), square(&win)) else { return false };
    let scale = win.scale_factor().unwrap_or(1.0);
    let (w, h) = hit_dims();
    let (w, h) = (w * scale, h * scale);
    let (rx, rt) = room();

    let (drag, tween, hit) = app.state::<Desk>().with(|s| (s.drag, s.tween, s.hit));
    // The button is up but the drag never ended: end it here.
    if drag.is_some() && !mouse_down() {
        finish_drag(app);
        return false;
    }

    let mut busy = false;
    if let Some(d) = drag {
        let mut to = (cur.0 - d.offset.0, cur.1 - d.offset.1);
        if let Some((y, x0, x1)) = d.rail {
            to = (to.0.clamp(x0, x1.max(x0)), y);
        }
        if to != pos {
            put(&win, to);
            pos = to;
        }
        busy = true;
    } else if let Some(t) = tween {
        let p = (t.start.elapsed().as_secs_f64() * 1000.0 / t.ms).min(1.0);
        let e = t.ease.apply(p);
        let to = (t.from.0 + (t.to.0 - t.from.0) * e, t.from.1 + (t.to.1 - t.from.1) * e);
        put(&win, to);
        pos = to;
        if p >= 1.0 {
            app.state::<Desk>().with(|s| s.tween = None);
        }
        busy = true;
    }

    // Click-through everywhere except the body (and always during a drag).
    let local = (cur.0 - pos.0, cur.1 - pos.1);
    let over = hit.is_some_and(|r| {
        local.0 >= r.x0 * w && local.0 <= r.x1 * w && local.1 >= r.y0 * h && local.1 <= r.y1 * h
    });
    let want = over || drag.is_some();
    let changed = app.state::<Desk>().with(|s| {
        let changed = s.clickable != want;
        s.clickable = want;
        changed
    });
    if changed {
        let _ = win.set_ignore_cursor_events(!want);
    }

    // Gaze: report the cursor relative to the window (room included) whenever either moves.
    let rel = (local.0 / scale + rx, local.1 / scale + rt);
    let report = app.state::<Desk>().with(|s| {
        let fresh = s.last_report.is_none_or(|r| (r.0 - rel.0).abs() > 0.5 || (r.1 - rel.1).abs() > 0.5);
        if fresh {
            s.last_report = Some(rel);
        }
        fresh
    });
    if report {
        let _ = win.emit("cursor", CursorEvent { x: rel.0, y: rel.1 });
    }

    // The bubble takes clicks only on its card.
    let card = app.state::<Desk>().with(|s| s.card);
    if let (Some(card), Some(bw)) = (card, app.get_webview_window(BUBBLE_LABEL)) {
        if let Some(bpos) = origin(&bw) {
            let bscale = bw.scale_factor().unwrap_or(scale);
            let lx = (cur.0 - bpos.0) / bscale;
            let ly = (cur.1 - bpos.1) / bscale;
            let over = lx >= card.x && lx <= card.x + card.w && ly >= card.y && ly <= card.y + card.h;
            let changed = app.state::<Desk>().with(|s| {
                let changed = s.card_clickable != over;
                s.card_clickable = over;
                changed
            });
            if changed {
                let _ = bw.set_ignore_cursor_events(!over);
            }
        }
    }

    busy
}

#[derive(Clone, Serialize)]
struct CursorEvent {
    x: f64,
    y: f64,
}

// ── Commands ──────────────────────────────────────────────────────────────────
// Async so they run off the main thread (see the locking rule at the top).

#[tauri::command]
pub async fn set_hit_rect(desk: State<'_, Desk>, rect: HitRect) -> Result<(), String> {
    desk.with(|s| s.hit = Some(rect));
    Ok(())
}

/// The user pressed on the character: the window follows the cursor until `drag_end`.
#[tauri::command]
pub async fn drag_begin(app: AppHandle) -> Result<(), String> {
    let win = window(&app).ok_or("no window")?;
    let (cur, pos) = cursor(&win).zip(square(&win)).ok_or("no cursor")?;
    let rail = if is_top() {
        let scale = win.scale_factor().unwrap_or(1.0);
        area_near(&app, body_center(pos, scale)).map(|a| a.rail())
    } else {
        None
    };
    app.state::<Desk>().with(|s| {
        s.drag = Some(Drag { offset: (cur.0 - pos.0, cur.1 - pos.1), rail, from: pos });
        s.tween = None;
    });
    Ok(())
}

/// Released: settle onto the display (snapping to a nearby edge) and remember the spot.
#[tauri::command]
pub async fn drag_end(app: AppHandle) -> Result<(), String> {
    finish_drag(&app);
    Ok(())
}

/// Ends a drag: settles the window and remembers where it went. Also called
/// by the poll when the mouse button is up but the page never said so (its
/// window lost the mouse, say to a panel taking focus mid-click).
fn finish_drag(app: &AppHandle) {
    let Some(drag) = app.state::<Desk>().with(|s| s.drag.take()) else { return };
    let Some(win) = window(app) else { return };
    let Some(pos) = square(&win) else { return };
    if is_top() {
        // A click isn't a move: only remember a spot the user slid it to.
        if (pos.0 - drag.from.0).abs() >= 1.0 {
            save_top_x(app, Some(pos.0));
        }
        return;
    }
    let scale = win.scale_factor().unwrap_or(1.0);
    let Some(area) = area_near(app, body_center(pos, scale)) else { return };
    let to = area.settle(pos);
    if to != pos {
        start_tween(app, pos, to, 280.0, Ease::OutBack);
    }
    app.state::<Desk>().with(|s| s.home = Some(to));
    save_spot(app, to);
}

/// Whether the (primary) mouse button is held down right now.
#[cfg(windows)]
fn mouse_down() -> bool {
    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(key: i32) -> i16;
        fn GetSystemMetrics(index: i32) -> i32;
    }
    const VK_LBUTTON: i32 = 0x01;
    const VK_RBUTTON: i32 = 0x02;
    const SM_SWAPBUTTON: i32 = 23;
    // SAFETY: plain queries with no pointers.
    unsafe {
        let primary = if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON };
        GetAsyncKeyState(primary) as u16 & 0x8000 != 0
    }
}

#[cfg(not(windows))]
fn mouse_down() -> bool {
    true
}

/// Moves the bubble window beside the character, on the side with more room,
/// or just below the island in top mode. Returns where the card's tail sits:
/// "left", "right", or "top" (no tail: the card hangs from the island).
#[tauri::command]
pub async fn bubble_place(app: AppHandle) -> Result<String, String> {
    let win = window(&app).ok_or("no window")?;
    let bubble = app.get_webview_window(BUBBLE_LABEL).ok_or("no bubble")?;
    let pos = square(&win).ok_or("no position")?;
    let scale = win.scale_factor().unwrap_or(1.0);
    let area = area_near(&app, body_center(pos, scale)).ok_or("no display")?;
    let (bw, bh) = (BUBBLE_W * scale, BUBBLE_H * scale);

    if is_top() {
        let x = (pos.0 + (ISLAND_W * scale - bw) / 2.0).clamp(area.x, area.x + area.w - bw);
        let y = pos.1 + (ISLAND_BOTTOM + 4.0) * scale;
        bubble.set_position(PhysicalPosition::new(x.round(), y.round())).map_err(|e| e.to_string())?;
        return Ok("top".into());
    }

    // On the right half of the screen the bubble opens to the left of the character.
    let side = side() * scale;
    let anchor_x = pos.0 + side * 0.5;
    let on_right = anchor_x > area.center().0;
    let tail_reach = 28.0 * scale;
    let x = if on_right { anchor_x + tail_reach - bw } else { anchor_x - tail_reach };
    let y = pos.1 + side * 0.34 - bh;
    let x = x.clamp(area.x, area.x + area.w - bw);
    let y = y.max(area.y);
    bubble.set_position(PhysicalPosition::new(x.round(), y.round())).map_err(|e| e.to_string())?;
    Ok(if on_right { "right" } else { "left" }.into())
}

/// The card's rectangle inside the bubble window, so only it takes clicks.
#[tauri::command]
pub async fn bubble_card(desk: State<'_, Desk>, rect: CardRect) -> Result<(), String> {
    desk.with(|s| s.card = Some(rect));
    Ok(())
}

#[tauri::command]
pub async fn bubble_hide(app: AppHandle) -> Result<(), String> {
    app.state::<Desk>().with(|s| {
        s.card = None;
        s.card_clickable = false;
    });
    if let Some(b) = app.get_webview_window(BUBBLE_LABEL) {
        let _ = b.set_ignore_cursor_events(true);
        let _ = b.set_position(PhysicalPosition::new(PARKED.0, PARKED.1));
    }
    Ok(())
}

/// Opens the activity panel beside the character, on the side with more room.
#[tauri::command]
pub async fn panel_show(app: AppHandle) -> Result<(), String> {
    let win = window(&app).ok_or("no window")?;
    let panel = panel_window(&app)?;
    let pos = square(&win).ok_or("no position")?;
    let scale = win.scale_factor().unwrap_or(1.0);
    let side = side() * scale;
    let area = area_near(&app, body_center(pos, scale)).ok_or("no display")?;
    let (lw, lh) = panel_size();
    let _ = panel.set_size(LogicalSize::new(lw, lh));
    let (pw, ph) = (lw * scale, lh * scale);

    let (x, y) = if is_top() {
        // The island grown big: flush with the top edge, centred on the island.
        (pos.0 + (ISLAND_W * scale - pw) / 2.0, pos.1)
    } else {
        let on_right = pos.0 + side * 0.5 > area.center().0;
        let x = if on_right { pos.0 + side * 0.18 - pw } else { pos.0 + side * 0.82 };
        // Bottom edge level with the character's base.
        (x, pos.1 + side * 0.92 - ph)
    };
    // Kept on screen.
    let x = x.clamp(area.x, area.x + area.w - pw);
    let y = y.clamp(area.y, area.y + area.h - ph);

    panel.set_position(PhysicalPosition::new(x.round(), y.round())).map_err(|e| e.to_string())?;
    panel.set_ignore_cursor_events(false).map_err(|e| e.to_string())?;
    // The user asked for it, so taking focus is fine (Esc and click-away close it).
    let _ = panel.set_focus();
    Ok(())
}

/// Top mode: the panel page measured its content; the window follows it, so
/// no invisible part of it sits over the screen catching clicks.
#[tauri::command]
pub async fn panel_fit(app: AppHandle, height: f64) -> Result<(), String> {
    if !is_top() || !height.is_finite() {
        return Ok(());
    }
    let h = height.clamp(PANEL_TOP_MIN_H, PANEL_TOP_MAX_H).round();
    PANEL_TOP_H.store(h.to_bits(), Ordering::Relaxed);
    if let Some(p) = app.get_webview_window(PANEL_LABEL) {
        p.set_size(LogicalSize::new(PANEL_TOP_W, h)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn panel_hide(app: AppHandle) -> Result<(), String> {
    if let Some(p) = app.get_webview_window(PANEL_LABEL) {
        let _ = p.set_ignore_cursor_events(true);
        let _ = p.set_position(PhysicalPosition::new(PARKED.0, PARKED.1));
    }
    Ok(())
}

/// A small sideways hop while pottering about, kept near home and on screen.
/// Returns how far it actually moves, logical px (0 when blocked).
#[tauri::command]
pub async fn hop_by(app: AppHandle, dx: f64, ms: f64) -> Result<f64, String> {
    let win = window(&app).ok_or("no window")?;
    let (busy, home) = app.state::<Desk>().with(|s| (s.drag.is_some() || s.tween.is_some(), s.home));
    if busy || is_top() {
        return Ok(0.0);
    }
    let pos = square(&win).ok_or("no position")?;
    let scale = win.scale_factor().unwrap_or(1.0);
    let Some(area) = area_near(&app, body_center(pos, scale)) else { return Ok(0.0) };
    let home = home.unwrap_or(pos);
    let radius = WANDER_RADIUS * scale;
    let ((x0, x1), _) = area.bounds();
    let x = (pos.0 + dx * scale).clamp(x0.max(home.0 - radius), x1.min(home.0 + radius));
    let moved = x - pos.0;
    if moved.abs() < 1.0 {
        return Ok(0.0);
    }
    start_tween(&app, pos, (x, pos.1), ms, Ease::InOutSine);
    Ok(moved / scale)
}

// ── The Desk Companion window ────────────────────────────────────────────────

/// Opens the Desk Companion window (made on first use, brought to the front
/// after), on `page` if given ("home", "coding-agents", "system"…).
pub fn open_home(app: &AppHandle, page: Option<&str>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(HOME_LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if let Some(p) = page {
            let _ = app.emit_to(HOME_LABEL, "home:page", p);
        }
        return Ok(());
    }
    let url = match page {
        Some(p) if p.chars().all(|c| c.is_ascii_lowercase() || c == '-') => format!("app.html#{p}"),
        _ => "app.html".into(),
    };
    WebviewWindowBuilder::new(app, HOME_LABEL, WebviewUrl::App(url.into()))
        .title("Desk Companion")
        .inner_size(940.0, 660.0)
        .min_inner_size(720.0, 520.0)
        .center()
        .focused(true)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// From the panel: "Open the Desk Companion window".
#[tauri::command]
pub async fn home_show(app: AppHandle, page: Option<String>) -> Result<(), String> {
    open_home(&app, page.as_deref())
}
