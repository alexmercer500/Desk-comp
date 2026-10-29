// The shared character engine: evaluates the current state's pose, stacks the
// animation layers from the spec (Section 3) on top, and draws the result into
// one or more canvases. It knows nothing about *why* the state changes; the
// controller (controller.ts) owns that.
//
// Layers, in order:
//   1. base pose of the state, crossfaded from the previous one
//   2. breathing          3. blink          4. gaze
//   5. signature motion (the skin's own pose functions + springy lag)
//   6. one-shot overlays (additive) and particles

import { Ease, clamp, lerp } from "./ease";
import { drawParticles, updateParticles } from "./particles";
import { Spring, criticalSpring } from "./spring";
import { kf } from "./track";
import type { Frame, Particle, Pose, PoseInput, Skin, StateName, Variant } from "./types";

const TAU = Math.PI * 2;

/** Additive one-shot motions that play over any state. */
const OVERLAYS = {
  /** Small "hey!" wiggle, e.g. a tap while working. */
  wiggle: { ms: 450, fn: (k: number): Partial<Pose> => ({ bodyRot: 0.1 * Math.sin(k * TAU * 2) * (1 - k) }) },
  /** 2% squash for the listening pulse while the user types. */
  pulse: { ms: 220, fn: (k: number): Partial<Pose> => ({ sy: -0.02 * Math.sin(Math.PI * k), sx: 0.02 * Math.sin(Math.PI * k) }) },
  /** A little hop sideways while pottering around the corner (the window moves with it). */
  hopLeft: { ms: 380, fn: (k: number): Partial<Pose> => hop(k, -1) },
  hopRight: { ms: 380, fn: (k: number): Partial<Pose> => hop(k, 1) },
} as const;

function hop(k: number, dir: number): Partial<Pose> {
  const air = Math.sin(Math.PI * k);
  const land = k > 0.8 ? Math.sin((Math.PI * (k - 0.8)) / 0.2) : 0;
  return { lift: 0.07 * air, bodyRot: dir * 0.12 * air, sy: 0.04 * air - 0.07 * land, sx: 0.05 * land };
}
export type OverlayName = keyof typeof OVERLAYS;

/** Breathing amplitude and period per state (spec 3.1); everything else breathes like IDLE. */
const BREATH: Partial<Record<StateName, [number, number]>> = {
  IDLE: [0.015, 3.2],
  SLEEPING: [0.025, 5],
  WORKING: [0.01, 1.6],
};

const SLEEP_FPS = 18;
/** Long-lasting states draw at this rate; their motion is slow enough not to
 *  show it. Quick reactions (a tap, a success hop, a notification pop, a drag)
 *  get every frame. */
const STEADY_FPS = 30;
const STEADY: ReadonlySet<StateName> = new Set(["OFF", "IDLE", "ATTENTIVE", "SLEEPY", "WORKING"]);
/** While hidden, the clock still ticks this often (no drawing). */
const HIDDEN_TICK_MS = 250;
/** Headless (another renderer draws), the clock ticks this often, so timed states end on time. */
const HEADLESS_TICK_MS = 50;

/** One blink, 140 ms: close 60 (ease-in), hold 20, open 60 (ease-out). */
const blinkCurve = (ms: number) =>
  kf(ms, [[0, 1], [60, 0.05, Ease.inQuad], [80, 0.05], [140, 1, Ease.outQuad]]);

interface View {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
}

export class Engine {
  private skin: Skin;
  private views: View[] = [];
  private raf = 0;
  private timer = 0;
  private running = false;
  private hidden = false;
  /** Runs the clock (and so the state machine) but never draws: another renderer shows the character. */
  private headless = false;
  private lastFrame = 0;

  private clockMs = 0;
  private state: StateName = "OFF";
  private variant: Variant = null;
  private enteredAt = 0;
  private prevSt = 0;

  private fadeFrom: Pose | null = null;
  private fadeStart = 0;
  private fadeMs = 200;
  private lastBase: Pose;

  private reduced = false;
  private progress: number | null = null;
  private carry = { x: 0, y: 0 };

  private breathPhase = 0;
  private breathAmp = BREATH.IDLE![0];
  private breathPeriod = BREATH.IDLE![1];

  private nextBlink = 0;
  private blinkStart = -Infinity;
  private blinkDouble = false;

