// Kulhi, the chai cup companion. A terracotta kulhad drawn in code, with a
// procedural steam wisp as its emotional antenna (spec 1.1 and Section 4).
//
// Drawing space: units, origin at the centre of the base, y down (so the rim is
// at y ≈ −0.93). The engine scales 1 unit to the character's height.

import { Ease, clamp, lerp, smoothstep } from "../engine/ease";
import { hash01, kf, osc } from "../engine/track";
import type { Emit, Frame, Pose, PoseInput, PoseOut, Skin } from "../engine/types";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const COLOR = {
  eye: "#2B1B14",
  mouthInside: "#3B1A10",
  speck: "122,53,25",
  steam: "244,239,230",
};

const RIM_Y = -0.93;

// ── Pose ──────────────────────────────────────────────────────────────────────

const rest: Pose = {
  // engine channels
  lift: 0, bodyX: 0, bodyRot: 0, sx: 1, sy: 1, fade: 1,
  eyeOpen: 1, blink: 1, gazeLock: 0, gazeLockX: 0, gazeLockY: 0,
  // face
  eyeScale: 1, eyeScaleL: 1, eyeScaleR: 1, eyeTilt: 0,
  mouthCurve: 0.55, mouthOpen: 0,
  // body
  armL: 0, armR: 0, chaiTilt: 0,
  // steam: length/opacity, shape of the free wisp, and weights of the special shapes
  steamLen: 1, steamAlpha: 1,
  steamWobble: 1, steamCurl: 1, steamLean: 0, steamDroop: 0, steamJitter: 0, steamPuff: 0,
  sSpiral: 0, sQuestion: 0, sHeart: 0,
  // kinds of work (WORKING's variants): one eye squinted, nubs moved or held in
  // front of the cup, and the props, each 0 (put away) … 1 (in hand)
  eyeSquintL: 0, eyeSquintR: 0,
  armLdx: 0, armLdy: 0, armRdx: 0, armRdy: 0, armLfront: 0, armRfront: 0,
  book: 0, pageTurn: 0, lens: 0, lensLift: 0,
  button: 0, buttonDown: 0, buttonLit: 0,
  spyglass: 0, spyAngle: 0, spyDrop: 0,
  sign: 0, signWave: 0,
  steamShade: 0, // a deeper shadow under the steam, so a "?" in it reads on light wallpapers
};

