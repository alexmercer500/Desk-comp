// Reads the files out of a .zip (your own character's pictures, Settings),
// without a library: the zip's own directory, then each file stored as it is
// or deflated, which the browser undoes (DecompressionStream). Encrypted and
// zip64 files, folders, and anything too big or too many are left out.

/** At most this many files are taken out of one zip. */
const MAX_FILES = 64;
/** Largest file taken out, bytes, and all of them together. */
const MAX_FILE = 30 << 20;
const MAX_TOTAL = 120 << 20;

export interface ZipEntry {
  /** Its path inside the zip, with "/" between folders. */
  name: string;
  data: Blob;
}

/** The files in `zip`. Throws an Error with words for the user when it isn't a zip it can read. */
export async function readZip(zip: Blob): Promise<ZipEntry[]> {
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(view);
  if (end < 0) throw new Error("That isn't a zip file.");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: ZipEntry[] = [];
  let total = 0;
  for (let k = 0; k < count && out.length < MAX_FILES; k++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new Error("That zip file is damaged.");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder(flags & 0x800 ? "utf-8" : "latin1").decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;

    const usable =
      !name.endsWith("/") && // a folder
      !(flags & 1) && // encrypted
      packed !== 0xffffffff && size !== 0xffffffff && // zip64
      (method === 0 || method === 8) &&
      size <= MAX_FILE &&
      total + size <= MAX_TOTAL;
    if (!usable) continue;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packed > bytes.length) continue;
    const raw = bytes.slice(start, start + packed);
    let data: Blob;
    try {
      data = method === 0 ? new Blob([raw]) : await inflate(raw);
    } catch {
      continue;
    }
    if (data.size > MAX_FILE) continue;
    total += data.size;
    out.push({ name, data });
  }
  return out;
}

/** Where the zip's "end of central directory" record starts, or −1. */
function findEnd(view: DataView): number {
  const last = view.byteLength - 22;
  // It may be followed by a comment of up to 65535 bytes.
  for (let at = last; at >= 0 && at >= last - 0xffff; at--) {
    if (view.getUint32(at, true) === 0x06054b50) return at;
  }
  return -1;
}

async function inflate(raw: Uint8Array<ArrayBuffer>): Promise<Blob> {
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).blob();
}
