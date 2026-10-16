// Keyboard shortcuts, anywhere in Windows (the character's windows never take
// the keyboard focus, so plain keys on a card can't work).
//
//   Ctrl+Alt+Y / Ctrl+Alt+N  Allow / Deny the request on screen. Registered
//                            only while a request is waiting, so the rest of
//                            the time those keys belong to other apps.
//   Ctrl+Alt+J               jump to the agent that needs you (its window)
//   Ctrl+Alt+A               the activity panel
//   Ctrl+Alt+M               pause notifications / turn them back on
//   Ctrl+Alt+H               hide the character / bring him back
//
// Settings → Keyboard shortcuts switches them all off. The page decides what
// Y / N / J apply to (src/desktop/main.ts, "shortcut" event); answering still
// goes through the same checks as a click on the card.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::{desktop, system};

/// A request is waiting and its card is on screen (the page says so).
static ANSWERING: AtomicBool = AtomicBool::new(false);

const KEYS: [(Code, &str); 6] = [
    (Code::KeyJ, "jump"),
    (Code::KeyA, "activity"),
    (Code::KeyM, "mute"),
    (Code::KeyH, "hide"),
    (Code::KeyY, "allow"),
    (Code::KeyN, "deny"),
];

fn shortcut(code: Code) -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), code)
}

fn name_of(s: &Shortcut) -> Option<&'static str> {
    KEYS.iter().find(|(code, _)| *s == shortcut(*code)).map(|(_, name)| *name)
}

/// The plugin, with what each shortcut does.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, s, event| {
            if event.state == ShortcutState::Pressed {
                if let Some(name) = name_of(s) {
                    pressed(app, name);
                }
            }
        })
        .build()
}

fn pressed(app: &AppHandle, name: &str) {
    match name {
        "activity" => {
            let _ = app.emit_to(desktop::LABEL, "panel:toggle", "activity");
        }
        "mute" => {
            let paused = system::current(app).quiet_until != 0;
            if system::update(app, "quietUntil", &serde_json::json!(if paused { 0 } else { -1 })).is_ok() {
                system::broadcast(app);
                let text = if paused {
                    "Notifications are back on."
                } else {
                    "Notifications paused (requests that need your OK still show). Ctrl+Alt+M turns them back on."
                };
                let _ = app.emit_to(desktop::LABEL, "notice", serde_json::json!({ "title": "Desk Companion", "text": text, "kind": "info" }));
            }
        }
        "hide" => desktop::toggle_user_hidden(app),
        // Which request, and which window: the page knows.
        _ => {
            let _ = app.emit_to(desktop::LABEL, "shortcut", name);
        }
    }
}

/// Registers the shortcuts the settings and the moment call for, and drops the rest.
pub fn sync(app: &AppHandle) {
    let on = system::current(app).keyboard_shortcuts;
    let answering = on && ANSWERING.load(Ordering::Relaxed);
    let gs = app.global_shortcut();
    for (code, name) in KEYS {
        let want = match name {
            "allow" | "deny" => answering,
            _ => on,
        };
        let s = shortcut(code);
        let has = gs.is_registered(s);
        if want && !has {
            // Another app may already own it: that one keeps it.
            if let Err(e) = gs.register(s) {
                eprintln!("[shortcuts] {name}: {e}");
            }
        } else if !want && has {
            let _ = gs.unregister(s);
        }
    }
}

/// The page: a request's card is on screen (true) or none is any more (false).
#[tauri::command]
pub async fn answer_keys(app: AppHandle, on: bool) -> Result<(), String> {
    if ANSWERING.swap(on, Ordering::Relaxed) != on {
        sync(&app);
    }
    Ok(())
}
