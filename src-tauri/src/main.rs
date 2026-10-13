// No console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The uninstaller runs us once with this flag to take out the hooks, the
    // relay and the autostart entry; no window, no tray, just that.
    if std::env::args().any(|a| a == "--uninstall-cleanup") {
        desk_companion_lib::uninstall_cleanup();
        return;
    }
    desk_companion_lib::run()
}
