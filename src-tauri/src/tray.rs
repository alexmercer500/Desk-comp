// Tray icon: ask, activity, settings, who the character is and how big, what
// it keeps an eye on, try each reaction, send it home, quit.
//
// The same settings can change from the Settings tab, so every tick in this
// menu is set from the stored prefs (`sync`) rather than trusted to flip itself.

use serde_json::Value;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::{desktop, setup, system};

/// Display names for the character and size choices.
const CHARACTER_NAMES: &[(&str, &str)] = &[("kulhi", "Kulhi (chai cup)"), ("hexo", "Hexo (hex nut)"), ("glim", "Glim (firefly)"), ("billu", "Billu (space cat)"), ("rui", "Rui (3D yeti)"), ("dogesh", "Dogesh Bhai (scaredy pup)")];
const SIZE_NAMES: &[(&str, &str)] = &[("small", "Small"), ("medium", "Medium"), ("large", "Large")];
const RUI_LOOK_NAMES: &[(&str, &str)] = &[("toy", "Toy (soft vinyl)"), ("anime", "Anime (outlined)")];
const RUI_THEME_NAMES: &[(&str, &str)] = &[("cream", "Cream"), ("mint", "Mint"), ("sky", "Sky blue"), ("lavender", "Lavender"), ("peach", "Peach pink"), ("panda", "Panda")];
const PLACE_NAMES: &[(&str, &str)] = &[("corner", "On the desktop (drag anywhere)"), ("top", "At the top edge (out of the way)")];
/// Switches in the menu, by their setting name.
const SWITCHES: &[(&str, &str)] = &[
    ("breaks", "Break reminders"),
    ("battery", "Battery"),
    ("downloads", "Finished downloads"),
    ("welcome", "Say welcome back"),
];

/// Menu items whose state we set ourselves.
struct Items {
    character: Vec<(String, CheckMenuItem<Wry>)>,
    size: Vec<(String, CheckMenuItem<Wry>)>,
    place: Vec<(String, CheckMenuItem<Wry>)>,
    rui_look: Vec<(String, CheckMenuItem<Wry>)>,
    rui_theme: Vec<(String, CheckMenuItem<Wry>)>,
    /// Rui's look and colour menus: only usable while he's the character.
    rui_menus: Vec<Submenu<Wry>>,
    /// Setting name → its check item.
    switches: Vec<(String, CheckMenuItem<Wry>)>,
    claude: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
    ask: MenuItem<Wry>,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let prefs = system::current(app);
    let check = |id: String, text: &str, on: bool| CheckMenuItem::with_id(app, id, text, true, on, None::<&str>);
    let radio = |group: &str, names: &[(&str, &str)], chosen: &str| {
        names
            .iter()
            .map(|(id, name)| Ok((id.to_string(), check(format!("{group}:{id}"), name, chosen == *id)?)))
            .collect::<tauri::Result<Vec<_>>>()
    };
    let switch = |key: &str, text: &str| Ok::<_, tauri::Error>((key.to_string(), check(format!("pref:{key}"), text, prefs.flag(key).unwrap_or(false))?));

    let items = Items {
        character: radio("character", CHARACTER_NAMES, &prefs.character)?,
        size: radio("size", SIZE_NAMES, &prefs.size)?,
        place: radio("place", PLACE_NAMES, &prefs.place)?,
        rui_look: radio("ruiLook", RUI_LOOK_NAMES, &prefs.rui_look)?,
        rui_theme: radio("ruiTheme", RUI_THEME_NAMES, &prefs.rui_theme)?,
        rui_menus: Vec::new(),
        switches: SWITCHES
            .iter()
            .map(|(key, text)| switch(key, text))
            .chain([switch("hideFullscreen", "Step aside for full-screen apps")])
            .collect::<tauri::Result<_>>()?,
        claude: check("setup:claude".into(), "Connect Claude Code", setup::claude_connected())?,
        autostart: check("setup:autostart".into(), "Start with Windows", setup::autostart_enabled())?,
        ask: MenuItem::with_id(app, "ask", "Ask…", prefs.ask_enabled, None::<&str>)?,
    };
    let mut items = items;
    let group = |title: &str, list: &[(String, CheckMenuItem<Wry>)]| {
        Submenu::with_items(app, title, true, &list.iter().map(|(_, i)| i as &dyn tauri::menu::IsMenuItem<Wry>).collect::<Vec<_>>())
    };
    let is_rui = prefs.character == "rui";
    let rui_look = group("Rui's look", &items.rui_look)?;
    let rui_theme = group("Rui's colour", &items.rui_theme)?;
    rui_look.set_enabled(is_rui)?;
    rui_theme.set_enabled(is_rui)?;
    let mut character_items: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = items.character.iter().map(|(_, i)| i as &dyn tauri::menu::IsMenuItem<Wry>).collect();
    let separator = PredefinedMenuItem::separator(app)?;
    character_items.extend([&separator as &dyn tauri::menu::IsMenuItem<Wry>, &rui_look, &rui_theme]);
    let character = Submenu::with_items(app, "Character", true, &character_items)?;
    drop(character_items);
    items.rui_menus = vec![rui_look.clone(), rui_theme.clone()];
    let size = group("Size", &items.size)?;
    let place = group("Where I live", &items.place)?;
    let (watch_items, fullscreen) = items.switches.split_at(SWITCHES.len());
    let watch = group("Keep an eye on", watch_items)?;

