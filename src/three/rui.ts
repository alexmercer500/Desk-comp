// Rui: a small yeti in a hood, built and animated in code like a vinyl toy:
// smooth separate parts (head, body, arms, legs, ears) on a tiny rig. Every
// behaviour writes a target pose each frame, and each joint follows it on a
// spring, so moves overshoot a touch and settle, and behaviours blend.

import * as THREE from "three";
import { Face, FaceState, Expression, expression, HEAD, rimGeometry } from "./face";
import {
  Look, ThemeName, finishTheme, incomingColor, magicShared, paint, paintShared, setTheme, startTheme, tag, themeColors,
} from "./looks";
import {
  brush, dispose, palette, reachArm, tablet, theGhosts, theMirror, theQuestion, theTrunk, theWardrobe,
} from "./props";
import { Wobble, clamp, kf, lerp, limbGeometry, smooth, softShadow } from "./rig";

// ── Pose ──────────────────────────────────────────────────────────────────────

const CHANNELS = [
  "hipsY", "hipsRx", "hipsRz", "squash", "yaw",
  "headRx", "headRy", "headRz",
  "armLx", "armLz", "armRx", "armRz",
  "legLx", "legLz", "legRx", "legRz", "legZ",
] as const;
type Channel = (typeof CHANNELS)[number];
type Pose = Record<Channel, number>;

const HIP = 0.4;
/** From the hips down to the soles. */
const LEG_REACH = 0.4;
const REST: Pose = {
  hipsY: HIP, hipsRx: 0, hipsRz: 0, squash: 1, yaw: 0,
  headRx: 0, headRy: 0, headRz: 0,
  armLx: 0, armLz: -0.3, armRx: 0, armRz: 0.3,
  legLx: 0, legLz: 0, legRx: 0, legRz: 0, legZ: 0.03,
};
/** Sitting on the ground, leaning back, feet out in front. */
const SEATED: Partial<Pose> = {
  hipsY: 0.23, hipsRx: -0.24, headRx: 0.14, armLx: -0.15, armLz: -0.8, armRx: -0.15, armRz: 0.8,
  legLx: -1.55, legRx: -1.55, legLz: -0.42, legRz: 0.42, legZ: 0.26,
};

function blendInto(p: Pose, to: Partial<Pose>, u: number): void {
  for (const k of Object.keys(to) as Channel[]) p[k] += (to[k]! - p[k]) * u;
}

// ── Behaviours ────────────────────────────────────────────────────────────────

export type ActionName = "walk" | "stroll" | "spin" | "wave" | "sit" | "exercise" | "eat" | "nap" | "poke";
export const ACTIONS: ActionName[] = ["walk", "stroll", "spin", "wave", "sit", "exercise", "eat", "nap"];

/**
 * Behaviours the desktop app cues as the character's state changes (see
 * stage.ts): the prototype page's buttons use ActionName instead.
 */
export type Cue =
  | "rest" | "boot" | "stand" | "work" | "hooray" | "nod" | "ponder" | "shrug" | "droop"
  | "call" | "doze" | "sleep" | "wake" | "held" | "land" | "dizzy" | "hopLeft" | "hopRight"
  /** Working, by what the agent is doing: reading or searching, running a command, on the web ("work" is editing). */
  | "research" | "run" | "browse";

/** The four ways of putting on a new colour theme. */
export type ChangeStyle = "paint" | "twirl" | "wardrobe" | "trunk";
export const CHANGE_STYLES: ChangeStyle[] = ["paint", "twirl", "wardrobe", "trunk"];

interface Running {
  name: string;
  /** If interrupted, play this first (e.g. put a prop away) instead of stopping dead. */
  outro?: () => Running;
  t: number;
  /** Writes this frame's pose; returns false when finished. */
  step(t: number, dt: number): boolean;
  /** Places things that follow him, once this frame's pose is on. */
  after?(t: number): void;
  end?(): void;
}

// ── Shapes ────────────────────────────────────────────────────────────────────

