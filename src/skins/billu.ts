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
import type { Emit, Frame, Pose, PoseInput, PoseOut, Skin, WorkVariant } from "../engine/types";
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
  // Props for the kinds of work (0 = not there, 1 = there).
  /** Reading: a book on the deck (a page turning, 0…1) and a magnifying glass in the right paw, moved along the lines. */
  book: 0, page: 0, lensP: 0, lensX: 0, lensY: 0,
  /** Running a command: a console with a big button beside him, pressed with the left paw
   *  (push −1 raised … 0 just above … 1 pressed down); the button lit while it runs. */
  btn: 0, push: 0, btnLit: 0,
  /** On the web: a spyglass in the right paw, pointing −1 left … 1 right, lowered for an "oh!";
   *  the other eye squinting; the cat leaning over the rim (radians). */
  scope: 0, scopeDir: 0, scopeDown: 0, squint: 0, lean: 0,
  /** Asking: right paw to the chin. */
  chin: 0,
  /** Waiting for you: a "!" over his head and its bounce; asking: a "?" and which side it's on. */
  bang: 0, bangPulse: 0, ask: 0, askSide: 0,
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
      if (i.variant !== null && isWork(i.variant)) return working(i, i.variant);
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

// ── Kinds of work ─────────────────────────────────────────────────────────────
// All keep the saucer hovering where plain WORKING does and the cat sitting on
// it, so switching between them is a short crossfade; each cycle runs on `st`
// (the state's own clock), so it starts on entry and still ticks along under
// reduced motion.

const WORK_KINDS: readonly string[] = ["research", "run", "browse", "wait", "ask"];
const isWork = (v: string): v is WorkVariant => WORK_KINDS.includes(v);

/** Reading cycle: four lines, a pause at the end (sometimes "found it!"), a page turn. */
const READ_MS = 8400;

/**
 * Reading a page: where along the line (−1 left … 1 right) and which line
 * (0…3, fractional on the way back up). The eyes run along a line and flick
 * back for the next; after the fourth a pause, every other time with a "found
 * it!" (`aha`, 0…1, `pop` its first flash), then the page turns (`flip`).
 */
function reading(st: number) {
  const n = Math.floor(st / READ_MS);
  const k = st - n * READ_MS;
  let x: number;
  let line: number;
  if (k < 6080) {
    line = Math.floor(k / 1600);
    const lk = (k - line * 1600) / 1600;
    x = lk < 0.8 ? lerp(-1, 1, Ease.inOutSine(lk / 0.8)) : lerp(1, -1, Ease.inOutSine((lk - 0.8) / 0.2));
  } else if (k < 7280) {
    line = 3;
    x = 1;
  } else {
    const e = Ease.inOutSine(clamp((k - 7280) / 700, 0, 1));
    line = 3 * (1 - e);
    x = lerp(1, -1, e);
  }
  const lucky = n % 2 === 0;
  return {
    x, line,
    aha: lucky ? kf(k, [[6080, 0], [6230, 1, Ease.outBack], [6900, 1], [7280, 0, Ease.inOutSine]]) : 0,
    pop: lucky ? kf(k, [[6080, 0], [6200, 1], [6750, 0]]) : 0,
    // Back to 0 at the wrap only once the page lies flat on the left: no jump.
    flip: kf(k, [[7300, 0], [8200, 1, Ease.inOutSine]]),
  };
}

/** Scanning side to side, holding a moment at each side: −1 … 1. */
const scan = (st: number, periodMs: number) => clamp(1.35 * Math.sin((TAU * st) / periodMs), -1, 1);

/** A head tilt held one way, then after a while the other: 1 … −1 (13 s round). */
const ponder = (st: number) => clamp(2.2 * Math.cos((TAU * st) / 13000), -1, 1);

/** "I need you": every 2.4 s a bounce (0…1) and two flashes. */
function callPulse(st: number) {
  const k = st % 2400;
  return {
    k,
    pulse: k < 600 ? Math.sin((Math.PI * k) / 600) : 0,
    flash: k < 840 ? Math.abs(Math.sin((Math.PI * k) / 420)) : 0,
  };
}

/** Run cycle: press, watch it run, press again. */
const RUN_MS = 5200;
/** Browse cycle: two scans, an "oh!" in the second. */
const LOOK_MS = 8000;

