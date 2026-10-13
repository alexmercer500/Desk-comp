// The character's state machine (spec Section 2) and public API (Section 6).
// Turns app events into states; the engine turns states into motion.

import { Engine } from "./engine";
import type { CharacterId, Skin, StateName, Variant } from "./types";

export interface ControllerConfig {
  /** Confidence at or above this → SUCCESS. Same value the search backend uses. */
  high: number;
  /** Confidence at or above this (and below `high`) → SUGGESTING; below → CONFUSED. */
  low: number;
  idleToSleepyMs: number;
  sleepyToSleepMs: number;
  /** WORKING gives up and shows ERROR after this long. null = never (long agent runs). */
  workTimeoutMs: number | null;
}

const DEFAULTS: ControllerConfig = {
  high: 0.75,
  low: 0.4,
  idleToSleepyMs: 45_000,
  sleepyToSleepMs: 15_000,
  workTimeoutMs: 15_000,
};

/**
 * Higher interrupts lower (spec 2.3). BOOTING, WAKING and the desktop drag
 * (HELD, LANDING) are never interrupted: events that arrive meanwhile wait.
 */
const PRIORITY: Record<StateName, number> = {
  OFF: -1, SLEEPING: 0, SLEEPY: 1, IDLE: 2, ATTENTIVE: 3, TOUCHED: 4,
  SUCCESS: 5, SUGGESTING: 5, CONFUSED: 5, WORKING: 6, NOTIFY: 7, ERROR: 8,
  BOOTING: 9, WAKING: 9, LANDING: 9, HELD: 10,
};

/** States that finish before anything else may start. */
const UNINTERRUPTIBLE: readonly StateName[] = ["BOOTING", "WAKING", "HELD", "LANDING"];

/** States worth coming back to after a TOUCHED or NOTIFY interruption. */
const HOLDING: readonly StateName[] = ["IDLE", "ATTENTIVE", "WORKING", "SUGGESTING"];

const LABELS: Record<StateName, string> = {
  OFF: "Assistant is off",
  BOOTING: "Assistant is waking up",
  IDLE: "Assistant is ready",
  ATTENTIVE: "Assistant is listening",
  TOUCHED: "Assistant is ready",
  WORKING: "Assistant is working",
  SUCCESS: "Assistant found a match",
  SUGGESTING: "Assistant has suggestions",
  CONFUSED: "Assistant didn't understand",
  ERROR: "Something went wrong",
  NOTIFY: "Assistant has something for you",
  SLEEPY: "Assistant is getting sleepy",
  SLEEPING: "Assistant is asleep",
  WAKING: "Assistant is waking up",
  HELD: "Assistant is being moved",
  LANDING: "Assistant is being moved",
};

interface Target {
  state: StateName;
  variant: Variant;
}

type Listener = (from: StateName, to: StateName) => void;

export class CharacterController {
  readonly engine: Engine;
  private cfg: ControllerConfig;

  private state: StateName = "OFF";
  private variant: Variant = null;
  /** When the current timed state ends (engine clock, ms). */
  private deadline: number | null = null;
  /** Where to go when the current state ends, instead of resting. */
  private resume: Target | null = null;

  private workDeadline: number | null = null;
  private lastActivity = 0;
  private focused = false;
  private blurAt: number | null = null;
  private taps: number[] = [];
  private lastPulse = -Infinity;

  private listeners = new Set<Listener>();
  private bootDone: (() => void) | null = null;

  constructor(
    private skins: Partial<Record<CharacterId, Skin>>,
    initial: CharacterId,
    cfg: Partial<ControllerConfig> = {},
  ) {
    this.cfg = { ...DEFAULTS, ...cfg };
    this.engine = new Engine(this.skinFor(initial));
    this.engine.onTick = (now) => this.update(now);
    this.engine.setState("OFF", null, 0);
  }

  // ── Public API (spec Section 6) ──────────────────────────────────────────────

  setCharacter(id: CharacterId) {
    this.engine.setSkin(this.skinFor(id));
    this.engine.setState(this.state, this.variant, 0);
  }

  boot(): Promise<void> {
    if (this.state !== "OFF") return Promise.resolve();
    return new Promise((resolve) => {
      this.bootDone = resolve;
      this.go("BOOTING");
    });
  }

  /** `focused` → ATTENTIVE; losing focus returns to IDLE after 2 s. */
  inputFocused(focused: boolean) {
    this.focused = focused;
    this.activity();
    if (focused) {
      this.blurAt = null;
      if (this.state === "IDLE") this.go("ATTENTIVE");
    } else if (this.state === "ATTENTIVE") {
      this.blurAt = this.engine.now() + 2000;
    }
  }

