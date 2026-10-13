import { describe, expect, it } from "vitest";
import { answerFor } from "../src/bubble/question";
import type { Question } from "../src/bubble/types";

const q = (multiSelect: boolean): Question => ({
  question: "Which?",
  multiSelect,
  options: [{ label: "React" }, { label: "Vue" }, { label: "Svelte" }],
});

describe("answerFor", () => {
  it("lists picked options in the order they were offered", () => {
    expect(answerFor(q(true), new Set(["Svelte", "React"]), null)).toBe("React, Svelte");
  });

  it("uses typed text on its own", () => {
    expect(answerFor(q(false), new Set(), "  Solid, please  ")).toBe("Solid, please");
  });

  it("adds typed text after the picked options when more than one answer is allowed", () => {
    expect(answerFor(q(true), new Set(["Vue"]), "Solid")).toBe("Vue, Solid");
  });

  it("ignores empty or blank typed text", () => {
    expect(answerFor(q(true), new Set(["Vue"]), "   ")).toBe("Vue");
    expect(answerFor(q(false), new Set(), "")).toBe("");
  });
});
