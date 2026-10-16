// Hexo, the device-repair buddy: a rounded hex-nut whose centre hole is a dark
// glass screen. Its "eyes" are a glyph system (pills, loading dots, a check, a
// question mark), and the glowing core ring around the screen doubles as a
// progress indicator (spec 1.2 and Section 4).
//
// Drawing space: units, origin at the centre of the base, y down. The hex
// face is centred at (0, −0.5); the antenna tip reaches y ≈ −1.

import { Ease, clamp, lerp, smoothstep } from "../engine/ease";
import { hash01, kf } from "../engine/track";
import type { Emit, Frame, Pose, PoseInput, PoseOut, Skin } from "../engine/types";
import {
  DEG, ENGINE_REST, TAU, confusedTilt, crossedAt, dizzyWobble, errorSlump, heldSwing, landingSquash,
  notifyPop, roundedPolygon, sleepyFace, successHop, touchSquash, wakeBlink, workNod,
} from "./common";

const C = {
  body: "#3A7CA5",
  bodyLight: "#4E93BF",
  bodyDark: "#2A5C7C",
  edge: "169,214,238", // #A9D6EE
  screen: "#1B2430",
  eye: "127,231,255", // #7FE7FF
  ring: [255, 209, 102] as const, // #FFD166
  warn: [255, 176, 112] as const, // #FFB070
  tip: "#FF8C6B",
};

const CY = -0.5; // hex face centre
/** The run lever: its box stands on the ground to the right; angles from pointing left, + up. */
const LEVER = { up: 0.9, down: -0.6, pivotX: 0.58, pivotY: -0.3, len: 0.26, boxX: 0.7, boxW: 0.24, boxH: 0.36 };
const HEX_R = 0.42; // circumradius, flat top and bottom
const HEX_TOP = CY - HEX_R * Math.sin(Math.PI / 3); // ≈ −0.864
const SCREEN_R = 0.235;
const RING_R = 0.285;

// ── Pose ──────────────────────────────────────────────────────────────────────

const rest: Pose = {
  ...ENGINE_REST,
  eyeScale: 1, eyeScaleL: 1, eyeScaleR: 1, eyeTilt: 0,
  glow: 1, // glyph brightness
  screenOn: 1,
  ringI: 0.75, // ring intensity
  ringProg: -1, // −1 full ring, else 0…1 progress arc
  ringSeg: 6, // segments lit (boot)
  ringWarn: 0, // 0 yellow → 1 soft orange
  scan: -1, // scanline position 0…1, −1 none
  noise: 0, // screen static
  smile: 0,
  mouthO: 0,
  antenna: 0, // radians, + leans right
  antennaDroop: 0,
  tipGlow: 0.35,
  armL: 0, armR: 0,
  footL: 0, footR: 0,
  // kinds of work (WORKING's variants): the glyph's own glance, nubs on
  // telescopic arms (moved, or held in front), the ring as a spinner, and the
  // props, each 0 (put away) … 1 (in hand)
  lookX: 0, lookY: 0,
  armLdx: 0, armLdy: 0, armRdx: 0, armRdy: 0, armLfront: 0, armRfront: 0,
  ringArc: 0, ringRot: 0,
  page: 0, pageScroll: 0, scanK: 0, beam: 0, found: 0,
  lever: 0, leverAngle: LEVER.up, leverGrip: 0, leverLamp: 0,
  bino: 0, binoX: 0, binoDrop: 0,
  holo: 0, holoBob: 0,
};

/** Two flashes, 420 ms each, at the start of a 1.2 s cycle (always < 3 per second). */
const doubleFlash = (st: number) => {
  const k = st >= 400 ? (st - 400) % 1200 : Infinity;
  return k < 840 ? Math.abs(Math.sin((Math.PI * k) / 420)) : 0;
};

