// Dogesh Bhai's face (v2, the lanky cartoon pup): huge bulging oval eyes with
// small dot pupils under heavy, expressive lids; small brows; a long snout
// angled down to a big round button nose; a hinged jaw that drops for a scream
// (blocky teeth top and bottom, a flapping tongue); a wide rubbery grin from
// cheek to cheek that can bare chattering teeth; freckles and blush. Like
// Rui's face, every expression is a set of numbers the face eases between.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { blushTexture } from "./face";
import { tag } from "./looks";

export interface DogFaceState {
  /** 1 wide open, 0 shut: the heavy lids come down (he rests at about 0.7). */
  eyeOpen: number;
  /** Shape of a shut eye: +1 a happy ^, -1 a sleepy ‿. */
  eyeArc: number;
  /** Size of the eyes: 1 normal, more when startled. */
  eyeScale: number;
  /** Size of the dot pupils: 1 normal, pinpricks when terrified. */
  pupil: number;
  /** Where the eyes look, -1..1. */
  lookX: number;
  lookY: number;
  /** Trembling eyes, 0..1. */
  shake: number;
  /** The lids slant: + worried (inner corners up), − cross. */
  lidTilt: number;
  /** Brows up (+) or down (−), -1..1. */
  browY: number;
  /** +1 worried (inner ends up) … −1 cross. */
  browTilt: number;
  /** One brow up, the other down (puzzled), -1..1. */
  browSkew: number;
  /** The jaw: 0 shut … 1 a full scream. */
  jaw: number;
  /** The wide mouth line: −1 frown … +1 grin. */
  mouthCurve: number;
  mouthWidth: number;
  /** A wobbly, nervous mouth line, 0..1. */
  mouthWave: number;
  /** A bared-teeth grin along the mouth line, 0..1. */
  teeth: number;
  /** The tongue in an open mouth, 0..1. */
  tongue: number;
  /** How hard the tongue flaps about (a wail), 0..1. */
  tongueFlap: number;
  /** 0 none … 1.5 very pink. */
  blush: number;
  /** Spiral eyes (dizzy), 0..1. */
  spiral: number;
}

export type DogExpression =
  | "neutral" | "happy" | "joy" | "love" | "worried" | "scared" | "panic" | "surprised" | "relieved"
  | "sleepy" | "asleep" | "confused" | "determined" | "dizzy" | "sad" | "sheepish" | "ooh" | "chew";

const NEUTRAL: DogFaceState = {
  eyeOpen: 0.72, eyeArc: -0.2, eyeScale: 1, pupil: 1, lookX: 0, lookY: 0, shake: 0.12, lidTilt: 0.3,
  browY: 0.1, browTilt: 0.55, browSkew: 0,
  jaw: 0, mouthCurve: 0.15, mouthWidth: 1, mouthWave: 0.35, teeth: 0, tongue: 0, tongueFlap: 0,
  blush: 0.6, spiral: 0,
};