function working(i: PoseInput, v: WorkVariant): PoseOut {
  const { st, t, motion: m } = i;
  switch (v) {
    case "research": {
      // A book open on the deck, a magnifying glass in his paw: it moves
      // along the lines, his eyes with it; a page turns; now and then his
      // head pops up, ears up, eyes wide: "found it!".
      const r = reading(st);
      const a = r.aha;
      return {
        pose: {
          ...bob(t, 0.6, m),
          book: 1, lensP: 1, page: r.flip,
          lensX: 0.1 * r.x * m,
          lensY: (0.0174 * r.line - 0.035 * a) * m,
          headY: (0.022 * (1 - a) - 0.012 * a) * m,
          headTilt: (2 * DEG * r.x * (1 - a) - 2 * DEG) * m,
          catY: 0.02 * a * m,
          earL: -0.25 - 0.65 * a, earR: -0.25 - 0.65 * a,
          eyeOpen: 0.82 + 0.18 * a,
          eyeScale: 1 + 0.1 * a,
          mouthO: 0.3 * a, mouthCurve: 0.4,
          gazeLock: 1, gazeLockX: 0.8 * r.x * (1 - a), gazeLockY: 0.85 * (1 - a),
          tail: tailSway(t, m, 0.6), tailUp: 0.7 * a,
          lights: 0.85, lightPhase: t * 1.5, flash: 0.6 * r.pop,
        },
        eye: a > 0.5 ? "wide" : "round",
      };
    }

    case "run": {
      // A console with a big red button beside him: up goes his paw, down on
      // the button; the beam fires and the lights race while it runs; he
      // watches, tail twitching, glances at you when it's done, and presses again.
      const k = st % RUN_MS;
      const lit = kf(k, [[0, 0.1], [470, 0.1], [500, 1], [3300, 1], [3900, 0.1]]);
      const press = kf(k, [[470, 0], [520, 1], [800, 0]]);
      return {
        pose: {
          ...bob(t, 0.5, m),
          lift: (0.015 * Math.sin(t * 1.4) - 0.012 * press) * m,
          sy: 1 - 0.04 * press * m, sx: 1 + 0.03 * press * m,
          btn: 1,
          push: kf(k, [[0, 0], [320, -1, Ease.outBack], [480, 1, Ease.inQuad], [700, 1], [1000, 0, Ease.outCubic]]) * m,
          btnLit: lit,
          beam: 0.7 * kf(k, [[500, 0], [700, 1], [3300, 1], [3900, 0]]),
          beamAng: 0.18 * Math.sin(t * 2.2) * m,
          lights: 0.7 + 0.3 * lit,
          lightPhase: t * (2 + 6 * lit),
          flash: 0.6 * kf(k, [[470, 0], [520, 1], [900, 0]]),
          headTilt: -4 * DEG * m,
          earL: -0.6, earR: -0.6,
          tail: (0.25 + 0.3 * Math.sin(t * 3.5)) * m,
          tailUp: 0.3 + 0.3 * lit,
          eyeScale: 1.05,
          mouthO: kf(k, [[400, 0], [480, 0.25], [700, 0]]),
          mouthCurve: 0.5,
          gazeLock: 1,
          gazeLockX: kf(k, [[0, -0.6], [3900, -0.6], [4300, 0, Ease.inOutSine], [4900, 0], [5200, -0.6, Ease.inOutSine]]),
          gazeLockY: kf(k, [[0, 0.5], [3900, 0.5], [4300, -0.05, Ease.inOutSine], [4900, -0.05], [5200, 0.5, Ease.inOutSine]]),
        },
        eye: "round",
      };
    }

    case "browse": {
      // A spyglass to one eye, the other squinting: he leans over the rim and
      // scans slowly left and right, and now and then lowers it, wide-eyed: "oh!".
      const dir = m ? 0.9 * scan(st, LOOK_MS) : 0.6;
      const k = st % (2 * LOOK_MS);
      const oh = kf(k, [[9100, 0], [9250, 1, Ease.outBack], [10300, 1], [10700, 0, Ease.inOutSine]]);
      return {
        pose: {
          ...bob(t, 0.5, m),
          bodyRot: (4 * DEG * dir + 1.5 * DEG * Math.sin(t * 0.9)) * m,
          bodyX: 0.04 * dir * m,
          lean: 9 * DEG * dir * (1 - 0.5 * oh) * m,
          headTilt: 3 * DEG * dir * m,
          catY: 0.02 * oh * m,
          scope: 1, scopeDir: dir, scopeDown: oh * m, squint: 1 - oh,
          earL: -0.4 - 0.5 * oh, earR: -0.4 - 0.5 * oh,
          eyeScale: 1 + 0.12 * oh,
          mouthCurve: 0.35, mouthO: 0.35 * oh,
          gazeLock: 1, gazeLockX: 0.8 * dir * (1 - oh), gazeLockY: 0,
          tail: tailSway(t, m, 0.8), tailUp: 0.3 + 0.5 * oh, tailPuff: 0.3 * oh,
          lights: 0.85, lightPhase: t * 2,
          flash: 0.5 * kf(k, [[9100, 0], [9250, 1], [9800, 0]]),
        },
        eye: oh > 0.5 ? "wide" : "round",
      };
    }

    case "wait": {
      // "I need you": up close (as NOTIFY), looking right at you, waving; on
      // every 2.4 s beat a bounce, a "mew" and the rim lights flash twice; a
      // "!" over his head. Calm enough to keep up until you answer.
      const c = callPulse(st);
      const near = kf(st, [[0, 1], [350, 1.06, Ease.outBack]]);
      return {
        pose: {
          ...bob(t, 0.4, m),
          sx: near + 0.02 * c.pulse * m, sy: near + 0.02 * c.pulse * m,
          lift: (0.02 * c.pulse + 0.012 * Math.sin(t * 1.4)) * m,
          catY: 0.03 * c.pulse * m,
          wave: 0.85,
          // Three waves on the beat, then the paw rests up.
          waveRot: TAU * 2 * Math.min(c.k, 1500) / 1000 * m,
          flash: 0.85 * c.flash * (m ? 1 : 0.5),
          lights: 1,
          lightPhase: t * 4,
          beam: 0.3 * c.flash,
          earL: -0.7, earR: -0.7,
          tailUp: 0.7,
          tail: 0.3 * Math.sin(t * 3) * m,
          mouthO: 0.12 + 0.18 * c.pulse,
          gazeLock: 1, gazeLockX: 0, gazeLockY: -0.05,
          bang: 1, bangPulse: c.pulse * m,
        },
        eye: "wide",
      };
    }

    case "ask": {
      // A question for you: head tilted, one ear up and one down, paw to his
      // chin, looking up at you, tail curled into a hook, a "?" beside him;
      // after a while he tilts the other way with a little "mrr?".
      const side = m ? ponder(st) : 1;
      const into = kf(st, [[0, 0], [450, 1, Ease.outBack]]);
      return {
        pose: {
          ...bob(t, 0.6, m),
          headTilt: 13 * DEG * side * into,
          earL: side > 0 ? -0.5 * into : 0.35 * into * -side, earR: side > 0 ? 0.35 * into * side : -0.5 * into,
          chin: 1,
          eyeScale: 1.05, eyeScaleL: 1 - 0.07 * side, eyeScaleR: 1 + 0.07 * side,
          mouthCurve: 0.25, mouthO: 0.2 * (1 - Math.abs(side)),
          gazeLock: 1, gazeLockX: 0.1 * side, gazeLockY: -0.25,
          tail: tailSway(t, m, 0.5), tailUp: 0.8,
          lights: 0.65, lightPhase: t * 0.8,
          ask: into, askSide: side,
        },
        eye: "round",
      };
    }
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
      if (i.variant === "research") {
        // "Found it!": two sparkles off the glass.
        const n = Math.floor(i.st / READ_MS);
        if (n % 2 === 0 && crossed(n * READ_MS + 6150)) {
          const x = p.bodyX + p.lensX, y = sy - DECK_Y + p.catY + 0.06;
          for (const s of [-1, 1]) emit({ kind: "sparkle", x: x + s * 0.07, y: y + 0.05, vx: s * 0.18, vy: 0.25, size: 0.055, life: 0.8, spin: 2 });
        }
        break;
      }
      if (i.variant === "run") {
        const n = Math.floor(i.st / RUN_MS);
        // The press: a spark off the button.
        if (crossed(n * RUN_MS + 480)) emit({ kind: "sparkle", x: p.bodyX + CONSOLE.x - 0.02, y: sy - CONSOLE.y + CONSOLE.h + 0.06, vx: -0.2, vy: 0.25, size: 0.05, life: 0.7, spin: 2 });
        // While it runs, the beam's spot leaves soft dots, as in plain work.
        const d = Math.floor(i.st / 140);
        if (p.beam > 0.3 && crossed(d * 140)) {
          const x = p.bodyX + Math.sin(p.beamAng) * (sy - 0.1);
          emit({ kind: "glow", x, y: 0.02, vx: 0, vy: 0.05, size: 0.05, life: 0.5 });
        }
        break;
      }
      if (i.variant === "browse") {
        const n = Math.floor(i.st / (2 * LOOK_MS));
        if (crossed(n * 2 * LOOK_MS + 9200)) emit({ kind: "sparkle", x: head.x + 0.24, y: head.y + 0.08, vx: 0.15, vy: 0.2, size: 0.055, life: 0.8, spin: 2 });
        break;
      }
      if (i.variant !== null) break;
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
  if (p.btn > 0.01) drawConsole(g, p, f);
  // The tail comes from behind the cat and drapes over the rim; curled up
  // asleep, it wraps round the front of the paws instead.
  const tailInFront = p.curl > 0.5;
  if (!tailInFront) drawTail(g, p);
  drawCat(g, p, eye, f);
  if (tailInFront) drawTail(g, p);
  g.restore();

  // "!" (waiting for your OK) and "?" (a question for you), over his head.
  const top = H - DECK_Y - HEAD_Y + p.catY + 0.21;
  if (p.bang > 0.01) {
    const s = 0.2 * (0.6 + 0.4 * clamp(p.bang, 0, 1.2)) * (1 + 0.14 * p.bangPulse);
    drawMark(g, "!", bx - 0.33 * U, oy - (top + 0.03 * p.bangPulse) * U, s * U, clamp(p.bang, 0, 1), `rgb(${C.light})`, 1);
  }
  if (p.ask > 0.01) {
    const side = p.askSide >= 0 ? 1 : -1;
    const a = clamp(p.ask, 0, 1) * clamp(Math.abs(p.askSide) * 1.6 - 0.4, 0, 1);
    const s = 0.2 * (0.6 + 0.4 * clamp(p.ask, 0, 1.2));
    if (a > 0.01) drawMark(g, "?", bx + side * 0.33 * U, oy - (top + 0.012 * Math.sin(f.t * 2)) * U, s * U, a, C.cream, side > 0 ? -1 : 1);
  }
}

/**
 * A "!" or "?" in a little round speech bubble whose tail points back at
 * him (`tail` −1 down-left, 1 down-right): drawn as strokes, so it stays
 * crisp at any size, with a dark outline for light wallpapers and a light
 * fill for dark ones. Centred on (x, y); `size` px.
 */
function drawMark(g: CanvasRenderingContext2D, kind: "!" | "?", x: number, y: number, size: number, alpha: number, fill: string, tail: -1 | 1) {
  const ink = "#5A3418";
  g.save();
  g.globalAlpha *= alpha;
  g.translate(x, y);
  g.scale(size, size);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.arc(0, 0, 0.62, 0, TAU);
  g.moveTo(tail * 0.2, 0.5);
  g.lineTo(tail * 0.62, 0.86);
  g.lineTo(tail * 0.5, 0.25);
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = ink;
  g.lineWidth = 0.09;
  g.beginPath();
  g.arc(0, 0, 0.62, Math.PI * (tail > 0 ? 0.42 : 0.94), Math.PI * (tail > 0 ? 2.06 : 2.58));
  g.lineTo(tail * 0.62, 0.86);
  g.closePath();
  g.stroke();
  g.fillStyle = ink;
  g.lineWidth = 0.19;
  g.beginPath();
  if (kind === "!") {
    g.moveTo(0, -0.38);
    g.lineTo(0, 0.08);
  } else {
    g.arc(0, -0.17, 0.19, Math.PI * 1.05, Math.PI * 2.3);
    g.quadraticCurveTo(0, 0.0, 0, 0.1);
  }
  g.stroke();
  g.beginPath();
  g.arc(0, 0.32, 0.1, 0, TAU);
  g.fill();
  g.restore();
}

/** Where the console with the big button stands on the deck (saucer frame), and its size. */
const CONSOLE = { x: -0.245, y: DECK_Y + 0.014, w: 0.13, h: 0.075, domeR: 0.046, domeH: 0.042 };

/** The console beside him: a little box with a status light and a big red button on top. */
function drawConsole(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  const a = clamp(p.btn, 0, 1);
  const lit = clamp(p.btnLit, 0, 1);
  const { w, h, domeR } = CONSOLE;
  g.save();
  g.globalAlpha *= a;
  g.translate(CONSOLE.x, CONSOLE.y);
  g.scale(0.6 + 0.4 * a, 0.6 + 0.4 * a);
  const box = g.createLinearGradient(0, -h, 0, 0);
  box.addColorStop(0, C.hullLight);
  box.addColorStop(1, C.hullDark);
  g.fillStyle = box;
  g.beginPath();
  g.roundRect(-w / 2, -h, w, h, 0.014);
  g.fill();
  g.strokeStyle = C.hullEdge;
  g.lineWidth = 0.008;
  g.stroke();
  // A little screen: a prompt, and a status light that's on while it runs.
  g.fillStyle = "#2B3350";
  g.beginPath();
  g.roundRect(-w / 2 + 0.014, -h + 0.016, w - 0.028, h - 0.03, 0.008);
  g.fill();
  if (f.detail > 0.25) {
    g.strokeStyle = `rgba(${C.beam},0.9)`;
    g.lineWidth = 0.006;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-0.032, -0.042);
    g.lineTo(-0.024, -0.036);
    g.lineTo(-0.032, -0.03);
    g.moveTo(-0.016, -0.03);
    g.lineTo(-0.016 + 0.03 * (0.3 + 0.7 * lit), -0.03);
    g.stroke();
  }
  g.fillStyle = `rgba(${C.light},${0.35 + 0.65 * lit})`;
  g.beginPath();
  g.arc(0.03, -0.03, 0.008, 0, TAU);
  g.fill();

  // The big button: its glow when lit, the collar, the dome (squashed when pressed).
  const top = -h;
  if (lit > 0.01) {
    const halo = g.createRadialGradient(0, top - 0.02, 0, 0, top - 0.02, 0.09);
    halo.addColorStop(0, `rgba(255,96,96,${0.5 * lit})`);
    halo.addColorStop(1, "rgba(255,96,96,0)");
    g.fillStyle = halo;
    g.beginPath();
    g.arc(0, top - 0.02, 0.09, 0, TAU);
    g.fill();
  }
  g.fillStyle = C.hullEdge;
  g.beginPath();
  g.ellipse(0, top, domeR + 0.008, 0.013, 0, 0, TAU);
  g.fill();
  const dh = domeHeight(p);
  const dome = g.createLinearGradient(0, top - dh, 0, top);
  dome.addColorStop(0, lit > 0.5 ? "#FFC2C2" : "#FF9A9A");
  dome.addColorStop(1, lit > 0.5 ? "#FF4D57" : "#D63A45");
  g.fillStyle = dome;
  g.beginPath();
  g.moveTo(-domeR, top);
  g.bezierCurveTo(-domeR, top - dh * 1.3, domeR, top - dh * 1.3, domeR, top);
  g.ellipse(0, top, domeR, 0.01, 0, 0, Math.PI);
  g.closePath();
  g.fill();
  g.strokeStyle = "#8E2430";
  g.lineWidth = 0.006;
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.7)";
  g.beginPath();
  g.ellipse(-0.012, top - dh * 0.75, 0.01, 0.005, -0.3, 0, TAU);
  g.fill();
  g.restore();
}

