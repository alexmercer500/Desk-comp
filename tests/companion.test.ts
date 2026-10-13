// Breaks, battery, downloads, welcome back.

import { beforeEach, describe, expect, it } from "vitest";
import type { BubbleMessage } from "../src/bubble/types";
import { BREAK_AFTER_MS, BREAK_REPEAT_MS, Companion, allowed, duration, paused, type Prefs } from "../src/desktop/companion";

let clock: number;
let calls: string[];
let state: string;
let shown: BubbleMessage[];
let hidden: string[];
let co: Companion;
const all: Prefs = {
  breaks: true, battery: true, downloads: true, welcome: true,
  hideFullscreen: true, size: "medium", character: "kulhi", place: "corner",
};

beforeEach(() => {
  clock = 0;
  calls = [];
  state = "IDLE";
  shown = [];
  hidden = [];
  co = new Companion(
    {
      notify: () => calls.push("notify"),
      activity: () => calls.push("activity"),
      sleepNow: () => calls.push("sleepNow"),
      cheer: () => calls.push("cheer"),
      getState: () => state,
    },
    { show: (m) => shown.push(m), hide: (id) => hidden.push(id) },
    { ...all },
    () => clock,
  );
});

describe("breaks", () => {
  it("nudges after 50 minutes of activity, then every 20", () => {
    clock = BREAK_AFTER_MS - 1;
    co.tick();
    expect(shown).toHaveLength(0);
    clock = BREAK_AFTER_MS;
    co.tick();
    expect(shown[0]).toMatchObject({ title: "Break time", text: "Chai break? You've been at it for 50 minutes." });
    clock += BREAK_REPEAT_MS - 1;
    co.tick();
    expect(shown).toHaveLength(1);
    clock += 1;
    co.tick();
    expect(shown).toHaveLength(2);
  });

  it("stepping away counts as a break and restarts the clock", () => {
    clock = 40 * 60_000;
    co.handle({ kind: "idle" });
    expect(calls).toContain("sleepNow");
    clock = 45 * 60_000;
    co.handle({ kind: "active", idleSecs: 300 });
    clock = 45 * 60_000 + BREAK_AFTER_MS - 1;
    co.tick();
    expect(shown).toHaveLength(0);
  });

  it("can be turned off", () => {
    co.setPrefs({ ...all, breaks: false });
    clock = 3 * BREAK_AFTER_MS;
    co.tick();
    expect(shown).toHaveLength(0);
  });

  it("waits while the character is busy with something else", () => {
    state = "NOTIFY";
    clock = BREAK_AFTER_MS;
    co.tick();
    expect(shown).toHaveLength(0);
  });
});

describe("welcome back", () => {
  it("only after 20 minutes or more away", () => {
    co.handle({ kind: "active", idleSecs: 5 * 60 });
    expect(shown).toHaveLength(0);
    co.handle({ kind: "active", idleSecs: 65 * 60 });
    expect(shown[0]).toMatchObject({ title: "Welcome back", text: "You were away for 1 h 5 min." });
    expect(calls).toContain("cheer");
  });
});

describe("battery", () => {
  it("warns when low, thanks when plugged in", () => {
    co.handle({ kind: "batteryLow", percent: 18, critical: false });
    expect(calls).toEqual(["notify"]);
    expect(shown[0]).toMatchObject({ kind: "attention", text: "Battery at 18%. Time to plug in?" });
    co.handle({ kind: "pluggedIn", percent: 18 });
    expect(hidden).toEqual(["system:battery"]);
    expect(shown[1]).toMatchObject({ kind: "success", text: "Charging. Thank you!" });
  });

  it("critical is sticky", () => {
    co.handle({ kind: "batteryLow", percent: 9, critical: true });
    expect(shown[0]).toMatchObject({ kind: "error", sticky: true });
  });

  it("plugging in without a warning says nothing", () => {
    co.handle({ kind: "pluggedIn", percent: 70 });
    expect(shown).toHaveLength(0);
  });
});