  private eyeShown: string;
  private eyePending: string | null = null;
  private eyeMorphStart = -Infinity;

  private gazeX = criticalSpring(0, 120);
  private gazeY = criticalSpring(0, 120);
  private cursor: { x: number; y: number; at: number } | null = null;
  private drift = { x: 0, y: 0, next: 0 };

  private lagX = new Spring(0, 180, 12);
  private lagY = new Spring(0, 180, 12);

  private overlays: { name: OverlayName; start: number }[] = [];
  private particles: Particle[] = [];

  /** Final pose of the last frame, after all layers. */
  pose: Pose;
  /** Called every frame with the engine clock (ms), before the pose is computed. */
  onTick: ((nowMs: number) => void) | null = null;
  /** Where gaze is measured from, in the same coordinates as setGazeTarget. */
  gazeOrigin: (() => { x: number; y: number }) | null = null;

  constructor(skin: Skin) {
    this.skin = skin;
    this.lastBase = { ...skin.rest };
    this.pose = { ...skin.rest, gazeX: 0, gazeY: 0, lagX: 0, lagY: 0 };
    this.eyeShown = skin.restEye;
    this.scheduleBlink();
  }

  // ── Setup ────────────────────────────────────────────────────────────────────

  addView(canvas: HTMLCanvasElement) {
    const g = canvas.getContext("2d");
    if (!g) throw new Error("Canvas 2D is not available");
    this.views.push({ canvas, g });
  }