function pose(i: PoseInput): PoseOut {
  const { st, t, motion: m } = i;

  switch (i.state) {
    case "OFF":
      return { pose: { fade: 0 }, eye: "pills" };

    case "BOOTING": {
      // Body appears, scanline sweeps a black screen, ring lights segment by
      // segment, eyes fade in, antenna springs up and blinks.
      const sc = kf(st, [[0, 0.8], [300, 1, Ease.outBack]]);
      return {
        pose: {
          fade: kf(st, [[0, 0], [300, 1, Ease.outCubic]]),
          sx: sc, sy: sc,
          screenOn: kf(st, [[1100, 0], [1300, 1]]),
          scan: st >= 300 && st < 700 ? (st - 300) / 400 : -1,
          ringSeg: st < 700 ? 0 : clamp(Math.floor((st - 700) / 60) + 1, 0, 6),
          ringI: st < 700 ? 0 : 0.85,
          antennaDroop: kf(st, [[0, 1], [1300, 1], [1600, 0, Ease.outBack]]),
          tipGlow: kf(st, [[1300, 0.35], [1420, 1], [1600, 0.35]]),
          blink: 0,
        },
        eye: "pills",
      };
    }

    case "IDLE": {
      // Every 20 s a flourish: a glance to one side, or a little stretch.
      const cycle = Math.floor(t / 20);
      const into = t - cycle * 20;
      const fl = into < 2.2 ? Math.sin((Math.PI * into) / 2.2) : 0;
      const glance = hash01(cycle) < 0.5;
      return {
        pose: {
          ringI: 0.6 + 0.25 * (0.5 + 0.5 * Math.sin((TAU * t) / 2.5)),
          antenna: 4 * DEG * Math.sin((TAU * t) / 3.4) * m,
          gazeLock: glance ? fl : 0,
          gazeLockX: hash01(cycle + 3) < 0.5 ? -0.9 : 0.9,
          bodyRot: glance ? 0 : 0.07 * fl * m,
          armL: glance ? 0 : 0.5 * fl * m,
          armR: glance ? 0 : 0.5 * fl * m,
        },
        eye: "pills",
      };
    }

    case "ATTENTIVE":
      return { pose: { eyeScale: 1.08, ringI: 0.9, armL: 0.12, armR: 0.12 }, eye: "pills" };

    case "TOUCHED": {
      if (i.variant === "dizzy") {
        return {
          pose: {
            bodyRot: dizzyWobble(st, m),
            ringI: 0.5 + 0.4 * Math.sin(st / 40),
            mouthO: st >= 1200 ? 0.4 : 0,
            antennaDroop: 0.4,
            blink: 0,
          },
          eye: st < 1200 ? "spiral" : "lines",
        };
      }
      return {
        pose: {
          ...touchSquash(st),
          smile: kf(st, [[0, 0], [120, 1], [500, 1], [600, 0]]),
          ringI: kf(st, [[0, 0.75], [100, 1], [600, 0.75]]),
          armL: kf(st, [[0, 0], [200, 0.6, Ease.outBack], [600, 0]]),
          armR: kf(st, [[0, 0], [200, 0.6, Ease.outBack], [600, 0]]),
        },
        eye: st >= 120 && st < 500 ? "happy" : "pills",
      };
    }

    case "WORKING": {
      switch (i.variant) {
        case "research": return scanning(i);
        case "run": return pullingLever(i);
        case "browse": return lookingOut(i);
        case "wait": return callingYou(i);
        case "ask": return wondering(i);
      }
      // Rocks ±15° like a nut being tightened; loading dots; the ring fills.
      const rot = 15 * DEG * Math.sin((TAU * st) / 900);
      const nod = workNod(st);
      return {
        pose: {
          bodyRot: rot * m,
          sy: 1 - nod * 0.04 * m,
          ringProg: i.progress ?? (st / 1500) % 1,
          ringI: 0.95,
          antenna: -rot * 0.6 * m,
          armL: (0.35 + 0.15 * Math.sin((TAU * st) / 900)) * m,
          armR: (0.35 - 0.15 * Math.sin((TAU * st) / 900)) * m,
        },
        eye: "dots",
      };
    }

    case "SUCCESS": {
      const end = i.variant === "short" ? 1200 : 2500;
      return {
        pose: {
          ...successHop(st, m),
          ringProg: -1,
          ringI: 1,
          armL: kf(st, [[0, 0], [200, 0.9, Ease.outBack], [end - 600, 0.9], [end - 150, 0]]),
          armR: kf(st, [[0, 0], [200, 0.9, Ease.outBack], [end - 600, 0.9], [end - 150, 0]]),
        },
        eye: "check",
      };
    }

    case "SUGGESTING":
      // Antenna points at the suggestions (assumed to the right); pills lean that way.
      return {
        pose: {
          bodyRot: kf(st, [[0, 0], [300, 8 * DEG, Ease.outBack]]),
          antenna: 0.45,
          eyeScaleL: 0.92, eyeScaleR: 1.15,
          gazeLock: 0.8, gazeLockX: 0.8, gazeLockY: 0.1,
          armR: 0.6,
        },
        eye: "pills",
      };

    case "CONFUSED":
      return {
        pose: { bodyRot: confusedTilt(st), ringI: 0.3, antennaDroop: 0.35, armL: 0.6 },
        eye: "question",
      };

    case "ERROR":
      // Brief screen static, ring turns soft orange, then shakes it off.
      return {
        pose: {
          ...errorSlump(st, m),
          noise: st < 300 ? 1 : 0,
          ringWarn: kf(st, [[0, 0], [150, 1], [2000, 1], [2600, 0]]),
          ringI: kf(st, [[0, 0.75], [150, 0.9], [2000, 0.6], [2600, 0.75]]),
          eyeTilt: kf(st, [[300, 0], [500, -1], [2200, -1], [2700, 0]]),
          antennaDroop: kf(st, [[0, 0], [300, 0.5], [2200, 0.5], [2700, 0]]),
          armL: -0.25, armR: -0.25,
        },
        eye: st < 300 ? "lines" : "pills",
      };

    case "NOTIFY": {
      if (i.variant === "ack") {
        return { pose: { smile: 1, ringI: 1, armL: 0.4, armR: 0.4 }, eye: "happy" };
      }
      const n = notifyPop(st);
      return {
        pose: {
          sx: n.scale, sy: n.scale,
          lift: (n.hop + n.pulse * 0.025) * m,
          tipGlow: 0.35 + 0.65 * doubleFlash(st),
          ringI: 0.9,
          armL: 0.5 + n.pulse * 0.3, armR: 0.5 + n.pulse * 0.3,
        },
        eye: "wide",
      };
    }

    case "SLEEPY": {
      const f = sleepyFace(st);
      return {
        pose: {
          mouthO: f.yawn,
          eyeOpen: f.eyeOpen,
          glow: 0.5,
          ringI: 0.4,
          antennaDroop: 1,
          lift: -0.01 * m,
          armL: -0.15, armR: -0.15,
          blink: 0,
        },
        eye: "lines",
      };
    }

    case "SLEEPING":
      // Screen almost black, ring off except a very slow faint pulse.
      return {
        pose: {
          lift: kf(st, [[0, -0.01], [1200, -0.04, Ease.inQuad]]) * m,
          glow: 0.25,
          ringI: 0.06 + 0.08 * (0.5 + 0.5 * Math.sin((TAU * t) / 6)),
          antennaDroop: 1,
          tipGlow: 0.1,
          armL: -0.2, armR: -0.2,
          blink: 0,
        },
        eye: "lines",
      };

    case "WAKING":
      return {
        pose: {
          blink: 0,
          eyeOpen: wakeBlink(st),
          glow: kf(st, [[0, 0.25], [400, 1]]),
          ringI: kf(st, [[0, 0.1], [600, 0.85, Ease.outCubic]]),
          lift: kf(st, [[0, -0.04], [500, 0, Ease.outBack]]) * m,
          antennaDroop: kf(st, [[0, 1], [600, 0, Ease.outBack]]),
        },
        eye: "pills",
      };

    case "HELD": {
      const kick = Math.sin((TAU * t) / 0.36);
      return {
        pose: {
          ...heldSwing(i, 0.95),
          armL: (0.9 + 0.25 * Math.sin((TAU * t) / 0.32)) * m,
          armR: (0.9 + 0.25 * Math.sin((TAU * t) / 0.32 + 1.3)) * m,
          footL: 0.04 * Math.max(0, kick) * m,
          footR: 0.04 * Math.max(0, -kick) * m,
          ringI: 0.95,
        },
        eye: "wide",
      };
    }

    case "LANDING":
      return {
        pose: {
          ...landingSquash(st, m),
          armL: kf(st, [[0, 0.9], [200, 0, Ease.outCubic]]),
          armR: kf(st, [[0, 0.9], [200, 0, Ease.outCubic]]),
          ringI: kf(st, [[60, 0.75], [140, 1], [450, 0.75]]),
        },
        eye: st < 160 ? "lines" : "pills",
      };
  }
}

// ── Kinds of work ─────────────────────────────────────────────────────────────
// WORKING's variants. Each loops for as long as it lasts, from the same upright
// stance as plain working, so they crossfade into one another; props pop into
// its nubs over the first 300 ms. Under reduced motion the body and its props
// hold still, and the screen, the ring and the antenna's tip carry the beats.

/** 0 → 1 (with a little overshoot) over the first 300 ms: a prop pops into hand. */
const propIn = (st: number) => kf(st, [[0, 0], [300, 1, Ease.outBack]]);

/** Where a nub's centre is, in body space (see drawArms). */
function nubAt(p: Pose, side: -1 | 1): { x: number; y: number } {
  const a = side < 0 ? p.armL : p.armR;
  return {
    x: side * 0.39 + (side < 0 ? p.armLdx : p.armRdx) + side * 0.075 * Math.cos(a),
    y: CY + 0.04 + (side < 0 ? p.armLdy : p.armRdy) - 0.075 * Math.sin(a),
  };
}

/** Offsets that put a nub (at angle `a`) on a point of the body. */
function nubTo(side: -1 | 1, a: number, x: number, y: number) {
  return { dx: x - side * 0.39 - side * 0.075 * Math.cos(a), dy: y - CY - 0.04 + 0.075 * Math.sin(a) };
}

/** Reading, 10 s: scanning a page held up at its side, line by line; "found it!" at 7 s. */
const READ = { cycle: 10000, line: 1400, found: 7000, foundMs: 1800 };

