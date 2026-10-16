// Kulhi and Hexo at work: every kind of work (WORKING's variants) poses and
// draws through a long loop, at full and reduced motion, without throwing or
// passing a NaN to the canvas; each looks different from plain working; and
// plain working is left as it was.

import { beforeAll, describe, expect, it } from "vitest";
import type { Frame, Pose, PoseInput, Skin, WorkVariant } from "../src/engine/types";

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

/** A 2D context that accepts everything and notes calls given a number that isn't finite. */
function recordingContext() {
  let calls = 0;
  const bad: string[] = [];
  // Starts as a real context does (skins multiply into globalAlpha).
  const state: Record<string | symbol, unknown> = { globalAlpha: 1 };
  const gradient = { addColorStop() {} };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "createRadialGradient" || prop === "createLinearGradient") {
        return (...args: unknown[]) => {
          for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) bad.push(`${String(prop)}(${args.join(",")})`);
          return gradient;
        };
      }
      return (...args: unknown[]) => {
        calls++;
        for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) bad.push(`${String(prop)}(${args.join(",")})`);
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      if (typeof value === "number" && !Number.isFinite(value)) bad.push(`${String(prop)}=${value}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, count: () => calls, bad };
}

const VARIANTS: (WorkVariant | null)[] = [null, "research", "run", "browse", "wait", "ask"];
// Through the first moments and well into each loop (the longest is 12.6 s), and minutes in.
const MOMENTS = [0, 16, 150, 300, 450, 700, 760, 900, 1300, 1700, 2600, 3000, 5200, 6600, 7100, 9100, 10300, 11900, 12650, 25400, 180_000];

const input = (variant: WorkVariant | null, st: number, motion: number): PoseInput => ({
  state: "WORKING", variant, st, t: motion ? st / 1000 + 3.7 : 0, motion, progress: null, carryX: 0, carryY: 0,
});

describe.each(["kulhi", "hexo"])("%s at work", (name) => {
  let skin: Skin;
  beforeAll(async () => {
    skin = (await import("../src/skins"))["SKINS"][name as "kulhi"];
  });

  it("poses and draws every kind of work without throwing or NaNs", () => {
    const problems: string[] = [];
    for (const variant of VARIANTS) {
      for (const st of MOMENTS) {
        for (const motion of [1, 0]) {
          const i = input(variant, st, motion);
          const out = skin.pose(i);
          for (const [key, value] of Object.entries(out.pose)) {
            if (!Number.isFinite(value) || !(key in skin.rest)) problems.push(`${variant} @${st} m${motion} ${key}=${value}`);
          }
          const pose: Pose = { ...skin.rest, eyeMorph: 1, gazeX: 0.2, gazeY: -0.1, lagX: 0.03 * motion, lagY: -0.01 * motion, ...out.pose };
          const { ctx, count, bad } = recordingContext();
          const frame: Frame = { U: 80, ox: 80, oy: 140, size: 160, t: i.t, detail: motion };
          try {
            skin.draw(ctx, pose, out.eye, frame);
          } catch (err) {
            problems.push(`${variant} @${st} m${motion} threw ${String(err)}`);
          }
          if (!count()) problems.push(`${variant} @${st} drew nothing`);
          for (const b of bad.slice(0, 2)) problems.push(`${variant} @${st} m${motion}: ${b}`);
          // Particles too.
          skin.events?.(i, Math.max(0, st - 120), (p) => {
            for (const [k, v] of Object.entries(p)) if (typeof v === "number" && !Number.isFinite(v)) problems.push(`${variant} @${st} particle ${k}=${v}`);
          }, pose);
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it("looks different for each kind of work", () => {
    // Compare the poses a second into each, and the eye shape.
    const sig = (v: WorkVariant | null) => {
      const out = skin.pose(input(v, 1000, 1));
      return JSON.stringify({ ...skin.rest, ...out.pose, eye: out.eye });
    };
    const seen = new Set(VARIANTS.map(sig));
    expect(seen.size).toBe(VARIANTS.length);
  });

  it("keeps plain working free of props", () => {
    for (const st of MOMENTS) {
      const out = skin.pose(input(null, st, 1));
      for (const key of ["book", "lens", "button", "spyglass", "sign", "page", "lever", "bino", "holo", "beam"]) {
        expect(out.pose[key], `${key} @${st}`).toBeUndefined();
      }
    }
  });
});
