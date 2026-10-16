// Dogesh Bhai's working poses (by what the agent's doing): each one lasts,
// playing it again doesn't restart it, switching between them keeps him sat
// down, and every prop is put away afterwards.

import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";

type Inside = { seated: boolean; root: THREE.Object3D; action: { name: string; t: number } | null; face: { zoom: number[] } };

// His face is painted on canvases; Node has none, so hand out ones that accept anything.
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

describe("Dogesh's working poses", () => {
  it("last, don't restart, stay seated between them, and tidy up their props", async () => {
    const { Dogesh } = await import("../src/three/dogesh");
    const scene = new THREE.Scene();
    const dog = new Dogesh(scene);
    dog.autoLife = false;
    const me = dog as unknown as Inside;
    const run = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 60); i++) dog.update(1 / 60);
    };
    const bare = count(scene);

    for (const calm of [false, true]) {
      dog.calm = calm;
      for (const cue of ["work", "research", "run", "browse", "research", "work"] as const) {
        dog.play(cue);
        run(2); // sitting down first (only the first time), or the last pose putting its props away
        expect(dog.current).toBe(cue);
        const t = me.action!.t;
        dog.play(cue);
        run(0.1);
        expect(me.action!.t).toBeGreaterThan(t); // not restarted
        run(10);
        expect(dog.current).toBe(cue); // still at it
        expect(me.seated).toBe(true);
      }
    }

    dog.play("stand");
    run(2);
    expect(dog.current).toBe("idle");
    expect(me.face.zoom).toEqual([1, 1]);
    run(2); // the last sparks fade
    expect(count(scene)).toBe(bare);
  }, 30_000);
});
