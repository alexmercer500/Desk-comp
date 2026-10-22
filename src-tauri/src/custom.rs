// Your own character: pictures the user picked, one per mood, drawn by the
// "custom" skin (src/skins/custom.ts) with the same motion as every other
// character.
//
// Settings scales each picture down and turns it into a PNG before it comes
// here; we only check it is one, of a sensible size, and keep it in the app's
// data folder (custom-character/<mood>.png). Every window that draws the
// character reads them back as data URLs and hears "custom-character" when
// they change.

use std::collections::BTreeMap;
use std::path::PathBuf;

use base64::Engine as _;
use tauri::{AppHandle, Emitter, Manager};

/// The moods a picture can be for (src/skins/custom.ts). "idle" is the main one: it stands in for any mood without its own.
pub const MOODS: &[&str] = &["idle", "blink", "working", "waiting", "done", "error", "sleeping", "surprised"];
/// Largest picture accepted, bytes (Settings makes them at most 512 px, far smaller than this).
const MAX_BYTES: usize = 4 << 20;
/// Largest side accepted, px.
const MAX_SIDE: u32 = 1024;
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

fn folder(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("custom-character"))
}

fn file(app: &AppHandle, mood: &str) -> Result<PathBuf, String> {
    if !MOODS.contains(&mood) {
        return Err(format!("unknown mood {mood:?}"));
    }
    folder(app).map(|d| d.join(format!("{mood}.png"))).ok_or_else(|| "no data folder".into())
}

/// Whether there is a main picture, without which there is no character to show.
pub fn has_main(app: &AppHandle) -> bool {
    file(app, "idle").is_ok_and(|p| p.is_file())
}

/// A PNG of at most MAX_SIDE × MAX_SIDE and MAX_BYTES; its size, or what's wrong.
fn check_png(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.len() > MAX_BYTES {
        return Err("That picture is too big.".into());
    }
    // The signature, then the IHDR chunk: length, "IHDR", width, height (big-endian).
    if bytes.len() < 33 || !bytes.starts_with(PNG_SIGNATURE) || &bytes[12..16] != b"IHDR" {
        return Err("That isn't a PNG picture.".into());
    }
    let side = |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    let (w, h) = (side(16), side(20));
    if w == 0 || h == 0 || w > MAX_SIDE || h > MAX_SIDE {
        return Err(format!("Pictures can be at most {MAX_SIDE} × {MAX_SIDE}."));
    }
    Ok((w, h))
}

/// Every picture there is, as `data:image/png;base64,…` by mood.
#[tauri::command]
pub async fn custom_pictures(app: AppHandle) -> Result<BTreeMap<String, String>, String> {
    let mut out = BTreeMap::new();
    for mood in MOODS {
        let Ok(path) = file(&app, mood) else { continue };
        let Ok(bytes) = std::fs::read(&path) else { continue };
        if check_png(&bytes).is_err() {
            continue;
        }
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        out.insert((*mood).to_string(), format!("data:image/png;base64,{b64}"));
    }
    Ok(out)
}

/// Keeps `png` (base64) as the picture for `mood`.
#[tauri::command]
pub async fn custom_picture_set(app: AppHandle, mood: String, png: String) -> Result<(), String> {
    let path = file(&app, &mood)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(png.trim()).map_err(|_| "That picture couldn't be read.".to_string())?;
    check_png(&bytes)?;
    let dir = path.parent().ok_or("no data folder")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Couldn't save it: {e}"))?;
    // Written beside it first, so a picture is never left half-written.
    let part = path.with_extension("png.part");
    std::fs::write(&part, &bytes).map_err(|e| format!("Couldn't save it: {e}"))?;
    std::fs::rename(&part, &path).map_err(|e| format!("Couldn't save it: {e}"))?;
    let _ = app.emit("custom-character", ());
    Ok(())
}

/// Removes the picture for `mood`. Without a main picture there's no character
/// left, so if it was the one in use the default one comes back.
#[tauri::command]
pub async fn custom_picture_clear(app: AppHandle, mood: String) -> Result<(), String> {
    let path = file(&app, &mood)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Couldn't remove it: {e}"))?;
    }
    if mood == "idle" && crate::system::current(&app).character == "custom" {
        let _ = crate::system::update(&app, "character", &serde_json::Value::String("kulhi".into()));
    }
    let _ = app.emit("custom-character", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut b = PNG_SIGNATURE.to_vec();
        b.extend_from_slice(&13u32.to_be_bytes());
        b.extend_from_slice(b"IHDR");
        b.extend_from_slice(&w.to_be_bytes());
        b.extend_from_slice(&h.to_be_bytes());
        b.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
        b
    }

    #[test]
    fn only_pngs_of_a_sensible_size_are_kept() {
        assert_eq!(check_png(&png(512, 300)), Ok((512, 300)));
        assert!(check_png(&png(2048, 10)).is_err(), "too wide");
        assert!(check_png(&png(0, 10)).is_err(), "empty");
        assert!(check_png(b"GIF89a.......................................").is_err(), "not a PNG");
        assert!(check_png(&png(10, 10)[..20]).is_err(), "cut short");
        let mut huge = png(10, 10);
        huge.resize(MAX_BYTES + 1, 0);
        assert!(check_png(&huge).is_err(), "too many bytes");
    }

    #[test]
    fn only_known_moods_have_a_file() {
        assert!(MOODS.contains(&"idle"));
        assert!(!MOODS.contains(&"../prefs"));
    }
}
