// Rui (3D) in the desktop app: which behaviour each character state cues.

import { describe, expect, it } from "vitest";
import type { StateName } from "../src/engine/types";
import { cueFor } from "../src/three/stage";

describe("Rui's behaviour for each state", () => {
  it("covers the agent flow", () => {
    expect(cueFor("WORKING", null)).toBe("work");
    expect(cueFor("SUCCESS", null)).toBe("hooray");
    expect(cueFor("NOTIFY", null)).toBe("call");
    expect(cueFor("ERROR", null)).toBe("droop");
  });

  it("tells variants apart", () => {
    expect(cueFor("SUCCESS", "short")).toBe("nod");
    expect(cueFor("NOTIFY", "ack")).toBe("nod");
    expect(cueFor("TOUCHED", "dizzy")).toBe("dizzy");
    expect(cueFor("TOUCHED", null)).toBeNull();
  });

  it("dozes off, sleeps, and wakes like the 2D characters", () => {
    expect(cueFor("SLEEPY", null)).toBe("doze");
    expect(cueFor("SLEEPING", null)).toBe("sleep");
    expect(cueFor("WAKING", null)).toBe("wake");
    expect(cueFor("OFF", null)).toBe("rest");
    expect(cueFor("BOOTING", null)).toBe("boot");
  });

  it("dangles while dragged and lands when dropped", () => {
    expect(cueFor("HELD", null)).toBe("held");
    expect(cueFor("LANDING", null)).toBe("land");
  });

  it("leaves resting states to the stage", () => {
    const resting: StateName[] = ["IDLE", "ATTENTIVE"];
    for (const s of resting) expect(cueFor(s, null)).toBeNull();
  });
});
