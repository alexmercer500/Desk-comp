// Dogesh Bhai (v2): a lanky, nervous noodle of a cartoon pup in an oversized
// knitted scarf. A small hunched peanut of a body, a big lopsided bean head on
// a thin neck, a long snout ending in a round button nose, huge bulging eyes,
// and rubber-hose limbs: thin tubes rebuilt along smooth curves every frame,
// so they bend with no joints. Long floppy ears and a wiry tail hang on little
// spring chains and swing with every move. He startles at everything.
//
// The rig works like Rui's (every channel chases its target on a spring, so
// moves overshoot and settle, and behaviours blend), but hands and feet are
// placed where they should go and the limbs bend to reach them.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { DogExpression, DogFace, DogFaceState, DOG_HEAD, dogExpression } from "./dog-face";
import { Look, Surface, paint, tag } from "./looks";
import { biscuit, dispose, glyph, tablet, theExclaim, theQuestion } from "./props";
import { clamp, kf, lerp, smooth, softShadow } from "./rig";

// ── Pose ──────────────────────────────────────────────────────────────────────

const CHANNELS = [
  "hipsY", "hipsX", "hipsRx", "hipsRz", "squash", "yaw",
  /** Tipping the whole of him over (sideways), about a point `tiltY` up, dropped `drop` towards the floor. */
  "tiltZ", "tiltY", "drop",
  "headRx", "headRy", "headRz",
  /** Hands, in body (hips) space. */
  "hLx", "hLy", "hLz", "hRx", "hRy", "hRz",
  /** Feet, as offsets from where they stand. */
  "fLx", "fLy", "fLz", "fRx", "fRy", "fRz",
  /** Knees bowing in (knock-kneed) or out (negative). */
  "knock",
  "earL", "earR", "earOut", "earBack", "earSpin", "tail", "wag", "scarf", "blanket", "shiver", "poof", "pop",
] as const;
type Channel = (typeof CHANNELS)[number];
type Pose = Record<Channel, number>;

const HIP = 0.6;
const LEG = 0.6;
const ARM = 0.48;
/** Where the hips' leg sockets and the shoulders are, in body space. */
const HIP_JOINT = [new THREE.Vector3(-0.1, -0.06, 0), new THREE.Vector3(0.1, -0.06, 0)];
const SHOULDER = [new THREE.Vector3(-0.17, 0.45, 0.07), new THREE.Vector3(0.17, 0.45, 0.07)];
/** Where his ankles stand, in his own space. */
const FOOT = [new THREE.Vector3(-0.15, 0.06, 0.03), new THREE.Vector3(0.15, 0.06, 0.03)];

const REST: Pose = {
  hipsY: HIP, hipsX: 0, hipsRx: 0.12, hipsRz: 0, squash: 1, yaw: 0.2,
  tiltZ: 0, tiltY: 0.8, drop: 0,
  headRx: -0.04, headRy: -0.1, headRz: 0,
  hLx: -0.21, hLy: 0.14, hLz: 0.2, hRx: 0.21, hRy: 0.14, hRz: 0.2,
  fLx: 0, fLy: 0, fLz: 0, fRx: 0, fRy: 0, fRz: 0,
  knock: 0.35,
  earL: 0, earR: 0, earOut: 0, earBack: 0, earSpin: 0, tail: 0, wag: 0, scarf: 0, blanket: 0, shiver: 0.05, poof: 0, pop: 0,
};
/** Sitting on the floor, knees up, paws on his knees. */
const SEATED: Partial<Pose> = {
  hipsY: 0.2, hipsRx: -0.05, yaw: 0.12, headRx: 0.08,
  fLx: -0.02, fLz: 0.4, fRx: 0.02, fRz: 0.4, knock: 0.1,
  hLx: -0.16, hLy: 0.05, hLz: 0.36, hRx: 0.16, hRy: 0.05, hRz: 0.36,
};
/** Which ear is his tell (shoots up when he's scared): 1 is the one on your right as he faces you. */
const TELL = 1;

function blendInto(p: Pose, to: Partial<Pose>, u: number): void {
  for (const k of Object.keys(to) as Channel[]) p[k] += (to[k]! - p[k]) * u;
}

// ── Behaviours ────────────────────────────────────────────────────────────────

export type DogAction =
  | "walk" | "stroll" | "spin" | "wave" | "sit" | "exercise" | "eat" | "nap" | "poke"
  | "spook" | "hide" | "whistle" | "scratch" | "mutter";
/** What the prototype page offers to play (the app cues the rest; see stage.ts). */
export const DOG_ACTIONS: DogAction[] = [
  "stroll", "walk", "spook", "whistle", "scratch", "mutter", "hide", "spin", "wave", "sit", "exercise", "eat", "nap",
];

/** Behaviours the desktop app cues as the character's state changes (the same names as Rui's). */
export type DogCue =
  | "rest" | "boot" | "stand" | "work" | "hooray" | "nod" | "ponder" | "shrug" | "droop"
  | "call" | "doze" | "sleep" | "wake" | "held" | "land" | "dizzy" | "hopLeft" | "hopRight";

interface Running {
  name: string;
  outro?: () => Running;
  t: number;
  step(t: number, dt: number): boolean;
  after?(t: number): void;
  end?(): void;
}

// ── Shapes ────────────────────────────────────────────────────────────────────

/** A small hunched peanut, in hips space. */
function torsoGeometry(): THREE.BufferGeometry {
  const profile = [
    [0.0, -0.13], [0.15, -0.11], [0.22, -0.04], [0.25, 0.06], [0.24, 0.17], [0.2, 0.28],
    [0.195, 0.37], [0.205, 0.45], [0.17, 0.53], [0.09, 0.59], [0.0, 0.61],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const pts = new THREE.SplineCurve(profile).getPoints(56);
  pts[0].x = 0;
  pts[pts.length - 1].x = 0;
  const g = new THREE.LatheGeometry(pts, 56);
  g.rotateY(Math.PI);
  g.scale(1, 1, 0.86);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    // Hunched: the chest leans forward over the belly.
    pos.setZ(i, pos.getZ(i) + 0.1 * smooth(clamp((y - 0.12) / 0.48, 0, 1)));
  }
  g.computeVertexNormals();
  return g;
}

/** A big bean of a head, a little lopsided: fuller on top to one side, swept back. */
function headGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 64, 48);
  g.scale(DOG_HEAD.x, DOG_HEAD.y, DOG_HEAD.z);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const up = clamp(y / DOG_HEAD.y, 0, 1);
    const back = clamp(-z / DOG_HEAD.z, 0, 1);
    x *= 1 + (x > 0 ? 0.08 : 0.02) * up * up;
    y += 0.05 * back * up;
    pos.setXYZ(i, x, y, z - 0.03 * up * up);
  }
  g.computeVertexNormals();
  return g;
}

/** Cones standing out of a surface along `dirs` (unit, from `centre` of an ellipsoid `r`): his fur on end. */
function spikes(dirs: THREE.Vector3[], centre: THREE.Vector3, r: THREE.Vector3, size: number): THREE.BufferGeometry {
  const cone = new THREE.ConeGeometry(size * 0.32, size, 8);
  cone.translate(0, size * 0.35, 0);
  const parts = dirs.map((d) => {
    const n = d.clone().normalize();
    const at = new THREE.Vector3(n.x * r.x, n.y * r.y, n.z * r.z).add(centre);
    const normal = new THREE.Vector3(n.x / r.x, n.y / r.y, n.z / r.z).normalize();
    return cone.clone().applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal)).translate(at.x, at.y, at.z);
  });
  const out = new THREE.BufferGeometry();
  // Merge by hand (keeps this file free of more imports).
  const pos: number[] = [];
  const nor: number[] = [];
  for (const p of parts) {
    const ng = p.toNonIndexed();
    pos.push(...(ng.getAttribute("position").array as Float32Array));
    nor.push(...(ng.getAttribute("normal").array as Float32Array));
  }
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.computeVertexNormals();
  return out;
}

/** World length of one stripe repeat along the scarf. */
const STRIPE_LEN = 0.21;

/** A chunky knitted tube along `curve`, ribbed, its u stretched so stripes come out the same width everywhere. */
function knitTube(curve: THREE.Curve<THREE.Vector3>, segs: number, radius: number, closed: boolean): THREE.BufferGeometry {
  const radial = 20;
  const g = new THREE.TubeGeometry(curve, segs, radius, radial, closed);
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  const p = new THREE.Vector3();
  const len = curve.getLength();
  for (let i = 0; i <= segs; i++) {
    const centre = curve.getPointAt(i / segs);
    for (let j = 0; j <= radial; j++) {
      const n = i * (radial + 1) + j;
      const rib = 1 + 0.07 * Math.abs(Math.sin((j / radial) * Math.PI * 7));
      p.fromBufferAttribute(pos, n).sub(centre).multiplyScalar(rib).add(centre);
      pos.setXYZ(n, p.x, p.y, p.z);
      uv.setX(n, (uv.getX(n) * len) / STRIPE_LEN);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** An ellipse in the xz plane, as a curve. */
function ellipseCurve(rx: number, rz: number): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.sin(a) * rx, 0, Math.cos(a) * rz));
  }
  return new THREE.CatmullRomCurve3(pts, true);
}

/** A knitted cap (a hood or a blanket): the top `theta` of an ellipsoid, stripes running round it. */
function knitCap(r: THREE.Vector3, theta: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, theta);
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  const avg = (r.x + r.y + r.z) / 3;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    uv.setXY(i, (Math.acos(clamp(y, -1, 1)) * avg) / STRIPE_LEN, uv.getX(i));
  }
  g.scale(r.x, r.y, r.z);
  g.computeVertexNormals();
  return g;
}

// ── Noodles: tubes reshaped every frame ──────────────────────────────────────

const roundEnds = (u: number) => Math.sqrt(Math.max(0, 1 - Math.max(0, (Math.abs(u - 0.5) - 0.44) / 0.06) ** 2));

