// Small pieces both 3D characters (Rui and Dogesh) are built from: easing and
// keyframe helpers, a damped spring for wobbly bits, rounded limb shapes and a
// soft round shadow.

import * as THREE from "three";

export const smooth = (u: number) => u * u * (3 - 2 * u);
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Value at time `t` along `[time, value]` keys, eased between keys. */
export function kf(t: number, keys: [number, number][], ease = smooth): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}

/** A damped spring for wobbly bits (ears, tuft, tail). */
export class Wobble {
  s = 0;
  v = 0;
  constructor(private stiffness: number, private damping: number) {}
  step(target: number, dt: number): number {
    this.v += ((target - this.s) * this.stiffness - this.v * this.damping) * dt;
    this.s += this.v * dt;
    return this.s;
  }
}

/** A capsule hanging down from its top, a little fatter at the far end (mitten / foot). */
export function limbGeometry(radius: number, length: number, top: number, swell: number): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(radius, length, 12, 28);
  const half = length / 2 + radius;
  g.translate(0, top - half, 0);
  const pos = g.getAttribute("position");
  const span = length + radius * 2;
  for (let i = 0; i < pos.count; i++) {
    const f = clamp((top - pos.getY(i)) / span, 0, 1);
    const s = 1 + swell * f * f;
    pos.setX(i, pos.getX(i) * s);
    pos.setZ(i, pos.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

/** A soft round shadow on the floor under a character. */
export function softShadow(): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(60,40,25,0.4)");
  grad.addColorStop(0.6, "rgba(60,40,25,0.14)");
  grad.addColorStop(1, "rgba(60,40,25,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.003;
  m.renderOrder = -1;
  return m;
}
