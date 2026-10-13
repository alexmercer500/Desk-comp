import { describe, expect, it } from "vitest";
import { ClickGuard, GUARD_MS } from "../src/bubble/guard";

describe("ClickGuard", () => {
  it("ignores clicks until the card has been up for a moment", () => {
    let t = 1000;
    const g = new ClickGuard(() => t);
    g.arm("r1");
    expect(g.ready("r1")).toBe(false);
    t += GUARD_MS - 1;
    expect(g.ready("r1")).toBe(false);
    t += 1;
    expect(g.ready("r1")).toBe(true);
  });

  it("never counts a click for a card it hasn't seen", () => {
    const g = new ClickGuard(() => 99_999);
    expect(g.ready("unknown")).toBe(false);
  });

  it("re-arms when a card comes back on screen, but armOnce doesn't", () => {
    let t = 0;
    const g = new ClickGuard(() => t);
    g.arm("r1");
    t = 5000;
    g.armOnce("r1");
    expect(g.ready("r1")).toBe(true);
    g.arm("r1");
    expect(g.ready("r1")).toBe(false);
  });

  it("starts over after a reset", () => {
    let t = 0;
    const g = new ClickGuard(() => t);
    g.arm("r1");
    t = 5000;
    g.reset();
    g.armOnce("r1");
    expect(g.ready("r1")).toBe(false);
  });
});
