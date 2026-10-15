// Dogesh Bhai's outfits in 3D (their colours are in skins/dogesh-outfits.ts):
// the clothes he wears, fitted to his body and following it through every
// behaviour, and how each outfit hides him when he's scared.
//
// Clothes hang off his bones (hips, neck, head) or, for the floppy bits, are
// rebuilt every frame: sleeves and trousers along his rubber-hose limbs, hems
// that swing and keep clear of his legs, a cape and a nightcap's tip on
// springs. An outfit is built once when he puts it on and thrown away (its
// geometry freed) when he changes.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { OUTFITS, type OutfitName, type Tone } from "../skins/dogesh-outfits";
import { DOG_HEAD, type DogFace } from "./dog-face";
import { Chain, DOWN, FLOOR, Noodle, TORSO_DEPTH, TORSO_PROFILE, headShape, hunch, quad, roundEnds } from "./dog-rig";
import { fryingPan } from "./dog-props";
import { type Surface, type TagOptions, tag } from "./looks";
import { dispose } from "./props";
import { clamp, lerp, smooth } from "./rig";

const solid = { outline: true, cast: true, receive: true };

/** Tag options for cloth in `t` (and a pattern's second colour `two`). */
const wear = (t: Tone, two?: Tone): TagOptions => ({
  ...solid, tint: t.color, shade: t.shade, ...(two ? { tint2: two.color, shade2: two.shade } : {}),
});

/** His bones and limbs, as the clothes need them. */
export interface DogRig {
  root: THREE.Object3D;
  body: THREE.Object3D;
  hips: THREE.Object3D;
  neck: THREE.Object3D;
  head: THREE.Object3D;
  /** Each arm's curve in body space (shoulder, bend, paw), and each leg's (hip, knee, ankle), as of this frame. */
  arms: THREE.Vector3[][];
  legs: THREE.Vector3[][];
  feet: THREE.Mesh[];
  /** His face, for things worn on his eyes (a mask's rims, glasses, a magnifying glass). */
  face?: DogFace;
}

/** What the clothes need to know each frame. */
export interface Wear {
  dt: number;
  t: number;
  /** Hiding under (or behind) his clothes, 0..1 (a little over when he tugs it right down). */
  hide: number;
  /** Tucked up for the night, 0..1. */
  blanket: number;
  /** Fur on end, 0..1. */
  poof: number;
  /** Eyes popping, 0..1. */
  pop: number;
  /** Sitting working with something on his lap, 0..1 (the scarf's end drapes over his knee, where you can see it knit up). */
  lap?: number;
}

const armR = (u: number) => lerp(0.037, 0.03, u) * roundEnds(u);
const legR = (u: number) => lerp(0.05, 0.034, u) * roundEnds(u);

// ── An outfit ─────────────────────────────────────────────────────────────────

export class Clothes {
  /** His torso is covered (his tummy patch and the fur-on-end spikes round his body stay hidden). */
  coversBody = false;
  /** How far his eyes tuck in at full hide (1: something comes down over them). */
  tuck = 0;
  /** How far his head sinks into his collar at full hide. */
  sink = 0;
  /** How much further his head bows while hiding. */
  bow = 0;
  /** Where his paws hold the thing he hides under at full hide: head space, or hips space with `holdInHips`. */
  hold: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(-0.33, 0.12, 0.22), new THREE.Vector3(0.33, 0.12, 0.22)];
  holdInHips = false;
  /** The pieces that can come off and fly over a dressing screen (a hat first). */
  readonly loose: THREE.Object3D[] = [];
  /** Shown only now and then (hiding, sleeping): what prewarming should show. */
  readonly extras: THREE.Object3D[] = [];
  /** The outfit's main colour (for a shirt thrown over the screen). */
  readonly main: string;
  private parts: THREE.Object3D[] = [];
  private updaters: ((w: Wear) => void)[] = [];
  private bareFeet = true;

  constructor(readonly name: OutfitName, readonly rig: DogRig) {
    const cloth = Object.values(OUTFITS[name].cloth);
    this.main = cloth[0].color;
  }

  /** Puts `objs` on `parent` (they go when the outfit does). */
  add(parent: THREE.Object3D, ...objs: THREE.Object3D[]): void {
    parent.add(...objs);
    this.parts.push(...objs);
  }

  on(f: (w: Wear) => void): void {
    this.updaters.push(f);
  }

  /** Boots go over his feet: his own feet hide. */
  coverFeet(): void {
    this.bareFeet = false;
    for (const f of this.rig.feet) f.visible = false;
  }

  update(w: Wear): void {
    for (const f of this.updaters) f(w);
  }

  /** Takes it all off and frees it (loose pieces too, wherever they've flown, unless `spare`d: the caller frees those). */
  dispose(spare?: Set<THREE.Object3D>): void {
    for (const p of new Set([...this.parts, ...this.loose])) if (!spare?.has(p)) dispose(p);
    this.parts = [];
    this.updaters = [];
    if (!this.bareFeet) for (const f of this.rig.feet) f.visible = true;
  }
}

/** Dresses him in `name`. */
export function dress(name: OutfitName, rig: DogRig): Clothes {
  const c = new Clothes(name, rig);
  BUILD[name](c);
  return c;
}

// ── Cloth round his body ──────────────────────────────────────────────────────

const PROFILE = new THREE.SplineCurve(TORSO_PROFILE).getPoints(160);
/** His torso's radius at height `y` (hips space); below its widest it stays that wide (cloth hangs straight down from there). */
function torsoR(y: number): number {
  if (y <= 0.06) return 0.25;
  for (let i = 1; i < PROFILE.length; i++) {
    const a = PROFILE[i - 1];
    const b = PROFILE[i];
    if (b.y >= y) return lerp(a.x, b.x, clamp((y - a.y) / Math.max(1e-6, b.y - a.y), 0, 1));
  }
  return 0;
}

/** A point on (or `grow` out from) his torso at height y, angle a round from the front. */
function onTorso(y: number, a: number, grow: number, out = new THREE.Vector3()): THREE.Vector3 {
  const r = torsoR(y);
  return out.set((r + grow) * Math.sin(a), y, (r * TORSO_DEPTH + grow) * Math.cos(a) + hunch(y));
}

interface Cut {
  top: number;
  hem: number;
  /** How far out from his fur. */
  grow: number;
  /** Below this height the cloth hangs free: it swings, flares when he spins, and keeps clear of his legs. */
  free?: number;
  /** Extra width at the hem. */
  flare?: number;
  /** An opening at the front below `free`, widening to this half-angle at the hem (a coat's skirts). */
  slit?: number;
  /** Only the front, this half-angle round (an apron). */
  arc?: number;
  /** A V at the front of the neckline, this deep. */
  vee?: number;
  rows?: number;
  segs?: number;
  /** Pattern repeats round (u) and down (v). */
  uv?: [number, number];
}

/**
 * Cloth round his torso, from `top` down to `hem`, in hips space. Below
 * `free` it's reshaped every frame: it swings after his movement, hangs the
 * way gravity pulls when he's tipped over, flares out in a spin, and keeps
 * out of his thighs (and off the floor).
 */
class Garment {
  readonly mesh: THREE.Mesh;
  private rest: Float32Array;
  private loose: Float32Array;
  private closed: boolean;
  private rows: number;
  private segs: number;
  private swing = new THREE.Vector3();
  private swingV = new THREE.Vector3();
  private lastPos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private lastYaw = 0;
  private spin = 0;
  private ready = false;
  private m = new THREE.Matrix4();
  private mi = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private a = new THREE.Vector3();
  private seg: THREE.Vector3[] = Array.from({ length: 12 }, () => new THREE.Vector3());

