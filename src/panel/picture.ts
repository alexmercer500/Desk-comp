// Pictures picked for your own character (Settings), made ready to keep: a
// plain one-colour background taken away (AI pictures usually come on white),
// the see-through edges trimmed off (so the character fills its space and its
// clickable part fits it), scaled down to at most MAX_SIDE, and turned into a
// PNG, which keeps the see-through parts. custom.rs checks each one again.
//
// A set of pictures of one size (a sheet cut into its cells, or files an AI
// made together) is trimmed as one, so the character keeps the same size and
// place in every mood instead of each picture being blown up to fill its box.

/** Longest side of a kept picture, px: sharp at the largest size on a 2× screen. */
const MAX_SIDE = 512;
/** Longest side looked at, px: enough to find the edges and the background. */
const SCAN_SIDE = 1024;
/** Largest file accepted, bytes. */
const MAX_FILE = 25 << 20;
/** Pixels at least this opaque (0–255) count as part of the picture. */
const SOLID = 12;
/**
 * How far (RGB distance) a pixel may be from the background colour and still
 * be background: a little more than the background's own noise, within these
 * bounds. A clean AI background gets the least, so a pale character (cream fur
 * on white) keeps its edges; a noisy one (a photo's wall, JPEG) more.
 */
const BACKGROUND_TOLERANCE = { least: 12, most: 40, perNoise: 3 };

/** What can be picked: the browser opens these. */
export const PICTURE_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/bmp";

export interface PrepareOptions {
  /** Take away a plain one-colour background round the character. */
  plainBackground: boolean;
}

/** A sheet's grid: 4 across, 2 down (the AI prompt asks for this, in MOODS order). */
export const SHEET = { cols: 4, rows: 2 };
/** Each cell's edges left out, as a share of its size: a grid line or a neighbour's stray pixels. */
const CELL_INSET = 0.02;

type Box = { x: number; y: number; w: number; h: number };
type Scan = { c: HTMLCanvasElement; g: CanvasRenderingContext2D };

/** One picture, as the PNG to keep (base64, no `data:` prefix). Throws an Error with words for the user. */
export async function preparePicture(file: Blob, opts: PrepareOptions): Promise<string> {
  const scan = await scanOf(file);
  const box = clean(scan, opts);
  if (!box) throw new Error("That picture is empty: there's nothing in it but background.");
  return exportBox(scan, box);
}

/**
 * Several pictures at once, by key. Pictures of one size are trimmed as one
 * (see the top). Those that can't be used are listed with why.
 */
export async function prepareSet<K>(items: { key: K; file: Blob }[], opts: PrepareOptions): Promise<{ ready: Map<K, string>; failed: { key: K; why: string }[] }> {
  const failed: { key: K; why: string }[] = [];
  const scans: { key: K; scan: Scan; box: Box }[] = [];
  for (const { key, file } of items) {
    try {
      const scan = await scanOf(file);
      const box = clean(scan, opts);
      if (box) scans.push({ key, scan, box });
      else failed.push({ key, why: "nothing in it but background" });
    } catch (e) {
      failed.push({ key, why: e instanceof Error ? e.message : String(e) });
    }
  }
  const ready = await exportTogether(scans);
  return { ready, failed };
}

/** A sheet: one picture with a mood in each cell of SHEET, in `order`. Empty cells are left out. */
export async function splitSheet<K>(file: Blob, order: readonly K[], opts: PrepareOptions): Promise<Map<K, string>> {
  const bmp = await bitmapOf(file);
  const cw = Math.floor(bmp.width / SHEET.cols);
  const ch = Math.floor(bmp.height / SHEET.rows);
  if (cw < 16 || ch < 16) throw new Error("That picture is too small to be a sheet.");
  const ix = Math.round(cw * CELL_INSET), iy = Math.round(ch * CELL_INSET);
  // Every cell at the same scale, so they can be trimmed as one.
  const k = Math.min(1, SCAN_SIDE / Math.max(cw - 2 * ix, ch - 2 * iy));
  const w = Math.max(1, Math.round((cw - 2 * ix) * k)), h = Math.max(1, Math.round((ch - 2 * iy) * k));
  const scans: { key: K; scan: Scan; box: Box }[] = [];
  order.forEach((key, n) => {
    if (n >= SHEET.cols * SHEET.rows) return;
    const col = n % SHEET.cols, row = Math.floor(n / SHEET.cols);
    const scan = canvasOf(w, h);
    scan.g.drawImage(bmp, col * cw + ix, row * ch + iy, cw - 2 * ix, ch - 2 * iy, 0, 0, w, h);
    const box = clean(scan, opts);
    if (box) scans.push({ key, scan, box });
  });
  bmp.close();
  if (!scans.length) throw new Error("No pictures found in that sheet.");
  return exportTogether(scans);
}

// ── Steps ─────────────────────────────────────────────────────────────────────

async function bitmapOf(file: Blob): Promise<ImageBitmap> {
  if (!file.type.startsWith("image/") && file.type !== "") throw new Error("That isn't a picture.");
  if (file.size > MAX_FILE) throw new Error("That picture is too big (25 MB at most).");
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error("That picture couldn't be opened.");
  }
}