export const DOG_EXPRESSIONS: Record<DogExpression, Partial<DogFaceState>> = {
  neutral: {},
  happy: { eyeOpen: 0.85, lidTilt: 0.05, shake: 0, browY: 0.25, browTilt: 0.15, mouthCurve: 1, mouthWave: 0, blush: 1 },
  joy: { eyeOpen: 0, eyeArc: 1, shake: 0, browY: 0.4, browTilt: 0, jaw: 0.45, tongue: 1, mouthCurve: 1, mouthWave: 0, blush: 1.3 },
  love: { eyeOpen: 0, eyeArc: 1, shake: 0, browY: 0.3, browTilt: 0.3, mouthCurve: 1, mouthWave: 0, blush: 1.6 },
  worried: {
    eyeOpen: 0.92, eyeScale: 1.05, pupil: 0.8, shake: 0.3, lidTilt: 0.65, browY: 0.35, browTilt: 1, mouthCurve: -0.3, mouthWave: 1, blush: 0.5,
  },
  scared: {
    eyeOpen: 1, eyeScale: 1.2, pupil: 0.5, shake: 0.6, lidTilt: 0.45, browY: 0.7, browTilt: 1, mouthCurve: -0.15, mouthWave: 0.4,
    teeth: 1, blush: 0.4,
  },
  // Full-on cartoon terror: popping eyes with pinprick pupils, jaw dropped, tongue going.
  panic: {
    eyeOpen: 1, eyeScale: 1.32, pupil: 0.35, shake: 1, lidTilt: 0.3, browY: 1, browTilt: 1, jaw: 1, tongue: 1, tongueFlap: 1,
    mouthCurve: -0.5, mouthWave: 0, blush: 0.5,
  },
  surprised: { eyeOpen: 1, eyeScale: 1.28, pupil: 0.45, shake: 0.2, lidTilt: 0, browY: 1, browTilt: 0.3, jaw: 0.55, tongue: 0.6, mouthCurve: 0, mouthWave: 0 },
  relieved: { eyeOpen: 0, eyeArc: -0.5, shake: 0, lidTilt: 0.4, browY: 0.05, browTilt: 0.7, jaw: 0.12, mouthCurve: 0.7, mouthWave: 0, blush: 1 },
  sleepy: { eyeOpen: 0.3, shake: 0, lidTilt: 0.1, browY: -0.25, browTilt: 0.2, mouthCurve: 0.1, mouthWave: 0.2 },
  asleep: { eyeOpen: 0, eyeArc: -1, shake: 0, browY: -0.15, browTilt: 0.2, jaw: 0.05, mouthCurve: 0.2, mouthWave: 0, blush: 0.9 },
  confused: { eyeOpen: 0.95, lookX: 0.3, lookY: 0.4, lidTilt: 0.2, browY: 0.2, browTilt: 0.2, browSkew: 1, mouthCurve: -0.2, mouthWave: 0.9 },
  determined: { eyeOpen: 0.62, lidTilt: -0.5, shake: 0, browY: -0.25, browTilt: -0.7, mouthCurve: 0.1, mouthWave: 0, blush: 0.9 },
  dizzy: { eyeOpen: 1, spiral: 1, shake: 0, browY: 0.2, browTilt: 0.6, jaw: 0.22, tongue: 1, mouthCurve: -0.1, mouthWave: 1, blush: 0.9 },
  sad: { eyeOpen: 0.78, pupil: 1.35, lookY: -0.45, lidTilt: 0.75, browY: 0.1, browTilt: 1, mouthCurve: -0.85, mouthWave: 0.2, blush: 0.4 },
  // "Heh... sorry": a toothy nervous grin, looking away, pink in the face.
  sheepish: { eyeOpen: 0.7, lookX: -0.45, lookY: -0.25, lidTilt: 0.5, browY: 0.15, browTilt: 0.85, mouthCurve: 0.85, mouthWave: 0, teeth: 1, blush: 1.45 },
  ooh: { eyeOpen: 1, eyeScale: 1.12, pupil: 1.2, shake: 0, lidTilt: 0, browY: 0.45, browTilt: 0.3, jaw: 0.28, mouthCurve: 0.3, mouthWave: 0, blush: 1.2 },
  chew: { eyeOpen: 0, eyeArc: 1, shake: 0, browY: 0.2, browTilt: 0.2, jaw: 0.1, mouthCurve: 0.6, mouthWave: 0, blush: 1.2 },
};

export function dogExpression(name: DogExpression): DogFaceState {
  return { ...NEUTRAL, ...DOG_EXPRESSIONS[name] };
}

/** The head's radii, in head units (a bean, a little lopsided on top; see dogesh.ts). */
export const DOG_HEAD = new THREE.Vector3(0.4, 0.36, 0.36);
const HEAD_E = { c: new THREE.Vector3(), r: DOG_HEAD };
type Ellipsoid = { c: THREE.Vector3; r: THREE.Vector3 };