function pose(i: PoseInput): PoseOut {
  const { st, t, motion: m } = i;

  switch (i.state) {
    case "OFF":
      return { pose: { fade: 0, steamLen: 0 }, eye: "oval" };

    case "BOOTING": {
      // Empty cup pops in, eyes open, a puff, steam rises and curls, happy hop.
      const sc = kf(st, [[0, 0.8], [300, 1, Ease.outBack]]);
      return {
        pose: {
          fade: kf(st, [[0, 0], [300, 1, Ease.outCubic]]),
          sx: sc, sy: sc,
          blink: 0,
          eyeOpen: kf(st, [[0, 0.06], [300, 0.06], [600, 1, Ease.outQuad]]),
          steamLen: kf(st, [[600, 0], [900, 0.18, Ease.outCubic], [1400, 1, Ease.outCubic]]),
          steamPuff: kf(st, [[600, 0], [750, 0.8], [1000, 0]]),
          lift: kf(st, [[1400, 0], [1500, 0.05, Ease.outCubic], [1600, 0, Ease.inQuad]]) * m,
          mouthCurve: st >= 1400 ? 1 : 0.55,
        },
        eye: st >= 1400 ? "happy" : "oval",
      };
    }

    case "IDLE": {
      // Every 16 s a 2 s flourish: a bigger steam loop, or a glance around.
      const cycle = Math.floor(t / 16);
      const into = t - cycle * 16;
      const flourish = into < 2.2 ? Math.sin((Math.PI * into) / 2.2) : 0;
      const glance = hash01(cycle) < 0.5;
      return {
        pose: {
          chaiTilt: osc(t, 3.2, 0.6 * m),
          armL: osc(t, 3.2, 0.06 * m),
          armR: osc(t, 3.2, 0.06 * m, 0.6),
          steamCurl: 1 + (glance ? 0 : flourish * 1.2),
          gazeLock: glance ? flourish : 0,
          gazeLockX: hash01(cycle + 7) < 0.5 ? -0.9 : 0.9,
          gazeLockY: -0.1,
        },
        eye: "oval",
      };
    }

    case "ATTENTIVE":
      return {
        pose: { eyeScale: 1.08, steamCurl: 0.5, steamWobble: 0.5, mouthCurve: 0.65, armL: 0.15, armR: 0.15 },
        eye: "oval",
      };

    case "TOUCHED": {
      if (i.variant === "dizzy") {
        // Spiral eyes and two wobbles, then a "phew" with closed eyes.
        const wob = st < 1200 ? Math.sin((TAU * st) / 600) * (1 - st / 1400) : 0;
        return {
          pose: {
            bodyRot: 8 * DEG * wob * m,
            steamWobble: 2.4, steamJitter: st < 1200 ? 0.3 : 0,
            mouthCurve: st < 1200 ? -0.1 : 0.25,
            mouthOpen: st >= 1200 ? 0.35 : 0,
            armL: -0.2, armR: -0.2,
            blink: 0,
          },
          eye: st < 1200 ? "spiral" : "closed",
        };
      }
      // Squash, stretch, elastic settle; happy eyes; steam puffs into a curl.
      return {
        pose: {
          sy: kf(st, [[0, 1], [120, 0.88, Ease.outQuad], [300, 1.08, Ease.outQuad], [600, 1, Ease.outElastic]]),
          sx: kf(st, [[0, 1], [120, 1.1, Ease.outQuad], [300, 0.94, Ease.outQuad], [600, 1, Ease.outElastic]]),
          steamPuff: kf(st, [[0, 0], [150, 1, Ease.outCubic], [600, 0]]),
          steamCurl: 1.6,
          armL: kf(st, [[0, 0], [200, 0.6, Ease.outBack], [600, 0]]),
          armR: kf(st, [[0, 0], [200, 0.6, Ease.outBack], [600, 0]]),
          mouthCurve: 1,
        },
        eye: st >= 120 && st < 500 ? "happy" : "oval",
      };
    }

    case "WORKING": {
      switch (i.variant) {
        case "research": return researching(i);
        case "run": return running(i);
        case "browse": return lookingOut(i);
        case "wait": return waitingForOk(i);
        case "ask": return asking(i);
      }
      // Spiral steam, eyes up-left, bobbing; after 5 s a determined nod every 3 s.
      const k = st > 5000 ? (st - 5000) % 3000 : Infinity;
      const nod = k < 350 ? Math.sin((Math.PI * k) / 350) : 0;
      return {
        pose: {
          sSpiral: 1,
          lift: (osc(t, 1.6, 0.015) - nod * 0.012) * m,
          sy: 1 - nod * 0.04 * m,
          gazeLock: 1, gazeLockX: -0.75, gazeLockY: -0.75,
          eyeScale: 0.96, mouthCurve: 0.15,
          armL: (0.25 + osc(t, 0.8, 0.08)) * m,
          armR: (0.25 + osc(t, 0.8, 0.08, Math.PI)) * m,
        },
        eye: "oval",
      };
    }

    case "SUCCESS": {
      const short = i.variant === "short";
      const end = short ? 1200 : 2500;
      return {
        pose: {
          lift: kf(st, [[0, 0], [200, 0.08, Ease.outCubic], [400, 0, Ease.inQuad]]) * m,
          sy: kf(st, [[400, 1], [480, 0.92, Ease.outQuad], [650, 1, Ease.outElastic]]),
          sx: kf(st, [[400, 1], [480, 1.05, Ease.outQuad], [650, 1, Ease.outElastic]]),
          steamLen: 0.85, steamCurl: 0.4, steamWobble: 0.6,
          armL: kf(st, [[0, 0], [200, 0.9, Ease.outBack], [end - 600, 0.9], [end - 150, 0]]),
          armR: kf(st, [[0, 0], [200, 0.9, Ease.outBack], [end - 600, 0.9], [end - 150, 0]]),
          mouthCurve: 1,
        },
        eye: "happy",
      };
    }

    case "SUGGESTING":
      // Curious tilt toward the suggestions (assumed to the right for now).
      return {
        pose: {
          bodyRot: kf(st, [[0, 0], [300, 8 * DEG, Ease.outBack]]),
          eyeScaleL: 1.15, eyeScaleR: 0.95,
          steamLean: 1, steamCurl: 0.6,
          gazeLock: 0.8, gazeLockX: 0.8, gazeLockY: 0.2,
          mouthCurve: 0.35,
          armR: 0.5,
        },
        eye: "oval",
      };

    case "CONFUSED": {
      const tilt = 6 * DEG;
      return {
        pose: {
          bodyRot: kf(st, [
            [0, 0], [300, tilt, Ease.inOutSine], [900, -tilt, Ease.inOutSine],
            [1500, tilt, Ease.inOutSine], [2100, -tilt, Ease.inOutSine], [2400, 0, Ease.inOutSine],
          ]),
          sQuestion: kf(st, [[0, 0], [350, 1, Ease.outCubic], [2600, 1], [3000, 0]]),
          eyeTilt: 1,
          mouthCurve: -0.15,
          armL: 0.7,
        },
        eye: "oval",
      };
    }

    case "ERROR": {
      // Slump, flickering steam, then "shake it off" and recover.
      const shake = st >= 2000 && st < 2600
        ? 5 * DEG * Math.sin((TAU * (st - 2000)) / 200) * (1 - (st - 2000) / 600)
        : 0;
      return {
        pose: {
          lift: kf(st, [[0, 0], [300, -0.03, Ease.outQuad], [2000, -0.03], [2600, 0, Ease.outCubic]]),
          bodyRot: shake,
          steamJitter: kf(st, [[0, 0], [200, 1], [1800, 1], [2100, 0]]),
          steamAlpha: st < 2000 ? 0.7 + 0.25 * Math.sin((TAU * st) / 350) : 1,
          steamLen: kf(st, [[0, 1], [300, 0.7], [2200, 0.7], [2800, 1, Ease.outCubic]]),
          eyeTilt: kf(st, [[0, 0], [200, 1], [2200, 1], [2700, 0]]),
          mouthCurve: kf(st, [[0, 0.55], [200, -0.35], [2200, -0.35], [2700, 0.55]]),
          armL: -0.3, armR: -0.3,
        },
        eye: "oval",
      };
    }

    case "NOTIFY": {
      if (i.variant === "ack") {
        // Thanks! The steam curls into a little heart.
        return {
          pose: { mouthCurve: 1, sHeart: kf(st, [[0, 0], [250, 1, Ease.outCubic]]), armL: 0.4, armR: 0.4 },
          eye: "happy",
        };
      }
      // Pop toward the viewer, then an attention pulse every 1.2 s: steam shoots up and puffs.
      const k = st >= 400 ? ((st - 400) % 1200) / 1200 : 1;
      const pulse = k < 0.25 ? Math.sin((Math.PI * k) / 0.25) : 0;
      const sc = kf(st, [[0, 1], [400, 1.12, Ease.outBack], [700, 1.06, Ease.outCubic]]);
      return {
        pose: {
          sx: sc, sy: sc,
          lift: (kf(st, [[0, 0], [200, 0.06, Ease.outCubic], [400, 0, Ease.inQuad]]) + pulse * 0.025) * m,
          steamCurl: 0, steamWobble: 0.25, steamLen: 1.05,
          steamPuff: pulse,
          mouthCurve: 0.3, mouthOpen: 0.25,
          armL: 0.5 + pulse * 0.3, armR: 0.5 + pulse * 0.3,
        },
        eye: "wide",
      };
    }

    case "SLEEPY": {
      // A yawn on entry, then heavy lids with slow blinks every 2 s.
      const b = st % 2000;
      const slowBlink = st > 1600 && b < 400 ? Math.sin((Math.PI * b) / 400) : 0;
      return {
        pose: {
          mouthOpen: kf(st, [[0, 0], [600, 1, Ease.outCubic], [1000, 1], [1600, 0, Ease.inQuad]]),
          mouthCurve: 0.2,
          eyeOpen: 1 - 0.95 * slowBlink,
          blink: 0,
          steamLen: 0.5, steamDroop: 1, steamCurl: 0.4, steamWobble: 0.4,
          lift: -0.01 * m,
          armL: -0.15, armR: -0.15,
        },
        eye: "half",
      };
    }

    case "SLEEPING":
      return {
        pose: {
          lift: kf(st, [[0, -0.01], [1200, -0.04, Ease.inQuad]]) * m,
          blink: 0,
          // Faint but still there: an asleep Kulhi should be easy to spot on a dark desktop.
          steamLen: 0.4, steamAlpha: 0.45, steamWobble: 0.3, steamCurl: 0.3,
          mouthCurve: 0.15,
          armL: -0.2, armR: -0.2,
        },
        eye: "closed",
      };

    case "HELD": {
      // Dangling from the rim: swings against the drag, arms flailing a little.
      // Rotation pivots at the base, so shift the body to keep the rim under the cursor.
      const swing = clamp(i.carryX / 1400, -1, 1);
      const rot = (swing * 0.5 + osc(t, 1.1, 0.05)) * m;
      return {
        pose: {
          bodyRot: rot,
          bodyX: -Math.sin(rot) * 0.9,
          lift: 0.04 * m,
          sy: 1 + 0.04 * m, sx: 1 - 0.03 * m,
          armL: (0.9 + osc(t, 0.32, 0.25)) * m,
          armR: (0.9 + osc(t, 0.32, 0.25, 1.3)) * m,
          eyeScale: 1.05, mouthOpen: 0.3,
          steamCurl: 0.3,
        },
        eye: "wide",
      };
    }

    case "LANDING":
      return {
        pose: {
          lift: kf(st, [[0, 0.04], [90, 0, Ease.inQuad]]) * m,
          sy: kf(st, [[0, 1.04], [90, 0.84, Ease.outQuad], [250, 1.06, Ease.outQuad], [450, 1, Ease.outElastic]]),
          sx: kf(st, [[0, 0.97], [90, 1.14, Ease.outQuad], [250, 0.96, Ease.outQuad], [450, 1, Ease.outElastic]]),
          armL: kf(st, [[0, 0.9], [200, 0, Ease.outCubic]]),
          armR: kf(st, [[0, 0.9], [200, 0, Ease.outCubic]]),
          steamPuff: kf(st, [[60, 0], [160, 0.6], [450, 0]]),
          mouthCurve: 0.8,
        },
        eye: st < 160 ? "closed" : "oval",
      };

    case "WAKING":
      return {
        pose: {
          blink: 0,
          eyeOpen: kf(st, [[0, 0.1], [120, 1], [220, 0.1], [320, 1]]),
          lift: kf(st, [[0, -0.04], [500, 0, Ease.outBack]]) * m,
          steamLen: kf(st, [[0, 0.35], [800, 1, Ease.outCubic]]),
          steamAlpha: kf(st, [[0, 0.25], [600, 1]]),
        },
        eye: "oval",
      };
  }
}

// ── Kinds of work ─────────────────────────────────────────────────────────────
// WORKING's variants. Each loops for as long as it lasts, from the same upright
// stance as plain working, so they crossfade into one another; props pop into
// its nubs over the first 300 ms. Under reduced motion the cup and its props
// hold still, and the eyes, mouth and steam carry the beats.

