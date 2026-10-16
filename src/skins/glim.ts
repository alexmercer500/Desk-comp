// Glim, the firefly helper: a lavender teardrop with translucent leaf wings and
// a glowing mint orb that "lights the way" (spec 1.3 and Section 4). Glim always
// hovers on a slow Lissajous path and only lands to sleep. No arms or legs:
// she speaks through tilt, wings, antennae and the orb.
//
// Drawing space: units, origin on the ground under her, y down. The body is
// drawn around its own centre B, which rises with `hover` (0 landed, 1 flying).

import { Ease, clamp, lerp } from "../engine/ease";
import { hash01, kf } from "../engine/track";
import type { Emit, Frame, Pose, PoseInput, PoseOut, Skin, WorkVariant } from "../engine/types";
import {
  DEG, ENGINE_REST, TAU, confusedTilt, crossedAt, dizzyWobble, errorSlump, heldSwing,
  notifyPop, sleepyFace, successHop, touchSquash, wakeBlink, workNod,
} from "./common";

const C = {
  body: "#B8A9E6",
  bodyLight: "#D6CCF5",
  bodyDark: "#8F7FC4",
  wing: "232,244,255",
  orb: "155,246,196", // #9BF6C4
  eye: "#241E3A",
  tip: "#FFD6E8",
};

/** Body centre height above the ground when landed, and how much higher in flight. */
const LANDED_Y = 0.53;
const FLIGHT_RISE = 0.32;
/** Orb centre below the body centre. */
const ORB_DY = 0.46;
const ORB_R = 0.07;
/** The orb as a magnifying glass (reading). */
const LENS_R = 0.095;
/** The floating book's centre above the ground. */
const BOOK_Y = 0.3;

// ── Pose ──────────────────────────────────────────────────────────────────────

const rest: Pose = {
  ...ENGINE_REST,
  eyeScale: 1, eyeScaleL: 1, eyeScaleR: 1, eyeTilt: 0,
  mouthCurve: 0.5, mouthO: 0,
  hover: 1,
  bodyAlpha: 1,
  turn: 1, // 1 facing us, −1 her back (mid-spin)
  wingFold: 0,
  wingFlap: 0, // radians
  antPerk: 0,
  antDroop: 0,
  orb: 0.85,
  orbFlash: 0,
  /** The orb moved off its stalk's rest (reading along a line). */
  orbX: 0, orbY: 0,
  /** Antennae: waving together (−1…1), and one up / one curled (the sign picks which). */
  antWave: 0, antTilt: 0,
  // Props for the kinds of work (0 = not there, 1 = there).
  /** Reading: the orb turns into a magnifying glass over a floating book; a page turning (0…1). */
  lens: 0, book: 0, page: 0,
  /** Running a command: a little terminal with a big button; pressed (0…1), lit, output printed (0…1). */
  console: 0, btnDown: 0, btnLit: 0, out: 0,
  /** On the web: binoculars, pointing −1 left … 1 right, lowered for an "oh!" (0…1). */
  binoc: 0, binocDir: 0, binocDown: 0,
  /** Waiting for you: a "!" over her head and its bounce; asking: a "?" and which side it's on. */
  bang: 0, bangPulse: 0, ask: 0, askSide: 0,
};

/** The lazy idle float: x = 0.04 sin(0.9t), y = 0.05 sin(1.3t), scaled by `amp`. */
const floatPath = (t: number, amp: number, m: number) => ({
  bodyX: 0.04 * Math.sin(t * 0.9) * amp * m,
  lift: 0.05 * Math.sin(t * 1.3) * amp * m,
});

/** Wings: 8 Hz flutter for 1 s, then a 1.5 s glide. */
function wingBeat(t: number, m: number, rate = 1): number {
  const into = (t * rate) % 2.5;
  if (into < 1) return 12 * DEG * Math.sin(TAU * 8 * t) * Math.sin(Math.PI * into) * m;
  return 3 * DEG * Math.sin((TAU * t) / 2) * m;
}