const domeHeight = (p: Pose) => CONSOLE.domeH * (1 - 0.5 * clamp(p.push, 0, 1));

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
  const base = DECK_Y - p.catY;
  g.save();
  // Leaning (over the rim, with the spyglass): the whole cat pivots on its base.
  if (Math.abs(p.lean) > 1e-4) {
    g.translate(0, base);
    g.rotate(p.lean);
    g.translate(0, -base);
  }
  g.save();
  g.translate(0, base);
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

  // The book he reads, open on the deck in front of him.
  const book = clamp(p.book, 0, 1);
  if (book > 0.01) drawBook(g, p, book);

  // Front paws (either may be busy; the left one holds the book open).
  const busy = Math.max(p.groom, p.wave, p.lensP, p.scope, p.chin) > 0.03;
  const leftBusy = p.btn > 0.03;
  if (!leftBusy) drawPaw(g, lerp(-0.048, -0.175, book), lerp(-0.012, -0.04, book));
  if (!busy) drawPaw(g, 0.048, -0.012);
  g.restore();

  // Head, on its own transform so it can tilt; it sinks a little when curled up.
  g.save();
  g.translate(0, base + headOffset(p));
  g.rotate(p.headTilt);
  drawHead(g, p, eye, f);
  g.restore();

  if (busy) drawArm(g, p);
  if (leftBusy) drawLeftArm(g, p);
  g.restore();
}

