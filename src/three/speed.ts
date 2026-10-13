// Whether this PC keeps up with Rui. He asks for a frame rate (60, 30 or 15
// depending on what he's doing); a weak graphics chip stretches the gaps
// between frames. Over each 10 s window, if he got less than SLOW_SHARE of the
// frames he asked for, or each frame took more than SLOW_MS of script and
// drawing, that window counts as slow; SLOW_WINDOWS slow windows in a row (after
// a grace period for start-up work like compiling shaders) and he's too slow.

export const SLOW_SHARE = 0.4;
export const SLOW_MS = 30;
export const SLOW_WINDOWS = 3;
export const SLOW_GRACE_S = 15;
const WINDOW_MS = 10_000;

export class SpeedWatch {
  private since = 0;
  private frames = 0;
  /** Frames he wanted in the time the counted ones took. */
  private asked = 0;
  private work = 0;
  private bad = 0;
  private startedAt = 0;
  /** Said "too slow" already: says it only once. */
  private done = false;

  /** (Re)starts watching, with a fresh grace period. */
  start(now: number): void {
    this.startedAt = now;
    this.restartWindow(now);
    this.bad = 0;
  }

  /** Time that shouldn't count (props compiling, nothing on screen): the window starts over. */
  pause(now: number): void {
    this.restartWindow(now);
  }

  /**
   * One frame drawn: `fps` is the rate he asked for, `dt` the seconds since the
   * last frame, `workMs` the script and drawing time. True once, when he's
   * found too slow.
   */
  frame(now: number, fps: number, dt: number, workMs: number): boolean {
    if (this.done) return false;
    if (now - this.startedAt < SLOW_GRACE_S * 1000) {
      this.restartWindow(now);
      return false;
    }
    this.frames++;
    this.asked += fps * dt; // 1 when the frame came on time
    this.work += workMs;
    if (now - this.since < WINDOW_MS) return false;
    const share = this.asked > 0 ? this.frames / this.asked : 1;
    const heavy = this.work / Math.max(1, this.frames) > SLOW_MS;
    this.bad = share < SLOW_SHARE || heavy ? this.bad + 1 : 0;
    this.restartWindow(now);
    if (this.bad < SLOW_WINDOWS) return false;
    this.done = true;
    return true;
  }

  private restartWindow(now: number): void {
    this.since = now;
    this.frames = 0;
    this.asked = 0;
    this.work = 0;
  }
}