  constructor(surface: Surface, opts: TagOptions, private cut: Cut, private rig: DogRig) {
    const rows = (this.rows = cut.rows ?? 16);
    const segs = (this.segs = cut.segs ?? 44);
    const free = cut.free ?? -9;
    this.closed = !cut.arc && !cut.slit;
    const n = (rows + 1) * (segs + 1);
    const pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    this.loose = new Float32Array(n);
    const v = new THREE.Vector3();
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      for (let j = 0; j <= segs; j++) {
        const y0 = lerp(cut.top, cut.hem, t);
        let a: number;
        if (cut.arc) a = -cut.arc + (j / segs) * 2 * cut.arc;
        else {
          const gap = cut.slit ? cut.slit * smooth(clamp((free - y0) / (free - cut.hem), 0, 1)) : 0;
          a = gap + (j / segs) * (Math.PI * 2 - 2 * gap);
        }
        const fromFront = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
        const top = cut.top - (cut.vee ?? 0) * Math.max(0, 1 - fromFront / 0.75);
        const y = lerp(top, cut.hem, t);
        const k = free > cut.hem ? clamp((free - y) / (free - cut.hem), 0, 1) : 0;
        onTorso(y, a, cut.grow + (cut.flare ?? 0) * smooth(k), v);
        const at = i * (segs + 1) + j;
        pos.set([v.x, v.y, v.z], at * 3);
        this.loose[at] = k;
        uv[at * 2] = (j / segs) * (cut.uv?.[0] ?? 1);
        uv[at * 2 + 1] = (1 - t) * (cut.uv?.[1] ?? 1);
      }
    }
    this.rest = pos.slice();
    const idx: number[] = [];
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < segs; j++) {
        const k = i * (segs + 1) + j;
        const d = k + segs + 1;
        idx.push(k, d, k + 1, k + 1, d, d + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.normals(g);
    this.mesh = tag(new THREE.Mesh(g), surface, opts);
    this.mesh.frustumCulled = false;
    for (const ch of this.mesh.children) ch.frustumCulled = false;
  }

  private normals(g: THREE.BufferGeometry): void {
    g.computeVertexNormals();
    if (!this.closed) return;
    // The seam down the front: one smooth normal for both its edges.
    const nor = g.getAttribute("normal") as THREE.BufferAttribute;
    const s = this.segs;
    for (let i = 0; i <= this.rows; i++) {
      const a = i * (s + 1);
      const b = a + s;
      this.a.fromBufferAttribute(nor, a).add(this.p.fromBufferAttribute(nor, b)).normalize();
      nor.setXYZ(a, this.a.x, this.a.y, this.a.z);
      nor.setXYZ(b, this.a.x, this.a.y, this.a.z);
    }
  }

  update(dt: number): void {
    if (dt <= 0 || (this.cut.free ?? -9) <= this.cut.hem) return;
    const { hips, root, legs } = this.rig;
    hips.updateWorldMatrix(true, false);
    const at = hips.getWorldPosition(this.p);
    if (!this.ready || at.distanceTo(this.lastPos) > 1) {
      this.lastPos.copy(at);
      this.lastYaw = root.rotation.y;
      this.ready = true;
    }
    this.vel.lerp(this.a.subVectors(at, this.lastPos).divideScalar(dt), 1 - Math.exp(-dt / 0.06));
    this.lastPos.copy(at);
    const yawRate = (root.rotation.y - this.lastYaw) / dt;
    this.lastYaw = root.rotation.y;
    this.spin += (clamp(Math.abs(yawRate) / 9, 0, 1) - this.spin) * (1 - Math.exp(-dt * 6));

    // Swing: blown back by his movement, hanging the way gravity pulls (in his own space).
    hips.getWorldQuaternion(this.q).invert();
    const lv = this.a.copy(this.vel).applyQuaternion(this.q);
    const g = this.p.copy(DOWN).applyQuaternion(this.q);
    const tx = clamp(-lv.x * 0.1 + g.x * 0.5, -0.5, 0.5);
    const tz = clamp(-lv.z * 0.1 + g.z * 0.5 + 0.03, -0.5, 0.5);
    const w = 11;
    let left = Math.min(dt, 0.1);
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      left -= h;
      this.swingV.x += ((tx - this.swing.x) * w * w - this.swingV.x * 2 * 0.45 * w) * h;
      this.swingV.z += ((tz - this.swing.z) * w * w - this.swingV.z * 2 * 0.45 * w) * h;
      this.swing.addScaledVector(this.swingV, h);
    }

    // His legs, in hips space: segments to keep out of.
    this.mi.copy(hips.matrix).invert();
    let ns = 0;
    for (const leg of legs) {
      for (let s = 0; s <= 5; s++) quad(leg[0], leg[1], leg[2], s / 5, this.seg[ns++]).applyMatrix4(this.mi);
    }
    this.m.copy(hips.matrixWorld);
    const toLocal = this.mi.copy(hips.matrixWorld).invert();
    const geo = this.mesh.geometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const rest = this.rest;
    const len = (this.cut.free ?? 0) - this.cut.hem;
    const p = this.p;
    for (let i = 0; i < pos.count; i++) {
      const k = this.loose[i];
      p.set(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]);
      if (k > 0) {
        const kk = Math.pow(k, 1.5);
        // Flare out in a spin.
        const fl = 1 + 0.35 * this.spin * kk;
        p.x *= fl;
        p.z = (p.z - 0.04) * fl + 0.04;
        p.x += this.swing.x * kk * len;
        p.z += this.swing.z * kk * len;
        p.y += (Math.abs(this.swing.x) + Math.abs(this.swing.z)) * 0.25 * kk * len + 0.06 * this.spin * kk;
        this.keepOut(p, k);
        // Not through the floor.
        this.a.copy(p).applyMatrix4(this.m);
        if (this.a.y < FLOOR + 0.01) {
          this.a.y = FLOOR + 0.01;
          p.copy(this.a).applyMatrix4(toLocal);
        }
      }
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    this.normals(geo);
  }

  /** Out of his thighs and shins (each leg is 5 segments). */
  private keepOut(p: THREE.Vector3, k: number): void {
    const R = 0.085;
    for (let l = 0; l < 2; l++) {
      for (let s = 0; s < 5; s++) {
        const a = this.seg[l * 6 + s];
        const b = this.seg[l * 6 + s + 1];
        const ab = this.a.subVectors(b, a);
        const t = clamp(ab.dot(TMP.subVectors(p, a)) / Math.max(1e-6, ab.lengthSq()), 0, 1);
        const c = TMP.copy(a).addScaledVector(ab, t);
        const d = p.distanceTo(c);
        if (d < R && d > 1e-5) p.sub(c).multiplyScalar(lerp(1, R / d, Math.min(1, k * 4))).add(c);
      }
    }
  }
}

const TMP = new THREE.Vector3();

/** A tube of cloth along part of a limb (a sleeve, a trouser leg, a boot), hugging it at the end. */
class Sleeve {
  readonly noodle: Noodle;
  constructor(
    surface: Surface, opts: TagOptions & { uv?: [number, number] }, private limb: THREE.Vector3[],
    private from: number, private to: number, private r0: number, private r1: number, private limbR: (u: number) => number,
    private hug = true,
  ) {
    this.noodle = new Noodle(surface, 14, 14, opts);
  }

  update(): void {
    const [a, c, b] = this.limb;
    const { from, to, r0, r1, limbR, hug } = this;
    this.noodle.shape(
      (u, out) => quad(a, c, b, lerp(from, to, u), out),
      (u) => {
        const r = lerp(r0, r1, u);
        if (!hug) return r * Math.sqrt(Math.max(0, 1 - Math.max(0, (u - 0.93) / 0.07) ** 2)) + 0.002;
        return lerp(r, limbR(lerp(from, to, u)) + 0.005, smooth(clamp((u - 0.84) / 0.16, 0, 1)));
      },
    );
  }
}

// ── Hats ──────────────────────────────────────────────────────────────────────

/**
 * A hat on his head: it sits back on his crown (he has big brows at the top
 * of his face), turned on a pivot at the middle of his head, so pulling it
 * down over his eyes is turning it forward. It hops up when his fur stands on end.
 */
class Hat {
  readonly pivot = new THREE.Group();
  readonly lift = new THREE.Group();
  /** `slide`: where it slides to (head units) as it's pulled right down, on top of turning. */
  constructor(
    c: Clothes, readonly hat: THREE.Object3D, r: number, private rest: number, private down: number, tilt = 0,
    private slide = new THREE.Vector3(),
  ) {
    hat.position.y = r;
    hat.rotation.z = tilt;
    this.lift.add(hat);
    this.pivot.add(this.lift);
    this.pivot.rotation.x = rest;
    c.add(c.rig.head, this.pivot);
    c.loose.push(hat);
  }

  /** `u`: pulled down 0..1; `poof`: fur on end. */
  pose(u: number, poof: number, t: number): void {
    this.pivot.rotation.x = lerp(this.rest, this.down, clamp(u, 0, 1.1));
    this.pivot.position.copy(this.slide).multiplyScalar(smooth(clamp(u, 0, 1)));
    this.lift.position.y = 0.13 * poof;
    this.lift.rotation.z = Math.sin(t * 31) * 0.12 * poof;
  }
}

/** A dome (the top `theta` of an ellipsoid, open underneath), its rim on y = 0, with uv round (u) and up (v). */
function dome(r: THREE.Vector3, theta: number, uvU = 1, uvV = 1): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 36, 12, 0, Math.PI * 2, 0, theta);
  g.scale(r.x, r.y, r.z);
  g.translate(0, -Math.cos(theta) * r.y, 0);
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvU, uv.getY(i) * uvV);
  return g;
}

/** A flat ring brim (inner radius ri, outer ro, as ellipses scaled by `sz` front to back), drooping `droop` at the edge. */
function brim(ri: number, ro: number, sz: number, droop: number, front = 1, back = 1): THREE.BufferGeometry {
  const segs = 40;
  const rings = 4;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const reach = lerp(back, front, (Math.cos(a) + 1) / 2);
      const r = lerp(ri, ri + (ro - ri) * reach, t);
      pos.push(Math.sin(a) * r, -droop * t * t * reach, Math.cos(a) * r * sz);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const k = i * (segs + 1) + j;
      idx.push(k, k + 1, k + segs + 1, k + 1, k + segs + 2, k + segs + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A band round the head at the hat's rim. */
function band(rx: number, rz: number, h: number, r = 0.012): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.sin(a) * rx, 0, Math.cos(a) * rz));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true);
  const g = new THREE.TubeGeometry(curve, 64, r, 6, true);
  if (h > 0) {
    const wall = new THREE.CylinderGeometry(1, 1, h, 40, 1, true);
    wall.scale(rx, 1, rz);
    wall.translate(0, h / 2, 0);
    return mergeGeometries([g.toNonIndexed(), wall.toNonIndexed()].map((x) => { x.deleteAttribute("uv"); return x; }));
  }
  return g;
}

/** A tube along points (local space). */
function tube(pts: THREE.Vector3[], r: number, segs = 24, closed = false): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), segs, r, 8, closed);
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ── The cape ──────────────────────────────────────────────────────────────────

const CAPE = { cols: 7, rows: 9, len: 0.8 };

/**
 * A cape on a little cloth simulation (like the scarf's tail): its top edge
 * pinned round his shoulders, the rest swinging after him, kept off his body,
 * legs and the floor. Hiding, it wraps all the way round him like a cocoon.
 * Two sheets a hair apart: red outside, darker inside.
 */
