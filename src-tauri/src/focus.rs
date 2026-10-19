// "Show window": brings an agent session's terminal or editor to the front.
//
// The relay sends its parent processes with each event (nearest first). The
// agent's own window — a terminal, VS Code, Cursor — belongs to one of them.
// We take the nearest one that has a visible window; when it has several (one
// editor process, many windows) the one whose title names the project wins.

#[tauri::command]
pub async fn focus_session(procs: Vec<u32>, project: String) -> Result<bool, String> {
    Ok(imp::focus(&procs, &project))
}

#[cfg(windows)]
pub(crate) use imp::find as find_window;

#[cfg(windows)]
mod imp {
    /// A window handle, declared as in system.rs (the same functions are linked there).
    type Hwnd = isize;

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(callback: extern "system" fn(Hwnd, isize) -> i32, param: isize) -> i32;
        fn GetWindowThreadProcessId(hwnd: Hwnd, pid: *mut u32) -> u32;
        fn IsWindowVisible(hwnd: Hwnd) -> i32;
        fn IsIconic(hwnd: Hwnd) -> i32;
        fn GetWindow(hwnd: Hwnd, cmd: u32) -> Hwnd;
        fn GetWindowTextW(hwnd: Hwnd, text: *mut u16, max: i32) -> i32;
        fn ShowWindow(hwnd: Hwnd, cmd: i32) -> i32;
        fn SetForegroundWindow(hwnd: Hwnd) -> i32;
        fn keybd_event(key: u8, scan: u8, flags: u32, extra: usize);
    }
    const GW_OWNER: u32 = 4;
    const SW_RESTORE: i32 = 9;
    const VK_MENU: u8 = 0x12;
    const KEYEVENTF_KEYUP: u32 = 2;

    struct Window {
        hwnd: Hwnd,
        pid: u32,
        title: String,
    }

    extern "system" fn collect(hwnd: Hwnd, param: isize) -> i32 {
        // SAFETY: `param` is the &mut Vec passed to EnumWindows below, alive for the call.
        let out = unsafe { &mut *(param as *mut Vec<Window>) };
        // SAFETY: plain queries on a window handle EnumWindows gave us.
        unsafe {
            if IsWindowVisible(hwnd) == 0 || GetWindow(hwnd, GW_OWNER) != 0 {
                return 1;
            }
            let mut buf = [0u16; 512];
            let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            if n <= 0 {
                return 1;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            out.push(Window { hwnd, pid, title: String::from_utf16_lossy(&buf[..n as usize]) });
        }
        1
    }

    /// The session's window (see the top of this file) and its title.
    pub fn find(procs: &[u32], project: &str) -> Option<(Hwnd, String)> {
        let mut windows: Vec<Window> = Vec::new();
        // SAFETY: the callback only touches `windows` through the pointer, during this call.
        unsafe { EnumWindows(collect, &mut windows as *mut Vec<Window> as isize) };
        let project = project.to_lowercase();
        procs.iter().find_map(|pid| {
            let mine: Vec<&Window> = windows.iter().filter(|w| w.pid == *pid).collect();
            let named = (!project.is_empty()).then(|| mine.iter().find(|w| w.title.to_lowercase().contains(&project))).flatten();
            named.or(mine.first()).map(|w| (w.hwnd, w.title.clone()))
        })
    }

    pub fn focus(procs: &[u32], project: &str) -> bool {
        let Some((target, _)) = find(procs, project) else {
            return false;
        };
        // SAFETY: plain calls on a live top-level window handle.
        unsafe {
            if IsIconic(target) != 0 {
                ShowWindow(target, SW_RESTORE);
            }
            if SetForegroundWindow(target) != 0 {
                return true;
            }
            // Windows only lets the app with the latest input take the
            // foreground; a tap of Alt counts as ours (the usual workaround).
            keybd_event(VK_MENU, 0, 0, 0);
            keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
            SetForegroundWindow(target) != 0
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn focus(_procs: &[u32], _project: &str) -> bool {
        false
    }
}
