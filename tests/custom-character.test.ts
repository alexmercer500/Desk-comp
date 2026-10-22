// Your own character: which picture each moment shows, where it can be
// clicked, pictures made ready (trimmed, plain backgrounds taken away), and
// pictures coming in from an AI: named files, zips, and the prompts.

import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MOODS, custom, moodOf, pictureFor, setCustomPictures, setCustomShape } from "../src/skins/custom";
import { clearBackground, sheetCuts, solidBox } from "../src/panel/picture";
import { FILE_NAMES, filesPrompt, isPictureName, moodFromName, sheetPrompt } from "../src/panel/character-import";
import { readZip } from "../src/panel/zip";

const pic = (width: number, height: number) => ({ width, height }) as unknown as HTMLCanvasElement;

describe("your own character", () => {
  it("shows the picture for the moment: working, needing you, done, an error, asleep, poked, else the main one", () => {
    expect(moodOf("WORKING", null)).toBe("working");
    expect(moodOf("WORKING", "research")).toBe("working");
    expect(moodOf("WORKING", "wait")).toBe("waiting");
    expect(moodOf("WORKING", "ask")).toBe("waiting");
    expect(moodOf("NOTIFY", null)).toBe("waiting");
    expect(moodOf("SUCCESS", "short")).toBe("done");
    expect(moodOf("ERROR", null)).toBe("error");
    expect(moodOf("SLEEPY", null)).toBe("sleeping");
    expect(moodOf("SLEEPING", null)).toBe("sleeping");
    for (const s of ["TOUCHED", "HELD", "LANDING", "CONFUSED"] as const) expect(moodOf(s, null)).toBe("surprised");
    for (const s of ["IDLE", "ATTENTIVE", "BOOTING", "WAKING", "SUGGESTING"] as const) expect(moodOf(s, null)).toBe("idle");
  });

  it("a mood without its own picture shows the main one; asleep, the closed eyes if there are", () => {
    const main = pic(100, 100);
    const done = pic(80, 120);
    setCustomPictures({ idle: main, done });
    expect(pictureFor("done")).toBe(done);
    expect(pictureFor("error")).toBe(main);
    expect(pictureFor("sleeping")).toBe(main);
    const blink = pic(100, 100);
    setCustomPictures({ idle: main, blink });
    expect(pictureFor("sleeping")).toBe(blink);
    setCustomPictures({});
    expect(pictureFor("idle")).toBeUndefined();
  });

  it("can be clicked on its picture, a tall one narrower than a wide one", () => {
    setCustomShape("free");
    setCustomPictures({ idle: pic(100, 200) });
    const tall = { ...custom.hit };
    setCustomPictures({ idle: pic(200, 100) });
    const wide = { ...custom.hit };
    expect(tall.x1 - tall.x0).toBeLessThan(wide.x1 - wide.x0);
    expect(tall.y0).toBeLessThan(wide.y0);
    for (const h of [tall, wide]) {
      expect(h.x0).toBeGreaterThanOrEqual(0);
      expect(h.x1).toBeLessThanOrEqual(1);
      expect(h.y0).toBeGreaterThanOrEqual(0);
      expect(h.y1).toBeLessThanOrEqual(1);
    }
    // A round sticker is the same size whatever the picture.
    setCustomShape("round");
    const round = { ...custom.hit };
    setCustomPictures({ idle: pic(100, 200) });
    expect(custom.hit).toEqual(round);
    setCustomShape("free");
  });
});

describe("trimming a picture", () => {
  const image = (w: number, h: number, solid: [number, number][]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (const [x, y] of solid) data[(y * w + x) * 4 + 3] = 255;
    return { width: w, height: h, data };
  };

  it("keeps the smallest box round everything that isn't see-through", () => {
    expect(solidBox(image(10, 8, [[3, 2], [6, 5]]))).toEqual({ x: 3, y: 2, w: 4, h: 4 });
    expect(solidBox(image(4, 4, [[0, 0], [3, 3]]))).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });

  it("finds nothing in a picture that's see-through all over", () => {
    expect(solidBox(image(5, 5, []))).toBeNull();
  });
});

