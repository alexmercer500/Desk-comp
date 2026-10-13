import { describe, expect, it } from "vitest";
import { plainText } from "../src/desktop/format";

describe("plainText", () => {
  it("drops markdown markup but keeps the words", () => {
    const md = [
      "## Summary",
      "There are two places: **notifications** and the *Activity window*.",
      "",
      "- Uses `npm test` — see [the docs](https://example.com)",
      "| A | B |",
      "|---|:-:|",
      "```ts",
      "const x = 2 * 3 * 4;",
      "```",
    ].join("\n");
    expect(plainText(md)).toBe(
      [
        "Summary",
        "There are two places: notifications and the Activity window.",
        "",
        "• Uses npm test — see the docs",
        "| A | B |",
        "",
        "const x = 2 * 3 * 4;",
      ].join("\n"),
    );
  });

  it("leaves plain text alone", () => {
    expect(plainText("Fixed the cart total: 0.1 + 0.2 now shows 0.30.")).toBe("Fixed the cart total: 0.1 + 0.2 now shows 0.30.");
  });
});