const orbPulse = (t: number) => 0.7 + 0.3 * (0.5 + 0.5 * Math.sin((TAU * t) / 2));

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
      // A dim orb glows on the ground, brightens, the body fades in above it,
      // wings unfold, she lifts off, opens her eyes and does a happy spin.
      return {
        pose: {
          hover: kf(st, [[0, 0], [800, 0], [1200, 1, Ease.outCubic]]),
          bodyAlpha: kf(st, [[0, 0], [400, 0], [800, 1]]),
          orb: kf(st, [[0, 0.1], [400, 0.4], [800, 0.95]]),
          wingFold: kf(st, [[0, 1], [800, 1], [1200, 0, Ease.outBack]]),
          eyeOpen: kf(st, [[1200, 0.06], [1350, 1]]),
          turn: kf(st, [[1300, 1], [1420, -1, Ease.inOutSine], [1560, 1, Ease.inOutSine]]),
          blink: 0,
        },
        eye: st >= 1400 ? "happy" : "round",
      };

    case "IDLE": {
      const cycle = Math.floor(t / 18);
      const into = t - cycle * 18;
      const fl = into < 2.2 ? Math.sin((Math.PI * into) / 2.2) : 0;
      return {
        pose: {
          ...floatPath(t, 1, m),
          wingFlap: wingBeat(t, m),
          orb: orbPulse(t),
          bodyRot: 3 * DEG * Math.sin(t * 0.9) * m,
          antPerk: 0.15 * Math.sin((TAU * t) / 3.1),
          gazeLock: fl,
          gazeLockX: hash01(cycle + 5) < 0.5 ? -0.9 : 0.9,
          gazeLockY: -0.2,
        },
        eye: "round",
      };
    }

    case "ATTENTIVE":
      return {
        pose: { ...floatPath(t, 0.5, m), wingFlap: wingBeat(t, m), orb: 0.9, antPerk: 1, eyeScale: 1.08 },
        eye: "round",
      };

    case "TOUCHED": {
      if (i.variant === "dizzy") {
        return {
          pose: {
            bodyRot: dizzyWobble(st, m),
            wingFlap: wingBeat(t, m, 2),
            orb: 0.6 + 0.3 * Math.sin(st / 50),
            antDroop: 0.6,
            mouthO: st >= 1200 ? 0.35 : 0,
            blink: 0,
          },
          eye: st < 1200 ? "spiral" : "closed",
        };
      }
      // A quick spin, happy eyes, the orb flashes.
      return {
        pose: {
          ...touchSquash(st),
          turn: kf(st, [[0, 1], [150, -1, Ease.inOutSine], [320, 1, Ease.inOutSine]]),
          orb: kf(st, [[0, 0.85], [120, 1], [600, 0.85]]),
          orbFlash: kf(st, [[0, 0], [120, 1], [500, 0]]),
          wingFlap: wingBeat(t, m, 2),
          mouthCurve: 1,
        },
        eye: st >= 120 && st < 500 ? "happy" : "round",
      };
    }

    case "WORKING": {
      if (i.variant !== null && isWork(i.variant)) return working(i, i.variant);
      // A small figure-eight, leaving a light trail; eyes focused.
      const nod = workNod(st);
      return {
        pose: {
          bodyX: 0.12 * Math.sin(t * 2.2) * m,
          lift: (0.06 * Math.sin(t * 4.4) - nod * 0.02) * m,
          bodyRot: 8 * DEG * Math.cos(t * 2.2) * m,
          wingFlap: 12 * DEG * Math.sin(TAU * 8 * t) * m,
          orb: 1,
          eyeOpen: 0.75,
          mouthCurve: 0.15,
          gazeLock: 0.6, gazeLockY: 0.3,
        },
        eye: "round",
      };
    }

    case "SUCCESS":
      return {
        pose: {
          ...successHop(st, m),
          wingFlap: wingBeat(t, m, 2),
          orb: 1,
          orbFlash: kf(st, [[0, 0], [200, 1], [700, 0]]),
          antPerk: 1,
          mouthCurve: 1,
        },
        eye: "happy",
      };

    case "SUGGESTING":
      // Drifts toward the suggestions (assumed to the right) and hovers near them.
      return {
        pose: {
          bodyX: kf(st, [[0, 0], [500, 0.14, Ease.inOutSine]]) * m,
          lift: 0.03 * Math.sin(t * 1.3) * m,
          bodyRot: kf(st, [[0, 0], [300, 8 * DEG, Ease.outBack]]),
          wingFlap: wingBeat(t, m),
          eyeScaleL: 0.95, eyeScaleR: 1.15,
          gazeLock: 0.8, gazeLockX: 0.8, gazeLockY: 0.2,
          antPerk: 0.6,
          orb: 0.9,
        },
        eye: "round",
      };

    case "CONFUSED":
      return {
        pose: {
          ...floatPath(t, 0.5, m),
          bodyRot: confusedTilt(st),
          wingFlap: wingBeat(t, m, 0.6),
          antDroop: 1,
          orb: 0.4,
          eyeTilt: 1,
          mouthCurve: -0.15,
        },
        eye: "round",
      };

    case "ERROR": {
      // The orb flickers twice, she sags a little, then shakes it off.
      const flicker = st < 900 ? 0.55 + 0.4 * Math.cos((TAU * st) / 450) : 0.85;
      return {
        pose: {
          ...errorSlump(st, m),
          hover: kf(st, [[0, 1], [300, 0.8], [2000, 0.8], [2600, 1, Ease.outCubic]]),
          orb: flicker,
          wingFlap: wingBeat(t, m, 0.6),
          eyeTilt: kf(st, [[0, 0], [200, 1], [2200, 1], [2700, 0]]),
          antDroop: kf(st, [[0, 0], [300, 0.7], [2200, 0.7], [2700, 0]]),
          mouthCurve: -0.3,
        },
        eye: "round",
      };
    }

    case "NOTIFY": {
      if (i.variant === "ack") {
        return { pose: { orb: 1, antPerk: 1, mouthCurve: 1, wingFlap: wingBeat(t, m, 2) }, eye: "happy" };
      }
      // Zips toward the viewer, then the orb flashes twice on each pulse.
      const n = notifyPop(st);
      const flash = doubleFlash(st);
      return {
        pose: {
          sx: n.scale, sy: n.scale,
          lift: (n.hop + n.pulse * 0.02) * m,
          wingFlap: 12 * DEG * Math.sin(TAU * 8 * t) * m,
          orb: 0.75 + 0.25 * flash,
          orbFlash: flash,
          antPerk: 1,
          mouthO: 0.25,
        },
        eye: "wide",
      };
    }

    case "SLEEPY": {
      const f = sleepyFace(st);
      return {
        pose: {
          hover: 0.6,
          ...floatPath(t, 0.4, m),
          wingFlap: wingBeat(t, m, 0.4),
          mouthO: f.yawn,
          eyeOpen: f.eyeOpen,
          orb: 0.5,
          antDroop: 0.5,
          blink: 0,
        },
        eye: "half",
      };
    }

    case "SLEEPING":
      // Lands, folds her wings; the orb glows faintly with a slow pulse.
      return {
        pose: {
          hover: kf(st, [[0, 0.6], [1200, 0, Ease.inQuad]]),
          wingFold: kf(st, [[0, 0.3], [1000, 1, Ease.inOutSine]]),
          orb: 0.2 + 0.08 * Math.sin((TAU * t) / 5),
          antDroop: 0.8,
          blink: 0,
        },
        eye: "closed",
      };

    case "WAKING":
      return {
        pose: {
          blink: 0,
          eyeOpen: wakeBlink(st),
          hover: kf(st, [[0, 0], [600, 1, Ease.outBack]]),
          wingFold: kf(st, [[0, 1], [400, 0, Ease.outBack]]),
          wingFlap: wingBeat(t, m, 2),
          orb: kf(st, [[0, 0.2], [500, 0.9]]),
        },
        eye: "round",
      };

    case "HELD":
      return {
        pose: {
          ...heldSwing(i, 1.1),
          wingFlap: 16 * DEG * Math.sin(TAU * 10 * t) * m,
          orb: 1,
          antPerk: 0.4,
          mouthO: 0.3,
        },
        eye: "wide",
      };

    case "LANDING":
      // She flies, so a drop is just a startled bob and a flutter.
      return {
        pose: {
          lift: kf(st, [[0, 0.04], [120, -0.03, Ease.inQuad], [450, 0, Ease.outBack]]) * m,
          sy: kf(st, [[0, 1.04], [120, 0.92, Ease.outQuad], [450, 1, Ease.outElastic]]),
          sx: kf(st, [[0, 0.97], [120, 1.06, Ease.outQuad], [450, 1, Ease.outElastic]]),
          wingFlap: 14 * DEG * Math.sin(TAU * 9 * t) * m,
          orb: 0.95,
        },
        eye: st < 160 ? "closed" : "round",
      };
  }
}

// ── Kinds of work ─────────────────────────────────────────────────────────────
// All keep her hovering where plain WORKING does, so switching between them
// is a short crossfade; each cycle runs on `st` (the state's own clock), so it
// starts on entry and still ticks along under reduced motion.

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
    x, line, k,
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