/** 0 → 1 (with a little overshoot) over the first 300 ms: a prop pops into hand. */
const propIn = (st: number) => kf(st, [[0, 0], [300, 1, Ease.outBack]]);

/** The gentle working bob, in units. */
const bob = (st: number, m: number) => 0.012 * Math.sin((TAU * st) / 1600) * m;

/** Where a nub's centre is, in body space (see drawArms). */
function nubAt(p: Pose, side: -1 | 1): { x: number; y: number } {
  const a = side < 0 ? p.armL : p.armR;
  return {
    x: side * 0.385 + (side < 0 ? p.armLdx : p.armRdx) + side * 0.058 * Math.cos(a),
    y: -0.47 + (side < 0 ? p.armLdy : p.armRdy) - 0.058 * Math.sin(a),
  };
}

/** Offsets that put a nub (at angle `a`) on a point of the body. */
function nubTo(side: -1 | 1, a: number, x: number, y: number) {
  return { dx: x - side * 0.385 - side * 0.058 * Math.cos(a), dy: y + 0.47 + 0.058 * Math.sin(a) };
}

/** Reading, 12.6 s: three lines, a page turn, two lines, "found it!", a line, a page turn. */
const READ = { cycle: 12600, line: 1800, aha: 9000, ahaMs: 1800 };

function researching(i: PoseInput): PoseOut {
  const { st, motion: m } = i;
  const u = st % READ.cycle;
  const a = u - READ.aha;
  const aha = kf(a, [[0, 0], [120, 1, Ease.outBack], [1300, 1], [1800, 0, Ease.inOutSine]]);
  // The reading clock stops while it looks up.
  const r = u < READ.aha ? u : u < READ.aha + READ.ahaMs ? READ.aha : u - READ.ahaMs;
  const k = (r % READ.line) / READ.line;
  // Eyes run along a line through the glass, then flick back for the next.
  const along = k < 0.8 ? lerp(-0.7, 0.7, k / 0.8) : lerp(0.7, -0.7, smoothstep(0.8, 1, k));
  const turning = (from: number, ms: number) => (r >= from && r < from + ms ? (r - from) / ms : 0);
  const pop = propIn(st);
  const book = nubTo(-1, -0.3, -0.3, -0.215);
  const lens = nubTo(1, 0.3, 0.315, -0.33);
  return {
    pose: {
      book: pop, lens: pop,
      pageTurn: (turning(5100, 800) + turning(10200, 600)) * m,
      lensLift: aha * m,
      lift: bob(st, m) + kf(a, [[0, 0], [150, 0.05, Ease.outCubic], [330, 0, Ease.inQuad]]) * m,
      gazeLock: 1,
      gazeLockX: lerp(along * 0.55, 0, aha),
      gazeLockY: lerp(0.8, -0.1, aha),
      // The right eye, big behind the magnifying glass.
      eyeScaleR: 1 + 0.38 * clamp(pop, 0, 1) * (1 - aha * m) + 0.08 * aha,
      eyeScale: 1 + 0.08 * aha,
      mouthCurve: lerp(0.25, 0.9, aha),
      mouthOpen: 0.32 * aha,
      armL: -0.3, armLfront: 1, armLdx: book.dx, armLdy: book.dy - 0.03 * aha * m,
      armR: 0.3, armRfront: 1, armRdx: lens.dx, armRdy: lens.dy - 0.1 * aha * m,
      steamWobble: 0.6, steamCurl: 0.6 + aha,
      steamPuff: kf(a, [[0, 0], [150, 1], [700, 0]]),
    },
    eye: aha > 0.5 ? "wide" : "oval",
  };
}

/** Running a command, 7 s: wind up, press the big button, then wait on its light. */
const RUN = { cycle: 7000, first: 600, press: 700 };
/** Where the button stands (units from the cup's base centre), and its size. */
const BUTTON = { x: 0.6, size: 1.35 };

function running(i: PoseInput): PoseOut {
  const { st, motion: m } = i;
  // Before the first press: ready, eyes on the button.
  const c = st < RUN.first ? -1 : (st - RUN.first) % RUN.cycle;
  // Reduced motion: a nub resting on the pressed button, its light on.
  const still = m < 0.5;
  const wind = still ? 0 : kf(c, [[0, 0], [450, 1, Ease.inOutSine], [600, 1], [700, 0]]);
  const press = still ? 1 : kf(c, [[600, 0], [RUN.press, 1, Ease.inQuad], [1250, 1], [1500, 0, Ease.outCubic]]);
  const down = still ? 1 : kf(c, [[660, 0], [RUN.press, 1], [1250, 1], [1350, 0]]);
  const waiting = still ? 1 : kf(c, [[1300, 0], [1700, 1], [6500, 1], [6900, 0]]);
  const lit = still ? 1 : c >= RUN.press && c < 6600 ? (c < 1700 || c % 800 < 500 ? 1 : 0.3) : 0;
  const thud = still ? 0 : kf(c, [[690, 0], [730, 1], [900, 0, Ease.outCubic]]);
  // Waiting: watching the light, with a hopeful look up at you now and then.
  const w = (c - 1700 + 3200) % 3200;
  const atYou = waiting > 0.5 && w > 2000 && w < 3000 ? 1 : 0;
  const onButton = nubTo(1, -1.0, BUTTON.x - 0.035, -0.335);
  const raise = lerp(lerp(0.35, 1.25, wind), -1.0, press);
  return {
    pose: {
      button: propIn(st), buttonDown: down, buttonLit: lit,
      bodyRot: (-4 * wind + 7 * press) * DEG * m,
      lift: bob(st, m) * (1 - waiting) + waiting * (0.008 + 0.008 * Math.sin((TAU * st) / 700)) * m,
      sy: 1 - 0.05 * thud, sx: 1 + 0.04 * thud,
      armR: raise,
      armRdx: lerp(0.07 * wind, onButton.dx, press),
      armRdy: lerp(-0.14 * wind, onButton.dy, press),
      armL: 0.3 + 0.05 * waiting,
      gazeLock: 1,
      gazeLockX: lerp(0.7, 0.1, atYou),
      gazeLockY: lerp(0.7, -0.05, atYou),
      eyeScale: lerp(0.96, 1.06, waiting),
      mouthCurve: lerp(0.05, 0.7, waiting),
      steamWobble: 0.7, steamCurl: 0.7,
      steamPuff: kf(c, [[RUN.press, 0], [800, 0.7], [1200, 0]]),
    },
    eye: !still && c >= RUN.press && c < 1050 ? "happy" : "oval",
  };
}

/** On the web, 10 s: scanning the distance through a spyglass, then "oh!". */
const LOOK = { cycle: 10000, oh: 6500 };

function lookingOut(i: PoseInput): PoseOut {
  const { st, motion: m } = i;
  const a = (st % LOOK.cycle) - LOOK.oh;
  const oh = kf(a, [[0, 0], [120, 1, Ease.outBack], [1500, 1], [1900, 0, Ease.inOutSine]]);
  const scan = Math.sin((TAU * st) / 5500) * m;
  const angle = -0.08 + 0.2 * scan;
  const drop = oh * m;
  // The left nub holds the tube up from underneath, a third of the way along.
  const phi = angle + 0.9 * drop;
  const hold = nubTo(-1, 0.85, -0.125 - 0.06 * drop - 0.3 * Math.cos(phi), -0.56 + 0.1 * drop + 0.3 * Math.sin(phi) + 0.1);
  return {
    pose: {
      spyglass: propIn(st), spyAngle: angle, spyDrop: drop,
      bodyRot: -3 * DEG * scan,
      lift: bob(st, m) + kf(a, [[0, 0], [150, 0.045, Ease.outCubic], [320, 0, Ease.inQuad]]) * m,
      armL: 0.85, armLfront: 1, armLdx: hold.dx, armLdy: hold.dy,
      armR: 0.2 + 0.4 * oh,
      eyeSquintR: 0.85 * (1 - oh),
      gazeLock: 1,
      gazeLockX: lerp(-0.5 + 0.15 * scan, -0.85, oh),
      gazeLockY: lerp(-0.25 + 0.2 * scan, -0.1, oh),
      eyeScale: 1 + 0.06 * oh,
      mouthCurve: lerp(0.35, 0.8, oh),
      mouthOpen: 0.36 * oh,
      steamLean: -0.3, steamWobble: 0.6, steamCurl: 0.5 + 0.8 * oh,
      steamPuff: kf(a, [[0, 0], [150, 1], [700, 0]]),
    },
    eye: oh > 0.5 ? "wide" : "oval",
  };
}

