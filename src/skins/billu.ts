// Billu, the space cat: a chubby ginger cat sitting on top of a little silver
// flying saucer. The saucer does the travelling (hover, banking, a tractor beam
// that scans while working, a ring of rim lights that chase, fill with
// progress and flash); the cat does the feelings (ears, tail, paws, eyes).
//
// Signature bits: grooming a paw in idle, the slow cat blink, waving a paw at
// you, flattened ears when something goes wrong, curling up into a loaf on the
// landed saucer to sleep, the tail draped over the rim.
//
// Drawing space: units, origin on the ground under the saucer, y down. The
// saucer is drawn around its centre, which rises with `hover` (0 landed, 1 flying).

import { Ease, clamp, lerp } from "../engine/ease";
import { hash01, kf } from "../engine/track";
import type { Emit, Frame, Pose, PoseInput, PoseOut, Skin } from "../engine/types";
import {
  DEG, ENGINE_REST, TAU, confusedTilt, crossedAt, dizzyWobble, errorSlump, heldSwing,
  notifyPop, sleepyFace, successHop, touchSquash, wakeBlink, workNod,
} from "./common";

const C = {
  fur: "#F0A35E",
  furLight: "#F9C893",
  furDark: "#C46F33",
  cream: "#FFF1DE",
  innerEar: "#F4AFA8",
  nose: "#E7848A",
  eye: "#2A1F1A",
  hull: "#B4C2E2",
  hullLight: "#E6ECF9",
  hullDark: "#7A8AB6",
  hullEdge: "#56658F",
  under: "#65749E",
  light: "255,212,102", // warm rim lights
  beam: "150,228,255",
};

/** Saucer centre height above the ground when landed, and how much higher in flight. */
const LANDED_Y = 0.13;
const FLIGHT_RISE = 0.2;
/** The deck the cat sits on, above the saucer centre. */
const DECK_Y = -0.035;
/** Head centre above the cat's base. */
const HEAD_Y = -0.33;
/** Rim lights along the front of the saucer. */
const LIGHTS = 7;

// ── Pose ──────────────────────────────────────────────────────────────────────

const rest: Pose = {
  ...ENGINE_REST,
  hover: 1,
  eyeScale: 1, eyeScaleL: 1, eyeScaleR: 1, eyeTilt: 0,
  mouthCurve: 0.5, mouthO: 0,
  /** >0 flattens / droops the ear, <0 perks it up. */
  earL: 0, earR: 0,
  /** Tail sway (−1…1), lift of its tip, fluffed-up thickness. */
  tail: 0, tailUp: 0, tailPuff: 0,
  /** 1 = curled up asleep in a loaf. */
  curl: 0,
  /** The cat on the deck: hop, squash and stretch, head tilt and height. */
  catY: 0, catSX: 1, catSY: 1, headTilt: 0, headY: 0,
  /** Right paw: to the mouth (grooming) or up beside the head (waving). */
  groom: 0, wave: 0, waveRot: 0,
  whisk: 0,
  /** Saucer: rim light brightness, chase position, all-on flash, progress fill (0 = chase). */
  lights: 0.8, lightPhase: 0, flash: 0, fill: 0,
  /** Tractor beam strength and swing (radians). */
  beam: 0, beamAng: 0,
};

/** The saucer's lazy hover: a slow bob and a gentle rock. */
const bob = (t: number, amp: number, m: number) => ({
  lift: 0.03 * Math.sin(t * 1.4) * amp * m,
  bodyX: 0.02 * Math.sin(t * 0.7) * amp * m,
  bodyRot: 2.5 * DEG * Math.sin(t * 0.9) * amp * m,
});

/** A quick twitch of one ear every few seconds. */
function earTwitch(t: number): { earL: number; earR: number } {
  const n = Math.floor(t / 3.7);
  const k = t - n * 3.7;
  const amt = k < 0.25 ? Math.sin((Math.PI * k) / 0.25) * 0.5 : 0;
  return hash01(n + 3) < 0.5 ? { earL: amt, earR: 0 } : { earL: 0, earR: amt };
}

/** A lazy tail swish. */
const tailSway = (t: number, m: number, rate = 1) => 0.45 * Math.sin(t * 1.1 * rate) * m;

/** Two flashes, 420 ms each, at the start of a 1.2 s cycle (always < 3 per second). */
const doubleFlash = (st: number) => {
  const k = st >= 400 ? (st - 400) % 1200 : Infinity;
  return k < 840 ? Math.abs(Math.sin((Math.PI * k) / 420)) : 0;
};

