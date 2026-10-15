// Every character, every state, many moments: every pose channel must be a
// real number. (A single NaN makes a character vanish mid-animation.)

import { beforeAll, describe, expect, it } from "vitest";
import type { PoseInput, Skin, StateName, Variant } from "../src/engine/types";

// Skins build Path2D shapes when they load; Node has no canvas, so stub it.
beforeAll(() => {
  (globalThis as Record<string, unknown>).Path2D ??= class {
    moveTo() {}
    lineTo() {}
    arc() {}
    arcTo() {}
    ellipse() {}
    quadraticCurveTo() {}
    bezierCurveTo() {}
    closePath() {}
  };
});

const STATES: [StateName, Variant][] = [
  ["OFF", null], ["BOOTING", null], ["IDLE", null], ["ATTENTIVE", null], ["TOUCHED", null],
  ["TOUCHED", "dizzy"], ["WORKING", null], ["SUCCESS", null], ["SUCCESS", "short"], ["SUGGESTING", null],
  ["CONFUSED", null], ["ERROR", null], ["NOTIFY", null], ["NOTIFY", "ack"], ["SLEEPY", null],
  ["SLEEPING", null], ["WAKING", null], ["HELD", null], ["LANDING", null],
];
const MOMENTS = [0, 16, 90, 150, 300, 450, 700, 1200, 1500, 2100, 2600, 5300, 9100];

describe.each(["kulhi", "hexo", "glim", "billu", "dogesh"])("%s", (name) => {
  let skin: Skin;
  beforeAll(async () => {
    skin = (await import("../src/skins"))["SKINS"][name as "kulhi"];
  });

  it("has every engine channel at rest", () => {
    for (const key of ["lift", "bodyX", "bodyRot", "sx", "sy", "fade", "eyeOpen", "blink", "gazeLock", "gazeLockX", "gazeLockY"]) {
      expect(typeof skin.rest[key], key).toBe("number");
    }
  });

  it.each(STATES)("%s %s stays finite", (state, variant) => {
    for (const st of MOMENTS) {
      for (const motion of [1, 0]) {
        const input: PoseInput = {
          state, variant, st, t: st / 1000 + 3.7, motion,
          progress: st % 2 ? 0.4 : null, carryX: 800, carryY: -200,
        };
        const out = skin.pose(input);
        expect(typeof out.eye).toBe("string");
        for (const [key, value] of Object.entries(out.pose)) {
          expect(Number.isFinite(value), `${state} ${variant} @${st}ms ${key}=${value}`).toBe(true);
          expect(key in skin.rest, `${key} missing from rest`).toBe(true);
        }
      }
    }
  });
});