/** Waiting for your OK: NOTIFY's pop, then a sign held up and waggled, two hops, every 3.2 s. */
const CALL = { cycle: 3200, from: 400 };

function waitingForOk(i: PoseInput): PoseOut {
  const { st, motion: m } = i;
  const u = st >= CALL.from ? (st - CALL.from) % CALL.cycle : -1;
  const env = kf(u, [[0, 0], [100, 1], [1100, 1], [1400, 0]]);
  const wave = Math.sin((TAU * Math.max(0, u)) / 600) * env;
  const hop = kf(u, [[0, 0], [150, 0.045, Ease.outCubic], [300, 0, Ease.inQuad], [420, 0.022, Ease.outCubic], [540, 0, Ease.inQuad]]);
  const pulse = kf(u, [[0, 0], [120, 1], [450, 0]]);
  const sc = kf(st, [[0, 1], [400, 1.1, Ease.outBack], [700, 1.05, Ease.outCubic]]);
  return {
    pose: {
      sx: sc, sy: sc,
      lift: (kf(st, [[0, 0], [200, 0.06, Ease.outCubic], [400, 0, Ease.inQuad]]) + hop) * m,
      sign: propIn(st), signWave: 0.2 * wave * m,
      armL: 1.15 + 0.08 * pulse * m, armLfront: 1,
      armR: 0.95 + 0.35 * wave * m,
      gazeLock: 1, gazeLockX: 0, gazeLockY: 0.05,
      eyeScale: 1.04 + 0.05 * pulse,
      mouthCurve: 0.55, mouthOpen: 0.18 + 0.12 * pulse,
      steamCurl: 0, steamWobble: 0.25, steamLen: 1.05,
      steamPuff: pulse,
    },
    eye: "wide",
  };
}

/** Asking you something: a steady tilt, a nub on its cheek, the steam a "?", and a "hm?" every 4.5 s. */
const HMM = { cycle: 4500, at: 2600 };

function asking(i: PoseInput): PoseOut {
  const { st, motion: m } = i;
  const u = st % HMM.cycle;
  const hm = kf(u - HMM.at, [[0, 0], [250, 1, Ease.outCubic], [900, 1], [1400, 0, Ease.inOutSine]]);
  // Two taps of the nub on its cheek.
  const tap = u >= 600 && u < 1200 ? Math.max(0, Math.sin((TAU * (u - 600)) / 300)) : 0;
  const settle = kf(st, [[0, 0], [500, 1, Ease.outCubic]]);
  const cheek = nubTo(1, 0.4, 0.27, -0.45);
  return {
    pose: {
      bodyRot: (7 + 1.5 * Math.sin((TAU * st) / 5000) + 2 * hm) * DEG * settle * m,
      sx: 1 + 0.025 * hm * m, sy: 1 + 0.025 * hm * m,
      lift: bob(st, m) * 0.6,
      sQuestion: kf(st, [[0, 0], [400, 1, Ease.outCubic]]),
      steamShade: 1,
      steamLen: 1 + 0.08 * hm,
      steamPuff: 0.4 * kf(u - HMM.at, [[0, 0], [200, 1], [700, 0]]),
      gazeLock: 1, gazeLockX: 0.12, gazeLockY: -0.12,
      eyeScale: 1.03 + 0.05 * hm, eyeScaleL: 1.12, eyeScaleR: 0.92,
      mouthCurve: 0.2, mouthOpen: 0.14 * hm,
      armR: 0.4, armRfront: 1, armRdx: cheek.dx, armRdy: cheek.dy - 0.018 * tap * m,
      armL: 0.1,
    },
    eye: "oval",
  };
}

function events(i: PoseInput, prev: number, emit: Emit, p: Pose) {
  const crossed = (ms: number) => prev < ms && i.st >= ms;
  const top = 0.95 + 0.6 * p.steamLen + p.lift; // steam tip height, units
  /** A moment `at` ms into every `cycle` ms from `from`. */
  const each = (cycle: number, from: number, at: number) =>
    i.st >= from && crossed(from + Math.floor((i.st - from) / cycle) * cycle + at);

  switch (i.state) {
    case "WORKING":
      if (i.variant === "research" && each(READ.cycle, 0, READ.aha + 100)) {
        emit({ kind: "sparkle", x: 0.3, y: 0.72 + p.lift, vx: 0.15, vy: 0.2, size: 0.06, life: 0.8, spin: 1.5 });
      } else if (i.variant === "run" && each(RUN.cycle, RUN.first, RUN.press)) {
        emit({ kind: "puff", x: BUTTON.x, y: 0.33, vx: 0.12, vy: 0.22, size: 0.05, life: 0.5 });
      } else if (i.variant === "browse" && each(LOOK.cycle, 0, LOOK.oh + 80)) {
        emit({ kind: "sparkle", x: -0.72, y: 0.78 + p.lift, vx: -0.1, vy: 0.15, size: 0.065, life: 0.9, spin: -1.5 });
      } else if (i.variant === "wait" && each(CALL.cycle, CALL.from, 150)) {
        emit({ kind: "puff", x: 0, y: top + 0.04, vx: 0, vy: 0.3, size: 0.06, life: 0.7 });
      }
      break;
    case "BOOTING":
      if (crossed(650)) emit({ kind: "puff", x: 0, y: 1.02, vx: 0, vy: 0.25, size: 0.06, life: 0.6 });
      break;
    case "TOUCHED":
      if (i.variant === "dizzy" && crossed(40)) {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * TAU;
          emit({ kind: "star", x: Math.cos(a) * 0.35, y: 1.05 + Math.sin(a) * 0.08,
            vx: -Math.sin(a) * 0.3, vy: 0.05, size: 0.06, life: 1.1, spin: 3 });
        }
      } else if (i.variant === null && crossed(150)) {
        emit({ kind: "puff", x: 0, y: top, vx: 0, vy: 0.2, size: 0.05, life: 0.5 });
      }
      break;
    case "SUCCESS":
      if (crossed(200)) {
        for (let k = -1; k <= 1; k++) {
          emit({ kind: "sparkle", x: k * 0.16, y: top - Math.abs(k) * 0.1,
            vx: k * 0.18, vy: 0.22, size: 0.075 - Math.abs(k) * 0.015, life: 0.9, spin: k * 1.5 });
        }
      }
      break;
    case "NOTIFY":
      if (i.variant === null && i.st >= 400) {
        const n = Math.floor((i.st - 400) / 1200);
        if (crossed(400 + n * 1200 + 150)) {
          emit({ kind: "puff", x: 0, y: top + 0.04, vx: 0, vy: 0.3, size: 0.06, life: 0.7 });
        }
      }
      break;
    case "LANDING":
      if (crossed(60)) {
        for (const side of [-1, 1]) {
          emit({ kind: "puff", x: side * 0.32, y: 0.03, vx: side * 0.35, vy: 0.08, size: 0.05, life: 0.45 });
        }
      }
      break;
    case "SLEEPING":
      if (i.st >= 1500) {
        const n = Math.floor((i.st - 1500) / 4000);
        if (crossed(1500 + n * 4000)) {
          emit({ kind: "z", x: 0.22, y: 1.15, vx: 0.07, vy: 0.1, size: 0.08, life: 3.2 });
        }
      }
      break;
  }
}

