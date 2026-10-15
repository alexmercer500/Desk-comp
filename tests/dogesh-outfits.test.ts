// Dogesh Bhai's outfits: every outfit draws through every state without
// throwing or passing a NaN to the canvas, the outfit really changes what's
// drawn, withDogeshOutfit puts the old one back, and the change scene swaps
// once and cleans up.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Frame, PoseInput, StateName, Variant } from "../src/engine/types";

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

/** A 2D context that accepts everything and records what it's asked to do. */
function recordingContext() {
  let calls = 0;
  /** Calls given a number that isn't finite. */
  const bad: string[] = [];
  const fills = new Set<string>();
  const state: Record<string | symbol, unknown> = {};
  const gradient = { addColorStop() {} };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "createRadialGradient" || prop === "createLinearGradient") return () => gradient;
      return (...args: unknown[]) => {
        calls++;
        for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) bad.push(`${String(prop)}(${args.join(",")})`);
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      if (prop === "fillStyle" && typeof value === "string") fills.add(value.toUpperCase());
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, fills, count: () => calls, bad };
}

const STATES: [StateName, Variant][] = [
  ["BOOTING", null], ["IDLE", null], ["ATTENTIVE", null], ["TOUCHED", null], ["TOUCHED", "dizzy"],
  ["WORKING", null], ["SUCCESS", null], ["SUCCESS", "short"], ["SUGGESTING", null], ["CONFUSED", null],
  ["ERROR", null], ["NOTIFY", null], ["NOTIFY", "ack"], ["SLEEPY", null], ["SLEEPING", null],
  ["WAKING", null], ["HELD", null], ["LANDING", null],
];
const MOMENTS = [0, 300, 700, 1500, 1900, 3000, 9900];