/** A tube rebuilt along a curve every frame: a rubber-hose limb, an ear, a tail. */
class Noodle {
  readonly mesh: THREE.Mesh;
  private pts: THREE.Vector3[];
  private tan: THREE.Vector3[];
  private n = new THREE.Vector3();
  private b = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor(surface: Surface, private rings: number, private sides: number, o: { outline?: boolean; tint?: string } = {}) {
    const count = (rings + 1) * (sides + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < sides; j++) {
        const a = i * (sides + 1) + j;
        const b = a + sides + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    g.setIndex(idx);
    this.mesh = tag(new THREE.Mesh(g), surface, { outline: o.outline ?? true, cast: true, tint: o.tint });
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
function bow(a: THREE.Vector3, b: THREE.Vector3, len: number, hint: THREE.Vector3, ctrl: THREE.Vector3): void {
  const d = a.distanceTo(b);
  const h = 2 * Math.sqrt(Math.max(0, (len * len - d * d) * 3 / 16));
  const line = ctrl.subVectors(b, a).normalize();
  const off = hint.clone().addScaledVector(line, -hint.dot(line)).normalize();
  ctrl.addVectors(a, b).multiplyScalar(0.5).addScaledVector(off, h);
}

const quad = (a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, u: number, out: THREE.Vector3) =>
  out.set(0, 0, 0).addScaledVector(a, (1 - u) * (1 - u)).addScaledVector(c, 2 * u * (1 - u)).addScaledVector(b, u * u);

/**
 * A floppy chain (an ear, the tail), in world space: each link's direction
 * chases where it should point on a well-damped spring — the root along the
 * direction it's given, links further out drooping towards the floor and
 * dragged back by how fast the root is moving — so it follows the body with a
 * soft, slow follow-through and settles without buzzing. It steps at a fixed
 * 240 Hz, so it moves the same at 15, 30 or 60 frames a second.
 */
class Chain {
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

const DOWN = new THREE.Vector3(0, -1, 0);

// ── The scarf's trailing end ──────────────────────────────────────────────────

/** Ears, tail and scarf rest on the floor rather than sinking through it. */
const FLOOR = 0.02;
const ROPE_N = 10;
const ROPE_LEN = 0.72;
const ROPE_RINGS = 30;
const ROPE_SIDES = 14;

class ScarfTail {
  readonly mesh: THREE.Mesh;
  readonly fringe = new THREE.Group();
  private p = Array.from({ length: ROPE_N }, () => new THREE.Vector3());
  private prev = Array.from({ length: ROPE_N }, () => new THREE.Vector3());
  private ready = false;
  private seg = ROPE_LEN / (ROPE_N - 1);
  private curve = new THREE.CatmullRomCurve3(this.p.map((v) => v.clone()));
  private inv = new THREE.Matrix4();
  private toRoot = new THREE.Matrix4();
  private basis = new THREE.Matrix4();
  private tmp = new THREE.Vector3();
  private c = new THREE.Vector3();
  private t = new THREE.Vector3();
  private n = new THREE.Vector3();
  private b = new THREE.Vector3();
  private v = new THREE.Vector3();
  private side = new THREE.Vector3();

  constructor() {
    const count = (ROPE_RINGS + 1) * (ROPE_SIDES + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(count * 2);
    const idx: number[] = [];
    for (let i = 0; i <= ROPE_RINGS; i++) {
      for (let j = 0; j <= ROPE_SIDES; j++) {
        const k = i * (ROPE_SIDES + 1) + j;
        uv[k * 2] = ((i / ROPE_RINGS) * ROPE_LEN) / STRIPE_LEN + 0.35;
        uv[k * 2 + 1] = j / ROPE_SIDES;
        if (i < ROPE_RINGS && j < ROPE_SIDES) idx.push(k, k + 1, k + ROPE_SIDES + 1, k + 1, k + ROPE_SIDES + 2, k + ROPE_SIDES + 1);
      }
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mesh = tag(new THREE.Mesh(g), "knit", { outline: true, cast: true });
    this.mesh.frustumCulled = false;
    for (const c of this.mesh.children) c.frustumCulled = false;
    const tassel = new THREE.CapsuleGeometry(0.013, 0.07, 4, 8);
    tassel.translate(0, -0.05, 0);
    for (const x of [-0.05, -0.017, 0.017, 0.05]) {
      const m = tag(new THREE.Mesh(tassel), "furPale", { tint: "#7cc3b9", outline: true });
      m.position.x = x;
      m.rotation.z = x * 1.5;
      this.fringe.add(m);
    }
  }

  update(
    dt: number, anchor: THREE.Vector3, hips: THREE.Object3D, root: THREE.Object3D,
    pin: { i: number; at: THREE.Vector3; k: number } | null = null,
  ): void {
    const { p, prev } = this;
    if (!this.ready || p[0].distanceTo(anchor) > 1.5) {
      for (let i = 0; i < ROPE_N; i++) {
        p[i].copy(anchor).add(this.tmp.set(0, -i * this.seg, 0.03 * i));
        prev[i].copy(p[i]);
      }
      this.ready = true;
    }
    this.inv.copy(hips.matrixWorld).invert();
    let left = Math.min(dt, 0.1);
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      left -= h;
      for (let i = 1; i < ROPE_N; i++) {
        this.v.subVectors(p[i], prev[i]).multiplyScalar(0.975);
        prev[i].copy(p[i]);
        p[i].add(this.v);
        p[i].y -= 5.5 * h * h;
      }
      p[0].copy(anchor);
      for (let it = 0; it < 4; it++) {
        for (let i = 1; i < ROPE_N; i++) this.keep(p[i - 1], p[i], this.seg, i === 1 ? 1 : 0.5);
        for (let i = 2; i < ROPE_N; i++) this.keep(p[i - 2], p[i], this.seg * 1.9, 0.1, true);
        for (let i = 1; i < ROPE_N; i++) {
          this.collide(p[i]);
          if (p[i].y < FLOOR) p[i].y = FLOOR;
        }
        if (pin && pin.k > 0) {
          p[pin.i].lerp(pin.at, pin.k);
          if (pin.k > 0.99) prev[pin.i].copy(p[pin.i]);
        }
      }
    }
    this.shape(hips, root);
  }

  private keep(a: THREE.Vector3, b: THREE.Vector3, len: number, share: number, min = false): void {
    const d = this.tmp.subVectors(b, a);
    const l = d.length();
    if (l < 1e-6 || (min && l > len)) return;
    const diff = (l - len) / l;
    if (a === this.p[0]) b.addScaledVector(d, -diff);
    else {
      a.addScaledVector(d, diff * (1 - share));
      b.addScaledVector(d, -diff * share);
    }
  }

  /** Out of his body (an ellipsoid round the torso, in hips space). */
  private collide(q: THREE.Vector3): void {
    const l = this.tmp.copy(q).applyMatrix4(this.inv);
    const cy = 0.2, cz = 0.04;
    const rx = 0.3, ry = 0.48, rz = 0.3;
    const dx = l.x / rx;
    const dy = (l.y - cy) / ry;
    const dz = (l.z - cz) / rz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d >= 1) return;
    const k = 1 / Math.sqrt(Math.max(d, 1e-4));
    q.set(l.x * k, cy + (l.y - cy) * k, cz + (l.z - cz) * k).applyMatrix4(this.inv.clone().invert());
  }

  private shape(hips: THREE.Object3D, root: THREE.Object3D): void {
    const pts = this.curve.points;
    root.updateWorldMatrix(true, false);
    const toRoot = this.toRoot.copy(root.matrixWorld).invert();
    for (let i = 0; i < ROPE_N; i++) pts[i].copy(this.p[i]).applyMatrix4(toRoot);
    this.side.set(1, 0, 0).transformDirection(hips.matrixWorld).transformDirection(toRoot);
    const geo = this.mesh.geometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
    const { t, n, b, v, c } = this;
    for (let i = 0; i <= ROPE_RINGS; i++) {
      const u = i / ROPE_RINGS;
      this.curve.getPoint(u, c);
      this.curve.getTangent(u, t);
      n.copy(this.side).addScaledVector(t, -this.side.dot(t)).normalize();
      b.crossVectors(t, n).normalize();
      const end = u > 0.96 ? Math.sqrt(Math.max(0, 1 - ((u - 0.96) / 0.04) ** 2)) : 1;
      const w = (0.07 - 0.008 * u) * end;
      const th = 0.026 * end + 0.001;
      for (let j = 0; j <= ROPE_SIDES; j++) {
        const a = (j / ROPE_SIDES) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const rib = 1 + 0.06 * Math.abs(Math.sin(a * 3.5));
        v.copy(n).multiplyScalar(ca * w * rib).addScaledVector(b, sa * th * rib);
        const k = i * (ROPE_SIDES + 1) + j;
        pos.setXYZ(k, c.x + v.x, c.y + v.y, c.z + v.z);
        v.copy(n).multiplyScalar(ca / w).addScaledVector(b, sa / th).normalize();
        nor.setXYZ(k, v.x, v.y, v.z);
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    this.fringe.position.copy(pts[ROPE_N - 1]);
    this.basis.makeBasis(n, t.negate(), b.negate());
    this.fringe.quaternion.setFromRotationMatrix(this.basis);
  }
}

// ── Particles ─────────────────────────────────────────────────────────────────

interface Particle {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  life: number;
  max: number;
  gravity: number;
}

// ── The character ─────────────────────────────────────────────────────────────

export class Dogesh {
  readonly root = new THREE.Group();
  /** Furthest he may walk from the centre, set by the stage. */
  bounds = 2;
  /** Expression when nothing else is going on. */
  mood: DogExpression = "neutral";
  autoLife = false;
  /** Whether "doing his own thing" may include a nap (off on the desktop, where the app decides when he sleeps). */
  naps = true;
  /** Reduced motion: calmer versions of his big frights (no leaps, no trembling, no falling over). */
  calm = false;
  /** How much more of the stage a scene needs (he never needs more: always 0). */
  readonly wide = 0;

  /** Tips him over as a whole (fainting, lying down), about a point up his middle. */
  private tilt = new THREE.Group();
  /** His own space: feet stand on its floor; limbs are drawn in it. */
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private face = new DogFace();
  private legs: Noodle[] = [];
  private arms: Noodle[] = [];
  private feet: THREE.Mesh[] = [];
  private mitts: THREE.Group[] = [];
  private ears: { strand: Chain; base: Noodle; tip: Noodle; side: number; pivot: THREE.Vector3 }[] = [];
  /** When each ear last flicked (a twitch: a quick deliberate flick, then it settles). */
  private flickAt = [-9, -9];
  private tailStrand = new Chain(6, 0.065);
  private tailMesh = new Noodle("fur", 16, 8);
  private tuft: THREE.Mesh;
  private hood = new THREE.Group();
  private blanket: THREE.Mesh;
  private spikes: THREE.Mesh[] = [];
  private rope = new ScarfTail();
  private ropeAnchor = new THREE.Object3D();
  private ropePin: { i: number; at: THREE.Vector3; k: number } | null = null;
  private shadow = softShadow();
  private sweat: THREE.Mesh;
  private zs: THREE.Sprite[] = [];
  private notes: THREE.Sprite[] = [];
  private hidden: THREE.Object3D[] = [];

  private pose: Pose = { ...REST };
  private poseVel = Object.fromEntries(CHANNELS.map((c) => [c, 0])) as Pose;
  private target: Pose = { ...REST };
  private rate = 10;
  private bounce = 0.68;
  private expr: DogExpression = "neutral";
  private faceMods: Partial<DogFaceState> = {};

  private action: Running | null = null;
  private queue: (() => Running)[] = [];
  private seated = false;
  private popRequested = false;
  private idleFor = 0;
  private nextAuto = 4;

  private gaze = { x: 0, y: 0, at: -10 };
  private glance = { yaw: 0, pitch: 0, next: 1, snap: -9 };
  private nextTwitch = 2;
  private nextWag = 6;
  private clock = 0;
  private lastX = 0;
  private lastHipY = HIP;
  private vel = new THREE.Vector2();
  private particles: Particle[] = [];
  private carry = new THREE.Vector2();
  private wiggleT = 99;
  private look: Look = "toy";
  // Scratch space, reused every frame.
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();
  private across = new THREE.Vector3();

  constructor(private world: THREE.Object3D) {
    world.add(this.root);
    this.root.add(this.shadow, this.tilt);
    this.tilt.add(this.body);
    this.body.add(this.hips);
    const solid = { outline: true, cast: true, receive: true };

    this.hips.add(tag(new THREE.Mesh(torsoGeometry()), "fur", solid));
    const tummy = tag(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24)), "furPale", { receive: true });
    tummy.scale.set(0.17, 0.2, 0.1);
    tummy.position.set(0, 0.08, 0.165);
    this.hips.add(tummy);

    // A thin neck, and the big head on it.
    this.neck.position.set(0, 0.55, 0.12);
    this.hips.add(this.neck);
    const neckGeo = new THREE.CapsuleGeometry(0.048, 0.24, 6, 14);
    neckGeo.rotateX(-0.2);
    neckGeo.translate(0, 0.12, 0.02);
    this.neck.add(tag(new THREE.Mesh(neckGeo), "fur", solid));
    this.head.position.set(0, 0.32, 0.06);
    this.neck.add(this.head);
    this.head.add(tag(new THREE.Mesh(headGeometry()), "fur", solid));
    this.head.add(this.face.group);

    // Fur on end (shown only in a fright): spikes on the back of his head and round his body.
    const headDirs: THREE.Vector3[] = [];
    for (const [a, e] of [[0, 1.2], [0.7, 1.0], [-0.7, 1.0], [1.4, 0.7], [-1.4, 0.7], [2.3, 0.7], [-2.3, 0.7], [3.14, 0.5], [2.0, 0.2], [-2.0, 0.2]]) {
      headDirs.push(new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e) * 0.8 - 0.3));
    }
    const bodyDirs: THREE.Vector3[] = [];
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * 0.5 + (i / 8) * Math.PI;
      bodyDirs.push(new THREE.Vector3(Math.sin(a), 0.25 + (i % 2) * 0.3, Math.cos(a)));
    }
    const hs = tag(new THREE.Mesh(spikes(headDirs, new THREE.Vector3(), DOG_HEAD, 0.14)), "fur", { outline: true });
    const bs = tag(new THREE.Mesh(spikes(bodyDirs, new THREE.Vector3(0, 0.2, 0.0), new THREE.Vector3(0.22, 0.25, 0.19), 0.12)), "fur", {
      outline: true,
    });
    this.head.add(hs);
    this.hips.add(bs);
    this.spikes.push(hs, bs);

    // Rubber-hose arms and legs, little mitts and knobby feet.
    // A small mitt: a palm, three fingers and a stubby thumb towards his front, all one mesh.
    const mitt = (side: number) => {
      const g = new THREE.Group();
      const o = new THREE.Object3D();
      const at = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx: number, rz: number, s = [1, 1, 1]) => {
        o.position.set(x, y, z);
        o.rotation.set(rx, 0, rz);
        o.scale.set(s[0], s[1], s[2]);
        o.updateMatrix();
        return geo.clone().applyMatrix4(o.matrix);
      };
      const finger = new THREE.CapsuleGeometry(0.017, 0.035, 4, 8);
      finger.translate(0, 0.03, 0);
      const parts = [at(new THREE.SphereGeometry(1, 20, 14), 0, 0, 0, 0, 0, [0.05, 0.05, 0.04])];
      for (const k of [-1, 0, 1]) parts.push(at(finger, k * 0.026, 0.03, 0.005, 0, -k * 0.35));
      parts.push(at(finger, -side * 0.035, 0, 0.03, 0.6, side * 0.9));
      g.add(tag(new THREE.Mesh(mergeGeometries(parts.map((p) => p.toNonIndexed()))), "furPale", solid));
      return g;
    };
    for (let i = 0; i < 2; i++) {
      const leg = new Noodle("fur", 18, 10);
      const arm = new Noodle("fur", 16, 10);
      this.legs.push(leg);
      this.arms.push(arm);
      const foot = tag(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16)), "furPale", solid);
      foot.scale.set(0.07, 0.05, 0.115);
      this.feet.push(foot);
      const m = mitt(i === 0 ? -1 : 1);
      this.mitts.push(m);
      this.body.add(leg.mesh, arm.mesh, foot, m);
    }

    // Long floppy ears with dark tips, and a wiry tail with a tuft.
    for (const side of [-1, 1]) {
      const base = new Noodle("dogEar", 14, 10);
      const tip = new Noodle("dogEarTip", 6, 10);
      this.body.add(base.mesh, tip.mesh);
      this.ears.push({ strand: new Chain(7, 0.08), base, tip, side, pivot: new THREE.Vector3(side * 0.3, 0.24, -0.04) });
    }
    this.body.add(this.tailMesh.mesh);
    this.tuft = tag(new THREE.Mesh(spikes(
      [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.6, 0.8, 0), new THREE.Vector3(-0.6, 0.8, 0), new THREE.Vector3(0, 0.8, 0.6), new THREE.Vector3(0, 0.8, -0.6)],
      new THREE.Vector3(), new THREE.Vector3(0.03, 0.03, 0.03), 0.07,
    )), "dogEar", { outline: true, cast: true });
    this.body.add(this.tuft);

    // The scarf: a chunky ring round his neck, a knot, a long trailing end; a hood
    // he pulls over his head to hide; and a blanket when he sleeps.
    const ring = tag(new THREE.Mesh(knitTube(ellipseCurve(0.2, 0.19), 80, 0.085, true)), "knit", solid);
    ring.position.set(0, 0.56, 0.1);
    ring.rotation.x = 0.25;
    this.hips.add(ring);
    const knot = tag(new THREE.Mesh(knitTube(ellipseCurve(0.055, 0.04), 24, 0.055, true)), "knit", solid);
    knot.position.set(0.1, 0.5, 0.26);
    knot.rotation.set(1.3, 0.3, 0.2);
    this.hips.add(knot);
    this.ropeAnchor.position.set(0.11, 0.47, 0.28);
    this.hips.add(this.ropeAnchor);
    this.root.add(this.rope.mesh, this.rope.fringe);

    // Rounder at the front than his head, so it clears the bulge of his eyes.
    const hr = new THREE.Vector3(DOG_HEAD.x * 1.15, DOG_HEAD.y * 1.14, DOG_HEAD.z * 1.34);
    const cap = tag(new THREE.Mesh(knitCap(hr, 1.5)), "knit", solid);
    const rimPts: THREE.Vector3[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      rimPts.push(new THREE.Vector3(Math.sin(a) * Math.sin(1.5) * hr.x, Math.cos(1.5) * hr.y, Math.cos(a) * Math.sin(1.5) * hr.z));
    }
    const rim = tag(new THREE.Mesh(knitTube(new THREE.CatmullRomCurve3(rimPts, true), 64, 0.05, true)), "knit", solid);
    this.hood.add(cap, rim);
    this.hood.visible = false;
    this.head.add(this.hood);

    this.blanket = tag(new THREE.Mesh(knitCap(new THREE.Vector3(0.36, 0.5, 0.36), 1.45)), "knit", solid);
    this.blanket.rotation.x = Math.PI / 2;
    this.blanket.position.set(0, 0.12, -0.04);
    this.blanket.visible = false;
    this.hips.add(this.blanket);

    this.sweat = tag(new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14)), "sweat");
    this.sweat.scale.set(0.03, 0.045, 0.03);
    this.sweat.visible = false;
    this.head.add(this.sweat);

    for (let i = 0; i < 3; i++) {
      const z = glyph("z", "#5d7fb0");
      z.visible = false;
      this.root.add(z);
      this.zs.push(z);
      const note = glyph(i % 2 ? "♫" : "♪", "#2f8f8a");
      note.visible = false;
      this.root.add(note);
      this.notes.push(note);
    }
    for (const s of this.spikes) s.visible = false;
    this.hidden.push(this.hood, this.blanket, this.sweat, ...this.spikes, ...this.zs, ...this.notes);

    this.setLook("toy");
  }

  setLook(look: Look): void {
    this.look = look;
    paint(this.root, look);
  }

  /** Objects a click can land on. */
  get hitTarget(): THREE.Object3D {
    return this.body;
  }

  headWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.head.getWorldPosition(out);
  }

  lookAt(dx: number, dy: number): void {
    this.gaze.x = clamp(dx, -1, 1);
    this.gaze.y = clamp(dy, -1, 1);
    this.gaze.at = this.clock;
  }

  get current(): string {
    return this.action?.name ?? "idle";
  }

  /**
   * Compiles everything he might show later (props, the hood and blanket, his
   * fur on end, the sprites, sparkles), in both looks, so the first time doesn't
   * stutter. Leaves him painted in the last look; the caller puts its look back.
   */
  async prewarm(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene): Promise<void> {
    const loose = [tablet("#2f8f8a"), biscuit(), theExclaim(), theQuestion()];
    const spark = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true }));
    const group = new THREE.Group();
    group.add(...loose, spark);
    group.position.set(this.root.position.x, 1, 0);
    group.scale.setScalar(0.01);
    scene.add(group);
    const was = this.hidden.map((o) => o.visible);
    for (const o of this.hidden) o.visible = true;
    const face = { ...this.face.state };
    for (const f of [{ teeth: 1, jaw: 1, tongue: 1, spiral: 1, eyeOpen: 0.5 }, { teeth: 0, jaw: 0, spiral: 0, eyeOpen: 0 }]) {
      this.face.update(0, { ...face, ...f });
      for (const look of ["toy", "anime"] as Look[]) {
        paint(this.root, look);
        paint(group, look);
        await renderer.compileAsync(scene, camera);
      }
    }
    this.face.update(0, face);
    this.hidden.forEach((o, i) => (o.visible = was[i]));
    group.removeFromParent();
    dispose(loose[0]);
    dispose(loose[1]);
    loose[2].removeFromParent();
    loose[3].removeFromParent();
    spark.geometry.dispose();
    (spark.material as THREE.Material).dispose();
  }

  /** Leaves the scene for good: stops what he's doing (putting props away) and takes his sparkles with him. */
  retire(): void {
    this.action?.end?.();
    this.action = null;
    this.queue = [];
    for (const p of this.particles) {
      p.mesh.removeFromParent();
      (p.mesh.material as THREE.Material).dispose();
    }
    this.particles = [];
    this.root.removeFromParent();
  }

  // ── Starting behaviours ─────────────────────────────────────────────────────

  play(name: DogAction | DogCue): void {
    if (this.action?.name === "nap" && (name === "nap" || name === "sleep" || name === "rest")) return;
    if (this.action?.name === "rest" && (name === "rest" || name === "sleep")) return;
    if (this.action?.name === name && (name === "work" || name === "held" || name === "call" || name === "droop")) return;
    this.begin(this.stepsFor(name));
  }

  private begin(steps: (() => Running)[]): void {
    this.idleFor = 0;
    if (this.action?.name === "nap" || this.action?.name === "rest") {
      this.popRequested = true;
      this.queue = steps;
      return;
    }
    const outro = this.action?.outro;
    if (outro) {
      this.action = outro();
      this.queue = steps;
      return;
    }
    this.action?.end?.();
    this.action = null;
    this.queue = steps;
  }

  setCarry(vx: number, vy: number): void {
    this.carry.set(vx, vy);
  }

  /** A quick flinch on top of whatever he's doing. */
  wiggle(): void {
    this.wiggleT = 0;
  }

  private stepsFor(name: DogAction | DogCue): (() => Running)[] {
    const standFirst = () => (this.seated ? [() => this.standUp()] : []);
    const sitFirst = () => (this.seated ? [] : [() => this.sitDown()]);
    switch (name) {
      case "rest":
        return [...standFirst(), () => this.nap(true, "rest")];
      case "boot":
        return [...standFirst(), () => this.peekIn()];
      case "stand":
      case "wake":
        return standFirst();
      case "work":
        return [...sitFirst(), () => this.working()];
      case "hooray":
        return [...standFirst(), () => this.jig()];
      case "nod":
        return [() => this.nod()];
      case "ponder":
        return [...standFirst(), () => this.ponder()];
      case "shrug":
        return [...standFirst(), () => this.puzzled()];
      case "droop":
        return [...standFirst(), () => this.droop()];
      case "call":
        return [...standFirst(), () => this.call()];
      case "doze":
        return [...sitFirst(), () => this.dozing()];
      case "sleep":
        return [...standFirst(), () => this.nap(true)];
      case "held":
        return [() => this.dangle()];
      case "land":
        return [() => this.land()];
      case "dizzy":
        return [...standFirst(), () => this.dizzy()];
      case "hopLeft":
      case "hopRight":
        return [...standFirst(), () => this.hop(name === "hopLeft" ? -1 : 1)];
      case "walk": {
        const x = this.root.position.x > 0 ? -this.bounds : this.bounds;
        return [...standFirst(), () => this.tiptoe(x, 0.7, false)];
      }
      case "stroll":
        return [...standFirst(), () => this.tiptoe(this.strollTarget(), 0.45, true)];
      case "spin":
        return [...standFirst(), () => this.chaseTail()];
      case "wave":
        return [...standFirst(), () => this.wave()];
      case "sit":
        return this.seated
          ? [() => this.sitting(6, "sleepy"), () => this.standUp()]
          : [() => this.sitDown(), () => this.sitting(6, "sleepy"), () => this.standUp()];
      case "exercise":
        return [...standFirst(), () => this.shakeOff()];
      case "eat":
        return [...standFirst(), () => this.eat()];
      case "nap":
        return [...standFirst(), () => this.nap()];
      case "poke":
        return [() => this.startle()];
      case "spook":
        return [...standFirst(), () => this.spook()];
      case "hide":
        return [...standFirst(), () => this.hide()];
      case "whistle":
        return [...standFirst(), () => this.whistle()];
      case "scratch":
        return [...standFirst(), () => this.scratch()];
      case "mutter":
        return [...standFirst(), () => this.mutter()];
    }
  }

  /** Back to the middle of his spot after a stroll took him off to one side. */
  walkHome(): void {
    this.begin([...(this.seated ? [() => this.standUp()] : []), () => this.tiptoe(0, 0.5, false)]);
  }

  /** A click on him: wakes him with a start, or makes him jump out of his skin. */
  tap(): void {
    if (this.action?.name === "nap" || this.action?.name === "rest") this.popRequested = true;
    else if (!this.action || this.action.name === "seated") this.play("poke");
  }

  private strollTarget(): number {
    const x = this.root.position.x;
    let to = (Math.random() * 2 - 1) * this.bounds;
    if (Math.abs(to - x) < 0.6) to = x > 0 ? x - 1.2 : x + 1.2;
    return clamp(to, -this.bounds, this.bounds);
  }

  // ── Frame ───────────────────────────────────────────────────────────────────

  update(dt: number): void {
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    const P = this.target;
    Object.assign(P, REST);
    this.rate = 10;
    this.bounce = 0.68;
    this.expr = this.mood;
    this.faceMods = {};

    this.idleLayer(dt);

    if (!this.action && this.queue.length) this.action = this.queue.shift()!();
    if (this.action) {
      this.action.t += dt;
      if (!this.action.step(this.action.t, dt)) {
        this.action.end?.();
        this.action = null;
        if (this.queue.length) {
          this.action = this.queue.shift()!();
          this.action.step(0, 0);
        }
      }
    } else if (this.seated) {
      blendInto(P, SEATED, 1);
    }

    if (!this.action && !this.queue.length && this.autoLife) {
      this.idleFor += dt;
      if (this.idleFor > this.nextAuto) this.pickSomething();
    }

    if (this.wiggleT < 0.5) {
      this.wiggleT += dt;
      const k = this.wiggleT / 0.5;
      P.headRz += Math.sin(k * Math.PI * 4) * 0.1 * (1 - k);
      P.hipsRz += Math.sin(k * Math.PI * 4) * 0.05 * (1 - k);
      P.pop = Math.max(P.pop, 0.6 * (1 - k));
      P.earR = Math.max(P.earR, 0.8 * (1 - k));
    }

    this.follow(dt);
    this.applyPose();
    this.action?.after?.(this.action.t);

    const face = { ...dogExpression(this.expr), ...this.faceMods };
    if (this.faceMods.lookX === undefined) face.lookX = this.glanceLook().x;
    if (this.faceMods.lookY === undefined) face.lookY = this.glanceLook().y;
    this.face.update(dt, face, this.pose.pop, clamp(this.pose.scarf, 0, 1));

    this.motion(dt);
    this.updateParticles(dt);
  }

  private follow(dt: number): void {
    const w = this.rate * 1.3;
    const k = w * w;
    const c = 2 * this.bounce * w;
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      left -= h;
      for (const ch of CHANNELS) {
        this.poseVel[ch] += ((this.target[ch] - this.pose[ch]) * k - this.poseVel[ch] * c) * h;
        this.pose[ch] += this.poseVel[ch] * h;
      }
    }
  }

  private pickSomething(): void {
    this.idleFor = 0;
    this.nextAuto = 3.5 + Math.random() * 5;
    const hour = new Date().getHours();
    const choices: [DogAction, number][] = [
      ["stroll", 3], ["spook", 1.6], ["whistle", 1.2], ["scratch", 1], ["mutter", 0.8], ["hide", 0.8], ["wave", 0.4],
      ["spin", 0.5], ["sit", 0.7], ["exercise", 0.4], ["eat", hour >= 12 && hour <= 14 ? 1.6 : 0.4], ["nap", this.naps ? 0.5 : 0],
    ];
    let r = Math.random() * choices.reduce((a, [, w]) => a + w, 0);
    for (const [name, w] of choices) {
      if ((r -= w) <= 0) return this.play(name);
    }
  }

  /** Can't keep still: shifting his weight, a jittery bob, darting looks and double-takes, ears twitching. */
  private idleLayer(dt: number): void {
    const P = this.target;
    const t = this.clock;
    P.squash = 1 + Math.sin(t * 3) * 0.012;
    const shift = Math.sin(t * 1.15) + 0.3 * Math.sin(t * 2.9);
    P.hipsX = shift * 0.022;
    P.hipsRz = -shift * 0.025;
    P.fLy = Math.max(0, shift) * 0.025;
    P.fRy = Math.max(0, -shift) * 0.025;
    // Fidgety paws, wringing in front of him.
    P.hLx += 0.05 + Math.sin(t * 4.2) * 0.015;
    P.hRx -= 0.05 + Math.sin(t * 4.2 + 1) * 0.015;
    P.hLy += Math.sin(t * 3.1) * 0.012;
    // The tail keeps still, but now and then he gives it a little wag (and keeps wagging while you're there).
    if (t > this.nextWag + 1.8) this.nextWag = t + 7 + Math.random() * 7;
    const wag = kf(t - this.nextWag, [[0, 0], [0.25, 0.45], [1.4, 0.45], [1.8, 0]]);
    P.wag = this.mood === "happy" ? 0.6 : wag;

    this.glance.next -= dt;
    if (this.glance.next <= 0) {
      this.glance.next = 1.0 + Math.random() * 2.4;
      const r = Math.random();
      const dir = Math.random() < 0.5 ? -1 : 1;
      if (r > 0.86) {
        // A double-take at nothing: away, back, away again, fast.
        this.glance.snap = t;
        this.glance.yaw = dir * 0.6;
        this.twitch(dir > 0 ? 1 : 0);
        this.glance.next = 1.4;
      } else {
        const away = r < 0.4;
        this.glance.yaw = away ? (Math.random() * 2 - 1) * 0.45 : 0;
        this.glance.pitch = away ? (Math.random() * 2 - 1) * 0.12 : 0;
      }
    }
    this.nextTwitch -= dt;
    if (this.nextTwitch <= 0) {
      this.nextTwitch = 4 + Math.random() * 5;
      this.twitch(Math.random() < 0.6 ? TELL : 1 - TELL);
    }
    let yaw = this.glance.yaw;
    const snap = t - this.glance.snap;
    if (snap < 1.2) yaw *= kf(snap, [[0, 0], [0.08, 1], [0.3, 1], [0.38, 0], [0.5, 0], [0.58, 1.2], [1.0, 1.2], [1.2, 0]]);
    const g = this.gazeActive() ? { yaw: this.gaze.x * 0.45, pitch: -this.gaze.y * 0.25 } : { yaw, pitch: this.glance.pitch };
    P.headRy += g.yaw;
    P.headRx += g.pitch;
    P.headRz = -g.yaw * 0.15;
  }

  /** A little flick of one ear. */
  private twitch(i: number): void {
    if (this.clock - this.flickAt[i] > 0.5) this.flickAt[i] = this.clock;
  }

  private gazeActive(): boolean {
    return this.clock - this.gaze.at < 2.5;
  }

  private glanceLook(): { x: number; y: number } {
    if (this.gazeActive()) return { x: this.gaze.x, y: this.gaze.y };
    return { x: this.glance.yaw * 1.4, y: -this.glance.pitch * 3 };
  }

  private applyPose(): void {
    const p = this.pose;
    const t = this.clock;
    const shiver = Math.max(0, p.shiver);
    const s = p.squash;
    const poof = 1 + 0.05 * Math.max(0, p.poof);
    this.root.rotation.y = p.yaw;
    // Tipping over, about a point up his middle, sinking to the floor.
    this.tilt.position.set(0, p.tiltY - p.drop, 0);
    this.body.position.set(0, -p.tiltY, 0);
    this.tilt.rotation.z = p.tiltZ;
    this.hips.position.set(p.hipsX + Math.sin(t * 57) * 0.005 * shiver, p.hipsY, 0);
    this.hips.rotation.set(p.hipsRx, 0, p.hipsRz + Math.sin(t * 49) * 0.014 * shiver);
    this.hips.scale.set(poof / Math.sqrt(s), s, poof / Math.sqrt(s));
    this.neck.rotation.set(p.headRx, p.headRy, p.headRz + Math.sin(t * 43 + 1) * 0.025 * shiver);

    const u = clamp(p.scarf, 0, 1.1);
    this.hood.visible = u > 0.03;
    if (this.hood.visible) {
      this.hood.rotation.x = lerp(-2.0, 0.1, u);
      this.hood.scale.setScalar(lerp(0.85, 1, Math.min(1, u)));
    }
    const bl = clamp(p.blanket, 0, 1);
    this.blanket.visible = bl > 0.03;
    this.blanket.scale.setScalar(lerp(0.4, 1, bl));
    const sp = clamp(p.poof, 0, 1.3);
    for (const m of this.spikes) {
      m.visible = sp > 0.04;
      m.scale.setScalar(lerp(0.82, 1.08, sp));
    }

    // Limbs: hands and feet go where they're asked; arms and legs bow to reach.
    this.hips.updateMatrix();
    this.body.updateMatrixWorld(true);
    const hm = this.hips.matrix;
    this.across.set(1, 0, 0).transformDirection(hm);
    const knock = p.knock;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      // Legs: from the hip socket to the ankle.
      const hip = this.v1.copy(HIP_JOINT[i]).applyMatrix4(hm);
      const foot = this.v2.set(
        FOOT[i].x + (i ? p.fRx : p.fLx), FOOT[i].y + (i ? p.fRy : p.fLy), FOOT[i].z + (i ? p.fRz : p.fLz),
      );
      const d = hip.distanceTo(foot);
      if (d > LEG * 1.1) foot.sub(hip).multiplyScalar((LEG * 1.1) / d).add(hip);
      const knee = this.v3;
      bow(hip, foot, LEG, this.v4.set(-side * knock * 0.9, 0.2, 1), knee);
      const h0 = hip.clone();
      const f0 = foot.clone();
      const k0 = knee.clone();
      this.legs[i].shape((w, out) => quad(h0, k0, f0, w, out), (w) => lerp(0.05, 0.034, w) * roundEnds(w));
      const fm = this.feet[i];
      fm.position.copy(f0).add(this.v4.set(0, -0.015, 0.06));
      const lifted = clamp((f0.y - FOOT[i].y) / 0.2, 0, 1);
      fm.rotation.set(0.5 * lifted, 0, 0);
      // Arms: from the shoulder to the paw.
      const sh = this.v1.copy(SHOULDER[i]).applyMatrix4(hm);
      const hand = this.v2.set(i ? p.hRx : p.hLx, i ? p.hRy : p.hLy, i ? p.hRz : p.hLz).applyMatrix4(hm);
      const da = sh.distanceTo(hand);
      if (da > ARM * 1.12) hand.sub(sh).multiplyScalar((ARM * 1.12) / da).add(sh);
      bow(sh, hand, ARM, this.v4.set(side, -0.35, -0.45).transformDirection(hm), this.v3);
      const s0 = sh.clone();
      const a0 = hand.clone();
      const c0 = this.v3.clone();
      this.arms[i].shape(
        (w, out) => quad(s0, c0, a0, w, out),
        (w) => lerp(0.037, 0.03, w) * roundEnds(w),
      );
      const end = this.arms[i].end;
      const m = this.mitts[i];
      m.position.copy(a0);
      const fwd = this.v4.copy(end.t);
      const x = this.v1.copy(this.across).addScaledVector(fwd, -this.across.dot(fwd)).normalize();
      const z = this.v3.crossVectors(x, fwd).normalize();
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, fwd, z));
      m.position.addScaledVector(fwd, 0.035);
    }

    const lift = clamp((p.hipsY - HIP) / 0.6, 0, 1);
    this.shadow.scale.setScalar((1 - lift * 0.45) * 0.6 * (1 + Math.abs(Math.sin(p.tiltZ)) * 0.9));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 1 - lift * 0.6;
  }

  /** Ears, tail and scarf swing after the movement. */
  private motion(dt: number): void {
    if (dt <= 0) return;
    const x = this.root.position.x;
    const y = this.hips.position.y;
    const k = 1 - Math.exp(-dt * 10);
    this.vel.x += ((x - this.lastX) / dt - this.vel.x) * k;
    this.vel.y += ((y - this.lastHipY) / dt - this.vel.y) * k;
    this.lastX = x;
    this.lastHipY = y;

    const p = this.pose;
    const t = this.clock;
    this.head.updateWorldMatrix(true, false);
    this.body.updateWorldMatrix(true, false);
    const toBody = new THREE.Matrix4().copy(this.body.matrixWorld).invert();
    const headM = this.head.matrixWorld;
    for (let i = 0; i < 2; i++) {
      const e = this.ears[i];
      const side = e.side;
      const up = clamp(i ? p.earR : p.earL, -0.3, 1.2);
      const out = clamp(p.earOut, 0, 1.2);
      const back = clamp(p.earBack, 0, 1.2);
      // Where the root of the ear points (head space): hanging out to the side, up, or flying straight out.
      const dir = this.v1.set(side * 0.75, -0.5, -0.12).multiplyScalar(Math.max(0, 1 - up - out));
      dir.addScaledVector(this.v2.set(side * 0.25, 1, -0.05), Math.max(0, up));
      dir.addScaledVector(this.v2.set(side * 1, 0.28, -0.1), out);
      dir.z -= back * 0.9;
      if (p.earSpin > 0.01) dir.applyAxisAngle(Z_AXIS, side * Math.sin(t * 16 + i * 1.5) * 1.2 * p.earSpin);
      // A twitch: the ear flicks up and out, then falls back.
      const flick = kf(t - this.flickAt[i], [[0, 0], [0.07, 1], [0.32, 0]]);
      dir.addScaledVector(this.v2.set(side * 0.4, 0.9, 0), flick * 0.7);
      dir.normalize().transformDirection(headM);
      const base = this.v2.copy(e.pivot).applyMatrix4(headM);
      // Relaxed, they hang and sway slowly; in a fright (or spinning) they stand stiff and quick.
      const stiff = clamp(Math.max(up, out, p.earSpin), 0, 1);
      e.strand.update(dt, base, dir, 0.8 * (1 - stiff), lerp(0.22, 0.05, stiff), lerp(9, 22, stiff), 0.8);
      const pts = e.strand.p.map((q) => q.clone().applyMatrix4(toBody));
      const curve = new THREE.CatmullRomCurve3(pts);
      // Flat, with its face to the front.
      const across = this.v3.set(0, 0, 1).transformDirection(headM).transformDirection(toBody);
      const width = (w: number) => (0.05 + 0.035 * Math.sin(Math.PI * Math.min(1, w * 1.1))) * Math.sqrt(Math.max(0, 1 - Math.max(0, (w - 0.9) / 0.1) ** 2));
      e.base.shape((w, o) => curve.getPoint(w * 0.78, o), (w) => width(w * 0.78), across, 0.36, true);
      e.tip.shape((w, o) => curve.getPoint(0.76 + w * 0.24, o), (w) => width(0.76 + w * 0.24), across, 0.36, true);
    }
    // The tail: up and back at rest, tucked when scared, wagging.
    const tuck = clamp(-p.tail, 0, 1.2);
    const raise = clamp(p.tail, 0, 1);
    this.hips.updateWorldMatrix(true, false);
    const hm = this.hips.matrixWorld;
    const tdir = this.v1.set(0, 0.55 + raise * 0.4, -0.85).lerp(this.v2.set(0, -0.9, 0.35), tuck);
    tdir.applyAxisAngle(Y_AXIS, Math.sin(t * 15) * 0.7 * clamp(p.wag, 0, 1.3) * (1 - 0.8 * tuck));
    tdir.normalize().transformDirection(hm);
    const tbase = this.v2.set(0, -0.02, -0.19).applyMatrix4(hm);
    this.tailStrand.update(dt, tbase, tdir, 0.35, 0.15, 14, 0.75);
    const tp = this.tailStrand.p.map((q) => q.clone().applyMatrix4(toBody));
    const tc = new THREE.CatmullRomCurve3(tp);
    this.tailMesh.shape((w, o) => tc.getPoint(w, o), (w) => lerp(0.032, 0.018, w) * roundEnds(w));
    this.tuft.position.copy(tp[tp.length - 1]);
    this.tuft.quaternion.setFromUnitVectors(Y_AXIS, this.tailMesh.end.t);

    this.hips.updateWorldMatrix(true, true);
    this.rope.update(dt, this.ropeAnchor.getWorldPosition(this.v3), this.hips, this.root, this.ropePin);
  }

  // ── Particles ───────────────────────────────────────────────────────────────

  private burst(
    at: THREE.Vector3, count: number, color: string, size: number, speed: number, gravity: number, toward?: THREE.Vector3,
  ): void {
    const geo = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true }));
      mesh.position.copy(at);
      mesh.scale.setScalar(size * (0.6 + Math.random() * 0.6));
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.8 + 0.4, Math.random() * 0.6).multiplyScalar(
        speed * (0.5 + Math.random() * 0.7),
      );
      if (toward) v.multiplyScalar(0.3).addScaledVector(toward, speed * (0.7 + Math.random() * 0.6));
      const max = 0.45 + Math.random() * 0.35;
      this.world.add(mesh);
      this.particles.push({ mesh, v, life: max, max, gravity });
    }
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.v.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.v, dt);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = clamp(p.life / p.max, 0, 1);
    }
    for (const p of this.particles.filter((q) => q.life <= 0)) {
      this.world.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.particles = this.particles.filter((q) => q.life > 0);
  }

  // ── Helpers for behaviours ──────────────────────────────────────────────────

  /** Puts a paw (0 left, 1 right) at a body (hips) space spot, blended in by `k`. */
  private paw(i: number, at: THREE.Vector3, k: number): void {
    const P = this.target;
    if (i === 0) {
      P.hLx = lerp(P.hLx, at.x, k);
      P.hLy = lerp(P.hLy, at.y, k);
      P.hLz = lerp(P.hLz, at.z, k);
    } else {
      P.hRx = lerp(P.hRx, at.x, k);
      P.hRy = lerp(P.hRy, at.y, k);
      P.hRz = lerp(P.hRz, at.z, k);
    }
  }

  /** Puts a paw at a spot on his head (head space), blended in by `k`. */
  private pawToHead(i: number, at: THREE.Vector3, k: number): void {
    this.head.updateWorldMatrix(true, false);
    this.hips.updateWorldMatrix(true, false);
    const w = this.head.localToWorld(this.v4.copy(at));
    this.paw(i, this.hips.worldToLocal(w), k);
  }

  /** Legs running in the air (or scrabbling), `amt` 0..1, lifted `lift`. */
  private legCycle(t: number, speed: number, amt: number, lift = 0.2): void {
    const P = this.target;
    const a = t * speed;
    P.fLz += Math.sin(a) * 0.2 * amt;
    P.fLy += (lift + Math.cos(a) * 0.14) * amt;
    P.fRz += Math.sin(a + Math.PI) * 0.2 * amt;
    P.fRy += (lift + Math.cos(a + Math.PI) * 0.14) * amt;
  }

  /** Knees knocking together. */
  private kneesKnock(t: number, amt: number): void {
    const P = this.target;
    P.knock = lerp(P.knock, 0.85 + Math.sin(t * 30) * 0.35, amt);
    P.fLx += 0.03 * amt;
    P.fRx -= 0.03 * amt;
  }

  /** A sweat drop sliding down the side of his head, `u` 0..1 of the way. */
  private sweatAt(u: number, side: number): void {
    const s = clamp(u, 0, 1);
    const x = side * (0.36 - s * 0.04);
    const y = 0.2 - s * 0.22;
    const z = DOG_HEAD.z * Math.sqrt(Math.max(0, 1 - (x / DOG_HEAD.x) ** 2 - (y / DOG_HEAD.y) ** 2)) + 0.03;
    this.sweat.visible = s > 0 && s < 1;
    this.sweat.position.set(x, y, z);
    const fade = 1 - smooth(clamp((s - 0.7) / 0.3, 0, 1));
    const grow = smooth(clamp(s / 0.15, 0, 1));
    this.sweat.scale.set(0.03 * fade * grow, 0.045 * fade * grow, 0.03 * fade * grow);
  }

  /** Sweat drops flying off both sides of his head. */
  private flingSweat(n = 2): void {
    this.head.updateWorldMatrix(true, false);
    for (const side of [-1, 1]) {
      const from = this.head.localToWorld(this.v1.set(side * 0.38, 0.18, 0.1));
      this.burst(from, n, "#a6dbff", 0.026, 1.5, 5, new THREE.Vector3(side, 0.8, 0.2).normalize());
    }
  }

  /** A sprite (an "!" or "?") floating by his head. */
  private floatBy(sprite: THREE.Sprite, show: number, t: number, side = 1): void {
    sprite.visible = show > 0.01;
    if (!sprite.visible) return;
    if (sprite.parent !== this.world) this.world.add(sprite);
    const h = this.head.getWorldPosition(this.v1);
    sprite.position.set(h.x + side * 0.55, h.y + 0.38 + Math.sin(t * 5) * 0.03, h.z + 0.25);
    sprite.scale.setScalar(0.42 * show);
    sprite.material.rotation = Math.sin(t * 4) * 0.15;
  }

  private unwind(): void {
    const turns = Math.PI * 2 * Math.round(this.pose.yaw / (Math.PI * 2));
    this.pose.yaw -= turns;
    this.target.yaw -= turns;
  }

  /** The full freak-out: a leap straight up, legs going, eyes popping, ears out, fur on end, a scream. `k` scales it. */
  private freakOut(t: number, k: number, height: number): void {
    const P = this.target;
    const leap = kf(t, [[0, 0], [0.07, -0.08], [0.25, height * 0.85], [0.42, height], [0.6, height * 0.8], [0.78, 0.02], [0.86, -0.07], [1.0, 0]]);
    P.hipsY += leap * k;
    P.squash *= lerp(1, kf(t, [[0, 1], [0.07, 0.84], [0.22, 1.12], [0.7, 1.05], [0.8, 0.84], [1.0, 1]]), k);
    const air = kf(t, [[0.1, 0], [0.2, 1], [0.7, 1], [0.8, 0]]) * k;
    // Feet stay with him in the air, running.
    P.fLy += leap * k * 0.9;
    P.fRy += leap * k * 0.9;
    this.legCycle(t, 26, air, 0.05);
    P.pop = Math.max(P.pop, kf(t, [[0.08, 0], [0.2, 1.1], [0.8, 0.8], [1.1, 0.3]]) * k);
    P.earOut = kf(t, [[0.06, 0], [0.16, 1.1], [0.8, 1], [1.1, 0.3]]) * k;
    P.poof = kf(t, [[0.1, 0], [0.2, 1.1], [0.8, 1], [1.2, 0]]) * k;
    P.tail = -1;
    P.wag = 0;
    // Arms flung up and flailing.
    const fling = kf(t, [[0.05, 0], [0.18, 1], [0.75, 1], [0.9, 0]]) * k;
    this.paw(0, this.v4.set(-0.42, 0.85 + Math.sin(t * 22) * 0.06, 0.12), fling);
    this.paw(1, this.v4.set(0.42, 0.85 + Math.sin(t * 22 + 1) * 0.06, 0.12), fling);
  }

  // ── Behaviour library ───────────────────────────────────────────────────────

  /** A sneaky cartoon tiptoe: big slow high-kneed steps, hunched, paws up; a stroll freezes at a noise halfway. */
  private tiptoe(x: number, speed: number, stroll: boolean): Running {
    let phase = 0;
    let arrived = false;
    let after = 0;
    let pause = stroll ? 0 : -1;
    let hurry = 1;
    const startX = this.root.position.x;
    const pauseAt = (startX + x) / 2;
    return {
      name: stroll ? "stroll" : "walk",
      t: 0,
      step: (t, dt) => {
        const P = this.target;
        this.expr = "worried";
        const dx = x - this.root.position.x;
        const dir = Math.sign(x - startX) || 1;
        if (arrived) {
          after += dt;
          this.expr = "relieved";
          return after < 0.6;
        }
        if (pause >= 0 && Math.sign(pauseAt - this.root.position.x) !== dir) {
          // What was that?! Freeze mid-step, a look back... nothing. Phew; scurry on.
          pause += dt;
          this.rate = 18;
          P.yaw = dir * kf(pause, [[0, 1.1], [0.3, 0.3], [1.6, 0.3], [1.9, 1.1]]);
          P.headRy = -dir * kf(pause, [[0.15, 0], [0.3, 0.8], [1.3, 0.8], [1.6, 0]]);
          P.earR = kf(pause, [[0, 0], [0.12, 1], [1.3, 1], [1.8, 0]]);
          P.pop = kf(pause, [[0.1, 0], [0.2, 0.8], [1.2, 0.5], [1.5, 0]]);
          P.fLy = 0.25;
          P.fLz = 0.1;
          P.shiver = kf(pause, [[0.2, 0], [0.3, 0.6], [1.3, 0.6], [1.5, 0]]);
          P.tail = -kf(pause, [[0.1, 0], [0.3, 1], [1.6, 1], [2.0, 0]]);
          this.paw(0, this.v4.set(-0.12, 0.5, 0.3), 1);
          this.paw(1, this.v4.set(0.12, 0.5, 0.3), 1);
          this.expr = pause < 0.25 ? "surprised" : pause < 1.4 ? "scared" : "relieved";
          if (pause > 0.3 && pause < 1.4) this.faceMods.lookX = -dir * 0.9;
          if (pause > 2.1) {
            pause = -1;
            hurry = 1.5;
          }
          return true;
        }
        P.yaw = dir * 1.15;
        this.rate = 14;
        this.bounce = 0.75;
        if (t > 0.2) {
          // He moves only while a foot is coming down: creep... creep...
          const go = 0.35 + 0.65 * Math.abs(Math.sin(phase));
          const move = Math.min(Math.abs(dx), speed * hurry * go * dt);
          this.root.position.x += dir * move;
          phase += dt * speed * hurry * 6;
        }
        const s = Math.sin(phase);
        P.fLz = s * 0.24;
        P.fRz = -s * 0.24;
        P.fLy = Math.max(0, s) * 0.26;
        P.fRy = Math.max(0, -s) * 0.26;
        P.knock = 0.1;
        P.hipsRx = 0.32;
        P.hipsY += Math.abs(Math.cos(phase)) * 0.05 + 0.04;
        P.hipsRz = s * 0.05;
        // Paws dangling up in front, fingertips down: classic sneak.
        this.paw(0, this.v4.set(-0.12, 0.42 + Math.max(0, -s) * 0.04, 0.32), 1);
        this.paw(1, this.v4.set(0.12, 0.42 + Math.max(0, s) * 0.04, 0.32), 1);
        P.headRy = -dir * 0.5 + Math.sin(t * 2.3) * 0.25;
        P.headRx = -0.15;
        P.tail = -0.2;
        if (Math.abs(dx) < 0.005) arrived = true;
        return true;
      },
    };
  }

  /** Round and round after his own tail, then a wobble. */
  private chaseTail(): Running {
    return {
      name: "spin",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 20;
        this.bounce = 0.6;
        const going = kf(t, [[0, 0], [0.3, 1], [2.1, 1], [2.4, 0]]);
        P.yaw = REST.yaw + kf(t, [[0.2, 0], [2.3, Math.PI * 4]], (u) => u);
        P.headRy = 1.0 * going;
        P.headRz = 0.2 * going;
        P.hipsRx = 0.35 * going;
        P.hipsY += Math.abs(Math.sin(t * 9)) * 0.04 * going;
        this.legCycle(t, 18, going * 0.6, 0.02);
        this.paw(0, this.v4.set(-0.1, 0.1, 0.35), going);
        this.paw(1, this.v4.set(0.25, 0.0, -0.1), going);
        P.tail = 0.6;
        P.wag = 1.3;
        const wob = kf(t, [[2.3, 0], [2.45, 1], [3.1, 0]]);
        P.hipsRz += Math.sin(t * 11) * 0.12 * wob;
        P.headRz += Math.sin(t * 11 + 1) * 0.15 * wob;
        P.knock = lerp(P.knock, -0.6, wob);
        this.expr = t < 2.3 ? "joy" : "dizzy";
        return t < 3.2;
      },
      end: () => this.unwind(),
    };
  }

  /** A shy, jittery little wave. */
  private wave(): Running {
    return {
      name: "wave",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 18;
        this.bounce = 0.55;
        const up = kf(t, [[0, 0], [0.35, 1], [2.0, 1], [2.4, 0]]);
        const w = t > 0.4 && t < 2.0 ? Math.sin((t - 0.4) * 16) * 0.05 : 0;
        this.paw(1, this.v4.set(0.3 + w, 0.78, 0.2), up);
        // The other paw clutches his scarf.
        this.paw(0, this.v4.set(-0.05, 0.5, 0.33), up);
        P.headRz = 0.2 * up;
        P.headRx = 0.08 * up;
        P.headRy = 0;
        P.wag = 0.9;
        P.knock = 0.7;
        P.shiver = 0.25;
        this.expr = t < 0.3 ? "neutral" : t < 1.3 ? "sheepish" : "happy";
        return t < 2.5;
      },
    };
  }

  /** Poked: jumps out of his skin, legs scrambling... hangs there a moment... and slides back down, sheepish. */
  private startle(): Running {
    const seated = this.seated;
    this.seated = false;
    const amp = this.calm ? 0.25 : 1;
    return {
      name: "poke",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 24;
        this.bounce = 0.45;
        if (seated) blendInto(P, SEATED, kf(t, [[0, 1], [0.15, 0]]));
        const h = 0.3 * amp;
        // Up like a shot, hangs in the air scrabbling, then slides down slowly.
        const y = kf(t, [[0, 0], [0.06, -0.06], [0.2, h], [0.75, h * 0.95], [1.5, 0.02], [1.6, 0]]);
        P.hipsY += y;
        P.squash *= lerp(1, kf(t, [[0, 1], [0.06, 0.84], [0.18, 1.14], [0.4, 1.04], [1.5, 1.0], [1.58, 0.9], [1.7, 1]]), amp);
        P.fLy += y * 0.95;
        P.fRy += y * 0.95;
        this.legCycle(t, 28, kf(t, [[0.1, 0], [0.2, 1], [0.8, 1], [1.0, 0]]) * amp, 0.02);
        P.pop = kf(t, [[0.05, 0], [0.15, 1.1], [0.7, 0.9], [1.1, 0]]) * amp;
        P.earOut = kf(t, [[0.05, 0], [0.15, 1], [0.8, 1], [1.2, 0]]) * amp;
        P.earR = kf(t, [[0.8, 0], [1.0, 0.6], [1.8, 0]]);
        P.poof = kf(t, [[0.08, 0], [0.16, 1], [0.7, 0.8], [1.0, 0]]) * amp;
        P.tail = -kf(t, [[0.06, 0], [0.16, 1], [1.2, 1], [1.6, 0]]);
        const fling = kf(t, [[0.04, 0], [0.16, 1], [0.75, 1], [0.95, 0]]) * amp;
        this.paw(0, this.v4.set(-0.4, 0.82, 0.1), fling);
        this.paw(1, this.v4.set(0.4, 0.82, 0.1), fling);
        // Heh... a scratch of the head.
        const scratch = kf(t, [[1.2, 0], [1.45, 1], [2.2, 1], [2.45, 0]]);
        this.pawToHead(1, this.v4.set(0.3 + Math.sin(t * 22) * 0.03, 0.3, -0.05), scratch);
        P.headRz += 0.18 * scratch;
        P.wag = lerp(0, 0.6, scratch);
        if (t < 0.12) this.expr = "surprised";
        else if (t < 0.85) this.expr = this.calm ? "surprised" : "panic";
        else this.expr = "sheepish";
        return t < 2.5;
      },
    };
  }

  private sitDown(): Running {
    return {
      name: "sit",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 14;
        this.bounce = 0.55;
        this.expr = "neutral";
        P.squash = kf(t, [[0, 1], [0.35, 1.04], [0.7, 0.96], [1.0, 0.88], [1.2, 1.03], [1.4, 1]]);
        blendInto(P, SEATED, kf(t, [[0.5, 0], [1.0, 1]]));
        P.headRy = 0;
        if (t >= 1.4) this.seated = true;
        return t < 1.4;
      },
    };
  }

  private sitting(seconds: number, mood: DogExpression, name = "seated"): Running {
    return {
      name,
      t: 0,
      step: (t) => {
        const P = this.target;
        blendInto(P, SEATED, 1);
        P.squash = 1 + Math.sin(t * 1.6) * 0.02;
        this.expr = mood;
        return t < seconds;
      },
    };
  }

  private standUp(): Running {
    this.seated = false;
    return {
      name: "stand",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 14;
        blendInto(P, SEATED, kf(t, [[0, 1], [0.55, 0]]));
        P.hipsRx += kf(t, [[0, 0], [0.25, 0.25], [0.55, 0]]);
        P.squash = kf(t, [[0.45, 1], [0.58, 0.92], [0.75, 1]]);
        return t < 0.8;
      },
    };
  }

  /**
   * "AAAH! I'm needed!": the full freak-out, then he lands and hides — the
   * scarf pulled over his head — knees knocking, peeking out at you now and then.
   */
  private call(): Running {
    const calm = this.calm;
    const mark = theExclaim();
    let peekAt = 4.4;
    let lookAround = 2.8;
    return {
      name: "call",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 18;
        this.bounce = 0.5;
        P.headRy = 0;
        P.yaw = 0.05;
        this.freakOut(t, calm ? 0 : 1, 0.36);
        // Then the scarf, up and over his head, held down with both paws.
        P.scarf = kf(t, [[1.0, 0], [1.5, 1.05]]);
        const hide = kf(t, [[0.9, 0], [1.2, 1]]);
        if (t > peekAt + 2.2) peekAt = t + 3.2 + Math.random() * 2;
        const peek = t > 1.8 ? kf(t - peekAt, [[0, 0], [0.3, 1], [1.4, 1], [1.7, 0]]) : 0;
        this.pawToHead(0, this.v4.set(-0.33, 0.12, 0.22), hide * (1 - 0.6 * peek));
        this.pawToHead(1, this.v4.set(0.33, 0.12, 0.22), hide * (1 - 0.6 * peek));
        // Crouched, knees knocking, trembling.
        const cower = kf(t, [[1.0, 0], [1.3, 1]]) * (1 - 0.7 * peek);
        P.hipsY -= 0.1 * cower;
        P.hipsRx += 0.18 * cower;
        P.headRx = 0.12 * cower - 0.12 * peek;
        if (!calm) this.kneesKnock(t, cower);
        P.shiver = calm ? 0 : 0.6 * cower;
        P.scarf -= 0.2 * peek;
        if (t > lookAround + 1.2) lookAround = t + 2.5 + Math.random() * 3;
        const dart = t > 1.8 && peek < 0.1 ? kf(t - lookAround, [[0, 0], [0.12, 1], [0.6, 1], [0.75, -1], [1.0, -1], [1.15, 0]]) : 0;
        P.headRy = dart * 0.25;
        P.earBack = 0.6 * cower;
        P.tail = -1;

        if (t < 0.15) this.expr = "surprised";
        else if (t < 0.95) this.expr = calm ? "worried" : "panic";
        else if (peek > 0.4) this.expr = "ooh";
        else this.expr = "scared";
        if (t > 0.95) {
          this.faceMods.jaw = 0;
          this.faceMods.lookX = dart * 0.9;
          // Peeking out from under the hood's edge.
          this.faceMods.lookY = peek > 0.4 ? -0.6 : 0.15;
          this.faceMods.teeth = peek > 0.4 ? 0 : 1;
          this.faceMods.shake = calm ? 0 : 0.5;
          this.faceMods.eyeOpen = 1;
        }
        if (peek > 0.4) P.wag = 0.35;
        this.floatBy(mark, kf(t, [[0.12, 0], [0.25, 1.15], [0.35, 1], [2.8, 1], [3.1, 0]]), t, 1);
        return true;
      },
      end: () => {
        mark.removeFromParent();
      },
    };
  }

  /**
   * Working: sits with the tablet on his knees, typing frantically, eyes
   * darting; now and then he stops to chew his nails, teeth chattering, and
   * the sweat flies.
   */
  private working(): Running {
    const tab = tablet("#2f8f8a");
    paint(tab, this.look);
    tab.scale.setScalar(0.01);
    tab.position.set(0, 0.2, 0.42);
    tab.rotation.x = 0.85;
    this.hips.add(tab);
    let nextChew = 3.5 + Math.random() * 2;
    let chewAt = -9;
    let nextSweat = 2.5;
    let nextLook = 2;
    let looking = 0;
    const away = (): Running => ({
      name: "work-end",
      t: 0,
      step: (t) => {
        blendInto(this.target, SEATED, 1);
        tab.scale.setScalar(kf(t, [[0, 1], [0.08, 1.1], [0.3, 0.01]]));
        return t < 0.3;
      },
      end: () => dispose(tab),
    });
    return {
      name: "work",
      t: 0,
      step: (t) => {
        const P = this.target;
        blendInto(P, SEATED, 1);
        this.rate = 18;
        tab.scale.setScalar(kf(t, [[0, 0.01], [0.25, 1.1], [0.4, 1]]));
        P.hipsRx = 0.18;
        P.headRx = 0.32;
        P.headRy = 0;
        // Typing: paws hammering the screen in turn.
        const tapL = Math.max(0, Math.sin(t * 24));
        const tapR = Math.max(0, Math.sin(t * 24 + 2));
        if (chewAt < 0 && t > nextChew) chewAt = t;
        const chew = chewAt >= 0 ? kf(t - chewAt, [[0, 0], [0.25, 1], [1.8, 1], [2.1, 0]]) : 0;
        if (chewAt >= 0 && t - chewAt > 2.1) {
          chewAt = -9;
          nextChew = t + 3.5 + Math.random() * 3;
        }
        const type = 1 - chew;
        this.paw(0, this.v4.set(-0.1 + Math.sin(t * 7) * 0.03, 0.27 + tapL * 0.05, 0.42), 1);
        this.paw(1, this.v4.set(0.1 + Math.sin(t * 9) * 0.03, 0.27 + tapR * 0.05, 0.42), type);
        // Nail-chewing: a paw up at his mouth, teeth chattering on it.
        this.pawToHead(1, this.face.mouth().add(this.v3.set(0.02, -0.02, 0.06)), chew);
        P.headRx = lerp(P.headRx, 0.12, chew);
        // Eyes darting about.
        if (t > nextLook) {
          looking = Math.random() < 0.5 ? -1 : 1;
          nextLook = t + 0.6 + Math.random() * 1.4;
        }
        if (nextSweat < t) {
          nextSweat = t + 2.5 + Math.random() * 2.5;
          this.flingSweat(1);
        }
        this.sweatAt(((t * 0.55) % 1), 1);
        P.shiver = 0.25;
        P.tail = -0.4;
        P.wag = 0;
        P.knock = 0.6 + Math.sin(t * 20) * 0.2;
        this.expr = chew > 0.5 ? "scared" : "worried";
        this.faceMods.lookY = chew > 0.5 ? 0 : -0.8;
        this.faceMods.lookX = looking * 0.8 * (t % 1.2 < 0.6 ? 1 : 0.3);
        this.faceMods.eyeOpen = 1;
        if (chew > 0.5) {
          this.faceMods.teeth = 0;
          this.faceMods.jaw = 0.12 + Math.max(0, Math.sin(t * 34)) * 0.12;
        }
        return true;
      },
      outro: away,
      end: () => {
        dispose(tab);
        this.sweat.visible = false;
      },
    };
  }

  /**
   * It worked! A weird wobbly noodle-leg jig with his ears whirling, then he
   * melts into a relieved slouch and wipes his forehead.
   */
  private jig(): Running {
    let sparkled = false;
    let flicked = false;
    let puffed = false;
    const tmp = new THREE.Vector3();
    return {
      name: "hooray",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 20;
        this.bounce = 0.5;
        P.headRy = 0;
        P.yaw = 0.1;
        const jig = kf(t, [[0, 0], [0.15, 1], [1.6, 1], [1.8, 0]]);
        const s = Math.sin(t * 13);
        P.fLy += Math.max(0, s) * 0.22 * jig;
        P.fRy += Math.max(0, -s) * 0.22 * jig;
        P.fLx -= Math.max(0, s) * 0.08 * jig;
        P.fRx += Math.max(0, -s) * 0.08 * jig;
        P.knock = lerp(P.knock, Math.sin(t * 13) * 0.9, jig);
        P.hipsX = Math.sin(t * 6.5) * 0.08 * jig;
        P.hipsRz = -Math.sin(t * 6.5) * 0.12 * jig;
        P.hipsY += Math.abs(Math.cos(t * 13)) * 0.05 * jig;
        this.paw(0, this.v4.set(-0.4, 0.78 + Math.sin(t * 13) * 0.08, 0.1), jig);
        this.paw(1, this.v4.set(0.4, 0.78 - Math.sin(t * 13) * 0.08, 0.1), jig);
        P.earSpin = jig;
        P.wag = 1.3 * jig;
        P.tail = 0.7 * jig;
        if (!sparkled && t > 0.3) {
          sparkled = true;
          this.burst(this.head.getWorldPosition(tmp), 12, "#ffd36b", 0.022, 2.2, 2);
        }
        // Then the melt: everything goes soft.
        const melt = kf(t, [[1.7, 0], [2.0, 1], [3.6, 1], [3.9, 0]]);
        P.hipsY -= 0.14 * melt;
        P.squash *= 1 - 0.08 * melt;
        P.hipsRx += 0.25 * melt;
        P.knock = lerp(P.knock, -0.5, melt);
        P.headRx += 0.18 * melt;
        P.earBack = 0.5 * melt;
        if (!puffed && t > 1.95) {
          puffed = true;
          this.head.updateWorldMatrix(true, false);
          const m = this.head.localToWorld(tmp.copy(this.face.mouth()).add(new THREE.Vector3(0, 0, 0.08)));
          this.burst(m, 5, "#ffffff", 0.03, 0.8, -0.3, new THREE.Vector3(0.2, 0.1, 1).normalize());
        }
        // And a paw across his forehead.
        const wipe = kf(t, [[2.1, 0], [2.35, 1], [3.2, 1], [3.45, 0]]);
        const sweep = kf(t, [[2.35, 0.3], [2.8, -0.22], [2.9, -0.22], [3.2, 0.3]]);
        this.pawToHead(1, this.v4.set(sweep, 0.36, 0.26), wipe);
        this.paw(0, this.v4.set(-0.25, 0.02, 0.15), melt);
        if (t < 2.2) this.sweatAt(0.15, -1);
        else this.sweat.visible = false;
        if (!flicked && t > 2.85) {
          flicked = true;
          this.head.updateWorldMatrix(true, false);
          this.burst(this.head.localToWorld(tmp.set(-0.4, 0.3, 0.2)), 3, "#a6dbff", 0.026, 1.3, 5, new THREE.Vector3(-1, 0.6, 0.2).normalize());
        }
        if (t < 1.7) this.expr = "joy";
        else this.expr = "relieved";
        return t < 4.0;
      },
      end: () => {
        this.sweat.visible = false;
      },
    };
  }

  /** A jittery little nod: o-okay! */
  private nod(): Running {
    return {
      name: "nod",
      t: 0,
      step: (t) => {
        const P = this.target;
        if (this.seated) blendInto(P, SEATED, 1);
        this.rate = 22;
        P.headRx += kf(t, [[0, 0], [0.1, 0.22], [0.2, -0.04], [0.3, 0.2], [0.4, -0.02], [0.5, 0.15], [0.62, 0]]);
        P.headRy = 0;
        P.wag = 0.6;
        this.expr = "happy";
        return t < 0.8;
      },
    };
  }

  /** "Hmm?": a paw tapping his chin, head tilted, one ear lifting. */
  private ponder(): Running {
    return {
      name: "ponder",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 12;
        const up = kf(t, [[0, 0], [0.4, 1]]);
        const tap = Math.max(0, Math.sin(t * 9)) * 0.02;
        this.pawToHead(1, this.face.mouth().add(this.v3.set(0.03, -0.06 + tap, 0.02)), up);
        this.paw(0, this.v4.set(-0.05, 0.3, 0.25), up);
        const side = Math.floor(t / 2.6) % 2 ? -1 : 1;
        const tilt = kf(t % 2.6, [[0, 0], [0.3, 1], [2.2, 1], [2.6, 0]]);
        P.headRz = side * 0.32 * tilt * up;
        P.headRy = 0;
        if (side > 0) P.earL = 0.45 * tilt;
        else P.earR = 0.45 * tilt;
        this.expr = "ooh";
        this.faceMods.lookX = 0.35 * side;
        this.faceMods.lookY = 0.5;
        return true;
      },
    };
  }

  /** "I don't understand...": an extreme head tilt, ears flopping, a scratch of the head, a "?". */
  private puzzled(): Running {
    const q = theQuestion();
    return {
      name: "shrug",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 12;
        this.bounce = 0.5;
        const up = kf(t, [[0, 0], [0.3, 1]]);
        const side = Math.floor(t / 3) % 2 ? -1 : 1;
        const tilt = kf(t % 3, [[0, 0], [0.35, 1], [2.6, 1], [3, 0]]);
        P.headRz = side * 0.62 * tilt * up;
        P.hipsRz = -side * 0.08 * tilt;
        P.headRy = 0;
        this.pawToHead(side > 0 ? 0 : 1, this.v4.set(-side * 0.3 + Math.sin(t * 20) * 0.03, 0.3, 0), up);
        this.paw(side > 0 ? 1 : 0, this.v4.set(side * 0.35, 0.25, 0.25), up);
        P.earBack = 0.15;
        P.knock = 0.6;
        this.expr = "confused";
        this.floatBy(q, kf(t, [[0.2, 0], [0.4, 0.8], [0.5, 0.7]]), t, -side);
        return true;
      },
      end: () => {
        q.removeFromParent();
      },
    };
  }

  /**
   * Something went wrong: a huge cartoon scream (eyes popping, jaw dropped,
   * tongue flapping), then he faints stiff as a board and tips right over...
   * pops back up, woozy, and stands there wilting.
   */
  private droop(): Running {
    const calm = this.calm;
    const fall = this.root.position.x > 0 ? 1 : -1;
    const T = calm ? { scream: 0, faint: 0, up: 0, woozy: 0.1 } : { scream: 1.5, faint: 1.6, up: 3.0, woozy: 3.4 };
    let wailed = false;
    let thud = false;
    let sniff = 3.5;
    const tmp = new THREE.Vector3();
    return {
      name: "droop",
      t: 0,
      step: (t) => {
        const P = this.target;
        P.headRy = 0;
        P.yaw = 0;
        if (t < T.scream) {
          this.rate = 24;
          this.bounce = 0.45;
          P.hipsY += kf(t, [[0, 0], [0.06, -0.05], [0.2, 0.14], [0.4, 0.02], [0.48, 0]]);
          P.squash *= kf(t, [[0, 1], [0.06, 0.86], [0.2, 1.14], [0.45, 1.04], [T.scream, 1.04]]);
          P.pop = kf(t, [[0.08, 0], [0.2, 1.2], [1.3, 1]]);
          P.poof = kf(t, [[0.1, 0], [0.2, 1], [1.3, 1]]);
          P.earOut = kf(t, [[0.08, 0], [0.18, 1.1]]);
          P.tail = -1;
          P.wag = 0;
          P.shiver = kf(t, [[0.3, 0], [0.4, 1]]);
          this.pawToHead(0, tmp.set(-0.36, -0.12, 0.2), kf(t, [[0.1, 0], [0.3, 1]]));
          this.pawToHead(1, tmp.set(0.36, -0.12, 0.2), kf(t, [[0.1, 0], [0.3, 1]]));
          this.kneesKnock(t, 1);
          P.headRx = -0.15;
          this.expr = t < 0.12 ? "surprised" : "panic";
          if (t > 0.12) this.faceMods.jaw = 1.15 + Math.sin(t * 17) * 0.15;
          if (!wailed && t > 0.3) {
            wailed = true;
            this.flingSweat(3);
          }
          return true;
        }
        if (t < T.up) {
          // Out cold, stiff as a board: over he goes.
          const v = t - T.faint;
          this.rate = 26;
          this.bounce = kf(v, [[0, 0.9], [0.4, 0.35]]);
          const over = kf(v, [[0, 0], [0.12, 0.08], [0.45, 1]], (u) => u * u);
          P.tiltZ = fall * 1.5 * over;
          P.tiltY = 0.8;
          P.drop = 0.48 * over;
          P.knock = 0;
          P.hipsRx = 0;
          P.fLx = 0.06;
          P.fRx = -0.06;
          this.paw(0, tmp.set(-0.24, 0.05, 0.05), 1);
          this.paw(1, tmp.set(0.24, 0.05, 0.05), 1);
          P.earOut = 0.7;
          P.tail = 0;
          P.headRx = 0;
          this.expr = "dizzy";
          this.faceMods.spiral = 0;
          this.faceMods.eyeOpen = 0;
          this.faceMods.eyeArc = -0.3;
          this.faceMods.tongue = 1;
          this.faceMods.jaw = 0.35;
          if (!thud && v > 0.45) {
            thud = true;
            this.burst(tmp.set(this.root.position.x - fall * 0.3, 0.05, 0.2), 10, "#d9cbb8", 0.045, 1.1, 1.5);
          }
          return true;
        }
        // Pops back up, woozy; then stays wilting, swaying, sniffling.
        const v = t - T.up;
        this.rate = calm ? 10 : 16;
        this.bounce = 0.5;
        const wooze = kf(v, [[0, 1], [2.0, 0.35]]);
        P.hipsRz += Math.sin(t * 3.2) * 0.08 * wooze;
        P.hipsX = Math.sin(t * 3.2) * 0.04 * wooze;
        P.headRz = Math.sin(t * 3.2 + 1) * 0.12 * wooze;
        P.hipsY -= 0.1;
        P.hipsRx += 0.25;
        P.knock = -0.3;
        P.headRx = 0.3;
        this.paw(0, tmp.set(-0.22, -0.05, 0.12), 1);
        this.paw(1, tmp.set(0.22, -0.05, 0.12), 1);
        P.earBack = 1;
        P.tail = -0.7;
        P.wag = 0;
        if (v > sniff) sniff = v + 2.8 + Math.random() * 2.5;
        const sniffle = kf(sniff - v, [[0, 0], [0.12, 1], [0.35, 0]]);
        P.headRx -= 0.08 * sniffle;
        P.squash += 0.03 * sniffle;
        this.expr = v < 1.2 && !calm ? "dizzy" : "sad";
        return true;
      },
    };
  }

  /** Getting sleepy: sitting, eyes heavy, head nodding off... then jerking awake, eyes popping. */
  private dozing(): Running {
    return {
      name: "doze",
      t: 0,
      step: (t) => {
        const P = this.target;
        blendInto(P, SEATED, 1);
        this.rate = 10;
        const c = t % 4.6;
        const nodOff = kf(c, [[0.4, 0], [3.0, 1], [3.15, 0]]);
        const jerk = kf(c, [[3.0, 0], [3.1, 1], [3.9, 1], [4.4, 0]]);
        P.headRx = 0.1 + 0.42 * nodOff - 0.1 * jerk;
        P.headRy = 0;
        P.headRz = 0.15 * nodOff;
        P.squash = 1 + Math.sin(t * 1.5) * 0.02;
        P.earBack = 0.4 * nodOff;
        if (!this.calm) {
          P.earR = jerk;
          P.pop = jerk * 0.7;
          P.hipsY += kf(c, [[3.0, 0], [3.08, 0.07], [3.25, 0]]);
        }
        this.expr = jerk > 0.3 ? "surprised" : nodOff > 0.7 ? "asleep" : "sleepy";
        if (jerk > 0.3) this.faceMods.jaw = 0;
        return true;
      },
    };
  }

  /**
   * Asleep: lying curled on his side under his scarf like a blanket; slow
   * breaths, drifting z's, a dream twitch and little paddling legs now and
   * then. A tap (or anything else to do) wakes him with a start.
   */
  private nap(forever = false, name = "nap"): Running {
    let woke = -1;
    const length = 10 + Math.random() * 4;
    this.popRequested = false;
    this.seated = false;
    const side = this.root.position.x > 0.05 ? 1 : -1;
    let dreamAt = 4;
    const tmp = new THREE.Vector3();
    return {
      name,
      t: 0,
      step: (t) => {
        const P = this.target;
        if (woke < 0) {
          this.rate = 7;
          this.bounce = 0.85;
          const down = kf(t, [[0, 0], [1.4, 1]]);
          const b = Math.sin(t * 1.5);
          P.yaw = 0;
          P.tiltZ = side * 1.45 * down;
          P.tiltY = 0.8;
          P.drop = 0.27 * down;
          P.squash = 1 + b * 0.03 * down;
          // Curled: knees up to his chest, paws tucked under his chin, head bowed.
          P.hipsRx = lerp(P.hipsRx, 0.28, down);
          P.fLz = 0.32 * down;
          P.fRz = 0.32 * down;
          P.fLy = 0.32 * down;
          P.fRy = 0.28 * down;
          P.knock = -0.2;
          P.headRx = lerp(P.headRx, 0.35, down);
          P.headRy = 0;
          P.headRz = -side * 0.1 * down;
          this.paw(0, tmp.set(-0.06, 0.5, 0.32), down);
          this.paw(1, tmp.set(0.06, 0.45, 0.34), down);
          P.blanket = kf(t, [[0.8, 0], [1.6, 1]]);
          P.earBack = 0.3;
          P.tail = -0.6 * down;
          P.wag = 0;
          P.shiver = 0;
          // A dream: legs paddling, an ear flicking, a little whimper of a twitch.
          if (t > dreamAt + 2) dreamAt = t + 4 + Math.random() * 4;
          const dream = t > 3 ? kf(t - dreamAt, [[0, 0], [0.2, 1], [1.4, 1], [1.7, 0]]) : 0;
          this.legCycle(t, 14, dream * 0.35, 0);
          if (dream > 0.5 && Math.sin(t * 7) > 0.98) this.twitch(Math.random() < 0.5 ? 0 : 1);
          this.expr = t < 1.2 ? "sleepy" : "asleep";
          if (dream > 0.3) this.faceMods.browTilt = 1;
          this.head.updateWorldMatrix(true, false);
          this.head.getWorldPosition(tmp);
          this.zs.forEach((z, i) => {
            const k = ((t - 2 + i * 1.1) % 3.3) / 3.3;
            z.visible = t > 2 + i * 1.1;
            if (!z.visible) return;
            z.position.copy(this.root.worldToLocal(tmp.clone().add(new THREE.Vector3(0.25 + k * 0.3, 0.3 + k * 0.5, 0.2))));
            z.scale.setScalar(0.12 + k * 0.16);
            z.material.opacity = Math.min(1, k * 5) * (1 - smooth(clamp((k - 0.6) / 0.4, 0, 1)));
            z.material.rotation = -0.3 + Math.sin(t * 2 + i) * 0.2;
          });
          if (this.popRequested || (!forever && t > length)) {
            woke = t;
            for (const z of this.zs) z.visible = false;
          }
          return true;
        }
        // Woken: up like a shot, eyes popping, a wary look round, a sheepish grin.
        const v = t - woke;
        this.rate = 22;
        this.bounce = 0.5;
        const up = kf(v, [[0, 1], [0.3, 0]]);
        P.tiltZ = side * 1.45 * up;
        P.tiltY = 0.8;
        P.drop = 0.27 * up;
        P.blanket = up;
        P.hipsY += kf(v, [[0.2, 0], [0.32, 0.18], [0.5, 0]]) * (this.calm ? 0.3 : 1);
        P.pop = kf(v, [[0.2, 0], [0.3, 1], [1.0, 0]]);
        P.earR = kf(v, [[0.2, 0], [0.3, 1], [1.4, 1], [2.0, 0]]);
        P.headRy = kf(v, [[0.6, 0], [0.85, -0.45], [1.25, -0.45], [1.5, 0.45], [1.9, 0.45], [2.2, 0]]);
        if (v < 0.5) this.expr = "surprised";
        else if (v < 2.1) this.expr = "worried";
        else this.expr = "sheepish";
        if (v > 0.5 && v < 2.1) this.faceMods.lookX = -P.headRy * 2;
        return v < (this.queue.length ? 0.75 : 2.8);
      },
      end: () => {
        for (const z of this.zs) z.visible = false;
        this.popRequested = false;
      },
    };
  }

  /** Waking up for the day: peeks in from the side, tiptoes over, a shy jittery wave. */
  private peekIn(): Running {
    const from = -Math.min(this.bounds, 0.9);
    const home = this.root.position.x;
    let phase = 0;
    let arrived = -1;
    return {
      name: "boot",
      t: 0,
      step: (t, dt) => {
        const P = this.target;
        this.rate = 14;
        if (t < 0.05) this.root.position.x = from;
        if (t < 1.2) {
          // Leaning in from the side, just his head round the corner.
          P.yaw = 0.9;
          P.hipsRz = -0.35 * kf(t, [[0, 0], [0.4, 1], [1.0, 1], [1.2, 0]]);
          P.headRy = -0.8;
          P.headRz = 0.3;
          this.expr = t < 0.6 ? "worried" : "ooh";
          this.faceMods.lookX = 0.6;
          P.earR = kf(t, [[0.5, 0], [0.6, 0.6], [1.0, 0]]);
          return true;
        }
        if (arrived < 0 && Math.abs(this.root.position.x - home) > 0.01 && t < 4.5) {
          const dir = Math.sign(home - this.root.position.x);
          const go = 0.35 + 0.65 * Math.abs(Math.sin(phase));
          this.root.position.x += dir * Math.min(Math.abs(home - this.root.position.x), 0.5 * go * dt);
          phase += dt * 3.2;
          const s = Math.sin(phase);
          P.yaw = dir * 1.1;
          P.fLz = s * 0.22;
          P.fRz = -s * 0.22;
          P.fLy = Math.max(0, s) * 0.24;
          P.fRy = Math.max(0, -s) * 0.24;
          P.hipsRx = 0.3;
          this.paw(0, this.v4.set(-0.12, 0.42, 0.32), 1);
          this.paw(1, this.v4.set(0.12, 0.42, 0.32), 1);
          P.headRy = -dir * 0.6;
          this.expr = "worried";
          return true;
        }
        if (arrived < 0) {
          arrived = t;
          this.root.position.x = home;
        }
        const v = t - arrived;
        const wave = kf(v, [[0, 0], [0.3, 1], [1.4, 1], [1.7, 0]]);
        this.paw(1, this.v4.set(0.3 + Math.sin(t * 18) * 0.05, 0.78, 0.2), wave);
        this.paw(0, this.v4.set(-0.05, 0.5, 0.33), wave);
        P.headRz = 0.2 * wave;
        P.knock = 0.8;
        P.shiver = 0.3;
        P.wag = 0.8 * wave;
        this.expr = "sheepish";
        return v < 1.9;
      },
    };
  }

  /** Picked up: legs running wildly in the air, eyes popping, teeth chattering, ears out. */
  private dangle(): Running {
    this.seated = false;
    return {
      name: "held",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 16;
        this.bounce = 0.45;
        P.yaw = 0;
        P.hipsY = HIP + 0.12;
        P.hipsRz = clamp(-this.carry.x * 0.0012, -0.5, 0.5);
        P.hipsRx = clamp(this.carry.y * 0.0008, -0.3, 0.3);
        const run = this.calm ? 0.35 : 1;
        P.fLy += 0.16;
        P.fRy += 0.16;
        this.legCycle(t, 30, run, 0.04);
        this.paw(0, this.v4.set(-0.4, 0.55 + Math.sin(t * 14) * 0.1 * run, 0.15), 1);
        this.paw(1, this.v4.set(0.4, 0.55 - Math.sin(t * 14) * 0.1 * run, 0.15), 1);
        P.earOut = 0.8;
        P.earR = 0.4;
        P.tail = -1;
        P.wag = 0;
        P.pop = this.calm ? 0.3 : 0.8;
        P.shiver = this.calm ? 0 : 0.6;
        const down = kf(t % 3, [[0.6, 0], [0.9, 1], [1.8, 1], [2.1, 0]]);
        P.headRx = 0.25 * down;
        P.headRy = 0;
        this.expr = t < 0.4 ? "surprised" : "scared";
        if (t > 0.4) {
          this.faceMods.lookY = -0.8 * down;
          this.faceMods.jaw = this.calm ? 0 : 0.08 + 0.08 * Math.sin(t * 38);
        }
        return true;
      },
    };
  }

  /** Put down: legs buckle like jelly, a wobble, and he wobbles himself upright. */
  private land(): Running {
    return {
      name: "land",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 22;
        this.bounce = 0.35;
        const sag = kf(t, [[0, 0], [0.12, 1], [0.6, 0.8], [1.3, 0]]);
        P.hipsY -= 0.28 * sag;
        P.squash = kf(t, [[0, 1], [0.1, 0.8], [0.3, 1.04], [0.5, 0.96], [0.7, 1]]);
        P.knock = lerp(P.knock, -0.9 + Math.sin(t * 14) * 0.5, sag);
        P.fLx -= 0.06 * sag;
        P.fRx += 0.06 * sag;
        const wob = Math.exp(-t * 2.4);
        P.hipsRz += Math.sin(t * 12) * 0.14 * wob;
        P.hipsX = Math.sin(t * 12) * 0.05 * wob;
        P.headRz += Math.sin(t * 12 + 1.2) * 0.14 * wob;
        this.paw(0, this.v4.set(-0.45, 0.4, 0.1), wob);
        this.paw(1, this.v4.set(0.45, 0.4, 0.1), wob);
        P.headRy = 0;
        this.expr = t < 0.7 ? "dizzy" : "relieved";
        return t < 1.5;
      },
    };
  }

  /** Poked too many times: a stumbling spin, spiral eyes, tongue out, head going round. */
  private dizzy(): Running {
    let starred = false;
    const tmp = new THREE.Vector3();
    return {
      name: "dizzy",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 18;
        P.yaw = kf(t, [[0, REST.yaw], [0.8, REST.yaw + Math.PI * 2]]);
        const fade = kf(t, [[0.6, 1], [1.8, 1], [2.3, 0]]);
        P.headRz = Math.sin(t * 9) * 0.25 * fade;
        P.headRx = Math.cos(t * 9) * 0.14 * fade;
        P.hipsRz = Math.sin(t * 4.5) * 0.12 * fade;
        P.hipsX = Math.sin(t * 4.5) * 0.06 * fade;
        P.knock = lerp(P.knock, Math.sin(t * 9) * 1.0, fade);
        this.paw(0, tmp.set(-0.42, 0.35 + Math.sin(t * 7) * 0.1, 0.1), fade);
        this.paw(1, tmp.set(0.42, 0.35 - Math.sin(t * 7) * 0.1, 0.1), fade);
        P.headRy = 0;
        this.expr = "dizzy";
        if (!starred && t > 0.7) {
          starred = true;
          this.burst(this.head.getWorldPosition(tmp).setY(tmp.y + 0.5), 8, "#ffd36b", 0.025, 0.9, 0.5);
        }
        return t < 2.4;
      },
      end: () => this.unwind(),
    };
  }

  /** A nervous little hop to one side. */
  private hop(dir: number): Running {
    return {
      name: "hop",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 24;
        this.bounce = 0.6;
        P.yaw = REST.yaw + dir * 0.45 * kf(t, [[0, 0], [0.1, 1], [0.38, 1], [0.6, 0]]);
        const y = kf(t, [[0, 0], [0.08, -0.04], [0.2, 0.12], [0.34, 0], [0.4, -0.02], [0.5, 0]]);
        P.hipsY += y;
        P.fLy += Math.max(0, y) * 0.9;
        P.fRy += Math.max(0, y) * 0.9;
        this.expr = "worried";
        return t < 0.6;
      },
    };
  }

  /** Doing his own thing: a noise behind him! A double-take, a whip round... nothing. Phew. */
  private spook(): Running {
    const dir = Math.random() < 0.5 ? -1 : 1;
    return {
      name: "spook",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 20;
        this.bounce = 0.55;
        const hear = kf(t, [[0, 0], [0.25, 1]]);
        P.earR = lerp(0, 0.5, hear);
        P.headRy = dir * 0.3 * hear;
        const whip = kf(t, [[0.75, 0], [0.88, 1], [2.0, 1], [2.3, 0]]);
        P.yaw = REST.yaw + dir * 1.6 * whip;
        P.headRy += dir * 0.6 * whip;
        P.hipsY += kf(t, [[0.75, 0], [0.85, 0.12], [1.0, 0]]);
        P.earOut = kf(t, [[0.75, 0], [0.85, 1], [1.8, 0.6], [2.3, 0]]);
        P.poof = kf(t, [[0.8, 0], [0.9, 1], [1.6, 0]]);
        P.pop = kf(t, [[0.8, 0], [0.9, 1], [1.6, 0.4], [2.0, 0]]);
        P.shiver = kf(t, [[0.9, 0], [1.0, 0.7], [1.9, 0.7], [2.1, 0]]);
        P.tail = -whip;
        this.paw(0, this.v4.set(-0.12, 0.52, 0.28), whip);
        this.paw(1, this.v4.set(0.12, 0.52, 0.28), whip);
        this.kneesKnock(t, kf(t, [[1.0, 0], [1.1, 1], [1.9, 1], [2.1, 0]]));
        const phew = kf(t, [[2.3, 0], [2.5, 1], [3.0, 1], [3.2, 0]]);
        P.squash *= 1 - 0.06 * phew;
        if (t < 0.75) this.expr = "worried";
        else if (t < 0.95) this.expr = "surprised";
        else if (t < 2.2) this.expr = "scared";
        else this.expr = "relieved";
        if (t < 0.75) this.faceMods.lookX = dir * 0.9 * hear;
        return t < 3.4;
      },
    };
  }

  /** Doing his own thing: ducks under his scarf for a moment, peeks left and right, comes out sheepish. */
  private hide(): Running {
    return {
      name: "hide",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 16;
        P.scarf = kf(t, [[0, 0], [0.5, 1.05], [0.8, 0.84], [2.5, 0.84], [3.0, 0]]);
        const hold = kf(t, [[0, 0], [0.3, 1], [2.6, 1], [3.0, 0]]);
        this.pawToHead(0, this.v4.set(-0.33, 0.12, 0.22), hold);
        this.pawToHead(1, this.v4.set(0.33, 0.12, 0.22), hold);
        P.hipsY -= 0.08 * hold;
        P.headRy = 0;
        this.kneesKnock(t, hold * 0.6);
        const dart = kf(t, [[0.8, 0], [1.0, -1], [1.5, -1], [1.7, 1], [2.2, 1], [2.4, 0]]);
        P.tail = -0.5;
        this.expr = t < 2.8 ? "worried" : "sheepish";
        this.faceMods.lookX = dart;
        this.faceMods.lookY = -0.6;
        this.faceMods.eyeOpen = 1;
        return t < 3.8;
      },
    };
  }

  /** Doing his own thing: a nervous whistle, paws behind his back, rocking on his heels, looking anywhere but at you. */
  private whistle(): Running {
    const tmp = new THREE.Vector3();
    return {
      name: "whistle",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 12;
        const on = kf(t, [[0, 0], [0.4, 1], [3.6, 1], [4.0, 0]]);
        this.paw(0, tmp.set(-0.12, 0.12, -0.2), on);
        this.paw(1, tmp.set(0.12, 0.12, -0.2), on);
        const rock = Math.sin(t * 3.2);
        P.hipsRx += rock * 0.06 * on;
        P.fLy += Math.max(0, -rock) * 0.03 * on;
        P.fRy += Math.max(0, -rock) * 0.03 * on;
        P.headRx = -0.25 * on;
        P.headRy = Math.sin(t * 0.9) * 0.35 * on;
        P.wag = 0.4;
        this.expr = "neutral";
        this.faceMods.eyeOpen = 0.55;
        this.faceMods.lookY = 0.8;
        this.faceMods.lookX = Math.sin(t * 0.9) * 0.6;
        this.faceMods.mouthWidth = 0.45;
        this.faceMods.mouthCurve = -0.3;
        this.faceMods.jaw = 0.06;
        // Little notes floating up.
        this.head.updateWorldMatrix(true, false);
        const m = this.head.localToWorld(tmp.copy(this.face.mouth()));
        this.notes.forEach((n, i) => {
          const k = ((t - 0.4 + i * 0.7) % 2.1) / 2.1;
          n.visible = on > 0.5 && t > 0.4 + i * 0.7;
          if (!n.visible) return;
          n.position.copy(this.root.worldToLocal(m.clone().add(new THREE.Vector3(0.15 + k * 0.25 + Math.sin(k * 9) * 0.04, 0.1 + k * 0.6, 0.1))));
          n.scale.setScalar(0.12 + k * 0.08);
          n.material.opacity = Math.min(1, k * 6) * (1 - smooth(clamp((k - 0.6) / 0.4, 0, 1)));
        });
        return t < 4.2;
      },
      end: () => {
        for (const n of this.notes) n.visible = false;
      },
    };
  }

  /** Doing his own thing: stands on one leg and scratches behind his ear with the other, like a proper dog. */
  private scratch(): Running {
    return {
      name: "scratch",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 16;
        const on = kf(t, [[0, 0], [0.45, 1], [2.6, 1], [3.0, 0]]);
        // Lean right over onto the left leg; the right foot comes right up to his ear.
        P.hipsRz = -0.42 * on;
        P.hipsX = -0.08 * on;
        P.hipsY -= 0.05 * on;
        P.headRz = -0.35 * on;
        P.headRx = 0.25 * on;
        P.headRy = 0;
        P.yaw = 0.1;
        const sc = Math.sin(t * 30) * 0.04;
        P.fRx = lerp(P.fRx, 0.12, on);
        P.fRy = lerp(P.fRy, 0.92 + sc, on);
        P.fRz = lerp(P.fRz, 0.05 + sc, on);
        P.knock = -0.3;
        this.paw(0, this.v4.set(-0.32, 0.25, 0.12), on);
        this.paw(1, this.v4.set(0.32, 0.3, 0.15), on);
        P.earR = 0.3 * on;
        P.wag = 0.7 * on;
        this.expr = t > 0.5 && t < 2.6 ? "love" : "neutral";
        return t < 3.2;
      },
    };
  }

  /** Doing his own thing: muttering to himself, wringing his paws, eyes darting. */
  private mutter(): Running {
    return {
      name: "mutter",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 18;
        const on = kf(t, [[0, 0], [0.3, 1], [2.8, 1], [3.1, 0]]);
        const w = Math.sin(t * 9) * 0.04;
        this.paw(0, this.v4.set(-0.03 + w, 0.36, 0.3), on);
        this.paw(1, this.v4.set(0.03 - w, 0.34, 0.3), on);
        P.headRx = 0.1 * on;
        P.headRy = Math.sin(t * 1.7) * 0.25 * on;
        P.shiver = 0.2;
        this.kneesKnock(t, 0.4 * on);
        this.expr = "worried";
        this.faceMods.jaw = on * (0.04 + Math.max(0, Math.sin(t * 22)) * 0.1 * (Math.sin(t * 3) > -0.3 ? 1 : 0));
        this.faceMods.lookX = Math.sign(Math.sin(t * 2.3)) * 0.8;
        this.faceMods.lookY = -0.2;
        return t < 3.2;
      },
    };
  }

  /** A good shake-off, like a wet dog: everything flaps, fluff flies, then a happy daze. */
  private shakeOff(): Running {
    let puffs = 0;
    const tmp = new THREE.Vector3();
    return {
      name: "exercise",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 28;
        this.bounce = 0.5;
        const brace = kf(t, [[0, 0], [0.35, 1], [1.9, 1], [2.1, 0]]);
        P.squash *= 1 - 0.06 * brace;
        P.fLx -= 0.06 * brace;
        P.fRx += 0.06 * brace;
        P.knock = lerp(P.knock, -0.4, brace);
        const shake = kf(t, [[0.4, 0], [0.5, 1], [1.7, 1], [1.9, 0]]);
        const w = Math.sin(t * 30);
        P.yaw = REST.yaw + w * 0.4 * shake;
        P.hipsRz = Math.sin(t * 30 + 1) * 0.1 * shake;
        P.headRy = -w * 0.6 * shake;
        P.poof = kf(t, [[0.5, 0], [0.8, 0.7], [1.9, 0.7], [2.5, 0]]);
        P.earOut = 0.6 * shake;
        P.wag = 1.2 * shake;
        if (shake > 0.5 && puffs < 4 && t > 0.6 + puffs * 0.3) {
          puffs++;
          this.burst(tmp.set(this.root.position.x, 1.0, 0.2), 6, puffs % 2 ? "#f3dfa8" : "#fff6dc", 0.035, 1.8, 2);
        }
        const daze = kf(t, [[1.9, 0], [2.1, 1], [2.8, 1], [3.1, 0]]);
        P.hipsRz += Math.sin(t * 10) * 0.08 * daze;
        P.headRz += Math.sin(t * 10 + 1) * 0.12 * daze;
        if (t < 0.45) this.expr = "determined";
        else this.expr = t < 1.9 ? "joy" : "happy";
        return t < 3.2;
      },
    };
  }

  /** A biscuit! A sniff, three crunchy bites, a happy wag and a pat on the tummy. */
  private eat(): Running {
    const snack = biscuit();
    paint(snack, this.look);
    snack.scale.setScalar(0.01);
    this.mitts[1].add(snack);
    snack.position.set(0, 0.06, 0.04);
    snack.rotation.z = Math.PI / 2;
    const intro = 1.0;
    const bite = 1.1;
    const bites = 3;
    const sizes = [1, 0.75, 0.48, 0];
    let bitten = 0;
    const tmp = new THREE.Vector3();
    const ns = this.face.noseScale;
    return {
      name: "eat",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 16;
        P.wag = 0.8;
        P.headRy = 0;
        const hold = this.v3.set(0.18, 0.5, 0.42);
        if (t < intro) {
          snack.scale.setScalar(kf(t, [[0, 0.01], [0.3, 1.2], [0.5, 1]]) * 0.8);
          const sniff = 1 + Math.max(0, Math.sin(t * 28)) * 0.12 * kf(t, [[0.3, 0], [0.4, 1]]);
          this.face.nose.scale.set(ns.x * sniff, ns.y * sniff, ns.z);
          this.paw(1, hold, 1);
          P.headRx = 0.15;
          this.expr = "ooh";
        } else if (t < intro + bite * bites) {
          this.face.nose.scale.copy(ns);
          const i = Math.floor((t - intro) / bite);
          const v = t - intro - i * bite;
          const raise = kf(v, [[0, 0], [0.3, 1], [0.42, 1], [0.7, 0]]);
          this.paw(1, hold, 1 - raise);
          this.pawToHead(1, this.face.mouth().add(this.v4.set(0, 0, 0.05)), raise);
          if (v < 0.42) {
            this.expr = "ooh";
            this.faceMods.jaw = kf(v, [[0, 0.1], [0.28, 0.6], [0.36, 0]]);
          } else {
            this.expr = "chew";
            this.faceMods.jaw = Math.max(0, Math.sin(v * 24)) * 0.12;
            P.headRz = Math.sin(v * 12) * 0.04;
          }
          if (v >= 0.36 && bitten <= i) {
            bitten = i + 1;
            snack.scale.setScalar(Math.max(0.01, sizes[bitten] * 0.8));
            this.burst(snack.getWorldPosition(tmp), 8, "#cf8f4e", 0.02, 1.1, 5);
          }
        } else {
          const v = t - intro - bite * bites;
          snack.visible = false;
          const pat = kf(v, [[0, 0], [0.35, 1], [1.8, 1], [2.1, 0]]);
          this.paw(0, this.v4.set(-0.05 + Math.sin(v * 14) * 0.03, 0.12, 0.27), pat);
          P.wag = 1.2;
          P.tail = 0.5;
          this.expr = "love";
          return v < 2.3;
        }
        return true;
      },
      end: () => {
        dispose(snack);
        this.face.nose.scale.copy(ns);
      },
    };
  }
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