  /** Listening pulse, at most every 400 ms. */
  userTyping() {
    this.activity();
    const now = this.engine.now();
    if ((this.state === "IDLE" || this.state === "ATTENTIVE") && now - this.lastPulse >= 400) {
      this.lastPulse = now;
      this.engine.overlay("pulse");
    }
  }

  tap() {
    const now = this.engine.now();
    this.taps = this.taps.filter((t) => now - t < 3000);
    this.taps.push(now);

    const wasAsleep = this.state === "SLEEPING" || this.state === "SLEEPY";
    this.activity();
    if (wasAsleep || this.state === "HELD" || this.state === "LANDING") return;

    if (this.state === "NOTIFY") {
      this.acknowledge();
      return;
    }
    const pokeable = this.state === "IDLE" || this.state === "ATTENTIVE" ||
      (this.state === "TOUCHED" && this.variant !== "dizzy");
    if (!pokeable) {
      // Busy (working, showing a result…): a small wiggle on top, no state change.
      this.engine.overlay("wiggle");
      return;
    }
    if (this.taps.length >= 5) {
      this.taps = [];
      this.enterTouched("dizzy");
    } else {
      this.enterTouched(null);
    }
  }

  startWork(opts: { timeoutMs?: number | null } = {}) {
    this.activity();
    const timeout = opts.timeoutMs === undefined ? this.cfg.workTimeoutMs : opts.timeoutMs;
    this.workDeadline = timeout === null ? null : this.engine.now() + timeout;
    this.engine.setProgress(null);
    this.request({ state: "WORKING", variant: null });
  }

  /** Work stopped without a result (cancelled, session closed): back to rest, no reaction. */
  cancelWork() {
    this.workDeadline = null;
    if (this.resume?.state === "WORKING") this.resume = null;
    if (this.state === "WORKING") this.go(this.rest());
  }

  setProgress(value: number | null) {
    this.engine.setProgress(value);
  }

  finishWork(result: { confidence: number; error?: boolean }) {
    this.workDeadline = null;
    const { high, low } = this.cfg;
    const state: StateName = result.error ? "ERROR"
      : result.confidence >= high ? "SUCCESS"
      : result.confidence >= low ? "SUGGESTING"
      : "CONFUSED";
    this.request({ state, variant: null });
  }

  suggestionPicked() {
    if (this.state === "SUGGESTING") this.go("SUCCESS", "short");
  }

  notify(opts: { badgeX?: number; badgeY?: number } = {}) {
    if (this.state === "OFF") return;
    if (opts.badgeX !== undefined && opts.badgeY !== undefined) {
      this.engine.setGazeTarget(opts.badgeX, opts.badgeY);
    }
    if (this.state === "SLEEPING") {
      this.activity(); // → WAKING, which chains into NOTIFY when done
      this.resume = { state: "NOTIFY", variant: null };
      return;
    }
    if (UNINTERRUPTIBLE.includes(this.state) || this.state === "ERROR") {
      this.resume = { state: "NOTIFY", variant: null };
      return;
    }
    const back = this.state === "NOTIFY" ? this.resume : this.holding();
    this.go("NOTIFY");
    this.resume = back;
  }

  acknowledge() {
    if (this.state !== "NOTIFY" || this.variant === "ack") return;
    const back = this.resume;
    this.go("NOTIFY", "ack");
    this.resume = back;
  }

  /** Any interaction: resets the idle timer and wakes the character. */
  activity() {
    this.lastActivity = this.engine.now();
    if (this.state === "SLEEPY") this.go(this.rest());
    else if (this.state === "SLEEPING") this.go("WAKING");
  }

  setGazeTarget(x: number, y: number) {
    this.engine.setGazeTarget(x, y);
  }

  /** A short happy beat for good news (a download finished, the charger went in). Never interrupts work. */
  cheer() {
    const calm: readonly StateName[] = ["IDLE", "ATTENTIVE", "SLEEPY", "SLEEPING"];
    if (calm.includes(this.state)) this.request({ state: "SUCCESS", variant: "short" });
  }

  /** Start dozing off now instead of waiting for the idle timeout (tray menu, "do not disturb"). */
  sleepNow() {
    if (this.state === "IDLE" || this.state === "ATTENTIVE") this.go("SLEEPY");
  }

  // ── Desktop drag (not in the original spec) ──────────────────────────────────

  /** The user picked the character up: it dangles until `drop()`. */
  pickUp() {
    if (this.state === "OFF" || this.state === "HELD") return;
    this.lastActivity = this.engine.now();
    const back = this.state === "LANDING" ? this.resume : this.holding();
    this.go("HELD");
    this.resume = back;
  }

  /** Drag velocity in logical px/s; drives the swing while HELD. */
  setCarry(vx: number, vy: number) {
    this.engine.setCarry(vx, vy);
  }

