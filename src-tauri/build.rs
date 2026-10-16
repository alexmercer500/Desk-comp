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
    "permission_shown",
    "phone_status",
    "phone_pairing",
    "phone_pair_again",
    "phone_sessions",
    "focus_session",
    "answer_keys",
    "assistant_status",
    "assistant_set_key",
    "assistant_forget_key",
    "assistant_ask",
    "check_update",
    "install_update",
    "agent_connections",
    "test_connection",
    "connect_found_agents",
    "home_show",
];

/// The relay built into this copy (docs/RELAY.md): `DESK_COMPANION_RELAY` from
/// the environment, or from `.env` in the project folder (not in git: each
/// person who builds the app sets their own). Empty when neither has it; the
/// user can then paste one in Settings.
fn built_in_relay() -> String {
    println!("cargo:rerun-if-env-changed=DESK_COMPANION_RELAY");
    let env_file = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default()).join("../.env");
    println!("cargo:rerun-if-changed={}", env_file.display());
    let from_file = || {
        let text = std::fs::read_to_string(&env_file).ok()?;
        text.lines().find_map(|l| l.trim().strip_prefix("DESK_COMPANION_RELAY=").map(|v| v.trim().trim_matches('"').to_string()))
    };
    let value = std::env::var("DESK_COMPANION_RELAY").ok().or_else(from_file).unwrap_or_default();
    if !value.is_empty() && !value.starts_with("https://") {
        println!("cargo:warning=DESK_COMPANION_RELAY must start with https:// (ignored: {value})");
        return String::new();
    }
    value
}

fn main() {
    println!("cargo:rustc-env=DESK_COMPANION_RELAY_BUILT_IN={}", built_in_relay());
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to run the Tauri build script");
}
