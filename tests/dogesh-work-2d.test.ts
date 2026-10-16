// Dogesh Bhai's 2D working poses by kind of work (reading, running a command,
// the web, waiting for an OK, a question): every one draws in every outfit
// for minutes without throwing or passing a NaN to the canvas, brings out its
// own prop, keeps going (it's a loop, not a one-off), and plain working is
// left as it was.

import { beforeAll, describe, expect, it } from "vitest";
import type { Frame, PoseInput, WorkVariant } from "../src/engine/types";

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
  const state: Record<string | symbol, unknown> = {};
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
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, count: () => calls, bad };
}

const VARIANTS: WorkVariant[] = ["research", "run", "browse", "wait", "ask"];
/** The channel that shows each one's prop or mark. */
const PROP: Record<WorkVariant, string> = { research: "book", run: "button", browse: "bino", wait: "sign", ask: "qmark" };
const input = (variant: WorkVariant | null, st: number, motion = 1): PoseInput => ({
  state: "WORKING", variant, st, t: (st / 1000 + 2.3) * motion, motion, progress: 0.5, carryX: 0, carryY: 0,
});

describe("Dogesh Bhai's working poses (2D)", () => {
  let mod: typeof import("../src/skins/dogesh");
  let outfits: typeof import("../src/skins/dogesh-outfits");
  beforeAll(async () => {
    mod = await import("../src/skins/dogesh");
    outfits = await import("../src/skins/dogesh-outfits");
  });

  it("draw in every outfit, for minutes, without throwing or NaNs", () => {
    const skin = mod.dogesh;
    const problems: string[] = [];
    const moments = [0, 150, 400, 900, 1480, 1700, 2300, 2800, 3100, 3500, 4400, 5200, 6100, 9950, 12_345, 47_000, 180_000];
    for (const name of outfits.OUTFIT_NAMES) {
      mod.setDogeshOutfit(name);
      for (const variant of VARIANTS) {
        for (const st of moments) {
          for (const motion of [1, 0]) {
            const i = input(variant, st, motion);
            const out = skin.pose(i);
            for (const [key, value] of Object.entries(out.pose)) {
              if (!Number.isFinite(value) || !(key in skin.rest)) problems.push(`${name} ${variant} @${st} ${key}=${value}`);
            }
            const pose = { ...skin.rest, eyeMorph: 1, gazeX: 0.1, gazeY: 0, lagX: 0, lagY: 0, ...out.pose };
            for (const size of [160, 52]) {
              const { ctx, count, bad } = recordingContext();
              const frame: Frame = { U: size / 1.6, ox: size / 2, oy: size * 0.88, size, t: i.t, detail: Math.max(0, Math.min(1, (size - 56) / 120)) };
              try {
                skin.draw(ctx, pose, out.eye, frame);
              } catch (err) {
                problems.push(`${name} ${variant} @${st} threw ${String(err)}`);
              }
              if (!count()) problems.push(`${name} ${variant} @${st} drew nothing`);
              for (const b of bad.slice(0, 2)) problems.push(`${name} ${variant} @${st}: ${b}`);
            }
          }
        }
      }
    }
    mod.setDogeshOutfit("cozy");
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it("each brings out its own prop, and keeps it out", () => {
    for (const variant of VARIANTS) {
      for (const st of [1000, 30_000, 300_000]) {
        for (const motion of [1, 0]) {
          const p = mod.dogesh.pose(input(variant, st, motion)).pose;
          expect(p[PROP[variant]] ?? 0, `${variant} @${st}`).toBeGreaterThan(0.9);
          for (const other of VARIANTS) if (other !== variant) expect(p[PROP[other]] ?? 0, `${variant} has ${PROP[other]}`).toBe(0);
        }
      }
    }
  });

  it("keep moving: the beats come round again", () => {
    const span = (variant: WorkVariant, key: string, from: number) => {
      let lo = Infinity, hi = -Infinity;
      for (let st = from; st < from + 12_000; st += 50) {
        const v = mod.dogesh.pose(input(variant, st)).pose[key] ?? 0;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      return hi - lo;
    };
    for (const from of [0, 120_000]) {
      expect(span("research", "page", from)).toBeGreaterThan(0.9); // pages turn
      expect(span("run", "press", from)).toBeGreaterThan(0.9); // he presses again
      expect(span("browse", "binoDrop", from)).toBeGreaterThan(0.9); // double takes
      expect(span("wait", "signTap", from)).toBeGreaterThan(0.9); // taps the sign
      expect(span("ask", "gazeLockY", from)).toBeGreaterThan(0.5); // looks up, then at you
    }
    // Reduced motion: the beats still come, only smaller.
    const calm = (variant: WorkVariant, st: number) => mod.dogesh.pose(input(variant, st, 0)).pose;
    expect(Math.abs(calm("run", 8400).headTilt ?? 0)).toBeLessThan(Math.abs(mod.dogesh.pose(input("run", 8400)).pose.headTilt ?? 0));
  });

  it("leave plain working as it was, and the outfits' working props to it", () => {
    for (const name of ["cozy", "detective", "coder"] as const) {
      mod.setDogeshOutfit(name);
      const plain = mod.dogesh.pose(input(null, 2000)).pose;
      for (const key of ["book", "lens", "button", "bino", "sign", "chin", "excl"]) expect(plain[key] ?? 0).toBe(0);
      if (name !== "cozy") expect(plain.prop).toBeGreaterThan(0.9);
      for (const variant of VARIANTS) expect(mod.dogesh.pose(input(variant, 2000)).pose.prop ?? 0).toBe(0);
    }
    mod.setDogeshOutfit("cozy");
  });
});
