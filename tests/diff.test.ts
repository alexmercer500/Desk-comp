import { describe, expect, it } from "vitest";
import { addToChange, diffText, MAX_KEPT_LINES, type Change } from "../src/desktop/diff";

describe("diffText", () => {
  it("counts a one-line change as one removed and one added", () => {
    const d = diffText("a\nb\nc", "a\nB\nc");
    expect([d.add, d.del]).toEqual([1, 1]);
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0].map((l) => l.t + l.s)).toEqual([" a", "-b", "+B", " c"]);
  });

  it("treats a whole-file write (no old text) as all added", () => {
    const d = diffText(null, "x\ny\nz");
    expect([d.add, d.del]).toEqual([3, 0]);
  });

  it("finds nothing in identical text", () => {
    const d = diffText("same\ntext", "same\ntext");
    expect([d.add, d.del, d.hunks.length]).toEqual([0, 0, 0]);
  });

  it("keeps three lines of context and splits distant changes into hunks", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 2\n", "line 2 changed\n").replace("line 25\n", "line 25 changed\n");
    const d = diffText(before, after);
    expect([d.add, d.del]).toEqual([2, 2]);
    expect(d.hunks).toHaveLength(2);
    expect(d.hunks[0].length).toBe(7); // 2 lines before (start of file) + removed + added + 3 after
  });

  it("handles Windows line endings", () => {
    const d = diffText("a\r\nb\r\n", "a\r\nc\r\n");
    expect([d.add, d.del]).toEqual([1, 1]);
  });

  it("counts a huge change without comparing line by line", () => {
    const big = (p: string) => Array.from({ length: 3000 }, (_, i) => `${p}${i}`).join("\n");
    const d = diffText(big("a"), big("b"));
    expect([d.add, d.del]).toEqual([3000, 3000]);
    expect(d.hunks).toEqual([]);
    expect(d.truncated).toBe(true);
  });

  it("clips very long lines", () => {
    const d = diffText("x", "y".repeat(1000));
    expect(d.hunks[0].find((l) => l.t === "+")!.s.length).toBe(300);
  });

  it("stops keeping lines after the limit but still counts them", () => {
    const text = Array.from({ length: 900 }, (_, i) => `n${i}`).join("\n");
    const d = diffText(null, text);
    expect(d.add).toBe(900);
    expect(d.hunks.flat().length).toBe(MAX_KEPT_LINES);
    expect(d.truncated).toBe(true);
  });
});

describe("addToChange", () => {
  it("adds several edits of one file together", () => {
    const c: Change = { path: "a.ts", add: 0, del: 0, hunks: [] };
    addToChange(c, diffText("a", "b"));
    addToChange(c, diffText("c\nd", "c\nd\ne"));
    expect([c.add, c.del, c.hunks.length]).toEqual([2, 1, 2]);
  });
});
