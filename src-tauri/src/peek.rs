// Peek: a picture of an agent session's window, for the phone (phone/).
//
// The phone asks for one session; we find that session's window the way
// "Show window" does (focus.rs: the relay's parent processes, the project in
// the title), have Windows draw it into a bitmap (PrintWindow with full
// content, so it works when other windows cover it), shrink it to at most
// MAX_W × MAX_H and make a JPEG. Only that window, never the whole screen.
// A minimized window has nothing to draw: we say so rather than restore it.
//
// One picture per request; nothing is kept or sent anywhere else. The
// companion page shows a short notice each time, so someone at the PC knows.

/// The largest picture sent, in pixels: plenty to read code on a phone, small enough to send quickly.
const MAX_W: usize = 1600;
const MAX_H: usize = 1600;
/// JPEG quality, and the size it should stay under (it's sent in pieces, also through the relay).
const QUALITY: u8 = 72;
const MAX_JPEG: usize = 600 * 1024;

/// A window's picture.
pub struct Shot {
    pub jpeg: Vec<u8>,
    pub width: usize,
    pub height: usize,
    /// The window's title, as Windows shows it.
    pub title: String,
}

/// The session's window as a JPEG, or why there isn't one (in words for the phone).
pub fn capture(procs: &[u32], project: &str) -> Result<Shot, String> {
    let (bgra, w, h, title) = imp::grab(procs, project)?;
    if blank(&bgra) {
        return Err("Windows gave an empty picture of that window. Try again, or bring it to the front on the PC.".into());
    }
    let (rgb, sw, sh) = shrink(&bgra, w, h, MAX_W, MAX_H);
    let jpeg = encode(&rgb, sw, sh)?;
    Ok(Shot { jpeg, width: sw, height: sh, title })
}

/// Every pixel the same (all black, usually): Windows couldn't draw it.
fn blank(bgra: &[u8]) -> bool {
    let first = bgra.get(..3);
    bgra.chunks_exact(4).all(|p| Some(&p[..3]) == first)
}

/// BGRA pixels (w × h) scaled down to fit max_w × max_h, averaging the
/// pixels each new one covers; RGB out. Never scaled up.
fn shrink(bgra: &[u8], w: usize, h: usize, max_w: usize, max_h: usize) -> (Vec<u8>, usize, usize) {
    let scale = (w as f64 / max_w as f64).max(h as f64 / max_h as f64).max(1.0);
    let (nw, nh) = (((w as f64 / scale).round() as usize).max(1), ((h as f64 / scale).round() as usize).max(1));
    let mut out = Vec::with_capacity(nw * nh * 3);
    for y in 0..nh {
        let (y0, y1) = (y * h / nh, ((y + 1) * h / nh).max(y * h / nh + 1));
        for x in 0..nw {
            let (x0, x1) = (x * w / nw, ((x + 1) * w / nw).max(x * w / nw + 1));
            let (mut r, mut g, mut b) = (0u32, 0u32, 0u32);
            for sy in y0..y1 {
                let row = &bgra[(sy * w + x0) * 4..(sy * w + x1) * 4];
                for p in row.chunks_exact(4) {
                    b += p[0] as u32;
                    g += p[1] as u32;
                    r += p[2] as u32;
                }
            }
            let n = ((y1 - y0) * (x1 - x0)) as u32;
            out.extend_from_slice(&[(r / n) as u8, (g / n) as u8, (b / n) as u8]);
        }
    }
    (out, nw, nh)
}

