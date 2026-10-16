// Dogesh Bhai's walk: a foot that's down stays put on the floor while he goes
// over it (no sliding, no moonwalking), and he's never in the air.

import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";

type Feet = { feet: THREE.Mesh[]; root: THREE.Object3D };

// His face is painted on canvases; Node has none, so hand out ones that accept anything.
beforeAll(() => {
  const anything: unknown = new Proxy(() => anything, { get: (_, p) => (p === Symbol.toPrimitive ? () => 0 : anything), apply: () => anything });
  (globalThis as Record<string, unknown>).document ??= {
    createElement: () => ({ width: 0, height: 0, getContext: () => anything, style: {} }),
  };
});

describe("Dogesh's walk", () => {
  it("plants each foot and steps over it", async () => {
    const { Dogesh } = await import("../src/three/dogesh");
    const scene = new THREE.Scene();
    const dog = new Dogesh(scene);
    dog.autoLife = false;
    const { feet, root } = dog as unknown as Feet;
    dog.play("walk");

    const dt = 1 / 60;
    const floor = [Infinity, Infinity];
    const samples: { y: number[]; x: number[]; rootX: number }[] = [];
    for (let i = 0; i < 60 * 8; i++) {
      dog.update(dt);
      scene.updateMatrixWorld(true);
      const y: number[] = [];
      const x: number[] = [];
      for (const f of feet) {
        const p = f.getWorldPosition(new THREE.Vector3());
        y.push(p.y);
        x.push(p.x);
      }
      floor[0] = Math.min(floor[0], y[0]);
      floor[1] = Math.min(floor[1], y[1]);
      samples.push({ y, x, rootX: root.position.x });
    }

    let planted = 0;
    let slide = 0;
    let airborne = 0;
    let moving = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      const speed = Math.abs(b.rootX - a.rootX) / dt;
      if (speed < 0.2) continue; // starting, stopping, standing
      moving++;
      const down = [0, 1].filter((f) => b.y[f] - floor[f] < 0.015);
      if (down.length === 0) airborne++;
      for (const f of down) {
        planted++;
        slide += Math.abs(b.x[f] - a.x[f]) / dt;
      }
    }
    expect(moving).toBeGreaterThan(60);
    // While he's walking, some foot is always on the floor...
    expect(airborne / moving).toBeLessThan(0.05);
    // ...and a foot on the floor barely moves (it used to slide along at 0.64 a
    // second, faster than he walked; now about 0.04, the springs' give).
    expect(slide / planted).toBeLessThan(0.1);
  });
});