function scanning(i: PoseInput): PoseOut {
  const { st, motion: m } = i;
  const u = st % READ.cycle;
  const a = u - READ.found;
  const found = kf(a, [[0, 0], [120, 1, Ease.outBack], [1300, 1], [1800, 0, Ease.inOutSine]]);
  // The reading clock stops while it looks up.
  const r = u < READ.found ? u : u < READ.found + READ.foundMs ? READ.found : u - READ.foundMs;
  const line = Math.floor(r / READ.line);
  const k = (r % READ.line) / READ.line;
  const scanK = Math.min(1, k / 0.8);
  const hold = nubTo(-1, 0.1, -0.555, -0.53);
  return {
    pose: {
      page: propIn(st),
      // The page scrolls up a line after each one is read (8 lines, then round again).
      pageScroll: ((line + smoothstep(0.8, 1, k)) % 8) * m,
      scanK,
      beam: kf(st, [[200, 0], [500, 1]]) * (1 - found) * (k < 0.8 ? 1 : 0.4),
      found,
      bodyRot: (-3 * DEG + 2 * DEG * found) * m,
      lift: (0.01 * Math.sin((TAU * st) / 1600) + kf(a, [[0, 0], [150, 0.05, Ease.outCubic], [330, 0, Ease.inQuad]])) * m,
      lookX: lerp(-0.075 + 0.03 * scanK, 0, found),
      lookY: lerp(0.01, -0.01, found),
      eyeOpen: lerp(0.72, 1, found),
      eyeScale: 1 + 0.08 * found,
      ringArc: 1.3, ringRot: (TAU * st) / 1400,
      ringI: 0.85 + 0.15 * found,
      antenna: lerp(-0.18, 0.1, found) * m,
      tipGlow: 0.35 + 0.65 * kf(a, [[0, 0], [100, 1], [500, 0.35]]),
      armL: 0.1, armLdx: hold.dx, armLdy: hold.dy,
      armR: 0.2 + 0.6 * found * m,
    },
    eye: found > 0.5 ? "wide" : "pills",
  };
}

/** Running a command, 6.5 s: grab the lever, pull it down — clunk — and wait on the lamp. */
const RUN = { cycle: 6500, first: 300, clunk: 760 };

function pullingLever(i: PoseInput): PoseOut {
  const { st, motion: m } = i;
  const c = st < RUN.first ? -1 : (st - RUN.first) % RUN.cycle;
  // Reduced motion: hand on the lever, already pulled, the lamp on.
  const still = m < 0.5;
  const grip = still ? 1 : kf(c, [[0, 0], [380, 1, Ease.outCubic], [1250, 1], [1600, 0, Ease.inOutSine]]);
  const pull = still ? 1 : kf(c, [[380, 0], [RUN.clunk, 1, Ease.inQuad], [5800, 1], [6150, 0, Ease.outBack]]);
  const lamp = still ? 1 : c >= RUN.clunk && c < 5800 ? (c < 1600 || c % 800 < 480 ? 1 : 0.35) : 0;
  const thud = still ? 0 : kf(c, [[RUN.clunk - 20, 0], [RUN.clunk + 30, 1], [RUN.clunk + 250, 0, Ease.outCubic]]);
  const waiting = still ? 1 : kf(c, [[1400, 0], [1800, 1], [5700, 1], [6000, 0]]);
  // Waiting: eyes on the lamp, a glance at you now and then, toes tapping.
  const w = (c - 1800 + 3000) % 3000;
  const atYou = waiting > 0.5 && w > 1900 && w < 2800 ? 1 : 0;
  const tap = waiting * Math.max(0, Math.sin((TAU * st) / 600)) * m;
  return {
    pose: {
      lever: propIn(st),
      leverAngle: lerp(LEVER.up, LEVER.down, pull),
      leverGrip: grip,
      leverLamp: lamp,
      bodyRot: (6 * DEG * grip * pull + 2 * DEG * grip * (1 - pull)) * m,
      sy: 1 - 0.05 * thud, sx: 1 + 0.04 * thud,
      lift: 0.008 * Math.sin((TAU * st) / 1600) * m,
      lookX: lerp(lerp(0.06, 0.065, waiting), 0, atYou),
      lookY: lerp(lerp(0.02, -0.03, waiting), 0, atYou),
      eyeScale: lerp(1, 1.08, waiting),
      eyeOpen: 1 - 0.25 * grip * (1 - waiting),
      ringProg: waiting > 0.5 ? (st / 1500) % 1 : -1,
      ringI: 0.8 + 0.2 * thud,
      tipGlow: 0.35 + 0.65 * thud,
      antenna: -0.15 * pull * grip * m,
      armL: 0.25,
      armR: lerp(0.2, 0.3, grip),
      footR: 0.035 * tap,
    },
    eye: !still && c >= RUN.clunk && c < 1150 ? "happy" : "pills",
  };
}

/** On the web, 10 s: binoculars up, sweeping the horizon; then down they come, "oh!". */
const LOOK = { cycle: 10000, oh: 6500 };

function lookingOut(i: PoseInput): PoseOut {
  const { st, motion: m } = i;
  const a = (st % LOOK.cycle) - LOOK.oh;
  const oh = kf(a, [[0, 0], [120, 1, Ease.outBack], [1500, 1], [1900, 0, Ease.inOutSine]]);
  const sweep = Math.sin((TAU * st) / 5500);
  const scan = sweep * m;
  const drop = oh * m;
  return {
    pose: {
      bino: propIn(st),
      binoX: 0.03 * scan,
      binoDrop: drop,
      bodyRot: 4 * DEG * scan,
      lift: (0.008 * Math.sin((TAU * st) / 1600) + kf(a, [[0, 0], [150, 0.05, Ease.outCubic], [320, 0, Ease.inQuad]])) * m,
      // The eyes behind the glasses sweep too (only they move under reduced motion).
      lookX: 0.03 * sweep * (1 - oh),
      eyeScale: 1 + 0.1 * oh,
      armL: 0.2, armR: 0.2, armLfront: 1, armRfront: 1,
      antenna: (0.25 * scan) * (1 - oh),
      tipGlow: 0.35 + 0.65 * kf(a, [[0, 0], [100, 1], [600, 0.35]]),
      ringI: 0.75 + 0.25 * oh,
    },
    eye: oh > 0.5 ? "wide" : "pills",
  };
}

/** Waiting for your OK: NOTIFY's pop, then every 3.2 s two hops and a wave; the screen flips eyes ↔ "!". */
const CALL = { cycle: 3200, from: 400 };

function callingYou(i: PoseInput): PoseOut {
  const { st, motion: m } = i;
  const u = st >= CALL.from ? (st - CALL.from) % CALL.cycle : -1;
  const env = kf(u, [[0, 0], [100, 1], [1100, 1], [1400, 0]]);
  const wave = Math.sin((TAU * Math.max(0, u)) / 550) * env;
  const hop = kf(u, [[0, 0], [150, 0.045, Ease.outCubic], [300, 0, Ease.inQuad], [420, 0.022, Ease.outCubic], [540, 0, Ease.inQuad]]);
  const pulse = kf(u, [[0, 0], [120, 1], [450, 0]]);
  const n = notifyPop(st);
  const k = st >= CALL.from ? (st - CALL.from) % CALL.cycle : 0;
  return {
    pose: {
      sx: n.scale, sy: n.scale,
      lift: (n.hop + hop) * m,
      tipGlow: 0.35 + 0.65 * doubleFlash(st),
      ringI: 0.75 + 0.25 * pulse,
      // The right arm stretches up and waves.
      armR: 1.2 + 0.4 * wave * m, armRdx: 0.03, armRdy: -0.13,
      armL: 0.5 + 0.2 * pulse,
      footL: 0.03 * kf(u, [[0, 0], [150, 1], [300, 0]]) * m,
      footR: 0.03 * kf(u, [[420, 0], [500, 1], [540, 0]]) * m,
      gazeLock: 1, gazeLockX: 0, gazeLockY: 0,
      eyeScale: 1.05 + 0.05 * pulse,
    },
    eye: k >= 2200 ? "bang" : "wide",
  };
}

