"""Draws the installer's Kulhi artwork from the app icon.

    python scripts/make-installer-art.py

Writes into src-tauri/windows/:
  installer-sidebar.bmp  164 x 314, the welcome and finish pages' side panel
  installer-header.bmp   150 x 57, the banner on the other pages

NSIS wants plain 24-bit BMPs (no transparency), so the icon is laid onto a
warm cream background here. Needs Pillow (pip install pillow).
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICON = ROOT / "src-tauri" / "icons" / "icon.png"
OUT = ROOT / "src-tauri" / "windows"

CREAM_TOP = (255, 247, 237)
CREAM_BOTTOM = (246, 226, 204)
INK = (58, 38, 26)
MUTED = (122, 92, 72)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    for candidate in (name, "segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(str(Path("C:/Windows/Fonts") / candidate), size)
        except OSError:
            continue
    return ImageFont.load_default()


def gradient(w: int, h: int) -> Image.Image:
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        k = y / max(1, h - 1)
        row = tuple(round(a + (b - a) * k) for a, b in zip(CREAM_TOP, CREAM_BOTTOM))
        for x in range(w):
            px[x, y] = row
    return img


def place_icon(canvas: Image.Image, size: int, cx: int, cy: int) -> None:
    icon = Image.open(ICON).convert("RGBA").resize((size, size), Image.LANCZOS)
    canvas.paste(icon, (cx - size // 2, cy - size // 2), icon)


def centred(draw: ImageDraw.ImageDraw, text: str, y: int, f: ImageFont.FreeTypeFont, fill, width: int) -> None:
    w = draw.textlength(text, font=f)
    draw.text(((width - w) / 2, y), text, font=f, fill=fill)


def sidebar() -> None:
    w, h = 164, 314
    img = gradient(w, h)
    place_icon(img, 124, w // 2, 104)
    d = ImageDraw.Draw(img)
    centred(d, "Desk Companion", 182, font("seguisb.ttf", 15), INK, w)
    centred(d, "Kulhi keeps an eye on", 208, font("segoeui.ttf", 11), MUTED, w)
    centred(d, "your coding agents", 223, font("segoeui.ttf", 11), MUTED, w)
    img.save(OUT / "installer-sidebar.bmp")


def header() -> None:
    w, h = 150, 57
    img = Image.new("RGB", (w, h), CREAM_TOP)
    place_icon(img, 50, w - 30, h // 2)
    img.save(OUT / "installer-header.bmp")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    sidebar()
    header()
    print(f"wrote {OUT / 'installer-sidebar.bmp'} and {OUT / 'installer-header.bmp'}")
