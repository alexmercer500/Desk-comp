// Every app command is listed here so it gets a permission of its own; each
// window may then call only the commands its capability file names
// (capabilities/*.json), not all of them.

const COMMANDS: &[&str] = &[
    "set_hit_rect",
    "drag_begin",
    "drag_end",
    "hop_by",
    "set_room",
    "on_battery",
    "bubble_place",
    "bubble_card",
    "bubble_hide",
    "panel_show",
    "panel_hide",
    "panel_fit",
    "get_prefs",
    "get_settings",
    "set_setting",
    "set_agent_connected",
    "set_autostart",
    "answer_permission",
    "answer_question",
    "focus_session",
    "assistant_status",
    "assistant_set_key",
    "assistant_forget_key",
    "assistant_ask",
    "check_update",
    "install_update",
];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to run the Tauri build script");
}