  setSkin(skin: Skin) {
    this.skin = skin;
    this.fadeFrom = null;
    this.lastBase = { ...skin.rest };
    this.eyeShown = skin.restEye;
    this.eyePending = null;
    this.particles = [];
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      this.schedule(frame);
      const fps = this.frameRate();
      // A little slack, so a 30 fps cap doesn't drop to 20 on a 60 Hz screen's jitter.
      if (fps && now - this.lastFrame < 1000 / fps - 2) return;
      // Hidden: keep the clock (and so the state machine's timers) going in
      // small steps, without drawing. Shown: one step, one frame.
      let left = Math.min(this.hidden ? 1 : 0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      while (left > 1e-6) {
        const dt = Math.min(0.1, left);
        this.step(dt);
        left -= dt;
      }
      if (!this.hidden && !this.headless) this.render();
    };
    this.schedule(frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.raf = 0;
  }

  /** Never draw, only keep time (the 3D character draws itself). */
  setHeadless(headless: boolean) {
    if (headless === this.headless) return;
    this.headless = headless;
    if (!this.running) return;
    this.stop();
    this.start();
  }

  /** Nothing to see (the island is tucked away): stop drawing, keep the clock. */
  setHidden(hidden: boolean) {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (!this.running) return;
    this.stop();
    this.start();
    if (!hidden) this.render(); // straight away, not a frame late
  }

  private schedule(frame: (now: number) => void) {
    if (this.hidden || this.headless) {
      const ms = this.hidden ? HIDDEN_TICK_MS : HEADLESS_TICK_MS;
      this.timer = setTimeout(() => frame(performance.now()), ms) as unknown as number;
    } else this.raf = requestAnimationFrame(frame);
  }

  /**
   * Frames per second worth drawing now (0 = every screen refresh). Sleeping
   * runs slow to save battery (spec 4.12); long-lasting states run at 30 once
   * the crossfade into them is done and nothing is hopping; quick reactions
   * run at full rate.
   */
  private frameRate(): number {
    if (this.state === "SLEEPING") return SLEEP_FPS;
    const settled = this.clockMs - this.fadeStart >= this.fadeMs;
    if (STEADY.has(this.state) && settled && this.overlays.length === 0) return STEADY_FPS;
    return 0;
  }

  /** One frame now, unless nothing's drawn (hidden, or the 3D character draws itself). */
  redraw() {
    if (this.running && !this.hidden && !this.headless) this.render();
  }

  now() {
    return this.clockMs;
  }

  /** Steps the clock by hand in 1/60 s frames and draws once (tests, contact sheets). */
  advance(ms: number) {
    for (let left = ms; left > 0; left -= 1000 / 60) this.step(Math.min(left, 1000 / 60) / 1000);
    this.render();
  }

  // ── Inputs from the controller ───────────────────────────────────────────────

  setState(state: StateName, variant: Variant, fadeMs: number) {
    this.fadeFrom = { ...this.lastBase };
    this.fadeStart = this.clockMs;
    this.fadeMs = this.reduced ? 150 : fadeMs;
    this.state = state;
    this.variant = variant;
    this.enteredAt = this.clockMs;
    this.prevSt = 0;
  }

  overlay(name: OverlayName) {
    if (this.reduced) return;
    this.overlays.push({ name, start: this.clockMs });
  }

  setProgress(value: number | null) {
    this.progress = value === null ? null : clamp(value, 0, 1);
  }

  /** Drag velocity in logical px/s, for the dangle while HELD. */
  setCarry(vx: number, vy: number) {
    this.carry = { x: vx, y: vy };
  }

  setReducedMotion(on: boolean) {
    this.reduced = on;
    if (on) this.particles = [];
  }

  /** Cursor or touch position, in the same space as `gazeOrigin` (screen or client px). */
  setGazeTarget(x: number, y: number) {
    this.cursor = { x, y, at: this.clockMs };
  }

  // ── Frame ────────────────────────────────────────────────────────────────────

  private step(dt: number) {
    this.clockMs += dt * 1000;
    this.onTick?.(this.clockMs);

    const now = this.clockMs;
    const st = now - this.enteredAt;
    const motion = this.reduced ? 0 : 1;
    const input: PoseInput = {
      state: this.state,
      variant: this.variant,
      st,
      t: this.reduced ? 0 : now / 1000,
      motion,
      progress: this.progress,
      carryX: this.carry.x,
      carryY: this.carry.y,
    };

    // 1. Base pose, crossfaded from wherever we were when the state changed.
    const out = this.skin.pose(input);
    let base: Pose = { ...this.skin.rest, ...out.pose } as Pose;
    if (this.fadeFrom) {
      const k = (now - this.fadeStart) / this.fadeMs;
      if (k >= 1) {
        this.fadeFrom = null;
      } else {
        const e = Ease.inOutSine(k);
        const from = this.fadeFrom;
        const blended: Pose = {};
        for (const key in base) blended[key] = lerp(from[key] ?? base[key], base[key], e);
        base = blended;
      }
    }
    this.lastBase = base;
    const pose: Pose = { ...base };

    // 6a. Additive overlays (applied before breathing so squash multiplies cleanly).
    this.overlays = this.overlays.filter((o) => now - o.start < OVERLAYS[o.name].ms);
    for (const o of this.overlays) {
      const def = OVERLAYS[o.name];
      const delta = def.fn((now - o.start) / def.ms);
      for (const key in delta) pose[key] = (pose[key] ?? 0) + (delta[key] ?? 0);
    }

    // 2. Breathing, with volume preservation. Phase and amplitude ease toward the
    //    state's values so switching states never makes the body jump.
    if (motion && this.state !== "OFF") {
      const [a, p] = BREATH[this.state] ?? BREATH.IDLE!;
      const ease = Math.min(1, dt * 3);
      this.breathAmp += (a - this.breathAmp) * ease;
      this.breathPeriod += (p - this.breathPeriod) * ease;
      this.breathPhase = (this.breathPhase + (dt * TAU) / this.breathPeriod) % TAU;
      const s = Math.sin(this.breathPhase) * this.breathAmp;
      pose.sy *= 1 + s;
      pose.sx *= 1 - s * 0.5;
    }

    // Eye shape morph: squash closed, swap shape, open again (70 ms each way).
    if (out.eye !== this.eyeShown && out.eye !== this.eyePending) {
      if (this.reduced) {
        this.eyeShown = out.eye;
      } else {
        this.eyePending = out.eye;
        if (now - this.eyeMorphStart > 140) this.eyeMorphStart = now;
      }
    }
    let morph = 1;
    const ms = now - this.eyeMorphStart;
    if (ms < 140) {
      if (ms >= 70 && this.eyePending) {
        this.eyeShown = this.eyePending;
        this.eyePending = null;
      }
      morph = ms < 70 ? 1 - 0.9 * Ease.inQuad(ms / 70) : 0.1 + 0.9 * Ease.outQuad((ms - 70) / 70);
    } else if (this.eyePending) {
      this.eyeShown = this.eyePending;
      this.eyePending = null;
    }
    pose.eyeMorph = morph;

    // 3. Blink: random 2.5–6 s, 15% double. Suppressed while morphing or when the pose says so.
    let blink = 1;
    if (pose.blink > 0.5 && ms >= 140) {
      if (now >= this.nextBlink) {
        this.blinkStart = now;
        this.blinkDouble = Math.random() < 0.15;
        this.scheduleBlink();
      }
      const b = now - this.blinkStart;
      if (b < 140) blink = blinkCurve(b);
      else if (this.blinkDouble && b >= 320 && b < 460) blink = blinkCurve(b - 320);
    } else if (now >= this.nextBlink) {
      // Suppressed: push the next blink out so it doesn't fire the moment we resume.
      this.scheduleBlink();
    }
    pose.eyeOpen *= blink;

    // 4. Gaze: cursor if it moved recently, random drift in IDLE, else centre;
    //    the pose can lock it (e.g. looking up-left while thinking).
    let gx = 0, gy = 0;
    if (this.cursor && now - this.cursor.at < 2500) {
      [gx, gy] = this.cursorDirection();
    } else if (this.state === "IDLE" && motion) {
      if (now >= this.drift.next) {
        const centre = Math.random() < 0.3;
        this.drift.x = centre ? 0 : (Math.random() * 2 - 1) * 0.8;
        this.drift.y = centre ? 0 : (Math.random() * 2 - 1) * 0.5;
        this.drift.next = now + 2000 + Math.random() * 2000;
      }
      gx = this.drift.x;
      gy = this.drift.y;
    }
    gx = lerp(gx, pose.gazeLockX, pose.gazeLock);
    gy = lerp(gy, pose.gazeLockY, pose.gazeLock);
    pose.gazeX = this.gazeX.step(gx, dt);
    pose.gazeY = this.gazeY.step(gy, dt);

    // Reduced motion: no hops, spins, sways or squash. Opacity and eyes only.
    if (!motion) {
      pose.lift = 0;
      pose.bodyX = 0;
      pose.bodyRot = 0;
      pose.sx = 1;
      pose.sy = 1;
    }

    // 5. Secondary motion: a springy follower of the body's top, for steam, antennae, wings.
    const topX = pose.bodyX + Math.sin(pose.bodyRot) * pose.sy;
    const topY = pose.lift + (pose.sy - 1);
    pose.lagX = motion ? this.lagX.step(topX, dt) - topX : 0;
    pose.lagY = motion ? this.lagY.step(topY, dt) - topY : 0;

    // 6b. Particles.
    if (motion && this.skin.events) {
      this.skin.events(input, this.prevSt, (p) => this.particles.push({ rot: 0, spin: 0, ...p, age: 0 }), pose);
    }
    this.prevSt = st;
    this.particles = updateParticles(this.particles, dt);

    this.pose = pose;
  }

  private render() {
    const dpr = globalThis.devicePixelRatio || 1;
    for (const v of this.views) {
      const size = v.canvas.clientWidth;
      if (!size) continue;
      const px = Math.round(size * dpr);
      if (v.canvas.width !== px || v.canvas.height !== px) {
        v.canvas.width = px;
        v.canvas.height = px;
      }
      const g = v.g;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size, size);
      const frame: Frame = {
        U: size / this.skin.fit.units,
        ox: size / 2,
        oy: size * this.skin.fit.base,
        size,
        t: this.reduced ? 0 : this.clockMs / 1000,
        detail: clamp((size - 56) / 120, 0, 1),
      };
      g.save();
      g.globalAlpha = clamp(this.pose.fade, 0, 1);
      if (g.globalAlpha > 0.001) this.skin.draw(g, this.pose, this.eyeShown, frame);
      drawParticles(g, this.particles, frame);
      g.restore();
    }
  }

  private scheduleBlink() {
    this.nextBlink = this.clockMs + 2500 + Math.random() * 3500;
  }

  /** Direction from the character to the cursor, −1…1 per axis, softening near the character. */
  private cursorDirection(): [number, number] {
    const c = this.cursor!;
    let origin = this.gazeOrigin?.();
    if (!origin) {
      const v = this.views[0];
      if (!v) return [0, 0];
      const r = v.canvas.getBoundingClientRect();
      origin = { x: r.left + r.width / 2, y: r.top + r.height * 0.55 };
    }
    const dx = c.x - origin.x, dy = c.y - origin.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return [0, 0];
    const k = len / (len + 140);
    return [(dx / len) * k, (dy / len) * k];
  }
}
