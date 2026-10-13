// Rui's "is this PC keeping up?" check (src/three/speed.ts).

import { describe, expect, it } from "vitest";
import { SLOW_GRACE_S, SpeedWatch } from "../src/three/speed";

/** Feeds frames at `fps` asked, arriving every `gapMs`, each taking `workMs`; returns when it said "too slow" (s), or null. */
function run(w: SpeedWatch, opts: { fps: number; gapMs: number; workMs?: number; seconds: number; from?: number }): number | null {
  let now = opts.from ?? 0;
  const end = now + opts.seconds * 1000;
  while (now < end) {
    now += opts.gapMs;
    if (w.frame(now, opts.fps, opts.gapMs / 1000, opts.workMs ?? 1)) return now / 1000;
  }
  return null;
}

describe("Rui's speed check", () => {
  it("stays quiet when frames come on time", () => {
    const w = new SpeedWatch();
    w.start(0);
    expect(run(w, { fps: 30, gapMs: 1000 / 30, seconds: 120 })).toBeNull();
    expect(run(w, { fps: 15, gapMs: 1000 / 15, seconds: 120, from: 120_000 })).toBeNull();
  });

  it("stays quiet a little under the asked rate (a busy moment)", () => {
    const w = new SpeedWatch();
    w.start(0);
    expect(run(w, { fps: 30, gapMs: 1000 / 20, seconds: 120 })).toBeNull();
  });

  it("says so once frames keep coming at under 40% of the rate, after the grace period and three windows", () => {
    const w = new SpeedWatch();
    w.start(0);
    const at = run(w, { fps: 30, gapMs: 1000 / 8, seconds: 120 });
    expect(at).not.toBeNull();
    // Three 10 s windows after the grace period (give or take a frame).
    expect(at!).toBeGreaterThan(SLOW_GRACE_S + 29.5);
    expect(at!).toBeLessThan(SLOW_GRACE_S + 31);
    // Only once.
    expect(run(w, { fps: 30, gapMs: 1000 / 8, seconds: 120, from: at! * 1000 })).toBeNull();
  });

  it("says so when every frame is heavy, even on time", () => {
    const w = new SpeedWatch();
    w.start(0);
    expect(run(w, { fps: 15, gapMs: 1000 / 15, workMs: 45, seconds: 120 })).not.toBeNull();
  });

  it("starts counting again after one good window", () => {
    const w = new SpeedWatch();
    w.start(0);
    // Windows close about every 10 s from the end of the grace period.
    expect(run(w, { fps: 30, gapMs: 125, seconds: SLOW_GRACE_S + 21 })).toBeNull(); // two slow windows
    expect(run(w, { fps: 30, gapMs: 1000 / 30, seconds: 24, from: (SLOW_GRACE_S + 21) * 1000 })).toBeNull(); // a good one
    expect(run(w, { fps: 30, gapMs: 125, seconds: 20, from: (SLOW_GRACE_S + 45) * 1000 })).toBeNull(); // two more slow: not three in a row
  });

  it("ignores start-up (shader compiling) and paused time", () => {
    const w = new SpeedWatch();
    w.start(0);
    // Very slow, but only during the grace period.
    expect(run(w, { fps: 30, gapMs: 500, seconds: SLOW_GRACE_S - 1 })).toBeNull();
    w.pause(SLOW_GRACE_S * 1000);
    expect(run(w, { fps: 30, gapMs: 1000 / 30, seconds: 60, from: SLOW_GRACE_S * 1000 })).toBeNull();
  });
});