/** Asking you something: a steady tilt, a nub at its chin, a "?" glowing over its head, a "hm?" every 4.5 s. */
const HMM = { cycle: 4500, at: 2600 };

function wondering(i: PoseInput): PoseOut {
  const { st, motion: m } = i;
  const u = st % HMM.cycle;
  const hm = kf(u - HMM.at, [[0, 0], [250, 1, Ease.outCubic], [900, 1], [1400, 0, Ease.inOutSine]]);
  const tap = u >= 600 && u < 1200 ? Math.max(0, Math.sin((TAU * (u - 600)) / 300)) : 0;
  const settle = kf(st, [[0, 0], [500, 1, Ease.outCubic]]);
  const chin = nubTo(-1, -0.2, -0.25, -0.29);
  return {
    pose: {
      bodyRot: (-(7 + 1.5 * Math.sin((TAU * st) / 5000)) - 2 * hm) * DEG * settle * m,
      sx: 1 + 0.025 * hm * m, sy: 1 + 0.025 * hm * m,
      lift: 0.006 * Math.sin((TAU * st) / 1600) * m,
      holo: kf(st, [[100, 0], [450, 1, Ease.outBack]]) * (1 + 0.2 * hm),
      holoBob: Math.sin((TAU * st) / 2400) * m,
      antenna: (0.3 + 0.1 * hm) * settle,
      tipGlow: 0.5 + 0.5 * hm,
      ringI: 0.6 + 0.1 * Math.sin((TAU * st) / 3000),
      gazeLock: 1, gazeLockX: 0.15, gazeLockY: -0.1,
      eyeScale: 1.02 + 0.06 * hm, eyeScaleL: 1.15, eyeScaleR: 0.85,
      mouthO: 0.25 * hm,
      armL: -0.2, armLfront: 1, armLdx: chin.dx, armLdy: chin.dy - 0.02 * tap * m,
      armR: 0.1,
    },
    eye: "pills",
  };
}

function events(i: PoseInput, prev: number, emit: Emit, p: Pose) {
  const crossed = crossedAt(prev, i.st);
  const head = 1.0 + p.lift;
  /** A moment `at` ms into every `cycle` ms from `from`. */
  const each = (cycle: number, from: number, at: number) =>
    i.st >= from && crossed(from + Math.floor((i.st - from) / cycle) * cycle + at);
  switch (i.state) {
    case "WORKING":
      if (i.variant === "research" && each(READ.cycle, 0, READ.found + 100)) {
        emit({ kind: "sparkle", x: -0.7, y: 0.75 + p.lift, vx: -0.1, vy: 0.2, size: 0.065, life: 0.8, spin: 1.5 });
      } else if (i.variant === "run" && each(RUN.cycle, RUN.first, RUN.clunk)) {
        emit({ kind: "puff", x: LEVER.boxX, y: LEVER.boxH + 0.06, vx: 0.08, vy: 0.25, size: 0.05, life: 0.6 });
      } else if (i.variant === "browse" && each(LOOK.cycle, 0, LOOK.oh + 80)) {
        emit({ kind: "sparkle", x: 0.55, y: 0.95 + p.lift, vx: 0.12, vy: 0.15, size: 0.065, life: 0.9, spin: -1.5 });
      }
      break;
    case "TOUCHED":
      if (i.variant === "dizzy" && crossed(40)) {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * TAU;
          emit({ kind: "star", x: Math.cos(a) * 0.4, y: 0.9 + Math.sin(a) * 0.08, vx: -Math.sin(a) * 0.3, vy: 0.05, size: 0.06, life: 1.1, spin: 3 });
        }
      }
      break;
    case "SUCCESS":
      if (crossed(200)) {
        for (let k = -1; k <= 1; k++) {
          emit({ kind: "sparkle", x: k * 0.3, y: head - Math.abs(k) * 0.15, vx: k * 0.2, vy: 0.22, size: 0.075 - Math.abs(k) * 0.015, life: 0.9, spin: k * 1.5 });
        }
      }
      break;
    case "LANDING":
      if (crossed(60)) {
        for (const side of [-1, 1]) emit({ kind: "puff", x: side * 0.3, y: 0.03, vx: side * 0.35, vy: 0.08, size: 0.05, life: 0.45 });
      }
      break;
    case "SLEEPING":
      if (i.st >= 1500) {
        const n = Math.floor((i.st - 1500) / 4000);
        if (crossed(1500 + n * 4000)) emit({ kind: "z", x: 0.3, y: 0.95, vx: 0.07, vy: 0.1, size: 0.08, life: 3.2 });
      }
      break;
  }
}

// ── Drawing ───────────────────────────────────────────────────────────────────

const HEX = roundedPolygon(0, CY, HEX_R, 6, 0.1);
const HEX_SIDE = roundedPolygon(0, CY + 0.05, HEX_R, 6, 0.1);

function draw(g: CanvasRenderingContext2D, p: Pose, eye: string, f: Frame) {
  const { U, ox, oy } = f;
  const baseX = ox + p.bodyX * U;

  // The run lever's box stands on the ground beside Hexo.
  if (p.lever > 0.01) drawLeverBox(g, p, f);

  // Ground shadow, shrinking as Hexo hops.
  {
    const k = clamp(1 - p.lift * 4, 0.4, 1.12);
    g.save();
    g.translate(baseX, oy);
    g.scale(U, U);
    const r = 0.36 * k * p.sx;
    const sh = g.createRadialGradient(0, 0, 0, 0, 0, r);
    sh.addColorStop(0, `rgba(20,40,60,${0.3 * k})`);
    sh.addColorStop(1, "rgba(20,40,60,0)");
    g.fillStyle = sh;
    g.beginPath();
    g.ellipse(0, 0, r, r * 0.17, 0, 0, TAU);
    g.fill();
    g.restore();
  }

  g.save();
  g.translate(baseX, oy - p.lift * U);
  g.scale(U, U);
  // Rotate about the hex centre, like a nut turning; squash from the base.
  g.translate(0, CY);
  g.rotate(p.bodyRot);
  g.translate(0, -CY);
  g.scale(p.sx, p.sy);

  if (p.page > 0.01) drawPage(g, p);
  drawFeet(g, p);
  drawAntenna(g, p, U);
  drawArms(g, p, false);
  drawBody(g, f.detail);
  drawRing(g, p, U);
  drawScreen(g, p, eye, f);
  if (p.page > 0.01 && p.beam > 0.01) drawBeam(g, p);
  if (p.bino > 0.01) drawBinoculars(g, p, f);
  drawArms(g, p, true);
  if (p.holo > 0.01) drawHolo(g, p, f);
  g.restore();

  // The lever's handle goes over the hand that grips it.
  if (p.lever > 0.01) drawLever(g, p, f);
}

