// The 3D characters in the desktop app: Rui (the yeti) or Dogesh Bhai (the
// pup). The character controller (src/engine/controller.ts) still decides what
// state the character is in, exactly as for the 2D characters; this stage
// draws him into his own canvas and turns each state (and a few app events)
// into one of his behaviours. Both answer to the same cues.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { StateName, Variant } from "../engine/types";
import { Look, ThemeName, currentTheme, lookShared, setTheme } from "./looks";
import { prewarm } from "./props";
import { SpeedWatch } from "./speed";
import { CHANGE_STYLES, Cue, Rui } from "./rui";
import { Dogesh, OUTFIT_CHANGES, type OutfitChange } from "./dogesh";
import { isOutfit } from "../skins/dogesh-outfits";

/** Which 3D character the stage shows. */
export type Who = "rui" | "dogesh";

/** Full figure in the desktop corner, or head and shoulders in the top-edge island. */
export type Framing = "corner" | "island";

const CAMERA: Record<Framing, { y: number; z: number; look: number; bounds: number }> = {
  corner: { y: 1.35, z: 5.4, look: 1.1, bounds: 0.35 },
  island: { y: 1.62, z: 3.3, look: 1.5, bounds: 0 },
};
/**
 * Pulled back for a scene that needs room (the wardrobe and mirror, the trunk), only when
 * the window has no room round his square to spill into.
 */
const WIDE = { y: 1.75, z: 9.8, look: 1.3 };

/** See-through room round his square in the corner window, as fractions of its side (Rust: set_room). */
export interface Room {
  x: number;
  top: number;
}
export const ROOM: Room = { x: 0.3, top: 0.25 };
/** How far from the middle he may stroll when the window has room (world units; his square shows ±0.35). */
const ROAM = 1.1;
/** Further from the middle than this, he's outside his square: the canvas grows to the whole window. */
const HOME_X = 0.36;
/** Behaviours that move him about (or bring props in) and so may need the room. */
const ROAMING: ReadonlySet<string> = new Set(["stroll", "walk", "wardrobe", "trunk", "hop", "screen"]);
/** The change scenes (Rui's colours, Dogesh's outfits): while one runs, `changing` is set. */
const SCENES: readonly string[] = [...CHANGE_STYLES, ...OUTFIT_CHANGES];
/** Dogesh's head sits a little lower than Rui's: the island's head-and-shoulders shot follows it down. */
const HEAD_DROP: Record<Who, number> = { rui: 0, dogesh: 0.1 };
/** How long after he appears to build the change-colour props, so the first change doesn't stutter. */
const PREWARM_AFTER_MS = 4000;

/** Behaviours that last until the state changes; leaving the state stops them. */
const LASTING: ReadonlySet<string> = new Set(["work", "research", "run", "browse", "ponder", "shrug", "droop", "call", "doze", "nap", "rest", "held"]);

/** What an agent is busy with, for his working pose. */
export type Activity = "edit" | "research" | "run" | "browse";
const ACTIVITY_CUE: Record<Activity, Cue> = { edit: "work", research: "research", run: "run", browse: "browse" };
/**
 * Agents switch tools every second or two: a kind of task has to go on this
 * long before he changes pose for it, and a pose stays at least this long.
 */
const ACTIVITY_SETTLE_MS = 2500;
const POSE_MIN_MS = 5000;
/** Quick moves get every frame; slow, still ones get fewer. */
const QUICK: ReadonlySet<string> = new Set([
  "hooray", "spin", "hop", "dizzy", "poke", "held", "land", "nod", "boot", "wave", "twirl", "paint", "wardrobe",
  "trunk", "exercise", "call", "stand", "sit", "spook", "puff", "screen",
]);
const STILL: ReadonlySet<string> = new Set(["nap", "doze", "rest", "seated"]);
/** After this long in the same lasting behaviour (working, pondering...), he's drawn as rarely as when dozing. */
const LONG_STILL_S = 60;
/** With reduced motion: small moves in place of big ones. */
const CALMER: Partial<Record<Cue, Cue>> = { hooray: "nod", dizzy: "nod", boot: "nod" };