describe("Dogesh Bhai's outfits", () => {
  let mod: typeof import("../src/skins/dogesh");
  let outfits: typeof import("../src/skins/dogesh-outfits");
  beforeAll(async () => {
    mod = await import("../src/skins/dogesh");
    outfits = await import("../src/skins/dogesh-outfits");
  });
  afterEach(() => mod.setDogeshOutfit("cozy"));

  it("draws every outfit through every state without throwing or NaNs", () => {
    const skin = mod.dogesh;
    const problems: string[] = [];
    for (const name of outfits.OUTFIT_NAMES) {
      mod.setDogeshOutfit(name);
      for (const [state, variant] of STATES) {
        for (const st of MOMENTS) {
          for (const motion of [1, 0]) {
            const input: PoseInput = {
              state, variant, st, t: st / 1000 + 3.7, motion,
              progress: st % 2 ? 0.4 : null, carryX: state === "HELD" ? 800 : 0, carryY: 0,
            };
            const out = skin.pose(input);
            for (const [key, value] of Object.entries(out.pose)) {
              if (!Number.isFinite(value) || !(key in skin.rest)) problems.push(`${name} ${state} @${st} ${key}=${value}`);
            }
            const pose = { ...skin.rest, eyeMorph: 1, gazeX: 0.2, gazeY: 0, lagX: 0.03 * motion, lagY: -0.01 * motion, ...out.pose };
            const detail = motion ? 1 : 0;
            const { ctx, count, bad } = recordingContext();
            const frame: Frame = { U: 100, ox: 80, oy: 140, size: 160, t: input.t * motion, detail };
            try {
              skin.draw(ctx, pose, out.eye, frame);
            } catch (err) {
              problems.push(`${name} ${state} ${variant} @${st} threw ${String(err)}`);
            }
            if (!count()) problems.push(`${name} ${state} @${st} drew nothing`);
            for (const b of bad.slice(0, 2)) problems.push(`${name} ${state} @${st}: ${b}`);
          }
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it("draws each outfit's own clothes", () => {
    const skin = mod.dogesh;
    const out = skin.pose({ state: "IDLE", variant: null, st: 400, t: 0.4, motion: 1, progress: null, carryX: 0, carryY: 0 });
    const pose = { ...skin.rest, eyeMorph: 1, gazeX: 0, gazeY: 0, lagX: 0, lagY: 0, ...out.pose };
    const drawn = (name: string) => {
      mod.setDogeshOutfit(name);
      const { ctx, fills } = recordingContext();
      skin.draw(ctx, pose, out.eye, { U: 100, ox: 80, oy: 140, size: 160, t: 0.4, detail: 1 });
      return fills;
    };
    expect(drawn("hero").has(outfits.OUTFITS.hero.cloth.cape.color.toUpperCase())).toBe(true);
    expect(drawn("rainy").has(outfits.OUTFITS.rainy.cloth.boots.color.toUpperCase())).toBe(true);
    expect(drawn("cozy").has(outfits.OUTFITS.hero.cloth.cape.color.toUpperCase())).toBe(false);
  });

  it("withDogeshOutfit draws in another outfit, then puts the old one back", () => {
    mod.setDogeshOutfit("chef");
    const seen = mod.withDogeshOutfit("hero", () => mod.dogeshOutfit());
    expect(seen).toBe("hero");
    expect(mod.dogeshOutfit()).toBe("chef");
    expect(() => mod.withDogeshOutfit("dapper", () => {
      throw new Error("boom");
    })).toThrow("boom");
    expect(mod.dogeshOutfit()).toBe("chef");
  });

  it("keeps the detective's mouth shut inside his collar while he hides", () => {
    mod.setDogeshOutfit("detective");
    for (const st of [1000, 1300, 1500, 2700, 3900]) {
      const out = mod.dogesh.pose({ state: "NOTIFY", variant: null, st, t: st / 1000, motion: 1, progress: null, carryX: 0, carryY: 0 });
      expect(out.pose.hide).toBeCloseTo(1);
      expect(out.pose.mouthO ?? 0).toBeLessThan(0.01);
    }
  });

  it("ignores outfits it doesn't know", () => {
    mod.setDogeshOutfit("pyjamas");
    mod.setDogeshOutfit("tuxedo");
    mod.setDogeshOutfit(undefined);
    expect(mod.dogeshOutfit()).toBe("pyjamas");
  });
});

describe("the change scene", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  for (const kind of ["puff", "screen"] as const) {
    it(`${kind}: swaps once while he's hidden, then removes its overlay`, async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
      vi.stubGlobal("requestAnimationFrame", (f: (now: number) => void) => setTimeout(() => f(performance.now()), 16));
      vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
      const appended: { removed: boolean }[] = [];
      const overlay = {
        width: 0, height: 0, style: { cssText: "" }, removed: false,
        setAttribute() {},
        getContext: () => recordingContext().ctx,
        remove() {
          this.removed = true;
        },
      };
      vi.stubGlobal("document", {
        createElement: () => overlay,
        body: { append: (el: { removed: boolean }) => appended.push(el) },
      });
      const host = {
        clientWidth: 200,
        style: { transform: "translateX(3px)", transformOrigin: "" },
        getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 200 }),
      };
      const { playDogeshChange } = await import("../src/desktop/dogesh-change");
      const swaps: number[] = [];
      let done = false;
      const t0 = performance.now();
      void playDogeshChange(host as unknown as HTMLCanvasElement, kind, () => swaps.push(performance.now() - t0)).then(() => (done = true));
      expect(appended).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(300);
      expect(swaps).toHaveLength(0);
      if (kind === "screen") {
        // Ducked behind the screen while it's up.
        await vi.advanceTimersByTimeAsync(1000);
        expect(host.style.transform).toMatch(/^translateX\(3px\) scale\(/);
      }
      await vi.advanceTimersByTimeAsync(kind === "puff" ? 1500 : 2400);
      expect(swaps).toHaveLength(1);
      expect(done).toBe(true);
      expect(overlay.removed).toBe(true);
      // His canvas is left as it was.
      expect(host.style.transform).toBe("translateX(3px)");
      expect(host.style.transformOrigin).toBe("");
    });
  }
});
