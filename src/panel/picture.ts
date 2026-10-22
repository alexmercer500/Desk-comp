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
/** Each cell's edges left out when cut into equal cells, as a share of its size: a grid line or a neighbour's stray pixels. */
const CELL_INSET = 0.02;
/** Longest side a sheet is cut up at, px: its cells then come out at about SCAN_SIDE / 2. */
const SHEET_SIDE = 2048;
/** A sheet is about twice as wide as tall (4 × 2 roughly square cells). */
const SHEET_RATIO = { least: 1.4, most: 2.8 };
/** Where to look for each gap between cells: this share of the picture either side of where it would be in an even grid. */
const GAP_WINDOW = 0.07;
/** A line counts as a gap when at most this share of it is solid. */
const GAP_SOLID = 0.004;
/** A cell counts as having a character when at least this share of it is solid. */
const CELL_FILLED = 0.02;

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

/**
 * A sheet: one picture with a mood in each cell of SHEET, in `order`. It's cut
 * along the empty gaps between the characters where it has them (an AI's grid
 * is rarely exact), else into equal cells. Empty cells are left out.
 */
export async function splitSheet<K>(file: Blob, order: readonly K[], opts: PrepareOptions): Promise<Map<K, string>> {
  const sheet = await sheetOf(file, SHEET_SIDE, opts);
  const { c, img } = sheet;
  const cuts = sheetCuts(img);
  const even = (n: number, of: number, size: number) => Math.round((size * n) / of);
  const xs = cuts?.xs ?? [0, 1, 2, 3, 4].map((n) => even(n, SHEET.cols, c.width));
  const ys = cuts?.ys ?? [0, 1, 2].map((n) => even(n, SHEET.rows, c.height));
  // Equal cells lose a little at their edges: a grid line, or a neighbour's stray pixels.
  const inset = cuts ? 0 : CELL_INSET;
  const cells = order.slice(0, SHEET.cols * SHEET.rows).map((key, n) => {
    const col = n % SHEET.cols, row = Math.floor(n / SHEET.cols);
    const ix = Math.round((xs[col + 1] - xs[col]) * inset), iy = Math.round((ys[row + 1] - ys[row]) * inset);
    return { key, x: xs[col] + ix, y: ys[row] + iy, w: xs[col + 1] - xs[col] - 2 * ix, h: ys[row + 1] - ys[row] - 2 * iy };
  });
  if (cells.some((cell) => cell.w < 16 || cell.h < 16)) throw new Error("That picture is too small to be a sheet.");
  // Each cell centred in a canvas of the largest cell's size, so they can be trimmed as one.
  const cw = Math.max(...cells.map((cell) => cell.w)), ch = Math.max(...cells.map((cell) => cell.h));
  const scans: { key: K; scan: Scan; box: Box }[] = [];
  for (const cell of cells) {
    const scan = canvasOf(cw, ch);
    scan.g.drawImage(c, cell.x, cell.y, cell.w, cell.h, Math.floor((cw - cell.w) / 2), Math.floor((ch - cell.h) / 2), cell.w, cell.h);
    const box = solidBox(scan.g.getImageData(0, 0, cw, ch));
    if (box) scans.push({ key: cell.key, scan, box });
  }
  if (!scans.length) throw new Error("No pictures found in that sheet.");
  return exportTogether(scans);
}

/**
 * Whether a picture is a sheet of SHEET's moods rather than one picture: wide
 * like one, with a character in every cell and an empty gap between each.
 * (Picked in one mood's slot, it's cut up instead of kept whole.)
 */
export async function isSheet(file: Blob, opts: PrepareOptions): Promise<boolean> {
  try {
    const { img } = await sheetOf(file, SCAN_SIDE, opts);
    return sheetCuts(img) !== null;
  } catch {
    return false;
  }
}

/** The whole sheet, no bigger than `side`, its plain background taken away (if asked). */
async function sheetOf(file: Blob, side: number, opts: PrepareOptions): Promise<{ c: HTMLCanvasElement; img: ImageData }> {
  const bmp = await bitmapOf(file);
  const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
  const s = canvasOf(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
  s.g.drawImage(bmp, 0, 0, s.c.width, s.c.height);
  bmp.close();
  const img = s.g.getImageData(0, 0, s.c.width, s.c.height);
  if (opts.plainBackground && clearBackground(img)) s.g.putImageData(img, 0, 0);
  return { c: s.c, img };
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
 * Where to cut a sheet (see-through background): the x of each column's edges
 * (5, from 0 to the width) and the y of each row's (3), each inner one in the
 * middle of the empty gap nearest where an even grid would put it. Null when
 * it isn't a sheet: not about 2:1, a gap missing, or a cell with nothing in it.
 */
export function sheetCuts(img: Pixels): { xs: number[]; ys: number[] } | null {
  const { width: w, height: h, data } = img;
  const ratio = w / h;
  if (ratio < SHEET_RATIO.least || ratio > SHEET_RATIO.most) return null;
  // Solid pixels in each column and each row.
  const cols = new Uint32Array(w), rows = new Uint32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] >= SOLID) {
        cols[x]++;
        rows[y]++;
      }
    }
  }
  /** The middle of the empty run (a gap) nearest `at`, looking within ±window; null when there's none. */
  const gap = (counts: Uint32Array, length: number, across: number, at: number, window: number): number | null => {
    const empty = (i: number) => counts[i] <= across * GAP_SOLID;
    let best: number | null = null;
    for (let i = Math.max(1, at - window); i <= Math.min(length - 2, at + window); i++) {
      if (!empty(i)) continue;
      // The run of empty lines through i, and its middle.
      let a = i, b = i;
      while (a > 0 && empty(a - 1)) a--;
      while (b < length - 1 && empty(b + 1)) b++;
      const mid = Math.round((a + b) / 2);
      if (best === null || Math.abs(mid - at) < Math.abs(best - at)) best = mid;
      i = b;
    }
    return best;
  };
  const xs = [0];
  for (let n = 1; n < SHEET.cols; n++) {
    const x = gap(cols, w, h, Math.round((w * n) / SHEET.cols), Math.round(w * GAP_WINDOW));
    if (x === null || x <= xs[xs.length - 1]) return null;
    xs.push(x);
  }
  xs.push(w);
  const y = gap(rows, h, w, Math.round(h / 2), Math.round(h * GAP_WINDOW * 2));
  if (y === null) return null;
  const ys = [0, y, h];
  // A character in every cell.
  for (let r = 0; r < SHEET.rows; r++) {
    for (let c = 0; c < SHEET.cols; c++) {
      let solid = 0;
      for (let yy = ys[r]; yy < ys[r + 1]; yy++) {
        for (let xx = xs[c]; xx < xs[c + 1]; xx++) if (data[(yy * w + xx) * 4 + 3] >= SOLID) solid++;
      }
      if (solid < (xs[c + 1] - xs[c]) * (ys[r + 1] - ys[r]) * CELL_FILLED) return null;
    }
  }
  return { xs, ys };
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