/** The head's centre above the cat's base. */
const headOffset = (p: Pose) => HEAD_Y * p.catSY * (1 - 0.3 * clamp(p.curl, 0, 1)) + p.headY;

function drawPaw(g: CanvasRenderingContext2D, x: number, y: number) {
  g.fillStyle = C.cream;
  g.beginPath();
  g.ellipse(x, y, 0.04, 0.026, 0, 0, TAU);
  g.fill();
  g.strokeStyle = "rgba(196,111,51,0.55)";
  g.lineWidth = 0.006;
  g.stroke();
}

type Pt = { x: number; y: number };

/** A front leg from the shoulder, bowed through `c`, to the paw at `to`. */
function drawLeg(g: CanvasRenderingContext2D, from: Pt, c: Pt, to: Pt) {
  g.strokeStyle = C.fur;
  g.lineWidth = 0.062;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(from.x, from.y);
  g.quadraticCurveTo(c.x, c.y, to.x, to.y);
  g.stroke();
  drawPaw(g, to.x, to.y);
}

/** The right front leg, raised to groom, wave, hold the magnifying glass or the spyglass, or prop his chin. */
function drawArm(g: CanvasRenderingContext2D, p: Pose) {
  const base = DECK_Y - p.catY;
  const rest = { x: 0.048, y: -0.012 };
  const shoulder = { x: 0.07, y: -0.15 };
  const mouth = { x: 0.02, y: HEAD_Y + 0.07 + p.headY };
  const up = { x: 0.21, y: HEAD_Y - 0.04 };
  const gm = clamp(p.groom, 0, 1);
  const wv = clamp(p.wave, 0, 1);
  let px = rest.x + (mouth.x - rest.x) * gm + (up.x - rest.x) * wv + 0.035 * Math.sin(p.waveRot) * wv;
  let py = rest.y + (mouth.y - rest.y) * gm + (up.y - rest.y) * wv;
  let cx = lerp(0.12, 0.14, wv);
  let cy = lerp(-0.1, -0.22, wv);
  // The other things a paw can be holding: each pulls the paw to its spot,
  // and the leg bows out between shoulder and paw.
  const hy = headOffset(p);
  const lens = lensAt(p);
  const grip = toArm(scopeGeom(p).grip, p.headTilt, hy);
  const chin = { x: 0.03, y: hy + 0.125 };
  const holds: [number, Pt][] = [[p.lensP, lens.paw], [p.scope, grip], [p.chin, chin]];
  for (const [w, q] of holds) {
    const k = clamp(w, 0, 1);
    if (k < 0.001) continue;
    px += (q.x - rest.x) * k;
    py += (q.y - rest.y) * k;
    cx += ((shoulder.x + q.x) / 2 + 0.06 - 0.12) * k;
    cy += ((shoulder.y + q.y) / 2 + 0.03 + 0.1) * k;
  }
  g.save();
  g.translate(0, base);
  if (p.lensP > 0.01) drawLens(g, p, lens.x, lens.y, { x: px, y: py });
  drawLeg(g, shoulder, { x: cx, y: cy }, { x: px, y: py });
  g.restore();
}