// ── Drawing ───────────────────────────────────────────────────────────────────

const BODY = (() => {
  const p = new Path2D();
  p.moveTo(-0.445, -0.9);
  p.quadraticCurveTo(-0.415, -0.45, -0.315, -0.06);
  p.ellipse(0, -0.06, 0.315, 0.055, 0, Math.PI, 0, true);
  p.quadraticCurveTo(0.415, -0.45, 0.445, -0.9);
  p.closePath();
  return p;
})();

/** Glaze specks, fixed, kept clear of the face. */
const SPECKS = (() => {
  const out: { x: number; y: number; r: number }[] = [];
  for (let n = 0; out.length < 16 && n < 200; n++) {
    const y = -0.85 + hash01(n * 3 + 1) * 0.72;
    const halfW = 0.31 + ((-y - 0.06) / 0.84) * 0.12;
    const x = (hash01(n * 3 + 2) * 2 - 1) * halfW * 0.85;
    if (Math.abs(x) < 0.24 && y > -0.7 && y < -0.34) continue;
    out.push({ x, y, r: 0.006 + hash01(n * 3 + 3) * 0.007 });
  }
  return out;
})();

function draw(g: CanvasRenderingContext2D, p: Pose, eye: string, f: Frame) {
  const { U, ox, oy } = f;
  const baseX = ox + p.bodyX * U;

  // Contact shadow: stays on the ground, shrinks as Kulhi hops.
  {
    const k = clamp(1 - p.lift * 4, 0.4, 1.12);
    g.save();
    g.translate(baseX, oy);
    g.scale(U, U);
    const r = 0.38 * k * p.sx;
    const sh = g.createRadialGradient(0, 0, 0, 0, 0, r);
    sh.addColorStop(0, `rgba(70,35,20,${0.3 * k})`);
    sh.addColorStop(1, "rgba(70,35,20,0)");
    g.fillStyle = sh;
    g.beginPath();
    g.ellipse(0, 0, r, r * 0.17, 0, 0, TAU);
    g.fill();
    g.restore();
  }

  // The run button stands on the ground beside the cup.
  if (p.button > 0.01) drawButton(g, p, f);

  g.save();
  g.translate(baseX, oy - p.lift * U);
  g.rotate(p.bodyRot);
  g.scale(p.sx * U, p.sy * U);
  drawArms(g, p, false);
  drawBody(g, f.detail);
  drawRim(g, p);
  if (p.book > 0.01) drawBook(g, p);
  drawFace(g, p, eye, f.t);
  if (p.lens > 0.01) drawLens(g, p);
  if (p.sign > 0.01) drawSign(g, p);
  drawArms(g, p, true);
  // Held from underneath: in front of the nub.
  if (p.spyglass > 0.01) drawSpyglass(g, p);
  g.restore();

  // Steam rises straight up from the chai, whatever the cup's tilt.
  const chaiX = baseX + 0.95 * p.sy * U * Math.sin(p.bodyRot);
  const chaiY = oy - p.lift * U - 0.95 * p.sy * U * Math.cos(p.bodyRot);
  drawSteam(g, p, f, chaiX, chaiY);
}

function drawBody(g: CanvasRenderingContext2D, detail: number) {
  // Cylinder shading lit from the top-left.
  const lg = g.createLinearGradient(-0.45, 0, 0.45, 0);
  lg.addColorStop(0, "#A54B27");
  lg.addColorStop(0.22, "#D67748");
  lg.addColorStop(0.45, "#CB683C");
  lg.addColorStop(0.78, "#B2552F");
  lg.addColorStop(1, "#82391D");
  g.fillStyle = lg;
  g.fill(BODY);

  // Occlusion under the rim and toward the base.
  const vg = g.createLinearGradient(0, -0.92, 0, 0);
  vg.addColorStop(0, "rgba(60,20,8,0.4)");
  vg.addColorStop(0.13, "rgba(60,20,8,0)");
  vg.addColorStop(0.72, "rgba(60,20,8,0)");
  vg.addColorStop(1, "rgba(60,20,8,0.25)");
  g.fillStyle = vg;
  g.fill(BODY);

  // Soft key-light bloom and a cool bounce on the shadow side.
  const hl = g.createRadialGradient(-0.2, -0.62, 0, -0.2, -0.62, 0.34);
  hl.addColorStop(0, "rgba(255,212,178,0.38)");
  hl.addColorStop(1, "rgba(255,212,178,0)");
  g.fillStyle = hl;
  g.fill(BODY);
  const bounce = g.createRadialGradient(0.46, -0.35, 0, 0.46, -0.35, 0.22);
  bounce.addColorStop(0, "rgba(190,210,235,0.18)");
  bounce.addColorStop(1, "rgba(190,210,235,0)");
  g.fillStyle = bounce;
  g.fill(BODY);

  if (detail > 0.2) {
    g.fillStyle = `rgba(${COLOR.speck},${0.6 * detail})`;
    for (const s of SPECKS) {
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, TAU);
      g.fill();
    }
  }
}

function drawRim(g: CanvasRenderingContext2D, p: Pose) {
  // Underside of the rolled lip (gives it thickness).
  g.fillStyle = "#7A361B";
  g.beginPath();
  g.ellipse(0, RIM_Y + 0.035, 0.478, 0.116, 0, 0, TAU);
  g.fill();

  // Top of the lip.
  const rg = g.createLinearGradient(-0.4, RIM_Y - 0.12, 0.3, RIM_Y + 0.12);
  rg.addColorStop(0, "#BC6038");
  rg.addColorStop(1, "#93421F");
  g.fillStyle = rg;
  g.beginPath();
  g.ellipse(0, RIM_Y, 0.475, 0.115, 0, 0, TAU);
  g.fill();

  // Lit front edge and back-left catchlight of the roll.
  g.lineCap = "round";
  g.strokeStyle = "rgba(236,152,106,0.55)";
  g.lineWidth = 0.018;
  g.beginPath();
  g.ellipse(0, RIM_Y + 0.004, 0.455, 0.1, 0, 0.15, Math.PI - 0.15);
  g.stroke();
  g.strokeStyle = "rgba(244,180,138,0.45)";
  g.lineWidth = 0.014;
  g.beginPath();
  g.ellipse(0, RIM_Y, 0.44, 0.095, 0, Math.PI + 0.25, Math.PI * 1.5 + 0.1);
  g.stroke();

  // Opening: dark inner wall, then the chai sitting a little lower.
  g.fillStyle = "#5E2812";
  g.beginPath();
  g.ellipse(0, RIM_Y - 0.005, 0.395, 0.083, 0, 0, TAU);
  g.fill();

  const slosh = p.chaiTilt * 0.012;
  const cg = g.createRadialGradient(-0.1, RIM_Y - 0.01, 0, -0.05, RIM_Y, 0.4);
  cg.addColorStop(0, "#EBBE88");
  cg.addColorStop(0.5, "#D9A066");
  cg.addColorStop(1, "#B47A45");
  g.fillStyle = cg;
  g.beginPath();
  g.ellipse(slosh, RIM_Y + 0.012, 0.37, 0.068, slosh * 0.5, 0, TAU);
  g.fill();

  g.fillStyle = "rgba(255,246,228,0.45)";
  g.beginPath();
  g.ellipse(-0.13 + slosh, RIM_Y + 0.002, 0.09, 0.017, -0.08, 0, TAU);
  g.fill();
}

