// Glim, the firefly helper: a lavender teardrop with translucent leaf wings and
// a glowing mint orb that "lights the way" (spec 1.3 and Section 4). Glim always
// hovers on a slow Lissajous path and only lands to sleep. No arms or legs:
// she speaks through tilt, wings, antennae and the orb.
//
// Drawing space: units, origin on the ground under her, y down. The body is
// drawn around its own centre B, which rises with `hover` (0 landed, 1 flying).

import { Ease, clamp } from "../engine/ease";
import { hash01, kf } from "../engine/track";
import type { Emit, Frame, Pose, PoseInput, PoseOut, Skin } from "../engine/types";
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

/** Where the orb is, in particle units (y up from the ground). */
function orbAt(p: Pose) {
  const by = LANDED_Y + FLIGHT_RISE * p.hover + p.lift;
  return { x: p.bodyX + Math.sin(p.bodyRot) * ORB_DY * -1, y: by - ORB_DY * Math.cos(p.bodyRot) };
}

function events(i: PoseInput, prev: number, emit: Emit, p: Pose) {
  const crossed = crossedAt(prev, i.st);
  const orb = orbAt(p);
  const head = LANDED_Y + FLIGHT_RISE * p.hover + p.lift + 0.22;
  switch (i.state) {
    case "WORKING": {
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
    const swing = side * (-0.25 * p.antPerk + 0.9 * p.antDroop) - p.lagX * 2.5;
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
  g.save();
  g.globalAlpha *= clamp(p.bodyAlpha, 0, 1);
  g.strokeStyle = C.bodyDark;
  g.lineWidth = 0.014;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(0, 0.33);
  g.lineTo(0, ORB_DY - ORB_R * 0.8);
  g.stroke();
  g.restore();

  // Halo, then the glowing core.
  const halo = 0.12 + 0.14 * I + 0.08 * p.orbFlash;
  const hg = g.createRadialGradient(0, ORB_DY, 0, 0, ORB_DY, halo);
  hg.addColorStop(0, `rgba(${C.orb},${0.55 * I})`);
  hg.addColorStop(1, `rgba(${C.orb},0)`);
  g.fillStyle = hg;
  g.beginPath();
  g.arc(0, ORB_DY, halo, 0, TAU);
  g.fill();

  g.shadowColor = `rgba(${C.orb},1)`;
  g.shadowBlur = U * 0.06 * I;
  const cg = g.createRadialGradient(-0.02, ORB_DY - 0.02, 0, 0, ORB_DY, ORB_R);
  cg.addColorStop(0, `rgba(240,255,248,${0.5 + 0.5 * I})`);
  cg.addColorStop(0.5, `rgba(${C.orb},${0.45 + 0.55 * I})`);
  cg.addColorStop(1, `rgba(110,210,160,${0.4 + 0.6 * I})`);
  g.fillStyle = cg;
  g.beginPath();
  g.arc(0, ORB_DY, ORB_R, 0, TAU);
  g.fill();
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
