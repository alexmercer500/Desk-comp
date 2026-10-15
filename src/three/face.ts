// Rui's face: a smooth skin window in the hood, with bead eyes, a line mouth
// and blush. Every expression is a set of numbers, and the face eases from one
// set to the next, so any two expressions blend.

import * as THREE from "three";
import { tag } from "./looks";

export interface FaceState {
  /** 1 open, 0 shut. */
  eyeOpen: number;
  /** Shape of a shut eye: +1 a happy ^, -1 a sleepy ‿. */
  eyeArc: number;
  /** Size of the eyes: 1 normal, more for surprise. */
  eyeScale: number;
  /** Where the eyes look, -1..1. */
  lookX: number;
  lookY: number;
  /** -1 frown … +1 smile. */
  mouthCurve: number;
  /** 0 shut … 1 wide open. */
  mouthOpen: number;
  mouthWidth: number;
  /** 0 none … 1.5 very pink. */
  blush: number;
}

export type Expression =
  | "neutral" | "happy" | "joy" | "love" | "sad" | "surprised"
  | "sleepy" | "asleep" | "determined" | "tired" | "ooh" | "chew" | "confused" | "dizzy" | "panic";

const NEUTRAL: FaceState = {
  eyeOpen: 1, eyeArc: -0.2, eyeScale: 1, lookX: 0, lookY: 0,
  mouthCurve: 0.7, mouthOpen: 0, mouthWidth: 1, blush: 0.75,
};

export const EXPRESSIONS: Record<Expression, Partial<FaceState>> = {
  neutral: {},
  happy: { mouthCurve: 1, mouthWidth: 1.15, blush: 1 },
  joy: { eyeOpen: 0, eyeArc: 1, mouthCurve: 1, mouthOpen: 0.55, mouthWidth: 1.2, blush: 1.2 },
  love: { eyeOpen: 0, eyeArc: 1, mouthCurve: 1, mouthWidth: 0.9, blush: 1.6 },
  sad: { eyeScale: 0.95, lookY: -0.6, mouthCurve: -0.8, mouthWidth: 0.85, blush: 0.4 },
  surprised: { eyeScale: 1.35, mouthCurve: 0, mouthOpen: 0.7, mouthWidth: 0.6, blush: 0.6 },
  sleepy: { eyeOpen: 0.35, mouthCurve: 0.1, mouthWidth: 0.7, blush: 0.6 },
  asleep: { eyeOpen: 0, eyeArc: -1, mouthCurve: 0.2, mouthOpen: 0.12, mouthWidth: 0.55, blush: 0.9 },
  determined: { eyeScale: 0.8, mouthCurve: 0.25, mouthWidth: 0.8, blush: 0.9 },
  tired: { eyeOpen: 0.55, lookY: -0.4, mouthCurve: -0.3, mouthOpen: 0.15, mouthWidth: 0.75, blush: 0.5 },
  ooh: { eyeScale: 1.2, mouthCurve: 0.4, mouthOpen: 0.45, mouthWidth: 0.55, blush: 1.3 },
  chew: { eyeOpen: 0, eyeArc: 1, mouthCurve: 0.6, mouthWidth: 0.7, blush: 1.2 },
  confused: { eyeScale: 1.1, lookY: 0.4, lookX: 0.3, mouthCurve: -0.35, mouthWidth: 0.7, blush: 0.6 },
  dizzy: { eyeOpen: 0, eyeArc: -0.4, mouthCurve: -0.2, mouthOpen: 0.2, mouthWidth: 0.6, blush: 0.9 },
  // Comic alarm: big round eyes and a wide "waaah" (the scene wobbles the mouth).
  panic: { eyeScale: 1.5, mouthCurve: -0.6, mouthOpen: 1.0, mouthWidth: 1.55, blush: 1.1 },
};

export function expression(name: Expression): FaceState {
  return { ...NEUTRAL, ...EXPRESSIONS[name] };
}

/** The head shell's radii, in head units. */
export const HEAD = new THREE.Vector3(0.66, 0.58, 0.6);

/**
 * The face window: an ellipse on the front of the head (centre and radii as
 * seen from the front). The face is a plate that follows the head's own curve,
 * a hair proud of the shell, so the hood rim can frame it.
 */