/** "I need you": every 2.4 s a bounce (0…1) and two flashes; every third bounce a bigger one. */
function callPulse(st: number) {
  const k = st % 2400;
  return {
    pulse: k < 600 ? Math.sin((Math.PI * k) / 600) : 0,
    flash: k < 840 ? Math.abs(Math.sin((Math.PI * k) / 420)) : 0,
    big: Math.floor(st / 2400) % 3 === 2,
  };
}

/** Run cycle: press, watch the output, press again. */
const RUN_MS = 5200;
/** Browse cycle: two scans, an "oh!" in the second. */
const LOOK_MS = 7600;

function working(i: PoseInput, v: WorkVariant): PoseOut {
  const { st, t, motion: m } = i;
  switch (v) {
    case "research": {
      // Her orb becomes a magnifying glass over a floating book of code: it
      // runs along the lines and her eyes go with it; a page turns; now and
      // then she perks up: "found it!".
      const r = reading(st);
      const a = r.aha;
      return {
        pose: {
          hover: 0.88,
          lift: (0.012 * Math.sin(t * 1.3) + 0.04 * a) * m,
          bodyX: 0.012 * Math.sin(t * 0.9) * m,
          bodyRot: -2.5 * DEG * r.x * (1 - a) * m,
          wingFlap: wingBeat(t, m, 0.8),
          book: 1, lens: 1, page: r.flip,
          orbX: 0.1 * r.x * m,
          orbY: (0.02 + 0.022 * r.line) * m,
          orb: 0.95, orbFlash: r.pop,
          antPerk: 0.25 + 0.75 * a,
          eyeOpen: 0.85 + 0.15 * a, eyeScale: 1 + 0.12 * a,
          mouthO: 0.3 * a, mouthCurve: 0.3,
          gazeLock: 1, gazeLockX: 0.75 * r.x * (1 - a), gazeLockY: 0.8 * (1 - a),
        },
        eye: a > 0.5 ? "wide" : "round",
      };
    }

    case "run": {
      // A little terminal with a big button sits under her: she bobs up,
      // dives and presses it with her orb, then hovers watching the output
      // print, glances at you when it's done, and presses again.
      const k = st % RUN_MS;
      const dive = kf(k, [[0, 0], [260, 0.035, Ease.outCubic], [460, -0.12, Ease.inQuad], [640, -0.12], [1050, 0, Ease.outBack]]);
      // Three bobs of anticipation fit the wait exactly, so the loop is seamless.
      const bobble = k > 1050 ? 0.014 * Math.sin((TAU * (k - 1050)) / ((RUN_MS - 1050) / 3)) : 0;
      const flutter = kf(k, [[0, 0], [150, 1], [1050, 1], [1400, 0]]);
      return {
        pose: {
          lift: (dive + bobble) * m,
          sy: kf(k, [[440, 1], [480, 0.95, Ease.outQuad], [640, 0.96], [820, 1, Ease.outElastic]]),
          sx: kf(k, [[440, 1], [480, 1.04, Ease.outQuad], [640, 1.03], [820, 1, Ease.outElastic]]),
          wingFlap: lerp(wingBeat(t, m), 14 * DEG * Math.sin(TAU * 9 * t) * m, flutter),
          console: 1,
          btnDown: kf(k, [[430, 0], [470, 1], [640, 1], [760, 0]]) * m,
          btnLit: kf(k, [[0, 0.15], [450, 0.15], [480, 1], [3300, 1], [3900, 0.15]]),
          out: kf(k, [[600, 0], [3300, 1]]),
          orb: 1, orbFlash: kf(k, [[450, 0], [500, 1], [950, 0]]),
          antPerk: kf(k, [[0, 0.8], [260, 1], [1100, 1], [1500, 0.8]]),
          eyeOpen: kf(k, [[380, 1], [460, 0.45], [640, 0.45], [760, 1]]),
          eyeScale: 1.06,
          mouthO: kf(k, [[1000, 0], [1300, 0.2], [3300, 0.2], [3800, 0]]),
          mouthCurve: 0.6,
          gazeLock: 1, gazeLockX: 0,
          gazeLockY: kf(k, [[0, 0.85], [3900, 0.85], [4300, -0.05, Ease.inOutSine], [4900, -0.05], [5200, 0.85, Ease.inOutSine]]),
        },
        eye: "round",
      };
    }

    case "browse": {
      // Binoculars up: she scans slowly left and right (straight at you on
      // the way across), and now and then lowers them, wide-eyed: "oh!".
      const dir = m ? 0.85 * scan(st, LOOK_MS) : 0.5;
      const k = st % (2 * LOOK_MS);
      const oh = kf(k, [[8700, 0], [8850, 1, Ease.outBack], [9900, 1], [10300, 0, Ease.inOutSine]]);
      return {
        pose: {
          lift: (0.02 * Math.sin(t * 1.3) + 0.035 * oh) * m,
          bodyX: 0.05 * dir * m,
          bodyRot: 6 * DEG * dir * m,
          wingFlap: wingBeat(t, m),
          binoc: 1, binocDir: dir, binocDown: oh * m,
          orb: 0.9, orbFlash: kf(k, [[8700, 0], [8850, 0.9], [9400, 0]]),
          antPerk: 0.4 + 0.6 * oh,
          mouthCurve: 0.4, mouthO: 0.35 * oh,
          eyeScale: 1 + 0.15 * oh,
          gazeLock: 1, gazeLockX: 0.8 * dir * (1 - oh), gazeLockY: -0.1,
        },
        eye: oh > 0.5 ? "wide" : "round",
      };
    }

    case "wait": {
      // "I need you": up close (as NOTIFY), looking right at you, a bounce and
      // two orb flashes every 2.4 s, antennae waving, a glowing "!" overhead.
      // Calm enough to keep up until you answer.
      const c = callPulse(st);
      const hop = c.pulse * (c.big ? 1.6 : 1);
      const near = kf(st, [[0, 1], [350, 1.07, Ease.outBack]]);
      const sway = Math.sin((TAU * st) / 4800);
      return {
        pose: {
          sx: near + 0.025 * hop, sy: near + 0.025 * hop,
          lift: (0.03 * hop + 0.01 * Math.sin(t * 1.6)) * m,
          bodyX: 0.03 * sway * m,
          bodyRot: 4 * DEG * sway * m,
          wingFlap: 12 * DEG * Math.sin(TAU * 8 * t) * m,
          orb: 0.8 + 0.2 * c.flash, orbFlash: c.flash * (m ? 1 : 0.5),
          antPerk: 1, antWave: 0.5 * Math.sin((TAU * st) / 1100) * m,
          mouthO: 0.2 + 0.1 * c.pulse,
          gazeLock: 1, gazeLockX: 0, gazeLockY: -0.1,
          bang: 1, bangPulse: hop * m,
        },
        eye: "wide",
      };
    }

    case "ask": {
      // A question for you: head tilted, one antenna up and one curled, one
      // eye bigger, looking up at you, a "?" beside her; after a while she
      // tilts the other way with a little "hm?".
      const side = m ? ponder(st) : 1;
      const into = kf(st, [[0, 0], [450, 1, Ease.outBack]]);
      return {
        pose: {
          ...floatPath(t, 0.5, m),
          bodyRot: (11 * DEG * side * into + 1.5 * DEG * Math.sin(t * 0.9)) * m,
          wingFlap: wingBeat(t, m, 0.7),
          antTilt: side * into,
          eyeScaleL: 1 - 0.08 * side, eyeScaleR: 1 + 0.08 * side,
          mouthCurve: 0.15, mouthO: 0.18 * (1 - Math.abs(side)),
          orb: 0.75 + 0.1 * Math.sin((TAU * st) / 3000),
          gazeLock: 1, gazeLockX: 0.2 * side, gazeLockY: -0.3,
          ask: into, askSide: side,
        },
        eye: "round",
      };
    }
  }
}