/** The left front leg, reaching over to the button: raised (push −1), just above it (0), pressing (1). */
function drawLeftArm(g: CanvasRenderingContext2D, p: Pose) {
  const base = DECK_Y - p.catY;
  const rest = { x: -0.048, y: -0.012 };
  const shoulder = { x: -0.07, y: -0.15 };
  // The top of the dome, in the leg's frame (the console stands on the deck, not on the bobbing cat).
  const topY = CONSOLE.y - CONSOLE.h - domeHeight(p) - base - 0.008;
  const push = p.push;
  const hover = topY - 0.035;
  const target = push >= 0
    ? { x: CONSOLE.x, y: lerp(hover, topY, clamp(push, 0, 1)) }
    : { x: lerp(CONSOLE.x, -0.2, -push), y: lerp(hover, -0.25, -push) };
  const k = clamp(p.btn, 0, 1);
  const to = { x: lerp(rest.x, target.x, k), y: lerp(rest.y, target.y, k) };
  const c = { x: (shoulder.x + to.x) / 2 - 0.02, y: Math.min(shoulder.y, to.y) - 0.04 * k };
  g.save();
  g.translate(0, base);
  drawLeg(g, shoulder, c, to);
  g.restore();
}

/** A point in the (tilted) head's frame, in the legs' frame. */
function toArm(q: Pt, tilt: number, hy: number): Pt {
  const c = Math.cos(tilt), s = Math.sin(tilt);
  return { x: q.x * c - q.y * s, y: hy + q.x * s + q.y * c };
}