/** The snout: from its root inside the head down and forward to the tip, and its radius there and at the tip. */
const SNOUT = { a: new THREE.Vector3(0, -0.05, 0.19), b: new THREE.Vector3(0, -0.25, 0.6), r0: 0.125, r1: 0.1 };
const SNOUT_DIR = SNOUT.b.clone().sub(SNOUT.a).normalize();
/** Straight down from the snout's axis, at right angles to it. */
const SNOUT_DOWN = new THREE.Vector3(0, -SNOUT_DIR.z, SNOUT_DIR.y).normalize();
/** The jaw's hinge, and where its tip sits when shut (tucked under the snout). */
const JAW = { hinge: new THREE.Vector3(0, -0.2, 0.16), tip: new THREE.Vector3(0, -0.36, 0.52), r0: 0.095, r1: 0.07 };
/** The jaw opens this far (radians) at jaw = 1. */
const JAW_OPEN = 0.95;

/** The front surface of an ellipsoid at (x, y), lifted `lift` along its normal; and the normal. */
function surf(e: Ellipsoid, x: number, y: number, lift = 0, out = new THREE.Vector3(), normal = new THREE.Vector3()) {
  const dx = (x - e.c.x) / e.r.x;
  const dy = (y - e.c.y) / e.r.y;
  const dz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
  normal.set(dx / e.r.x, dy / e.r.y, dz / e.r.z).normalize();
  out.set(x, y, e.c.z + e.r.z * dz).addScaledVector(normal, lift);
  return { p: out, n: normal };
}

const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);
const tmpN = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

/** Sits `obj` on a surface at (x, y), facing out (turned `forward` of the way to face straight ahead), spun `spin` about its own z. */
function place(obj: THREE.Object3D, e: Ellipsoid, x: number, y: number, lift: number, forward = 0, spin = 0): void {
  const { n } = surf(e, x, y, lift, obj.position, tmpN);
  n.lerp(Z, forward).normalize();
  obj.quaternion.setFromUnitVectors(Z, n);
  if (spin) obj.quaternion.multiply(tmpQ.setFromAxisAngle(Z, spin));
}

/** A rounded, tapering rod from `a` to `b` (radius r0 to r1), capped at the far end. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, -r0 * 0.6), new THREE.Vector2(r0 * 0.8, -r0 * 0.35)];
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    pts.push(new THREE.Vector2(r0 + (r1 - r0) * u, len * u));
  }
  for (let i = 1; i <= 10; i++) {
    const a2 = (i / 10) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r1 * Math.cos(a2), len + r1 * Math.sin(a2)));
  }
  const g = new THREE.LatheGeometry(pts, 40);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize()));
  g.translate(a.x, a.y, a.z);
  g.computeVertexNormals();
  return g;
}

/** Geometry rebuilt only when its (rounded) numbers change. */
class ShapeCache<T extends THREE.BufferGeometry> {
  private cache = new Map<string, T>();
  constructor(private make: (...n: number[]) => T) {}
  get(...n: number[]): T {
    const key = n.map((v) => v.toFixed(3)).join("|");
    let g = this.cache.get(key);
    if (!g) {
      g = this.make(...n);
      if (this.cache.size > 160) this.cache.clear();
      this.cache.set(key, g);
    }
    return g;
  }
}

const LINE = 0.011;

/** A curved line from -w to +w whose middle bows up by `bow` (down if negative). */
function arc(w: number, bow: number, radius: number): THREE.TubeGeometry {
  const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-w, 0, 0), new THREE.Vector3(0, bow * 2, 0), new THREE.Vector3(w, 0, 0));
  return new THREE.TubeGeometry(c, 20, radius, 8, false);
}

const MOUTH_Y = -0.19;

/** The wide mouth, cheek to cheek round the root of his snout, on the head's surface. */
function mouthLine(width: number, curve: number, wave: number, radius: number): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= 16; i++) {
    const u = i / 8 - 1;
    const x = u * 0.27 * width;
    const y = MOUTH_Y + curve * 0.075 * u * u - curve * 0.02 + wave * 0.012 * Math.sin(3 * Math.PI * u);
    surf(HEAD_E, x, y, 0.008, p);
    pts.push(p.clone());
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, radius, 8, false);
}

/** A flat spiral, for dizzy eyes. */
function spiralGeometry(r: number): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * 2.2 * Math.PI * 2;
    const k = 0.12 + 0.88 * (i / 60);
    pts.push(new THREE.Vector3(Math.cos(a) * r * k, Math.sin(a) * r * k * 1.3, 0));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.008, 6, false);
}