function pose(i: PoseInput): PoseOut {
  const { st, t, motion: m } = i;

  switch (i.state) {
    case "OFF":
      return { pose: { fade: 0 }, eye: "round" };

    case "BOOTING":
      // The saucer drops in from above with its lights coming on one by one,
      // the beam flicks on and off, the cat pops up, opens its eyes and perks.
      return {
        pose: {
          fade: kf(st, [[0, 0], [200, 1]]),
          lift: kf(st, [[0, 0.5], [700, 0, Ease.outBack]]) * m,
          lights: kf(st, [[0, 0], [700, 1]]),
          fill: kf(st, [[0, 0], [700, 1], [900, 0]]),
          beam: kf(st, [[600, 0], [750, 0.9], [1000, 0]]),
          catSY: kf(st, [[700, 0.6], [950, 1.1, Ease.outQuad], [1200, 1, Ease.outElastic]]),
          catSX: kf(st, [[700, 1.2], [950, 0.95, Ease.outQuad], [1200, 1, Ease.outElastic]]),
          eyeOpen: kf(st, [[1000, 0.06], [1200, 1]]),
          earL: kf(st, [[900, 0.6], [1200, -0.4, Ease.outBack], [1500, 0]]),
          earR: kf(st, [[900, 0.6], [1200, -0.4, Ease.outBack], [1500, 0]]),
          blink: 0,
        },
        eye: st >= 1300 && st < 1700 ? "happy" : "round",
      };

    case "IDLE": {
      // Every 16 s one little cat thing: groom a paw, look around, or a slow blink.
      const cycle = Math.floor(t / 16);
      const into = t - cycle * 16;
      const act = Math.floor(hash01(cycle + 11) * 3);
      const w = into < 2.6 ? Math.sin((Math.PI * into) / 2.6) : 0;
      const base = {
        ...bob(t, 1, m),
        ...earTwitch(t),
        tail: tailSway(t, m),
        lightPhase: t * 1.2,
        lights: 0.8,
      };
      if (act === 0) {
        // Grooming: paw to the mouth, a few licks, eyes shut.
        const lick = w > 0.5 ? 0.04 * Math.sin(TAU * 3 * into) * m : 0;
        return {
          pose: { ...base, groom: w, headTilt: (-8 * DEG + lick) * w, headY: 0.01 * w, blink: 0 },
          eye: into > 0.5 && into < 2.2 ? "closed" : "round",
        };
      }
      if (act === 1) {
        return {
          pose: { ...base, gazeLock: w, gazeLockX: into < 1.3 ? -0.9 : 0.9, gazeLockY: -0.1, headTilt: (into < 1.3 ? -4 : 4) * DEG * w },
          eye: "round",
        };
      }
      // The slow cat blink: "I like you".
      return { pose: { ...base, eyeOpen: 1 - 0.88 * w, blink: w > 0.05 ? 0 : 1 }, eye: "round" };
    }

    case "ATTENTIVE":
      return {
        pose: { ...bob(t, 0.5, m), earL: -0.5, earR: -0.5, eyeScale: 1.08, tail: tailSway(t, m, 0.6), tailUp: 0.4, lights: 0.95, lightPhase: t * 1.6 },
        eye: "round",
      };

    case "TOUCHED": {
      if (i.variant === "dizzy") {
        // The saucer wobbles round, the lights spin, the cat sees stars.
        return {
          pose: {
            bodyRot: dizzyWobble(st, m) * 1.4,
            headTilt: dizzyWobble(st + 150, m),
            lightPhase: st / 60,
            lights: 1,
            earL: 0.5, earR: -0.2,
            mouthO: st >= 1200 ? 0.3 : 0,
            tailPuff: 0.5,
            blink: 0,
          },
          eye: st < 1200 ? "spiral" : "closed",
        };
      }
      // A squish and a happy "mrrp": ears back for a moment, lights flash.
      return {
        pose: {
          ...touchSquash(st),
          earL: kf(st, [[0, 0], [100, 0.7], [450, 0, Ease.outBack]]),
          earR: kf(st, [[0, 0], [100, 0.7], [450, 0, Ease.outBack]]),
          mouthO: kf(st, [[100, 0], [200, 0.35], [450, 0]]),
          flash: kf(st, [[0, 0], [120, 0.8], [500, 0]]),
          tail: tailSway(t, m, 2),
          mouthCurve: 1,
        },
        eye: st >= 120 && st < 600 ? "happy" : "round",
      };
    }

    case "WORKING": {
      // The saucer banks round a little circle, scanning with its beam; the
      // lights chase (or fill up with progress); the cat leans in, focused.
      const nod = workNod(st);
      return {
        pose: {
          bodyX: 0.08 * Math.sin(t * 1.6) * m,
          lift: (0.03 * Math.sin(t * 3.2) - nod * 0.015) * m,
          bodyRot: 6 * DEG * Math.cos(t * 1.6) * m,
          beam: kf(st, [[0, 0], [300, 0.85]]),
          beamAng: 0.32 * Math.sin(t * 2.4) * m,
          lights: 1,
          lightPhase: t * 6,
          fill: i.progress ?? 0,
          headTilt: (3 * DEG + nod * 5 * DEG) * m,
          earL: -0.4, earR: -0.4,
          tail: (0.2 + 0.35 * Math.sin(t * 4.2)) * m,
          eyeOpen: 0.8,
          mouthCurve: 0.2,
          gazeLock: 0.6, gazeLockX: 0.6 * Math.sin(t * 2.4), gazeLockY: 0.5,
        },
        eye: "focus",
      };
    }

    case "SUCCESS":
      // Saucer hops, every light flashes, the cat bounces and waves.
      return {
        pose: {
          ...successHop(st, m),
          catY: kf(st, [[150, 0], [300, 0.06, Ease.outCubic], [450, 0, Ease.inQuad]]) * m,
          wave: kf(st, [[200, 0], [400, 1, Ease.outBack], [1300, 1], [1600, 0]]),
          waveRot: (st / 1000) * TAU * 3,
          flash: kf(st, [[0, 0], [150, 1], [700, 0]]),
          lights: 1,
          lightPhase: t * 3,
          earL: -0.6, earR: -0.6,
          tailUp: 1,
          tail: 0.15 * Math.sin(t * 6) * m,
          mouthO: kf(st, [[200, 0], [350, 0.3], [700, 0]]),
          mouthCurve: 1,
        },
        eye: "happy",
      };

    case "SUGGESTING":
      // Drifts toward the suggestions (assumed to the right) and points a paw.
      return {
        pose: {
          bodyX: kf(st, [[0, 0], [500, 0.12, Ease.inOutSine]]) * m,
          lift: 0.02 * Math.sin(t * 1.4) * m,
          bodyRot: kf(st, [[0, 0], [300, 6 * DEG, Ease.outBack]]),
          wave: kf(st, [[200, 0], [500, 0.65, Ease.outBack]]),
          eyeScaleL: 0.95, eyeScaleR: 1.12,
          gazeLock: 0.8, gazeLockX: 0.8, gazeLockY: 0.2,
          earL: -0.3, earR: -0.5,
          tail: tailSway(t, m, 0.7),
          lights: 0.9,
          lightPhase: t * 1.5,
        },
        eye: "round",
      };

    case "CONFUSED":
      return {
        pose: {
          ...bob(t, 0.5, m),
          headTilt: confusedTilt(st) * 2,
          earL: 0.6, earR: -0.3,
          tail: 0.15 * Math.sin(t * 0.8) * m,
          tailUp: -0.3,
          lights: 0.45,
          lightPhase: t * 0.6,
          eyeTilt: 1,
          eyeScaleL: 1.08, eyeScaleR: 0.92,
          mouthCurve: -0.2,
        },
        eye: "round",
      };

    case "ERROR": {
      // The saucer sputters: lights flicker, it dips and puffs smoke; ears go
      // flat; then the cat shakes it off.
      const flicker = st < 1000 ? 0.35 + 0.45 * Math.abs(Math.cos((TAU * st) / 380)) : 0.8;
      return {
        pose: {
          ...errorSlump(st, m),
          hover: kf(st, [[0, 1], [300, 0.7], [2000, 0.7], [2600, 1, Ease.outCubic]]),
          bodyRot: kf(st, [[0, 0], [300, -7 * DEG, Ease.outQuad], [2000, -7 * DEG], [2600, 0, Ease.outBack]]) + errorSlump(st, m).bodyRot!,
          lights: flicker,
          lightPhase: 0,
          earL: kf(st, [[0, 0], [200, 1], [2200, 1], [2700, 0]]),
          earR: kf(st, [[0, 0], [200, 1], [2200, 1], [2700, 0]]),
          tailUp: -0.4,
          tailPuff: kf(st, [[0, 0], [200, 0.8], [1500, 0]]),
          eyeTilt: kf(st, [[0, 0], [200, 1], [2200, 1], [2700, 0]]),
          mouthCurve: -0.3,
        },
        eye: "round",
      };
    }

    case "NOTIFY": {
      if (i.variant === "ack") {
        return { pose: { lights: 1, mouthCurve: 1, wave: kf(i.st, [[0, 0.6], [500, 0]]), earL: -0.4, earR: -0.4 }, eye: "happy" };
      }
      // Pops toward the viewer; on every pulse the lights flash twice and the
      // cat waves; the beam blinks.
      const n = notifyPop(st);
      const flash = doubleFlash(st);
      return {
        pose: {
          sx: n.scale, sy: n.scale,
          lift: (n.hop + n.pulse * 0.02) * m,
          flash: flash * 0.9,
          lights: 1,
          lightPhase: t * 4,
          beam: 0.5 * flash,
          wave: kf(st, [[0, 0], [300, 0.85, Ease.outBack]]),
          waveRot: (st / 1000) * TAU * 2.2,
          earL: -0.7, earR: -0.7,
          tailUp: 0.7,
          mouthO: 0.25,
        },
        eye: "wide",
      };
    }

    case "SLEEPY": {
      const f = sleepyFace(st);
      return {
        pose: {
          hover: 0.55,
          ...bob(t, 0.4, m),
          mouthO: f.yawn * 0.8,
          eyeOpen: f.eyeOpen,
          earL: 0.35, earR: 0.35,
          headY: 0.015,
          tail: tailSway(t, m, 0.4),
          lights: 0.4,
          lightPhase: t * 0.5,
          blink: 0,
        },
        eye: "half",
      };
    }

    case "SLEEPING":
      // Lands, curls into a loaf with the tail round its paws; the lights
      // breathe very slowly.
      return {
        pose: {
          hover: kf(st, [[0, 0.55], [1200, 0, Ease.inQuad]]),
          curl: kf(st, [[400, 0], [1600, 1, Ease.inOutSine]]),
          headY: kf(st, [[400, 0.015], [1600, 0.07, Ease.inOutSine]]),
          headTilt: kf(st, [[400, 0], [1600, -6 * DEG, Ease.inOutSine]]),
          earL: 0.4, earR: 0.4,
          lights: 0.12 + 0.08 * Math.sin((TAU * t) / 5),
          lightPhase: 0,
          blink: 0,
        },
        eye: "closed",
      };

    case "WAKING":
      // A big stretch, a double blink, lights on, lift off.
      return {
        pose: {
          blink: 0,
          eyeOpen: wakeBlink(st),
          hover: kf(st, [[0, 0], [600, 1, Ease.outBack]]),
          catSY: kf(st, [[0, 1], [250, 1.14, Ease.outQuad], [550, 1, Ease.outElastic]]),
          catSX: kf(st, [[0, 1], [250, 0.92, Ease.outQuad], [550, 1, Ease.outElastic]]),
          mouthO: kf(st, [[0, 0], [200, 0.4], [450, 0]]),
          earL: kf(st, [[0, 0.4], [300, -0.5], [600, 0]]),
          earR: kf(st, [[0, 0.4], [300, -0.5], [600, 0]]),
          tailUp: kf(st, [[0, 0], [300, 0.8], [600, 0]]),
          lights: kf(st, [[0, 0.15], [500, 0.9]]),
        },
        eye: "round",
      };

    case "HELD":
      // Picked up, saucer and all: it swings; the cat holds on, ears back, tail fluffed.
      return {
        pose: {
          ...heldSwing(i, 0.8),
          lights: 1,
          lightPhase: t * 8,
          earL: 0.7, earR: 0.7,
          tailPuff: 1,
          tailUp: 0.5,
          mouthO: 0.3,
        },
        eye: "wide",
      };

    case "LANDING":
      // It hovers, so a drop is a startled bob and a shake of the ears.
      return {
        pose: {
          lift: kf(st, [[0, 0.04], [120, -0.03, Ease.inQuad], [450, 0, Ease.outBack]]) * m,
          sy: kf(st, [[0, 1.04], [120, 0.92, Ease.outQuad], [450, 1, Ease.outElastic]]),
          sx: kf(st, [[0, 0.97], [120, 1.06, Ease.outQuad], [450, 1, Ease.outElastic]]),
          earL: kf(st, [[0, 0.6], [450, 0]]),
          earR: kf(st, [[0, 0.6], [450, 0]]),
          lights: 0.95,
        },
        eye: st < 160 ? "closed" : "round",
      };
  }
}