// Reading.

/** The open book on the deck, in the cat's frame, with a page turning over (`page`). */
function drawBook(g: CanvasRenderingContext2D, p: Pose, a: number) {
  g.save();
  g.globalAlpha *= a;
  g.translate(0, -0.03);
  g.scale(BOOK_S * (0.6 + 0.4 * a), BOOK_S * (0.6 + 0.4 * a));
  // Cover.
  g.fillStyle = "#4F6DB0";
  g.beginPath();
  g.moveTo(-0.15, -0.035);
  g.quadraticCurveTo(-0.075, -0.055, 0, -0.04);
  g.quadraticCurveTo(0.075, -0.055, 0.15, -0.035);
  g.lineTo(0.15, 0.04);
  g.quadraticCurveTo(0.075, 0.032, 0, 0.045);
  g.quadraticCurveTo(-0.075, 0.032, -0.15, 0.04);
  g.closePath();
  g.fill();
  const page = (ex: number, rise: number) => {
    g.beginPath();
    g.moveTo(0, -0.032);
    g.quadraticCurveTo(ex * 0.5, -0.05 + rise, ex, -0.034 + rise);
    g.lineTo(ex, 0.03 + rise);
    g.quadraticCurveTo(ex * 0.5, 0.022 + rise * 0.5, 0, 0.036);
    g.closePath();
  };
  g.lineCap = "round";
  for (const side of [-1, 1] as const) {
    page(side * 0.138, 0);
    g.fillStyle = "#FFF8EC";
    g.fill();
    g.strokeStyle = "rgba(122,138,182,0.7)";
    g.lineWidth = 0.005;
    g.stroke();
    g.lineWidth = 0.007;
    for (let j = 0; j < 4; j++) {
      const indent = [0, 0.02, 0.02, 0.01][j];
      const len = 0.04 + 0.05 * hash01(j * 5 + (side + 1) * 13);
      g.strokeStyle = ["rgba(196,111,51,0.85)", "rgba(79,109,176,0.85)", "rgba(90,60,40,0.6)", "rgba(79,109,176,0.85)"][(j + side + 1) % 4];
      const x0 = side * (0.02 + indent);
      const y = -0.02 + j * 0.012;
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x0 + side * len, y);
      g.stroke();
    }
  }
  g.strokeStyle = "rgba(79,109,176,0.8)";
  g.lineWidth = 0.005;
  g.beginPath();
  g.moveTo(0, -0.032);
  g.lineTo(0, 0.036);
  g.stroke();
  // A page turning over, right to left.
  if (p.page > 0.02 && p.page < 0.98) {
    const ex = 0.138 * Math.cos(Math.PI * p.page);
    page(ex, -0.03 * Math.sin(Math.PI * p.page));
    g.fillStyle = ex > 0 ? "#F2EBDD" : "#FFF8EC";
    g.fill();
    g.strokeStyle = "rgba(122,138,182,0.7)";
    g.stroke();
  }
  g.restore();
}

