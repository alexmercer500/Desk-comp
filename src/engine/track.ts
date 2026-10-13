// Helpers skins use to describe poses as pure functions of time.

import { Ease, type EaseFn } from "./ease";

/** [time ms, value, easing into this key (default linear)] */
export type Key = readonly [ms: number, value: number, ease?: EaseFn];

/**
 * Value of a keyframe track at `ms`. Holds the first value before the first key
 * and the last value after the last one.
 */
export function kf(ms: number, keys: readonly Key[]): number {
  if (ms <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, ease = Ease.linear] = keys[i];
    if (ms < t1) {
      const [t0, v0] = keys[i - 1];
      const p = (ms - t0) / (t1 - t0);
      return v0 + (v1 - v0) * ease(p);
    }
  }
  return keys[keys.length - 1][1];
}

/** Sine oscillation, `periodS` in seconds. */
export const osc = (tS: number, periodS: number, amp = 1, phase = 0) =>
  amp * Math.sin((2 * Math.PI * tS) / periodS + phase);

/** 1 inside [startMs, endMs), else 0. */
export const within = (ms: number, startMs: number, endMs: number) =>
  ms >= startMs && ms < endMs ? 1 : 0;

/** Cheap deterministic hash → 0…1, for "random but stable" per-cycle choices. */
export const hash01 = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
