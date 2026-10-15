// The everyday-companion side: breaks, battery, downloads, coming back to the desk.
//
// Readings come from Rust as edge-triggered "system" events (src-tauri/src/system.rs).
// This module decides what the character does and what the bubble says, and
// owns the break timer. Kept free of Tauri so it can be tested.

import type { BubbleMessage } from "../bubble/types";
import type { BubbleSink } from "./agents";
import { duration } from "./format";

export type SystemEvent =
  | { kind: "idle" }
  | { kind: "active"; idleSecs: number }
  | { kind: "batteryLow"; percent: number; critical: boolean }
  | { kind: "pluggedIn"; percent: number }
  | { kind: "unplugged"; percent: number }
  | { kind: "batteryFull" }
  | { kind: "download"; name: string; count: number };

export interface Prefs {
  breaks: boolean;
  battery: boolean;
  downloads: boolean;
  welcome: boolean;
  hideFullscreen: boolean;
  size: "small" | "medium" | "large";
  character: string;
  /** "corner": anywhere on the desktop; "top": an island at the top edge. */
  place: "corner" | "top";
  /** Minutes at the keyboard before a break reminder. */
  breakMinutes?: number;
  /** Notifications paused until this time (ms since 1970); 0 not paused, −1 until turned back on. */
  quietUntil?: number;
  notifyDone?: boolean;
  notifyPermission?: boolean;
  notifyWaiting?: boolean;
  notifyErrors?: boolean;
  /** Allow / Deny from the companion (off: straight to the terminal). */
  answerPermissions?: boolean;
  askEnabled?: boolean;
  shareDevice?: boolean;
  /** Soft chimes for finished tasks, requests and errors. */
  sounds?: boolean;
  /** Look for new versions in the background. */
  autoUpdate?: boolean;
  /** Rui's look ("toy" | "anime") and colour theme (see src/three/palette.ts). */
  ruiLook?: string;
  ruiTheme?: string;
  /** On battery power, a 2D character stands in for Rui. */
  ruiFlatOnBattery?: boolean;
  /** Dogesh Bhai in "3d" (like Rui) or "2d". */
  dogeshStyle?: string;
  /** A paired phone sees the sessions and can answer requests (phone link). */
  phoneLink?: boolean;
}

export interface CompanionCharacter {
  notify(): void;
  activity(): void;
  sleepNow(): void;
  cheer(): void;
  getState(): string;
}

/** Continuous activity before the first break nudge (unless Settings say otherwise), then between nudges. */
export const BREAK_AFTER_MS = 50 * 60_000;
export const BREAK_REPEAT_MS = 20 * 60_000;
/** Away at least this long earns a "welcome back". */
const WELCOME_AFTER_SECS = 20 * 60;

const BATTERY_ID = "system:battery";

export class Companion {
  /** When the current stretch at the keyboard began (null while away). */
  private activeSince: number | null;
  private lastNudge = -Infinity;
  private batteryWarned = false;

  constructor(
    private character: CompanionCharacter,
    private bubble: BubbleSink,
    private prefs: Prefs,
    private now: () => number = () => Date.now(),
  ) {
    this.activeSince = now();
  }

  setPrefs(prefs: Prefs) {
    this.prefs = prefs;
  }

  handle(e: SystemEvent) {
    switch (e.kind) {
      case "idle":
        // The user stepped away: a break counts, and the character dozes off.
        this.activeSince = null;
        this.character.sleepNow();
        return;

      case "active":
        this.activeSince = this.now();
        this.lastNudge = -Infinity;
        this.character.activity();
        if (this.prefs.welcome && e.idleSecs >= WELCOME_AFTER_SECS) {
          this.say("info", "Welcome back", `You were away for ${duration(e.idleSecs)}.`, { category: "welcome" });
          this.character.cheer();
        }
        return;

      case "batteryLow":
        if (!this.prefs.battery) return;
        this.batteryWarned = true;
        this.character.notify();
        this.say(
          e.critical ? "error" : "attention",
          "Battery",
          e.critical ? `Only ${e.percent}% left. Plug in now!` : `Battery at ${e.percent}%. Time to plug in?`,
          { id: BATTERY_ID, sticky: e.critical, category: "battery" },
        );
        return;

      case "pluggedIn":
        if (!this.prefs.battery || !this.batteryWarned) return;
        this.batteryWarned = false;
        this.bubble.hide(BATTERY_ID);
        this.say("success", "Battery", "Charging. Thank you!", { category: "battery" });
        this.character.cheer();
        return;

      case "unplugged":
        return;

      case "batteryFull":
        if (this.prefs.battery) this.say("info", "Battery", "Fully charged. You can unplug now.", { category: "battery" });
        return;

      case "download":
        if (!this.prefs.downloads) return;
        this.say("success", "Downloads", e.count > 1 ? `${e.count} downloads finished` : `Downloaded ${e.name}`, { category: "download" });
        this.character.cheer();
        return;
    }
  }

  /** Call every half minute or so: nudges toward a break after a long stretch. */
  tick() {
    if (!this.prefs.breaks || this.activeSince === null || paused(this.prefs, this.now())) return;
    const now = this.now();
    const busy = ["NOTIFY", "HELD", "LANDING"].includes(this.character.getState());
    const after = this.prefs.breakMinutes ? this.prefs.breakMinutes * 60_000 : BREAK_AFTER_MS;
    if (busy || now - this.activeSince < after || now - this.lastNudge < BREAK_REPEAT_MS) return;
    this.lastNudge = now;
    const minutes = Math.round((now - this.activeSince) / 60_000);
    this.character.notify();
    this.say("attention", "Break time", `Chai break? You've been at it for ${duration(minutes * 60)}.`, { category: "break" });
  }

  private say(kind: BubbleMessage["kind"], title: string, text: string, extra: Partial<BubbleMessage> = {}) {
    this.bubble.show({ id: `system:${title}`, title, text, kind, ...extra });
  }
}

export { duration };

/** True while notifications are paused (Settings → Pause notifications). */
export const paused = (p: Prefs, now: number) => p.quietUntil === -1 || (p.quietUntil ?? 0) > now;

/**
 * Whether Settings let a notification through. Permission requests ignore the
 * pause (an agent is waiting on them), and answers to something the user just
 * did always show.
 */
export function allowed(msg: BubbleMessage, p: Prefs, now: number): boolean {
  switch (msg.category) {
    case "notice":
      return true;
    case "agent-permission":
      return p.notifyPermission !== false;
    case "agent-done":
      if (p.notifyDone === false) return false;
      break;
    case "agent-waiting":
      if (p.notifyWaiting === false) return false;
      break;
    case "agent-error":
      if (p.notifyErrors === false) return false;
      break;
  }
  return !paused(p, now);
}
