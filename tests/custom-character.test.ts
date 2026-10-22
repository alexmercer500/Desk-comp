// Your own character: which picture each moment shows, where it can be
// clicked, and the see-through edges trimmed off a picture.

import { describe, expect, it } from "vitest";
import { custom, moodOf, pictureFor, setCustomPictures, setCustomShape } from "../src/skins/custom";
import { solidBox } from "../src/panel/picture";

const pic = (width: number, height: number) => ({ width, height }) as unknown as HTMLCanvasElement;

describe("your own character", () => {
  it("shows the picture for the moment: working, needing you, done, an error, asleep, else the main one", () => {
    expect(moodOf("WORKING", null)).toBe("working");
    expect(moodOf("WORKING", "research")).toBe("working");
    expect(moodOf("WORKING", "wait")).toBe("waiting");
    expect(moodOf("WORKING", "ask")).toBe("waiting");
    expect(moodOf("NOTIFY", null)).toBe("waiting");
    expect(moodOf("SUCCESS", "short")).toBe("done");
    expect(moodOf("ERROR", null)).toBe("error");
    expect(moodOf("SLEEPY", null)).toBe("sleeping");
    expect(moodOf("SLEEPING", null)).toBe("sleeping");
    for (const s of ["IDLE", "ATTENTIVE", "TOUCHED", "HELD", "LANDING", "BOOTING", "WAKING", "CONFUSED", "SUGGESTING"] as const) {
      expect(moodOf(s, null)).toBe("idle");
    }
  });

  it("a mood without its own picture shows the main one", () => {
    const main = pic(100, 100);
    const done = pic(80, 120);
    setCustomPictures({ idle: main, done });
    expect(pictureFor("done")).toBe(done);
    expect(pictureFor("error")).toBe(main);
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
