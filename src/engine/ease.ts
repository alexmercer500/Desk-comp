// Easing curves from the animation spec, Section 5. Each maps progress 0…1 to 0…1
// (Back and Elastic overshoot past 1 on purpose).

export type EaseFn = (p: number) => number;

/** CSS-style cubic-bezier(x1, y1, x2, y2), solved for x with Newton steps. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 6; i++) {
      const err = sx(t) - p;
      const d = dx(t);
      if (Math.abs(err) < 1e-5 || Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    // Newton can wander on flat curves; bisection keeps it honest.
    if (t < 0 || t > 1 || Math.abs(sx(t) - p) > 1e-3) {
      let lo = 0, hi = 1;
      t = p;
      for (let i = 0; i < 20; i++) {
        if (sx(t) < p) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return sy(t);
  };
}

/** Spring step response (stiffness 300, damping 10), stretched so it settles by p = 1. */
function elastic(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const k = 300, c = 10;
  const zw = c / 2;                 // ζω
  const wd = Math.sqrt(k - zw * zw); // damped angular frequency
  const t = p * 0.9;                // seconds of spring time across the tween
  return 1 - Math.exp(-zw * t) * (Math.cos(wd * t) + (zw / wd) * Math.sin(wd * t));
}

export const Ease = {
  linear: ((p) => p) as EaseFn,
  outBack: cubicBezier(0.34, 1.56, 0.64, 1),
  outCubic: cubicBezier(0.33, 1, 0.68, 1),
  inOutSine: cubicBezier(0.37, 0, 0.63, 1),
  outQuad: cubicBezier(0.5, 1, 0.89, 1),
  inQuad: cubicBezier(0.11, 0, 0.5, 0),
  outElastic: elastic as EaseFn,
} as const;

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (e0: number, e1: number, x: number) => {
  const k = clamp((x - e0) / (e1 - e0), 0, 1);
  return k * k * (3 - 2 * k);
};
