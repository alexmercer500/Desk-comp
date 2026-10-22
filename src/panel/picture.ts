// A picture picked for your own character (Settings), made ready to keep: the
// see-through edges trimmed off (so the character fills its space and its
// clickable part fits it), scaled down to at most MAX_SIDE, and turned into a
// PNG, which keeps any see-through background. custom.rs checks it again.

/** Longest side of a kept picture, px: sharp at the largest size on a 2× screen. */
const MAX_SIDE = 512;
/** Longest side looked at for trimming, px. */
const SCAN_SIDE = 1024;
/** Largest file accepted, bytes. */
const MAX_FILE = 25 << 20;
/** Pixels at least this opaque (0–255) count as part of the picture. */
const SOLID = 12;

/** What can be picked: the browser opens these. */
export const PICTURE_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/bmp";

/** The PNG to keep, as base64 (no `data:` prefix). Throws an Error with words for the user. */
export async function preparePicture(file: Blob): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("That isn't a picture.");
  if (file.size > MAX_FILE) throw new Error("That picture is too big (25 MB at most).");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("That picture couldn't be opened.");
  }
  // Looked at no bigger than SCAN_SIDE: enough to find the edges.
  const k = Math.min(1, SCAN_SIDE / Math.max(bmp.width, bmp.height));
  const scan = canvasOf(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
  scan.g.drawImage(bmp, 0, 0, scan.c.width, scan.c.height);
  bmp.close();
  const box = solidBox(scan.g.getImageData(0, 0, scan.c.width, scan.c.height));
  if (!box) throw new Error("That picture is empty: it's see-through all over.");

  const s = Math.min(1, MAX_SIDE / Math.max(box.w, box.h));
  const out = canvasOf(Math.max(1, Math.round(box.w * s)), Math.max(1, Math.round(box.h * s)));
  out.g.imageSmoothingQuality = "high";
  out.g.drawImage(scan.c, box.x, box.y, box.w, box.h, 0, 0, out.c.width, out.c.height);
  const png = await new Promise<Blob | null>((done) => out.c.toBlob(done, "image/png"));
  if (!png) throw new Error("That picture couldn't be saved.");
  return base64(png);
}

function canvasOf(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("Pictures can't be read here.");
  return { c, g };
}

/** The smallest box holding every solid pixel, or null when there's none. */
export function solidBox(img: { width: number; height: number; data: Uint8ClampedArray }): { x: number; y: number; w: number; h: number } | null {
  const { width, height, data } = img;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] < SOLID) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

async function base64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((done, fail) => {
    const r = new FileReader();
    r.onload = () => done(String(r.result));
    r.onerror = () => fail(new Error("That picture couldn't be read."));
    r.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(",") + 1);
}
