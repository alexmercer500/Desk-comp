// State machine and confidence mapping (spec Section 2, Section 6, Definition of done).
// The engine runs headless here: a stub skin, no canvas, time stepped by hand.

import { beforeEach, describe, expect, it } from "vitest";
import { CharacterController } from "../src/engine/controller";
import type { Skin, StateName } from "../src/engine/types";

const stub: Skin = {
  id: "kulhi",
  fit: { units: 2, base: 0.88 },
  hit: { x0: 0, y0: 0, x1: 1, y1: 1 },
  rest: { lift: 0, bodyX: 0, bodyRot: 0, sx: 1, sy: 1, fade: 1, eyeOpen: 1, blink: 1, gazeLock: 0, gazeLockX: 0, gazeLockY: 0 },
  restEye: "oval",
  pose: () => ({ pose: {}, eye: "oval" }),
  draw: () => {},
};

let c: CharacterController;
const advance = (ms: number) => c.engine.advance(ms);
const state = (): StateName => c.getState();

async function booted() {
  const done = c.boot();
  advance(1700);
  await done;
}

beforeEach(() => {
  c = new CharacterController({ kulhi: stub }, "kulhi");
});

describe("boot", () => {
  it("goes OFF → BOOTING → IDLE in about 1.6 s", async () => {
    expect(state()).toBe("OFF");
    const done = c.boot();
    expect(state()).toBe("BOOTING");
    advance(1500);
    expect(state()).toBe("BOOTING");
    advance(200);
    await done;
    expect(state()).toBe("IDLE");
  });
});

describe("confidence mapping", () => {
  const cases: [number, StateName][] = [
    [1, "SUCCESS"], [0.75, "SUCCESS"], [0.7499, "SUGGESTING"],
    [0.4, "SUGGESTING"], [0.3999, "CONFUSED"], [0, "CONFUSED"],
  ];
  for (const [confidence, expected] of cases) {
    it(`${confidence} → ${expected}`, async () => {
      await booted();
      c.startWork();
      c.finishWork({ confidence });
      expect(state()).toBe(expected);
    });
  }

  it("error wins over confidence", async () => {
    await booted();
    c.startWork();
    c.finishWork({ confidence: 0.99, error: true });
    expect(state()).toBe("ERROR");
  });

  it("uses configured thresholds", async () => {
    c.configure({ high: 0.9, low: 0.5 });
    await booted();
    c.startWork();
    c.finishWork({ confidence: 0.8 });
    expect(state()).toBe("SUGGESTING");
  });
});

describe("one-shot results return to IDLE", () => {
  it.each([
    [0.9, "SUCCESS", 2500],
    [0.1, "CONFUSED", 3000],
  ] as const)("confidence %s plays %s for %i ms", async (confidence, s, ms) => {
    await booted();
    c.startWork();
    c.finishWork({ confidence });
    advance(ms - 100);
    expect(state()).toBe(s);
    advance(200);
    expect(state()).toBe("IDLE");
  });

  it("SUGGESTING holds 6 s, or a pick plays a short SUCCESS", async () => {
    await booted();
    c.startWork();
    c.finishWork({ confidence: 0.6 });
    advance(5900);
    expect(state()).toBe("SUGGESTING");
    c.suggestionPicked();
    expect(state()).toBe("SUCCESS");
    advance(1300);
    expect(state()).toBe("IDLE");
  });
});

describe("working", () => {
  it("times out into ERROR after 15 s", async () => {
    await booted();
    c.startWork();
    advance(14_900);
    expect(state()).toBe("WORKING");
    advance(200);
    expect(state()).toBe("ERROR");
  });

  it("never times out when the timeout is null (agent runs)", async () => {
    await booted();
    c.startWork({ timeoutMs: null });
    advance(60_000);
    expect(state()).toBe("WORKING");
  });

  it("a tap while working is only a wiggle", async () => {
    await booted();
    c.startWork();
    c.tap();
    expect(state()).toBe("WORKING");
  });
});

describe("touch", () => {
  it("TOUCHED returns to the previous state", async () => {
    await booted();
    c.tap();
    expect(state()).toBe("TOUCHED");
    advance(700);
    expect(state()).toBe("IDLE");
  });

  it("5 taps within 3 s go dizzy", async () => {
    await booted();
    const seen: string[] = [];
    c.onStateChange((_, to) => seen.push(to));
    for (let i = 0; i < 5; i++) {
      c.tap();
      advance(100);
    }
    expect(state()).toBe("TOUCHED");
    advance(1600);
    expect(state()).toBe("IDLE");
    expect(seen.filter((s) => s === "TOUCHED")).toHaveLength(5);
  });
});