const EYE = { x: 0.128, y: 0.11, rx: 0.118, ry: 0.165, rz: 0.085 };
const PUPIL_R = 0.032;

interface Eye {
  side: number;
  root: THREE.Group;
  base: THREE.Vector3;
  normal: THREE.Vector3;
  pupil: THREE.Group;
  shines: THREE.Mesh[];
  lid: THREE.Mesh;
  arc: THREE.Mesh;
  spiral: THREE.Mesh;
}

export class DogFace {
  readonly group = new THREE.Group();
  readonly state: DogFaceState = dogExpression("neutral");
  /** The nose, for sniffing (scale it). */
  readonly nose: THREE.Mesh;
  readonly noseScale = new THREE.Vector3(0.112, 0.098, 0.095);
  private arcs = new ShapeCache(arc);
  private mouths = new ShapeCache(mouthLine);
  private eyes: Eye[] = [];
  /** Each eye drawn bigger by this much (seen through a magnifying glass). */
  readonly zoom = [1, 1];
  private brows: THREE.Mesh[] = [];
  private jawPivot = new THREE.Group();
  private gapPivot = new THREE.Group();
  private gap: THREE.Mesh;
  /** The tongue's root (fixed along the jaw), and the tongue itself, which flaps. */
  private tongueRoot = new THREE.Group();
  private tongue = new THREE.Group();
  private teethUp = new THREE.Group();
  private teethDown = new THREE.Group();
  private grin: THREE.Mesh;
  private grinTeeth: THREE.Mesh;
  private cheeks: THREE.Mesh[] = [];
  private blinkT = -1;
  private nextBlink = 1.5;
  private clock = 0;
  private tuck = 0;