/** The nubs behind the cup (`front` false), or those held in front of it. */
function drawArms(g: CanvasRenderingContext2D, p: Pose, front: boolean) {
  for (const side of [-1, 1] as const) {
    if ((side < 0 ? p.armLfront : p.armRfront) > 0.5 !== front) continue;
    const a = side < 0 ? p.armL : p.armR;
    g.save();
    g.translate(side * 0.385 + (side < 0 ? p.armLdx : p.armRdx), -0.47 + (side < 0 ? p.armLdy : p.armRdy));
    g.rotate(-side * a);
    const ag = g.createRadialGradient(side * 0.03, -0.035, 0, side * 0.05, 0, 0.09);
    ag.addColorStop(0, "#DB7E50");
    ag.addColorStop(1, "#9C4824");
    g.fillStyle = ag;
    g.beginPath();
    g.ellipse(side * 0.058, 0, 0.068, 0.078, 0, 0, TAU);
    g.fill();
    if (front) {
      // A soft rim so it reads against the cup behind it.
      g.strokeStyle = "rgba(96,38,16,0.55)";
      g.lineWidth = 0.012;
      g.stroke();
    }
    g.restore();
  }
}

function drawFace(g: CanvasRenderingContext2D, p: Pose, eye: string, t: number) {
  // The whole face slides a touch with the gaze, so Kulhi seems to turn.
  const fx = p.gazeX * 0.04;
  const fy = p.gazeY * 0.025;
  const ex = p.gazeX * 0.012;
  const ey = p.gazeY * 0.01;
  drawEye(g, fx - 0.125 + ex, -0.56 + fy + ey, -1, eye, p, t);
  drawEye(g, fx + 0.125 + ex, -0.56 + fy + ey, 1, eye, p, t);
  drawMouth(g, fx, -0.415 + fy, p);
}

function drawEye(g: CanvasRenderingContext2D, cx: number, cy: number, side: -1 | 1, shape: string, p: Pose, t: number) {
  const s = p.eyeScale * (side < 0 ? p.eyeScaleL : p.eyeScaleR);
  const rx = 0.05 * s;
  const ry = 0.078 * s;

  g.save();
  g.translate(cx, cy);
  g.scale(1, p.eyeMorph);
  g.fillStyle = COLOR.eye;
  g.strokeStyle = COLOR.eye;
  g.lineCap = "round";
  g.lineWidth = 0.026;

  switch (shape) {
    case "oval":
    case "wide":
    case "half": {
      const w = shape === "wide" ? 1.2 : 1;
      const h = shape === "wide" ? 1.03 : shape === "half" ? 0.85 : 1;
      const squint = side < 0 ? p.eyeSquintL : p.eyeSquintR;
      const open = clamp(p.eyeOpen * (1 - 0.92 * squint), 0.06, 1);
      const erx = rx * w, ery = ry * h * open;

      // Worried tilt and sleepy lids are a clip across the top of the eye.
      const tilt = p.eyeTilt;
      if (tilt > 0.01 || shape === "half") {
        const lidAt = (x: number) =>
          shape === "half"
            ? -ery * 0.05
            : -ery + tilt * ery * 0.9 * (1 + (x * side) / erx) * 0.5;
        g.beginPath();
        g.moveTo(-2 * erx, lidAt(-2 * erx));
        g.lineTo(2 * erx, lidAt(2 * erx));
        g.lineTo(2 * erx, 2 * ery);
        g.lineTo(-2 * erx, 2 * ery);
        g.closePath();
        g.clip();
      }

      g.beginPath();
      g.ellipse(0, 0, erx, ery, 0, 0, TAU);
      g.fill();

      if (open > 0.45) {
        g.fillStyle = "#FFFFFF";
        g.beginPath();
        g.arc(-0.3 * erx, -0.4 * ery, 0.34 * rx, 0, TAU);
        g.fill();
        g.beginPath();
        g.arc(0.32 * erx, 0.34 * ery, 0.15 * rx, 0, TAU);
        g.fill();
      }
      break;
    }
    case "happy":
      g.beginPath();
      g.arc(0, 0.03, rx * 1.1, Math.PI + 0.25, TAU - 0.25);
      g.stroke();
      break;
    case "closed":
      g.beginPath();
      g.arc(0, -0.035, rx * 1.1, 0.3, Math.PI - 0.3);
      g.stroke();
      break;
    case "spiral": {
      g.lineWidth = 0.016;
      g.rotate(t * 7 * side);
      g.beginPath();
      for (let a = 0; a <= 4 * Math.PI; a += 0.25) {
        const r = (rx * 1.15 * a) / (4 * Math.PI);
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.stroke();
      break;
    }
  }
  g.restore();
}

function drawMouth(g: CanvasRenderingContext2D, cx: number, cy: number, p: Pose) {
  g.save();
  g.translate(cx, cy);
  if (p.mouthOpen > 0.04) {
    g.fillStyle = COLOR.mouthInside;
    g.beginPath();
    g.ellipse(0, 0.005, 0.026 + 0.01 * p.mouthOpen, 0.006 + 0.04 * p.mouthOpen, 0, 0, TAU);
    g.fill();
  } else {
    g.strokeStyle = COLOR.eye;
    g.lineWidth = 0.017;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-0.042, 0);
    g.quadraticCurveTo(0, 0.05 * p.mouthCurve, 0.042, 0);
    g.stroke();
  }
  g.restore();
}

// ── Props (kinds of work) ─────────────────────────────────────────────────────

const PROP = {
  ink: "#3A2418", // outlines and print, a touch warmer than the eyes
  paper: "#FBF4E6",
  paperShade: "#E6D8BE",
  cover: "#2F5D62",
  coverDark: "#1F4246",
  wood: "#8A5A33",
  woodLight: "#B07A48",
  brass: "#D9B45A",
  brassMid: "#B08A35",
  brassDark: "#6E4F1A",
  glass: "rgba(214,236,246,0.32)",
};

/** Where the eyes sit, with the face's slide toward the gaze (see drawFace). */
function eyeAt(p: Pose, side: -1 | 1) {
  return { x: p.gazeX * 0.052 + side * 0.125, y: -0.56 + p.gazeY * 0.035 };
}

/** Reading: an open book in its lap, held by the left nub. */
function drawBook(g: CanvasRenderingContext2D, p: Pose) {
  g.save();
  g.translate(0, -0.205);
  g.scale(p.book, p.book);
  g.lineJoin = "round";
  g.lineCap = "round";

  // Cover, peeking out round the pages.
  g.fillStyle = PROP.cover;
  g.beginPath();
  g.moveTo(0, -0.08);
  g.lineTo(-0.33, -0.1);
  g.lineTo(-0.315, 0.115);
  g.quadraticCurveTo(-0.15, 0.09, 0, 0.13);
  g.quadraticCurveTo(0.15, 0.09, 0.315, 0.115);
  g.lineTo(0.33, -0.1);
  g.closePath();
  g.fill();
  g.strokeStyle = PROP.coverDark;
  g.lineWidth = 0.012;
  g.stroke();

  // The two pages, bowed up from the spine.
  const page = (s: -1 | 1, x: number, rise: number) => {
    g.beginPath();
    g.moveTo(0, -0.095);
    g.quadraticCurveTo(s * 0.15 * Math.abs(x / 0.3), -0.15 - rise, x, -0.11 - rise);
    g.lineTo(x * 0.97, 0.09 - rise);
    g.quadraticCurveTo(s * 0.15 * Math.abs(x / 0.3), 0.065 - rise, 0, 0.105);
    g.closePath();
  };
  for (const s of [-1, 1] as const) {
    const pg = g.createLinearGradient(0, 0, s * 0.3, 0);
    pg.addColorStop(0, PROP.paperShade);
    pg.addColorStop(0.25, PROP.paper);
    pg.addColorStop(1, PROP.paper);
    g.fillStyle = pg;
    page(s, s * 0.3, 0);
    g.fill();
    // Lines of print, following the bow of the page.
    g.strokeStyle = "rgba(58,36,24,0.5)";
    g.lineWidth = 0.013;
    for (let n = 0; n < 4; n++) {
      const y = -0.065 + n * 0.042;
      const len = 0.17 + 0.06 * hash01(n * 2 + (s > 0 ? 9 : 0));
      g.beginPath();
      g.moveTo(s * 0.045, y - 0.012);
      g.quadraticCurveTo(s * (0.045 + len / 2), y - 0.03, s * (0.045 + len), y - 0.012);
      g.stroke();
    }
  }
  // A page turning over, right to left.
  const k = p.pageTurn;
  if (k > 0.02 && k < 0.98) {
    const x = 0.3 * Math.cos(Math.PI * k);
    const rise = 0.07 * Math.sin(Math.PI * k);
    g.fillStyle = k < 0.5 ? PROP.paper : PROP.paperShade;
    page(x < 0 ? -1 : 1, x, rise);
    g.fill();
    g.strokeStyle = "rgba(58,36,24,0.25)";
    g.lineWidth = 0.008;
    g.stroke();
  }
  g.strokeStyle = "rgba(58,36,24,0.3)";
  g.lineWidth = 0.01;
  g.beginPath();
  g.moveTo(0, -0.095);
  g.lineTo(0, 0.105);
  g.stroke();
  g.restore();
}