class Cape {
  readonly outer: THREE.Mesh;
  readonly inner: THREE.Mesh;
  private K = CAPE.cols;
  private N = CAPE.rows;
  private p: THREE.Vector3[];
  private prev: THREE.Vector3[];
  private show: THREE.Vector3[];
  private anchors: THREE.Vector3[] = [];
  private width: number[] = [];
  private row = CAPE.len / (CAPE.rows - 1);
  private ready = false;
  private fineU = 13;
  private fineV = 17;
  private fine: THREE.Vector3[];
  private inv = new THREE.Matrix4();
  private toRoot = new THREE.Matrix4();
  private t1 = new THREE.Vector3();
  private t2 = new THREE.Vector3();
  private seg: THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3());

  constructor(private rig: DogRig, outside: TagOptions, inside: TagOptions) {
    const { K, N } = this;
    for (let c = 0; c < K; c++) {
      const a = Math.PI + (c / (K - 1) - 0.5) * 3.5;
      this.anchors.push(V(Math.sin(a) * 0.215, 0.52, 0.07 + Math.cos(a) * 0.2));
    }
    for (let r = 0; r < N; r++) this.width.push(r / (N - 1));
    this.p = Array.from({ length: K * N }, () => new THREE.Vector3());
    this.prev = Array.from({ length: K * N }, () => new THREE.Vector3());
    this.show = Array.from({ length: K * N }, () => new THREE.Vector3());
    this.fine = Array.from({ length: this.fineU * this.fineV }, () => new THREE.Vector3());
    this.outer = this.sheet(outside, false);
    this.inner = this.sheet(inside, true);
  }

  private sheet(o: TagOptions, flip: boolean): THREE.Mesh {
    const U = this.fineU;
    const Vn = this.fineV;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(U * Vn * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(U * Vn * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let v = 0; v < Vn - 1; v++) {
      for (let u = 0; u < U - 1; u++) {
        const k = v * U + u;
        if (flip) idx.push(k, k + 1, k + U, k + 1, k + U + 1, k + U);
        else idx.push(k, k + U, k + 1, k + 1, k + U, k + U + 1);
      }
    }
    g.setIndex(idx);
    const m = tag(new THREE.Mesh(g), "cloth", o);
    m.frustumCulled = false;
    for (const ch of m.children) ch.frustumCulled = false;
    return m;
  }

  /** The anchor for column c at row 0, and the cape's rest spacing across at row r. */
  private across(r: number): number {
    const top = this.anchors[0].distanceTo(this.anchors[1]);
    return top * (1 + 0.9 * this.width[r]);
  }

  update(dt: number, hide: number, hold: THREE.Vector3[]): void {
    const { K, N, p, prev, row } = this;
    const { hips, root, legs, body } = this.rig;
    hips.updateWorldMatrix(true, false);
    const hm = hips.matrixWorld;
    const at = (c: number, r: number) => p[r * K + c];
    if (!this.ready || at(3, 0).distanceTo(this.t1.copy(this.anchors[3]).applyMatrix4(hm)) > 1.2) {
      for (let c = 0; c < K; c++) {
        for (let r = 0; r < N; r++) {
          const q = this.t1.copy(this.anchors[c]);
          q.y -= r * row;
          q.z -= 0.08 * (r / N);
          q.x *= 1 + 0.6 * (r / N);
          at(c, r).copy(q).applyMatrix4(hm);
          prev[r * K + c].copy(at(c, r));
        }
      }
      this.ready = true;
    }
    this.inv.copy(hm).invert();
    // Legs (world), to keep out of.
    body.updateWorldMatrix(true, false);
    let ns = 0;
    for (const leg of legs) for (let s = 0; s <= 3; s++) quad(leg[0], leg[1], leg[2], s / 3, this.seg[ns++]).applyMatrix4(body.matrixWorld);
    let left = Math.min(dt, 0.1);
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      left -= h;
      for (let i = K; i < K * N; i++) {
        this.t1.subVectors(p[i], prev[i]).multiplyScalar(0.97);
        prev[i].copy(p[i]);
        p[i].add(this.t1);
        p[i].y -= 4.5 * h * h;
      }
      for (let c = 0; c < K; c++) at(c, 0).copy(this.anchors[c]).applyMatrix4(hm);
      for (let it = 0; it < 4; it++) {
        for (let r = 1; r < N; r++) {
          for (let c = 0; c < K; c++) {
            this.keep(at(c, r - 1), at(c, r), row, r === 1);
            if (c > 0) this.keep(at(c - 1, r), at(c, r), this.across(r), false);
            if (r > 1) this.keep(at(c, r - 2), at(c, r), row * 1.9, false, true);
          }
        }
        for (let i = K; i < K * N; i++) {
          this.collide(p[i]);
          if (p[i].y < FLOOR + 0.01) p[i].y = FLOOR + 0.01;
        }
      }
    }
    // What shows: the cloth as it hangs, or (hiding) wrapped right round him, his paws holding it shut.
    const u = clamp(hide, 0, 1);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < K; c++) {
        const i = r * K + c;
        const s = this.show[i].copy(p[i]);
        if (u > 0.001) this.wrap(s, c, r, u, hold);
      }
    }
    this.draw(root);
  }

  /** Blends `s` (world) towards its place in the cocoon, round his middle (not through it). */
  private wrap(s: THREE.Vector3, c: number, r: number, u: number, hold: THREE.Vector3[]): void {
    const { K, N } = this;
    const l = this.t1.copy(s).applyMatrix4(this.inv);
    const cx = 0;
    const cz = 0.12;
    let a0 = Math.atan2(l.x - cx, l.z - cz);
    const f = c / (K - 1) - 0.5;
    // Right round him (an ellipse, roomy at the front: his long snout goes in there too),
    // the two front edges crossing over each other.
    const e = f * 2 * (Math.PI + 0.45) + Math.PI;
    const front = (1 + Math.cos(e)) / 2;
    const r1x = 0.34 + 0.06 * (r / N);
    const r1z = 0.5 + 0.6 * front * (1 - 0.25 * (r / N));
    const tx = Math.sin(e) * r1x;
    const tz = Math.cos(e) * r1z;
    // Its place there as an angle and distance round his middle (and the edges keep going past each other).
    const T = Math.PI * 2;
    const d = Math.atan2(tx, tz) - e;
    const a1 = e + ((((d + Math.PI) % T) + T) % T) - Math.PI;
    // Unwrap so it goes round his back (the short way round past the front would cut through him).
    while (a0 - a1 > Math.PI) a0 -= Math.PI * 2;
    while (a1 - a0 > Math.PI) a0 += Math.PI * 2;
    const r0 = Math.hypot(l.x - cx, l.z - cz);
    const rr = Math.hypot(tx, tz);
    const top = 0.5 + 0.43 * front * front;
    const y1 = top - (r / (N - 1)) * 0.86 * (1 - 0.15 * front);
    const k = smooth(u);
    const a = lerp(a0, a1, k);
    const rad = lerp(r0, rr, k);
    l.set(cx + Math.sin(a) * rad, lerp(l.y, y1, k), cz + Math.cos(a) * rad);
    // The front corners go where his paws are.
    // His right edge goes over the left all the way down.
    if (c === 0) l.z += 0.035 * k * (1 - r / N);
    if (r <= 3 && (c === 0 || c === K - 1)) {
      const paw = hold[c === 0 ? 1 : 0];
      const w = k * (1 - r / 4);
      const y = l.y;
      l.lerp(this.t2.copy(paw).applyMatrix4(this.inv), w);
      l.y = y;
    }
    s.copy(l).applyMatrix4(this.rig.hips.matrixWorld);
  }

  private keep(a: THREE.Vector3, b: THREE.Vector3, len: number, pinned: boolean, min = false): void {
    const d = this.t2.subVectors(b, a);
    const l = d.length();
    if (l < 1e-6 || (min && l > len)) return;
    const diff = (l - len) / l;
    if (pinned) b.addScaledVector(d, -diff);
    else {
      a.addScaledVector(d, diff * 0.5);
      b.addScaledVector(d, -diff * 0.5);
    }
  }

  /** Out of his body (an ellipsoid round the torso, hips space) and his legs. */
  private collide(q: THREE.Vector3): void {
    const l = this.t2.copy(q).applyMatrix4(this.inv);
    const cy = 0.22, cz = 0.04, rx = 0.29, ry = 0.47, rz = 0.27;
    const dx = l.x / rx;
    const dy = (l.y - cy) / ry;
    const dz = (l.z - cz) / rz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < 1) {
      const k = 1 / Math.sqrt(Math.max(d, 1e-4));
      q.set(l.x * k, cy + (l.y - cy) * k, cz + (l.z - cz) * k).applyMatrix4(this.rig.hips.matrixWorld);
    }
    for (let leg = 0; leg < 2; leg++) {
      for (let s = 0; s < 3; s++) {
        const a = this.seg[leg * 4 + s];
        const b = this.seg[leg * 4 + s + 1];
        const ab = this.t2.subVectors(b, a);
        const t = clamp(ab.dot(TMP.subVectors(q, a)) / Math.max(1e-6, ab.lengthSq()), 0, 1);
        const c = TMP.copy(a).addScaledVector(ab, t);
        const dd = q.distanceTo(c);
        if (dd < 0.07 && dd > 1e-5) q.sub(c).multiplyScalar(0.07 / dd).add(c);
      }
    }
  }

  /** Smooths the cloth (Catmull-Rom, both ways) into the two sheets, in root space. */
  private draw(root: THREE.Object3D): void {
    const { K, N, fineU: U, fineV: Vn, fine, show } = this;
    root.updateWorldMatrix(true, false);
    const toRoot = this.toRoot.copy(root.matrixWorld).invert();
    const col = (c: number, r: number) => show[clamp(r, 0, N - 1) * K + clamp(c, 0, K - 1)];
    const cr = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t: number, out: THREE.Vector3) => {
      const t2 = t * t;
      const t3 = t2 * t;
      return out.set(0, 0, 0)
        .addScaledVector(a, -0.5 * t3 + t2 - 0.5 * t)
        .addScaledVector(b, 1.5 * t3 - 2.5 * t2 + 1)
        .addScaledVector(c, -1.5 * t3 + 2 * t2 + 0.5 * t)
        .addScaledVector(d, 0.5 * t3 - 0.5 * t2);
    };
    const rowPts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let v = 0; v < Vn; v++) {
      const fr = (v / (Vn - 1)) * (N - 1);
      const r = Math.min(Math.floor(fr), N - 2);
      const tr = fr - r;
      for (let u = 0; u < U; u++) {
        const fc = (u / (U - 1)) * (K - 1);
        const c = Math.min(Math.floor(fc), K - 2);
        const tc = fc - c;
        for (let k = 0; k < 4; k++) {
          const rr = r - 1 + k;
          cr(col(c - 1, rr), col(c, rr), col(c + 1, rr), col(c + 2, rr), tc, rowPts[k]);
        }
        cr(rowPts[0], rowPts[1], rowPts[2], rowPts[3], tr, fine[v * U + u]).applyMatrix4(toRoot);
      }
    }
    const po = this.outer.geometry.getAttribute("position") as THREE.BufferAttribute;
    const no = this.outer.geometry.getAttribute("normal") as THREE.BufferAttribute;
    const pi = this.inner.geometry.getAttribute("position") as THREE.BufferAttribute;
    const ni = this.inner.geometry.getAttribute("normal") as THREE.BufferAttribute;
    const n = this.t1;
    const du = this.t2;
    const dv = TMP;
    const axis = new THREE.Vector3(0, 0.3, 0.1).applyMatrix4(this.rig.hips.matrixWorld).applyMatrix4(toRoot);
    for (let v = 0; v < Vn; v++) {
      for (let u = 0; u < U; u++) {
        const k = v * U + u;
        du.subVectors(fine[v * U + Math.min(u + 1, U - 1)], fine[v * U + Math.max(u - 1, 0)]);
        dv.subVectors(fine[Math.min(v + 1, Vn - 1) * U + u], fine[Math.max(v - 1, 0) * U + u]);
        n.crossVectors(dv, du).normalize();
        // Outside is away from him.
        const q = fine[k];
        if ((q.x - axis.x) * n.x + (q.z - axis.z) * n.z < 0) n.negate();
        po.setXYZ(k, q.x, q.y, q.z);
        no.setXYZ(k, n.x, n.y, n.z);
        pi.setXYZ(k, q.x - n.x * 0.012, q.y - n.y * 0.012, q.z - n.z * 0.012);
        ni.setXYZ(k, -n.x, -n.y, -n.z);
      }
    }
    po.needsUpdate = no.needsUpdate = pi.needsUpdate = ni.needsUpdate = true;
  }
}