/** Saucer centre height above the ground. */
const saucerY = (p: Pose) => LANDED_Y + FLIGHT_RISE * p.hover + p.lift;

/** Where the cat's head is, in particle units (y up from the ground). */
const headAt = (p: Pose) => ({ x: p.bodyX, y: saucerY(p) - DECK_Y - HEAD_Y + p.catY - p.headY });

function events(i: PoseInput, prev: number, emit: Emit, p: Pose) {
  const crossed = crossedAt(prev, i.st);
  const head = headAt(p);
  const sy = saucerY(p);
  switch (i.state) {
    case "WORKING": {
      // The beam's spot on the ground leaves soft dots as it scans.
      const n = Math.floor(i.st / 140);
      if (i.st > 300 && crossed(n * 140)) {
        const x = p.bodyX + Math.sin(p.beamAng) * (sy - 0.1);
        emit({ kind: "glow", x, y: 0.02, vx: 0, vy: 0.05, size: 0.05, life: 0.5 });
      }
      break;
    }
    case "SUCCESS":
      if (crossed(250)) {
        for (let k = 0; k < 4; k++) {
          const a = -Math.PI / 2 + (k - 1.5) * 0.7;
          emit({ kind: "sparkle", x: head.x + Math.cos(a) * 0.2, y: head.y + 0.1 - Math.sin(a) * 0.1, vx: Math.cos(a) * 0.3, vy: 0.25, size: 0.065, life: 0.9, spin: 2 });
        }
      }
      break;
    case "TOUCHED":
      if (i.variant === "dizzy" && crossed(40)) {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * TAU;
          emit({ kind: "star", x: head.x + Math.cos(a) * 0.22, y: head.y + 0.17 + Math.sin(a) * 0.05, vx: -Math.sin(a) * 0.3, vy: 0.05, size: 0.06, life: 1.1, spin: 3 });
        }
      }
      break;
    case "ERROR":
      // Two puffs of smoke from the sputtering saucer.
      for (const at of [150, 650]) {
        if (crossed(at)) emit({ kind: "puff", x: p.bodyX + 0.42, y: sy, vx: 0.2, vy: 0.15, size: 0.08, life: 0.9 });
      }
      break;
    case "SLEEPING":
      if (i.st >= 1800) {
        const n = Math.floor((i.st - 1800) / 4000);
        if (crossed(1800 + n * 4000)) emit({ kind: "z", x: head.x + 0.15, y: head.y + 0.12, vx: 0.07, vy: 0.1, size: 0.08, life: 3.2 });
      }
      break;
  }
}