/** A magnifying glass over the right eye, its handle in the right nub. */
function drawLens(g: CanvasRenderingContext2D, p: Pose) {
  const e = eyeAt(p, 1);
  const cx = e.x + 0.1 * p.lensLift;
  const cy = e.y - 0.15 * p.lensLift;
  const r = 0.105 * p.lens;
  const hand = nubAt(p, 1);
  const a = Math.atan2(hand.y - cy, hand.x - cx);
  g.save();
  g.lineCap = "round";
  // Handle, rim to nub.
  g.strokeStyle = PROP.wood;
  g.lineWidth = 0.042 * p.lens;
  g.beginPath();
  g.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  g.lineTo(hand.x, hand.y);
  g.stroke();
  g.strokeStyle = PROP.woodLight;
  g.lineWidth = 0.012 * p.lens;
  g.stroke();
  // Glass, a glint, and the rim.
  g.fillStyle = PROP.glass;
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.6)";
  g.lineWidth = 0.012;
  g.beginPath();
  g.arc(cx, cy, r * 0.72, Math.PI * 1.1, Math.PI * 1.45);
  g.stroke();
  g.strokeStyle = PROP.ink;
  g.lineWidth = 0.026;
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.stroke();
  g.strokeStyle = "rgba(201,164,106,0.8)";
  g.lineWidth = 0.008;
  g.beginPath();
  g.arc(cx, cy, r - 0.004, Math.PI * 0.95, Math.PI * 1.6);
  g.stroke();
  g.restore();
}

/** On the web: a brass spyglass at the left eye, pointing off to the left. */
function drawSpyglass(g: CanvasRenderingContext2D, p: Pose) {
  const e = eyeAt(p, -1);
  const drop = p.spyDrop;
  g.save();
  g.translate(e.x - 0.06 * drop, e.y + 0.1 * drop);
  g.rotate(-(p.spyAngle + 0.9 * drop));
  g.scale(p.spyglass, p.spyglass);
  // Sections along −x: eyepiece, two draws, the objective. [from, to, half-height]
  const parts: [number, number, number][] = [[0.03, -0.08, 0.036], [-0.08, -0.24, 0.046], [-0.24, -0.4, 0.056], [-0.4, -0.56, 0.068]];
  for (const [x0, x1, h] of parts) {
    const tg = g.createLinearGradient(0, -h, 0, h);
    tg.addColorStop(0, "#F2D88A");
    tg.addColorStop(0.35, PROP.brass);
    tg.addColorStop(1, PROP.brassDark);
    g.fillStyle = tg;
    g.beginPath();
    g.roundRect(x1, -h, x0 - x1, 2 * h, 0.012);
    g.fill();
    g.strokeStyle = PROP.brassDark;
    g.lineWidth = 0.01;
    g.stroke();
  }
  // Collars where the draws meet.
  g.fillStyle = PROP.brassMid;
  for (const [x, h] of [[-0.08, 0.05], [-0.24, 0.06], [-0.4, 0.072]] as const) {
    g.beginPath();
    g.roundRect(x - 0.016, -h, 0.032, 2 * h, 0.008);
    g.fill();
  }
  // The objective lens at the far end.
  g.fillStyle = "#24343C";
  g.beginPath();
  g.ellipse(-0.56, 0, 0.022, 0.06, 0, 0, TAU);
  g.fill();
  g.fillStyle = "rgba(190,225,240,0.55)";
  g.beginPath();
  g.ellipse(-0.565, -0.022, 0.008, 0.018, 0, 0, TAU);
  g.fill();
  g.restore();
}

/** Waiting for your OK: a little "!" sign on a stick, held up in the left nub. */
function drawSign(g: CanvasRenderingContext2D, p: Pose) {
  const h = nubAt(p, -1);
  g.save();
  g.translate(h.x, h.y);
  g.rotate(-0.22 + p.signWave);
  g.scale(p.sign, p.sign);
  g.lineCap = "round";
  g.strokeStyle = PROP.wood;
  g.lineWidth = 0.032;
  g.beginPath();
  g.moveTo(0, 0.02);
  g.lineTo(0, -0.44);
  g.stroke();
  g.fillStyle = PROP.paper;
  g.strokeStyle = "#A54B27";
  g.lineWidth = 0.022;
  g.beginPath();
  g.roundRect(-0.185, -0.72, 0.37, 0.29, 0.045);
  g.fill();
  g.stroke();
  g.strokeStyle = PROP.ink;
  g.fillStyle = PROP.ink;
  g.lineWidth = 0.056;
  g.beginPath();
  g.moveTo(0, -0.665);
  g.lineTo(0, -0.565);
  g.stroke();
  g.beginPath();
  g.arc(0, -0.49, 0.03, 0, TAU);
  g.fill();
  g.restore();
}

/** Running a command: a big red button on a little stand, with a ">_" screen that lights up. */
function drawButton(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  const { U, ox, oy } = f;
  const k = p.button;
  const W = 0.2, H = 0.17;
  g.save();
  g.translate(ox + BUTTON.x * U, oy);
  g.scale(U * k * BUTTON.size, U * k * BUTTON.size);
  // Contact shadow.
  const sh = g.createRadialGradient(0, 0, 0, 0, 0, 0.16);
  sh.addColorStop(0, "rgba(70,35,20,0.28)");
  sh.addColorStop(1, "rgba(70,35,20,0)");
  g.fillStyle = sh;
  g.beginPath();
  g.ellipse(0, 0, 0.16, 0.028, 0, 0, TAU);
  g.fill();
  // The stand.
  const bg = g.createLinearGradient(-W / 2, 0, W / 2, 0);
  bg.addColorStop(0, "#666C77");
  bg.addColorStop(1, "#3C414A");
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(-W / 2, -H, W, H, 0.026);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.14)";
  g.fillRect(-W / 2 + 0.02, -H + 0.004, W - 0.04, 0.012);
  // Its little screen: dark, then a green prompt once the command runs.
  g.fillStyle = "#1C2026";
  g.beginPath();
  g.roundRect(-0.07, -0.128, 0.14, 0.076, 0.014);
  g.fill();
  if (p.buttonLit > 0.02) {
    const on = `rgba(139,224,122,${clamp(p.buttonLit, 0, 1)})`;
    g.save();
    g.shadowColor = on;
    g.shadowBlur = U * 0.03 * p.buttonLit;
    g.strokeStyle = on;
    g.lineWidth = 0.013;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(-0.045, -0.108);
    g.lineTo(-0.024, -0.09);
    g.lineTo(-0.045, -0.072);
    g.stroke();
    if (f.t % 0.8 < 0.5) {
      g.beginPath();
      g.moveTo(-0.008, -0.07);
      g.lineTo(0.03, -0.07);
      g.stroke();
    }
    g.restore();
  }
  // Collar and the red dome, squashed down when pressed.
  g.fillStyle = "#2E3238";
  g.beginPath();
  g.ellipse(0, -H, 0.088, 0.022, 0, 0, TAU);
  g.fill();
  const dh = 0.062 - 0.032 * clamp(p.buttonDown, 0, 1);
  const dg = g.createRadialGradient(-0.025, -H - dh * 0.8, 0, 0, -H - dh * 0.4, 0.09);
  dg.addColorStop(0, "#FF8A78");
  dg.addColorStop(0.5, "#DE4A3A");
  dg.addColorStop(1, "#A3302A");
  g.fillStyle = dg;
  g.beginPath();
  g.ellipse(0, -H - 0.004, 0.072, dh, 0, Math.PI, TAU);
  g.closePath();
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.beginPath();
  g.ellipse(-0.026, -H - dh * 0.62, 0.016, 0.009, -0.4, 0, TAU);
  g.fill();
  g.restore();
}