/** The picture, no bigger than SCAN_SIDE. */
async function scanOf(file: Blob): Promise<Scan> {
  const bmp = await bitmapOf(file);
  const k = Math.min(1, SCAN_SIDE / Math.max(bmp.width, bmp.height));
  const scan = canvasOf(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
  scan.g.drawImage(bmp, 0, 0, scan.c.width, scan.c.height);
  bmp.close();
  return scan;
}

/** Takes away a plain background (if asked) and finds what's left; null when nothing is. */
function clean(scan: Scan, opts: PrepareOptions): Box | null {
  const img = scan.g.getImageData(0, 0, scan.c.width, scan.c.height);
  if (opts.plainBackground && clearBackground(img)) scan.g.putImageData(img, 0, 0);
  return solidBox(img);
}

/** Every picture cropped to the same box (the union of theirs) when they're one size, else each to its own. */
async function exportTogether<K>(scans: { key: K; scan: Scan; box: Box }[]): Promise<Map<K, string>> {
  const sameSize = scans.every((s) => s.scan.c.width === scans[0].scan.c.width && s.scan.c.height === scans[0].scan.c.height);
  const union = sameSize && scans.length ? unionOf(scans.map((s) => s.box)) : null;
  const out = new Map<K, string>();
  for (const s of scans) out.set(s.key, await exportBox(s.scan, union ?? s.box));
  return out;
}

function unionOf(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** That part of the picture, at most MAX_SIDE, as a PNG (base64). */
async function exportBox(scan: Scan, box: Box): Promise<string> {
  const s = Math.min(1, MAX_SIDE / Math.max(box.w, box.h));
  const out = canvasOf(Math.max(1, Math.round(box.w * s)), Math.max(1, Math.round(box.h * s)));
  out.g.imageSmoothingQuality = "high";
  out.g.drawImage(scan.c, box.x, box.y, box.w, box.h, 0, 0, out.c.width, out.c.height);
  const png = await new Promise<Blob | null>((done) => out.c.toBlob(done, "image/png"));
  if (!png) throw new Error("That picture couldn't be saved.");
  return base64(png);
}

function canvasOf(w: number, h: number): Scan {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("Pictures can't be read here.");
  return { c, g };
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

// ── Pixels ────────────────────────────────────────────────────────────────────

type Pixels = { width: number; height: number; data: Uint8ClampedArray };

/** The smallest box holding every solid pixel, or null when there's none. */
export function solidBox(img: Pixels): Box | null {
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

/**
 * Takes away a plain background: when the picture's edge is (nearly) all one
 * opaque colour, everything of that colour reachable from the edge becomes
 * see-through, and the pixels along the character's outline fade out as far as
 * they're the background's colour (no white fringe). Colour enclosed by the
 * character (white eyes on a white background) is left alone. False, changing
 * nothing, when the edge isn't one plain colour (a photo, or already see-through).
 */
export function clearBackground(img: Pixels, fixedTolerance?: number): boolean {
  const { width: w, height: h, data: d } = img;
  if (w < 3 || h < 3) return false;
  const edge: number[] = [];
  for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1);

  let opaque = 0, r = 0, g = 0, b = 0;
  for (const i of edge) {
    if (d[i * 4 + 3] < 250) continue;
    opaque++;
    r += d[i * 4];
    g += d[i * 4 + 1];
    b += d[i * 4 + 2];
  }
  if (opaque < edge.length * 0.9) return false;
  r /= opaque;
  g /= opaque;
  b /= opaque;
  const dist2 = (i: number) => (d[i * 4] - r) ** 2 + (d[i * 4 + 1] - g) ** 2 + (d[i * 4 + 2] - b) ** 2;
  // The background's noise: how far its edge pixels stray from their own colour, on average.
  let noise = 0;
  for (const i of edge) if (d[i * 4 + 3] >= 250) noise += Math.sqrt(dist2(i));
  noise /= opaque;
  const { least, most, perNoise } = BACKGROUND_TOLERANCE;
  const tolerance = fixedTolerance ?? Math.min(most, Math.max(least, least + perNoise * noise));
  const t2 = tolerance * tolerance;
  const near = (i: number) => d[i * 4 + 3] >= 250 && dist2(i) <= t2;
  if (edge.filter(near).length < edge.length * 0.85) return false;

  // Flood in from the edge through background-coloured pixels.
  const bg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (const i of edge) {
    if (!bg[i] && near(i)) {
      bg[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1]) {
      if (n >= 0 && !bg[n] && near(n)) {
        bg[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  for (let i = 0; i < w * h; i++) if (bg[i]) d[i * 4 + 3] = 0;
  // The outline: pixels next to the background fade by how close to its colour they are.
  for (let i = 0; i < w * h; i++) {
    if (bg[i]) continue;
    const x = i % w;
    const touches = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (i >= w && bg[i - w]) || (i < w * (h - 1) && bg[i + w]);
    if (!touches) continue;
    const dd = Math.sqrt(dist2(i));
    if (dd < 2 * tolerance) d[i * 4 + 3] = Math.min(d[i * 4 + 3], Math.round((255 * (dd - tolerance)) / tolerance));
  }
  return true;
}
