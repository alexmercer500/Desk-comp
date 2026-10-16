// Rui's working poses (by what the agent's doing): each one lasts, playing it
// again doesn't restart it, switching between them keeps him sat down, and
// every prop is put away afterwards.

import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";

type Inside = { seated: boolean; action: { name: string; t: number } | null };

// Some of his bits are drawn on canvases; Node has none, so hand out ones that accept anything.
beforeAll(() => {
  const anything: unknown = new Proxy(() => anything, { get: (_, p) => (p === Symbol.toPrimitive ? () => 0 : anything), apply: () => anything });
  (globalThis as Record<string, unknown>).document ??= {
    createElement: () => ({ width: 0, height: 0, getContext: () => anything, style: {} }),
  };
});

const count = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse(() => n++);
  return n;
};

describe("Rui's working poses", () => {
  it("last, don't restart, stay seated between them, and tidy up their props", async () => {
    const { Rui } = await import("../src/three/rui");
    const scene = new THREE.Scene();
    const rui = new Rui(scene);
    rui.autoLife = false;
    const me = rui as unknown as Inside;
    const run = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 60); i++) rui.update(1 / 60);
    };
    const bare = count(scene);

    for (const look of ["toy", "anime"] as const) {
      rui.setLook(look);
      for (const cue of ["work", "research", "run", "browse", "research", "work"] as const) {
        rui.play(cue);
        run(2); // sitting down first (only the first time), or the last pose putting its props away
        expect(rui.current).toBe(cue);
        expect(me.seated).toBe(true);
        expect(count(scene)).toBeGreaterThan(bare);
        // Long enough for page turns, presses, finds and peeks: still at it.
        run(25);
        expect(rui.current).toBe(cue);
        const t = me.action!.t;
        rui.play(cue);
        run(0.5);
        expect(rui.current).toBe(cue);
        expect(me.action!.t).toBeGreaterThan(t);
      }
      rui.play("stand");
      run(2);
      expect(me.seated).toBe(false);
      expect(count(scene)).toBe(bare);
    }
  });
});