// ── Drawing ───────────────────────────────────────────────────────────────────

/** The sitting cat's body, base at the origin. */
const BODY = (() => {
  const p = new Path2D();
  p.moveTo(-0.15, 0);
  p.bezierCurveTo(-0.17, -0.12, -0.12, -0.22, 0, -0.23);
  p.bezierCurveTo(0.12, -0.22, 0.17, -0.12, 0.15, 0);
  p.quadraticCurveTo(0, 0.022, -0.15, 0);
  p.closePath();
  return p;
})();

/** One ear, base centred at the origin, pointing up. */
const EAR = (() => {
  const p = new Path2D();
  p.moveTo(-0.058, 0.01);
  p.quadraticCurveTo(-0.03, -0.09, 0.006, -0.125);
  p.quadraticCurveTo(0.04, -0.07, 0.058, 0.01);
  p.closePath();
  return p;
})();

const EAR_INNER = (() => {
  const p = new Path2D();
  p.moveTo(-0.032, 0.0);
  p.quadraticCurveTo(-0.015, -0.06, 0.004, -0.088);
  p.quadraticCurveTo(0.024, -0.05, 0.034, 0.0);
  p.closePath();
  return p;
})();

function draw(g: CanvasRenderingContext2D, p: Pose, eye: string, f: Frame) {
  const { U, ox, oy } = f;
  const H = saucerY(p);
  const bx = ox + p.bodyX * U;

  // Ground shadow (smaller and fainter the higher it flies) and the beam's spot.
  {
    const k = clamp(1 - (H - LANDED_Y) * 2.2, 0.35, 1);
    g.save();
    g.translate(bx, oy);
    g.scale(U, U);
    const r = 0.3 * (0.6 + 0.4 * k);
    const sh = g.createRadialGradient(0, 0, 0, 0, 0, r);
    sh.addColorStop(0, `rgba(40,45,80,${0.24 * k})`);
    sh.addColorStop(1, "rgba(40,45,80,0)");
    g.fillStyle = sh;
    g.beginPath();
    g.ellipse(0, 0, r, r * 0.18, 0, 0, TAU);
    g.fill();
    g.restore();
  }

  g.save();
  g.translate(bx, oy - H * U);
  g.scale(U, U);
  g.rotate(p.bodyRot);
  g.scale(p.sx, p.sy);

  if (p.beam > 0.01) drawBeam(g, p, H);
  drawSaucer(g, p, f);
  // The tail comes from behind the cat and drapes over the rim; curled up
  // asleep, it wraps round the front of the paws instead.
  const tailInFront = p.curl > 0.5;
  if (!tailInFront) drawTail(g, p);
  drawCat(g, p, eye, f);
  if (tailInFront) drawTail(g, p);
  g.restore();
}