/** What he does for each state of the controller (null: see `setState`). */
export function cueFor(state: StateName, variant: Variant): Cue | null {
  switch (state) {
    case "OFF": return "rest";
    case "BOOTING": return "boot";
    case "TOUCHED": return variant === "dizzy" ? "dizzy" : null;
    case "WORKING": return "work";
    case "SUCCESS": return variant === "short" ? "nod" : "hooray";
    case "SUGGESTING": return "ponder";
    case "CONFUSED": return "shrug";
    case "ERROR": return "droop";
    case "NOTIFY": return variant === "ack" ? "nod" : "call";
    case "SLEEPY": return "doze";
    case "SLEEPING": return "sleep";
    case "WAKING": return "wake";
    case "HELD": return "held";
    case "LANDING": return "land";
    default: return null; // IDLE, ATTENTIVE: see setState
  }
}

export class RuiStage {
  /** The character on this stage. */
  readonly actor: Rui | Dogesh;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  private key = new THREE.DirectionalLight("#fff6ea", 2.2);
  private back = new THREE.DirectionalLight("#dfe9ff", 1.1);
  private studio: THREE.Texture;
  private framing: Framing;
  private look: Look = "toy";
  private state: StateName = "OFF";
  /** 0 normal framing … 1 pulled back for a scene that needs room. */
  private wideNow = 0;
  /** Where Dogesh's head is (eased), for the island's shot of him. */
  private headY = 1.45;
  private headAt = new THREE.Vector3();
  /** A colour (or outfit) change is under way: "starting" until the scene shows, then "scene". */
  private changing: "starting" | "scene" | null = null;
  /** A state came in while Dogesh was changing outfit: played once he's done. */
  private held = false;
  private warmed = false;
  /** Props are in the scene being compiled: hold the last frame till they're out. */
  private warming = false;
  private warmTimer = 0;
  /** Room round his square, when the window has been given it. */
  private room: Room | null = null;
  /** The canvas covers the whole window (a scene or stroll is using the room), not just his square. */
  private expanded = false;
  /** His square inside the window, client px. */
  private sq = { left: 0, top: 0, size: 0 };
  private onWindowResize = () => this.layout();
  /** On battery: fewer frames all round. */
  private saving = false;
  /** Seconds in the current lasting behaviour, and which one. */
  private stillFor = 0;
  private stillIn = "";
  /** Whether this PC keeps up with him (speed.ts). */
  private speed = new SpeedWatch();
  /** Called once if he can't keep up on this PC (the app shows a 2D character instead). */
  onSlow: (() => void) | null = null;
  private reduced = false;
  private still = false;
  private waiting: "permission" | "question" | null = null;
  /** The kind of task he's been asked to show (`want`, since when) and the one he shows. */
  private activity = { want: "edit" as Activity, since: 0, shown: "edit" as Activity, shownAt: 0 };
  private running = false;
  private hidden = false;
  private raf = 0;
  private last = 0;
  private resizer: ResizeObserver;

  /**
   * `who`: Rui (the default) or Dogesh Bhai. Rui's colours are themes
   * (`setTheme`, `changeTheme`); Dogesh's looks are outfits (`setOutfit`, `changeOutfit`).
   */
  constructor(private canvas: HTMLCanvasElement, framing: Framing, readonly who: Who = "rui") {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.studio;
    this.scene.environmentIntensity = 0.75;
    this.back.position.set(2.5, 3, -4);
    this.scene.add(this.key, this.key.target, this.back);

    this.actor = who === "dogesh" ? new Dogesh(this.scene) : new Rui(this.scene);
    this.actor.naps = false; // the app decides when he sleeps
    this.framing = framing;
    this.setFraming(framing);

    this.resizer = new ResizeObserver(() => this.layout());
    this.resizer.observe(canvas);
    window.addEventListener("resize", this.onWindowResize);
    this.layout();
    this.warmTimer = window.setTimeout(() => void this.warmUp(), PREWARM_AFTER_MS);
  }

  setFraming(framing: Framing): void {
    this.framing = framing;
    this.layout();
    this.frameCamera();
    const b = this.actor.bounds;
    this.actor.root.position.x = Math.max(-b, Math.min(b, this.actor.root.position.x));
    this.actor.autoLife = this.lively();
  }

  /** The window has (or no longer has) see-through room round his square. */
  setRoom(room: Room | null): void {
    this.room = room;
    this.layout();
  }