    let demo = Submenu::with_items(
        app,
        "Try a reaction",
        true,
        &[
            &item("demo:agent-permission", "Coding agent → needs permission")?,
            &item("demo:agent-done", "Coding agent → finished")?,
            &PredefinedMenuItem::separator(app)?,
            &item("demo:break", "Break reminder")?,
            &item("demo:battery", "Battery low")?,
            &item("demo:download", "Download finished")?,
            &PredefinedMenuItem::separator(app)?,
            &item("demo:notify", "Notification")?,
            &item("demo:success", "Task → found it")?,
            &item("demo:suggest", "Task → suggestions")?,
            &item("demo:confused", "Task → didn't understand")?,
            &item("demo:error", "Task → error")?,
            &item("demo:sleep", "Go to sleep")?,
        ],
    )?;
    let menu = Menu::with_items(
        app,
        &[
            &items.ask,
            &item("activity", "Show activity")?,
            &item("home", "Open Desk Companion…")?,
            &PredefinedMenuItem::separator(app)?,
            &place,
            &character,
            &size,
            &fullscreen[0].1,
            &watch,
            &PredefinedMenuItem::separator(app)?,
            &items.claude,
            &items.autostart,
            &demo,
            &PredefinedMenuItem::separator(app)?,
            &item("reset", "Move back home")?,
            &item("quit", "Quit")?,
            &PredefinedMenuItem::separator(app)?,
            // Which build this is (CHANGELOG.md says what's in it).
            &MenuItem::with_id(app, "version", format!("Desk Companion {}", app.package_info().version), false, None::<&str>)?,
        ],
    )?;
    app.manage(items);

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip(tooltip(&prefs.character))
        .menu(&menu)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "quit" => app.exit(0),
                "reset" => desktop::reset(app),
                "home" => {
                    let _ = desktop::open_home(app, None);
                }
                "ask" | "activity" | "settings" => {
                    let _ = app.emit_to(desktop::LABEL, "panel:toggle", id);
                }
                "setup:claude" => {
                    let result = setup::set_claude(app, !setup::claude_connected());
                    system::broadcast(app);
                    notice(app, "Claude Code", result);
                }
                "setup:autostart" => {
                    let want = !setup::autostart_enabled();
                    let result = setup::set_autostart(want)
                        .map(|_| if want { "I'll start when you sign in to Windows." } else { "I won't start with Windows." }.to_string())
                        .map_err(|e| format!("Couldn't change that: {e}"));
                    system::broadcast(app);
                    notice(app, "Start with Windows", result);
                }
                _ => {
                    if let Some(key) = id.strip_prefix("pref:") {
                        system::toggle(app, key);
                    } else if let Some((group, choice)) = id.split_once(':') {
                        if matches!(group, "character" | "size" | "place" | "ruiLook" | "ruiTheme") {
                            let _ = system::update(app, group, &Value::String(choice.into()));
                        } else if group == "demo" {
                            let _ = app.emit_to(desktop::LABEL, "demo", choice);
                        }
                    }
                    // A click flips a check item by itself; put back what's true.
                    sync(app);
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Sets every tick (and the tooltip) from the stored settings.
pub fn sync(app: &AppHandle) {
    let Some(items) = app.try_state::<Items>() else { return };
    let prefs = system::current(app);
    for (list, chosen) in [
        (&items.character, &prefs.character),
        (&items.size, &prefs.size),
        (&items.place, &prefs.place),
        (&items.rui_look, &prefs.rui_look),
        (&items.rui_theme, &prefs.rui_theme),
    ] {
        for (id, item) in list {
            let _ = item.set_checked(id == chosen);
        }
    }
    for menu in &items.rui_menus {
        let _ = menu.set_enabled(prefs.character == "rui");
    }
    for (key, item) in &items.switches {
        let _ = item.set_checked(prefs.flag(key).unwrap_or(false));
    }
    let _ = items.claude.set_checked(setup::claude_connected());
    let _ = items.autostart.set_checked(setup::autostart_enabled());
    let _ = items.ask.set_enabled(prefs.ask_enabled);
    if let Some(t) = app.tray_by_id("main") {
        let _ = t.set_tooltip(Some(tooltip(&prefs.character)));
    }
}

/// Tells the user how a setup action went, in the character's bubble.
fn notice(app: &AppHandle, title: &str, result: Result<String, String>) {
    let (kind, text) = match result {
        Ok(t) => ("success", t),
        Err(t) => ("error", t),
    };
    let _ = app.emit_to(desktop::LABEL, "notice", serde_json::json!({ "title": title, "text": text, "kind": kind }));
}

fn tooltip(character: &str) -> &'static str {
    match character {
        "hexo" => "Hexo",
        "glim" => "Glim",
        "billu" => "Billu",
        "rui" => "Rui",
        "dogesh" => "Dogesh Bhai",
        _ => "Kulhi",
    }
}