function drawBeam(g: CanvasRenderingContext2D, p: Pose, H: number) {
  const len = Math.max(0.06, H - 0.1);
  g.save();
  g.translate(0, 0.1);
  g.rotate(p.beamAng);
  const grad = g.createLinearGradient(0, 0, 0, len);
  grad.addColorStop(0, `rgba(${C.beam},${0.5 * p.beam})`);
  grad.addColorStop(1, `rgba(${C.beam},${0.08 * p.beam})`);
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(-0.06, 0);
  g.lineTo(0.06, 0);
  g.lineTo(0.17, len);
  g.lineTo(-0.17, len);
  g.closePath();
  g.fill();
  // The spot where it meets the ground.
  const spot = g.createRadialGradient(0, len, 0, 0, len, 0.18);
  spot.addColorStop(0, `rgba(${C.beam},${0.4 * p.beam})`);
  spot.addColorStop(1, `rgba(${C.beam},0)`);
  g.fillStyle = spot;
  g.beginPath();
  g.ellipse(0, len, 0.18, 0.04, 0, 0, TAU);
  g.fill();
  g.restore();
}

function drawSaucer(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  // Underside bowl, with the beam emitter glowing in it.
  g.fillStyle = C.under;
  g.beginPath();
  g.ellipse(0, 0.04, 0.2, 0.075, 0, 0, Math.PI);
  g.fill();
  const em = 0.25 + 0.75 * clamp(p.beam, 0, 1);
  g.fillStyle = `rgba(${C.beam},${0.35 + 0.55 * em})`;
  g.beginPath();
  g.ellipse(0, 0.1, 0.07 + 0.02 * em, 0.018, 0, 0, TAU);
  g.fill();

  // The disc.
  const disc = g.createLinearGradient(0, -0.1, 0, 0.11);
  disc.addColorStop(0, C.hullLight);
  disc.addColorStop(0.45, C.hull);
  disc.addColorStop(1, C.hullDark);
  g.fillStyle = disc;
  g.beginPath();
  g.ellipse(0, 0, 0.46, 0.105, 0, 0, TAU);
  g.fill();
  g.strokeStyle = C.hullEdge;
  g.lineWidth = 0.012;
  g.stroke();

  // A seam round the rim, where the lights sit.
  if (f.detail > 0.25) {
    g.strokeStyle = `rgba(86,101,143,${0.5 * f.detail})`;
    g.lineWidth = 0.006;
    g.beginPath();
    g.ellipse(0, 0.012, 0.41, 0.075, 0, 0.05 * Math.PI, 0.95 * Math.PI);
    g.stroke();
  }

  drawLights(g, p);

  // The deck the cat sits on.
  const deck = g.createLinearGradient(0, DECK_Y - 0.06, 0, DECK_Y + 0.06);
  deck.addColorStop(0, "#F2F5FC");
  deck.addColorStop(1, "#C3CEE8");
  g.fillStyle = deck;
  g.beginPath();
  g.ellipse(0, DECK_Y, 0.29, 0.058, 0, 0, TAU);
  g.fill();
  g.strokeStyle = "rgba(86,101,143,0.45)";
  g.lineWidth = 0.008;
  g.stroke();
}

