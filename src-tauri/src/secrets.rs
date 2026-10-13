// Secrets in Windows Credential Manager: the Anthropic API key (assistant.rs)
// and the phone link's certificate and token (phone/). Stored per user, never
// in a file; the page only ever learns whether one exists.
//
// A generic credential holds at most 2560 bytes.

/// Most bytes one credential can hold (CRED_MAX_CREDENTIAL_BLOB_SIZE).
pub const MAX_SECRET: usize = 5 * 512;

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;

    const CRED_TYPE_GENERIC: u32 = 1;
    const CRED_PERSIST_LOCAL_MACHINE: u32 = 2;

    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    #[repr(C)]
    struct CredentialW {
        flags: u32,
        kind: u32,
        target_name: *mut u16,
        comment: *mut u16,
        last_written: FileTime,
        blob_size: u32,
        blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut c_void,
        target_alias: *mut u16,
        user_name: *mut u16,
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn CredWriteW(credential: *const CredentialW, flags: u32) -> i32;
        fn CredReadW(target: *const u16, kind: u32, flags: u32, credential: *mut *mut CredentialW) -> i32;
        fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
        fn CredFree(buffer: *mut c_void);
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn write(target: &str, user: &str, secret: &[u8]) -> std::io::Result<()> {
        if secret.len() > super::MAX_SECRET {
            return Err(std::io::Error::other("secret too large for Credential Manager"));
        }
        let mut name = wide(target);
        let mut user = wide(user);
        let mut blob = secret.to_vec();
        let cred = CredentialW {
            flags: 0,
            kind: CRED_TYPE_GENERIC,
            target_name: name.as_mut_ptr(),
            comment: std::ptr::null_mut(),
            last_written: FileTime { low: 0, high: 0 },
            blob_size: blob.len() as u32,
            blob: blob.as_mut_ptr(),
            persist: CRED_PERSIST_LOCAL_MACHINE,
            attribute_count: 0,
            attributes: std::ptr::null_mut(),
            target_alias: std::ptr::null_mut(),
            user_name: user.as_mut_ptr(),
        };
        // SAFETY: every pointer refers to a live buffer for the duration of the call.
        if unsafe { CredWriteW(&cred, 0) } != 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }

    pub fn read(target: &str) -> Option<Vec<u8>> {
        let name = wide(target);
        let mut out: *mut CredentialW = std::ptr::null_mut();
        // SAFETY: on success Windows hands us a buffer we must release with CredFree.
        if unsafe { CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut out) } == 0 || out.is_null() {
            return None;
        }
        // SAFETY: `out` is a valid CREDENTIALW whose blob holds blob_size bytes; freed right after copying.
        let bytes = unsafe {
            let c = &*out;
            let bytes = std::slice::from_raw_parts(c.blob, c.blob_size as usize).to_vec();
            CredFree(out.cast());
            bytes
        };
        Some(bytes)
    }

    pub fn delete(target: &str) {
        let name = wide(target);
        // SAFETY: plain call with a valid, NUL-terminated name.
        unsafe { CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0) };
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn write(_target: &str, _user: &str, _secret: &[u8]) -> std::io::Result<()> {
        Err(std::io::Error::other("secret storage comes with the macOS/Linux port"))
    }
    pub fn read(_target: &str) -> Option<Vec<u8>> {
        None
    }
    pub fn delete(_target: &str) {}
}

pub use imp::{delete, read, write};