/** The magnifying glass, in the legs' frame: its centre over the line he reads, and where his paw holds the handle. */
function lensAt(p: Pose) {
  const x = p.lensX;
  const y = -0.059 + p.lensY;
  return { x, y, paw: { x: x + 0.09, y: y - 0.075 } };
}

/** The book's size (its drawing is in small units), and the glass's. */
const BOOK_S = 1.45;
const LENS_R = 0.062;

/** The magnifying glass: brass rim, glass with the words under it big, a wooden handle up to the paw. */
function drawLens(g: CanvasRenderingContext2D, p: Pose, x: number, y: number, paw: Pt) {
  const a = clamp(p.lensP, 0, 1);
  g.save();
  g.globalAlpha *= a;
  const d = Math.hypot(paw.x - x, paw.y - y) || 1;
  g.lineCap = "round";
  g.strokeStyle = "#5C3A1E";
  g.lineWidth = 0.024;
  g.beginPath();
  g.moveTo(x + ((paw.x - x) / d) * LENS_R, y + ((paw.y - y) / d) * LENS_R);
  g.lineTo(paw.x, paw.y);
  g.stroke();
  g.strokeStyle = "#8A5A30";
  g.lineWidth = 0.014;
  g.stroke();
  // Glass, with the line under it magnified, sliding by as the glass moves.
  g.beginPath();
  g.arc(x, y, LENS_R, 0, TAU);
  const glass = g.createRadialGradient(x - LENS_R * 0.3, y - LENS_R * 0.3, 0, x, y, LENS_R);
  glass.addColorStop(0, "rgba(250,253,255,0.95)");
  glass.addColorStop(1, "rgba(200,228,250,0.9)");
  g.fillStyle = glass;
  g.fill();
  g.save();
  g.clip();
  g.lineWidth = 0.016;
  const P = 0.1;
  const shift = -p.lensX * 2;
  const o = ((shift % P) + P) % P;
  const n0 = Math.floor(shift / P);
  for (let j = -1; j <= 1; j++) {
    g.strokeStyle = ["rgba(79,109,176,0.9)", "rgba(196,111,51,0.9)", "rgba(79,109,176,0.9)"][j + 1];
    for (let n = -2; n <= 2; n++) {
      const len = 0.025 + 0.035 * hash01(n - n0 + j * 7);
      const lx = x + o + n * P - P / 2;
      g.beginPath();
      g.moveTo(lx, y + j * 0.03);
      g.lineTo(lx + len * 1.3, y + j * 0.03);
      g.stroke();
    }
  }
  g.restore();
  g.beginPath();
  g.arc(x, y, LENS_R, 0, TAU);
  g.strokeStyle = "#7A5420";
  g.lineWidth = 0.018;
  g.stroke();
  g.strokeStyle = "#E0AE4A";
  g.lineWidth = 0.009;
  g.stroke();
  g.beginPath();
  g.arc(x, y, LENS_R * 0.62, Math.PI * 1.1, Math.PI * 1.45);
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineWidth = 0.008;
  g.stroke();
  g.restore();
}