// ── The coder's hood ──────────────────────────────────────────────────────────

/**
 * A hoodie's hood, up: a soft shell over his head with an opening round his
 * face, edged with a lighter rim and a seam down the middle. Pulling the
 * drawstrings (`cinch` 0..1) gathers the opening in round his snout; half
 * cinched, his eyes peek out. The cords dangle from the bottom of the rim.
 */
class Hood {
  readonly group = new THREE.Group();
  readonly shell: THREE.Mesh;
  /** The lighter lining, seen inside the opening. */
  readonly lining: THREE.Mesh;
  readonly rim: Noodle;
  readonly seam: Noodle;
  readonly cords: Noodle[] = [];
  readonly aglets: THREE.Mesh[] = [];
  private strands = [new Chain(5, 0.06), new Chain(5, 0.06)];
  private rows = 14;
  private segs = 36;
  private last = -1;
  private axis = new THREE.Vector3();
  private u = new THREE.Vector3();
  private w = new THREE.Vector3();
  private d = new THREE.Vector3();
  private p = new THREE.Vector3();
  private toBody = new THREE.Matrix4();
  // Snug round his head (and the bulge of his eyes at the front), not a ball.
  private static C = V(0, 0.03, 0.0);
  private static R = V(0.43, 0.405, 0.45);
  private static OPEN = V(0, 0.08, 1).normalize();
  private static SNUG = V(0, -0.17, 0.98).normalize();

  constructor(private rig: DogRig, cloth: TagOptions, light: TagOptions) {
    const n = (this.rows + 1) * (this.segs + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.segs; j++) {
        const k = i * (this.segs + 1) + j;
        const d = k + this.segs + 1;
        idx.push(k, k + 1, d, k + 1, d + 1, d);
      }
    }
    g.setIndex(idx);
    this.shell = tag(new THREE.Mesh(g), "cloth", cloth);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    lg.setIndex(idx);
    this.lining = tag(new THREE.Mesh(lg), "cloth", { ...light, outline: false });
    this.rim = new Noodle("cloth", 40, 8, light);
    this.seam = new Noodle("cloth", 14, 6, light);
    this.group.add(this.shell, this.lining, this.rim.mesh, this.seam.mesh);
    for (const m of [this.shell, this.lining, this.rim.mesh, this.seam.mesh]) {
      m.frustumCulled = false;
      for (const ch of m.children) ch.frustumCulled = false;
    }
    const aglet = new THREE.CapsuleGeometry(0.013, 0.035, 3, 8);
    for (let i = 0; i < 2; i++) {
      this.cords.push(new Noodle("cloth", 8, 6, light));
      const a = tag(new THREE.Mesh(aglet), "vinyl", light);
      this.aglets.push(a);
    }
    this.place(0);
  }

  /** A point on the shell: `th` from the opening's middle, `ph` round it (0 at the bottom), pushed `out`. */
  private at(th: number, ph: number, out: number, o: THREE.Vector3): THREE.Vector3 {
    const { axis, u, w } = this;
    this.d.copy(axis).multiplyScalar(Math.cos(th))
      .addScaledVector(u, Math.cos(ph) * Math.sin(th))
      .addScaledVector(w, Math.sin(ph) * Math.sin(th));
    const R = Hood.R;
    return o.set(this.d.x * (R.x + out), this.d.y * (R.y + out), this.d.z * (R.z + out)).add(Hood.C);
  }

  /** Opening angle (radians from its middle) at `cinch`, `ph` round it: an oval, wider across his face than tall. */
  private opening(cinch: number, ph = 0): number {
    const s = Math.sin(ph);
    return lerp(1.2, 0.56, cinch) * (1 + 0.32 * cinch * s * s);
  }

  private place(cinch: number): void {
    const { axis, u, w } = this;
    axis.copy(Hood.OPEN).lerp(Hood.SNUG, cinch).normalize();
    // Round the opening: u points down (the bottom of his face), w across.
    w.set(1, 0, 0);
    u.crossVectors(w, axis).normalize();
    if (u.y > 0) u.negate();
    w.crossVectors(axis, u).normalize();
    const th0 = this.opening(cinch);
    const pos = this.shell.geometry.getAttribute("position") as THREE.BufferAttribute;
    const lin = this.lining.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i <= this.rows; i++) {
      const f = i / this.rows;
      for (let j = 0; j <= this.segs; j++) {
        const ph = (j / this.segs) * Math.PI * 2;
        const thO = this.opening(cinch, ph);
        const th = thO + (Math.PI - thO) * f;
        // Gathered into soft folds round the opening as it's pulled in.
        const fold = 0.03 * cinch * Math.sin(ph * 9) * (1 - f) * (1 - f);
        const k = i * (this.segs + 1) + j;
        this.at(th, ph, fold, this.p);
        pos.setXYZ(k, this.p.x, this.p.y, this.p.z);
        this.at(th, ph, fold - 0.016, this.p);
        lin.setXYZ(k, this.p.x, this.p.y, this.p.z);
      }
    }
    pos.needsUpdate = true;
    lin.needsUpdate = true;
    this.shell.geometry.computeVertexNormals();
    this.lining.geometry.computeVertexNormals();
    this.rim.shape((t, o) => this.at(this.opening(cinch, t * Math.PI * 2) + 0.02, t * Math.PI * 2, 0.012, o), () => 0.032 + 0.008 * cinch);
    // The seam: down the middle, from the top of the opening over his crown to the back.
    this.seam.shape((t, o) => this.at(lerp(th0 + 0.08, Math.PI * 0.9, t), Math.PI, 0.008, o), () => 0.013);
  }

  update(dt: number, cinch: number, shown: boolean): void {
    if (Math.abs(cinch - this.last) > 1e-3) {
      this.place(cinch);
      this.last = cinch;
    }
    for (const n of this.cords) n.mesh.visible = shown;
    for (const a of this.aglets) a.visible = shown;
    if (!shown || dt <= 0) return;
    // The cords hang from the bottom of the rim, either side.
    this.group.updateWorldMatrix(true, false);
    this.rig.body.updateWorldMatrix(true, false);
    this.toBody.copy(this.rig.body.matrixWorld).invert();
    for (let i = 0; i < 2; i++) {
      const ph = (i ? 1 : -1) * 0.8;
      const base = this.at(this.opening(cinch, ph) + 0.02, ph, 0.02, this.p).applyMatrix4(this.group.matrixWorld);
      const s = this.strands[i];
      s.update(dt, base, DOWN, 1, 0.4, 10, 0.6);
      const pts = s.p.map((q) => q.clone().applyMatrix4(this.toBody));
      const curve = new THREE.CatmullRomCurve3(pts);
      this.cords[i].shape((t, o) => curve.getPoint(t, o), () => 0.011);
      const a = this.aglets[i];
      a.position.copy(pts[pts.length - 1]);
      a.quaternion.setFromUnitVectors(V(0, 1, 0), this.cords[i].end.t);
    }
  }
}

// ── The cozy scarf ────────────────────────────────────────────────────────────

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
    this.mesh = tag(new THREE.Mesh(g), "knitEnd", { outline: true, cast: true });
    this.mesh.frustumCulled = false;
    for (const c of this.mesh.children) c.frustumCulled = false;
    const tassel = new THREE.CapsuleGeometry(0.013, 0.07, 4, 8);
    tassel.translate(0, -0.05, 0);
    for (const x of [-0.05, -0.017, 0.017, 0.05]) {
      const m = tag(new THREE.Mesh(tassel), "fringe", { outline: true });
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


// ── Outfits ───────────────────────────────────────────────────────────────────

type Builder = (c: Clothes) => void;

/** Sleeves on both arms. */
function sleeves(c: Clothes, surface: Surface, o: TagOptions & { uv?: [number, number] }, reach: number, r0: number, r1: number): Sleeve[] {
  const out = c.rig.arms.map((arm) => new Sleeve(surface, o, arm, 0, reach, r0, r1, armR));
  for (const s of out) c.add(c.rig.body, s.noodle.mesh);
  c.on(() => out.forEach((s) => s.update()));
  return out;
}

/** A garment round his middle, swinging below `free` (see Garment). */
function garment(c: Clothes, surface: Surface, o: TagOptions, cut: Cut): Garment {
  const g = new Garment(surface, o, cut, c.rig);
  c.add(c.rig.hips, g.mesh);
  if (cut.free !== undefined) c.on((w) => g.update(w.dt));
  return g;
}

/** Small things stuck on his front at height y, `grow` out from his torso, `x` across. */
function onFront(x: number, y: number, grow: number): { at: THREE.Vector3; n: THREE.Quaternion } {
  const r = torsoR(y);
  const a = Math.asin(clamp(x / (r + grow), -1, 1));
  const at = onTorso(y, a, grow);
  const above = onTorso(y + 0.02, a, grow);
  const side = onTorso(y, a + 0.05, grow);
  const n = new THREE.Vector3().crossVectors(side.sub(at), above.sub(at)).normalize();
  if (n.z < 0) n.negate();
  return { at, n: new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n) };
}