/** Where the orb is, in particle units (y up from the ground). */
function orbAt(p: Pose) {
  const by = LANDED_Y + FLIGHT_RISE * p.hover + p.lift;
  const dx = p.orbX, dy = ORB_DY + p.orbY;
  const c = Math.cos(p.bodyRot), s = Math.sin(p.bodyRot);
  return { x: p.bodyX + dx * c - dy * s, y: by - (dx * s + dy * c) };
}

function events(i: PoseInput, prev: number, emit: Emit, p: Pose) {
  const crossed = crossedAt(prev, i.st);
  const orb = orbAt(p);
  const head = LANDED_Y + FLIGHT_RISE * p.hover + p.lift + 0.22;
  switch (i.state) {
    case "WORKING": {
      if (i.variant === "research") {
        // "Found it!": two sparkles off the lens.
        const n = Math.floor(i.st / READ_MS);
        if (n % 2 === 0 && crossed(n * READ_MS + 6150)) {
          for (const s of [-1, 1]) emit({ kind: "sparkle", x: orb.x + s * 0.1, y: orb.y + 0.08, vx: s * 0.18, vy: 0.25, size: 0.055, life: 0.8, spin: 2 });
        }
        break;
      }
      if (i.variant === "run") {
        // The press: a little glow puff off the button.
        const n = Math.floor(i.st / RUN_MS);
        if (crossed(n * RUN_MS + 470)) {
          for (const s of [-1, 1]) emit({ kind: "glow", x: s * 0.09, y: 0.26, vx: s * 0.25, vy: 0.08, size: 0.05, life: 0.5 });
        }
        break;
      }
      if (i.variant === "browse") {
        const n = Math.floor(i.st / (2 * LOOK_MS));
        if (crossed(n * 2 * LOOK_MS + 8800)) emit({ kind: "sparkle", x: p.bodyX + 0.26, y: head + 0.05, vx: 0.15, vy: 0.2, size: 0.055, life: 0.8, spin: 2 });
        break;
      }
      if (i.variant !== null) break;
      // A light trail: a soft dot every 50 ms that fades over 400 ms.
      const n = Math.floor(i.st / 50);
      if (crossed(n * 50)) emit({ kind: "glow", x: orb.x, y: orb.y, vx: 0, vy: 0, size: 0.06, life: 0.4 });
      break;
    }
    case "SUCCESS":
      if (crossed(200)) {
        for (let k = 0; k < 3; k++) {
          const a = -Math.PI / 2 + (k - 1) * 0.9;
          emit({ kind: "sparkle", x: orb.x + Math.cos(a) * 0.12, y: orb.y - Math.sin(a) * 0.12, vx: Math.cos(a) * 0.25, vy: -Math.sin(a) * 0.25 + 0.1, size: 0.065, life: 0.9, spin: 2 });
        }
      }
      break;
    case "TOUCHED":
      if (i.variant === "dizzy" && crossed(40)) {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * TAU;
          emit({ kind: "star", x: Math.cos(a) * 0.3, y: head + Math.sin(a) * 0.06, vx: -Math.sin(a) * 0.3, vy: 0.05, size: 0.06, life: 1.1, spin: 3 });
        }
      }
      break;
    case "SLEEPING":
      if (i.st >= 1500) {
        const n = Math.floor((i.st - 1500) / 4000);
        if (crossed(1500 + n * 4000)) emit({ kind: "z", x: 0.22, y: head, vx: 0.07, vy: 0.1, size: 0.08, life: 3.2 });
      }
      break;
  }
}

// ── Drawing ───────────────────────────────────────────────────────────────────

/** Teardrop around the body centre: wide round top, tapering to a tip below. */
const BODY = (() => {
  const p = new Path2D();
  p.moveTo(0, 0.34);
  p.bezierCurveTo(0.09, 0.27, 0.22, 0.15, 0.22, 0);
  p.arc(0, 0, 0.22, 0, Math.PI, true);
  p.bezierCurveTo(-0.22, 0.15, -0.09, 0.27, 0, 0.34);
  p.closePath();
  return p;
})();

/** One wing, pointing right from its root at the origin. */
const WING = (() => {
  const p = new Path2D();
  p.moveTo(0, 0);
  p.bezierCurveTo(0.08, -0.13, 0.26, -0.17, 0.33, -0.1);
  p.bezierCurveTo(0.3, -0.02, 0.15, 0.03, 0, 0);
  p.closePath();
  return p;
})();