  /** His square's centre in the window, client px (where "near him" is measured from). */
  center(): { x: number; y: number } {
    return { x: this.sq.left + this.sq.size / 2, y: this.sq.top + this.sq.size * 0.6 };
  }

  setLook(look: Look): void {
    if (look === this.look) return;
    this.look = look;
    this.actor.setLook(look);
    this.scene.environment = look === "toy" ? this.studio : null;
    this.back.visible = look === "toy";
  }

  /** The character on this stage (kept for older callers; see `actor`). */
  get rui(): Rui | Dogesh {
    return this.actor;
  }

  /** Dresses Dogesh Bhai in an outfit (dogesh-outfits.ts) at once (on start-up). */
  setOutfit(name: unknown): void {
    if (this.actor instanceof Dogesh) this.actor.setOutfit(name);
  }

  /**
   * A new outfit chosen in Settings: he changes into it with one of two
   * scenes (a puff of smoke, or behind a dressing screen; never the same twice
   * running, unless `style` says). At the top edge there's only room for the
   * puff; with reduced motion, or while he can't be seen, he just changes.
   */
  changeOutfit(name: unknown, style?: OutfitChange): void {
    const dog = this.actor;
    if (!(dog instanceof Dogesh) || !isOutfit(name)) return;
    if (name === dog.wearing && !this.changing) return;
    if (this.reduced || this.hidden) {
      dog.setOutfit(name);
      return;
    }
    dog.changeOutfit(name, this.framing === "island" ? "puff" : style);
    this.changing = "starting";
  }

  /**
   * How far the agent's work has got (0..1, or null when unknown): Dogesh's
   * cozy scarf knits up gold with it while he works.
   */
  setProgress(p: number | null): void {
    if (this.actor instanceof Dogesh) this.actor.progress = p === null ? null : Math.min(1, Math.max(0, p));
  }

  /** Puts a colour on at once (on start-up, with no scene). Rui only. */
  setTheme(name: ThemeName): void {
    if (this.actor instanceof Rui) setTheme(name);
  }

  /**
   * A new colour chosen in Settings or the tray: he changes into it with one
   * of the four scenes, picked at random. At the top edge there's only room
   * for a twirl; with reduced motion it just changes.
   */
  changeTheme(name: ThemeName): void {
    if (!(this.actor instanceof Rui)) return;
    if (name === currentTheme() && !this.changing) return;
    if (this.reduced || this.hidden) {
      setTheme(name);
      return;
    }
    this.actor.applyTheme(name, this.framing === "island" ? "twirl" : undefined);
    this.changing = "starting";
  }

  /** On battery power: draw less often. */
  setPowerSaving(on: boolean): void {
    this.saving = on;
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    if (this.actor instanceof Dogesh) this.actor.calm = on;
    this.actor.autoLife = this.lively();
  }

  // ── Driven by the app ───────────────────────────────────────────────────────

  /** The controller's state changed. */
  setState(state: StateName, variant: Variant): void {
    this.state = state;
    // Dogesh finishes changing his clothes first (unless he's picked up): the state is played after.
    if (this.changing && this.actor instanceof Dogesh && state !== "HELD") {
      this.held = true;
      this.actor.mood = state === "ATTENTIVE" ? "happy" : "neutral";
      this.actor.autoLife = this.lively();
      return;
    }
    this.held = false;
    // A new state takes over from a colour change still running (the colour is put on regardless).
    this.changing = null;
    this.actor.mood = state === "ATTENTIVE" ? "happy" : "neutral";
    this.actor.autoLife = this.lively();
    let cue = this.cueNow(state, variant);
    if (cue && this.reduced) cue = CALMER[cue] ?? cue;
    if (cue) {
      this.actor.play(cue);
      return;
    }
    if (state === "TOUCHED") {
      this.actor.play("poke");
      return;
    }
    // Back to rest: stop whatever lasting thing he was doing (a scene he's in
    // the middle of, like eating or a twirl, finishes by itself).
    if (LASTING.has(this.actor.current)) this.actor.play("stand");
  }

