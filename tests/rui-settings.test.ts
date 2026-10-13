// Rui's look and colour settings: the same choices everywhere (the panel, the
// Rust side that checks and saves them, the tray), and a picture for each.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { poseFor, ruiPicture, setRuiStyle, ruiStyle, type RuiPose } from "../src/panel/rui-pictures";
import { LOOK_NAMES, THEME_NAMES, isLook, isTheme } from "../src/three/palette";

const rust = (file: string) => readFileSync(new URL(`../src-tauri/src/${file}`, import.meta.url), "utf8");
/** The strings in a Rust `&[&str]` constant. */
function rustList(source: string, name: string): string[] {
  const m = source.match(new RegExp(`const ${name}: &\\[&str\\] = &\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`${name} not found`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}
/** The ids in a Rust `&[(&str, &str)]` constant (menu names). */
function rustIds(source: string, name: string): string[] {
  const m = source.match(new RegExp(`const ${name}: &\\[\\(&str, &str\\)\\] = &\\[([^;]*)\\];`));
  if (!m) throw new Error(`${name} not found`);
  return [...m[1].matchAll(/\("([^"]+)",/g)].map((x) => x[1]);
}

describe("Rui's choices", () => {
  it("are the same in the panel, the saved settings and the tray", () => {
    const system = rust("system.rs");
    const tray = rust("tray.rs");
    expect(rustList(system, "RUI_LOOKS")).toEqual(LOOK_NAMES);
    expect(rustList(system, "RUI_THEMES")).toEqual(THEME_NAMES);
    expect(rustIds(tray, "RUI_LOOK_NAMES")).toEqual(LOOK_NAMES);
    expect(rustIds(tray, "RUI_THEME_NAMES")).toEqual(THEME_NAMES);
  });

  it("start as the toy look in cream", () => {
    const system = rust("system.rs");
    expect(system).toContain('rui_look: "toy".into()');
    expect(system).toContain('rui_theme: "cream".into()');
  });

  it("only accept known values", () => {
    expect(isLook("anime")).toBe(true);
    expect(isLook("clay")).toBe(false);
    expect(isTheme("panda")).toBe(true);
    expect(isTheme(undefined)).toBe(false);
  });
});

describe("Rui's pictures", () => {
  const poses: RuiPose[] = ["idle", "work", "call", "droop", "sleep"];

  it("exist for every pose, look and colour", () => {
    for (const pose of poses) {
      for (const look of LOOK_NAMES) {
        for (const theme of THEME_NAMES) {
          expect(ruiPicture(pose, look, theme), `${pose}-${look}-${theme}`).toMatch(/\.webp|^data:image\/webp/);
        }
      }
    }
    // Every combination is its own picture.
    const all = new Set(poses.flatMap((p) => LOOK_NAMES.flatMap((l) => THEME_NAMES.map((t) => ruiPicture(p, l, t)))));
    expect(all.size).toBe(poses.length * LOOK_NAMES.length * THEME_NAMES.length);
  });

  it("follow the saved look and colour, ignoring unknown ones", () => {
    setRuiStyle({ ruiLook: "anime", ruiTheme: "mint" });
    expect(ruiPicture("idle")).toBe(ruiPicture("idle", "anime", "mint"));
    setRuiStyle({ ruiLook: "clay", ruiTheme: "tartan" });
    expect(ruiStyle).toEqual({ look: "anime", theme: "mint" });
    setRuiStyle({ ruiLook: "toy", ruiTheme: "cream" });
  });

  it("show a session's mood", () => {
    expect(poseFor("WORKING")).toBe("work");
    expect(poseFor("NOTIFY")).toBe("call");
    expect(poseFor("ERROR")).toBe("droop");
    expect(poseFor("SLEEPING")).toBe("sleep");
    expect(poseFor("IDLE")).toBe("idle");
  });
});