describe("notifications", () => {
  it("interrupts WORKING and returns to it", async () => {
    await booted();
    c.startWork({ timeoutMs: null });
    c.notify();
    expect(state()).toBe("NOTIFY");
    advance(5100);
    expect(state()).toBe("WORKING");
  });

  it("a result arriving during NOTIFY waits its turn", async () => {
    await booted();
    c.startWork();
    c.notify();
    c.finishWork({ confidence: 0.9 });
    expect(state()).toBe("NOTIFY");
    c.acknowledge();
    advance(600);
    expect(state()).toBe("SUCCESS");
  });

  it("wakes a sleeping character first, then notifies", async () => {
    c.configure({ idleToSleepyMs: 1000, sleepyToSleepMs: 1000 });
    await booted();
    advance(2200);
    expect(state()).toBe("SLEEPING");
    c.notify();
    expect(state()).toBe("WAKING");
    advance(1000);
    expect(state()).toBe("NOTIFY");
  });
});

describe("sleep", () => {
  it("IDLE → SLEEPY after 45 s → SLEEPING after 15 s more", async () => {
    await booted();
    advance(44_000);
    expect(state()).toBe("IDLE");
    advance(1_200);
    expect(state()).toBe("SLEEPY");
    advance(15_100);
    expect(state()).toBe("SLEEPING");
  });

  it("activity while SLEEPY goes straight back to IDLE", async () => {
    c.configure({ idleToSleepyMs: 1000 });
    await booted();
    advance(1100);
    expect(state()).toBe("SLEEPY");
    c.activity();
    expect(state()).toBe("IDLE");
  });

  it("activity while SLEEPING wakes through WAKING", async () => {
    c.configure({ idleToSleepyMs: 1000, sleepyToSleepMs: 1000 });
    await booted();
    advance(2200);
    c.activity();
    expect(state()).toBe("WAKING");
    advance(1000);
    expect(state()).toBe("IDLE");
  });
});

describe("input focus", () => {
  it("ATTENTIVE while focused, back to IDLE 2 s after blur", async () => {
    await booted();
    c.inputFocused(true);
    expect(state()).toBe("ATTENTIVE");
    c.inputFocused(false);
    advance(1900);
    expect(state()).toBe("ATTENTIVE");
    advance(200);
    expect(state()).toBe("IDLE");
  });

  it("one-shots settle back to ATTENTIVE while the input keeps focus", async () => {
    await booted();
    c.inputFocused(true);
    c.tap();
    advance(700);
    expect(state()).toBe("ATTENTIVE");
  });
});

describe("desktop drag", () => {
  it("HELD → LANDING → back to rest", async () => {
    await booted();
    c.pickUp();
    expect(state()).toBe("HELD");
    advance(3000);
    expect(state()).toBe("HELD");
    c.drop();
    expect(state()).toBe("LANDING");
    advance(500);
    expect(state()).toBe("IDLE");
  });

  it("a notification during a drag waits for the landing", async () => {
    await booted();
    c.pickUp();
    c.notify();
    expect(state()).toBe("HELD");
    c.drop();
    advance(500);
    expect(state()).toBe("NOTIFY");
  });

  it("picking it up mid-task resumes the task afterwards", async () => {
    await booted();
    c.startWork({ timeoutMs: null });
    c.pickUp();
    c.drop();
    advance(500);
    expect(state()).toBe("WORKING");
  });
});

describe("interlude (one task done while others carry on)", () => {
  it("reacts, then goes straight back to work", async () => {
    await booted();
    c.startWork({ timeoutMs: null });
    c.interlude({ confidence: 1 });
    expect(state()).toBe("SUCCESS");
    advance(2600);
    expect(state()).toBe("WORKING");
    c.interlude({ confidence: 0, error: true });
    expect(state()).toBe("ERROR");
  });

  it("doesn't cut short a call for your attention", async () => {
    await booted();
    c.startWork({ timeoutMs: null });
    c.notify();
    c.interlude({ confidence: 1 });
    expect(state()).toBe("NOTIFY");
  });
});