function draw(g: CanvasRenderingContext2D, p: Pose, eye: string, f: Frame) {
  const { U, ox, oy } = f;
  const by = LANDED_Y + FLIGHT_RISE * p.hover + p.lift; // body centre height
  const bx = ox + p.bodyX * U;

  // Ground shadow (and a mint glow on the ground when she's landed).
  {
    const height = by - LANDED_Y;
    const k = clamp(1 - height * 1.6, 0.35, 1);
    g.save();
    g.translate(bx, oy);
    g.scale(U, U);
    const r = 0.22 * (0.6 + 0.4 * k);
    const sh = g.createRadialGradient(0, 0, 0, 0, 0, r);
    sh.addColorStop(0, `rgba(50,40,90,${0.22 * k})`);
    sh.addColorStop(1, "rgba(50,40,90,0)");
    g.fillStyle = sh;
    g.beginPath();
    g.ellipse(0, 0, r, r * 0.2, 0, 0, TAU);
    g.fill();
    if (k > 0.8) {
      const glow = g.createRadialGradient(0, 0, 0, 0, 0, 0.25);
      glow.addColorStop(0, `rgba(${C.orb},${0.25 * p.orb * k})`);
      glow.addColorStop(1, `rgba(${C.orb},0)`);
      g.fillStyle = glow;
      g.beginPath();
      g.ellipse(0, 0, 0.25, 0.06, 0, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  // Props behind her: the book she reads, the terminal whose button she presses.
  if (p.book > 0.01) drawBook(g, p, f);
  if (p.console > 0.01) drawConsole(g, p, f);

  g.save();
  g.globalAlpha *= clamp(p.bodyAlpha, 0, 1);
  g.translate(bx, oy - by * U);
  g.scale(U, U);
  g.rotate(p.bodyRot);
  g.scale(p.sx * p.turn, p.sy);
  const back = p.turn < 0;

  if (!back) drawWings(g, p, f.detail);
  drawAntennae(g, p);
  drawBody(g, p);
  if (back) drawWings(g, p, f.detail);
  else drawFace(g, p, eye, f.t);
  g.restore();

  // The orb is drawn at full strength even while the body fades in (boot).
  g.save();
  g.translate(bx, oy - by * U);
  g.scale(U, U);
  g.rotate(p.bodyRot);
  g.scale(p.sx, p.sy);
  drawOrb(g, p, U);
  g.restore();

  // "!" (waiting for your OK) and "?" (a question for you), over her head.
  if (p.bang > 0.01) {
    const s = 0.2 * (0.6 + 0.4 * clamp(p.bang, 0, 1.2)) * (1 + 0.14 * p.bangPulse);
    drawMark(g, "!", bx + 0.32 * U, oy - (by + 0.38 + 0.03 * p.bangPulse) * U, s * U, clamp(p.bang, 0, 1), "#9BF6C4", 0.3 + 0.7 * p.orbFlash, -1);
  }
  if (p.ask > 0.01) {
    const side = p.askSide >= 0 ? 1 : -1;
    const a = clamp(p.ask, 0, 1) * clamp(Math.abs(p.askSide) * 1.6 - 0.4, 0, 1);
    const s = 0.2 * (0.6 + 0.4 * clamp(p.ask, 0, 1.2));
    if (a > 0.01) drawMark(g, "?", bx + side * 0.32 * U, oy - (by + 0.38 + 0.012 * Math.sin(f.t * 2)) * U, s * U, a, "#F3EEFF", 0, side > 0 ? -1 : 1);
  }
}

/**
 * A "!" or "?" in a little round speech bubble whose tail points back at
 * her (`tail` −1 down-left, 1 down-right): drawn as strokes, so it stays
 * crisp at any size, with a dark outline for light wallpapers and a light
 * fill for dark ones, and an optional glow. Centred on (x, y); `size` px.
 */
function drawMark(g: CanvasRenderingContext2D, kind: "!" | "?", x: number, y: number, size: number, alpha: number, fill: string, glow: number, tail: -1 | 1) {
  const ink = "#3A2E52";
  g.save();
  g.globalAlpha *= alpha;
  g.translate(x, y);
  g.scale(size, size);
  g.lineCap = "round";
  g.lineJoin = "round";
  if (glow > 0.01) {
    const halo = g.createRadialGradient(0, 0, 0, 0, 0, 1.2);
    halo.addColorStop(0, `rgba(${C.orb},${0.6 * glow})`);
    halo.addColorStop(1, `rgba(${C.orb},0)`);
    g.fillStyle = halo;
    g.beginPath();
    g.arc(0, 0, 1.2, 0, TAU);
    g.fill();
  }
  // The bubble and its tail.
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
  // The glyph.
  g.strokeStyle = ink;
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

/** The book she reads, floating under her: open, with lines of code, lit by her orb; a page turns. */
function drawBook(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  const { U, ox, oy } = f;
  const a = clamp(p.book, 0, 1);
  const cx = ox + p.bodyX * 0.5 * U;
  const cy = oy - (BOOK_Y + 0.006 * Math.sin(f.t * 1.3 + 1)) * U;
  g.save();
  g.globalAlpha *= a;
  g.translate(cx, cy);
  g.scale(U * (0.6 + 0.4 * a), U * (0.6 + 0.4 * a));

  // Cover.
  g.fillStyle = C.bodyDark;
  g.beginPath();
  g.moveTo(-0.225, -0.055);
  g.quadraticCurveTo(-0.11, -0.085, 0, -0.06);
  g.quadraticCurveTo(0.11, -0.085, 0.225, -0.055);
  g.lineTo(0.225, 0.077);
  g.quadraticCurveTo(0.11, 0.062, 0, 0.082);
  g.quadraticCurveTo(-0.11, 0.062, -0.225, 0.077);
  g.closePath();
  g.fill();

  const page = (ex: number, rise: number) => {
    g.beginPath();
    g.moveTo(0, -0.05);
    g.quadraticCurveTo(ex * 0.5, -0.075 + rise, ex, -0.055 + rise);
    g.lineTo(ex, 0.06 + rise);
    g.quadraticCurveTo(ex * 0.5, 0.045 + rise * 0.5, 0, 0.067);
    g.closePath();
  };
  for (const side of [-1, 1] as const) {
    page(side * 0.205, 0);
    g.fillStyle = "#FFFBF2";
    g.fill();
    g.strokeStyle = "rgba(143,127,196,0.7)";
    g.lineWidth = 0.006;
    g.stroke();
    // Lines of code: indents, and three colours.
    g.lineCap = "round";
    g.lineWidth = 0.01;
    for (let j = 0; j < 4; j++) {
      const indent = [0, 0.03, 0.03, 0.015][j];
      const len = 0.06 + 0.08 * hash01(j * 3 + (side + 1) * 11);
      g.strokeStyle = ["#5FC89A", "#8F7FC4", "#E58AB0", "#8F7FC4"][(j + (side + 1)) % 4];
      const x0 = side * (0.03 + indent);
      const y = -0.03 + j * 0.022;
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x0 + side * len, y);
      g.stroke();
    }
  }
  // The spine.
  g.strokeStyle = "rgba(143,127,196,0.8)";
  g.lineWidth = 0.006;
  g.beginPath();
  g.moveTo(0, -0.05);
  g.lineTo(0, 0.067);
  g.stroke();

  // A page turning over, right to left.
  if (p.page > 0.02 && p.page < 0.98) {
    const ex = 0.205 * Math.cos(Math.PI * p.page);
    const rise = -0.04 * Math.sin(Math.PI * p.page);
    page(ex, rise);
    g.fillStyle = ex > 0 ? "#F4EEFF" : "#FFFBF2";
    g.fill();
    g.strokeStyle = "rgba(143,127,196,0.7)";
    g.stroke();
  }

  // Her orb lights the page where she reads.
  if (p.lens > 0.01) {
    const o = orbAt(p);
    const gx = o.x - (cx - ox) / U;
    const gy = -(o.y - (oy - cy) / U);
    const glow = g.createRadialGradient(gx, gy, 0, gx, gy, 0.11);
    glow.addColorStop(0, `rgba(${C.orb},${0.4 * p.lens})`);
    glow.addColorStop(1, `rgba(${C.orb},0)`);
    g.fillStyle = glow;
    g.beginPath();
    g.arc(gx, gy, 0.11, 0, TAU);
    g.fill();
  }
  g.restore();
}

/** The terminal under her: a screen printing output, and a big button on top. */
function drawConsole(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  const { U, ox, oy } = f;
  const a = clamp(p.console, 0, 1);
  const lit = clamp(p.btnLit, 0, 1);
  g.save();
  g.globalAlpha *= a;
  g.translate(ox, oy);
  g.scale(U * (0.6 + 0.4 * a), U * (0.6 + 0.4 * a));

  // The box.
  const shell = g.createLinearGradient(0, -0.2, 0, 0);
  shell.addColorStop(0, "#E6DFFB");
  shell.addColorStop(1, "#BBAEE6");
  g.fillStyle = shell;
  g.beginPath();
  g.roundRect(-0.17, -0.2, 0.34, 0.2, 0.035);
  g.fill();
  g.strokeStyle = C.bodyDark;
  g.lineWidth = 0.01;
  g.stroke();

  // The screen.
  g.fillStyle = "#2A2342";
  g.beginPath();
  g.roundRect(-0.135, -0.168, 0.27, 0.13, 0.02);
  g.fill();
  g.lineCap = "round";
  g.lineWidth = 0.011;
  // The command: a prompt and what was typed.
  g.strokeStyle = "#FFB3CB";
  g.beginPath();
  g.moveTo(-0.115, -0.156);
  g.lineTo(-0.103, -0.148);
  g.lineTo(-0.115, -0.14);
  g.moveTo(-0.088, -0.148);
  g.lineTo(-0.02, -0.148);
  g.stroke();
  // Its output, printing.
  const rows = 4 * clamp(p.out, 0, 1);
  g.strokeStyle = `rgba(${C.orb},0.95)`;
  let endX = -0.02, endY = -0.148;
  for (let j = 0; j < 4 && j < rows; j++) {
    const full = 0.07 + 0.13 * hash01(j + 4);
    const len = full * clamp(rows - j, 0, 1);
    const y = -0.124 + j * 0.022;
    g.beginPath();
    g.moveTo(-0.115, y);
    g.lineTo(-0.115 + len, y);
    g.stroke();
    endX = -0.115 + len;
    endY = y;
  }
  // The cursor, blinking at the end.
  if (Math.floor(f.t * 2.2) % 2 === 0) {
    g.fillStyle = `rgba(${C.orb},0.95)`;
    g.fillRect(endX + 0.012, endY - 0.008, 0.012, 0.016);
  }

  // The big button: collar, dome (squashed when pressed), and its glow when lit.
  const top = -0.2;
  if (lit > 0.01) {
    const halo = g.createRadialGradient(0, top - 0.03, 0, 0, top - 0.03, 0.16);
    halo.addColorStop(0, `rgba(255,128,168,${0.5 * lit})`);
    halo.addColorStop(1, "rgba(255,128,168,0)");
    g.fillStyle = halo;
    g.beginPath();
    g.arc(0, top - 0.03, 0.16, 0, TAU);
    g.fill();
  }
  g.fillStyle = C.bodyDark;
  g.beginPath();
  g.ellipse(0, top, 0.088, 0.024, 0, 0, TAU);
  g.fill();
  const h = 0.055 * (1 - 0.5 * clamp(p.btnDown, 0, 1));
  const dome = g.createLinearGradient(0, top - h, 0, top);
  dome.addColorStop(0, lit > 0.5 ? "#FFD0DE" : "#FFB0C6");
  dome.addColorStop(1, lit > 0.5 ? "#FF6F98" : "#E0577F");
  g.fillStyle = dome;
  g.beginPath();
  g.moveTo(-0.07, top);
  g.bezierCurveTo(-0.07, top - h * 1.3, 0.07, top - h * 1.3, 0.07, top);
  g.ellipse(0, top, 0.07, 0.019, 0, 0, Math.PI);
  g.closePath();
  g.fill();
  g.strokeStyle = "#B03A62";
  g.lineWidth = 0.008;
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.7)";
  g.beginPath();
  g.ellipse(-0.025, top - h * 0.75, 0.018, 0.008, -0.3, 0, TAU);
  g.fill();
  g.restore();
}

function drawWings(g: CanvasRenderingContext2D, p: Pose, detail: number) {
  for (const side of [-1, 1] as const) {
    g.save();
    g.translate(side * 0.07, -0.1);
    g.scale(side, 1);
    // Flap about the root; folding swings the wing down along the back and shortens it.
    g.rotate(-p.wingFlap - 0.15 + p.wingFold * 1.0);
    const len = 1.2 * (1 - 0.45 * clamp(p.wingFold, 0, 1));
    g.scale(len, 1.15);
    g.fillStyle = `rgba(${C.wing},0.6)`;
    g.fill(WING);
    // A cool outline keeps the pale wing readable on light wallpapers too.
    g.strokeStyle = "rgba(150,165,215,0.65)";
    g.lineWidth = 0.008;
    g.stroke(WING);
    if (detail > 0.3) {
      g.strokeStyle = `rgba(160,180,220,${0.45 * detail})`;
      g.lineWidth = 0.005;
      g.beginPath();
      g.moveTo(0.01, -0.01);
      g.quadraticCurveTo(0.17, -0.1, 0.31, -0.1);
      g.moveTo(0.12, -0.065);
      g.lineTo(0.17, -0.13);
      g.moveTo(0.2, -0.09);
      g.lineTo(0.25, -0.03);
      g.stroke();
    }
    g.restore();
  }
}

function drawAntennae(g: CanvasRenderingContext2D, p: Pose) {
  for (const side of [-1, 1] as const) {
    // Perk lifts them forward and up; droop lets them fall outward; lag trails motion.
    // Asking: the antenna on `antTilt`'s side stands up, the other curls out.
    const own = side * p.antTilt;
    const tilt = side * (own > 0 ? -0.35 * own : -0.7 * own);
    const swing = side * (-0.25 * p.antPerk + 0.9 * p.antDroop) + tilt + p.antWave - p.lagX * 2.5;
    const base = { x: side * 0.06, y: -0.2 };
    const len = 0.17;
    const a = -Math.PI / 2 + side * 0.45 + swing;
    const tip = { x: base.x + Math.cos(a) * len, y: base.y + Math.sin(a) * len };
    const ctrl = { x: base.x + Math.cos(a - side * 0.4) * len * 0.6, y: base.y + Math.sin(a - side * 0.4) * len * 0.6 };
    g.strokeStyle = C.bodyDark;
    g.lineWidth = 0.016;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(base.x, base.y);
    g.quadraticCurveTo(ctrl.x, ctrl.y, tip.x, tip.y);
    g.stroke();
    g.fillStyle = C.tip;
    g.beginPath();
    g.arc(tip.x, tip.y, 0.024, 0, TAU);
    g.fill();
  }
}

function drawBody(g: CanvasRenderingContext2D, p: Pose) {
  const bg = g.createRadialGradient(-0.08, -0.1, 0.02, 0, 0.02, 0.36);
  bg.addColorStop(0, C.bodyLight);
  bg.addColorStop(0.55, C.body);
  bg.addColorStop(1, C.bodyDark);
  g.fillStyle = bg;
  g.fill(BODY);
  // The orb lights the tip from below.
  const glow = g.createRadialGradient(0, 0.36, 0, 0, 0.36, 0.2);
  glow.addColorStop(0, `rgba(${C.orb},${0.35 * p.orb})`);
  glow.addColorStop(1, `rgba(${C.orb},0)`);
  g.fillStyle = glow;
  g.fill(BODY);
}

function drawFace(g: CanvasRenderingContext2D, p: Pose, eye: string, t: number) {
  const fx = p.gazeX * 0.03;
  const fy = p.gazeY * 0.02;
  for (const side of [-1, 1] as const) {
    drawEye(g, fx + side * 0.085 + p.gazeX * 0.01, -0.03 + fy, side, eye, p, t);
  }
  // Tiny mouth.
  g.save();
  g.translate(fx, 0.075 + fy);
  if (p.mouthO > 0.05) {
    g.fillStyle = "#3A2E52";
    g.beginPath();
    g.ellipse(0, 0, 0.016 + 0.006 * p.mouthO, 0.006 + 0.022 * p.mouthO, 0, 0, TAU);
    g.fill();
  } else {
    g.strokeStyle = C.eye;
    g.lineWidth = 0.012;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-0.022, 0);
    g.quadraticCurveTo(0, 0.03 * p.mouthCurve, 0.022, 0);
    g.stroke();
  }
  g.restore();
  if (p.binoc > 0.01) drawBinoculars(g, p);
}

/**
 * Binoculars at her eyes. `binocDir` points them: the barrels foreshorten to
 * two round lenses when she looks straight at you, and stretch out sideways
 * as she looks left or right. `binocDown` lowers them off her face.
 */
function drawBinoculars(g: CanvasRenderingContext2D, p: Pose) {
  const a = clamp(p.binoc, 0, 1);
  const dir = clamp(p.binocDir, -1, 1);
  const across = Math.sqrt(1 - dir * dir);
  const down = clamp(p.binocDown, 0, 1.2);
  g.save();
  g.globalAlpha *= a;
  g.translate(0, 0.14 * down + 0.08 * (1 - a));
  g.rotate(0.12 * down * (dir >= 0 ? 1 : -1));
  const L = 0.21;
  const R = 0.074;
  const ends = ([-1, 1] as const).map((side) => {
    const e = { x: side * 0.09, y: -0.035 };
    return { e, o: { x: e.x + dir * L, y: e.y - 0.03 * Math.abs(dir) } };
  });
  // The far barrel first.
  if (dir > 0) ends.reverse();
  const along = (e: { x: number; y: number }, o: { x: number; y: number }, k: number) => ({ x: lerp(e.x, o.x, k), y: lerp(e.y, o.y, k) });
  const tube = (a: { x: number; y: number }, b: { x: number; y: number }, r: number, fill: string) => {
    g.lineCap = "round";
    g.strokeStyle = "#2E2550";
    g.lineWidth = 2 * r + 0.018;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.strokeStyle = fill;
    g.lineWidth = 2 * r;
    g.stroke();
  };
  // The hinge between them.
  const mid = along({ x: 0, y: -0.035 }, { x: dir * L, y: -0.035 - 0.03 * Math.abs(dir) }, 0.45);
  g.fillStyle = "#2E2550";
  g.beginPath();
  g.roundRect(mid.x - 0.06, mid.y - 0.03, 0.12, 0.06, 0.02);
  g.fill();
  for (const { e, o } of ends) {
    // Eyecup, then the fat barrel, with a lighter band and a highlight along the top.
    tube(e, along(e, o, 0.35), R * 0.72, "#463A78");
    tube(along(e, o, 0.3), o, R, "#5A4B94");
    const band = along(e, o, 0.62);
    g.strokeStyle = "rgba(184,169,230,0.55)";
    g.lineWidth = 0.022;
    g.beginPath();
    g.ellipse(band.x, band.y, R * Math.max(0.22, Math.sqrt(1 - dir * dir)), R, 0, 0, TAU);
    g.stroke();
    g.strokeStyle = "rgba(214,204,245,0.6)";
    g.lineWidth = 0.014;
    g.beginPath();
    const a0 = along(e, o, 0.35);
    g.moveTo(a0.x, a0.y - R * 0.62);
    g.lineTo(o.x, o.y - R * 0.62);
    g.stroke();
  }
  for (const { o } of ends) {
    // The big lens, seen at an angle.
    const rx = R * Math.max(0.22, across);
    const lg = g.createRadialGradient(o.x - rx * 0.3, o.y - R * 0.3, 0, o.x, o.y, R);
    lg.addColorStop(0, "#5E7FA8");
    lg.addColorStop(0.6, "#2C3558");
    lg.addColorStop(1, "#1C1A33");
    g.fillStyle = lg;
    g.beginPath();
    g.ellipse(o.x, o.y, rx, R, 0, 0, TAU);
    g.fill();
    g.strokeStyle = "#8F7FC4";
    g.lineWidth = 0.012;
    g.stroke();
    if (across > 0.35) {
      g.fillStyle = "rgba(255,255,255,0.85)";
      g.beginPath();
      g.ellipse(o.x - rx * 0.35, o.y - R * 0.35, rx * 0.22, R * 0.16, -0.5, 0, TAU);
      g.fill();
      g.fillStyle = `rgba(${C.orb},0.5)`;
      g.beginPath();
      g.arc(o.x + rx * 0.3, o.y + R * 0.3, R * 0.12, 0, TAU);
      g.fill();
    }
  }
  g.restore();
}

function drawEye(g: CanvasRenderingContext2D, cx: number, cy: number, side: -1 | 1, shape: string, p: Pose, t: number) {
  const s = p.eyeScale * (side < 0 ? p.eyeScaleL : p.eyeScaleR);
  const r = 0.064 * s;
  g.save();
  g.translate(cx, cy);
  g.scale(1, p.eyeMorph);
  g.fillStyle = C.eye;
  g.strokeStyle = C.eye;
  g.lineCap = "round";
  g.lineWidth = 0.02;
  switch (shape) {
    case "round":
    case "wide":
    case "half": {
      const rr = shape === "wide" ? r * 1.15 : r;
      const open = clamp(p.eyeOpen, 0.06, 1);
      const ry = rr * open * (shape === "half" ? 0.85 : 1);
      if (p.eyeTilt > 0.01 || shape === "half") {
        // Worried: the outer upper corner dips. Sleepy: heavy upper lid.
        const lid = (x: number) => (shape === "half" ? -ry * 0.05 : -ry + p.eyeTilt * ry * 0.8 * (1 + (x * side) / rr) * 0.5);
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
        g.arc(-0.3 * rr, -0.35 * ry, 0.32 * rr, 0, TAU);
        g.fill();
        g.beginPath();
        g.arc(0.3 * rr, 0.3 * ry, 0.15 * rr, 0, TAU);
        g.fill();
      }
      break;
    }
    case "happy":
      g.beginPath();
      g.arc(0, 0.02, r * 0.95, Math.PI + 0.25, TAU - 0.25);
      g.stroke();
      break;
    case "closed":
      g.beginPath();
      g.arc(0, -0.025, r * 0.95, 0.3, Math.PI - 0.3);
      g.stroke();
      break;
    case "spiral":
      g.lineWidth = 0.012;
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

function drawOrb(g: CanvasRenderingContext2D, p: Pose, U: number) {
  const I = clamp(p.orb, 0, 1);
  const lens = clamp(p.lens, 0, 1);
  // Where the orb is (off its rest when reading along a line), and how big:
  // as a magnifying glass it grows into a lens and its stalk into the handle.
  const cx = p.orbX;
  const cy = ORB_DY + p.orbY;
  const R = lerp(ORB_R, LENS_R, lens);
  const d = Math.hypot(cx, cy - 0.33) || 1;
  const sx = cx - (cx / d) * R * 0.8;
  const sy = cy - ((cy - 0.33) / d) * R * 0.8;
  g.save();
  g.globalAlpha *= clamp(p.bodyAlpha, 0, 1);
  g.strokeStyle = C.bodyDark;
  g.lineWidth = 0.014 + 0.012 * lens;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(0, 0.33);
  g.quadraticCurveTo(0, (0.33 + sy) / 2, sx, sy);
  g.stroke();
  g.restore();

  // Halo, then the glowing core.
  const halo = 0.12 + 0.14 * I + 0.08 * p.orbFlash + 0.03 * lens;
  const hg = g.createRadialGradient(cx, cy, 0, cx, cy, halo);
  hg.addColorStop(0, `rgba(${C.orb},${0.55 * I})`);
  hg.addColorStop(1, `rgba(${C.orb},0)`);
  g.fillStyle = hg;
  g.beginPath();
  g.arc(cx, cy, halo, 0, TAU);
  g.fill();

  if (lens > 0.01) drawLens(g, p, cx, cy, R, lens);
  if (lens > 0.99) return;

  g.save();
  g.globalAlpha *= 1 - lens;
  g.shadowColor = `rgba(${C.orb},1)`;
  g.shadowBlur = U * 0.06 * I;
  const cg = g.createRadialGradient(cx - 0.02, cy - 0.02, 0, cx, cy, ORB_R);
  cg.addColorStop(0, `rgba(240,255,248,${0.5 + 0.5 * I})`);
  cg.addColorStop(0.5, `rgba(${C.orb},${0.45 + 0.55 * I})`);
  cg.addColorStop(1, `rgba(110,210,160,${0.4 + 0.6 * I})`);
  g.fillStyle = cg;
  g.beginPath();
  g.arc(cx, cy, ORB_R, 0, TAU);
  g.fill();
  g.restore();
}

/** The orb as a magnifying glass: mint-lit glass, the code under it big, a rim and a glint. */
function drawLens(g: CanvasRenderingContext2D, p: Pose, cx: number, cy: number, R: number, a: number) {
  g.save();
  g.globalAlpha *= a;
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  const glass = g.createRadialGradient(cx - R * 0.3, cy - R * 0.3, 0, cx, cy, R);
  glass.addColorStop(0, "rgba(250,255,252,0.95)");
  glass.addColorStop(0.6, "rgba(214,252,232,0.9)");
  glass.addColorStop(1, `rgba(${C.orb},0.85)`);
  g.fillStyle = glass;
  g.fill();
  // The code under the glass, magnified, sliding by as the lens moves along the line.
  g.save();
  g.clip();
  g.lineCap = "round";
  g.lineWidth = 0.02;
  const P = 0.13;
  const shift = -p.orbX * 2.2;
  const o = ((shift % P) + P) % P;
  const base = Math.floor(shift / P);
  for (let j = -1; j <= 1; j++) {
    g.strokeStyle = ["#5FC89A", "#8F7FC4", "#E58AB0"][j + 1];
    for (let n = -2; n <= 2; n++) {
      const len = 0.04 + 0.06 * hash01(n - base + j * 7);
      const x = cx + o + n * P - P / 2;
      const y = cy + j * 0.036;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + len, y);
      g.stroke();
    }
  }
  g.restore();
  // The rim.
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.strokeStyle = C.bodyDark;
  g.lineWidth = 0.022;
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, R - 0.014, 0, TAU);
  g.strokeStyle = "rgba(255,255,255,0.6)";
  g.lineWidth = 0.006;
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, R * 0.66, Math.PI * 1.1, Math.PI * 1.45);
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineWidth = 0.014;
  g.stroke();
  g.restore();
}

export const glim: Skin = {
  id: "glim",
  // Framed a little closer than the others: she's smaller, and floats.
  fit: { units: 1.75, base: 0.9 },
  // Antenna tips to orb, wings included.
  hit: { x0: 0.27, y0: 0.19, x1: 0.73, y1: 0.74 },
  rest,
  restEye: "round",
  pose,
  events,
  draw,
};
