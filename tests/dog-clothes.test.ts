// Dogesh Bhai's outfits in 3D (src/three/dog-clothes.ts): every outfit dresses
// a stand-in skeleton, follows it about (and through hiding and bedtime)
// without blowing up, and comes off cleanly.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { OUTFIT_NAMES } from "../src/skins/dogesh-outfits";
import { type DogRig, dress } from "../src/three/dog-clothes";
import { thePuff, theScreen } from "../src/three/dog-props";

/** A skeleton shaped like his, standing, with limbs hanging where his do. */
function skeleton(): DogRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const hips = new THREE.Group();
  const neck = new THREE.Group();
  const head = new THREE.Group();
  root.add(body);
  body.add(hips);
  hips.add(neck);
  neck.add(head);
  hips.position.set(0, 0.6, 0);
  hips.rotation.x = 0.12;
  neck.position.set(0, 0.55, 0.12);
  head.position.set(0, 0.32, 0.06);
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const feet = [new THREE.Mesh(), new THREE.Mesh()];
  for (const f of feet) body.add(f);
  return {
    root, body, hips, neck, head, feet,
    arms: [[v(-0.17, 1.05, 0.07), v(-0.3, 0.85, 0.1), v(-0.21, 0.74, 0.2)], [v(0.17, 1.05, 0.07), v(0.3, 0.85, 0.1), v(0.21, 0.74, 0.2)]],
    legs: [[v(-0.1, 0.54, 0), v(-0.05, 0.3, 0.15), v(-0.15, 0.06, 0.03)], [v(0.1, 0.54, 0), v(0.05, 0.3, 0.15), v(0.15, 0.06, 0.03)]],
  };
}

/** Every vertex position under `root`, checked to be a real number. */
function allFinite(root: THREE.Object3D): boolean {
  let ok = true;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = o.geometry.getAttribute("position");
    if (!pos) return;
    for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) ok = false;
  });
  return ok;
}

const meshes = (root: THREE.Object3D) => {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.outline) n++;
  });
  return n;
};

describe("Dogesh Bhai's outfits in 3D", () => {
  it("every outfit dresses him, moves with him, hides him and tucks him in", () => {
    for (const name of OUTFIT_NAMES) {
      const rig = skeleton();
      const c = dress(name, rig);
      expect(meshes(rig.root), name).toBeGreaterThan(0);
      for (let i = 0; i < 120; i++) {
        const t = i / 60;
        // Walking, then hiding, then lying down.
        rig.root.position.x = Math.sin(t * 3) * 0.4;
        rig.root.rotation.y = t;
        rig.root.updateMatrixWorld(true);
        c.update({ dt: 1 / 60, t, hide: Math.min(1, t), blanket: Math.max(0, t - 1), poof: 0, pop: 0 });
      }
      expect(allFinite(rig.root), name).toBe(true);
      c.dispose();
    }
  });

  it("comes off completely, so he can change", () => {
    const rig = skeleton();
    const bare = meshes(rig.root);
    let c = dress("cozy", rig);
    for (const name of OUTFIT_NAMES) {
      c.dispose();
      expect(meshes(rig.root)).toBe(bare);
      c = dress(name, rig);
      c.update({ dt: 1 / 60, t: 0, hide: 0, blanket: 0, poof: 0, pop: 0 });
    }
    // Boots hide his feet; taking them off brings his feet back.
    c.dispose();
    const rainy = dress("rainy", rig);
    expect(rig.feet.every((f) => !f.visible)).toBe(true);
    rainy.dispose();
    expect(rig.feet.every((f) => f.visible)).toBe(true);
  });

  it("each hiding outfit says how he hides", () => {
    for (const name of OUTFIT_NAMES) {
      const c = dress(name, skeleton());
      expect(c.hold).toHaveLength(2);
      c.dispose();
    }
    expect(dress("cozy", skeleton()).tuck).toBe(1);
    expect(dress("detective", skeleton()).sink).toBeGreaterThan(0);
    expect(dress("hero", skeleton()).holdInHips).toBe(true);
  });

  it("keeps the change scenes' props modest (they're built once and reused)", () => {
    expect(thePuff()).toBe(thePuff());
    expect(theScreen()).toBe(theScreen());
    expect(thePuff().balls.length).toBeLessThanOrEqual(40);
    expect(theScreen().hinges).toHaveLength(2);
  });
});
