// The named pipe between the relay and the app, one per Windows user.
//
// Shared word for word by the relay (hook/src/main.rs) and the app
// (src/agents.rs includes this file), so the two can never disagree.
//
// The user's SID is in the name: two people signed in to the same PC each get
// their own pipe, so the second one's companion isn't locked out by the
// first's, and nobody else can take the name first. An agent run as
// administrator is still the same user (same SID), so it still reaches the app.

/// The old, shared name; only used if the user's SID can't be read.
pub const LEGACY_PIPE: &str = r"\\.\pipe\desk-companion";

/// `\\.\pipe\desk-companion-S-1-5-21-…` for the user this process runs as.
pub fn pipe_name() -> String {
    match user_sid() {
        Some(sid) => format!(r"{LEGACY_PIPE}-{sid}"),
        None => LEGACY_PIPE.to_string(),
    }
}

/// The SID of the user this process runs as, e.g. "S-1-5-21-…-1001".
#[cfg(windows)]
pub fn user_sid() -> Option<String> {
    use std::ffi::c_void;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> *mut c_void;
        fn CloseHandle(handle: *mut c_void) -> i32;
        fn LocalFree(mem: *mut c_void) -> *mut c_void;
    }
    #[link(name = "advapi32")]
    extern "system" {
        fn OpenProcessToken(process: *mut c_void, access: u32, token: *mut *mut c_void) -> i32;
        fn GetTokenInformation(token: *mut c_void, class: u32, info: *mut c_void, len: u32, needed: *mut u32) -> i32;
        fn ConvertSidToStringSidW(sid: *mut c_void, out: *mut *mut u16) -> i32;
    }
    const TOKEN_QUERY: u32 = 0x0008;
    const TOKEN_USER: u32 = 1;

    let mut token: *mut c_void = std::ptr::null_mut();
    // SAFETY: GetCurrentProcess returns a pseudo-handle; `token` receives a real one.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return None;
    }
    // TOKEN_USER is a SID pointer followed by the SID itself; 256 bytes is plenty,
    // and u64s keep the buffer aligned for the pointer at its start.
    let mut buf = [0u64; 32];
    let mut needed = 0u32;
    // SAFETY: buf is writable for its full size in bytes, as passed.
    let ok = unsafe {
        GetTokenInformation(token, TOKEN_USER, buf.as_mut_ptr().cast(), std::mem::size_of_val(&buf) as u32, &mut needed)
    } != 0;
    // SAFETY: the token handle came from OpenProcessToken above.
    unsafe { CloseHandle(token) };
    if !ok {
        return None;
    }
    // SAFETY: on success the buffer starts with TOKEN_USER { User: { Sid, Attributes } }.
    let sid = buf[0] as usize as *mut c_void;
    let mut text: *mut u16 = std::ptr::null_mut();
    // SAFETY: `sid` points inside buf, which is still alive; `text` receives a LocalAlloc'd string.
    if sid.is_null() || unsafe { ConvertSidToStringSidW(sid, &mut text) } == 0 || text.is_null() {
        return None;
    }
    // SAFETY: `text` is a NUL-terminated UTF-16 string from ConvertSidToStringSidW.
    let len = (0..).take_while(|&i| unsafe { *text.add(i) } != 0).count();
    let s = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(text, len) });
    // SAFETY: allocated by ConvertSidToStringSidW with LocalAlloc.
    unsafe { LocalFree(text.cast()) };
    // Only the characters a SID can have, so the pipe name stays well-formed.
    (s.starts_with("S-") && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).then_some(s)
}

#[cfg(not(windows))]
pub fn user_sid() -> Option<String> {
    None
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn the_pipe_is_named_after_this_user() {
        let sid = user_sid().expect("a signed-in user has a SID");
        assert!(sid.starts_with("S-1-"), "{sid}");
        assert_eq!(pipe_name(), format!(r"\\.\pipe\desk-companion-{sid}"));
        // The same every time, so the relay and the app agree.
        assert_eq!(pipe_name(), pipe_name());
    }
}