// The spyglass.

/**
 * The spyglass in the head's frame: the eyepiece at one eye (the right when
 * looking right, the left when looking left), the far end out to that side,
 * foreshortened to a round lens when he looks straight at you; lowered off
 * his eye for an "oh!". `grip` is where his paw holds it.
 */
function scopeGeom(p: Pose) {
  const dir = clamp(p.scopeDir, -1, 1);
  const down = clamp(p.scopeDown, 0, 1.2);
  const es = clamp(dir * 4, -1, 1);
  const E = { x: es * 0.068, y: -0.012 + 0.11 * down };
  const len = 0.22 * (1 - 0.3 * down);
  const O = { x: E.x + dir * len, y: E.y - 0.04 * Math.abs(dir) + 0.06 * down };
  return { dir, E, O, grip: { x: lerp(E.x, O.x, 0.55), y: lerp(E.y, O.y, 0.55) + 0.03 } };
}

function drawScope(g: CanvasRenderingContext2D, p: Pose) {
  const { dir, E, O } = scopeGeom(p);
  const at = (k: number) => ({ x: lerp(E.x, O.x, k), y: lerp(E.y, O.y, k) });
  g.save();
  g.globalAlpha *= clamp(p.scope, 0, 1);
  g.lineCap = "butt";
  // Three brass sections, widening to the far end.
  const sections: [number, number, number][] = [[0, 0.42, 0.022], [0.38, 0.74, 0.028], [0.7, 1, 0.035]];
  for (const [a, b, r] of sections) {
    const A = at(a), B = at(b);
    g.strokeStyle = "#7A5420";
    g.lineWidth = 2 * r + 0.012;
    g.beginPath();
    g.moveTo(A.x, A.y);
    g.lineTo(B.x, B.y);
    g.stroke();
    g.strokeStyle = "#E0AE4A";
    g.lineWidth = 2 * r;
    g.stroke();
    g.strokeStyle = "rgba(255,240,200,0.65)";
    g.lineWidth = r * 0.5;
    g.beginPath();
    g.moveTo(A.x, A.y - r * 0.5);
    g.lineTo(B.x, B.y - r * 0.5);
    g.stroke();
  }
  // The far lens, seen at an angle (round when he looks straight at you).
  const R = 0.04;
  const rx = R * Math.max(0.25, Math.sqrt(1 - dir * dir));
  const lg = g.createRadialGradient(O.x - rx * 0.3, O.y - R * 0.3, 0, O.x, O.y, R);
  lg.addColorStop(0, "#BFE8FA");
  lg.addColorStop(0.6, "#4E7FAE");
  lg.addColorStop(1, "#2A3F66");
  g.fillStyle = lg;
  g.beginPath();
  g.ellipse(O.x, O.y, rx, R, 0, 0, TAU);
  g.fill();
  g.strokeStyle = "#7A5420";
  g.lineWidth = 0.012;
  g.stroke();
  g.strokeStyle = "#E0AE4A";
  g.lineWidth = 0.006;
  g.stroke();
  if (rx > R * 0.5) {
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.beginPath();
    g.ellipse(O.x - rx * 0.35, O.y - R * 0.35, rx * 0.22, R * 0.15, -0.5, 0, TAU);
    g.fill();
  }
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
  for (const side of [-1, 1] as const) {
    // With the spyglass to one eye, the other one squints.
    const squint = p.scope > 0.5 && p.squint > 0.5 && side * p.scopeDir < -0.15;
    drawEye(g, fx + side * 0.068, -0.012 + fy, side, squint ? "closed" : eye, p, f.t);
  }

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
  if (p.scope > 0.01) drawScope(g, p);
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