function drawFeet(g: CanvasRenderingContext2D, p: Pose) {
  for (const side of [-1, 1] as const) {
    const lift = side < 0 ? p.footL : p.footR;
    g.fillStyle = C.bodyDark;
    g.beginPath();
    g.ellipse(side * 0.16, -0.055 - lift, 0.095, 0.055, 0, 0, TAU);
    g.fill();
  }
}

/** The nubs behind the body (`front` false), or those held in front of it. */
function drawArms(g: CanvasRenderingContext2D, p: Pose, front: boolean) {
  for (const side of [-1, 1] as const) {
    if ((side < 0 ? p.armLfront : p.armRfront) > 0.5 !== front) continue;
    const a = side < 0 ? p.armL : p.armR;
    // Where the pose puts it, unless a prop has it: the lever's knob, the binoculars.
    let at = nubAt(p, side);
    const props: [number, { x: number; y: number }][] = [];
    if (side > 0 && p.lever > 0.01) props.push([clamp(p.leverGrip, 0, 1), leverKnob(p, true)]);
    if (p.bino > 0.01) props.push([clamp(p.bino, 0, 1), binoGrip(p, side)]);
    for (const [k, q] of props) at = { x: lerp(at.x, q.x, k), y: lerp(at.y, q.y, k) };
    // Moved off its shoulder: a telescopic arm shows.
    const sx = side * 0.39, sy = CY + 0.04;
    const rest = { x: sx + side * 0.075 * Math.cos(a), y: sy - 0.075 * Math.sin(a) };
    const reach = Math.hypot(at.x - rest.x, at.y - rest.y);
    if (reach > 0.02) {
      g.save();
      g.globalAlpha *= clamp((reach - 0.02) / 0.04, 0, 1);
      g.lineCap = "round";
      g.strokeStyle = C.bodyDark;
      g.lineWidth = 0.034;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(at.x, at.y);
      g.stroke();
      g.strokeStyle = "#5C9CC4";
      g.lineWidth = 0.012;
      g.stroke();
      g.restore();
    }
    g.save();
    g.translate(at.x, at.y);
    g.rotate(-side * a);
    const ag = g.createRadialGradient(-side * 0.035, -0.03, 0, -side * 0.015, 0, 0.1);
    ag.addColorStop(0, C.bodyLight);
    ag.addColorStop(1, C.bodyDark);
    g.fillStyle = ag;
    g.beginPath();
    g.ellipse(0, 0, 0.07, 0.082, 0, 0, TAU);
    g.fill();
    if (front) {
      g.strokeStyle = `rgba(${C.edge},0.5)`;
      g.lineWidth = 0.01;
      g.stroke();
    }
    g.restore();
  }
}

function drawAntenna(g: CanvasRenderingContext2D, p: Pose, U: number) {
  g.save();
  g.translate(0, HEX_TOP + 0.02);
  // Lags behind the body through the engine's spring.
  g.rotate(p.antenna + p.antennaDroop * 0.95 - p.lagX * 3);
  g.strokeStyle = C.bodyDark;
  g.lineWidth = 0.024;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, -0.1);
  g.stroke();
  // Bolt head.
  g.fillStyle = "#5C9CC4";
  g.fill(roundedPolygon(0, -0.1, 0.034, 6, 0.008));
  // Coral tip, glowing when it blinks.
  g.shadowColor = C.tip;
  g.shadowBlur = U * 0.08 * p.tipGlow;
  const tg = g.createRadialGradient(-0.01, -0.15, 0, 0, -0.14, 0.04);
  tg.addColorStop(0, "#FFC2AE");
  tg.addColorStop(1, C.tip);
  g.fillStyle = tg;
  g.globalAlpha *= 0.65 + 0.35 * p.tipGlow;
  g.beginPath();
  g.arc(0, -0.14, 0.034, 0, TAU);
  g.fill();
  g.restore();
}

