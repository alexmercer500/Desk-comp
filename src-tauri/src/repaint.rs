// Keeping the see-through windows drawn.
//
// The character's, bubble's and panel's windows are see-through because tao
// asks DWM once, when it makes them (DwmEnableBlurBehindWindow with an empty
// region; tao never asks again). When DWM restarts (heavy load, a graphics
// driver resetting, another app taking the graphics down with it) it forgets,
// and the window's whole square turns black round the character until the
// app restarts. So the setting goes back on every few seconds (nothing changes
// when it's still on), and at once when DWM restarts.
//
// After a long time away (sleep, a locked PC, the display off) the character
// could also be left undrawn until a restart. Then, and when DWM restarts, the
// page redraws ("repaint"), in place: nothing on it is lost, so no reload.

use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter, Manager};

use crate::desktop;

/// How often to look.
const TICK: Duration = Duration::from_secs(5);
/// See-through goes back on every this many looks.
const SEE_THROUGH_EVERY: u32 = 3;
/// A look this late means the PC slept in between.
const SLEPT_AFTER: Duration = Duration::from_secs(30);

/// The windows made see-through.
const SEE_THROUGH: [&str; 3] = [desktop::LABEL, desktop::BUBBLE_LABEL, desktop::PANEL_LABEL];

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut dwm = win::dwm_processes();
        let mut last = SystemTime::now();
        let mut looks = 0u32;
        loop {
            std::thread::sleep(TICK);
            let now = SystemTime::now();
            let slept = now.duration_since(last).is_ok_and(|gap| gap >= SLEPT_AFTER);
            last = now;
            let dwm_now = win::dwm_processes();
            let restarted = !dwm_now.is_empty() && dwm_now != dwm;
            if !dwm_now.is_empty() {
                dwm = dwm_now;
            }
            looks = looks.wrapping_add(1);
            if slept || restarted {
                refresh(&app);
            } else if looks.is_multiple_of(SEE_THROUGH_EVERY) {
                see_through(&app);
            }
        }
    });
}

/// See-through back on, and the character's page redrawn (a new 3D stage if
/// his was lost). Also after an unlock and on coming back to the PC (system.rs).
// Not WebView2's own show or move calls: either one has Windows draw its accent
// border round the window's whole square, as if it were the active window.
pub fn refresh(app: &AppHandle) {
    see_through(app);
    let _ = app.emit_to(desktop::LABEL, "repaint", ());
}

fn see_through(app: &AppHandle) {
    for label in SEE_THROUGH {
        if let Some(hwnd) = app.get_webview_window(label).and_then(|w| w.hwnd().ok()) {
            win::see_through(hwnd.0 as isize);
        }
    }
}

#[cfg(windows)]
mod win {
    use std::ffi::c_void;

    type Handle = isize;

    #[repr(C)]
    struct BlurBehind {
        flags: u32,
        enable: i32,
        region: Handle,
        transition_on_maximized: i32,
    }

    #[repr(C)]
    struct ProcessEntry {
        size: u32,
        usage: u32,
        process_id: u32,
        default_heap_id: usize,
        module_id: u32,
        threads: u32,
        parent_process_id: u32,
        priority: i32,
        flags: u32,
        exe_file: [u16; 260],
    }

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmEnableBlurBehindWindow(hwnd: Handle, blur: *const BlurBehind) -> i32;
    }
    #[link(name = "gdi32")]
    extern "system" {
        fn CreateRectRgn(left: i32, top: i32, right: i32, bottom: i32) -> Handle;
        fn DeleteObject(object: Handle) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> *mut c_void;
        fn Process32FirstW(snapshot: *mut c_void, entry: *mut ProcessEntry) -> i32;
        fn Process32NextW(snapshot: *mut c_void, entry: *mut ProcessEntry) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    /// What tao does when it makes the window: blur behind it, over an empty region.
    pub fn see_through(hwnd: Handle) {
        const DWM_BB_ENABLE: u32 = 1;
        const DWM_BB_BLURREGION: u32 = 2;
        // SAFETY: plain calls; the region is made, used and deleted here.
        unsafe {
            let region = CreateRectRgn(0, 0, -1, -1);
            let blur = BlurBehind { flags: DWM_BB_ENABLE | DWM_BB_BLURREGION, enable: 1, region, transition_on_maximized: 0 };
            DwmEnableBlurBehindWindow(hwnd, &blur);
            if region != 0 {
                DeleteObject(region);
            }
        }
    }

    /// DWM's process ids (one per signed-in user), sorted: they change when it restarts.
    pub fn dwm_processes() -> Vec<u32> {
        const TH32CS_SNAPPROCESS: u32 = 2;
        let mut found = Vec::new();
        // SAFETY: the snapshot is walked with a correctly sized entry and closed here.
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot.is_null() || snapshot as isize == -1 {
                return found;
            }
            let mut entry: ProcessEntry = std::mem::zeroed();
            entry.size = std::mem::size_of::<ProcessEntry>() as u32;
            let mut more = Process32FirstW(snapshot, &mut entry) != 0;
            while more {
                let len = entry.exe_file.iter().position(|&c| c == 0).unwrap_or(entry.exe_file.len());
                if String::from_utf16_lossy(&entry.exe_file[..len]).eq_ignore_ascii_case("dwm.exe") {
                    found.push(entry.process_id);
                }
                more = Process32NextW(snapshot, &mut entry) != 0;
            }
            CloseHandle(snapshot);
        }
        found.sort_unstable();
        found
    }
}

#[cfg(not(windows))]
mod win {
    pub fn see_through(_hwnd: isize) {}
    pub fn dwm_processes() -> Vec<u32> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn dwm_is_found_while_the_tests_run() {
        let found = win::dwm_processes();
        assert!(!found.is_empty(), "dwm.exe runs in every desktop session");
        assert_eq!(found, win::dwm_processes(), "and it's the same one a moment later");
    }
}