function bodyGeometry(): THREE.BufferGeometry {
  // Pear-shaped profile, bottom to top, in world units with the feet at 0.
  const profile = [
    [0.0, 0.17], [0.32, 0.2], [0.46, 0.27], [0.55, 0.4], [0.58, 0.55], [0.56, 0.72],
    [0.5, 0.88], [0.42, 1.0], [0.3, 1.1], [0.0, 1.16],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const pts = new THREE.SplineCurve(profile).getPoints(64);
  pts[0].x = 0;
  pts[pts.length - 1].x = 0;
  const g = new THREE.LatheGeometry(pts, 72);
  // The lathe's seam starts at the front; turn it to the back.
  g.rotateY(Math.PI);
  g.scale(1, 1, 0.9);
  g.translate(0, -HIP, 0);
  g.computeVertexNormals();
  return g;
}

/** A curl of hair: a tube that tapers to a point. */
function curlGeometry(): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.06, 0),
    new THREE.Vector3(0.02, 0.05, 0.01),
    new THREE.Vector3(-0.02, 0.12, 0.04),
    new THREE.Vector3(-0.08, 0.12, 0.06),
  ]);
  const segs = 48;
  const radial = 16;
  const g = new THREE.TubeGeometry(curve, segs, 0.07, radial, false);
  const pos = g.getAttribute("position");
  const p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const centre = curve.getPointAt(i / segs);
    const k = 1 - 0.7 * (i / segs) ** 1.6;
    for (let j = 0; j <= radial; j++) {
      const n = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, n).sub(centre).multiplyScalar(k).add(centre);
      pos.setXYZ(n, p.x, p.y, p.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

function bubbleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 v = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -v.xyz;
        gl_Position = projectionMatrix * v;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(vV);
        float f = pow(1.0 - abs(dot(N, V)), 2.0);
        vec3 tint = mix(vec3(0.72, 0.9, 1.0), vec3(1.0, 0.78, 0.95), f);
        float spec = pow(max(dot(N, normalize(vec3(-0.4, 0.6, 0.7))), 0.0), 50.0);
        gl_FragColor = vec4(tint + spec, 0.16 + 0.6 * f + spec);
        #include <colorspace_fragment>
      }`,
  });
}

function cookie(): THREE.Group {
  const g = new THREE.Group();
  g.add(tag(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.145, 0.04, 40)), "dough", { outline: true }));
  const chip = new THREE.SphereGeometry(0.02, 10, 8);
  for (const [x, z] of [[0.06, 0.04], [-0.07, 0.03], [0.0, -0.07], [-0.03, 0.08], [0.08, -0.05], [-0.06, -0.06]]) {
    for (const y of [0.021, -0.021]) {
      const m = tag(new THREE.Mesh(chip), "choc");
      m.position.set(x, y, z);
      m.scale.y = 0.6;
      g.add(m);
    }
  }
  // Face the flat side to the front.
  g.rotation.x = Math.PI / 2;
  return g;
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

export class Rui {
  readonly root = new THREE.Group();
  /** Furthest the character may walk from the centre, set by the stage. */
  bounds = 2;
  /** Expression when nothing else is going on. */
  mood: Expression = "neutral";
  autoLife = false;

  private hips = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private face = new Face();
  private shoulders = [new THREE.Group(), new THREE.Group()];
  private legs = [new THREE.Group(), new THREE.Group()];
  private ears = [new THREE.Group(), new THREE.Group()];
  /** Mitten tips: right and left. */
  private hand = new THREE.Group();
  private handL = new THREE.Group();
  private tuft = new THREE.Group();
  private shadow = softShadow();
  private bubble = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), bubbleMaterial());
  private snack = cookie();
  private sweat: THREE.Mesh;
  /** A second drop, for the other side of his hood when he's really scared. */
  private sweat2: THREE.Mesh;

  private pose: Pose = { ...REST };
  private poseVel = Object.fromEntries(CHANNELS.map((c) => [c, 0])) as Pose;
  private target: Pose = { ...REST };
  /** How fast joints chase their targets this frame. */
  private rate = 10;
  /** Spring damping this frame: 1 settles without overshoot, lower is bouncier. */
  private bounce = 0.68;
  private expr: Expression = "neutral";
  private faceMods: Partial<FaceState> = {};

  private action: Running | null = null;
  private queue: (() => Running)[] = [];
  private seated = false;
  private popRequested = false;
  private idleFor = 0;
  private nextAuto = 4;

  private gaze = { x: 0, y: 0, at: -10 };
  private glance = { yaw: 0, pitch: 0, next: 1 };
  private clock = 0;
  private lastX = 0;
  private lastHipY = HIP;
  private lastHead = new THREE.Vector2();
  private vel = new THREE.Vector2();
  private tuftWobble = new Wobble(170, 6);
  private earWobble = [new Wobble(140, 5), new Wobble(140, 5)];
  private particles: Particle[] = [];
  private carry = new THREE.Vector2();
  private wiggleT = 99;
  /** Whether "doing his own thing" may include a nap (off on the desktop, where the app decides when he sleeps). */
  naps = true;
  /** Where the new colour spreads from, in hips units, while a theme is being painted on. */
  private paintFrom: THREE.Vector3 | null = null;
  private lastChange: ChangeStyle | null = null;
  private look: Look = "toy";
  /** How much more of the stage a scene needs (0 normal … 1 room for a wardrobe). */
  wide = 0;

  constructor(private world: THREE.Object3D) {
    world.add(this.root);
    this.root.add(this.shadow, this.hips);
    const solid = { outline: true, cast: true, receive: true };

    this.hips.add(tag(new THREE.Mesh(bodyGeometry()), "shell", solid));

    // Head: a hood with the face window set into its front, edged by a rolled rim.
    this.neck.position.y = 1.1 - HIP;
    this.hips.add(this.neck);
    this.head.position.y = 0.42;
    this.neck.add(this.head);
    const skull = new THREE.SphereGeometry(1, 72, 54);
    skull.scale(HEAD.x, HEAD.y, HEAD.z);
    this.head.add(tag(new THREE.Mesh(skull), "shell", solid));
    this.head.add(tag(new THREE.Mesh(rimGeometry()), "rim", { cast: true, receive: true }));
    this.head.add(this.face.group);

    // Two small round ears on the hood, and a curl on top; both wobble.
    const earGeo = new THREE.SphereGeometry(1, 32, 24);
    const innerGeo = new THREE.SphereGeometry(1, 24, 16);
    this.ears.forEach((ear, i) => {
      const side = i === 0 ? -1 : 1;
      ear.position.set(side * 0.47, 0.36, -0.02);
      ear.rotation.z = -side * 0.55;
      const shell = tag(new THREE.Mesh(earGeo), "ear", solid);
      shell.scale.set(0.15, 0.16, 0.09);
      shell.position.y = 0.08;
      const inner = tag(new THREE.Mesh(innerGeo), "earInner");
      inner.scale.set(0.09, 0.1, 0.03);
      inner.position.set(0, 0.08, 0.065);
      ear.add(shell, inner);
      this.head.add(ear);
    });
    this.tuft.position.set(0.03, 0.54, 0.05);
    this.tuft.add(tag(new THREE.Mesh(curlGeometry()), "curl", solid));
    this.head.add(this.tuft);

    // Arms hang from the shoulders, mittens at the ends.
    const arm = limbGeometry(0.13, 0.36, 0.05, 0.3);
    this.shoulders.forEach((s, i) => {
      s.position.set(i === 0 ? -0.47 : 0.47, 0.98 - HIP, 0.02);
      s.add(tag(new THREE.Mesh(arm), "limb", solid));
      this.hips.add(s);
    });
    // The tip of the right mitten, where a snack is held.
    this.hand.position.set(0, -0.66, 0.06);
    this.shoulders[1].add(this.hand);
    this.handL.position.set(0, -0.66, 0.06);
    this.shoulders[0].add(this.handL);
    this.snack.visible = false;
    this.hand.add(this.snack);

    // Stubby legs under the belly.
    // Radius 0.17 and length 0.1 make it 0.44 long; its sole sits LEG_REACH below the hips.
    const leg = limbGeometry(0.17, 0.1, 0.44 - LEG_REACH, 0.12);
    this.legs.forEach((l, i) => {
      l.position.set(i === 0 ? -0.22 : 0.22, 0, REST.legZ);
      l.add(tag(new THREE.Mesh(leg), "limb", solid));
      this.hips.add(l);
    });

    this.bubble.visible = false;
    this.face.group.add(this.bubble);

    this.sweat = tag(new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14)), "sweat");
    this.sweat.scale.set(0.03, 0.045, 0.03);
    this.sweat.visible = false;
    this.head.add(this.sweat);
    this.sweat2 = tag(new THREE.Mesh(this.sweat.geometry), "sweat");
    this.sweat2.visible = false;
    this.head.add(this.sweat2);

    this.setLook("toy");
  }

  setLook(look: Look): void {
    this.look = look;
    paint(this.root, look);
    // The wardrobe, mirror and trunk stand in the room, not on him; repaint them if they're out.
    for (const prop of [theWardrobe().group, theMirror(), theTrunk().group, theGhosts().group]) {
      if (prop.parent) paint(prop, look);
    }
  }

  /** Objects a click can land on. */
  get hitTarget(): THREE.Object3D {
    return this.hips;
  }

  /** World position of the head, for steering the gaze from the pointer. */
  headWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.head.getWorldPosition(out);
  }

  /** The pointer is at (dx, dy) from the head, roughly -1..1 each way. */
  lookAt(dx: number, dy: number): void {
    this.gaze.x = clamp(dx, -1, 1);
    this.gaze.y = clamp(dy, -1, 1);
    this.gaze.at = this.clock;
  }

  get current(): string {
    return this.action?.name ?? "idle";
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

  play(name: ActionName | Cue): void {
    if (this.action?.name === "nap" && (name === "nap" || name === "sleep")) return;
    if (this.action?.name === "work" && name === "work") return;
    if (this.action?.name === "held" && name === "held") return;
    this.begin(this.stepsFor(name));
  }

  /** Replaces whatever he's doing with `steps`, letting the current behaviour bow out gracefully. */
  private begin(steps: (() => Running)[]): void {
    this.idleFor = 0;
    if (this.action?.name === "nap") {
      // Wake first: the bubble pops, he starts, and the steps follow.
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

  /** Feeds the drag velocity (logical px/s) to the dangle while held. */
  setCarry(vx: number, vy: number): void {
    this.carry.set(vx, vy);
  }

  /** A quick "hey!" wiggle on top of whatever he's doing. */
  wiggle(): void {
    this.wiggleT = 0;
  }

  private stepsFor(name: ActionName | Cue): (() => Running)[] {
    const standFirst = () => (this.seated ? [() => this.standUp()] : []);
    const sitFirst = () => (this.seated ? [] : [() => this.sitDown()]);
    switch (name) {
      case "rest":
        return [...sitFirst(), () => this.sitting(Infinity, "asleep", "rest")];
      case "boot":
        return [...standFirst(), () => this.stretch()];
      case "stand":
        return standFirst();
      case "work":
        return [...sitFirst(), () => this.working()];
      // Placeholders until each has a pose of its own: the tablet.
      case "research":
      case "run":
      case "browse":
        return [...sitFirst(), () => this.working()];
      case "hooray":
        return [...standFirst(), () => (Math.random() < 0.4 ? this.spin() : this.hooray())];
      case "nod":
        return [() => this.nod()];
      case "ponder":
        return [...standFirst(), () => this.ponder()];
      case "shrug":
        return [...standFirst(), () => this.shrug()];
      case "droop":
        return [() => this.droop()];
      case "call":
        return [...standFirst(), () => this.call()];
      case "doze":
        return [...sitFirst(), () => this.dozing()];
      case "sleep":
        return [...sitFirst(), () => this.nap(true)];
      case "wake":
        return standFirst();
      case "held":
        return [() => this.dangle()];
      case "land":
        return [() => this.land()];
      case "dizzy":
        return [...standFirst(), () => this.dizzy()];
      case "hopLeft":
      case "hopRight":
        return [...standFirst(), () => this.hop(name === "hopLeft" ? -1 : 1)];
    }
    let queue: (() => Running)[] = [];
    switch (name) {
      case "walk": {
        const x = this.root.position.x > 0 ? -this.bounds : this.bounds;
        queue = [...standFirst(), () => this.walkTo(x, 1.0, false)];
        break;
      }
      case "stroll":
        queue = [...standFirst(), () => this.walkTo(this.strollTarget(), 0.45, true)];
        break;
      case "spin":
        queue = [...standFirst(), () => this.spin()];
        break;
      case "wave":
        queue = [...standFirst(), () => this.wave()];
        break;
      case "sit":
        queue = this.seated
          ? [() => this.sitting(6, "tired"), () => this.standUp()]
          : [() => this.sitDown(), () => this.sitting(6, "tired"), () => this.standUp()];
        break;
      case "exercise":
        queue = [
          ...standFirst(), () => this.jacks(), () => this.pant(),
          () => this.sitDown(), () => this.sitting(3.5, "tired"), () => this.standUp(),
        ];
        break;
      case "eat":
        queue = [...standFirst(), () => this.eat()];
        break;
      case "nap":
        queue = [...(this.seated ? [] : [() => this.sitDown()]), () => this.nap(), () => this.standUp()];
        break;
      case "poke":
        queue = [() => this.giggle()];
        break;
    }
    return queue;
  }

  /**
   * Puts on a new colour theme with one of the four scenes: a random one
   * (never the same twice in a row) unless `style` names one.
   */
  applyTheme(name: ThemeName, style?: ChangeStyle): ChangeStyle {
    const others = CHANGE_STYLES.filter((c) => c !== this.lastChange);
    const pick = style ?? others[Math.floor(Math.random() * others.length)];
    this.lastChange = pick;
    const scene = () =>
      pick === "paint" ? this.paintScene(name)
      : pick === "twirl" ? this.twirlScene(name)
      : pick === "trunk" ? this.trunkScene(name)
      : this.wardrobeScene(name);
    // The trunk scene needs the room either side of the middle: walk back there first.
    const homeFirst = pick === "trunk" && Math.abs(this.root.position.x) > 0.3 ? [() => this.walkTo(0, 0.8, false)] : [];
    this.begin([...(this.seated ? [() => this.standUp()] : []), ...homeFirst, scene]);
    return pick;
  }

  /** Back to the middle of his spot after a stroll took him off to one side. */
  walkHome(): void {
    this.begin([...(this.seated ? [() => this.standUp()] : []), () => this.walkTo(0, 0.6, false)]);
  }

  /** A click on the character: pops the nap bubble, or giggles. */
  tap(): void {
    if (this.action?.name === "nap") this.popRequested = true;
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

    // A "hey!" wiggle on top of anything.
    if (this.wiggleT < 0.45) {
      this.wiggleT += dt;
      const k = this.wiggleT / 0.45;
      P.headRz += Math.sin(k * Math.PI * 4) * 0.12 * (1 - k);
      P.hipsRz += Math.sin(k * Math.PI * 4) * 0.05 * (1 - k);
    }

    // Arms flap up a little while falling, and get pushed down while rising.
    const flap = clamp(this.vel.y, -2.5, 2.5) * 0.1;
    P.armLz += flap;
    P.armRz -= flap;

    this.follow(dt);
    this.applyPose();
    this.action?.after?.(this.action.t);
    if (this.paintFrom) {
      this.hips.updateWorldMatrix(true, false);
      paintShared.uPaintCenter.value.copy(this.paintFrom).applyMatrix4(this.hips.matrixWorld);
    }

    const face = { ...expression(this.expr), ...this.faceMods };
    if (this.faceMods.lookX === undefined) face.lookX = this.glanceLook().x;
    if (this.faceMods.lookY === undefined) face.lookY = this.glanceLook().y;
    this.face.update(dt, face);

    this.motion(dt);
    this.updateParticles(dt);
  }

  /** Every joint chases its target on a spring. */
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
    this.nextAuto = 4 + Math.random() * 6;
    const hour = new Date().getHours();
    const choices: [ActionName, number][] = [
      ["stroll", 4], ["wave", 1], ["spin", 1], ["sit", 1.2], ["exercise", 0.7],
      ["eat", hour >= 12 && hour <= 14 ? 2 : 0.6], ["nap", this.naps ? 0.6 : 0],
    ];
    let r = Math.random() * choices.reduce((a, [, w]) => a + w, 0);
    for (const [name, w] of choices) {
      if ((r -= w) <= 0) return this.play(name);
    }
  }

  /** Breathing, looking around and following the pointer; under every behaviour. */
  private idleLayer(dt: number): void {
    const P = this.target;
    const t = this.clock;
    P.squash = 1 + Math.sin(t * 1.8) * 0.012;
    P.armLz += Math.sin(t * 1.8 + 0.6) * 0.025;
    P.armRz -= Math.sin(t * 1.8 + 0.6) * 0.025;

    this.glance.next -= dt;
    if (this.glance.next <= 0) {
      this.glance.next = 1.8 + Math.random() * 3.5;
      const away = Math.random() < 0.35;
      this.glance.yaw = away ? (Math.random() * 2 - 1) * 0.35 : 0;
      this.glance.pitch = away ? (Math.random() * 2 - 1) * 0.12 : 0;
    }
    const g = this.gazeActive() ? { yaw: this.gaze.x * 0.45, pitch: -this.gaze.y * 0.25 } : this.glance;
    P.headRy = g.yaw;
    P.headRx = g.pitch;
    P.headRz = -g.yaw * 0.15;
  }

  private gazeActive(): boolean {
    return this.clock - this.gaze.at < 2.5;
  }

  private glanceLook(): { x: number; y: number } {
    if (this.gazeActive()) return { x: this.gaze.x, y: this.gaze.y };
    return { x: this.glance.yaw * 1.6, y: -this.glance.pitch * 3 };
  }

  private applyPose(): void {
    const p = this.pose;
    // Stretch a little while moving up, squash while coming down.
    const s = p.squash * (1 + clamp(this.vel.y * 0.05, -0.07, 0.09));
    // Squashing shortens the legs too, so drop the hips to keep the feet down.
    this.hips.position.y = p.hipsY - LEG_REACH * (1 - s);
    this.hips.rotation.set(p.hipsRx, 0, p.hipsRz);
    this.hips.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    this.root.rotation.y = p.yaw;
    this.neck.rotation.set(p.headRx, p.headRy, p.headRz);
    this.shoulders[0].rotation.set(p.armLx, 0, p.armLz);
    this.shoulders[1].rotation.set(p.armRx, 0, p.armRz);
    this.legs[0].rotation.set(p.legLx, 0, p.legLz);
    this.legs[1].rotation.set(p.legRx, 0, p.legRz);
    for (const l of this.legs) l.position.z = p.legZ;

    const lift = clamp((p.hipsY - HIP) / 0.5, 0, 1);
    this.shadow.scale.setScalar(1 - lift * 0.45);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 1 - lift * 0.6;
  }

  /** Ears and curl lag behind the movement and wobble back. */
  private motion(dt: number): void {
    if (dt <= 0) return;
    const x = this.root.position.x;
    const y = this.hips.position.y;
    const k = 1 - Math.exp(-dt * 10);
    this.vel.x += ((x - this.lastX) / dt - this.vel.x) * k;
    this.vel.y += ((y - this.lastHipY) / dt - this.vel.y) * k;
    this.lastX = x;
    this.lastHipY = y;

    // How fast the head is turning and tipping.
    const turn = (this.pose.headRy + this.pose.yaw - this.lastHead.x) / dt;
    const tip = (this.pose.headRz + this.pose.hipsRz - this.lastHead.y) / dt;
    this.lastHead.set(this.pose.headRy + this.pose.yaw, this.pose.headRz + this.pose.hipsRz);

    const drive = clamp(this.vel.y * 0.35 - this.vel.x * 0.2 - tip * 0.08, -0.9, 0.9);
    this.tuft.rotation.z = this.tuftWobble.step(drive, dt);
    this.tuft.rotation.x = -clamp(turn * 0.03, -0.3, 0.3);
    this.ears.forEach((ear, i) => {
      const side = i === 0 ? -1 : 1;
      const w = this.earWobble[i].step(clamp(-this.vel.y * 0.3 * side - tip * 0.06, -0.6, 0.6), dt);
      ear.rotation.z = -side * 0.55 + w;
    });
  }

  // ── Particles ───────────────────────────────────────────────────────────────

  /** A puff of little balls from `at`: every which way, or mostly along `toward` if given. */
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

  /** Shoulder angles that point the right arm at a world position. */
  private aimRightArm(at: THREE.Vector3): { x: number; z: number } {
    return this.aimArm(1, at);
  }

  /** Shoulder angles that point an arm (0 left, 1 right) at a world position. */
  private aimArm(side: number, at: THREE.Vector3): { x: number; z: number } {
    const d = this.hips.worldToLocal(at.clone()).sub(this.shoulders[side].position).normalize();
    // The arm hangs along -y; Rx(a)·Rz(z) takes it to (sin z, -cos z cos a, -cos z sin a).
    const z = Math.asin(clamp(d.x, -1, 1));
    const x = Math.atan2(-d.z, -d.y);
    return { x, z };
  }

  /**
   * After spinning, a whole number of turns is the same as none: take them off
   * the pose and this frame's target alike, so he doesn't spin back.
   */
  private unwind(): void {
    const turns = Math.PI * 2 * Math.round(this.pose.yaw / (Math.PI * 2));
    this.pose.yaw -= turns;
    this.target.yaw -= turns;
  }

  /** Turns to face `angle` (0 is towards you) the short way round. */
  private turnTo(angle: number): void {
    const d = angle - this.pose.yaw;
    this.target.yaw = this.pose.yaw + Math.atan2(Math.sin(d), Math.cos(d));
  }

  /** Legs, arms and bob for walking, at `phase` through the stride. */
  private gait(phase: number): void {
    const P = this.target;
    const s = Math.sin(phase);
    P.legLx = s * 0.6;
    P.legRx = -s * 0.6;
    P.armLx = -s * 0.5;
    P.armRx = s * 0.5;
    P.hipsY += Math.abs(Math.cos(phase)) * 0.055 - 0.02;
    P.hipsRz = s * 0.08;
    P.headRz = -s * 0.05;
  }

  // ── Behaviour library ───────────────────────────────────────────────────────

  private walkTo(x: number, speed: number, stroll: boolean): Running {
    let phase = 0;
    let arrived = false;
    let after = 0;
    let pause = stroll ? 0 : -1;
    const startX = this.root.position.x;
    const pauseAt = (startX + x) / 2;
    return {
      name: stroll ? "stroll" : "walk",
      t: 0,
      step: (t, dt) => {
        const P = this.target;
        this.expr = "happy";
        const dx = x - this.root.position.x;
        const dir = Math.sign(x - startX) || 1;
        if (arrived) {
          after += dt;
          return after < 0.5;
        }
        // A stroll stops halfway to look around.
        if (pause >= 0 && Math.sign(pauseAt - this.root.position.x) !== dir) {
          pause += dt;
          P.yaw = dir * 0.35;
          P.headRy = kf(pause, [[0, 0], [0.4, -0.5], [1.1, -0.5], [1.5, 0.45], [2.2, 0.45], [2.6, 0]]);
          P.headRx = -0.08;
          this.expr = pause > 0.4 && pause < 2.2 ? "ooh" : "happy";
          if (pause > 2.6) pause = -1;
          return true;
        }
        P.yaw = dir * 1.05;
        this.rate = 16;
        this.bounce = 0.8;
        if (t > 0.25) {
          const move = Math.min(Math.abs(dx), speed * dt);
          this.root.position.x += dir * move;
          phase += dt * speed * 7.5;
        }
        this.gait(phase);
        P.headRy = -dir * 0.35; // keeps looking a little towards you
        if (Math.abs(dx) < 0.005) arrived = true;
        return true;
      },
    };
  }

  private spin(): Running {
    return {
      name: "spin",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 24;
        this.bounce = 0.6;
        P.hipsY = kf(t, [[0, HIP], [0.18, HIP - 0.05], [0.32, HIP + 0.2], [0.62, HIP + 0.44], [0.95, HIP + 0.2], [1.08, HIP], [1.22, HIP - 0.03], [1.45, HIP]]);
        P.squash = kf(t, [[0, 1], [0.18, 0.86], [0.32, 1.1], [0.95, 1.04], [1.08, 0.84], [1.3, 1.04], [1.5, 1]]);
        P.yaw = kf(t, [[0.25, 0], [1.02, Math.PI * 2]]);
        P.armLz = kf(t, [[0.2, REST.armLz], [0.4, -1.45], [0.95, -1.45], [1.25, REST.armLz]]);
        P.armRz = -P.armLz;
        P.legLx = P.legRx = kf(t, [[0.3, 0], [0.6, -0.3], [1.0, 0]]);
        this.expr = t < 0.25 ? "happy" : "joy";
        return t < 1.55;
      },
      end: () => this.unwind(),
    };
  }

  private wave(): Running {
    return {
      name: "wave",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 16;
        this.bounce = 0.55;
        const up = kf(t, [[0, 0], [0.3, 1], [2.1, 1], [2.45, 0]]);
        P.armRz = lerp(REST.armRz, 2.55, up) + (t > 0.35 && t < 2.1 ? Math.sin((t - 0.35) * 13) * 0.32 : 0);
        P.armRx = -0.25 * up;
        P.headRz = 0.12 * up;
        P.hipsRz = 0.04 * up;
        P.headRy = 0;
        this.expr = t < 0.25 ? "happy" : "joy";
        return t < 2.6;
      },
    };
  }

  private giggle(): Running {
    return {
      name: "poke",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 26;
        this.bounce = 0.45;
        if (this.seated) blendInto(P, SEATED, 1);
        P.squash = kf(t, [[0, 1], [0.08, 0.84], [0.26, 1.12], [0.44, 0.95], [0.62, 1.03], [0.85, 1]]);
        if (!this.seated) P.hipsY = kf(t, [[0, HIP], [0.12, HIP], [0.28, HIP + 0.12], [0.45, HIP]]);
        P.headRz = Math.sin(t * 22) * 0.08 * (1 - t);
        P.armLz += -0.5 * Math.sin(Math.min(t / 0.85, 1) * Math.PI);
        P.armRz += 0.5 * Math.sin(Math.min(t / 0.85, 1) * Math.PI);
        P.headRy = 0;
        this.expr = "joy";
        return t < 0.95;
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
        this.expr = "tired";
        // A sigh, then a plop.
        P.squash = kf(t, [[0, 1], [0.4, 1.05], [0.8, 0.96], [1.15, 0.88], [1.35, 1.03], [1.55, 1]]);
        blendInto(P, SEATED, kf(t, [[0.8, 0], [1.15, 1]]));
        P.headRy = 0;
        if (t >= 1.55) this.seated = true;
        return t < 1.55;
      },
    };
  }

  private sitting(seconds: number, mood: Expression, name = "seated"): Running {
    return {
      name,
      t: 0,
      step: (t) => {
        const P = this.target;
        blendInto(P, SEATED, 1);
        P.squash = 1 + Math.sin(t * 1.4) * 0.02;
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
        blendInto(P, SEATED, kf(t, [[0, 1], [0.6, 0]]));
        P.hipsRx += kf(t, [[0, 0], [0.25, 0.22], [0.6, 0]]);
        P.squash = kf(t, [[0.5, 1], [0.62, 0.92], [0.8, 1]]);
        return t < 0.85;
      },
    };
  }

  private jacks(): Running {
    const rep = 0.6;
    const reps = 6;
    return {
      name: "exercise",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 24;
        this.bounce = 0.7;
        this.expr = "determined";
        const u = (t % rep) / rep;
        const open = Math.sin(u * Math.PI);
        P.armLz = lerp(REST.armLz, -2.7, open);
        P.armRz = -P.armLz;
        P.legLz = -0.3 * open;
        P.legRz = 0.3 * open;
        P.hipsY = HIP + 0.15 * Math.abs(Math.sin(u * Math.PI * 2));
        P.squash = 1 - 0.06 * Math.cos(u * Math.PI * 4);
        P.headRy = 0;
        return t < rep * reps;
      },
    };
  }

  private pant(): Running {
    return {
      name: "exercise",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.expr = "tired";
        this.faceMods.mouthOpen = 0.35 + Math.sin(t * 11) * 0.22;
        P.squash = 1 + Math.sin(t * 11) * 0.025;
        P.hipsRx = 0.12;
        P.headRy = 0;
        // A sweat drop slides down the side of the hood.
        const s = clamp(t / 2.2, 0, 1);
        const x = 0.5 - s * 0.04;
        const y = 0.24 - s * 0.24;
        const z = HEAD.z * Math.sqrt(Math.max(0, 1 - (x / HEAD.x) ** 2 - (y / HEAD.y) ** 2)) + 0.03;
        this.sweat.visible = true;
        this.sweat.position.set(x, y, z);
        const fade = 1 - smooth(clamp((s - 0.7) / 0.3, 0, 1));
        this.sweat.scale.set(0.03 * fade, 0.045 * fade, 0.03 * fade);
        return t < 2.2;
      },
      end: () => {
        this.sweat.visible = false;
      },
    };
  }

  private eat(): Running {
    const intro = 0.9;
    const bite = 1.15;
    const bites = 3;
    const outro = 2.4;
    const sizes = [1, 0.72, 0.45, 0];
    const HOLD = { x: -1.25, z: -0.3 };
    let bitten = 0;
    const tmp = new THREE.Vector3();
    return {
      name: "eat",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 14;
        this.snack.visible = bitten < bites;
        P.armRx = HOLD.x;
        P.armRz = HOLD.z;
        P.headRx = 0.16;
        P.headRy = 0.18;

        if (t < intro) {
          this.snack.scale.setScalar(kf(t, [[0, 0.01], [0.3, 1.2], [0.5, 1]]));
          this.expr = "ooh";
        } else if (t < intro + bite * bites) {
          const i = Math.floor((t - intro) / bite);
          const v = t - intro - i * bite;
          const raise = kf(v, [[0, 0], [0.3, 1], [0.42, 1], [0.7, 0]]);
          // Lean in and point the cookie at the mouth.
          P.hipsRx = 0.14 * raise;
          P.headRx = lerp(0.16, 0.2, raise);
          P.headRy = lerp(0.18, 0.05, raise);
          const aim = this.aimRightArm(this.face.group.localToWorld(this.face.mouth().add(new THREE.Vector3(0, 0, 0.12))));
          P.armRx = lerp(HOLD.x, aim.x, raise);
          P.armRz = lerp(HOLD.z, aim.z, raise);
          if (v < 0.42) {
            this.expr = "ooh";
            this.faceMods.mouthOpen = kf(v, [[0, 0.2], [0.28, 0.85], [0.36, 0]]);
          } else {
            this.expr = "chew";
            this.faceMods.mouthCurve = 0.4 + Math.sin(v * 24) * 0.4;
            P.headRz = Math.sin(v * 12) * 0.04;
            P.squash = 1 + Math.sin(v * 24) * 0.01;
          }
          if (v >= 0.36 && bitten <= i) {
            bitten = i + 1;
            this.snack.scale.setScalar(Math.max(0.01, sizes[bitten]));
            this.burst(this.snack.getWorldPosition(tmp), 8, "#cf8f4e", 0.02, 1.1, 5);
          }
        } else {
          // Done: a happy pat on the belly.
          const v = t - intro - bite * bites;
          P.armRx = kf(v, [[0, HOLD.x], [0.4, 0]]);
          P.armRz = kf(v, [[0, HOLD.z], [0.4, REST.armRz]]);
          const pat = kf(v, [[0, 0], [0.35, 1], [2.0, 1], [2.35, 0]]);
          P.armLx = -0.95 * pat + Math.sin(v * 14) * 0.14 * pat;
          P.armLz = lerp(REST.armLz, 0.8, pat);
          P.headRx = -0.05;
          P.headRy = 0;
          this.expr = "love";
          return v < outro;
        }
        return true;
      },
      end: () => {
        this.snack.visible = false;
        this.snack.scale.setScalar(1);
      },
    };
  }

  /** `forever`: the bubble keeps breathing until something wakes him (no pop of its own). */
  private nap(forever = false): Running {
    const breath = 1.9; // rad/s, one breath about every 3.3 s
    let popped = -1;
    const tmp = new THREE.Vector3();
    this.popRequested = false;
    return {
      name: "nap",
      t: 0,
      step: (t) => {
        const P = this.target;
        blendInto(P, SEATED, 1);
        this.rate = 6;
        this.bounce = 0.9;

        if (popped < 0) {
          const drowsy = clamp(t / 2.2, 0, 1);
          this.expr = t < 2.2 ? "sleepy" : "asleep";
          const b = Math.sin(t * breath);
          P.squash = 1 + b * 0.028;
          P.headRx = 0.14 + 0.2 * drowsy + b * 0.02;
          P.headRz = 0.14 * drowsy;
          P.headRy = 0;
          P.hipsRx = -0.24 + 0.1 * drowsy;

          // The bubble swells as he breathes out and grows a little every breath.
          if (t > 2.6) {
            const grow = clamp((t - 2.6) / 10, 0, 1);
            const r = (0.015 + grow * 0.12) * (0.7 + 0.3 * (b * 0.5 + 0.5));
            this.bubble.visible = true;
            this.bubble.scale.setScalar(r);
            const nose = this.face.nose();
            this.bubble.position.set(nose.x + r * 0.45, nose.y - r * 0.2, nose.z + r * 0.85);
            const ripe = !forever && grow >= 1 && b > 0.97;
            if (this.popRequested || ripe) {
              popped = t;
              this.bubble.visible = false;
              this.burst(this.bubble.getWorldPosition(tmp), 12, "#cfeaff", 0.012, 1.6, 2.5);
            }
          } else if (this.popRequested) {
            popped = t;
          }
          return true;
        }

        // Woken by the pop: a start, a couple of blinks, a sheepish look around.
        const v = t - popped;
        this.rate = 22;
        this.bounce = 0.5;
        P.hipsY += kf(v, [[0, 0], [0.12, 0.2], [0.4, 0]]);
        P.squash = kf(v, [[0, 1], [0.1, 1.1], [0.4, 0.92], [0.6, 1]]);
        P.armLz += kf(v, [[0, 0], [0.12, -0.55], [0.6, 0]]);
        P.armRz += kf(v, [[0, 0], [0.12, 0.55], [0.6, 0]]);
        P.headRy = kf(v, [[0.8, 0], [1.1, -0.4], [1.5, -0.4], [1.8, 0.4], [2.2, 0.4], [2.5, 0]]);
        P.headRx = kf(v, [[0, 0.34], [0.15, -0.1], [0.6, 0.14]]);
        if (v < 0.9) this.expr = "surprised";
        else {
          this.expr = "happy";
          if (v < 1.0) this.face.blink();
        }
        return v < 2.7;
      },
      end: () => {
        this.bubble.visible = false;
        this.popRequested = false;
      },
    };
  }

  // ── Changing colour ─────────────────────────────────────────────────────────

  /** Walks a step towards `goal` on the floor; true once there. */
  private stepToward(goal: THREE.Vector3, speed: number, dt: number, stride: { phase: number }): boolean {
    const pos = this.root.position;
    const dx = goal.x - pos.x;
    const dz = goal.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.005) return true;
    const move = Math.min(dist, speed * dt);
    pos.x += (dx / dist) * move;
    pos.z += (dz / dist) * move;
    stride.phase += dt * speed * 7.5;
    this.turnTo(Math.atan2(dx, dz));
    this.rate = 16;
    this.bounce = 0.8;
    this.gait(stride.phase);
    return false;
  }

  /** Out come a palette and brush, and he paints the new colour on, stroke by stroke. */
  private paintScene(name: ThemeName): Running {
    startTheme(name);
    const color = incomingColor();
    const pal = palette();
    const br = brush(color);
    paint(pal, this.look);
    paint(br, this.look);
    pal.position.set(0, -0.1, 0.1);
    br.position.set(0, -0.02, 0.02);
    pal.scale.setScalar(0.01);
    br.scale.setScalar(0.01);
    this.handL.add(pal);
    this.hand.add(br);
    // The paint spreads from his tummy.
    this.paintFrom = new THREE.Vector3(0.08, 0.42, 0.5);

    const DAB = 0.8;
    const STROKE = 0.8;
    // Spots on his front to brush over, in hips units, and how far the paint reaches after each.
    const spots: [number, number, number][] = [[0.15, 0.42, 0.55], [-0.15, 0.6, 0.5], [0.22, 0.2, 0.5], [-0.05, 0.75, 0.45]];
    const reach = [0.6, 1.05, 1.55, 2.4];
    const painted = DAB + spots.length * STROKE;
    let done = false;
    let flecked = -1;
    const tmp = new THREE.Vector3();
    return {
      name: "paint",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 16;
        this.bounce = 0.6;
        const show = kf(t, [[0, 0.01], [0.3, 1.15], [0.45, 1], [painted + 0.1, 1], [painted + 0.4, 0.01]]);
        pal.scale.setScalar(show);
        br.scale.setScalar(show);
        // The palette is held out on his left, flat towards you.
        const hold = kf(t, [[0, 0], [0.3, 1], [painted + 0.1, 1], [painted + 0.45, 0]]);
        P.armLx = lerp(P.armLx, -1.2, hold);
        P.armLz = lerp(P.armLz, 0.1, hold);
        P.headRy = 0;

        if (t < DAB) {
          // Load the brush: two dips into the palette.
          const dip = Math.abs(Math.sin((t / DAB) * Math.PI * 2));
          const aim = this.aimRightArm(pal.getWorldPosition(tmp));
          const k = kf(t, [[0, 0], [0.3, 1]]) * (0.8 + 0.2 * dip);
          P.armRx = lerp(P.armRx, aim.x, k);
          P.armRz = lerp(P.armRz, aim.z, k);
          P.headRx = 0.18;
          P.headRy = -0.15;
          this.expr = "ooh";
        } else if (t < painted) {
          const i = Math.floor((t - DAB) / STROKE);
          const v = (t - DAB - i * STROKE) / STROKE;
          const [x, y, z] = spots[i];
          // Brush back and forth over the spot.
          const sweep = Math.sin(v * Math.PI * 2) * 0.18;
          tmp.set(x + sweep, y + Math.cos(v * Math.PI * 2) * 0.08, z + 0.35);
          const aim = this.aimRightArm(this.hips.localToWorld(tmp));
          P.armRx = aim.x;
          P.armRz = aim.z;
          paintShared.uPaintRadius.value = lerp(i === 0 ? 0 : reach[i - 1], reach[i], smooth(clamp(v * 1.3, 0, 1)));
          P.headRx = 0.24;
          P.headRy = -0.1 + sweep * 0.5;
          P.hipsRz = Math.sin(t * 7) * 0.05;
          this.expr = i % 2 ? "joy" : "happy";
          if (flecked < i && v > 0.4) {
            flecked = i;
            this.burst(br.getWorldPosition(tmp), 5, color, 0.018, 0.9, 4);
          }
        } else {
          if (!done) {
            done = true;
            finishTheme();
            this.paintFrom = null;
          }
          // Admire the new colour: a look down, arms out, a happy hop.
          const v = t - painted;
          P.headRx = kf(v, [[0.3, 0.28], [1.2, 0.28], [1.5, 0]]);
          P.armLz = kf(v, [[0.4, REST.armLz], [0.7, -0.85], [1.6, -0.85], [1.9, REST.armLz]]);
          P.armRz = -P.armLz;
          P.hipsY = kf(v, [[1.2, HIP], [1.4, HIP + 0.15], [1.6, HIP]]);
          this.expr = v < 1.2 ? "ooh" : "love";
          return v < 2.2;
        }
        return true;
      },
      end: () => {
        dispose(pal);
        dispose(br);
        if (!done) finishTheme();
        this.paintFrom = null;
      },
    };
  }

  /** A quick twirl on the spot; the new colour sweeps over him mid-spin. */
  private twirlScene(name: ThemeName): Running {
    startTheme(name);
    const color = incomingColor();
    this.paintFrom = new THREE.Vector3(0, 0.5, 0);
    const turns = 3;
    let done = false;
    let sparkles = 0;
    const tmp = new THREE.Vector3();
    return {
      name: "twirl",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 30;
        this.bounce = 0.55;
        P.headRy = 0;
        P.headRx = 0;
        P.hipsY = kf(t, [[0, HIP], [0.22, HIP - 0.06], [0.38, HIP + 0.22], [0.8, HIP + 0.36], [1.2, HIP + 0.22], [1.34, HIP], [1.46, HIP - 0.04], [1.65, HIP]]);
        P.squash = kf(t, [[0, 1], [0.22, 0.82], [0.38, 1.12], [1.2, 1.05], [1.34, 0.8], [1.55, 1.05], [1.75, 1]]);
        P.yaw = kf(t, [[0.3, 0], [1.25, Math.PI * 2 * turns]]);
        const out = kf(t, [[0.25, 0], [0.4, 1], [1.2, 1], [1.4, 0]]);
        P.armLz = lerp(REST.armLz, -1.5, out);
        P.armRz = -P.armLz;
        P.legLx = P.legRx = -0.35 * out;
        // Ta-da: both arms up after landing.
        const tada = kf(t, [[1.45, 0], [1.65, 1], [2.3, 1], [2.55, 0]]);
        P.armLz = lerp(P.armLz, -2.4, tada);
        P.armRz = lerp(P.armRz, 2.4, tada);

        paintShared.uPaintRadius.value = kf(t, [[0.45, 0], [1.1, 2.2]]);
        tmp.set(this.root.position.x, 1.1, this.root.position.z);
        if (sparkles === 0 && t > 0.6) {
          sparkles = 1;
          this.burst(tmp, 16, color, 0.025, 2.6, 1.5);
        }
        if (sparkles === 1 && t > 1.0) {
          sparkles = 2;
          this.burst(tmp.setY(1.7), 14, "#ffffff", 0.02, 2.2, 1.5);
        }
        if (!done && t > 1.15) {
          done = true;
          finishTheme();
          this.paintFrom = null;
        }
        this.expr = t < 0.3 ? "determined" : "joy";
        return t < 2.7;
      },
      end: () => {
        this.unwind();
        if (!done) finishTheme();
        this.paintFrom = null;
      },
    };
  }

  /**
   * A wardrobe pops up right behind him; he turns round, walks straight in,
   * it rattles, and out he comes in the new colour. Then a mirror appears
   * and he admires himself.
   */
  private wardrobeScene(name: ThemeName): Running {
    const x0 = this.root.position.x;
    const wd = theWardrobe();
    paint(wd.group, this.look);
    // Far enough back that the doors swing open clear of him (they're 0.95 wide).
    const wz = -2.18;
    wd.group.position.set(x0, 0, wz);
    wd.group.scale.setScalar(0.01);
    this.world.add(wd.group);
    // The mirror goes on whichever side has room.
    const mirrorSide = x0 - 1.35 >= -this.bounds - 0.4 ? -1 : 1;
    const mr = theMirror();
    paint(mr, this.look);
    mr.position.set(x0 + mirrorSide * 1.35, 0, -0.35);
    mr.rotation.y = -mirrorSide * 0.55;
    mr.scale.setScalar(0.01);
    this.world.add(mr);

    const inside = new THREE.Vector3(x0, 0, wz - 0.05);
    const home = new THREE.Vector3(x0, 0, 0);
    const color = themeColors(name).body;
    const T = { turn: 0.35, open: 0.6, walkIn: 1.15, close: 3.4, shake: 3.9, reopen: 5.4, out: 5.7, mirror: 7.0, gone: 7.8, done: 10.6 };
    const stride = { phase: 0 };
    let swapped = false;
    let puffs = 0;
    const tmp = new THREE.Vector3();
    return {
      name: "wardrobe",
      t: 0,
      step: (t, dt) => {
        const P = this.target;
        this.wide = 1;

        // The wardrobe pops in, opens, rattles while he changes, and pops away (doors open, clear of him).
        wd.group.scale.setScalar(kf(t, [[0, 0.01], [0.35, 1.08], [0.5, 1], [T.gone, 1], [T.gone + 0.15, 1.08], [T.gone + 0.45, 0.01]]));
        const open = kf(t, [
          [T.open, 0], [T.open + 0.5, 1], [T.close, 1], [T.close + 0.4, 0],
          [T.reopen, 0], [T.reopen + 0.2, 1.12], [T.reopen + 0.4, 1],
        ]);
        wd.doors[0].rotation.y = -1.9 * open;
        wd.doors[1].rotation.y = 1.9 * open;
        // Rattles in place: a wobble and a squash, never lifting off the floor.
        const rattling = t > T.shake && t < T.reopen;
        wd.group.rotation.z = rattling ? Math.sin(t * 38) * 0.03 : 0;
        if (rattling) wd.group.scale.y *= 1 + Math.sin(t * 27) * 0.018;
        if (rattling && puffs < 3 && t > T.shake + 0.3 + puffs * 0.45) {
          puffs++;
          tmp.set(x0 + (Math.random() - 0.5) * 0.8, 3.0, wz);
          this.burst(tmp, 8, puffs === 2 ? color : "#ffffff", 0.05, 1.8, 2);
        }
        if (!swapped && t > T.shake + 0.7) {
          swapped = true;
          setTheme(name);
        }
        mr.scale.setScalar(kf(t, [[T.mirror, 0.01], [T.mirror + 0.3, 1.08], [T.mirror + 0.45, 1], [T.done - 0.6, 1], [T.done - 0.3, 0.01]]));

        if (t < T.walkIn) {
          // Something popped up behind him: a look, then he turns round.
          this.turnTo(t < T.turn ? 0 : Math.PI);
          P.headRy = t < T.turn ? 0.4 : 0;
          this.expr = t < T.open ? "ooh" : "happy";
        } else if (t < T.out) {
          // Straight in, turn round, and wait while it rattles.
          if (this.stepToward(inside, 1.2, dt, stride)) {
            this.turnTo(0);
            this.expr = t < T.shake ? "happy" : "determined";
          } else this.expr = "happy";
        } else if (!this.stepToward(home, 1.2, dt, stride)) {
          this.expr = "joy";
        } else if (t < T.done - 0.9) {
          // Admire the new look in the mirror: head tilts, then a happy hop.
          const v = t - T.out;
          this.turnTo(mirrorSide * 1.0);
          P.headRy = mirrorSide * 0.25;
          P.headRz = Math.sin(v * 3.2) * 0.16;
          P.hipsY = kf(t, [[T.done - 1.8, HIP], [T.done - 1.6, HIP + 0.16], [T.done - 1.4, HIP]]);
          this.expr = t < T.done - 1.8 ? "love" : "joy";
        } else {
          // And back to you, pleased.
          this.turnTo(0);
          P.headRy = 0;
          P.armRz = kf(t, [[T.done - 0.9, REST.armRz], [T.done - 0.6, 2.3], [T.done - 0.2, 2.3], [T.done, REST.armRz]]);
          this.expr = "joy";
        }
        return t < T.done;
      },
      end: () => {
        // Kept for next time.
        wd.group.removeFromParent();
        mr.removeFromParent();
        if (!swapped) setTheme(name);
        this.wide = 0;
        this.unwind();
        // Interrupted part-way? Back where he started.
        this.root.position.z = 0;
      },
    };
  }

  /**
   * A spooky (but friendly) mimic trunk pops up behind him. Its lid creaks
   * open, ghostly hands reach out and grab him; he digs his heels in, gets
   * pulled off his feet, claws at the floor on his tummy as he's dragged back,
   * hangs on to the rim by his mittens, and is finally stuffed inside. It
   * rattles and puffs while he changes, then throws him back out in the new
   * colour: a bump, a puzzled look, and then he's delighted.
   */
  private trunkScene(name: ThemeName): Running {
    const x0 = this.root.position.x;
    const home = new THREE.Vector3(x0, 0, 0);
    // Behind him and off to one side (whichever has more room), turned a little towards him.
    const s = x0 > 0.05 ? -1 : x0 < -0.05 ? 1 : Math.random() < 0.5 ? -1 : 1;
    const tr = theTrunk();
    paint(tr.group, this.look);
    tr.group.position.set(x0 + s * 1.4, 0, -2.0);
    tr.group.rotation.set(0, -s * 0.4, 0);
    tr.group.scale.setScalar(0.01);
    tr.body.position.set(0, 0, 0);
    tr.body.rotation.set(0, 0, 0);
    tr.body.scale.setScalar(1);
    tr.lid.rotation.x = 0;
    tr.eyes.visible = false;
    tr.beamLight.value = 0;
    tr.auraLight.value = 0;
    this.world.add(tr.group);
    const gh = theGhosts();
    paint(gh.group, this.look);
    for (const h of gh.hands) h.root.visible = h.arm.visible = false;
    this.world.add(gh.group);
    const q = theQuestion();
    q.visible = false;
    this.world.add(q);
    magicShared.uFade.value = 1;

    // Spots in the trunk's own frame (at full size), in world units.
    const place = new THREE.Matrix4().compose(
      tr.group.position, new THREE.Quaternion().setFromEuler(tr.group.rotation), new THREE.Vector3(1, 1, 1),
    );
    const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(place);
    const H = tr.rim;
    /** Just in front of the trunk, on his side: where his feet end up. */
    const edge = at(-s * 0.3, 0, 0.78);
    const toEdge = edge.clone().sub(home).setY(0).normalize();
    /**
     * Lying on his tummy he faces away from the trunk's side, mostly sideways
     * so you see him side-on (and so he stays clear of the bottom of the corner
     * window), and he's dragged back feet first along his own length.
     */
    const faceYaw = -s * 1.2;
    const face = new THREE.Vector3(Math.sin(faceYaw), 0, Math.cos(faceYaw));
    const toTrunk = face.clone().negate();
    const rightOf = new THREE.Vector3(face.z, 0, -face.x);
    const trunkYaw = tr.group.rotation.y;
    /** How far he's pulled while still on his feet, then where the tummy-drag ends (then he's hauled in). */
    const fallAt = home.clone().addScaledVector(toEdge, 0.4);
    const crawlEnd = fallAt.clone().addScaledVector(toTrunk, 1.0);
    /** Stood inside, hanging on to the front rim; and where he's thrown out from. */
    const rimAt = at(0, 0, -0.04);
    const rimGrip = [at(-0.3, H + 0.04, 0.44), at(0.3, H + 0.04, 0.44)];
    const mouths = [0.42, 0.15, -0.12, 0.25].map((x, k) => at(-s * x, H - 0.03, k === 3 ? 0.25 : 0.02));
    const newColor = themeColors(name).body;

    const T = {
      notice: 0.3, creak: 1.2, open: 1.95, uhoh: 2.15, grab: 2.95, fall: 4.1, down: 4.45,
      lift: 6.6, rim: 7.15, pry: 7.85, squash: 8.05, slam: 8.45, shake: 8.6, swap: 9.3, burst: 10.1,
      land: 10.9, gone: 11.35, over: 12.3, joy: 13.0, done: 13.8,
    };
    /** When each hand sets off, and how long it takes to get to him. */
    const launch = [2.4, 2.55, 2.7, T.rim + 0.15];
    const REACH = 0.55;
    // Pulled back in jerks: a little ground won back now and then.
    const standDrag = (t: number) => kf(t, [[2.95, 0], [3.25, 0.35], [3.6, 0.35], [3.75, 0.25], [3.9, 0.6], [T.fall, 1]]);
    const crawlDrag = (t: number) => kf(t, [
      [T.down, 0], [4.7, 0.2], [5.05, 0.2], [5.2, 0.12], [5.45, 0.12], [5.65, 0.45], [5.95, 0.45], [6.05, 0.4], [6.3, 0.75], [T.lift, 1],
    ]);
    const jerks = [3.0, 3.8, 4.5, 5.55, 6.15];
    // His near side (towards the trunk): 1 is his right (+x) arm.
    const near = s > 0 ? 1 : 0;
    const mittens = [this.handL, this.hand];
    const curves = gh.hands.map(() => new THREE.CubicBezierCurve3(
      new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
    ));
    const away = new THREE.Vector2(face.x, face.z);

    // Scuff marks his mittens and tummy leave on the floor, fading after.
    const marks: THREE.Mesh[] = [];
    const markGeo = new THREE.PlaneGeometry(1, 1);
    markGeo.rotateX(-Math.PI / 2);
    const mark = (c: THREE.Vector3, len: number, wide: number, opacity: number) => {
      if (marks.length > 24) return;
      const m = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: "#3a2b24", transparent: true, opacity, depthWrite: false }));
      m.position.set(c.x, 0.006, c.z);
      m.rotation.y = Math.atan2(toTrunk.x, toTrunk.z);
      m.scale.set(wide, 1, len);
      m.renderOrder = -1;
      m.userData.opacity = opacity;
      this.world.add(m);
      marks.push(m);
    };
    // Mittens dig into the floor; dragged too far, one slips and grabs again further on.
    const plants: (THREE.Vector3 | null)[] = [null, null];
    const reachFrom = [T.down - 0.2, T.down - 0.05];
    let slipped = false;

    // While it's open the room dims a little (lights put back after).
    const lights: [THREE.Light, number][] = [];
    this.world.traverse((o) => {
      if (o instanceof THREE.DirectionalLight) lights.push([o, o.intensity]);
    });
    const room = this.world instanceof THREE.Scene ? this.world : null;
    const env0 = room?.environmentIntensity ?? 1;
    const dim = (k: number) => {
      for (const [l, i] of lights) l.intensity = i * k;
      if (room) room.environmentIntensity = env0 * k;
    };

    let swapped = false;
    let landed = false;
    let puffs = 0;
    let tears = 0;
    let scuffs = 0;
    let wisps = 0;
    let dusty = 0;
    const fx = new Set<string>();
    const once = (key: string, when: boolean) => when && !fx.has(key) && !!fx.add(key);
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    const grip = new THREE.Vector3();
    const grip2 = new THREE.Vector3();
    const toward = new THREE.Vector3();
    const toward2 = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const bx = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    const lastPos = new THREE.Vector3().copy(home);

    /** Tips him over towards (ax, az) on the floor by `amt`, keeping his feet down. */
    const lean = (ax: number, az: number, amt: number) => {
      const y = this.pose.yaw;
      const lx = ax * Math.cos(y) - az * Math.sin(y);
      const lz = ax * Math.sin(y) + az * Math.cos(y);
      this.target.hipsRx += lz * amt;
      this.target.hipsRz -= lx * amt;
      this.target.hipsY -= LEG_REACH * (1 - Math.cos(amt));
    };
    /** Comic terror: huge trembling eyes and a wobbling wail. */
    const panic = (t: number) => {
      this.expr = "panic";
      this.faceMods.eyeScale = 1.72 + Math.sin(t * 53) * 0.07;
      this.faceMods.lookX = Math.sin(t * 41) * 0.14;
      this.faceMods.lookY = 0.1 + Math.sin(t * 37) * 0.1;
      this.faceMods.mouthOpen = 1.1 + Math.sin(t * 17) * 0.25;
      this.faceMods.mouthWidth = 1.75 + Math.sin(t * 11 + 1) * 0.25;
      this.target.headRz += Math.sin(t * 47) * 0.025;
    };
    /** "No no no!": quick shakes of the head. */
    const noNo = (t: number) =>
      Math.sin(t * 19) * 0.32 * Math.max(
        kf(t, [[3.25, 0], [3.35, 1], [3.65, 1], [3.75, 0]]),
        kf(t, [[5.15, 0], [5.25, 1], [5.5, 1], [5.6, 0]]),
        kf(t, [[7.35, 0], [7.45, 1], [7.75, 1], [7.85, 0]]),
      );
    /** Lying flat on his tummy, head up, legs out behind (k: how far down). */
    const prone = (k: number) => {
      const P = this.target;
      P.hipsRx = lerp(P.hipsRx, 1.38, k);
      P.hipsRz = lerp(P.hipsRz, 0, k);
      P.hipsY = lerp(P.hipsY, 0.5, k);
      P.headRx = lerp(P.headRx, -1.35, k);
      // Face turned out towards you, so you see the panic.
      P.headRy = lerp(P.headRy, s * 0.55, k);
      P.headRz = lerp(P.headRz, -s * 0.25, k);
      P.legLz = lerp(P.legLz, -0.14, k);
      P.legRz = lerp(P.legRz, 0.14, k);
    };

    return {
      name: "trunk",
      t: 0,
      step: (t, dt) => {
        const P = this.target;
        this.wide = 1;
        const pos = this.root.position;

        // ── The trunk ──
        tr.group.scale.setScalar(kf(t, [
          [0, 0.01], [0.3, 1.12], [0.45, 0.95], [0.55, 1], [T.gone + 0.25, 1], [T.gone + 0.4, 1.12], [T.gone + 0.65, 0.01],
        ]));
        tr.group.visible = t < T.gone + 0.65;
        const shaking = kf(t, [[T.shake, 0], [T.shake + 0.15, 1], [T.burst - 0.1, 1], [T.burst, 0]]);
        let lid = kf(t, [
          [T.creak, 0], [T.creak + 0.25, 0.22], [T.creak + 0.4, 0.15], [T.creak + 0.55, 0.26], [T.open, 0.24],
          [T.open + 0.16, 2.1], [T.open + 0.32, 1.9], [T.slam - 0.12, 1.9], [T.slam, 0], [T.slam + 0.07, 0.14], [T.slam + 0.14, 0],
          [T.burst, 0], [T.burst + 0.1, 2.25], [T.burst + 0.3, 1.95], [T.gone, 1.95], [T.gone + 0.25, 0],
        ]);
        if (t > T.creak && t < T.open) lid += Math.sin(t * 40) * 0.015;
        lid += Math.max(0, Math.sin(t * 21)) * 0.22 * shaking;
        tr.lid.rotation.x = -lid;
        tr.body.rotation.z = Math.sin(t * 47) * 0.08 * shaking;
        tr.body.rotation.x = Math.sin(t * 31) * 0.04 * shaking;
        tr.body.position.y = Math.abs(Math.sin(t * 19)) * 0.08 * shaking;
        tr.body.scale.set(1 - Math.sin(t * 29) * 0.03 * shaking, 1 + Math.sin(t * 29) * 0.06 * shaking, 1);
        // Two eyes peek out of the dark under the lid: a slow, sly blink, a glance at him.
        const peek = t - T.creak - 0.3;
        tr.eyes.visible = peek > 0 && t < T.open + 0.05;
        tr.eyes.scale.set(1, kf(peek, [[0, 0.2], [0.12, 1], [0.3, 1], [0.45, 0.3], [0.6, 0.3], [0.72, 1]]), 1);
        tr.eyes.position.x = kf(peek, [[0.1, 0], [0.25, -s * 0.05]]);
        tr.beamLight.value = kf(t, [
          [T.open, 0], [T.open + 0.15, 1.3], [T.open + 0.5, 1], [T.slam - 0.1, 1], [T.slam, 0],
          [T.burst, 0], [T.burst + 0.05, 1.6], [T.burst + 0.6, 0.6], [T.gone, 0],
        ]) * (0.9 + 0.1 * Math.sin(t * 13));
        tr.auraLight.value = kf(t, [[0, 0], [0.5, 0.55], [T.creak, 0.55], [T.open + 0.3, 1], [T.gone, 1], [T.gone + 0.5, 0]]);
        // The runes crawl and flicker, wilder when it's up to something.
        magicShared.uTime.value = t;
        magicShared.uPulse.value = shaking > 0 ? 1 : kf(t, [[0, 0.15], [T.creak, 0.15], [T.open, 0.65], [T.burst + 0.5, 0.65], [T.gone, 0.2]]);
        dim(kf(t, [[T.creak, 1], [T.open + 0.3, 0.72], [T.gone, 0.72], [T.gone + 0.5, 1]]));

        if (once("pop", t > 0.15)) this.burst(at(0, 0.5, 0.4), 10, "#5b3a7a", 0.05, 1.6, -0.5);
        if (once("open", t > T.open + 0.05)) {
          this.burst(at(0, H + 0.15, 0.1), 14, "#8d4dff", 0.06, 1.5, -1.2);
          this.burst(at(0, H + 0.15, 0.1), 8, "#9cffd9", 0.035, 2.2, -0.8);
        }
        // Dark wisps curling up off the floor round it.
        if (t > T.open && t < T.gone && t > T.open + wisps * 0.3) {
          wisps++;
          const a = Math.random() * Math.PI * 2;
          this.burst(at(Math.cos(a) * 0.95, 0.05, Math.sin(a) * 0.65), 2, "#3a1f55", 0.07, 0.35, -0.5);
        }
        if (once("slam", t > T.slam)) this.burst(at(0, H + 0.05, 0.5), 12, "#8d4dff", 0.06, 1.8, -0.6);
        // Puffs out of the rattling lid, in the new colour.
        if (shaking > 0.5 && puffs < 5 && t > T.shake + 0.15 + puffs * 0.3) {
          puffs++;
          this.burst(at((Math.random() - 0.5) * 1.0, H + 0.12, 0.35), 10, puffs % 2 ? newColor : "#cdb4ff", 0.09, 1.5, -1.3);
        }
        if (!swapped && t > T.swap) {
          swapped = true;
          setTheme(name);
        }
        if (once("burst", t > T.burst)) {
          this.burst(at(0, H + 0.3, 0.1), 18, newColor, 0.05, 2.8, 1.5);
          this.burst(at(0, H + 0.3, 0.1), 12, "#b98cff", 0.04, 2.4, 1);
        }
        if (once("gone", t > T.gone + 0.5)) this.burst(at(0, 0.5, 0.2), 14, "#5b3a7a", 0.06, 1.6, -0.8);
        const fade = kf(t, [[T.slam, 1], [T.burst, 0]]);
        for (const m of marks) (m.material as THREE.MeshBasicMaterial).opacity = m.userData.opacity * fade;

        // ── Him ──
        this.root.visible = t < T.slam || t > T.burst;
        let sy = 1;
        let sxz = 1;
        const scared = t > T.grab && t < T.slam;
        if (t < T.uhoh) {
          // Something popped up behind him: a start, then a curious look back over his shoulder.
          const look = kf(t, [[0.55, 0], [0.95, 1], [T.open + 0.05, 1], [T.uhoh, 0.6]]);
          P.yaw = s * 0.45 * look;
          P.headRy = s * 0.75 * look;
          P.headRx = -0.08 * look;
          P.hipsY = HIP + kf(t, [[T.notice, 0], [T.notice + 0.1, 0.12], [T.notice + 0.28, 0]]);
          P.armLz += kf(t, [[T.notice, 0], [T.notice + 0.1, -0.5], [T.notice + 0.4, 0]]);
          P.armRz -= kf(t, [[T.notice, 0], [T.notice + 0.1, -0.5], [T.notice + 0.4, 0]]);
          P.hipsRz = -s * 0.06 * look;
          this.expr = t < T.notice ? "neutral" : t < T.notice + 0.35 ? "surprised" : t < T.open ? "ooh" : "surprised";
          this.rate = 14;
        } else if (t < T.fall) {
          // Uh-oh: he turns back to you, the hands get hold, and he digs his heels in.
          const struggle = kf(t, [[T.grab - 0.1, 0], [T.grab + 0.2, 1]]);
          pos.lerpVectors(home, fallAt, standDrag(t));
          P.yaw = lerp(0, faceYaw * 0.4, struggle) + Math.sin(t * 7) * 0.08 * struggle;
          this.rate = 18;
          this.bounce = 0.5;
          lean(away.x, away.y, (0.42 + Math.sin(t * 9) * 0.06) * struggle);
          P.squash = 1 - 0.04 * struggle;
          P.legLz = -0.24 * struggle;
          P.legRz = 0.24 * struggle;
          P.legLx = Math.sin(t * 17) * 0.32 * struggle;
          P.legRx = -Math.sin(t * 17) * 0.32 * struggle;
          const glance = kf(t, [[2.3, 0], [2.45, 1], [2.75, 1], [2.9, 0]]);
          P.headRy = s * 0.7 * glance + noNo(t);
          P.headRz = Math.sin(t * 11) * 0.06 * struggle;
          P.headRx = -0.06;
          // His near arm is held and pulled towards the trunk; the other flails.
          const pull = new THREE.Vector3(pos.x + toTrunk.x * 2, 1.0, pos.z + toTrunk.z * 2);
          const aim = this.aimArm(near, pull);
          const held = kf(t, [[launch[0] + REACH - 0.05, 0], [launch[0] + REACH + 0.15, 1]]);
          const flail = kf(t, [[T.uhoh, 0], [T.uhoh + 0.3, 1]]);
          const swing = Math.sin(t * 15);
          if (near === 1) {
            P.armRx = lerp(P.armRx, aim.x, held) + Math.sin(t * 19) * 0.06 * held;
            P.armRz = lerp(P.armRz, aim.z, held);
            P.armLz = lerp(P.armLz, -1.9 + swing * 0.8, flail);
            P.armLx = lerp(P.armLx, Math.cos(t * 15) * 0.7, flail);
          } else {
            P.armLx = lerp(P.armLx, aim.x, held) + Math.sin(t * 19) * 0.06 * held;
            P.armLz = lerp(P.armLz, aim.z, held);
            P.armRz = lerp(P.armRz, 1.9 - swing * 0.8, flail);
            P.armRx = lerp(P.armRx, Math.cos(t * 15) * 0.7, flail);
          }
          if (t < T.grab) this.expr = "surprised";
          else panic(t);
        } else if (t < T.lift) {
          // Pulled off his feet: down on his tummy, facing away, clawing at the floor.
          const k = kf(t, [[T.fall, 0], [T.fall + 0.28, 1]]);
          if (t < T.down) pos.copy(fallAt);
          else pos.lerpVectors(fallAt, crawlEnd, crawlDrag(t));
          this.rate = 18;
          this.bounce = 0.5;
          P.yaw = faceYaw;
          prone(k);
          if (once("thud", t > T.fall + 0.28)) {
            this.burst(tmp.copy(pos).addScaledVector(face, 0.6).setY(0.05), 10, "#d9cbb8", 0.045, 1.1, 1.5);
          }
          P.squash = kf(t, [[T.fall + 0.25, 1], [T.fall + 0.32, 0.86], [T.fall + 0.48, 1.04], [T.fall + 0.6, 1]]);
          // Kicking against the hands that hold his feet.
          P.legLx = 0.12 + Math.sin(t * 18) * 0.3 * k;
          P.legRx = 0.12 - Math.sin(t * 18) * 0.3 * k;
          P.headRy += noNo(t);
          // Each mitten digs in ahead of him; dragged too far, it slips (a scratch, a puff) and grabs again.
          for (const i of [0, 1]) {
            const side = i === 1 ? 1 : -1;
            const sh = this.shoulders[i].getWorldPosition(tmp2);
            let p = plants[i];
            if (!p && t > T.down - 0.1 && t - reachFrom[i] > 0.2) {
              p = plants[i] = new THREE.Vector3(
                sh.x + face.x * 0.35 + rightOf.x * side * 0.14, 0.03, sh.z + face.z * 0.35 + rightOf.z * side * 0.14,
              );
            }
            const ahead = p ? (p.x - sh.x) * face.x + (p.z - sh.z) * face.z : 0;
            const forced = !slipped && i === near && t > 5.45;
            if (p && (ahead > 0.72 || ahead < 0.05 || forced)) {
              if (forced) slipped = true;
              mark(tmp.copy(p).addScaledVector(toTrunk, 0.16).addScaledVector(rightOf, 0.03), 0.32, 0.035, 0.45);
              mark(tmp.copy(p).addScaledVector(toTrunk, 0.16).addScaledVector(rightOf, -0.03), 0.32, 0.035, 0.45);
              this.burst(tmp.copy(p).setY(0.05), 5, "#d9cbb8", 0.03, 0.9, 2);
              plants[i] = p = null;
              reachFrom[i] = t;
            }
            // Planted: pointing at the spot. Reaching: up and forward for a new hold.
            const aim = p
              ? this.aimArm(i, p)
              : this.aimArm(i, tmp.copy(sh).addScaledVector(face, 0.9).addScaledVector(rightOf, side * 0.2).setY(sh.y + 0.35));
            const claw = Math.sin(t * 23 + i * 2) * 0.07;
            if (i === 1) {
              P.armRx = lerp(P.armRx, aim.x + claw, k);
              P.armRz = lerp(P.armRz, aim.z, k);
            } else {
              P.armLx = lerp(P.armLx, aim.x + claw, k);
              P.armLz = lerp(P.armLz, aim.z, k);
            }
          }
          panic(t);
          // Dust trailing off his tummy as he's dragged, and a smear where he was.
          const speed = pos.distanceTo(lastPos) / Math.max(dt, 1e-3);
          if (speed > 0.5 && t > T.down + dusty * 0.08) {
            dusty = (t - T.down) / 0.08 + 1;
            this.burst(tmp.copy(pos).addScaledVector(face, 0.5).setY(0.04), 2, "#d9cbb8", 0.035, 0.6, 1);
          }
        } else if (t < T.slam) {
          const u = clamp((t - T.lift) / (T.rim - T.lift), 0, 1);
          if (t < T.rim) {
            // Hauled up feet first over the rim and dropped in.
            const across = smooth(clamp(u / 0.8, 0, 1));
            pos.set(lerp(crawlEnd.x, rimAt.x, across), kf(u, [[0, 0], [0.4, H + 0.4], [0.8, H + 0.25], [1, 0]]), lerp(crawlEnd.z, rimAt.z, across));
            sy = kf(u, [[0.6, 1], [1, 0.92]]);
            sxz = kf(u, [[0.6, 1], [1, 0.85]]);
            this.rate = 22;
            P.yaw = lerp(faceYaw, trunkYaw, smooth(u));
            P.hipsRx = kf(u, [[0, 1.38], [0.35, -0.5], [0.8, -0.3], [1, 0.15]]);
            P.hipsY = kf(u, [[0, 0.5], [0.4, HIP]]);
            P.headRx = kf(u, [[0, -1.1], [0.5, 0]]);
            P.armLz = -2.4 + Math.sin(t * 21) * 0.3;
            P.armRz = 2.4 - Math.sin(t * 21 + 1) * 0.3;
            P.legLx = Math.sin(t * 22) * 0.6;
            P.legRx = -Math.sin(t * 22) * 0.6;
            panic(t);
          } else if (t < T.squash) {
            // Hanging on to the rim by both mittens, tugged down from below, until a hand prises one off.
            pos.copy(rimAt);
            sy = 0.92;
            sxz = 0.85;
            this.rate = 20;
            this.bounce = 0.5;
            P.yaw = trunkYaw;
            P.hipsRx = 0.18;
            const tug = Math.abs(Math.sin(t * 9));
            P.hipsY = HIP - 0.08 * tug;
            P.squash = 1 - 0.05 * tug;
            const pry = kf(t, [[T.pry, 0], [T.pry + 0.12, 1]]);
            for (const i of [0, 1]) {
              const aim = this.aimArm(i, rimGrip[i]);
              const off = i === near ? pry : 0;
              const up = this.aimArm(i, tmp.copy(rimGrip[i]).setY(H + 1.1));
              const x = lerp(aim.x, up.x, off) + Math.sin(t * 25 + i) * 0.05;
              const z = lerp(aim.z, up.z, off);
              if (i === 1) {
                P.armRx = x;
                P.armRz = z;
              } else {
                P.armLx = x;
                P.armLz = z;
              }
            }
            P.headRy = noNo(t);
            panic(t);
          } else {
            // Yanked down inside, arms last.
            const v = clamp((t - T.squash) / (T.slam - T.squash), 0, 1);
            pos.copy(rimAt);
            sy = kf(v, [[0, 0.92], [0.2, 1.0], [1, 0.28]]);
            sxz = kf(v, [[0, 0.85], [0.3, 0.9], [1, 0.7]]);
            this.rate = 24;
            P.yaw = trunkYaw;
            P.armLz = -2.85;
            P.armRz = 2.85;
            panic(t);
            this.faceMods.mouthOpen = 1.3;
          }
        } else if (t < T.burst) {
          // Inside, changing.
          pos.copy(rimAt);
          P.yaw = 0;
        } else if (t < T.land) {
          // Flung out in a big arc, spinning, arms and legs everywhere.
          const u = (t - T.burst) / (T.land - T.burst);
          // Kept low enough that his head stays in the corner window at the top of the arc.
          pos.set(lerp(rimAt.x, home.x, u), 4 * 0.7 * u * (1 - u), lerp(rimAt.z, home.z, u));
          sy = kf(u, [[0, 0.55], [0.15, 1.12], [0.5, 1]]);
          sxz = kf(u, [[0, 1.1], [0.15, 0.85], [0.5, 1]]);
          this.rate = 30;
          this.bounce = 0.55;
          P.yaw = kf(t, [[T.burst + 0.05, 0], [T.land - 0.08, Math.PI * 2]]);
          P.armLz = -2.0 + Math.sin(t * 24) * 0.35;
          P.armRz = 2.0 - Math.sin(t * 24 + 1) * 0.35;
          P.legLz = -0.4;
          P.legRz = 0.4;
          P.legLx = Math.sin(t * 20) * 0.4;
          P.legRx = -Math.sin(t * 20) * 0.4;
          P.headRy = 0;
          this.expr = "surprised";
        } else {
          if (!landed) {
            landed = true;
            pos.copy(home);
            this.unwind();
            this.burst(tmp.set(home.x, 0.05, home.z + 0.1), 10, "#d9cbb8", 0.04, 1.2, 1.5);
          }
          // A bump and a little bounce...
          pos.y = kf(t, [[T.land, 0], [T.land + 0.16, 0.15], [T.land + 0.32, 0]]);
          this.rate = 20;
          this.bounce = 0.5;
          P.squash = kf(t, [[T.land, 0.72], [T.land + 0.16, 1.08], [T.land + 0.32, 0.84], [T.land + 0.5, 1.04], [T.land + 0.65, 1]]);
          P.headRy = 0;
          if (t < T.over) {
            // ...then "huh?": a tilt of the head and a look round.
            const v = t - T.land;
            P.headRz = kf(v, [[0.3, 0], [0.55, 0.26], [1.4, -0.18], [T.over - T.land, 0]]);
            P.headRy = kf(v, [[0.3, 0], [0.6, s * 0.45], [1.0, s * 0.45], [1.25, -s * 0.3], [T.over - T.land, 0]]);
            const shrug = kf(v, [[0.35, 0], [0.55, 1], [1.25, 1], [1.4, 0]]);
            P.armLz = lerp(P.armLz, -0.75, shrug);
            P.armRz = lerp(P.armRz, 0.75, shrug);
            P.armLx = P.armRx = -0.35 * shrug;
            this.expr = v < 0.3 ? "dizzy" : "confused";
          } else if (t < T.joy) {
            // Looks himself over: down at his tummy, at one arm, then the other.
            const v = t - T.over;
            P.headRx = kf(v, [[0, 0], [0.2, 0.36]]);
            P.headRy = kf(v, [[0.1, 0], [0.3, -0.35], [0.4, -0.35], [0.55, 0.35]]);
            P.yaw = Math.sin(v * 5) * 0.18;
            P.armLx = kf(v, [[0, 0], [0.2, -0.75]]);
            P.armLz = kf(v, [[0, REST.armLz], [0.2, -0.55]]);
            P.armRx = kf(v, [[0, 0], [0.25, -0.75]]);
            P.armRz = kf(v, [[0, REST.armRz], [0.25, 0.55]]);
            this.expr = "ooh";
          } else {
            // Oh, it's lovely! A hop with both arms up.
            const v = t - T.joy;
            P.hipsY = HIP + kf(v, [[0.05, 0], [0.15, -0.05], [0.35, 0.24], [0.55, 0], [0.65, -0.03], [0.8, 0]]);
            const up = kf(v, [[0, 0], [0.2, 1], [0.65, 1], [0.8, 0.6]]);
            P.armLz = lerp(REST.armLz, -2.45, up) + Math.sin(v * 14) * 0.12 * up;
            P.armRz = -P.armLz;
            this.expr = "joy";
            if (once("joy", v > 0.3)) this.burst(this.head.getWorldPosition(tmp), 14, newColor, 0.03, 2.4, 2);
          }
        }
        this.root.scale.set(sxz, sy, sxz);
        // Keep his round shadow on the floor whatever he's doing.
        this.shadow.position.y = (0.003 - pos.y) / sy;

        // Tears and sweat flying off both sides of his face, turn about, and dust where he's yanked.
        if (scared && t > T.grab + tears * 0.15) {
          tears++;
          const side = tears % 2 ? 1 : -1;
          const from = this.head.localToWorld(tmp.set(side * 0.42, 0.02, 0.36));
          const dir = this.head.localToWorld(tmp2.set(side * 1.0, 0.75, 0.35)).sub(this.head.getWorldPosition(grip)).normalize();
          this.burst(from, 2, "#a6dbff", 0.034, 1.7, 5.5, dir);
        }
        if (scuffs < jerks.length && t > jerks[scuffs]) {
          scuffs++;
          if (t < T.fall) this.burst(tmp.set(pos.x, 0.05, pos.z + 0.1), 7, "#d9cbb8", 0.035, 0.9, 1.5);
          else mark(tmp.copy(pos).addScaledVector(face, 0.45), 0.4, 0.42, 0.14);
        }
        lastPos.copy(pos);

        // Sweat drops sliding down both sides of his hood while it all goes on.
        const sweating = t > T.uhoh && t < T.squash;
        [this.sweat, this.sweat2].forEach((drop, i) => {
          drop.visible = sweating;
          if (!sweating) return;
          const k = ((t - T.uhoh + i * 0.4) % 0.8) / 0.8;
          const x = (i ? s : -s) * (0.5 - k * 0.04);
          const y = 0.24 - k * 0.24;
          const z = HEAD.z * Math.sqrt(Math.max(0, 1 - (x / HEAD.x) ** 2 - (y / HEAD.y) ** 2)) + 0.03;
          drop.position.set(x, y, z);
          const f = 1 - smooth(clamp((k - 0.7) / 0.3, 0, 1));
          drop.scale.set(0.042 * f, 0.06 * f, 0.042 * f);
        });

        // "?" over his head after the landing.
        const qs = kf(t, [[T.land + 0.45, 0], [T.land + 0.6, 0.6], [T.land + 0.7, 0.5], [T.over - 0.15, 0.5], [T.over, 0]]);
        q.visible = qs > 0.01;
        if (q.visible) {
          this.head.getWorldPosition(tmp);
          q.position.set(tmp.x - s * 0.5, tmp.y + 0.75 + Math.sin(t * 5) * 0.03, tmp.z + 0.2);
          q.scale.setScalar(qs);
          q.material.rotation = Math.sin(t * 4) * 0.18;
        }
        return t < T.done;
      },
      after: (t) => {
        // The ghostly hands reach out along curves and take hold: arms and hips while
        // he's standing, his feet once he's down, and one prises a mitten off the rim.
        this.hips.updateWorldMatrix(true, true);
        const nx = near === 1 ? 1 : -1;
        const gone = kf(t, [[T.squash, 1], [T.slam, 0.01]]);
        const toFeet = kf(t, [[T.fall, 0], [T.fall + 0.35, 1]]);
        /** Where hand k holds on (and which way its palm faces), standing or down. */
        const holdOf = (k: number, down: boolean, g: THREE.Vector3, d: THREE.Vector3) => {
          if (k === 3) {
            mittens[near].getWorldPosition(g);
            d.subVectors(g, mouths[k]).normalize();
          } else if (down) {
            if (k === 2) this.hips.localToWorld(g.set(0, 0.0, -0.48));
            else this.legs[k === 0 ? near : 1 - near].localToWorld(g.set(0, -0.34, 0.04));
            d.subVectors(g, mouths[k]).normalize();
          } else if (k === 0) {
            mittens[near].getWorldPosition(g);
            d.subVectors(g, mouths[k]).normalize();
          } else {
            this.hips.localToWorld(g.set(k === 1 ? nx * 0.5 : -nx * 0.48, k === 1 ? 0.22 : 0.36, 0.22));
            this.hips.localToWorld(d.set(0, 0.3, -0.1)).sub(g).normalize();
          }
        };
        // The ones on his feet go in with him as he drops inside; only the one at the rim stays out.
        const inside = kf(t, [[T.rim - 0.15, 1], [T.rim + 0.05, 0.01]]);
        gh.hands.forEach((h, k) => {
          const u = smooth(clamp((t - launch[k]) / REACH, 0, 1));
          const left = k === 3 ? gone : Math.min(gone, inside);
          const showing = u > 0 && left > 0.02 && t < T.slam;
          h.root.visible = h.arm.visible = showing;
          if (!showing) return;
          holdOf(k, false, grip, toward);
          if (toFeet > 0 && k < 3) {
            holdOf(k, true, grip2, toward2);
            grip.lerp(grip2, toFeet);
            toward.lerp(toward2, toFeet).normalize();
          }
          grip.addScaledVector(toward, -0.1);
          const c = curves[k];
          const w = t * 3 + k * 1.7;
          c.v0.copy(mouths[k]);
          c.v1.copy(mouths[k]).add(tmp.set(Math.sin(w) * 0.12, 0.8, Math.cos(w) * 0.08));
          c.v2.copy(grip).add(tmp.subVectors(mouths[k], grip).multiplyScalar(0.2)).add(tmp.set(Math.cos(w * 1.3) * 0.08, 0.45, 0));
          c.v3.copy(grip);
          c.getPoint(u, h.root.position);
          c.getTangent(u, tan);
          // Fingers along the reach, palm towards him.
          bx.copy(toward).addScaledVector(tan, -toward.dot(tan));
          if (bx.lengthSq() < 1e-6) bx.set(0, 0, 1);
          bx.normalize();
          tmp.crossVectors(tan, bx);
          basis.makeBasis(tmp, tan, bx);
          h.root.quaternion.setFromRotationMatrix(basis);
          h.root.position.addScaledVector(tan, 0.04);
          const size = (0.6 + 0.8 * u) * left;
          h.root.scale.set(k % 2 ? -size : size, size, size);
          reachArm(h, c, u, 0.045 * left, 0.1 * left);
          // Open and wiggling on the way; then a firm (squeezy) grip.
          const hold = kf(t - launch[k] - REACH, [[-0.15, 0], [0.05, 1]]);
          h.fingers.forEach((f, i) => {
            const wiggle = Math.sin(t * 16 + i * 0.9) * 0.25 * (1 - hold);
            f.rotation.x = lerp(0.1 + wiggle, i === 4 ? 0.9 : 1.25 + Math.sin(t * 9 + k) * 0.08, hold);
          });
        });
      },
      end: () => {
        // Kept for next time.
        tr.group.removeFromParent();
        gh.group.removeFromParent();
        q.removeFromParent();
        for (const m of marks) {
          m.removeFromParent();
          (m.material as THREE.Material).dispose();
        }
        markGeo.dispose();
        dim(1);
        if (!swapped) setTheme(name);
        this.wide = 0;
        this.unwind();
        // Interrupted part-way? Back where he started, the right size.
        this.root.position.copy(home);
        this.root.scale.setScalar(1);
        this.root.visible = true;
        this.shadow.position.y = 0.003;
        this.sweat.visible = this.sweat2.visible = false;
      },
    };
  }

  // ── Desktop behaviours (cued by the app's state, see stage.ts) ──────────────

  /** Waking up for the day: a big stretch and a yawn, then a happy look round. */
  private stretch(): Running {
    return {
      name: "boot",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 14;
        const up = kf(t, [[0, 0], [0.35, 1], [0.8, 1], [1.1, 0]]);
        P.armLz = lerp(REST.armLz, -2.6, up);
        P.armRz = lerp(REST.armRz, 2.6, up);
        P.squash = 1 + 0.06 * up;
        P.headRx = -0.15 * up;
        P.headRy = 0;
        this.expr = t < 0.9 ? "sleepy" : "happy";
        if (t < 0.9) this.faceMods.mouthOpen = 0.65 * up;
        return t < 1.5;
      },
    };
  }

  /** Working: sitting with a tablet in both mittens, tapping away. */
  private working(): Running {
    const tab = tablet("#e8955a");
    paint(tab, this.look);
    tab.scale.setScalar(0.01);
    // Held in front of his tummy, its screen tilted up towards his face.
    tab.position.set(0, 0.36, 0.62);
    tab.rotation.x = 0.75;
    this.hips.add(tab);
    const edge = new THREE.Vector3();
    let nextLook = 4 + Math.random() * 4;
    let lookUp = -1;
    let taps = 0;
    const aimAt = (side: number, lift: number) => {
      edge.set(side * 0.24, lift, 0.03);
      return this.aimArm(side < 0 ? 0 : 1, tab.localToWorld(edge));
    };
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
        this.rate = 16;
        tab.scale.setScalar(kf(t, [[0, 0.01], [0.25, 1.1], [0.4, 1]]));
        P.hipsRx = -0.06;
        // Thumbs tapping, left and right in turn.
        taps = Math.floor(t / 0.14);
        const l = aimAt(-1, taps % 2 === 0 ? 0.02 : -0.02);
        const r = aimAt(1, taps % 2 === 1 ? 0.02 : -0.02);
        P.armLx = l.x;
        P.armLz = l.z;
        P.armRx = r.x;
        P.armRz = r.z;
        // Head down over the screen, glancing up now and then.
        if (lookUp < 0 && t > nextLook) lookUp = t;
        const glance = lookUp >= 0 ? kf(t - lookUp, [[0, 0], [0.25, 1], [1.0, 1], [1.3, 0]]) : 0;
        if (lookUp >= 0 && t - lookUp > 1.3) {
          lookUp = -1;
          nextLook = t + 5 + Math.random() * 5;
        }
        P.headRx = lerp(0.34, 0.02, glance);
        P.headRy = 0;
        this.expr = glance > 0.5 ? "happy" : "determined";
        if (glance <= 0.5) this.faceMods.lookY = -0.7;
        return true;
      },
      outro: away,
      end: () => dispose(tab),
    };
  }

  /** Hooray: two happy hops with both arms up. */
  private hooray(): Running {
    let sparkled = false;
    const tmp = new THREE.Vector3();
    return {
      name: "hooray",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 22;
        this.bounce = 0.55;
        const hop = (at: number) => kf(t, [[at, 0], [at + 0.12, -0.05], [at + 0.32, 0.26], [at + 0.55, 0], [at + 0.65, -0.03], [at + 0.8, 0]]);
        P.hipsY = HIP + hop(0.1) + hop(1.0);
        P.squash = 1 + 0.08 * Math.sin(t * 9) * kf(t, [[0, 1], [1.9, 0]]);
        const up = kf(t, [[0, 0], [0.25, 1], [1.8, 1], [2.1, 0]]);
        P.armLz = lerp(REST.armLz, -2.5, up) + Math.sin(t * 14) * 0.15 * up;
        P.armRz = -P.armLz;
        P.headRy = 0;
        this.expr = "joy";
        if (!sparkled && t > 0.4) {
          sparkled = true;
          this.burst(this.head.getWorldPosition(tmp), 12, "#ffd36b", 0.022, 2.2, 2);
        }
        return t < 2.2;
      },
    };
  }

  /** A happy little nod: yes, got it. */
  private nod(): Running {
    return {
      name: "nod",
      t: 0,
      step: (t) => {
        const P = this.target;
        if (this.seated) blendInto(P, SEATED, 1);
        this.rate = 18;
        P.headRx += kf(t, [[0, 0], [0.15, 0.25], [0.3, -0.05], [0.45, 0.2], [0.62, 0]]);
        P.headRy = 0;
        this.expr = "happy";
        return t < 0.8;
      },
    };
  }

  /** "Hmm, maybe one of these?": a mitten to his chin, head tilted, thinking. */
  private ponder(): Running {
    const chin = new THREE.Vector3();
    return {
      name: "ponder",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 12;
        const up = kf(t, [[0, 0], [0.4, 1]]);
        chin.copy(this.face.mouth()).add(new THREE.Vector3(0.06, -0.12, 0.12));
        const aim = this.aimRightArm(this.face.group.localToWorld(chin));
        P.armRx = lerp(REST.armRx, aim.x, up);
        P.armRz = lerp(REST.armRz, aim.z, up);
        P.headRz = 0.15 * up + Math.sin(t * 1.3) * 0.04;
        P.headRx = -0.08 * up;
        P.headRy = 0;
        this.expr = t % 3 < 2 ? "ooh" : "happy";
        this.faceMods.lookX = 0.5;
        this.faceMods.lookY = 0.5;
        return true;
      },
    };
  }

  /** "I'm not sure what you meant": a shrug, head tilted. */
  private shrug(): Running {
    return {
      name: "shrug",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 14;
        const up = kf(t, [[0, 0], [0.3, 1]]);
        P.armLz = lerp(REST.armLz, -0.8, up);
        P.armRz = lerp(REST.armRz, 0.8, up);
        P.armLx = P.armRx = -0.4 * up;
        P.squash = 1 + kf(t % 1.6, [[0.2, 0], [0.35, 0.05], [0.6, 0]]);
        P.headRz = 0.18 * Math.sin(t * 1.2 + 1);
        P.headRy = 0;
        this.expr = "confused";
        return true;
      },
    };
  }

  /** Something went wrong: head down, arms limp, a slow sigh. */
  private droop(): Running {
    return {
      name: "droop",
      t: 0,
      step: (t) => {
        const P = this.target;
        if (this.seated) blendInto(P, SEATED, 1);
        this.rate = 8;
        P.headRx = 0.32;
        P.headRy = 0;
        P.hipsRx += 0.08;
        P.armLz = -0.12;
        P.armRz = 0.12;
        P.squash = 0.95 + Math.sin(t * 1.4) * 0.015;
        this.expr = "sad";
        return true;
      },
    };
  }

  /** Something for you: waving and bouncing to get your attention. */
  private call(): Running {
    return {
      name: "call",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 18;
        this.bounce = 0.55;
        const up = kf(t, [[0, 0], [0.25, 1]]);
        P.armRz = lerp(REST.armRz, 2.5, up) + Math.sin(t * 12) * 0.3 * up;
        P.armRx = -0.25 * up;
        P.hipsY = HIP + Math.max(0, Math.sin(t * 5.2)) * 0.07;
        P.headRz = 0.1 * up;
        this.expr = t < 0.4 ? "ooh" : "happy";
        return true;
      },
    };
  }

  /** Getting sleepy: sitting, eyes heavy, head nodding off and jerking back up. */
  private dozing(): Running {
    return {
      name: "doze",
      t: 0,
      step: (t) => {
        const P = this.target;
        blendInto(P, SEATED, 1);
        this.rate = 8;
        P.headRx = 0.14 + kf(t % 4, [[0.5, 0], [2.6, 0.26], [2.8, 0.02], [3.4, 0]]);
        P.headRy = 0;
        P.squash = 1 + Math.sin(t * 1.5) * 0.02;
        this.expr = "sleepy";
        return true;
      },
    };
  }

  /** Picked up: dangling, legs swinging, tilting with the drag. */
  private dangle(): Running {
    this.seated = false;
    return {
      name: "held",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 12;
        this.bounce = 0.45;
        P.hipsY = HIP + 0.1;
        P.hipsRz = clamp(-this.carry.x * 0.0012, -0.5, 0.5);
        P.hipsRx = clamp(this.carry.y * 0.0008, -0.3, 0.3);
        P.armLz = -2.3;
        P.armRz = 2.3;
        P.legLx = Math.sin(t * 6) * 0.25;
        P.legRx = -Math.sin(t * 6) * 0.25;
        P.headRy = 0;
        this.expr = t < 0.5 ? "surprised" : "joy";
        return true;
      },
    };
  }

  /** Put down: a squashy landing. */
  private land(): Running {
    return {
      name: "land",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 24;
        P.squash = kf(t, [[0, 1], [0.1, 0.82], [0.25, 1.06], [0.45, 1]]);
        this.expr = "happy";
        return t < 0.45;
      },
    };
  }

  /** Poked too many times: head going round, a little stagger. */
  private dizzy(): Running {
    let starred = false;
    const tmp = new THREE.Vector3();
    return {
      name: "dizzy",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 16;
        const fade = kf(t, [[0, 1], [1.2, 1], [1.6, 0]]);
        P.headRz = Math.sin(t * 9) * 0.2 * fade;
        P.headRx = Math.cos(t * 9) * 0.12 * fade;
        P.hipsRz = Math.sin(t * 4.5) * 0.1 * fade;
        P.armLz = REST.armLz - 0.5 * fade + Math.sin(t * 7) * 0.2 * fade;
        P.armRz = REST.armRz + 0.5 * fade - Math.sin(t * 7 + 1) * 0.2 * fade;
        P.headRy = 0;
        this.expr = "dizzy";
        if (!starred) {
          starred = true;
          this.burst(this.head.getWorldPosition(tmp).setY(tmp.y + 0.6), 7, "#ffd36b", 0.025, 0.9, 0.5);
        }
        return t < 1.6;
      },
    };
  }

  /** A little hop to one side (the window moves with him while he potters about). */
  private hop(dir: number): Running {
    return {
      name: "hop",
      t: 0,
      step: (t) => {
        const P = this.target;
        this.rate = 24;
        this.bounce = 0.6;
        P.yaw = dir * 0.45 * kf(t, [[0, 0], [0.1, 1], [0.38, 1], [0.6, 0]]);
        P.hipsY = HIP + kf(t, [[0, 0], [0.08, -0.03], [0.2, 0.12], [0.34, 0], [0.4, -0.02], [0.5, 0]]);
        P.legLx = P.legRx = -0.3 * kf(t, [[0.08, 0], [0.2, 1], [0.34, 0]]);
        this.expr = "happy";
        return t < 0.6;
      },
    };
  }
}