describe("clearing a plain background", () => {
  /** A w × h picture of one colour, with a box of another in the middle and a white "eye" inside it. */
  const picture = (w: number, h: number, bg: number[]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([...bg, 255], i * 4);
    for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) data.set([40, 120, 90, 255], (y * w + x) * 4);
    data.set([255, 255, 255, 255], ((h >> 1) * w + (w >> 1)) * 4);
    return { width: w, height: h, data };
  };
  const alpha = (img: { width: number; data: Uint8ClampedArray }, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];

  it("takes away the background round the character, but not white inside it", () => {
    const img = picture(12, 10, [255, 255, 255]);
    expect(clearBackground(img)).toBe(true);
    expect(alpha(img, 0, 0)).toBe(0);
    expect(alpha(img, 11, 9)).toBe(0);
    expect(alpha(img, 5, 5)).toBe(255);
    expect(alpha(img, 6, 5)).toBe(255); // the white eye, enclosed
    expect(solidBox(img)).toEqual({ x: 3, y: 3, w: 6, h: 4 });
  });

  it("on a clean background, keeps a pale edge (cream fur on white)", () => {
    const img = picture(12, 10, [255, 255, 255]);
    // A cream rim round the character, 26 away from white, as a bunny's ears were in an AI sheet.
    for (let x = 2; x < 10; x++) img.data.set([254, 250, 230, 255], (2 * 12 + x) * 4);
    expect(clearBackground(img)).toBe(true);
    expect(alpha(img, 5, 2)).toBeGreaterThan(150);
    expect(alpha(img, 0, 0)).toBe(0);
  });

  it("leaves a picture alone when its edge isn't one colour (a photo) or is already see-through", () => {
    const photo = picture(12, 10, [255, 255, 255]);
    for (let x = 0; x < 12; x += 2) photo.data.set([10, 10, 10, 255], x * 4);
    for (let y = 0; y < 10; y += 2) photo.data.set([200, 20, 20, 255], y * 12 * 4);
    const before = photo.data.slice();
    expect(clearBackground(photo)).toBe(false);
    expect(photo.data).toEqual(before);
    const clear = picture(12, 10, [255, 255, 255]);
    for (let i = 0; i < 120; i++) if (clear.data[i * 4] === 255) clear.data[i * 4 + 3] = 0;
    expect(clearBackground(clear)).toBe(false);
  });
});

describe("finding a sheet's cells", () => {
  /** A see-through w × h picture with a solid blob at each of these boxes [x, y, w, h]. */
  const blobs = (w: number, h: number, boxes: [number, number, number, number][]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (const [bx, by, bw, bh] of boxes) for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) data[(y * w + x) * 4 + 3] = 255;
    return { width: w, height: h, data };
  };
  /** 8 characters in a 4 × 2 grid of 100 × 100 cells, each `at` its cell's left plus a nudge. */
  const grid = (nudge: (n: number) => number) =>
    blobs(400, 200, [...Array(8)].map((_, n) => [(n % 4) * 100 + 20 + nudge(n), Math.floor(n / 4) * 100 + 15, 60, 70] as [number, number, number, number]));

  it("cuts in the gaps between the characters, even when the AI's grid isn't even", () => {
    const even = sheetCuts(grid(() => 0));
    expect(even).not.toBeNull();
    expect(even!.xs).toHaveLength(5);
    expect(even!.ys).toHaveLength(3);
    // Characters nudged 15 px right or left: each cut still falls in a gap, never through one.
    const uneven = blobs(400, 200, [
      [35, 15, 60, 70], [105, 15, 60, 70], [235, 15, 50, 70], [310, 15, 60, 70],
      [10, 112, 60, 70], [130, 112, 60, 70], [205, 112, 60, 70], [330, 112, 60, 70],
    ]);
    const cuts = sheetCuts(uneven);
    expect(cuts).not.toBeNull();
    expect(cuts!.xs[1]).toBeGreaterThanOrEqual(95);
    expect(cuts!.xs[1]).toBeLessThanOrEqual(105);
    expect(cuts!.ys[1]).toBeGreaterThan(85);
    expect(cuts!.ys[1]).toBeLessThan(112);
  });

  it("isn't fooled by one wide picture, a missing character, or a square picture", () => {
    expect(sheetCuts(blobs(400, 200, [[20, 20, 360, 160]]))).toBeNull();
    expect(sheetCuts(blobs(400, 200, [...Array(7)].map((_, n) => [(n % 4) * 100 + 20, Math.floor(n / 4) * 100 + 15, 60, 70] as [number, number, number, number])))).toBeNull();
    expect(sheetCuts(blobs(200, 200, [[50, 50, 100, 100]]))).toBeNull();
  });
});

