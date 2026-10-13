use std::sync::Mutex;

use tauri::Manager;

mod agents;
mod assistant;
mod desktop;
mod focus;
mod setup;
mod system;
mod tray;
mod updates;

/// See main.rs: what the uninstaller asks for.
pub fn uninstall_cleanup() {
    setup::uninstall_cleanup();
}

pub fn run() {
    tauri::Builder::default()
        // One character per desktop: a second launch just exits.
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(desktop::Desk::default())
        .manage(agents::Pending::default())
        .invoke_handler(tauri::generate_handler![
            desktop::set_hit_rect,
            desktop::drag_begin,
            desktop::drag_end,
            desktop::hop_by,
            desktop::set_room,
            system::on_battery,
            desktop::bubble_place,
            desktop::bubble_card,
            desktop::bubble_hide,
            desktop::panel_show,
            desktop::panel_hide,
            desktop::panel_fit,
            system::get_prefs,
            system::get_settings,
            system::set_setting,
            system::set_agent_connected,
            system::set_autostart,
            agents::answer_permission,
            agents::answer_question,
            focus::focus_session,
            assistant::assistant_status,
            assistant::assistant_set_key,
            assistant::assistant_forget_key,
            assistant::assistant_ask,
            updates::check_update,
            updates::install_update,
        ])
        .setup(|app| {
            let handle = app.handle();
            app.manage(system::PrefsState(Mutex::new(system::load_prefs(handle))));
            // Keep the relay the hooks point at in step with this version.
            setup::install_relay(handle);
            // Agents connected by an older version get this version's hook format.
            setup::refresh_agents();
            desktop::create_window(handle)?;
            tray::create(handle)?;
            desktop::spawn_poll(handle.clone());
            agents::spawn(handle.clone());
            system::spawn(handle.clone());
            updates::spawn(handle.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the companion");
}