  /**
   * An agent is waiting for you: for an OK ("permission") or an answer
   * ("question"). While it waits he keeps at it (calling you, or a
   * questioning look), instead of going back to work after the first nudge.
   */
  setWaiting(kind: "permission" | "question" | null): void {
    if (this.waiting === kind) return;
    this.waiting = kind;
    if (this.state !== "WORKING" || this.changing || this.held) return;
    const cue = this.cueNow(this.state, null);
    if (cue) this.actor.play(cue);
  }

  /** The cue for a state: an agent waiting for you takes over from work, and work shows what kind of task it is. */
  private cueNow(state: StateName, variant: Variant): Cue | null {
    if (state === "WORKING" && this.waiting) return this.waiting === "question" ? "ponder" : "call";
    if (state === "WORKING") return ACTIVITY_CUE[this.activity.shown];
    return cueFor(state, variant);
  }

  /** What the busy agent is doing now (null: nothing it says). He changes pose once it has settled. */
  setActivity(kind: Activity | null): void {
    const k = kind ?? this.activity.want;
    if (k === this.activity.want) return;
    this.activity.want = k;
    this.activity.since = performance.now();
  }

  /** Every frame: change pose once a new kind of task has gone on long enough. */
  private settleActivity(now: number): void {
    const a = this.activity;
    if (a.want === a.shown || now - a.since < ACTIVITY_SETTLE_MS || now - a.shownAt < POSE_MIN_MS) return;
    a.shown = a.want;
    a.shownAt = now;
    if (this.state === "WORKING" && !this.waiting && !this.changing && !this.held) this.actor.play(ACTIVITY_CUE[a.shown]);
  }

  /** One-shot extras the app plays over any state. */
  overlay(name: string): void {
    if (this.reduced) return;
    if (name === "wiggle") this.actor.wiggle();
    else if (name === "hopLeft" || name === "hopRight") this.actor.play(name);
  }

  /** A notification just went up: some get a reaction of their own. */
  hint(category: string | undefined): void {
    if (this.reduced || this.framing !== "corner") return;
    switch (category) {
      case "break":
        this.actor.play("exercise"); // a stretch break, together
        break;
      case "battery":
        this.actor.play("sit"); // running low, and so is he
        break;
      case "download":
        this.actor.play("eat"); // a treat for a finished download
        break;
      case "welcome":
        this.actor.play("wave");
        break;
    }
  }

  /** The cursor, in this window's client coordinates. */
  lookAt(x: number, y: number): void {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    const head = this.actor.headWorld().project(this.camera);
    const hx = r.left + ((head.x + 1) / 2) * r.width;
    const hy = r.top + ((1 - head.y) / 2) * r.height;
    this.actor.lookAt((x - hx) / 260, -(y - hy) / 260);
  }

  setCarry(vx: number, vy: number): void {
    this.actor.setCarry(vx, vy);
  }

