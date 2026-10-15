// Dogesh Bhai's rubber-hose bits, shared by his body (dogesh.ts) and his
// clothes (dog-clothes.ts): tubes reshaped along a curve every frame (limbs,
// ears, sleeves), and floppy spring chains (ears, tail, a nightcap's tip).

import * as THREE from "three";
import { Surface, TagOptions, tag } from "./looks";
import { clamp } from "./rig";

export interface NoodleOptions extends TagOptions {
  /** Texture coordinates: u round the tube (repeated this many times), v along it. */
  uv?: [number, number];
}

// ── Noodles: tubes reshaped every frame ──────────────────────────────────────

export const roundEnds = (u: number) => Math.sqrt(Math.max(0, 1 - Math.max(0, (Math.abs(u - 0.5) - 0.44) / 0.06) ** 2));

/** A tube rebuilt along a curve every frame: a rubber-hose limb, an ear, a tail. */
export class Noodle {
  readonly mesh: THREE.Mesh;
  private pts: THREE.Vector3[];
  private tan: THREE.Vector3[];
  private n = new THREE.Vector3();
  private b = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor(surface: Surface, private rings: number, private sides: number, o: NoodleOptions = {}) {
    const count = (rings + 1) * (sides + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    if (o.uv) {
      const uv = new Float32Array(count * 2);
      for (let i = 0; i <= rings; i++) {
        for (let j = 0; j <= sides; j++) {
          const k = i * (sides + 1) + j;
          uv[k * 2] = (j / sides) * o.uv[0];
          uv[k * 2 + 1] = (i / rings) * o.uv[1];
        }
      }
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    }
    const idx: number[] = [];
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < sides; j++) {
        const a = i * (sides + 1) + j;
        const b = a + sides + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    g.setIndex(idx);
    this.mesh = tag(new THREE.Mesh(g), surface, { cast: true, ...o, outline: o.outline ?? true });
    this.mesh.frustumCulled = false;
    for (const c of this.mesh.children) c.frustumCulled = false;
    this.pts = Array.from({ length: rings + 1 }, () => new THREE.Vector3());
    this.tan = Array.from({ length: rings + 1 }, () => new THREE.Vector3());
  }

  /** The last shaped point and direction (where a mitt or tuft goes). */
  get end(): { p: THREE.Vector3; t: THREE.Vector3 } {
    return { p: this.pts[this.rings], t: this.tan[this.rings] };
  }

  /**
   * Shapes it along `at(u)`, u 0..1, radius `r(u)`. `across` (optional) fixes
   * which way a flattened tube (`flat` < 1) is wide.
   */
  shape(
    at: (u: number, out: THREE.Vector3) => void, r: (u: number) => number, across?: THREE.Vector3, flat = 1, thinAcross = false,
  ): void {
    const { pts, tan, n, b, v, rings, sides } = this;
    for (let i = 0; i <= rings; i++) at(i / rings, pts[i]);
    for (let i = 0; i <= rings; i++) {
      tan[i].subVectors(pts[Math.min(i + 1, rings)], pts[Math.max(i - 1, 0)]);
      if (tan[i].lengthSq() < 1e-12) tan[i].set(0, 1, 0);
      tan[i].normalize();
    }
    const geo = this.mesh.geometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
    for (let i = 0; i <= rings; i++) {
      const t = tan[i];
      if (across) n.copy(across);
      else if (i === 0) {
        n.set(t.y, -t.x, 0);
        if (n.lengthSq() < 1e-6) n.set(0, t.z, -t.y);
      }
      n.addScaledVector(t, -n.dot(t)).normalize();
      b.crossVectors(t, n);
      const rad = r(i / rings);
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const fn = thinAcross ? flat : 1;
        const fb = thinAcross ? 1 : flat;
        v.copy(n).multiplyScalar(ca * rad * fn).addScaledVector(b, sa * rad * fb);
        const k = i * (sides + 1) + j;
        pos.setXYZ(k, pts[i].x + v.x, pts[i].y + v.y, pts[i].z + v.z);
        v.copy(n).multiplyScalar(ca * fb).addScaledVector(b, sa * fn).normalize();
        nor.setXYZ(k, v.x, v.y, v.z);
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  }
}

/** A limb from `a` to `b` of rest length `len`: a smooth bow that bulges towards `hint` when it has slack. */
export function bow(a: THREE.Vector3, b: THREE.Vector3, len: number, hint: THREE.Vector3, ctrl: THREE.Vector3): void {
  const d = a.distanceTo(b);
  const h = 2 * Math.sqrt(Math.max(0, (len * len - d * d) * 3 / 16));
  const line = ctrl.subVectors(b, a).normalize();
  const off = hint.clone().addScaledVector(line, -hint.dot(line)).normalize();
  ctrl.addVectors(a, b).multiplyScalar(0.5).addScaledVector(off, h);
}

export const quad = (a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, u: number, out: THREE.Vector3) =>
  out.set(0, 0, 0).addScaledVector(a, (1 - u) * (1 - u)).addScaledVector(c, 2 * u * (1 - u)).addScaledVector(b, u * u);

/**
 * A floppy chain (an ear, the tail), in world space: each link's direction
 * chases where it should point on a well-damped spring — the root along the
 * direction it's given, links further out drooping towards the floor and
 * dragged back by how fast the root is moving — so it follows the body with a
 * soft, slow follow-through and settles without buzzing. It steps at a fixed
 * 240 Hz, so it moves the same at 15, 30 or 60 frames a second.
 */
export class Chain {
  /** Points from root to tip (world), after `update`. */
  readonly p: THREE.Vector3[];
  private d: THREE.Vector3[];
  private v: THREE.Vector3[];
  private tgt: THREE.Vector3[];
  private ready = false;
  private acc = 0;
  private lastBase = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(private n: number, private seg: number) {
    this.p = Array.from({ length: n }, () => new THREE.Vector3());
    this.d = Array.from({ length: n - 1 }, () => new THREE.Vector3(0, -1, 0));
    this.v = Array.from({ length: n - 1 }, () => new THREE.Vector3());
    this.tgt = Array.from({ length: n - 1 }, () => new THREE.Vector3());
  }

  /**
   * `dir`: where the root points (unit, world). `droop` 0..1: how far the
   * outer links hang towards the floor. `drag`: how much the root's speed
   * blows them back. `omega`: spring speed (rad/s) at the root; the tip is
   * slower. `zeta`: damping (1 = no overshoot).
   */
  update(dt: number, base: THREE.Vector3, dir: THREE.Vector3, droop: number, drag: number, omega: number, zeta = 0.85): void {
    const m = this.n - 1;
    if (!this.ready || this.lastBase.distanceTo(base) > 1) {
      for (let i = 0; i < m; i++) {
        this.d[i].copy(dir);
        this.v[i].set(0, 0, 0);
      }
      this.lastBase.copy(base);
      this.vel.set(0, 0, 0);
      this.ready = true;
    }
    // How fast the root is moving, smoothed (the same at any frame rate).
    if (dt > 0) {
      this.tmp.subVectors(base, this.lastBase).divideScalar(dt);
      this.vel.lerp(this.tmp, 1 - Math.exp(-dt / 0.08));
    }
    this.lastBase.copy(base);
    for (let i = 0; i < m; i++) {
      const f = m > 1 ? i / (m - 1) : 0;
      const t = this.tgt[i].copy(dir).lerp(DOWN, clamp(droop, 0, 1) * Math.pow(f, 1.2));
      t.addScaledVector(this.vel, -drag * (0.3 + 0.7 * f)).normalize();
    }
    this.acc = Math.min(this.acc + dt, 0.1);
    const h = 1 / 240;
    while (this.acc >= h) {
      this.acc -= h;
      for (let i = 0; i < m; i++) {
        const w = omega * (1 - 0.45 * (m > 1 ? i / (m - 1) : 0));
        const d = this.d[i];
        const v = this.v[i];
        this.tmp.subVectors(this.tgt[i], d).multiplyScalar(w * w).addScaledVector(v, -2 * zeta * w);
        v.addScaledVector(this.tmp, h);
        d.addScaledVector(v, h).normalize();
        v.addScaledVector(d, -v.dot(d));
      }
    }
    this.p[0].copy(base);
    for (let i = 0; i < m; i++) {
      this.p[i + 1].copy(this.p[i]).addScaledVector(this.d[i], this.seg);
      if (this.p[i + 1].y < FLOOR) this.p[i + 1].y = FLOOR;
    }
  }
}

export const DOWN = new THREE.Vector3(0, -1, 0);

/** Ears, tail and scarf rest on the floor rather than sinking through it. */
export const FLOOR = 0.02;

// ── His shape, for clothes that fit it ────────────────────────────────────────

/** The torso's profile (radius, height) in hips space, before it's squashed front to back and hunched. */
export const TORSO_PROFILE = [
  [0.0, -0.13], [0.15, -0.11], [0.22, -0.04], [0.25, 0.06], [0.24, 0.17], [0.2, 0.28],
  [0.195, 0.37], [0.205, 0.45], [0.17, 0.53], [0.09, 0.59], [0.0, 0.61],
].map(([r, y]) => new THREE.Vector2(r, y));
/** Front to back, the torso is this much of its width. */
export const TORSO_DEPTH = 0.86;
/** Hunched: how far forward the chest leans over the belly at height `y`. */
export const hunch = (y: number) => 0.1 * smoothstep(clamp((y - 0.12) / 0.48, 0, 1));
const smoothstep = (u: number) => u * u * (3 - 2 * u);

/** The head's lopsided bean (head units): moves a point on the ellipsoid DOG_HEAD to where it really is. */
export function headShape(p: THREE.Vector3, r: THREE.Vector3): THREE.Vector3 {
  const up = clamp(p.y / r.y, 0, 1);
  const back = clamp(-p.z / r.z, 0, 1);
  p.x *= 1 + (p.x > 0 ? 0.08 : 0.02) * up * up;
  p.y += 0.05 * back * up;
  p.z -= 0.03 * up * up;
  return p;
}