describe("pictures named after their mood", () => {
  it("knows the prompt's names, other usual ones, and a sheet", () => {
    for (const m of MOODS) expect(moodFromName(FILE_NAMES[m])).toBe(m);
    expect(moodFromName("pics/Mochi_Asleep.webp")).toBe("sleeping");
    expect(moodFromName("character-happy.PNG")).toBe("done");
    expect(moodFromName("idle-blink.png")).toBe("blink");
    expect(moodFromName("1 main.jpg")).toBe("idle");
    expect(moodFromName("character_sheet.png")).toBe("sheet");
    expect(moodFromName("ChatGPT Image Oct 22, 2026, 10_01_02 AM.png")).toBeNull();
    expect(moodFromName("workingdog.png")).toBeNull(); // whole words only
  });

  it("only pictures are taken from a zip, not its folders' leftovers", () => {
    expect(isPictureName("char/idle.png")).toBe(true);
    expect(isPictureName("readme.txt")).toBe(false);
    expect(isPictureName("__MACOSX/char/._idle.png")).toBe(false);
  });

  it("the prompts ask for all 8, in the order a sheet is cut up, and name every file", () => {
    const sheet = sheetPrompt();
    expect(sheet).toContain("4 columns and 2 rows");
    expect(sheet.indexOf("1. Idle")).toBeLessThan(sheet.indexOf("2. Blink"));
    expect(sheet).toContain("8. Surprised");
    const files = filesPrompt();
    for (const m of MOODS) expect(files).toContain(FILE_NAMES[m]);
  });
});

describe("reading a zip", () => {
  /** A zip with these files, the first stored, the rest deflated. */
  function zip(files: [string, string][]): Blob {
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    files.forEach(([name, text], n) => {
      const raw = new TextEncoder().encode(text);
      const data = n === 0 ? raw : new Uint8Array(deflateRawSync(raw));
      const nameBytes = new TextEncoder().encode(name);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(8, n === 0 ? 0 : 8, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, raw.length, true);
      local.setUint16(26, nameBytes.length, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(8, 0x800, true);
      c.setUint16(10, n === 0 ? 0 : 8, true);
      c.setUint32(20, data.length, true);
      c.setUint32(24, raw.length, true);
      c.setUint16(28, nameBytes.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    });
    const size = central.reduce((a, p) => a + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[]);
  }

  it("gets every file out, stored or deflated", async () => {
    const entries = await readZip(zip([["idle.png", "first"], ["moods/done.png", "second ".repeat(50)], ["blink.png", "third"]]));
    expect(entries.map((e) => e.name)).toEqual(["idle.png", "moods/done.png", "blink.png"]);
    expect(await entries[1].data.text()).toBe("second ".repeat(50));
    expect(await entries[2].data.text()).toBe("third");
  });

  it("says so when it isn't a zip", async () => {
    await expect(readZip(new Blob(["not a zip at all, just text"]))).rejects.toThrow("isn't a zip");
  });
});