export const FACE = { cx: 0, cy: -0.05, rx: 0.44, ry: 0.3 };
const PROUD = 1.012;

/** Point on the face at (x, y) from the face centre, lifted `lift` off it, in head units. */
export function surface(x: number, y: number, lift = 0): THREE.Vector3 {
  const r = HEAD.clone().multiplyScalar(PROUD);
  const hx = FACE.cx + x;
  const hy = FACE.cy + y;
  const z = r.z * Math.sqrt(Math.max(0, 1 - (hx / r.x) ** 2 - (hy / r.y) ** 2));
  return new THREE.Vector3(hx, hy, z).addScaledVector(normalAt(hx, hy, z), lift);
}

function normalAt(hx: number, hy: number, z: number): THREE.Vector3 {
  const r = HEAD.clone().multiplyScalar(PROUD);
  return new THREE.Vector3(hx / r.x ** 2, hy / r.y ** 2, z / r.z ** 2).normalize();
}

const Z = new THREE.Vector3(0, 0, 1);

/** Sits `obj` on the face at (x, y), facing out along the surface. */
function place(obj: THREE.Object3D, x: number, y: number, lift: number): void {
  const p = surface(x, y);
  obj.position.copy(surface(x, y, lift));
  obj.quaternion.setFromUnitVectors(Z, normalAt(p.x, p.y, p.z));
}

/** The face plate: the patch of the (slightly inflated) head inside the window. */
function plateGeometry(): THREE.BufferGeometry {
  const rings = 28;
  const segs = 128;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const k = i / rings;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const p = surface(Math.cos(a) * FACE.rx * k, Math.sin(a) * FACE.ry * k);
      const n = normalAt(p.x, p.y, p.z);
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** The rolled hood edge around the face window. */
export function rimGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    pts.push(surface(Math.cos(a) * FACE.rx, Math.sin(a) * FACE.ry));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 192, 0.045, 16, true);
}

/** A curved line from -w to +w whose middle bows up by `bow` (down if negative). */
function arcGeometry(w: number, bow: number, radius: number): THREE.TubeGeometry {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-w, 0, 0),
    new THREE.Vector3(0, bow * 2, 0),
    new THREE.Vector3(w, 0, 0),
  );
  return new THREE.TubeGeometry(curve, 20, radius, 8, false);
}

/** Tube shapes are rebuilt only when their numbers move a visible amount. */
class ArcCache {
  private cache = new Map<string, THREE.TubeGeometry>();
  get(w: number, bow: number, radius: number): THREE.TubeGeometry {
    const key = `${w.toFixed(3)}|${bow.toFixed(3)}|${radius}`;
    let g = this.cache.get(key);
    if (!g) {
      g = arcGeometry(w, bow, radius);
      if (this.cache.size > 200) this.cache.clear();
      this.cache.set(key, g);
    }
    return g;
  }
}