  drop() {
    if (this.state !== "HELD") return;
    this.engine.setCarry(0, 0);
    const back = this.resume;
    this.go("LANDING");
    this.resume = back;
  }

  setReducedMotion(enabled: boolean) {
    this.engine.setReducedMotion(enabled);
  }

  onStateChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ── Extras for the host app ──────────────────────────────────────────────────

  getState(): StateName {
    return this.state;
  }

  getVariant(): Variant {
    return this.variant;
  }

  /** Accessible label for the current state (spec Section 8). */
  label(): string {
    return LABELS[this.state];
  }

  configure(cfg: Partial<ControllerConfig>) {
    this.cfg = { ...this.cfg, ...cfg };
    if (this.state === "SLEEPY") this.deadline = this.engine.now() + this.cfg.sleepyToSleepMs;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private update(now: number) {
    if (this.state === "OFF") return;

    if (this.deadline !== null && now >= this.deadline) {
      this.deadline = null;
      this.timedStateEnded();
    }

    if (this.workDeadline !== null && now >= this.workDeadline) {
      this.workDeadline = null;
      if (this.state === "WORKING" || this.resume?.state === "WORKING") {
        this.finishWork({ confidence: 0, error: true });
      }
    }

    if (this.state === "ATTENTIVE" && this.blurAt !== null && now >= this.blurAt) {
      this.blurAt = null;
      this.go("IDLE");
    }

    if (this.state === "IDLE" && now - this.lastActivity >= this.cfg.idleToSleepyMs) {
      this.go("SLEEPY");
    }
  }

  private timedStateEnded() {
    switch (this.state) {
      case "BOOTING":
        this.settle();
        this.bootDone?.();
        this.bootDone = null;
        break;
      case "SLEEPY":
        this.go("SLEEPING");
        break;
      default:
        // TOUCHED, NOTIFY, WAKING return to where they came from; results return to rest
        // unless something was deferred while they played.
        this.settle();
    }
  }

  /** Enter a state unless the current one outranks it; then it waits its turn. */
  private request(target: Target) {
    this.activity(); // a sleeping character wakes first; the target waits for WAKING to finish
    const cur = this.state;
    const blocked =
      UNINTERRUPTIBLE.includes(cur) ||
      ((cur === "NOTIFY" || cur === "ERROR") && PRIORITY[target.state] < PRIORITY[cur]);
    if (blocked) {
      this.resume = target;
      return;
    }
    this.go(target.state, target.variant);
  }

  private enterTouched(variant: Variant) {
    const back = this.state === "TOUCHED" ? this.resume : this.holding();
    this.go("TOUCHED", variant);
    this.resume = back;
  }

  /** The current state, if it's one worth returning to. */
  private holding(): Target | null {
    return HOLDING.includes(this.state) ? { state: this.state, variant: null } : null;
  }

  private rest(): StateName {
    return this.focused ? "ATTENTIVE" : "IDLE";
  }

  private settle() {
    const next = this.resume;
    // Resting states are re-derived so a focus change during the interruption is honoured.
    if (!next || next.state === "IDLE" || next.state === "ATTENTIVE") this.go(this.rest());
    else this.go(next.state, next.variant);
  }

  private go(state: StateName, variant: Variant = null) {
    const from = this.state;
    const now = this.engine.now();
    this.state = state;
    this.variant = variant;
    this.resume = null;

    const ms = this.durationOf(state, variant);
    this.deadline = ms === null ? null : now + ms;
    if (state === "IDLE") this.lastActivity = now;
    if (state !== "ATTENTIVE") this.blurAt = null;

    let fade = 200;
    if (state === "SLEEPING" || from === "SLEEPING") fade = 300;
    if (state === "TOUCHED" || state === "NOTIFY") fade = 150;
    this.engine.setState(state, variant, fade);

    for (const cb of this.listeners) cb(from, state);
  }

  private durationOf(state: StateName, variant: Variant): number | null {
    switch (state) {
      case "BOOTING": return 1600;
      case "TOUCHED": return variant === "dizzy" ? 1600 : 600;
      case "SUCCESS": return variant === "short" ? 1200 : 2500;
      case "SUGGESTING": return 6000;
      case "CONFUSED": return 3000;
      case "ERROR": return 3000;
      case "NOTIFY": return variant === "ack" ? 500 : 5000;
      case "SLEEPY": return this.cfg.sleepyToSleepMs;
      case "WAKING": return 900;
      case "LANDING": return 450;
      default: return null;
    }
  }

  private skinFor(id: CharacterId): Skin {
    const skin = this.skins[id];
    if (!skin) throw new Error(`No skin registered for "${id}"`);
    return skin;
  }
}