function drawLights(g: CanvasRenderingContext2D, p: Pose) {
  const I = clamp(p.lights, 0, 1);
  for (let k = 0; k < LIGHTS; k++) {
    const a = Math.PI * (0.12 + (0.76 * k) / (LIGHTS - 1));
    // Left to right across the front of the rim.
    const x = -0.41 * Math.cos(a);
    const y = 0.012 + 0.075 * Math.sin(a);
    let b: number;
    if (p.fill > 0.01) {
      b = (k + 0.5) / LIGHTS <= p.fill ? 1 : 0.2;
    } else {
      const c = Math.max(0, Math.cos(p.lightPhase - k * 0.9));
      b = 0.3 + 0.7 * c * c;
    }
    const v = clamp(I * b + p.flash, 0, 1);
    const halo = g.createRadialGradient(x, y, 0, x, y, 0.055);
    halo.addColorStop(0, `rgba(${C.light},${0.55 * v})`);
    halo.addColorStop(1, `rgba(${C.light},0)`);
    g.fillStyle = halo;
    g.beginPath();
    g.arc(x, y, 0.055, 0, TAU);
    g.fill();
    g.fillStyle = `rgba(${C.light},${0.35 + 0.65 * v})`;
    g.beginPath();
    g.ellipse(x, y, 0.021, 0.016, 0, 0, TAU);
    g.fill();
    g.fillStyle = `rgba(255,250,235,${0.8 * v})`;
    g.beginPath();
    g.arc(x - 0.005, y - 0.004, 0.007, 0, TAU);
    g.fill();
  }
}

function drawCat(g: CanvasRenderingContext2D, p: Pose, eye: string, f: Frame) {
  const curl = clamp(p.curl, 0, 1);
  g.save();
  g.translate(0, DECK_Y - p.catY);
  g.scale(p.catSX * (1 + 0.12 * curl), p.catSY * (1 - 0.3 * curl));

  // Body with a soft highlight, cream chest.
  const bg = g.createRadialGradient(-0.06, -0.17, 0.02, 0, -0.08, 0.26);
  bg.addColorStop(0, C.furLight);
  bg.addColorStop(0.5, C.fur);
  bg.addColorStop(1, C.furDark);
  g.fillStyle = bg;
  g.fill(BODY);
  g.fillStyle = C.cream;
  g.beginPath();
  g.ellipse(0, -0.085, 0.07, 0.075, 0, 0, TAU);
  g.fill();

  // Front paws (the right one may be busy).
  const busy = Math.max(p.groom, p.wave) > 0.03;
  drawPaw(g, -0.048, -0.012);
  if (!busy) drawPaw(g, 0.048, -0.012);
  g.restore();

  // Head, on its own transform so it can tilt; it sinks a little when curled up.
  g.save();
  g.translate(0, DECK_Y - p.catY + HEAD_Y * p.catSY * (1 - 0.3 * curl) + p.headY);
  g.rotate(p.headTilt);
  drawHead(g, p, eye, f);
  g.restore();

  if (busy) drawArm(g, p);
}

function drawPaw(g: CanvasRenderingContext2D, x: number, y: number) {
  g.fillStyle = C.cream;
  g.beginPath();
  g.ellipse(x, y, 0.04, 0.026, 0, 0, TAU);
  g.fill();
  g.strokeStyle = "rgba(196,111,51,0.55)";
  g.lineWidth = 0.006;
  g.stroke();
}