export function blushTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,128,140,0.85)");
  grad.addColorStop(0.55, "rgba(255,140,150,0.4)");
  grad.addColorStop(1, "rgba(255,150,160,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const EYE_X = 0.19;
const EYE_Y = 0.03;
const EYE_R = 0.058;
const MOUTH_Y = -0.1;
const LINE = 0.012;

export class Face {
  readonly group = new THREE.Group();
  readonly state: FaceState = expression("neutral");
  private arcs = new ArcCache();
  private eyes: { root: THREE.Group; ball: THREE.Mesh; shine: THREE.Mesh; arc: THREE.Mesh; side: number }[] = [];
  private mouthLine: THREE.Mesh;
  private mouthOpen: THREE.Mesh;
  private cheeks: THREE.Mesh[] = [];
  private blinkT = -1;
  private nextBlink = 2;

  constructor() {
    this.group.add(tag(new THREE.Mesh(plateGeometry()), "skin", { receive: true }));

    const ballGeo = new THREE.SphereGeometry(EYE_R, 32, 20);
    const shineGeo = new THREE.SphereGeometry(0.015, 12, 8);
    const shineMat = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
    for (const side of [-1, 1]) {
      const root = new THREE.Group();
      const ball = tag(new THREE.Mesh(ballGeo), "ink");
      const shine = new THREE.Mesh(shineGeo, shineMat);
      shine.position.set(-0.019, 0.024, 0.034);
      ball.add(shine);
      const arc = tag(new THREE.Mesh(this.arcs.get(0.05, 0.02, LINE)), "ink");
      root.add(ball, arc);
      this.group.add(root);
      this.eyes.push({ root, ball, shine, arc, side });
    }

    this.mouthLine = tag(new THREE.Mesh(this.arcs.get(0.05, -0.02, LINE)), "mouth");
    this.mouthOpen = tag(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16)), "inner");
    this.group.add(this.mouthLine, this.mouthOpen);

    const blush = blushTexture();
    const cheekGeo = new THREE.PlaneGeometry(0.19, 0.13);
    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(
        cheekGeo,
        new THREE.MeshBasicMaterial({ map: blush, transparent: true, depthWrite: false }),
      );
      place(cheek, side * 0.29, -0.07, 0.004);
      this.group.add(cheek);
      this.cheeks.push(cheek);
    }
  }

  /** Where a nose would be, in head units, for the nap bubble. */
  nose(): THREE.Vector3 {
    return surface(0.012, -0.035, 0.0);
  }

  /** Where the mouth is, in head units. */
  mouth(): THREE.Vector3 {
    return surface(0, MOUTH_Y, 0.02);
  }

  blink(): void {
    if (this.blinkT < 0) this.blinkT = 0;
  }

  /** Eases towards `target`; blinks on its own while the eyes are open. */
  update(dt: number, target: FaceState): void {
    const s = this.state;
    const k = 1 - Math.exp(-dt * 16);
    for (const key of Object.keys(target) as (keyof FaceState)[]) s[key] += (target[key] - s[key]) * k;

    // Blinks: a quick shut and open every few seconds.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && target.eyeOpen > 0.5) {
      this.blink();
      this.nextBlink = 2.2 + Math.random() * 3.5;
      if (Math.random() < 0.18) this.nextBlink = 0.25; // a double blink
    }
    let lid = 1;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const u = this.blinkT / 0.14;
      lid = u < 0.45 ? 1 - u / 0.45 : (u - 0.45) / 0.55;
      if (u >= 1) this.blinkT = -1;
    }
    this.draw(Math.min(s.eyeOpen, Math.max(0, lid)));
  }

  private draw(open: number): void {
    const s = this.state;
    const lookX = s.lookX * 0.035;
    const lookY = s.lookY * 0.025;
    for (const e of this.eyes) {
      place(e.root, e.side * EYE_X + lookX, EYE_Y + lookY, 0.004);
      const shut = open < 0.14;
      e.ball.visible = !shut;
      e.arc.visible = shut;
      e.shine.visible = open > 0.45;
      e.ball.scale.set(s.eyeScale, 1.12 * s.eyeScale * Math.max(open, 0.14), 0.55);
      if (shut) {
        const bow = s.eyeArc * 0.024;
        e.arc.geometry = this.arcs.get(0.048 * s.eyeScale, Math.round(bow * 400) / 400, LINE);
      }
    }

    const w = 0.055 * s.mouthWidth;
    place(this.mouthLine, 0, MOUTH_Y, 0.004);
    place(this.mouthOpen, 0, MOUTH_Y - 0.004 - s.mouthOpen * 0.013, 0.0);
    const opened = s.mouthOpen > 0.06;
    this.mouthOpen.visible = opened;
    this.mouthOpen.scale.set(w * 0.95, 0.055 * s.mouthOpen, 0.015);
    // An open mouth keeps a thin upper lip line only when smiling.
    this.mouthLine.visible = !opened || s.mouthCurve > 0.5;
    const bow = -s.mouthCurve * 0.022 * (opened ? 0.4 : 1);
    this.mouthLine.geometry = this.arcs.get(Math.round(w * 400) / 400, Math.round(bow * 400) / 400, LINE);

    for (const c of this.cheeks) (c.material as THREE.MeshBasicMaterial).opacity = Math.min(1, s.blush * 0.8);
  }
}
