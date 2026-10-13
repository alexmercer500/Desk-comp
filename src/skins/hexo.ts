// Hexo, the device-repair buddy: a rounded hex-nut whose centre hole is a dark
// glass screen. Its "eyes" are a glyph system (pills, loading dots, a check, a
// question mark), and the glowing core ring around the screen doubles as a
// progress indicator (spec 1.2 and Section 4).
//
// Drawing space: units, origin at the centre of the base, y down. The hex
// face is centred at (0, −0.5); the antenna tip reaches y ≈ −1.

import { Ease, clamp, lerp } from "../engine/ease";
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

function events(i: PoseInput, prev: number, emit: Emit, p: Pose) {
  const crossed = crossedAt(prev, i.st);
  const head = 1.0 + p.lift;
  switch (i.state) {
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

  drawFeet(g, p);
  drawAntenna(g, p, U);
  drawArms(g, p);
  drawBody(g, f.detail);
  drawRing(g, p, U);
  drawScreen(g, p, eye, f);
  g.restore();
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

function drawArms(g: CanvasRenderingContext2D, p: Pose) {
  for (const side of [-1, 1] as const) {
    const a = side < 0 ? p.armL : p.armR;
    g.save();
    g.translate(side * 0.39, CY + 0.04);
    g.rotate(-side * a);
    const ag = g.createRadialGradient(side * 0.04, -0.03, 0, side * 0.06, 0, 0.1);
    ag.addColorStop(0, C.bodyLight);
    ag.addColorStop(1, C.bodyDark);
    g.fillStyle = ag;
    g.beginPath();
    g.ellipse(side * 0.075, 0, 0.07, 0.082, 0, 0, TAU);
    g.fill();
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
  const gx = p.gazeX * 0.035;
  const gy = p.gazeY * 0.025;
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