// ── Steam ─────────────────────────────────────────────────────────────────────

const N = 28;
type Pt = { x: number; y: number };

/** The free wisp: walk upward, steering by a heading that wobbles and curls at the tip. */
function wispPoints(p: Pose, t: number, L: number): Pt[] {
  const dir = Math.sin((TAU * t) / 9); // curl direction drifts left ↔ right
  const pts: Pt[] = [];
  let x = 0, y = 0;
  const ds = L / N;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    pts.push({ x, y });
    const heading =
      p.steamWobble * (0.32 * Math.sin(TAU * 0.9 * s - (TAU * t) / 2.8) * (0.3 + s) + 0.12 * Math.sin((TAU * t) / 4.1 + 2 * s)) +
      p.steamCurl * dir * Math.pow(smoothstep(0.5, 1, s), 1.5) * 3.4 +
      p.steamLean * s * 1.1 +
      p.steamDroop * s * s * 2.4;
    x += Math.sin(heading) * ds;
    y -= Math.cos(heading) * ds;
  }
  return pts;
}

/** Working: a helix around the steam's axis, one revolution per 1.4 s. */
function spiralPoints(t: number, L: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const r = 0.02 + 0.075 * s;
    pts.push({ x: r * Math.sin(TAU * 2.2 * s - (TAU * t) / 1.4), y: -s * L });
  }
  return pts;
}

/** Confused: stem up, then over the top into a question-mark hook. */
function questionPoints(t: number, L: number): Pt[] {
  const k = L / 0.6;
  const pts: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    let x: number, y: number;
    if (s < 0.35) {
      x = 0;
      y = -(s / 0.35) * 0.34;
    } else {
      const a = Math.PI / 2 - ((s - 0.35) / 0.65) * 1.5 * Math.PI;
      x = 0.11 * Math.cos(a);
      y = -0.45 + 0.11 * Math.sin(a);
    }
    pts.push({ x: x * k + 0.01 * Math.sin(t * 2), y: y * k });
  }
  return pts;
}

/** Happy flourish: stem up into a heart outline. */
function heartPoints(L: number): Pt[] {
  const k = L / 0.6;
  const h = 0.0085;
  const pts: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    if (s < 0.3) {
      pts.push({ x: 0, y: -(s / 0.3) * 0.3 * k });
    } else {
      const tau = Math.PI + ((s - 0.3) / 0.7) * TAU;
      const hx = 16 * Math.sin(tau) ** 3;
      const hy = 13 * Math.cos(tau) - 5 * Math.cos(2 * tau) - 2 * Math.cos(3 * tau) - Math.cos(4 * tau);
      pts.push({ x: hx * h * k, y: (-hy * h - 0.3 - 17 * h) * k });
    }
  }
  return pts;
}

function drawSteam(g: CanvasRenderingContext2D, p: Pose, f: Frame, bx: number, by: number) {
  const L = 0.6 * p.steamLen;
  const alpha = clamp(p.steamAlpha, 0, 1);
  if (L < 0.01 || alpha < 0.01) return;
  const { U, t } = f;

  const wS = p.sSpiral, wQ = p.sQuestion, wH = p.sHeart;
  const wW = Math.max(0, 1 - wS - wQ - wH);
  const total = wW + wS + wQ + wH;
  const shapes: [number, Pt[]][] = [[wW, wispPoints(p, t, L)]];
  if (wS > 0.001) shapes.push([wS, spiralPoints(t, L)]);
  if (wQ > 0.001) shapes.push([wQ, questionPoints(t, L)]);
  if (wH > 0.001) shapes.push([wH, heartPoints(L)]);

  const pts: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    let x = 0, y = 0;
    for (const [w, list] of shapes) {
      x += list[i].x * w;
      y += list[i].y * w;
    }
    x /= total;
    y /= total;
    // Springy lag: the tip trails the cup's motion.
    x += p.lagX * s * s * 0.8;
    y -= p.lagY * s * s * 0.8;
    x += p.steamJitter * 0.022 * Math.sin(s * 30 + t * 25);
    pts.push({ x: bx + x * U, y: by + y * U });
  }

  // Ribbon outline: offset each point along its normal by the local half-width.
  const width = (s: number) => U * (0.02 + 0.05 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.1)), 0.8)) * (0.75 + 0.25 * p.steamLen);
  const ribbon = (scale: number) => {
    const left: Pt[] = [], right: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y;
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      const hw = (width(i / N) * scale) / 2;
      left.push({ x: pts[i].x - ty * hw, y: pts[i].y + tx * hw });
      right.push({ x: pts[i].x + ty * hw, y: pts[i].y - tx * hw });
    }
    const path = new Path2D();
    path.moveTo(left[0].x, left[0].y);
    for (let i = 1; i <= N; i++) path.lineTo(left[i].x, left[i].y);
    for (let i = N; i >= 0; i--) path.lineTo(right[i].x, right[i].y);
    path.closePath();
    return path;
  };

  // Fade in from the chai and toward the far end of whatever shape the steam makes.
  let far = pts[N];
  let farD = 0;
  for (const q of pts) {
    const d = Math.hypot(q.x - bx, q.y - by);
    if (d > farD) { farD = d; far = q; }
  }
  const grad = (rgb: string, a: number) => {
    const gr = g.createLinearGradient(bx, by, far.x, far.y);
    gr.addColorStop(0, `rgba(${rgb},0)`);
    gr.addColorStop(0.2, `rgba(${rgb},${a})`);
    gr.addColorStop(1, `rgba(${rgb},${a * 0.7})`);
    return gr;
  };

  g.save();
  // A faint warm shadow keeps cream steam readable on light backgrounds.
  g.filter = `blur(${Math.max(0.5, U * 0.02)}px)`;
  g.fillStyle = grad("120,92,76", (0.16 + 0.2 * clamp(p.steamShade, 0, 1)) * alpha);
  g.fill(ribbon(1.5));
  g.filter = `blur(${Math.max(0.3, U * 0.006)}px)`;
  g.fillStyle = grad(COLOR.steam, 0.85 * alpha);
  g.fill(ribbon(1));
  g.restore();

  if (p.steamPuff > 0.02) {
    const tip = pts[N];
    const r = U * 0.075 * p.steamPuff;
    const pg = g.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, r);
    pg.addColorStop(0, `rgba(${COLOR.steam},${0.85 * alpha * p.steamPuff})`);
    pg.addColorStop(1, `rgba(${COLOR.steam},0)`);
    g.fillStyle = pg;
    g.beginPath();
    g.arc(tip.x, tip.y, r, 0, TAU);
    g.fill();
  }
}

export const kulhi: Skin = {
  id: "kulhi",
  fit: { units: 2.0, base: 0.88 },
  // Rim (y ≈ −1.05) to base, arms included, at 2 units per view side.
  hit: { x0: 0.24, y0: 0.35, x1: 0.76, y1: 0.92 },
  rest,
  restEye: "oval",
  pose,
  events,
  draw,
};