/** Buttons (or toggles) down his front. */
function buttons(c: Clothes, geo: THREE.BufferGeometry, ys: number[], grow: number, o: TagOptions, x = 0): void {
  const parts = ys.map((y) => {
    const { at, n } = onFront(x, y, grow);
    return geo.clone().applyQuaternion(n).translate(at.x, at.y, at.z);
  });
  c.add(c.rig.hips, tag(new THREE.Mesh(mergeGeometries(parts)), "brass", o));
}

const BUILD: Record<OutfitName, Builder> = {
  cozy(c) {
    const { hips, head, root } = c.rig;
    // A chunky ring round his neck, a knot, a long trailing end.
    const ring = tag(new THREE.Mesh(knitTube(ellipseCurve(0.2, 0.19), 80, 0.085, true)), "knit", solid);
    ring.position.set(0, 0.56, 0.1);
    ring.rotation.x = 0.25;
    const knot = tag(new THREE.Mesh(knitTube(ellipseCurve(0.055, 0.04), 24, 0.055, true)), "knit", solid);
    knot.position.set(0.1, 0.5, 0.26);
    knot.rotation.set(1.3, 0.3, 0.2);
    const anchor = new THREE.Object3D();
    anchor.position.set(0.11, 0.47, 0.28);
    c.add(hips, ring, knot, anchor);
    const rope = new ScarfTail();
    c.add(root, rope.mesh, rope.fringe);
    c.loose.push(ring, knot);
    // The hood he pulls over his head to hide: rounder at the front than his head, so it clears the bulge of his eyes.
    const hood = new THREE.Group();
    const hr = new THREE.Vector3(DOG_HEAD.x * 1.15, DOG_HEAD.y * 1.14, DOG_HEAD.z * 1.34);
    const cap = tag(new THREE.Mesh(knitCap(hr, 1.5)), "knit", solid);
    const rimPts: THREE.Vector3[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      rimPts.push(new THREE.Vector3(Math.sin(a) * Math.sin(1.5) * hr.x, Math.cos(1.5) * hr.y, Math.cos(a) * Math.sin(1.5) * hr.z));
    }
    const rim = tag(new THREE.Mesh(knitTube(new THREE.CatmullRomCurve3(rimPts, true), 64, 0.05, true)), "knit", solid);
    hood.add(cap, rim);
    hood.visible = false;
    c.add(head, hood);
    // And a blanket when he sleeps.
    const blanket = tag(new THREE.Mesh(knitCap(new THREE.Vector3(0.36, 0.5, 0.36), 1.45)), "knit", solid);
    blanket.rotation.x = Math.PI / 2;
    blanket.position.set(0, 0.12, -0.04);
    blanket.visible = false;
    c.add(hips, blanket);
    c.extras.push(hood, blanket);
    c.tuck = 1;
    const at = new THREE.Vector3();
    const pin = { i: 6, at: new THREE.Vector3(), k: 0 };
    c.on((w) => {
      const u = clamp(w.hide, 0, 1.1);
      hood.visible = u > 0.03;
      if (hood.visible) {
        hood.rotation.x = lerp(-2.0, 0.1, u);
        hood.scale.setScalar(lerp(0.85, 1, Math.min(1, u)));
      }
      const bl = clamp(w.blanket, 0, 1);
      blanket.visible = bl > 0.03;
      blanket.scale.setScalar(lerp(0.4, 1, bl));
      // Thrown over a dressing screen: the tail goes with it.
      rope.mesh.visible = rope.fringe.visible = ring.parent === hips;
      if (rope.mesh.visible && w.dt > 0) {
        hips.updateWorldMatrix(true, true);
        const lap = w.lap ?? 0;
        if (lap > 0.01) {
          pin.at.set(0.26, 0.14, 0.4).applyMatrix4(hips.matrixWorld);
          pin.k = 0.35 * lap;
        }
        rope.update(w.dt, anchor.getWorldPosition(at), hips, root, lap > 0.01 ? pin : null);
      }
    });
  },

  desi(c) {
    const k = OUTFITS.desi.cloth;
    c.coversBody = true;
    garment(c, "cloth", wear(k.kurta), { top: 0.52, hem: -0.33, grow: 0.02, free: 0.04, flare: 0.07, rows: 18 });
    sleeves(c, "cloth", wear(k.kurta), 0.86, 0.056, 0.05);
    // The sleeveless Nehru jacket over it, with a mandarin collar and gold buttons.
    garment(c, "cloth", wear(k.jacket), { top: 0.5, hem: -0.06, grow: 0.045, flare: 0.0, rows: 12 });
    const collar = tag(new THREE.Mesh(band(0.15, 0.135, 0.07, 0.014)), "cloth", wear(k.jacket));
    collar.position.set(0, 0.5, 0.1);
    collar.rotation.x = 0.22;
    c.add(c.rig.hips, collar);
    buttons(c, new THREE.SphereGeometry(0.017, 10, 8), [0.38, 0.27, 0.16, 0.05], 0.06, wear(k.gold));
    // A gold trim round the collar's top.
    const trim = tag(new THREE.Mesh(band(0.152, 0.137, 0, 0.009)), "brass", wear(k.gold));
    trim.position.set(0, 0.57, 0.115);
    trim.rotation.x = 0.22;
    c.add(c.rig.hips, trim);
    // The boat-shaped cap: long front to back, a crease along the top, a folded band.
    const capGeo = dome(V(0.22, 0.14, 0.35), Math.PI / 2);
    const pos = capGeo.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 0.14;
      pos.setX(i, pos.getX(i) * (1 - 0.72 * Math.pow(clamp(y, 0, 1), 1.2)));
      pos.setY(i, pos.getY(i) * (1 - 0.25 * Math.abs(pos.getZ(i) / 0.35) ** 2));
    }
    capGeo.computeVertexNormals();
    const cap = new THREE.Group();
    cap.add(tag(new THREE.Mesh(capGeo), "cloth", wear(k.cap)));
    const fold = tag(new THREE.Mesh(band(0.225, 0.355, 0.05, 0.013)), "cloth", wear(k.cap));
    cap.add(fold);
    // Gold piping round the fold.
    const piping: THREE.BufferGeometry[] = [band(0.229, 0.359, 0, 0.011).translate(0, 0.05, 0), band(0.229, 0.359, 0, 0.009)];
    cap.add(tag(new THREE.Mesh(mergeGeometries(piping.map((g) => { g.deleteAttribute("uv"); return g.toNonIndexed(); }))), "brass", wear(k.gold)));
    // Pulled down, it tips forward and slides down his forehead to just below his eyes.
    const hat = new Hat(c, cap, 0.3, -0.26, 0.42, 0.1, V(0, -0.04, 0.05));
    c.tuck = 1;
    // Head level under it (so you see the cap from the front, not its top or inside).
    c.bow = -0.3;
    c.hold = [V(-0.29, 0.1, 0.3), V(0.29, 0.1, 0.3)];
    c.on((w) => {
      hat.pose(w.hide, w.poof, w.t);
      // Its front tugged down over his eyes (the back lifting off his crown), and stretched
      // a little (a cartoon cap, just big enough to cover both his big eyes).
      const u = smooth(clamp(w.hide, 0, 1));
      cap.rotation.set(0.32 * u, 0, 0.1 * (1 - u));
      cap.position.z = 0.04 * u;
      cap.scale.set(1 + 0.7 * u, 1 + 0.3 * u, 1 + 0.2 * u);
    });
  },

  detective(c) {
    const k = OUTFITS.detective.cloth;
    c.coversBody = true;
    garment(c, "cloth", wear(k.coat), { top: 0.53, hem: -0.42, grow: 0.035, free: 0.1, flare: 0.1, slit: 0.32, rows: 20 });
    sleeves(c, "cloth", wear(k.coat), 0.84, 0.06, 0.055);
    // Belt and buckle.
    const belt = tag(new THREE.Mesh(band(torsoR(0.13) + 0.05, torsoR(0.13) * TORSO_DEPTH + 0.05, 0.05, 0.01)), "cloth", wear(k.coatDark));
    belt.position.set(0, 0.105, hunch(0.13));
    c.add(c.rig.hips, belt);
    buttons(c, new RoundedBoxGeometry(0.07, 0.06, 0.02, 2, 0.01), [0.13], 0.09, wear(k.brass));
    // Lapels: two flaps folded back across his chest.
    for (const side of [-1, 1]) {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.lineTo(side * 0.13, 0.2);
      s.lineTo(side * 0.17, 0.16);
      s.lineTo(side * 0.06, -0.06);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.015, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.006, bevelSegments: 2 });
      const lapel = tag(new THREE.Mesh(g), "cloth", wear(k.coatDark));
      const { at, n } = onFront(side * 0.03, 0.3, 0.035);
      lapel.position.copy(at);
      lapel.quaternion.copy(n);
      c.add(c.rig.hips, lapel);
    }
    // The collar turned up (hiding): two tall pointed flaps either side of his face, crossing
    // in front of his snout, up to just under his eyes; the coat's colour outside, its
    // darker colour underneath.
    const collarUp = new THREE.Group();
    for (const side of [-1, 1]) {
      collarUp.add(tag(new THREE.Mesh(collarFlap(side, 0)), "cloth", wear(k.coat)));
      collarUp.add(tag(new THREE.Mesh(collarFlap(side, -0.012)), "cloth", { ...wear(k.coatDark), outline: false }));
    }
    const btn = tag(new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8).scale(1, 1, 0.5)), "brass", wear(k.brass));
    btn.position.set(-0.04, -0.2, 0.93);
    collarUp.add(btn);
    collarUp.visible = false;
    c.add(c.rig.head, collarUp);
    c.extras.push(collarUp);
    // The deerstalker: a check cap with peaks front and back, its ear flaps tied up on top.
    const cap = new THREE.Group();
    cap.add(tag(new THREE.Mesh(dome(V(0.27, 0.21, 0.29), 1.45, 8, 4)), "check", wear(k.hat, k.check)));
    const peaks = brim(0.22, 0.4, 1.08, 0.04, 1, 1);
    // Only front and back: squash the sides in.
    const pp = peaks.getAttribute("position");
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i);
      const z = pp.getZ(i);
      const a = Math.abs(Math.atan2(x, z));
      const side = Math.sin(a) ** 4;
      const r = Math.hypot(x, z);
      const rr = lerp(r, Math.min(r, 0.26), side);
      pp.setXYZ(i, (x / Math.max(r, 1e-6)) * rr, pp.getY(i) * (1 - side), (z / Math.max(r, 1e-6)) * rr);
    }
    peaks.computeVertexNormals();
    const peak = tag(new THREE.Mesh(peaks), "check", wear(k.hat, k.check));
    peak.position.y = 0.01;
    cap.add(peak);
    // Ear flaps, tied up on top with a little bow.
    const flaps: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      flaps.push(new THREE.SphereGeometry(1, 14, 10).scale(0.1, 0.075, 0.02).rotateY(side * 1.25).rotateZ(side * 0.75).translate(side * 0.2, 0.12, 0));
    }
    flaps.push(new THREE.SphereGeometry(0.03, 10, 8).scale(1.6, 0.7, 0.9).translate(0, 0.215, 0));
    cap.add(tag(new THREE.Mesh(mergeGeometries(flaps.map((g) => g.toNonIndexed()))), "check", wear(k.hat, k.check)));
    const hat = new Hat(c, cap, 0.27, -0.27, -0.27, -0.06);
    c.sink = 0.7;
    c.bow = -0.14;
    c.hold = [V(-0.3, -0.12, 0.3), V(0.3, -0.12, 0.3)];
    c.on((w) => {
      hat.pose(0, w.poof, w.t);
      const u = smooth(clamp(w.hide, 0, 1));
      // Up out of the coat (wrapped round his snout from the start, so it's never out under it),
      // all the way by halfway; peeking, the flaps dip so his eyes are clear over them.
      const up = smooth(clamp(u / 0.6, 0, 1));
      const peek = w.hide > 0.5 ? clamp((1.02 - w.hide) / 0.17, 0, 1) : 0;
      collarUp.visible = u > 0.02;
      collarUp.position.y = -0.35 * (1 - up) - 0.1 * peek;
      collarUp.scale.set(1, lerp(0.55, 1, up), 1);
    });
  },

  hero(c) {
    const k = OUTFITS.hero.cloth;
    const cape = new Cape(c.rig, wear(k.cape), wear(k.capeInside));
    c.add(c.rig.root, cape.outer, cape.inner);
    // Clasps at the front corners.
    const clasp = new THREE.SphereGeometry(0.035, 12, 8).scale(1, 1, 0.5);
    for (const side of [-1, 1]) {
      const m = tag(new THREE.Mesh(clasp), "brass", wear(k.emblem));
      const a = Math.PI + side * 1.75;
      m.position.set(Math.sin(a) * 0.215, 0.52, 0.07 + Math.cos(a) * 0.2 + 0.01);
      c.add(c.rig.hips, m);
    }
    // The badge: a gold lightning bolt on a red disc.
    const { at, n } = onFront(0, 0.3, 0.0);
    const disc = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.016, 28).rotateX(Math.PI / 2)), "cloth", wear(k.cape));
    disc.position.copy(at);
    disc.quaternion.copy(n);
    c.add(c.rig.hips, disc);
    const s = new THREE.Shape();
    for (const [x, y] of [[0.02, 0.07], [-0.035, -0.005], [0.0, -0.005], [-0.02, -0.07], [0.04, 0.012], [0.004, 0.012], [0.03, 0.07]]) {
      if (x === 0.02 && y === 0.07) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
    s.closePath();
    const bolt = tag(new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 })), "brass", wear(k.emblem));
    bolt.position.copy(at).add(new THREE.Vector3(0, 0, 0.012).applyQuaternion(n));
    bolt.quaternion.copy(n);
    bolt.scale.setScalar(1.3);
    c.add(c.rig.hips, bolt);
    // The eye mask: a slim black band across his eyes and round his head, a thin rim
    // round each eye (riding on the eye, so it follows it when it pops), and two
    // little ties at the back that flutter.
    c.add(c.rig.head, tag(new THREE.Mesh(maskGeometry()), "cloth", wear(k.mask)));
    const face = c.rig.face;
    if (face) {
      for (let i = 0; i < 2; i++) {
        const pts: THREE.Vector3[] = [];
        for (let j = 0; j < 40; j++) {
          const a = (j / 40) * Math.PI * 2;
          pts.push(V(Math.cos(a) * 0.118, Math.sin(a) * 0.163, 0.032));
        }
        const rim = tag(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 48, 0.01, 6, true)), "cloth", wear(k.mask));
        c.add(face.eye(i).root, rim);
      }
    }
    const tails = new THREE.Group();
    const ties: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const t = new THREE.CapsuleGeometry(0.02, 0.13, 4, 8).scale(1, 1, 0.45);
      t.translate(0, -0.08, 0);
      const m = tag(new THREE.Mesh(t), "cloth", wear(k.mask));
      m.position.x = side * 0.02;
      tails.add(m);
      ties.push(m);
    }
    const knot = tag(new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8).scale(1.3, 0.9, 0.7)), "cloth", wear(k.mask));
    tails.add(knot);
    tails.position.set(0, 0.15, -0.4);
    tails.rotation.x = -0.5;
    c.add(c.rig.head, tails);
    c.loose.push(tails);
    c.on((w) => {
      ties.forEach((m, i) => {
        const side = i ? 1 : -1;
        m.rotation.z = side * (0.45 + 0.18 * Math.sin(w.t * 9 + i * 1.3));
        m.rotation.x = -0.25 + 0.2 * Math.sin(w.t * 7 + i);
      });
    });
    c.holdInHips = true;
    c.bow = 0.15;
    // Arms crossed in front of him, each paw pulling the far edge across: they overlap, closed.
    c.hold = [V(0.12, 0.9, 1.05), V(-0.12, 0.9, 1.05)];
    const hold = [new THREE.Vector3(), new THREE.Vector3()];
    c.on((w) => {
      for (let i = 0; i < 2; i++) hold[i].copy(c.hold[i]).applyMatrix4(c.rig.hips.matrixWorld);
      cape.update(w.dt, w.hide, hold);
    });
  },

  rainy(c) {
    const k = OUTFITS.rainy.cloth;
    c.coversBody = true;
    garment(c, "vinyl", wear(k.coat), { top: 0.53, hem: -0.34, grow: 0.035, free: 0.06, flare: 0.1, rows: 18 });
    sleeves(c, "vinyl", wear(k.coat), 0.84, 0.062, 0.058);
    // Toggles: little bars across his front.
    buttons(c, new THREE.CapsuleGeometry(0.014, 0.055, 4, 8).rotateZ(Math.PI / 2), [0.4, 0.27, 0.14, 0.01], 0.05, wear(k.coatDark));
    const collar = tag(new THREE.Mesh(band(0.16, 0.145, 0.06, 0.014)), "vinyl", wear(k.coat));
    collar.position.set(0, 0.5, 0.1);
    collar.rotation.x = 0.22;
    c.add(c.rig.hips, collar);
    // Red boots.
    const boots = c.rig.legs.map((leg) => new Sleeve("vinyl", wear(k.boots), leg, 0.64, 1.0, 0.066, 0.06, legR, false));
    for (const b of boots) c.add(c.rig.body, b.noodle.mesh);
    const toes = c.rig.feet.map(() => tag(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16)), "vinyl", wear(k.boots)));
    c.add(c.rig.body, ...toes);
    c.coverFeet();
    // The sou'wester: a round crown and a wide brim, longer at the back.
    const hatG = new THREE.Group();
    hatG.add(tag(new THREE.Mesh(dome(V(0.26, 0.21, 0.27), 1.5)), "vinyl", wear(k.hat)));
    hatG.add(tag(new THREE.Mesh(brim(0.25, 0.46, 1.0, 0.08, 0.6, 1.0)), "vinyl", wear(k.hat)));
    const edge = tag(new THREE.Mesh(band(0.255, 0.265, 0, 0.012)), "vinyl", wear(k.coatDark));
    edge.position.y = 0.012;
    hatG.add(edge);
    const hat = new Hat(c, hatG, 0.28, -0.3, 0.62, 0.06);
    c.tuck = 1;
    c.hold = [V(-0.36, 0.2, 0.18), V(0.36, 0.2, 0.18)];
    c.on((w) => {
      hat.pose(w.hide, w.poof, w.t);
      const u = smooth(clamp(w.hide, 0, 1));
      hatG.scale.setScalar(1 + 0.12 * u);
      boots.forEach((b) => b.update());
      c.rig.feet.forEach((f, i) => {
        toes[i].position.copy(f.position);
        toes[i].quaternion.copy(f.quaternion);
        toes[i].scale.set(0.085, 0.07, 0.135);
        toes[i].position.y += 0.012;
      });
    });
  },

  coder(c) {
    const k = OUTFITS.coder.cloth;
    c.coversBody = true;
    garment(c, "cloth", wear(k.hoodie), { top: 0.52, hem: -0.13, grow: 0.035, flare: 0.02, rows: 14 });
    sleeves(c, "cloth", wear(k.hoodie), 0.85, 0.062, 0.056);
    // The ribbed hem and the front pocket, the logo, the drawstrings.
    const hem = tag(new THREE.Mesh(band(0.25 + 0.04, 0.25 * TORSO_DEPTH + 0.04, 0.05, 0.015)), "cloth", wear(k.hoodieLight));
    hem.position.y = -0.15;
    c.add(c.rig.hips, hem);
    const pocket = onFront(0, 0.02, 0.04);
    const pk = tag(new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.12, 0.03, 2, 0.012)), "cloth", wear(k.hoodieLight));
    pk.position.copy(pocket.at);
    pk.quaternion.copy(pocket.n);
    c.add(c.rig.hips, pk);
    const logo = onFront(0.07, 0.33, 0.035);
    const lg = tag(new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.009, 6, 16, Math.PI * 1.3)), "cloth", wear(k.logo));
    lg.position.copy(logo.at);
    lg.quaternion.copy(logo.n);
    lg.rotateZ(1.2);
    c.add(c.rig.hips, lg);
    const strings: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const top = onFront(side * 0.05, 0.47, 0.04).at;
      strings.push(tube([top, top.clone().add(V(side * 0.005, -0.08, 0.02)), top.clone().add(V(side * 0.01, -0.16, 0.025))], 0.008, 8));
      strings.push(new THREE.SphereGeometry(0.014, 8, 6).translate(top.x + side * 0.01, top.y - 0.17, top.z + 0.025));
    }
    const str = tag(new THREE.Mesh(mergeGeometries(strings.map((g) => { g.deleteAttribute("uv"); return g.toNonIndexed(); }))), "cloth", wear(k.hoodieLight));
    c.add(c.rig.hips, str);
    // The hood, down on his back.
    const down = tag(new THREE.Mesh(dome(V(0.22, 0.13, 0.2), 1.7)), "cloth", wear(k.hoodie));
    down.position.set(0, 0.5, -0.12);
    down.rotation.x = -1.9;
    c.add(c.rig.hips, down);
    // The hood up: it flips up over his head, then he pulls the drawstrings and it cinches round his face.
    // (Its shaded side a little lighter than the hoodie's, so the hood reads as cloth, not a dark ball.)
    const hoodShade = new THREE.Color(k.hoodie.shade).lerp(new THREE.Color(k.hoodie.color), 0.55).getStyle();
    const hood = new Hood(c.rig, { ...wear(k.hoodie), shade: hoodShade }, wear(k.hoodieLight));
    hood.group.visible = false;
    c.add(c.rig.head, hood.group);
    c.add(c.rig.body, ...hood.cords.map((n) => n.mesh), ...hood.aglets);
    c.extras.push(hood.group);
    // Headphones.
    const phones = new THREE.Group();
    const bandPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * (0.04 + 0.92 * (i / 12));
      bandPts.push(V(Math.cos(a) * 0.43, 0.13 + Math.sin(a) * 0.32, -0.05));
    }
    const ph = [tube(bandPts, 0.024, 24)];
    for (const side of [-1, 1]) {
      ph.push(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 24).rotateZ(Math.PI / 2).translate(side * 0.43, 0.12, -0.04));
    }
    phones.add(tag(new THREE.Mesh(mergeGeometries(ph.map((g) => { g.deleteAttribute("uv"); return g.toNonIndexed(); }))), "vinyl", wear(k.phones)));
    const pads: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) pads.push(new THREE.TorusGeometry(0.075, 0.022, 8, 20).rotateY(Math.PI / 2).translate(side * 0.47, 0.12, -0.04));
    phones.add(tag(new THREE.Mesh(mergeGeometries(pads)), "cloth", wear(k.frames)));
    c.add(c.rig.head, phones);
    c.loose.push(phones);
    // Round glasses: each lens rides on its eye (so when his eyes pop, the glasses go with them);
    // the bridge and the arms back to the headphones stay put on his head.
    const arms: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) arms.push(tube([V(side * 0.25, 0.12, 0.36), V(side * 0.33, 0.13, 0.22), V(side * 0.41, 0.14, 0.0)], 0.009, 10));
    arms.push(tube([V(-0.03, 0.235, 0.39), V(0, 0.25, 0.405), V(0.03, 0.235, 0.39)], 0.009, 6));
    const frame = tag(new THREE.Mesh(mergeGeometries(arms.map((g) => { g.deleteAttribute("uv"); return g.toNonIndexed(); }))), "iron", wear(k.frames));
    c.add(c.rig.head, frame);
    const lenses: THREE.Group[] = [];
    const face = c.rig.face;
    if (face) {
      for (let i = 0; i < 2; i++) {
        const g = new THREE.Group();
        g.add(tag(new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 8, 32)), "iron", wear(k.frames)));
        g.add(tag(new THREE.Mesh(new THREE.CircleGeometry(0.13, 28)), "lens", { tint: k.lens.color, shade: k.lens.shade }));
        // Just in front of the eye (its front is 0.085 out from its middle).
        g.position.z = 0.11;
        c.add(face.eye(i).root, g);
        lenses.push(g);
      }
    }
    // His eyes only half tuck in: their lower halves peek out of the cinched opening.
    c.tuck = 0.55;
    // Face up, so you see the cinched opening and his nose, not the top of the hood.
    c.bow = -0.16;
    c.hold = [V(-0.2, -0.5, 0.36), V(0.2, -0.5, 0.36)];
    c.on((w) => {
      const u = clamp(w.hide, 0, 1.1);
      // First the flip up over his head, then the cinch.
      const flip = smooth(clamp(u / 0.6, 0, 1));
      const cinch = smooth(clamp((u - 0.6) / 0.45, 0, 1));
      hood.group.visible = u > 0.03;
      hood.group.rotation.x = lerp(-2.0, 0.0, flip);
      hood.group.scale.setScalar(lerp(0.85, 1, flip));
      hood.update(w.dt, cinch, hood.group.visible);
      down.visible = u < 0.5;
      phones.visible = u < 0.3;
      // His glasses peek out of the opening with his eyes; their arms are under the hood.
      for (const g of lenses) g.visible = true;
      frame.visible = u < 0.3;
    });
  },

  pyjamas(c) {
    const k = OUTFITS.pyjamas.cloth;
    c.coversBody = true;
    garment(c, "stripes", wear(k.pj, k.stripe), { top: 0.52, hem: -0.13, grow: 0.03, free: -0.02, flare: 0.04, rows: 14, uv: [14, 1] });
    sleeves(c, "stripes", { ...wear(k.pj, k.stripe), uv: [3, 1] }, 0.86, 0.058, 0.052);
    const legs = c.rig.legs.map((leg) => new Sleeve("stripes", { ...wear(k.pj, k.stripe), uv: [4, 1] }, leg, 0, 0.87, 0.075, 0.062, legR));
    for (const l of legs) c.add(c.rig.body, l.noodle.mesh);
    buttons(c, new THREE.SphereGeometry(0.016, 10, 8), [0.4, 0.27, 0.14, 0.01], 0.04, wear(k.pom));
    const collar = tag(new THREE.Mesh(band(0.155, 0.14, 0.035, 0.014)), "cloth", wear(k.pj));
    collar.position.set(0, 0.5, 0.1);
    collar.rotation.x = 0.22;
    c.add(c.rig.hips, collar);
    // The nightcap: a dome on his crown, a white cuff, and a long floppy tip on a spring with a pom-pom.
    const cap = new THREE.Group();
    cap.add(tag(new THREE.Mesh(dome(V(0.27, 0.22, 0.28), 1.35)), "cloth", wear(k.cap)));
    const cuff = tag(new THREE.Mesh(band(0.265, 0.275, 0.05, 0.024)), "cloth", wear(k.pom));
    cuff.position.y = -0.01;
    cap.add(cuff);
    const tipBase = new THREE.Object3D();
    tipBase.position.set(0, 0.17, -0.02);
    cap.add(tipBase);
    const hat = new Hat(c, cap, 0.25, -0.28, 0.95, -0.05);
    const strand = new Chain(7, 0.085);
    const tip = new Noodle("cloth", 18, 12, wear(k.cap));
    const pom = tag(new THREE.Mesh(new THREE.IcosahedronGeometry(0.065, 2)), "cloth", wear(k.pom));
    c.add(c.rig.body, tip.mesh, pom);
    // Tucked up for the night: a striped quilt and a pillow.
    const quilt = tag(new THREE.Mesh(quiltGeometry()), "stripes", wear(k.pj, k.stripe));
    quilt.rotation.x = Math.PI / 2;
    quilt.position.set(0, 0.12, -0.04);
    quilt.visible = false;
    c.add(c.rig.hips, quilt);
    const pillow = tag(new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.12, 0.34, 3, 0.06)), "cloth", wear(k.pom));
    pillow.visible = false;
    c.add(c.rig.root, pillow);
    c.extras.push(quilt, pillow);
    c.tuck = 1;
    c.hold = [V(-0.27, 0.27, 0.18), V(0.27, 0.27, 0.18)];
    const base = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const toBody = new THREE.Matrix4();
    const headAt = new THREE.Vector3();
    c.on((w) => {
      legs.forEach((l) => l.update());
      hat.pose(w.hide, w.poof, w.t);
      const u = smooth(clamp(w.hide, 0, 1));
      cap.scale.set(1 + 0.12 * u, 1, 1 + 0.12 * u);
      tipBase.updateWorldMatrix(true, false);
      tipBase.getWorldPosition(base);
      dir.set(1, 0.5, -0.45).normalize().transformDirection(tipBase.matrixWorld);
      // Lying down, the tip flops to the floor.
      const bl = clamp(w.blanket, 0, 1);
      if (bl > 0) dir.lerp(DOWN, 0.7 * bl).normalize();
      strand.update(w.dt, base, dir, lerp(0.75, 1, bl), 0.25, 9, 0.7);
      c.rig.body.updateWorldMatrix(true, false);
      toBody.copy(c.rig.body.matrixWorld).invert();
      const pts = strand.p.map((q) => q.clone().applyMatrix4(toBody));
      const curve = new THREE.CatmullRomCurve3(pts);
      const s = cap.scale.x;
      tip.shape((t, o) => curve.getPoint(t, o), (t) => lerp(0.16 * s, 0.03, Math.pow(t, 0.8)));
      pom.position.copy(pts[pts.length - 1]);
      // Bedtime.
      quilt.visible = pillow.visible = bl > 0.03;
      quilt.scale.setScalar(lerp(0.4, 1, bl));
      if (pillow.visible) {
        c.rig.root.updateWorldMatrix(true, false);
        c.rig.head.getWorldPosition(headAt);
        c.rig.root.worldToLocal(headAt);
        // Right under his head, plumped up to meet it (lying down, his big head stays a little off the floor).
        const h = clamp(headAt.y - 0.37, 0.08, 0.3);
        const k = Math.max(0.01, bl);
        pillow.position.set(headAt.x, (h / 2) * k, headAt.z);
        pillow.scale.set(k, (h / 0.12) * k, k);
      }
    });
  },

  chef(c) {
    const k = OUTFITS.chef.cloth;
    garment(c, "cloth", wear(k.apron), { top: 0.4, hem: -0.36, grow: 0.045, free: 0.08, flare: 0.05, arc: 1.15, rows: 18, segs: 24 });
    // Its neck strap and waist ties.
    const strap = tag(new THREE.Mesh(tube([onFront(-0.13, 0.4, 0.045).at, V(-0.13, 0.56, 0.0), V(0, 0.6, -0.12), V(0.13, 0.56, 0.0), onFront(0.13, 0.4, 0.045).at], 0.012, 24)), "cloth", wear(k.apron));
    c.add(c.rig.hips, strap);
    const tie = tag(new THREE.Mesh(band(0.255 + 0.045, 0.255 * TORSO_DEPTH + 0.045, 0, 0.013)), "cloth", wear(k.apron));
    tie.position.set(0, 0.1, hunch(0.1));
    c.add(c.rig.hips, tie);
    const bow = new THREE.Group();
    for (const side of [-1, 1]) {
      const loop = tag(new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8).scale(1.2, 0.7, 0.45)), "cloth", wear(k.apron));
      loop.position.x = side * 0.045;
      loop.rotation.z = side * 0.4;
      bow.add(loop);
    }
    bow.position.set(0, 0.1, -0.23);
    c.add(c.rig.hips, bow);
    // The red neckerchief: a roll round his neck, its point down his front, a knot.
    const roll = tag(new THREE.Mesh(band(0.14, 0.125, 0, 0.035)), "cloth", wear(k.neckerchief));
    roll.position.set(0, 0.55, 0.11);
    roll.rotation.x = 0.22;
    c.add(c.rig.hips, roll);
    const tri = new THREE.Shape();
    tri.moveTo(-0.09, 0);
    tri.lineTo(0.09, 0);
    tri.lineTo(0, -0.13);
    tri.closePath();
    const point = tag(new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 0.012, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.006, bevelSegments: 2 })), "cloth", wear(k.neckerchief));
    const pf = onFront(0, 0.5, 0.05);
    point.position.copy(pf.at);
    point.quaternion.copy(pf.n);
    c.add(c.rig.hips, point);
    // The tall toque: a band, and a puffy top.
    const toque = new THREE.Group();
    toque.add(tag(new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.22, 0.13, 32, 1, true).translate(0, 0.065, 0)), "cloth", wear(k.hat)));
    const puffs: THREE.BufferGeometry[] = [new THREE.SphereGeometry(0.2, 18, 12).scale(1, 1.15, 1).translate(0, 0.33, 0)];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      puffs.push(new THREE.SphereGeometry(0.12, 14, 10).translate(Math.sin(a) * 0.17, 0.25 + (i % 2) * 0.05, Math.cos(a) * 0.17));
    }
    puffs.push(new THREE.CylinderGeometry(0.21, 0.235, 0.18, 24, 1, true).translate(0, 0.2, 0));
    toque.add(tag(new THREE.Mesh(mergeGeometries(puffs.map((g) => { g.deleteAttribute("uv"); return g.toNonIndexed(); }))), "cloth", wear(k.hat)));
    const hat = new Hat(c, toque, 0.27, -0.3, -0.3, 0.08);
    // The frying pan he hides behind (in front of his face).
    const pan = fryingPan();
    const panAt = new THREE.Group();
    panAt.position.set(0, -0.06, 0.86);
    panAt.rotation.x = -0.1;
    panAt.add(pan);
    panAt.visible = false;
    c.add(c.rig.head, panAt);
    c.extras.push(panAt);
    c.hold = [V(-0.3, 0.02, 0.8), V(0.1, -0.52, 0.78)];
    c.on((w) => {
      hat.pose(0, w.poof, w.t);
      const u = clamp(w.hide, 0, 1.05);
      panAt.visible = u > 0.03;
      pan.scale.setScalar(1.55 * Math.max(0.01, smooth(Math.min(1, u * 1.4))));
      // Peeking: it comes down a little.
      panAt.position.y = -0.02 - 0.2 * (u > 0.5 ? clamp((1 - u) / 0.25, 0, 1) : 0);
    });
  },

  dapper(c) {
    const k = OUTFITS.dapper.cloth;
    c.coversBody = true;
    garment(c, "argyle", wear(k.vest, k.argyle), { top: 0.5, hem: -0.08, grow: 0.03, vee: 0.2, rows: 12, uv: [8, 3] });
    const hem = tag(new THREE.Mesh(band(0.25 + 0.034, 0.25 * TORSO_DEPTH + 0.034, 0.04, 0.012)), "cloth", wear(k.vest));
    hem.position.y = -0.11;
    c.add(c.rig.hips, hem);
    // The red bow tie.
    const bowTie = new THREE.Group();
    for (const side of [-1, 1]) {
      const wing = new THREE.ConeGeometry(0.055, 0.1, 12).rotateZ(side * Math.PI / 2).translate(side * 0.05, 0, 0).scale(1, 1, 0.5);
      bowTie.add(tag(new THREE.Mesh(wing), "cloth", wear(k.bow)));
    }
    bowTie.add(tag(new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8)), "cloth", wear(k.bow)));
    const bf = onFront(0, 0.52, 0.03);
    bowTie.position.copy(bf.at).add(V(0, 0, 0.02));
    bowTie.quaternion.copy(bf.n);
    c.add(c.rig.hips, bowTie);
    // The tweed flat cap: a flattened crown and a short peak at the front.
    const cap = new THREE.Group();
    cap.add(tag(new THREE.Mesh(dome(V(0.3, 0.14, 0.34), 1.5, 9, 3)), "check", wear(k.cap, k.capCheck)));
    const peakG = brim(0.26, 0.4, 1.0, 0.035, 1, 0);
    const pp = peakG.getAttribute("position");
    for (let i = 0; i < pp.count; i++) {
      const z = pp.getZ(i);
      if (z < 0.05) {
        const r = Math.hypot(pp.getX(i), z);
        pp.setXYZ(i, (pp.getX(i) / Math.max(r, 1e-6)) * 0.26, 0, (z / Math.max(r, 1e-6)) * 0.26);
      }
    }
    peakG.computeVertexNormals();
    const peak = tag(new THREE.Mesh(peakG), "check", wear(k.cap, k.capCheck));
    peak.position.set(0, 0.015, 0.06);
    peak.rotation.x = 0.12;
    cap.add(peak);
    const hat = new Hat(c, cap, 0.3, -0.22, 0.8, 0.12);
    c.tuck = 1;
    c.hold = [V(-0.05, 0.15, 0.35), V(0.2, 0.32, 0.3)];
    c.on((w) => hat.pose(w.hide, w.poof, w.t));
  },
};

