// Motions every character shares (spec Section 4): the timing is the
// personality, so it lives in one place. Each returns pose channels for a
// state at `st` ms; skins add their own signature parts on top.

import { Ease, clamp } from "../engine/ease";
import { kf } from "../engine/track";
import type { Pose, PoseInput } from "../engine/types";

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

/** Engine channels every skin must provide (see engine/types.ts). */
export const ENGINE_REST: Pose = {
  lift: 0, bodyX: 0, bodyRot: 0, sx: 1, sy: 1, fade: 1,
  eyeOpen: 1, blink: 1, gazeLock: 0, gazeLockX: 0, gazeLockY: 0,
};

/** 4.4 TOUCHED: squash 120, stretch 300, elastic settle by 600. */
export function touchSquash(st: number): Partial<Pose> {
  return {
    sy: kf(st, [[0, 1], [120, 0.88, Ease.outQuad], [300, 1.08, Ease.outQuad], [600, 1, Ease.outElastic]]),
    sx: kf(st, [[0, 1], [120, 1.1, Ease.outQuad], [300, 0.94, Ease.outQuad], [600, 1, Ease.outElastic]]),
  };
}

/** 4.4 dizzy: two ±8° wobbles over 1200 ms. */
export function dizzyWobble(st: number, m: number): number {
  return st < 1200 ? 8 * DEG * Math.sin((TAU * st) / 600) * (1 - st / 1400) * m : 0;
}

/** 4.6 SUCCESS: a 0.08-unit hop, then a small landing squash. */
export function successHop(st: number, m: number): Partial<Pose> {
  return {
    lift: kf(st, [[0, 0], [200, 0.08, Ease.outCubic], [400, 0, Ease.inQuad]]) * m,
    sy: kf(st, [[400, 1], [480, 0.92, Ease.outQuad], [650, 1, Ease.outElastic]]),
    sx: kf(st, [[400, 1], [480, 1.05, Ease.outQuad], [650, 1, Ease.outElastic]]),
  };
}

/** 4.8 CONFUSED: ±6° head tilt, twice. */
export function confusedTilt(st: number): number {
  const t = 6 * DEG;
  return kf(st, [
    [0, 0], [300, t, Ease.inOutSine], [900, -t, Ease.inOutSine],
    [1500, t, Ease.inOutSine], [2100, -t, Ease.inOutSine], [2400, 0, Ease.inOutSine],
  ]);
}

/** 4.9 ERROR: slump, then "shake it off" at 2000–2600. */
export function errorSlump(st: number, m: number): Partial<Pose> {
  const shake = st >= 2000 && st < 2600 ? 5 * DEG * Math.sin((TAU * (st - 2000)) / 200) * (1 - (st - 2000) / 600) : 0;
  return {
    lift: kf(st, [[0, 0], [300, -0.03, Ease.outQuad], [2000, -0.03], [2600, 0, Ease.outCubic]]) * m,
    bodyRot: shake * m,
  };
}

/** 4.10 NOTIFY: pop toward the viewer, then an attention pulse every 1.2 s (0…1). */
export function notifyPop(st: number): { scale: number; pulse: number; hop: number } {
  const k = st >= 400 ? ((st - 400) % 1200) / 1200 : 1;
  return {
    scale: kf(st, [[0, 1], [400, 1.12, Ease.outBack], [700, 1.06, Ease.outCubic]]),
    pulse: k < 0.25 ? Math.sin((Math.PI * k) / 0.25) : 0,
    hop: kf(st, [[0, 0], [200, 0.06, Ease.outCubic], [400, 0, Ease.inQuad]]),
  };
}

/** After 5 s of WORKING, a determined nod every 3 s (0…1). */
export function workNod(st: number): number {
  const k = st > 5000 ? (st - 5000) % 3000 : Infinity;
  return k < 350 ? Math.sin((Math.PI * k) / 350) : 0;
}

/** SLEEPY: a yawn on entry (0…1) and slow 400 ms blinks every 2 s (eye openness). */
export function sleepyFace(st: number): { yawn: number; eyeOpen: number } {
  const b = st % 2000;
  const slow = st > 1600 && b < 400 ? Math.sin((Math.PI * b) / 400) : 0;
  return {
    yawn: kf(st, [[0, 0], [600, 1, Ease.outCubic], [1000, 1], [1600, 0, Ease.inQuad]]),
    eyeOpen: 1 - 0.95 * slow,
  };
}

/** WAKING: a quick double blink. */
export const wakeBlink = (st: number) => kf(st, [[0, 0.1], [120, 1], [220, 0.1], [320, 1]]);

/** HELD: swing against the drag, pivoting at the top so the grabbed point stays put. */
export function heldSwing(i: PoseInput, height: number, wobblePeriod = 1.1): Partial<Pose> {
  const m = i.motion;
  const swing = clamp(i.carryX / 1400, -1, 1);
  const rot = (swing * 0.5 + 0.05 * Math.sin((TAU * i.t) / wobblePeriod)) * m;
  return { bodyRot: rot, bodyX: -Math.sin(rot) * height, lift: 0.04 * m, sy: 1 + 0.04 * m, sx: 1 - 0.03 * m };
}

/** LANDING: drop the last bit, squash hard, spring back. */
export function landingSquash(st: number, m: number): Partial<Pose> {
  return {
    lift: kf(st, [[0, 0.04], [90, 0, Ease.inQuad]]) * m,
    sy: kf(st, [[0, 1.04], [90, 0.84, Ease.outQuad], [250, 1.06, Ease.outQuad], [450, 1, Ease.outElastic]]),
    sx: kf(st, [[0, 0.97], [90, 1.14, Ease.outQuad], [250, 0.96, Ease.outQuad], [450, 1, Ease.outElastic]]),
  };
}

/** Moments within a state, for spawning particles. */
export const crossedAt = (prev: number, st: number) => (ms: number) => prev < ms && st >= ms;

/** Rounded regular polygon path, flat side at the top, centred on (cx, cy). */
export function roundedPolygon(cx: number, cy: number, r: number, sides: number, corner: number, rot = 0): Path2D {
  const pts: [number, number][] = [];
  for (let k = 0; k < sides; k++) {
    const a = rot + (k / sides) * TAU;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const p = new Path2D();
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[sides - 1], pts[0]);
  p.moveTo(start[0], start[1]);
  for (let k = 0; k < sides; k++) {
    const cur = pts[k];
    const next = pts[(k + 1) % sides];
    p.arcTo(cur[0], cur[1], next[0], next[1], corner);
  }
  p.closePath();
  return p;
}