function drawBody(g: CanvasRenderingContext2D, detail: number) {
  // Slab thickness: the darker side shows under the face.
  g.fillStyle = C.bodyDark;
  g.fill(HEX_SIDE);

  const fg = g.createLinearGradient(-0.35, CY - 0.35, 0.35, CY + 0.35);
  fg.addColorStop(0, C.bodyLight);
  fg.addColorStop(0.55, C.body);
  fg.addColorStop(1, "#30698F");
  g.fillStyle = fg;
  g.fill(HEX);

  // Soft-touch sheen top-left.
  const sheen = g.createRadialGradient(-0.18, CY - 0.22, 0, -0.18, CY - 0.22, 0.32);
  sheen.addColorStop(0, "rgba(255,255,255,0.16)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = sheen;
  g.fill(HEX);

  g.strokeStyle = `rgba(${C.edge},0.55)`;
  g.lineWidth = 0.012;
  g.stroke(HEX);

  // Faint machined grooves around the screen.
  if (detail > 0.3) {
    g.save();
    g.clip(HEX);
    g.strokeStyle = `rgba(255,255,255,${0.07 * detail})`;
    g.lineWidth = 0.004;
    for (const r of [0.315, 0.335, 0.355, 0.375]) {
      g.beginPath();
      g.arc(0, CY, r, 0, TAU);
      g.stroke();
    }
    g.restore();
  }
}

function drawRing(g: CanvasRenderingContext2D, p: Pose, U: number) {
  const [r, gg, b] = C.ring.map((v, k) => Math.round(lerp(v, C.warn[k], clamp(p.ringWarn, 0, 1))));
  const color = (a: number) => `rgba(${r},${gg},${b},${a})`;
  const I = clamp(p.ringI, 0, 1);
  g.save();
  g.lineWidth = 0.028;
  g.lineCap = "round";
  // Dim track.
  g.strokeStyle = color(0.14);
  g.beginPath();
  g.arc(0, CY, RING_R, 0, TAU);
  g.stroke();
  // Lit part: segments while booting, an arc for progress, else the full ring.
  g.strokeStyle = color(I);
  g.shadowColor = color(1);
  g.shadowBlur = U * 0.07 * I;
  const top = -Math.PI / 2;
  if (p.ringSeg < 6) {
    for (let k = 0; k < Math.round(p.ringSeg); k++) {
      g.beginPath();
      g.arc(0, CY, RING_R, top + (k * TAU) / 6 + 0.06, top + ((k + 1) * TAU) / 6 - 0.06);
      g.stroke();
    }
  } else if (p.ringArc > 0.01) {
    // Searching: a short arc chasing round.
    g.beginPath();
    g.arc(0, CY, RING_R, p.ringRot, p.ringRot + p.ringArc);
    g.stroke();
  } else if (p.ringProg >= 0) {
    g.beginPath();
    g.arc(0, CY, RING_R, top, top + Math.max(0.05, clamp(p.ringProg, 0, 1) * TAU));
    g.stroke();
  } else {
    g.beginPath();
    g.arc(0, CY, RING_R, 0, TAU);
    g.stroke();
  }
  g.restore();
}

function drawScreen(g: CanvasRenderingContext2D, p: Pose, eye: string, f: Frame) {
  // Recess: a dark lip, then the glass.
  const lip = g.createRadialGradient(0, CY, SCREEN_R * 0.8, 0, CY, SCREEN_R + 0.03);
  lip.addColorStop(0, "#0E141C");
  lip.addColorStop(1, C.bodyDark);
  g.fillStyle = lip;
  g.beginPath();
  g.arc(0, CY, SCREEN_R + 0.025, 0, TAU);
  g.fill();

  g.fillStyle = C.screen;
  g.beginPath();
  g.arc(0, CY, SCREEN_R, 0, TAU);
  g.fill();

  g.save();
  g.beginPath();
  g.arc(0, CY, SCREEN_R, 0, TAU);
  g.clip();
  g.translate(0, CY);
  drawGlyph(g, p, eye, f);

  if (p.scan >= 0) {
    const y = -SCREEN_R + p.scan * SCREEN_R * 2;
    const sg = g.createLinearGradient(0, y - 0.06, 0, y + 0.01);
    sg.addColorStop(0, `rgba(${C.eye},0)`);
    sg.addColorStop(1, `rgba(${C.eye},0.55)`);
    g.fillStyle = sg;
    g.fillRect(-SCREEN_R, y - 0.06, SCREEN_R * 2, 0.07);
    g.fillStyle = `rgba(${C.eye},0.95)`;
    g.fillRect(-SCREEN_R, y, SCREEN_R * 2, 0.008);
  }
  if (p.noise > 0.01) {
    // Static: deterministic speckle that changes every 40 ms.
    const frame = Math.floor(f.t * 25);
    for (let k = 0; k < 70; k++) {
      const x = (hash01(frame * 131 + k) * 2 - 1) * SCREEN_R;
      const y = (hash01(frame * 71 + k * 3) * 2 - 1) * SCREEN_R;
      g.fillStyle = `rgba(220,235,245,${0.5 * p.noise * hash01(k + frame)})`;
      g.fillRect(x, y, 0.03 + 0.05 * hash01(k * 7 + frame), 0.008);
    }
  }
  g.restore();

  // Glass reflection.
  g.strokeStyle = "rgba(255,255,255,0.13)";
  g.lineWidth = 0.014;
  g.lineCap = "round";
  g.beginPath();
  g.arc(0, CY, SCREEN_R - 0.035, Math.PI * 1.08, Math.PI * 1.42);
  g.stroke();
}

/** The face glyph, centred on the screen. */
function drawGlyph(g: CanvasRenderingContext2D, p: Pose, eye: string, f: Frame) {
  const alpha = clamp(p.glow * p.screenOn, 0, 1);
  if (alpha < 0.01) return;
  const color = `rgba(${C.eye},${alpha})`;
  g.save();
  g.fillStyle = color;
  g.strokeStyle = color;
  g.shadowColor = `rgba(${C.eye},${alpha})`;
  g.shadowBlur = f.U * 0.05 * alpha;
  g.lineCap = "round";
  g.lineJoin = "round";
  const gx = p.gazeX * 0.035 + p.lookX;
  const gy = p.gazeY * 0.025 + p.lookY;
  g.translate(gx, gy);
  g.scale(1, p.eyeMorph);

  const each = (fn: (side: -1 | 1, x: number, s: number) => void) => {
    for (const side of [-1, 1] as const) fn(side, side * 0.075, p.eyeScale * (side < 0 ? p.eyeScaleL : p.eyeScaleR));
  };

  switch (eye) {
    case "pills":
      each((side, x, s) => {
        const h = 0.125 * s * clamp(p.eyeOpen, 0.08, 1);
        const w = 0.048 * s;
        g.save();
        g.translate(x, -0.01);
        g.rotate(side * p.eyeTilt * 0.4);
        g.beginPath();
        g.roundRect(-w / 2, -h / 2, w, h, w / 2);
        g.fill();
        g.restore();
      });
      break;
    case "wide":
      each((_side, x, s) => {
        g.beginPath();
        g.arc(x, -0.01, 0.055 * s * clamp(p.eyeOpen, 0.15, 1), 0, TAU);
        g.fill();
      });
      break;
    case "happy":
      g.lineWidth = 0.03;
      each((_side, x, s) => {
        g.beginPath();
        g.arc(x, 0.01, 0.045 * s, Math.PI + 0.2, TAU - 0.2);
        g.stroke();
      });
      break;
    case "lines":
      g.lineWidth = 0.026;
      each((_side, x, s) => {
        g.beginPath();
        g.moveTo(x - 0.04 * s, 0);
        g.lineTo(x + 0.04 * s, 0);
        g.stroke();
      });
      break;
    case "dots": {
      // Loading dots, each lit in turn for 200 ms.
      const active = Math.floor((f.t * 1000) / 200) % 3;
      for (let k = 0; k < 3; k++) {
        g.globalAlpha = k === active ? 1 : 0.3;
        g.beginPath();
        g.arc((k - 1) * 0.07, 0, 0.024, 0, TAU);
        g.fill();
      }
      break;
    }
    case "check":
      g.lineWidth = 0.036;
      g.beginPath();
      g.moveTo(-0.075, 0.0);
      g.lineTo(-0.02, 0.055);
      g.lineTo(0.085, -0.06);
      g.stroke();
      break;
    case "bang":
      // "!": I need you.
      g.lineWidth = 0.05;
      g.beginPath();
      g.moveTo(0, -0.125);
      g.lineTo(0, 0.03);
      g.stroke();
      g.beginPath();
      g.arc(0, 0.1, 0.029, 0, TAU);
      g.fill();
      break;
    case "question":
      g.lineWidth = 0.032;
      g.beginPath();
      g.arc(0, -0.045, 0.05, Math.PI * 1.05, Math.PI * 0.45);
      g.lineTo(0, 0.04);
      g.stroke();
      g.beginPath();
      g.arc(0, 0.09, 0.02, 0, TAU);
      g.fill();
      break;
    case "spiral":
      g.lineWidth = 0.016;
      each((side, x) => {
        g.save();
        g.translate(x, 0);
        g.rotate(f.t * 7 * side);
        g.beginPath();
        for (let a = 0; a <= 4 * Math.PI; a += 0.25) {
          const r = (0.05 * a) / (4 * Math.PI);
          g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        g.stroke();
        g.restore();
      });
      break;
  }

  // Smile curve under the eyes, and the yawn "o".
  g.globalAlpha = 1;
  if (p.smile > 0.02) {
    g.strokeStyle = `rgba(${C.eye},${alpha * p.smile})`;
    g.lineWidth = 0.02;
    g.beginPath();
    g.arc(0, 0.06, 0.05, 0.22 * Math.PI, 0.78 * Math.PI);
    g.stroke();
  } else if (p.mouthO > 0.05) {
    g.strokeStyle = color;
    g.lineWidth = 0.016;
    g.beginPath();
    g.ellipse(0, 0.1, 0.018 + 0.012 * p.mouthO, 0.012 + 0.025 * p.mouthO, 0, 0, TAU);
    g.stroke();
  }
  g.restore();
}

// ── Props (kinds of work) ─────────────────────────────────────────────────────

const PROP = {
  paper: "#F4F8FB",
  graphite: "#3A4654",
  steel: "#9FB3C2",
  lampOn: "124,242,154", // #7CF29A
  lampOff: "#2F5A3C",
};

/** A body-space point for a ground-space one (units from the base centre, y down): undoes draw's transform. */
function toBody(p: Pose, x: number, y: number) {
  const x1 = x - p.bodyX;
  const y1 = y + p.lift - CY;
  const c = Math.cos(p.bodyRot), s = Math.sin(p.bodyRot);
  return { x: (x1 * c + y1 * s) / p.sx, y: (-x1 * s + y1 * c + CY) / p.sy };
}

/** The lever's knob, on the ground (or in body space), as it grows in with `lever`. */
function leverKnob(p: Pose, body = false) {
  const k = clamp(p.lever, 0, 1.2);
  const x = LEVER.boxX + k * (LEVER.pivotX - LEVER.len * Math.cos(p.leverAngle) - LEVER.boxX);
  const y = k * (LEVER.pivotY - LEVER.len * Math.sin(p.leverAngle));
  return body ? toBody(p, x, y) : { x, y };
}

/** Running a command: a control box with a ">_" screen and a lamp on top. */
function drawLeverBox(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  const { U, ox, oy } = f;
  const { boxX, boxW: W, boxH: H } = LEVER;
  g.save();
  g.translate(ox + boxX * U, oy);
  g.scale(U * p.lever, U * p.lever);
  const sh = g.createRadialGradient(0, 0, 0, 0, 0, 0.18);
  sh.addColorStop(0, "rgba(20,40,60,0.3)");
  sh.addColorStop(1, "rgba(20,40,60,0)");
  g.fillStyle = sh;
  g.beginPath();
  g.ellipse(0, 0, 0.18, 0.03, 0, 0, TAU);
  g.fill();
  // Lamp on top: green while the command runs.
  const lamp = clamp(p.leverLamp, 0, 1);
  g.save();
  if (lamp > 0.02) {
    g.shadowColor = `rgba(${PROP.lampOn},${lamp})`;
    g.shadowBlur = U * 0.08 * lamp;
  }
  g.fillStyle = PROP.lampOff;
  g.beginPath();
  g.ellipse(0, -H, 0.064, 0.06, 0, Math.PI, TAU);
  g.fill();
  g.fillStyle = `rgba(${PROP.lampOn},${lamp})`;
  g.fill();
  g.restore();
  g.fillStyle = "rgba(255,255,255,0.45)";
  g.beginPath();
  g.ellipse(-0.022, -H - 0.036, 0.014, 0.009, -0.4, 0, TAU);
  g.fill();
  // The box.
  const bg = g.createLinearGradient(-W / 2, 0, W / 2, 0);
  bg.addColorStop(0, "#56626F");
  bg.addColorStop(1, "#2E3640");
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(-W / 2, -H, W, H, 0.03);
  g.fill();
  g.strokeStyle = `rgba(${C.edge},0.35)`;
  g.lineWidth = 0.008;
  g.stroke();
  // Hazard band.
  g.save();
  g.beginPath();
  g.rect(-W / 2, -H + 0.03, W, 0.045);
  g.clip();
  g.fillStyle = `rgb(${C.ring.join(",")})`;
  g.fillRect(-W / 2, -H + 0.03, W, 0.045);
  g.fillStyle = "#2A2F36";
  for (let x = -W / 2 - 0.05; x < W / 2; x += 0.05) {
    g.beginPath();
    g.moveTo(x, -H + 0.075);
    g.lineTo(x + 0.025, -H + 0.075);
    g.lineTo(x + 0.07, -H + 0.03);
    g.lineTo(x + 0.045, -H + 0.03);
    g.closePath();
    g.fill();
  }
  g.restore();
  // Its screen: a prompt, brighter while running.
  g.fillStyle = C.screen;
  g.beginPath();
  g.roundRect(-0.08, -0.22, 0.16, 0.1, 0.016);
  g.fill();
  const a = 0.45 + 0.55 * lamp;
  g.strokeStyle = `rgba(${C.eye},${a})`;
  g.lineWidth = 0.014;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(-0.05, -0.192);
  g.lineTo(-0.028, -0.17);
  g.lineTo(-0.05, -0.148);
  g.stroke();
  if (lamp < 0.02 || f.t % 0.8 < 0.5) {
    g.beginPath();
    g.moveTo(-0.01, -0.146);
    g.lineTo(0.03, -0.146);
    g.stroke();
  }
  g.restore();
}

/** The lever itself, on the box's side, drawn over the hand that pulls it. */
function drawLever(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  const { U, ox, oy } = f;
  const k = clamp(p.lever, 0, 1.2);
  const px = LEVER.boxX + k * (LEVER.pivotX - LEVER.boxX), py = k * LEVER.pivotY;
  const knob = leverKnob(p);
  g.save();
  g.translate(ox, oy);
  g.scale(U, U);
  g.lineCap = "round";
  g.strokeStyle = PROP.steel;
  g.lineWidth = 0.034 * k;
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(knob.x, knob.y);
  g.stroke();
  g.fillStyle = "#2A2F36";
  g.beginPath();
  g.arc(px, py, 0.03 * k, 0, TAU);
  g.fill();
  const kg = g.createRadialGradient(knob.x - 0.012, knob.y - 0.014, 0, knob.x, knob.y, 0.045 * k);
  kg.addColorStop(0, "#FFC2AE");
  kg.addColorStop(1, C.tip);
  g.fillStyle = kg;
  g.beginPath();
  g.arc(knob.x, knob.y, 0.048 * k, 0, TAU);
  g.fill();
  g.restore();
}

/** Reading: a page of code held up at its left, scrolling a line at a time. */
const PAGE = { x: -0.72, y: -0.56, rot: -0.08, w: 0.3, h: 0.42, row: 0.062 };
const CODE: [indent: number, len: number][] = [
  [0, 0.19], [0.03, 0.14], [0.03, 0.2], [0.06, 0.12], [0.03, 0.17], [0, 0.08], [0.03, 0.18], [0.06, 0.13],
];

/** A page-space point in body space. */
function pagePoint(p: Pose, x: number, y: number) {
  const c = Math.cos(PAGE.rot), s = Math.sin(PAGE.rot);
  return { x: PAGE.x + p.page * (x * c - y * s), y: PAGE.y + p.page * (x * s + y * c) };
}

/** The line being read, in page space: its row's y, and where it starts and ends. */
function scanRow(p: Pose) {
  const frac = p.pageScroll - Math.floor(p.pageScroll);
  const [indent, len] = CODE[Math.floor(p.pageScroll) % 8];
  const x0 = -PAGE.w / 2 + 0.03 + indent;
  return { y: -frac * PAGE.row, x0, x1: x0 + len };
}

function drawPage(g: CanvasRenderingContext2D, p: Pose) {
  const { w: W, h: H, row } = PAGE;
  g.save();
  g.translate(PAGE.x, PAGE.y);
  g.rotate(PAGE.rot);
  g.scale(p.page, p.page);
  g.fillStyle = PROP.paper;
  g.strokeStyle = `rgba(42,92,124,0.7)`;
  g.lineWidth = 0.012;
  g.beginPath();
  g.roundRect(-W / 2, -H / 2, W, H, 0.022);
  g.fill();
  g.stroke();
  g.save();
  g.beginPath();
  g.rect(-W / 2 + 0.01, -H / 2 + 0.02, W - 0.02, H - 0.04);
  g.clip();
  const base = Math.floor(p.pageScroll);
  const frac = p.pageScroll - base;
  g.lineCap = "round";
  g.lineWidth = 0.016;
  for (let j = -4; j <= 4; j++) {
    const y = (j - frac) * row;
    const [indent, len] = CODE[(((base + j) % 8) + 8) % 8];
    const x0 = -W / 2 + 0.03 + indent;
    // The line being read: lit cyan up to the scan, or yellow when it's the find.
    if (j === 0) {
      const lit = p.found > 0.02 ? 1 : clamp(p.scanK, 0, 1);
      const col = p.found > 0.02 ? `rgba(${C.ring.join(",")},${0.75 * p.found})` : `rgba(${C.eye},${0.45 * p.beam})`;
      g.strokeStyle = col;
      g.lineWidth = 0.034;
      g.beginPath();
      g.moveTo(x0 - 0.01, y);
      g.lineTo(x0 + len * lit + 0.01, y);
      g.stroke();
      g.lineWidth = 0.016;
    }
    const fade = clamp(1.2 - Math.abs(y) / (H / 2), 0, 1);
    g.strokeStyle = `rgba(42,92,124,${0.75 * fade})`;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x0 + len * 0.45, y);
    g.stroke();
    g.strokeStyle = `rgba(232,120,90,${0.7 * fade})`;
    g.beginPath();
    g.moveTo(x0 + len * 0.45 + 0.025, y);
    g.lineTo(x0 + len, y);
    g.stroke();
  }
  g.restore();
  g.restore();
}

/** Reading: a soft scan beam from its left eye to the line on the page. */
function drawBeam(g: CanvasRenderingContext2D, p: Pose) {
  const ex = -0.075 + p.gazeX * 0.035 + p.lookX;
  const ey = CY - 0.01 + p.gazeY * 0.025 + p.lookY;
  const row = scanRow(p);
  const hx = row.x0 + (row.x1 - row.x0) * clamp(p.scanK, 0, 1);
  const head = pagePoint(p, hx, row.y);
  const a = pagePoint(p, row.x0, row.y - 0.035);
  const b = pagePoint(p, hx, row.y + 0.035);
  const k = clamp(p.beam, 0, 1) * clamp(p.page, 0, 1);
  g.save();
  const bg = g.createLinearGradient(ex, ey, head.x, head.y);
  bg.addColorStop(0, `rgba(${C.eye},${0.22 * k})`);
  bg.addColorStop(1, `rgba(${C.eye},${0.5 * k})`);
  g.fillStyle = bg;
  g.beginPath();
  g.moveTo(ex, ey - 0.02);
  g.lineTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.lineTo(ex, ey + 0.02);
  g.closePath();
  g.fill();
  g.fillStyle = `rgba(${C.eye},${0.95 * k})`;
  g.shadowColor = `rgba(${C.eye},${k})`;
  g.shadowBlur = 6;
  g.beginPath();
  g.arc(head.x, head.y, 0.014, 0, TAU);
  g.fill();
  g.restore();
}

/** On the web: binoculars held up to the screen; its eyes peer out through the lenses. */
function binoCentre(p: Pose) {
  return { x: p.binoX, y: CY - 0.01 + 0.3 * p.binoDrop };
}

/** Where a nub holds the binoculars: round the barrel's outer side. */
function binoGrip(p: Pose, side: -1 | 1) {
  const c = binoCentre(p);
  const t = 0.45 * p.binoDrop;
  const dx = side * 0.225 * p.bino, dy = 0.075 * p.bino;
  return { x: c.x + dx * Math.cos(t) - dy * Math.sin(t), y: c.y + dx * Math.sin(t) + dy * Math.cos(t) };
}

function drawBinoculars(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  const c = binoCentre(p);
  g.save();
  g.translate(c.x, c.y);
  g.rotate(0.45 * p.binoDrop);
  g.scale(p.bino, p.bino);
  // Bridge and focus wheel.
  g.fillStyle = "#B44A33";
  g.beginPath();
  g.roundRect(-0.07, -0.035, 0.14, 0.07, 0.02);
  g.fill();
  g.fillStyle = PROP.graphite;
  g.beginPath();
  g.roundRect(-0.026, -0.08, 0.052, 0.045, 0.012);
  g.fill();
  const peer = clamp(1 - p.binoDrop * 1.5, 0, 1) * clamp(p.glow * p.screenOn, 0, 1);
  for (const side of [-1, 1] as const) {
    const x = side * 0.118;
    // Coral barrels, so they stand out against the dark glass behind.
    const bg = g.createLinearGradient(x - 0.11, -0.11, x + 0.11, 0.11);
    bg.addColorStop(0, "#FFB59E");
    bg.addColorStop(0.5, C.tip);
    bg.addColorStop(1, "#C9563D");
    g.fillStyle = bg;
    g.beginPath();
    g.arc(x, 0, 0.108, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(120,40,25,0.6)";
    g.lineWidth = 0.01;
    g.stroke();
    g.fillStyle = "#0E141C";
    g.beginPath();
    g.arc(x, 0, 0.072, 0, TAU);
    g.fill();
    // Its eyes, big behind the glass, following the sweep.
    if (peer > 0.02) {
      g.save();
      g.beginPath();
      g.arc(x, 0, 0.072, 0, TAU);
      g.clip();
      const h = 0.1 * clamp(p.eyeOpen, 0.1, 1) * p.eyeMorph;
      const w = 0.046;
      g.fillStyle = `rgba(${C.eye},${peer})`;
      g.shadowColor = `rgba(${C.eye},${peer})`;
      g.shadowBlur = f.U * 0.04;
      g.beginPath();
      g.roundRect(x + p.lookX * 1.4 - w / 2, -h / 2, w, h, w / 2);
      g.fill();
      g.restore();
    }
    g.strokeStyle = "rgba(255,255,255,0.28)";
    g.lineWidth = 0.012;
    g.beginPath();
    g.arc(x, 0, 0.05, Math.PI * 1.1, Math.PI * 1.45);
    g.stroke();
  }
  g.restore();
}

/** Asking: a glowing "?" over its head, with two dots from the antenna's tip. */
function drawHolo(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  const k = clamp(p.holo, 0, 1.3);
  const x = 0.3, y = -1.13 + 0.02 * p.holoBob;
  const a = clamp(p.holo, 0, 1);
  g.save();
  g.fillStyle = `rgba(${C.eye},${0.8 * a})`;
  g.shadowColor = `rgba(${C.eye},${a})`;
  g.shadowBlur = f.U * 0.05;
  for (const [dx, dy, r] of [[0.11, -1.0, 0.014], [0.19, -1.05, 0.02]] as const) {
    g.beginPath();
    g.arc(dx, dy + 0.01 * p.holoBob, r * a, 0, TAU);
    g.fill();
  }
  g.translate(x, y);
  g.scale(1.35 * k, 1.35 * k);
  g.strokeStyle = `rgba(${C.eye},${a})`;
  g.fillStyle = `rgba(${C.eye},${a})`;
  g.lineWidth = 0.032;
  g.lineCap = "round";
  g.beginPath();
  g.arc(0, -0.045, 0.05, Math.PI * 1.05, Math.PI * 0.45);
  g.lineTo(0, 0.04);
  g.stroke();
  g.beginPath();
  g.arc(0, 0.09, 0.02, 0, TAU);
  g.fill();
  g.restore();
}

export const hexo: Skin = {
  id: "hexo",
  fit: { units: 2.0, base: 0.88 },
  // Antenna tip (y ≈ −1.0) to feet, arms included.
  hit: { x0: 0.25, y0: 0.37, x1: 0.75, y1: 0.91 },
  rest,
  restEye: "pills",
  pose,
  events,
  draw,
};