  /**
   * The clickable box round his body, as fractions of his square (the whole
   * window without room). Out on a stroll it may reach past 0..1.
   */
  hitRect(): { x0: number; y0: number; x1: number; y1: number } {
    // Only what's showing counts (props and face bits waiting hidden don't).
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    const target = this.actor.hitTarget;
    target.updateWorldMatrix(true, true);
    target.traverseVisible((o) => {
      if (!(o instanceof THREE.Mesh) || o.userData.outline) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(part.copy(o.geometry.boundingBox!).applyMatrix4(o.matrixWorld));
    });
    if (box.isEmpty()) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    const p = new THREE.Vector3();
    const r = this.canvas.getBoundingClientRect();
    const size = this.sq.size || r.width || 1;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(this.camera);
      const fx = (r.left + ((p.x + 1) / 2) * r.width - this.sq.left) / size;
      const fy = (r.top + ((1 - p.y) / 2) * r.height - this.sq.top) / size;
      x0 = Math.min(x0, fx);
      x1 = Math.max(x1, fx);
      y0 = Math.min(y0, fy);
      y1 = Math.max(y1, fy);
    }
    const lo = this.hasRoom() ? -1 : 0;
    const hi = this.hasRoom() ? 2 : 1;
    const r2 = (v: number) => Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100;
    return { x0: r2(x0), y0: r2(y0), x1: r2(x1), y1: r2(y1) };
  }

  // ── Running ─────────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.speed.start(this.last);
    const frame = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      if (this.hidden || this.warming) {
        this.last = now;
        this.speed.pause(now);
        return;
      }
      const fps = this.fps();
      // A little slack, so a 30 fps cap doesn't drop to 20 on a 60 Hz screen's jitter.
      if (now - this.last < 1000 / fps - 2) return;
      const dt = (now - this.last) / 1000;
      this.last = now;
      const t0 = performance.now();
      this.actor.update(dt);
      this.afterChange();
      this.settleActivity(now);
      this.useRoom();
      this.frameCamera(dt);
      this.draw();
      this.trackStill(dt);
      if (this.speed.frame(now, fps, dt, performance.now() - t0)) this.onSlow?.();
    };
    this.raf = requestAnimationFrame(frame);
  }

  /**
   * Development and pictures only: runs `seconds` of him at 60 steps a second
   * right now (whether or not he's started), then draws once.
   */
  advance(seconds: number): void {
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      this.actor.update(1 / 60);
      this.afterChange();
      this.useRoom();
      this.frameCamera(1 / 60);
      this.trackStill(1 / 60);
    }
    this.draw();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Nothing to see (the island is tucked away): no drawing, no updates. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
  }

  dispose(): void {
    this.stop();
    window.clearTimeout(this.warmTimer);
    window.removeEventListener("resize", this.onWindowResize);
    this.resizer.disconnect();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /** After a colour-change scene, back to what the state asks for (an agent still working: the tablet again). */
  private afterChange(): void {
    if (!this.changing) return;
    const now = this.actor.current;
    const inScene = SCENES.includes(now);
    if (this.changing === "starting") {
      if (inScene) this.changing = "scene";
      return;
    }
    if (inScene) return;
    this.changing = null;
    if (this.held) {
      // What came in while he was changing.
      this.held = false;
      this.setState(this.state, null);
      return;
    }
    const cue = this.cueNow(this.state, null);
    if (cue && LASTING.has(cue)) this.actor.play(cue);
  }

  /** Eases the camera out while a scene needs room the window doesn't have, and back in after. */
  private frameCamera(dt = 1): void {
    const base = CAMERA[this.framing];
    const drop = this.framing === "island" ? HEAD_DROP[this.who] : 0;
    let c = { ...base, y: base.y - drop, look: base.look - drop };
    if (this.framing === "island" && this.who === "dogesh") {
      // His head drops a long way when he sits or lies down (long legs): the head-and-shoulders shot follows it.
      const hy = this.actor.headWorld(this.headAt).y;
      this.headY += (hy - this.headY) * (1 - Math.exp(-dt * 5));
      c = { ...base, y: this.headY + 0.14, look: this.headY - 0.02 };
    }
    const want = this.framing === "corner" && !this.hasRoom() ? this.actor.wide : 0;
    this.wideNow += (want - this.wideNow) * (1 - Math.exp(-dt * 3));
    if (Math.abs(this.wideNow - want) < 0.001) this.wideNow = want;
    const k = this.wideNow * this.wideNow * (3 - 2 * this.wideNow);
    this.camera.position.set(0, c.y + (WIDE.y - c.y) * k, c.z + (WIDE.z - c.z) * k);
    this.camera.lookAt(0, c.look + (WIDE.look - c.look) * k, 0);
  }

  /** Builds and compiles the wardrobe, mirror, trunk and paint things once, in both looks. */
  private async warmUp(): Promise<void> {
    if (this.warmed) return;
    // It borrows the scene's wardrobe, mirror and trunk: not while he's using them, or while nobody can see.
    if (!this.running || this.changing || this.hidden || SCENES.includes(this.actor.current)) {
      this.warmTimer = window.setTimeout(() => void this.warmUp(), PREWARM_AFTER_MS);
      return;
    }
    this.warmed = true;
    this.warming = true;
    try {
      if (this.actor instanceof Dogesh) await this.actor.prewarm(this.renderer, this.camera, this.scene);
      else await prewarm(this.renderer, this.camera, this.scene);
    } finally {
      this.warming = false;
    }
    // prewarm leaves everything painted in the last look it compiled; put his back.
    const look = this.look;
    this.look = look === "toy" ? "anime" : "toy";
    this.setLook(look);
  }

  private lively(): boolean {
    return this.state === "IDLE" && this.framing === "corner" && !this.reduced && !this.still;
  }

  /** No wandering off on his own (a speech bubble beside him is pointing at him). */
  setStill(on: boolean): void {
    if (this.still === on) return;
    this.still = on;
    this.actor.autoLife = this.lively();
  }

  /**
   * 60 for quick moves, 15 while dozing or asleep (or a minute into anything
   * lasting, like working), 30 otherwise. On battery: 30, 10 and 20.
   */
  private fps(): number {
    const now = this.actor.current;
    if (STILL.has(now) || this.stillFor > LONG_STILL_S) return this.saving ? 10 : 15;
    if (QUICK.has(now)) return this.saving ? 30 : 60;
    return this.saving ? 20 : 30;
  }

  private trackStill(dt: number): void {
    const now = this.actor.current;
    if (now === this.stillIn && LASTING.has(now)) this.stillFor += dt;
    else {
      this.stillIn = now;
      this.stillFor = 0;
    }
  }

  /** The corner window has grown to the room asked for (Rust resizes it a moment after asking). */
  private hasRoom(): boolean {
    if (!this.room || this.framing !== "corner") return false;
    const want = (1 + 2 * this.room.x) / (1 + this.room.top);
    return Math.abs(window.innerWidth / window.innerHeight - want) < 0.03;
  }

  /**
   * Grows the canvas to the whole window while he needs the room (a scene with
   * props, a stroll, or he's away from the middle), and shrinks it back to his
   * square after, so the usual cost stays that of his square. Strolled off?
   * He walks back to the middle once he's free.
   */
  private useRoom(): void {
    if (!this.hasRoom()) return;
    const x = Math.abs(this.actor.root.position.x);
    const now = this.actor.current;
    const want = this.actor.wide > 0 || ROAMING.has(now) || x > HOME_X;
    if (want !== this.expanded) {
      this.expanded = want;
      this.layout();
    }
    if (x > HOME_X && now === "idle" && this.state === "IDLE" && !this.changing) this.actor.walkHome();
  }

  /** Sizes the canvas and camera to the window: his square alone, or the whole window round it. */
  private layout(): void {
    const st = this.canvas.style;
    let w: number;
    let h: number;
    const room = this.hasRoom() ? this.room! : null;
    this.actor.bounds = room ? ROAM : CAMERA[this.framing].bounds;
    if (!room) {
      // Wherever the page's CSS puts it (the whole corner window, or the island's 40 px).
      this.expanded = false;
      if (st.position) st.cssText = "";
      w = this.canvas.clientWidth;
      h = this.canvas.clientHeight;
      if (!w || !h) return;
      this.sq = { left: 0, top: 0, size: w };
      this.camera.aspect = w / h;
      this.camera.clearViewOffset();
    } else {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const S = W / (1 + 2 * room.x);
      this.sq = { left: room.x * S, top: room.top * S, size: S };
      const box = this.expanded ? { left: 0, top: 0, width: W, height: H } : { left: this.sq.left, top: this.sq.top, width: S, height: S };
      st.position = "absolute";
      st.left = `${box.left}px`;
      st.top = `${box.top}px`;
      st.width = `${box.width}px`;
      st.height = `${box.height}px`;
      w = box.width;
      h = box.height;
      // The camera frames his square exactly as before; the rest of the canvas shows what's round it.
      this.camera.aspect = 1;
      if (this.expanded) this.camera.setViewOffset(S, S, -this.sq.left, -this.sq.top, W, H);
      else this.camera.clearViewOffset();
    }
    // Small views (the island's 40 px) need more pixels per pixel to look crisp.
    const small = (room ? this.sq.size : w) < 80;
    const sharp = small ? 2.5 : 1.5;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * sharp, 3));
    this.renderer.setSize(w, h, false);
    this.camera.updateProjectionMatrix();
    this.renderer.getDrawingBufferSize(lookShared.uRes.value);
    lookShared.uWidth.value = (small ? 1.2 : 1.7) * this.renderer.getPixelRatio();
    this.draw();
  }

  private draw(): void {
    const x = this.actor.root.position.x;
    this.key.position.set(x - 1.4, 5, 3.2);
    this.key.target.position.set(x, 0.8, 0);
    lookShared.uLight.value.copy(this.key.position).sub(this.key.target.position).normalize()
      .transformDirection(this.camera.matrixWorldInverse);
    this.renderer.render(this.scene, this.camera);
  }
}