/** The superhero's eye mask: a domino across the front of his head, dipping over his snout, a thin strap round the back. */
function maskGeometry(): THREE.BufferGeometry {
  const segs = 72;
  const rows = 4;
  const pos: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const r = DOG_HEAD;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2 - Math.PI;
      // A band across his eyes (they sit in front of it, as if through eye holes), a thin strap round the back.
      const front = 1 - smooth(clamp((Math.abs(a) - 1.2) / 0.6, 0, 1));
      const half = lerp(0.022, 0.062, front);
      const mid = 0.115 + 0.03 * (1 - front);
      const y = lerp(mid - half, mid + half, t);
      const k = Math.sqrt(Math.max(0, 1 - (y / r.y) ** 2));
      p.set(Math.sin(a) * r.x * k, y, Math.cos(a) * r.z * k);
      headShape(p, r);
      const n = p.clone().divide(r).normalize();
      p.addScaledVector(n, 0.01);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < segs; j++) {
      const k = i * (segs + 1) + j;
      idx.push(k, k + 1, k + segs + 1, k + 1, k + segs + 2, k + segs + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * One flap of the detective's turned-up collar (`side` -1 his left, 1 his
 * right), in head space: a tall panel rising from his coat's neckline at the
 * side of his jaw and sweeping forward round his snout to cross the other
 * flap in front of it. Its top edge runs low under his eyes at the front and
 * rises to a notched lapel point at the outer corner; the top flares outwards
 * (so its underside shows). `inset` draws the same flap a hair inside (its
 * underside, in the coat's darker colour). Narrower than his head, so his
 * ears and hat show round it.
 */
function collarFlap(side: number, inset: number): THREE.BufferGeometry {
  const cols = 22;
  const rows = 10;
  const pos: number[] = [];
  const idx: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const m = new THREE.Vector3();
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  // The top edge along the flap (u 0 at the outer corner, 1 where it crosses the front):
  // the lapel's point, the notch, then down to just under his eyes.
  const topEdge = (u: number) => {
    if (u < 0.12) return lerp(0.2, 0.15, u / 0.12);
    if (u < 0.2) return lerp(0.15, 0.04, (u - 0.12) / 0.08);
    if (u < 0.28) return lerp(0.04, 0.09, (u - 0.2) / 0.08);
    return lerp(0.09, -0.035, smooth((u - 0.28) / 0.72));
  };
  // His right flap lies over his left in front.
  const over = side > 0 ? 0.02 : 0;
  const at = (u: number, v: number, out: THREE.Vector3) => {
    // Across: from beside his jaw, bulging out round his snout, to past the middle in front.
    a.set(side * lerp(0.2, 0.3, v), 0, lerp(-0.02, 0.06, v));
    m.set(side * lerp(0.28, 0.38, v), 0, lerp(0.42, 0.66, v));
    b.set(-side * 0.07, 0, lerp(0.66, 0.95, Math.min(1, v * 1.4)) + over);
    out.set(0, 0, 0).addScaledVector(a, (1 - u) * (1 - u)).addScaledVector(m, 2 * u * (1 - u)).addScaledVector(b, u * u);
    out.y = lerp(-0.52, topEdge(u), v);
    return out;
  };
  for (let i = 0; i <= rows; i++) {
    const v = i / rows;
    for (let j = 0; j <= cols; j++) {
      const u = j / cols;
      at(u, v, p);
      // Outwards from the curve (away from his face): flaring towards the top, and for the underside, a hair in.
      at(Math.min(1, u + 0.02), v, q).sub(at(Math.max(0, u - 0.02), v, m));
      const n = new THREE.Vector3(q.z, 0, -q.x).normalize();
      if (n.x * p.x + n.z * (p.z - 0.25) < 0) n.negate();
      p.addScaledVector(n, 0.07 * v * v * v + inset + over * 0.5);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const k = i * (cols + 1) + j;
      idx.push(k, k + 1, k + cols + 1, k + 1, k + cols + 2, k + cols + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The pyjamas' quilt: like the scarf's blanket, in stripes. */
function quiltGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, 1.45);
  g.scale(0.38, 0.52, 0.38);
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 16, uv.getY(i));
  return g;
}