  constructor() {
    const solid = { outline: true, cast: true, receive: true };

    // The long snout, and the big round button nose at its tip.
    this.group.add(tag(new THREE.Mesh(rod(SNOUT.a, SNOUT.b, SNOUT.r0, SNOUT.r1)), "furPale", solid));
    this.nose = tag(new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28)), "nose", { outline: true, cast: true });
    this.nose.position.copy(SNOUT.b).addScaledVector(SNOUT_DIR, 0.08).addScaledVector(SNOUT_DOWN, -0.012);
    this.nose.scale.copy(this.noseScale);
    const shine = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 10),
      new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false, transparent: true, opacity: 0.9 }),
    );
    shine.scale.set(0.032, 0.02, 0.012);
    shine.position.copy(this.nose.position).add(new THREE.Vector3(-0.04, 0.055, 0.06));
    shine.rotation.z = 0.35;
    this.group.add(this.nose, shine);

    // The jaw, hinged under the snout: it drops for a scream.
    this.jawPivot.position.copy(JAW.hinge);
    const jawTip = JAW.tip.clone().sub(JAW.hinge);
    this.jawPivot.add(tag(new THREE.Mesh(rod(new THREE.Vector3(), jawTip, JAW.r0, JAW.r1)), "furPale", solid));
    const jawDir = jawTip.clone().normalize();
    const jawUp = new THREE.Vector3(0, jawDir.z, -jawDir.y).normalize();
    // The tongue lies along it, pivoting at its root so it can flap.
    this.tongueRoot.position.copy(jawDir).multiplyScalar(0.08).addScaledVector(jawUp, 0.05);
    this.tongueRoot.quaternion.setFromUnitVectors(Y, jawDir);
    this.tongueRoot.add(this.tongue);
    const tongueGeo = new THREE.CapsuleGeometry(0.05, 0.16, 6, 14);
    tongueGeo.translate(0, 0.13, 0);
    tongueGeo.scale(1, 1, 0.35);
    this.tongue.add(tag(new THREE.Mesh(tongueGeo), "tongue"));
    this.jawPivot.add(this.tongueRoot);
    // Blocky teeth: a row hanging from the snout near its tip, a row standing on the jaw.
    const tooth = new RoundedBoxGeometry(0.036, 0.05, 0.03, 2, 0.008);
    const up: THREE.BufferGeometry[] = [];
    for (const x of [-0.06, -0.02, 0.02, 0.06]) up.push(tooth.clone().translate(x, -0.02, 0));
    const upper = tag(new THREE.Mesh(mergeGeometries(up)), "teeth", { outline: true });
    this.teethUp.position.copy(SNOUT.a).addScaledVector(SNOUT_DIR, 0.38).addScaledVector(SNOUT_DOWN, 0.08);
    this.teethUp.quaternion.setFromUnitVectors(Y, SNOUT_DOWN.clone().negate());
    this.teethUp.add(upper);
    this.group.add(this.teethUp);
    const dn: THREE.BufferGeometry[] = [];
    for (const x of [-0.045, 0, 0.045]) dn.push(tooth.clone().translate(x, 0.02, 0));
    const lower = tag(new THREE.Mesh(mergeGeometries(dn)), "teeth", { outline: true });
    this.teethDown.position.copy(jawDir).multiplyScalar(0.3).addScaledVector(jawUp, 0.05);
    this.teethDown.quaternion.setFromUnitVectors(Y, jawUp);
    this.teethDown.add(lower);
    this.jawPivot.add(this.teethDown);
    this.group.add(this.jawPivot);
    // The dark of the open mouth, halfway between snout and jaw.
    this.gapPivot.position.copy(JAW.hinge);
    this.gap = tag(new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18)), "inner");
    this.gap.position.copy(jawDir).multiplyScalar(0.2).addScaledVector(jawUp, 0.07);
    this.gap.quaternion.setFromUnitVectors(Z, jawDir);
    this.gapPivot.add(this.gap);
    this.group.add(this.gapPivot);

    // The wide mouth line, and the bared-teeth grin along it.
    this.grin = tag(new THREE.Mesh(this.mouths.get(1, 0.15, 0.35, LINE)), "mouth");
    this.grinTeeth = tag(new THREE.Mesh(this.mouths.get(1, 0.5, 0, 0.024)), "teeth", { outline: true });
    this.group.add(this.grin, this.grinTeeth);

    // Eyes: big white ovals, a small dot pupil with shines, a fur lid that slants and rolls down over the front.
    const scleraGeo = new THREE.SphereGeometry(1, 40, 28);
    const pupilGeo = new THREE.SphereGeometry(1, 20, 14);
    const lidGeo = new THREE.SphereGeometry(1, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    const shineMat = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
    const shineGeo = new THREE.SphereGeometry(1, 12, 8);
    const spiral = spiralGeometry(EYE.rx * 0.8);
    for (const side of [-1, 1]) {
      const root = new THREE.Group();
      place(root, HEAD_E, side * EYE.x, EYE.y, -0.03, 0.62);
      const base = root.position.clone();
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
      const sclera = tag(new THREE.Mesh(scleraGeo), "sclera", { outline: true });
      sclera.scale.set(EYE.rx, EYE.ry, EYE.rz);
      const pupil = new THREE.Group();
      const ball = tag(new THREE.Mesh(pupilGeo), "pupil");
      ball.scale.set(PUPIL_R, PUPIL_R * 1.15, PUPIL_R * 0.4);
      const big = new THREE.Mesh(shineGeo, shineMat);
      big.scale.set(0.011, 0.012, 0.006);
      big.position.set(-0.009, 0.012, 0.012);
      pupil.add(ball, big);
      const lidPivot = new THREE.Group();
      lidPivot.scale.set(EYE.rx * 1.07, EYE.ry * 1.06, EYE.rz * 1.22);
      const lid = tag(new THREE.Mesh(lidGeo), "fur", { cast: true });
      lid.rotation.order = "ZXY";
      lidPivot.add(lid);
      const shut = tag(new THREE.Mesh(this.arcs.get(0.08, 0.02, LINE)), "pupil");
      shut.position.z = EYE.rz * 1.22 + 0.011;
      const swirl = tag(new THREE.Mesh(spiral), "pupil");
      swirl.position.z = EYE.rz * 0.99;
      root.add(sclera, pupil, lidPivot, shut, swirl);
      this.group.add(root);
      this.eyes.push({ side, root, base, normal, pupil, shines: [big], lid, arc: shut, spiral: swirl });
    }

    // Small brows.
    for (const side of [-1, 1]) {
      const brow = tag(new THREE.Mesh(arc(0.05, 0.013, 0.02)), "brow", { outline: true });
      brow.userData.side = side;
      this.group.add(brow);
      this.brows.push(brow);
    }

    // Three freckles on each cheek (one mesh), and blush.
    const dot = new THREE.Object3D();
    const dots: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      for (const [x, y] of [[0.255, -0.07], [0.31, -0.105], [0.25, -0.13]]) {
        place(dot, HEAD_E, side * x, y, 0.002);
        dot.scale.set(0.016, 0.016, 0.006);
        dot.updateMatrix();
        dots.push(new THREE.SphereGeometry(1, 12, 8).applyMatrix4(dot.matrix));
      }
    }
    this.group.add(tag(new THREE.Mesh(mergeGeometries(dots)), "freckle"));
    const blush = blushTexture();
    const cheekGeo = new THREE.PlaneGeometry(0.17, 0.11);
    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(cheekGeo, new THREE.MeshBasicMaterial({ map: blush, transparent: true, depthWrite: false }));
      place(cheek, HEAD_E, side * 0.29, -0.1, 0.012, 0);
      this.group.add(cheek);
      this.cheeks.push(cheek);
    }
  }

  /**
   * Eye `i` (0 his left, at -x; 1 his right): the group it's drawn in (it
   * moves out and grows as the eye pops), and where it sits at rest with the
   * way it faces, in head units. Things worn on the eyes follow `root`.
   */
  eye(i: number): { root: THREE.Group; base: THREE.Vector3; normal: THREE.Vector3 } {
    const e = this.eyes[i];
    return { root: e.root, base: e.base, normal: e.normal };
  }

  /** Just in front of his mouth, in head units (for chewing his nails, a biscuit). */
  mouth(): THREE.Vector3 {
    return new THREE.Vector3(0, -0.36, 0.58);
  }

  blink(): void {
    if (this.blinkT < 0) this.blinkT = 0;
  }

  /**
   * Eases towards `target`; blinks on its own (a nervous lot). `pop`: the eyes
   * bulge out of his head, 0..1. `tuck`: the hood is over his head, so the eyes
   * sit back in (and never poke through it), 0..1.
   */
  update(dt: number, target: DogFaceState, pop = 0, tuck = 0): void {
    this.clock += dt;
    const s = this.state;
    const k = 1 - Math.exp(-dt * 16);
    for (const key of Object.keys(target) as (keyof DogFaceState)[]) s[key] += (target[key] - s[key]) * k;

    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && target.eyeOpen > 0.45 && target.spiral < 0.5) {
      this.blink();
      this.nextBlink = 1.4 + Math.random() * 2.8;
      if (Math.random() < 0.3) this.nextBlink = 0.2;
    }
    let lid = 1;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const u = this.blinkT / 0.13;
      lid = u < 0.45 ? 1 - u / 0.45 : (u - 0.45) / 0.55;
      if (u >= 1) this.blinkT = -1;
    }
    this.tuck += (tuck - this.tuck) * k;
    this.draw(Math.min(s.eyeOpen, s.eyeOpen * Math.max(0, lid)), Math.max(0, pop) * (1 - this.tuck));
  }

  private draw(open: number, pop: number): void {
    const s = this.state;
    const t = this.clock;
    const jitter = s.shake * 0.008;
    const spiral = s.spiral > 0.5;
    for (const e of this.eyes) {
      const scale = s.eyeScale * (1 + 0.32 * pop) * (1 + s.shake * 0.025 * Math.sin(t * 47 + e.side));
      // Under the hood: the bulge flattens (so it never pokes through), and only when he's fully hidden do the eyes sink in.
      const flat = Math.min(1, this.tuck / 0.8);
      const sink = THREE.MathUtils.smoothstep(this.tuck, 0.9, 1.02);
      const z = this.zoom[e.side < 0 ? 0 : 1];
      e.root.scale.set(scale * z, scale * z, scale * z * (1 - 0.6 * flat));
      e.root.position.copy(e.base).addScaledVector(e.normal, 0.075 * pop - 0.045 * sink);
      const shut = open < 0.1;
      e.lid.rotation.set(THREE.MathUtils.lerp(Math.PI / 2, -Math.PI / 2 - 0.2, Math.min(1, open)), 0, e.side * s.lidTilt * 0.38);
      e.lid.visible = open < 0.98;
      e.arc.visible = shut && !spiral;
      if (e.arc.visible) {
        const bow = Math.round(s.eyeArc * 0.026 * 400) / 400;
        e.arc.geometry = this.arcs.get(0.08, bow, LINE * 1.1);
        e.arc.position.y = -s.eyeArc * 0.012;
      }
      e.spiral.visible = spiral;
      e.spiral.rotation.z = -t * 7 * e.side;
      const px = THREE.MathUtils.clamp(s.lookX * 0.05 + Math.sin(t * 61 + e.side * 2) * jitter, -0.07, 0.07);
      const py = THREE.MathUtils.clamp(s.lookY * 0.06 + Math.sin(t * 53 + e.side) * jitter, -0.1, 0.1);
      const dz = Math.sqrt(Math.max(0, 1 - (px / EYE.rx) ** 2 - (py / EYE.ry) ** 2));
      e.pupil.position.set(px, py, EYE.rz * dz - PUPIL_R * 0.25);
      tmpN.set(px / EYE.rx ** 2, py / EYE.ry ** 2, (EYE.rz * dz) / EYE.rz ** 2).normalize();
      e.pupil.quaternion.setFromUnitVectors(Z, tmpN);
      // Pinpricks in a fright, but always there.
      const p = Math.max(0.42, Math.max(0.25, s.pupil) * (1 - 0.3 * pop));
      e.pupil.children[0].scale.set(PUPIL_R * p, PUPIL_R * 1.15 * p, PUPIL_R * 0.4);
      e.pupil.visible = !shut && !spiral;
      for (const sh of e.shines) sh.visible = open > 0.4 && p > 0.6;
    }

    for (const b of this.brows) {
      const side = b.userData.side as number;
      const y = EYE.y + EYE.ry * s.eyeScale * (1 + 0.3 * pop) + 0.06 + s.browY * 0.05 + side * s.browSkew * 0.035;
      const tilt = -side * s.browTilt * 0.42 + s.browSkew * 0.25;
      place(b, HEAD_E, side * (EYE.x + 0.02), Math.min(y, 0.33), 0.012, 0.35, tilt);
    }

    // Jaw, teeth and tongue.
    const jaw = Math.max(0, s.jaw);
    this.jawPivot.rotation.x = jaw * JAW_OPEN;
    this.gapPivot.rotation.x = jaw * JAW_OPEN * 0.5;
    this.gap.visible = jaw > 0.04;
    this.gap.scale.set(0.085 + 0.02 * jaw, 0.012 + 0.11 * jaw, 0.17);
    const showTeeth = jaw > 0.12;
    this.teethUp.visible = this.teethDown.visible = showTeeth;
    this.tongue.visible = jaw > 0.15 && s.tongue > 0.1;
    this.tongue.scale.setScalar(Math.max(0.01, s.tongue));
    if (this.tongue.visible) {
      // Lolling out over the jaw, flapping about in a wail.
      this.tongue.rotation.set(0.35 * jaw + s.tongueFlap * Math.sin(t * 26) * 0.5, 0, s.tongueFlap * Math.sin(t * 19) * 0.25);
    }

    // The mouth line (or a toothy grin) from cheek to cheek.
    const teeth = s.teeth > 0.08;
    this.grin.visible = !teeth && jaw < 0.5;
    if (this.grin.visible) {
      this.grin.geometry = this.mouths.get(
        Math.round(s.mouthWidth * 20) / 20, Math.round(s.mouthCurve * 20) / 20, Math.round(s.mouthWave * 10) / 10, LINE,
      );
    }
    this.grinTeeth.visible = teeth;
    if (teeth) {
      this.grinTeeth.geometry = this.mouths.get(Math.round(s.mouthWidth * 20) / 20, Math.max(0.3, Math.round(s.mouthCurve * 10) / 10), 0, 0.024);
    }

    for (const c of this.cheeks) (c.material as THREE.MeshBasicMaterial).opacity = Math.min(1, s.blush * 0.75);
  }
}