/// A JPEG of the picture, at a lower quality if it would be too big to send.
fn encode(rgb: &[u8], w: usize, h: usize) -> Result<Vec<u8>, String> {
    let (w16, h16) = (u16::try_from(w).map_err(|_| "too wide")?, u16::try_from(h).map_err(|_| "too tall")?);
    let mut last = Vec::new();
    for quality in [QUALITY, 55, 40] {
        let mut out = Vec::new();
        jpeg_encoder::Encoder::new(&mut out, quality)
            .encode(rgb, w16, h16, jpeg_encoder::ColorType::Rgb)
            .map_err(|e| format!("Couldn't make the picture ({e})"))?;
        if out.len() <= MAX_JPEG {
            return Ok(out);
        }
        last = out;
    }
    Err(format!("The picture came out too big to send ({} KB)", last.len() / 1024))
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;

    type Hwnd = isize;
    type Hdc = isize;
    type Hbitmap = isize;

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct BitmapInfo {
        size: u32,
        width: i32,
        height: i32,
        planes: u16,
        bit_count: u16,
        compression: u32,
        size_image: u32,
        x_ppm: i32,
        y_ppm: i32,
        clr_used: u32,
        clr_important: u32,
        colors: [u32; 1],
    }

    #[link(name = "user32")]
    extern "system" {
        fn IsIconic(hwnd: Hwnd) -> i32;
        fn GetWindowRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
        fn GetDC(hwnd: Hwnd) -> Hdc;
        fn ReleaseDC(hwnd: Hwnd, dc: Hdc) -> i32;
        fn PrintWindow(hwnd: Hwnd, dc: Hdc, flags: u32) -> i32;
    }
    #[link(name = "gdi32")]
    extern "system" {
        fn CreateCompatibleDC(dc: Hdc) -> Hdc;
        fn CreateDIBSection(dc: Hdc, info: *const BitmapInfo, usage: u32, bits: *mut *mut c_void, section: isize, offset: u32) -> Hbitmap;
        fn SelectObject(dc: Hdc, obj: isize) -> isize;
        fn DeleteObject(obj: isize) -> i32;
        fn DeleteDC(dc: Hdc) -> i32;
        fn GdiFlush() -> i32;
    }
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmGetWindowAttribute(hwnd: Hwnd, attr: u32, value: *mut c_void, size: u32) -> i32;
    }
    /// PrintWindow: draw what the window shows, GPU-drawn content included (Windows 8.1+).
    const PW_RENDERFULLCONTENT: u32 = 2;
    const DWMWA_EXTENDED_FRAME_BOUNDS: u32 = 9;
    const DIB_RGB_COLORS: u32 = 0;
    /// No picture of a window bigger than this (a bitmap of a huge window would be hundreds of MB).
    const MAX_SIDE: i32 = 8192;

    /// The window's pixels (BGRA, top row first), its visible size, and its title.
    pub fn grab(procs: &[u32], project: &str) -> Result<(Vec<u8>, usize, usize, String), String> {
        let (hwnd, title) = crate::focus::find_window(procs, project)
            .ok_or("Couldn't find this session's window on the PC (closed, or on another desktop?)")?;
        // SAFETY: plain calls on a top-level window handle EnumWindows just gave us; the
        // DC, bitmap and pixel pointer are created, used and released within this block.
        unsafe {
            if IsIconic(hwnd) != 0 {
                return Err(format!("\"{title}\" is minimized on the PC, so there's nothing to see. Restore it there and peek again."));
            }
            let mut win = Rect::default();
            if GetWindowRect(hwnd, &mut win) == 0 {
                return Err("Couldn't measure the window".into());
            }
            // What you see of it: without the invisible resize border around it.
            let mut seen = win;
            if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut seen as *mut Rect as *mut c_void, std::mem::size_of::<Rect>() as u32) != 0 {
                seen = win;
            }
            let (w, h) = (win.right - win.left, win.bottom - win.top);
            if w <= 0 || h <= 0 || w > MAX_SIDE || h > MAX_SIDE {
                return Err("That window has no size Windows can draw".into());
            }
            let screen = GetDC(0);
            let dc = CreateCompatibleDC(screen);
            let info = BitmapInfo {
                size: (std::mem::size_of::<BitmapInfo>() - 4) as u32,
                width: w,
                height: -h, // top row first
                planes: 1,
                bit_count: 32,
                compression: 0,
                size_image: 0,
                x_ppm: 0,
                y_ppm: 0,
                clr_used: 0,
                clr_important: 0,
                colors: [0],
            };
            let mut bits: *mut c_void = std::ptr::null_mut();
            let bitmap = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &mut bits, 0, 0);
            let result = if bitmap == 0 || bits.is_null() || dc == 0 {
                Err("Not enough memory for the picture".to_string())
            } else {
                let old = SelectObject(dc, bitmap);
                let drawn = PrintWindow(hwnd, dc, PW_RENDERFULLCONTENT) != 0;
                GdiFlush();
                let all = std::slice::from_raw_parts(bits as *const u8, (w * h * 4) as usize);
                // Crop to what's visible.
                let (cx, cy) = ((seen.left - win.left).clamp(0, (w - 1).max(0)), (seen.top - win.top).clamp(0, (h - 1).max(0)));
                let (cw, ch) = ((seen.right - seen.left).clamp(1, (w - cx).max(1)), (seen.bottom - seen.top).clamp(1, (h - cy).max(1)));
                let mut out = Vec::with_capacity((cw * ch * 4) as usize);
                for y in cy..cy + ch {
                    let start = ((y * w + cx) * 4) as usize;
                    out.extend_from_slice(&all[start..start + (cw * 4) as usize]);
                }
                SelectObject(dc, old);
                if drawn { Ok((out, cw as usize, ch as usize, title)) } else { Err("Windows wouldn't draw that window".to_string()) }
            };
            if bitmap != 0 {
                DeleteObject(bitmap);
            }
            if dc != 0 {
                DeleteDC(dc);
            }
            ReleaseDC(0, screen);
            result
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn grab(_procs: &[u32], _project: &str) -> Result<(Vec<u8>, usize, usize, String), String> {
        Err("Peek works on Windows only for now".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bgra(w: usize, h: usize, f: impl Fn(usize, usize) -> [u8; 4]) -> Vec<u8> {
        let f = &f;
        (0..h).flat_map(|y| (0..w).flat_map(move |x| f(x, y))).collect()
    }

    #[test]
    fn big_pictures_shrink_to_fit_and_keep_their_shape() {
        let px = bgra(3200, 1800, |_, _| [10, 20, 30, 255]);
        let (rgb, w, h) = shrink(&px, 3200, 1800, MAX_W, MAX_H);
        assert_eq!((w, h), (1600, 900));
        assert_eq!(rgb.len(), w * h * 3);
        assert_eq!(&rgb[..3], &[30, 20, 10], "BGRA in, RGB out");
        // Tall ones fit by height; small ones stay as they are.
        assert_eq!(shrink(&bgra(1000, 4000, |_, _| [0; 4]), 1000, 4000, MAX_W, MAX_H).1, 400);
        let (_, w, h) = shrink(&bgra(800, 600, |_, _| [0; 4]), 800, 600, MAX_W, MAX_H);
        assert_eq!((w, h), (800, 600));
    }

    #[test]
    fn shrinking_averages_what_each_pixel_covers() {
        // Black and white columns, halved: grey.
        let px = bgra(4, 2, |x, _| if x % 2 == 0 { [0, 0, 0, 255] } else { [255, 255, 255, 255] });
        let (rgb, w, h) = shrink(&px, 4, 2, 2, 2);
        assert_eq!((w, h), (2, 1));
        assert_eq!(rgb, vec![127; 6]);
    }

    #[test]
    fn an_all_black_capture_is_noticed() {
        assert!(blank(&bgra(10, 10, |_, _| [0, 0, 0, 255])));
        assert!(!blank(&bgra(10, 10, |x, _| [x as u8, 0, 0, 255])));
    }

    #[test]
    fn the_picture_is_a_jpeg_small_enough_to_send() {
        let px = bgra(1600, 900, |x, y| [(x * 7 % 256) as u8, (y * 3 % 256) as u8, ((x ^ y) % 256) as u8, 255]);
        let (rgb, w, h) = shrink(&px, 1600, 900, MAX_W, MAX_H);
        let jpeg = encode(&rgb, w, h).unwrap();
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8], "a JPEG");
        assert!(jpeg.len() <= MAX_JPEG);
    }
}