describe("downloads", () => {
  it("names a single file, counts several", () => {
    co.handle({ kind: "download", name: "photo.jpg", count: 1 });
    co.handle({ kind: "download", name: "a.zip", count: 3 });
    expect(shown.map((m) => m.text)).toEqual(["Downloaded photo.jpg", "3 downloads finished"]);
  });

  it("can be turned off", () => {
    co.setPrefs({ ...all, downloads: false });
    co.handle({ kind: "download", name: "photo.jpg", count: 1 });
    expect(shown).toHaveLength(0);
  });
});

describe("duration", () => {
  it.each([
    [30, "1 minute"], [50 * 60, "50 minutes"], [3600, "1 hour"], [2 * 3600, "2 hours"], [65 * 60, "1 h 5 min"],
  ])("%i s → %s", (secs, text) => {
    expect(duration(secs)).toBe(text);
  });
});

describe("break interval from Settings", () => {
  it("nudges after the chosen number of minutes", () => {
    co.setPrefs({ ...all, breakMinutes: 30 });
    co.handle({ kind: "active", idleSecs: 0 });
    clock = 30 * 60_000 - 1;
    co.tick();
    expect(shown).toHaveLength(0);
    clock = 30 * 60_000;
    co.tick();
    expect(shown.map((m) => m.category)).toEqual(["break"]);
  });

  it("stays quiet while notifications are paused", () => {
    co.setPrefs({ ...all, quietUntil: -1 });
    co.handle({ kind: "active", idleSecs: 0 });
    clock = 3 * BREAK_AFTER_MS;
    co.tick();
    expect(shown).toHaveLength(0);
  });
});

describe("allowed", () => {
  const msg = (category: BubbleMessage["category"]): BubbleMessage => ({ id: "x", title: "t", text: "t", kind: "info", category });
  const now = 1_000_000;

  it("lets everything through by default", () => {
    for (const c of ["agent-done", "agent-permission", "agent-waiting", "agent-error", "break", "battery", "download", "welcome", "notice"] as const) {
      expect(allowed(msg(c), all, now)).toBe(true);
    }
  });

  it("drops each agent alert that is switched off", () => {
    expect(allowed(msg("agent-done"), { ...all, notifyDone: false }, now)).toBe(false);
    expect(allowed(msg("agent-waiting"), { ...all, notifyWaiting: false }, now)).toBe(false);
    expect(allowed(msg("agent-error"), { ...all, notifyErrors: false }, now)).toBe(false);
    expect(allowed(msg("agent-permission"), { ...all, notifyPermission: false }, now)).toBe(false);
    expect(allowed(msg("agent-done"), { ...all, notifyErrors: false }, now)).toBe(true);
  });

  it("pauses everything but permission requests and answers to the user", () => {
    const quiet = { ...all, quietUntil: now + 60_000 };
    expect(paused(quiet, now)).toBe(true);
    expect(allowed(msg("agent-done"), quiet, now)).toBe(false);
    expect(allowed(msg("break"), quiet, now)).toBe(false);
    expect(allowed(msg("agent-permission"), quiet, now)).toBe(true);
    expect(allowed(msg("notice"), quiet, now)).toBe(true);
  });

  it("ends the pause on time, or never with −1", () => {
    expect(paused({ ...all, quietUntil: now - 1 }, now)).toBe(false);
    expect(paused({ ...all, quietUntil: 0 }, now)).toBe(false);
    expect(paused({ ...all, quietUntil: -1 }, now)).toBe(true);
  });
});

describe("sounds", async () => {
  const { chimeFor } = await import("../src/desktop/sounds");
  const m = (category: BubbleMessage["category"]): BubbleMessage => ({ id: "x", title: "t", text: "t", kind: "info", category });
  it("chimes for finished, waiting and failed work, not for everything", () => {
    expect(chimeFor(m("agent-done"))).toBe("done");
    expect(chimeFor(m("agent-permission"))).toBe("attention");
    expect(chimeFor(m("agent-error"))).toBe("error");
    expect(chimeFor(m("agent-waiting"))).toBeNull();
    expect(chimeFor(m("download"))).toBeNull();
    expect(chimeFor(m("notice"))).toBeNull();
  });
});
