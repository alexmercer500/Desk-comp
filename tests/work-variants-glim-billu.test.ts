// Glim's and Billu's kinds of work (WORKING's variants): every one poses and
// draws without throwing or passing a NaN to the canvas, at full and reduced
// motion and halfway through a crossfade between any two; each shows its own
// prop; and plain WORKING (editing) shows none of them.

import { beforeAll, describe, expect, it } from "vitest";
import type { Frame, Pose, PoseInput, Skin, Variant } from "../src/engine/types";

// Skins build Path2D shapes when they load; Node has no canvas, so stub it.
beforeAll(() => {
  (globalThis as Record<string, unknown>).Path2D ??= class {
    moveTo() {}
    lineTo() {}
    arc() {}
    arcTo() {}
    ellipse() {}
    rect() {}
    roundRect() {}
    quadraticCurveTo() {}
    bezierCurveTo() {}
    closePath() {}
  };
});

/** A 2D context that accepts everything and records calls given a number that isn't finite. */
function recordingContext() {
  let calls = 0;
  const bad: string[] = [];
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, lineWidth: 1, shadowBlur: 0 };
  const gradient = { addColorStop(o: number) { if (!Number.isFinite(o)) bad.push(`addColorStop(${o})`); } };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "createRadialGradient" || prop === "createLinearGradient") {
        return (...args: number[]) => {
          for (const a of args) if (!Number.isFinite(a)) bad.push(`${String(prop)}(${args.join(",")})`);
          return gradient;
        };
      }
      return (...args: unknown[]) => {
        calls++;
        for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) bad.push(`${String(prop)}(${args.join(",")})`);
      };
    },
    set(target, prop, value) {
      if (typeof value === "number" && !Number.isFinite(value)) bad.push(`${String(prop)}=${value}`);
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, count: () => calls, bad };
}

const KINDS: Variant[] = [null, "research", "run", "browse", "wait", "ask"];
const MOMENTS = [0, 120, 470, 900, 1600, 3300, 4300, 6150, 7700, 8850, 9250, 12000, 61000, 600000];
/** The prop channel each kind must show. */
const PROPS: Record<string, Record<string, string>> = {
  glim: { research: "lens", run: "console", browse: "binoc", wait: "bang", ask: "ask" },
  billu: { research: "book", run: "btn", browse: "scope", wait: "bang", ask: "ask" },
};

const frame = (size: number): Frame => ({ U: size / 1.6, ox: size / 2, oy: size * 0.86, size, t: 3.7, detail: size > 100 ? 0.9 : 0 });
const input = (variant: Variant, st: number, motion: number): PoseInput => ({
  state: "WORKING", variant, st, t: motion ? st / 1000 + 3.7 : 0, motion, progress: null, carryX: 0, carryY: 0,
});

describe.each(["glim", "billu"])("%s at work", (name) => {
  let skin: Skin;
  beforeAll(async () => {
    skin = (await import("../src/skins"))["SKINS"][name as "glim"];
  });
  /** A pose as the engine hands it to draw. */
  const full = (out: Partial<Pose>): Pose => ({ ...skin.rest, ...out, eyeMorph: 1, gazeX: 0.2, gazeY: -0.1, lagX: 0, lagY: 0 } as Pose);

  it.each(KINDS)("%s poses and draws cleanly", (variant) => {
    for (const st of MOMENTS) {
      for (const motion of [1, 0]) {
        const out = skin.pose(input(variant, st, motion));
        for (const [key, value] of Object.entries(out.pose)) {
          expect(Number.isFinite(value), `${variant} @${st} ${key}=${value}`).toBe(true);
          expect(key in skin.rest, `${key} missing from rest`).toBe(true);
        }
        for (const size of [160, 50]) {
          const rec = recordingContext();
          skin.draw(rec.ctx, full(out.pose), out.eye, frame(size));
          expect(rec.bad, `${variant} @${st}ms motion ${motion}`).toEqual([]);
          expect(rec.count()).toBeGreaterThan(20);
        }
      }
    }
  });

  it("draws halfway through a switch between any two kinds", () => {
    for (const a of KINDS) {
      for (const b of KINDS) {
        const pa = full(skin.pose(input(a, 2500, 1)).pose);
        const pb = full(skin.pose(input(b, 0, 1)).pose);
        const mid: Pose = {};
        for (const key in pb) mid[key] = (pa[key] + pb[key]) / 2;
        const rec = recordingContext();
        skin.draw(rec.ctx, mid, "round", frame(160));
        expect(rec.bad, `${a} → ${b}`).toEqual([]);
      }
    }
  });

  it("shows each kind's own prop, and none while editing", () => {
    const props = PROPS[name];
    for (const [kind, channel] of Object.entries(props)) {
      const shown = skin.pose(input(kind as Variant, 2000, 1)).pose;
      expect(shown[channel], `${kind} shows ${channel}`).toBeGreaterThan(0.5);
      for (const [other, ch] of Object.entries(props)) {
        if (other !== kind && ch !== channel) expect(shown[ch] ?? 0, `${kind} hides ${ch}`).toBe(0);
      }
    }
    const editing = skin.pose(input(null, 2000, 1)).pose;
    for (const ch of Object.values(props)) expect(editing[ch] ?? 0).toBe(0);
  });

  it("loops on and on: the same pose a whole number of cycles later", () => {
    // Each kind's whole cycle (for both characters), in ms; with body motion
    // off the engine clock `t` doesn't enter, so a cycle later looks the same.
    const cycle: Record<string, number> = { research: 16800, run: 5200, browse: 304000, wait: 7200, ask: 39000 };
    for (const kind of KINDS.slice(1)) {
      for (const st of [1234, 5678]) {
        const a = skin.pose(input(kind, st, 0)).pose;
        const b = skin.pose(input(kind, st + 3 * cycle[kind!], 0)).pose;
        for (const key in a) expect(b[key], `${kind} ${key}`).toBeCloseTo(a[key]!, 6);
      }
    }
  });
});