/** The right front leg, raised to groom or to wave. */
function drawArm(g: CanvasRenderingContext2D, p: Pose) {
  const base = DECK_Y - p.catY;
  const rest = { x: 0.048, y: -0.012 };
  const mouth = { x: 0.02, y: HEAD_Y + 0.07 + p.headY };
  const up = { x: 0.21, y: HEAD_Y - 0.04 };
  const gm = clamp(p.groom, 0, 1);
  const wv = clamp(p.wave, 0, 1);
  const px = rest.x + (mouth.x - rest.x) * gm + (up.x - rest.x) * wv + 0.035 * Math.sin(p.waveRot) * wv;
  const py = rest.y + (mouth.y - rest.y) * gm + (up.y - rest.y) * wv;
  g.save();
  g.translate(0, base);
  g.strokeStyle = C.fur;
  g.lineWidth = 0.062;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(0.07, -0.15);
  g.quadraticCurveTo(lerp(0.12, 0.14, wv), lerp(-0.1, -0.22, wv), px, py);
  g.stroke();
  drawPaw(g, px, py);
  g.restore();
}

function drawHead(g: CanvasRenderingContext2D, p: Pose, eye: string, f: Frame) {
  // Ears behind the head.
  for (const side of [-1, 1] as const) {
    const ear = side < 0 ? p.earL : p.earR;
    const flat = Math.max(0, ear);
    const perk = Math.max(0, -ear);
    g.save();
    g.translate(side * 0.095, -0.085);
    g.rotate(side * (0.22 + 0.95 * flat - 0.18 * perk) - p.lagX * 1.5);
    g.scale(1, 1 - 0.25 * flat + 0.08 * perk);
    g.fillStyle = C.fur;
    g.fill(EAR);
    g.strokeStyle = C.furDark;
    g.lineWidth = 0.008;
    g.stroke(EAR);
    g.fillStyle = C.innerEar;
    g.fill(EAR_INNER);
    g.restore();
  }

  // Head with cheek fluff.
  const hg = g.createRadialGradient(-0.05, -0.06, 0.01, 0, 0, 0.2);
  hg.addColorStop(0, C.furLight);
  hg.addColorStop(0.6, C.fur);
  hg.addColorStop(1, C.furDark);
  g.fillStyle = hg;
  g.beginPath();
  g.ellipse(0, 0, 0.165, 0.14, 0, 0, TAU);
  g.fill();
  for (const side of [-1, 1] as const) {
    g.beginPath();
    g.arc(side * 0.14, 0.04, 0.045, 0, TAU);
    g.fill();
  }

  // Forehead stripes.
  if (f.detail > 0.3) {
    g.strokeStyle = `rgba(196,111,51,${0.75 * f.detail})`;
    g.lineWidth = 0.013;
    g.lineCap = "round";
    g.beginPath();
    for (const x of [-0.035, 0, 0.035]) {
      g.moveTo(x, -0.125);
      g.lineTo(x * 1.15, -0.085 + Math.abs(x) * 0.4);
    }
    g.stroke();
  }

  // Muzzle, blush.
  g.fillStyle = C.cream;
  g.beginPath();
  g.ellipse(0, 0.058, 0.078, 0.046, 0, 0, TAU);
  g.fill();
  for (const side of [-1, 1] as const) {
    g.fillStyle = "rgba(244,150,140,0.35)";
    g.beginPath();
    g.ellipse(side * 0.112, 0.04, 0.026, 0.014, 0, 0, TAU);
    g.fill();
  }

  // Eyes follow the gaze a little.
  const fx = p.gazeX * 0.025;
  const fy = p.gazeY * 0.015;
  for (const side of [-1, 1] as const) drawEye(g, fx + side * 0.068, -0.012 + fy, side, eye, p, f.t);

  // Nose and the little "w" mouth (or an open "meow").
  g.save();
  g.translate(fx * 0.6, fy * 0.6);
  g.fillStyle = C.nose;
  g.beginPath();
  g.moveTo(-0.017, 0.03);
  g.lineTo(0.017, 0.03);
  g.lineTo(0, 0.048);
  g.closePath();
  g.fill();
  if (p.mouthO > 0.05) {
    g.fillStyle = "#7A3B35";
    g.beginPath();
    g.ellipse(0, 0.072, 0.017 + 0.008 * p.mouthO, 0.006 + 0.026 * p.mouthO, 0, 0, TAU);
    g.fill();
  } else {
    const c = 0.012 * p.mouthCurve;
    g.strokeStyle = C.eye;
    g.lineWidth = 0.009;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(0, 0.048);
    g.quadraticCurveTo(-0.006, 0.066 + c, -0.024, 0.06);
    g.moveTo(0, 0.048);
    g.quadraticCurveTo(0.006, 0.066 + c, 0.024, 0.06);
    g.stroke();
  }

  // Whiskers.
  if (f.detail > 0.2) {
    g.strokeStyle = `rgba(90,60,40,${0.5 * f.detail})`;
    g.lineWidth = 0.005;
    g.beginPath();
    for (const side of [-1, 1] as const) {
      for (const j of [-1, 0, 1]) {
        const tw = p.whisk * 0.02 + Math.sin(f.t * 2 + j) * 0.003;
        g.moveTo(side * 0.07, 0.05 + j * 0.008);
        g.lineTo(side * 0.21, 0.035 + j * 0.03 - tw);
      }
    }
    g.stroke();
  }
  g.restore();
}

function drawEye(g: CanvasRenderingContext2D, cx: number, cy: number, side: -1 | 1, shape: string, p: Pose, t: number) {
  const s = p.eyeScale * (side < 0 ? p.eyeScaleL : p.eyeScaleR);
  const r = 0.04 * s;
  g.save();
  g.translate(cx, cy);
  g.scale(1, p.eyeMorph);
  g.fillStyle = C.eye;
  g.strokeStyle = C.eye;
  g.lineCap = "round";
  g.lineWidth = 0.014;
  switch (shape) {
    case "round":
    case "wide":
    case "half":
    case "focus": {
      const rr = shape === "wide" ? r * 1.15 : r;
      const open = clamp(p.eyeOpen, 0.06, 1);
      const ry = rr * open * (shape === "half" ? 0.8 : shape === "focus" ? 0.75 : 1.08);
      if (p.eyeTilt > 0.01 || shape === "half" || shape === "focus") {
        // Worried: the outer corner dips. Sleepy and focused: a heavy upper lid.
        const lid = (x: number) =>
          shape === "half" ? -ry * 0.05
          : shape === "focus" ? -ry * 0.55 + (x * side) * 0.08
          : -ry + p.eyeTilt * ry * 0.8 * (1 + (x * side) / rr) * 0.5;
        g.beginPath();
        g.moveTo(-2 * rr, lid(-2 * rr));
        g.lineTo(2 * rr, lid(2 * rr));
        g.lineTo(2 * rr, 2 * rr);
        g.lineTo(-2 * rr, 2 * rr);
        g.closePath();
        g.clip();
      }
      g.beginPath();
      g.ellipse(0, 0, rr, ry, 0, 0, TAU);
      g.fill();
      if (open > 0.45) {
        g.fillStyle = "#FFFFFF";
        g.beginPath();
        g.arc(-0.3 * rr, -0.35 * ry, 0.34 * rr, 0, TAU);
        g.fill();
        g.beginPath();
        g.arc(0.32 * rr, 0.3 * ry, 0.15 * rr, 0, TAU);
        g.fill();
      }
      break;
    }
    case "happy":
      g.beginPath();
      g.arc(0, 0.014, r * 0.95, Math.PI + 0.25, TAU - 0.25);
      g.stroke();
      break;
    case "closed":
      g.beginPath();
      g.arc(0, -0.016, r * 0.95, 0.3, Math.PI - 0.3);
      g.stroke();
      break;
    case "spiral":
      g.lineWidth = 0.009;
      g.rotate(t * 7 * side);
      g.beginPath();
      for (let a = 0; a <= 4 * Math.PI; a += 0.25) {
        const rr = (r * a) / (4 * Math.PI);
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.stroke();
      break;
  }
  g.restore();
}

/** The tail: from the cat's side, draped over the right rim with its tip
 *  curling up; when asleep, wrapped round the front paws instead. */
function drawTail(g: CanvasRenderingContext2D, p: Pose) {
  const curl = clamp(p.curl, 0, 1);
  const base = { x: 0.12, y: DECK_Y - p.catY - 0.04 };
  const sway = p.tail;
  // Draped over the rim.
  const rim = { x: 0.34, y: -0.03 };
  const tip = { x: 0.4 + 0.07 * sway, y: 0.13 - 0.2 * p.tailUp };
  const c1 = { x: 0.27, y: base.y - 0.06 };
  const c2 = { x: 0.43 + 0.05 * sway, y: 0.05 - 0.05 * p.tailUp };
  // Wrapped round the paws.
  const wRim = { x: 0.14, y: DECK_Y + 0.02 };
  const wTip = { x: -0.12, y: DECK_Y + 0.015 };
  const wc1 = { x: 0.2, y: DECK_Y - 0.02 };
  const wc2 = { x: 0.02, y: DECK_Y + 0.05 };
  const mix = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: lerp(a.x, b.x, curl), y: lerp(a.y, b.y, curl) });
  const R = mix(rim, wRim), T = mix(tip, wTip), C1 = mix(c1, wc1), C2 = mix(c2, wc2);

  const width = 0.046 * (1 + 0.45 * clamp(p.tailPuff, 0, 1));
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = C.furDark;
  g.lineWidth = width + 0.012;
  const path = () => {
    g.beginPath();
    g.moveTo(base.x, base.y);
    g.quadraticCurveTo(C1.x, C1.y, R.x, R.y);
    g.quadraticCurveTo(C2.x, C2.y, T.x, T.y);
  };
  path();
  g.stroke();
  g.strokeStyle = C.fur;
  g.lineWidth = width;
  path();
  g.stroke();
  // A darker tip.
  g.fillStyle = C.furDark;
  g.beginPath();
  g.arc(T.x, T.y, width * 0.55, 0, TAU);
  g.fill();
  g.restore();
}

export const billu: Skin = {
  id: "billu",
  fit: { units: 1.45, base: 0.84 },
  // Ear tips to the underside of the saucer, rim to rim.
  hit: { x0: 0.2, y0: 0.17, x1: 0.8, y1: 0.72 },
  rest,
  restEye: "round",
  pose,
  events,
  draw,
};
