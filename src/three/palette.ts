// Rui's looks and colour themes as plain data, with no three.js: the Settings
// panel and the tray pictures use these without loading anything 3D. The
// materials that use them live in looks.ts.

export type Look = "toy" | "anime";
export type ThemeName = "cream" | "mint" | "sky" | "lavender" | "peach" | "panda";

/** Parts whose colour comes from the theme. */
export type Part = "shell" | "limb" | "ear" | "curl" | "rim" | "earInner";

export interface Swatch {
  color: string;
  /** Colour on the shaded side, for the anime look. */
  shade: string;
}

export interface Theme {
  label: string;
  parts: Record<Part, Swatch>;
}

export const LOOKS: Record<Look, string> = { toy: "Toy", anime: "Anime" };
export const LOOK_NAMES = Object.keys(LOOKS) as Look[];

/** Bare skin (face plate, inner ears): the same in every theme. */
export const SKIN: Swatch = { color: "#f8d9c5", shade: "#eab19b" };

/** A theme where the whole body is one colour, with a deeper hood rim. */
function solid(label: string, body: Swatch, rim: Swatch, earInner: Swatch = SKIN): Theme {
  return { label, parts: { shell: body, limb: body, ear: body, curl: body, rim, earInner } };
}

export const THEMES: Record<ThemeName, Theme> = {
  cream: solid("Cream", { color: "#f0e0c8", shade: "#d4b597" }, { color: "#e6d0b2", shade: "#c4a282" }),
  mint: solid("Mint", { color: "#c4ead6", shade: "#8fc5ab" }, { color: "#a9dcc2", shade: "#76b296" }),
  sky: solid("Sky blue", { color: "#c3defa", shade: "#8eb6dd" }, { color: "#a7cbef", shade: "#7aa0cc" }),
  lavender: solid("Lavender", { color: "#ddd0f4", shade: "#ad9dd4" }, { color: "#c9b8ec", shade: "#9886c6" }),
  peach: solid("Peach pink", { color: "#fbd3d3", shade: "#dda3a6" }, { color: "#f4bcc0", shade: "#cf8e95" }),
  panda: {
    label: "Panda",
    parts: {
      shell: { color: "#f7f5f1", shade: "#d0cbc5" },
      limb: { color: "#3b3637", shade: "#232021" },
      ear: { color: "#3b3637", shade: "#232021" },
      curl: { color: "#3b3637", shade: "#232021" },
      rim: { color: "#3b3637", shade: "#232021" },
      earInner: { color: "#6a6162", shade: "#4a4243" },
    },
  },
};
export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

export const isLook = (v: unknown): v is Look => typeof v === "string" && v in LOOKS;
export const isTheme = (v: unknown): v is ThemeName => typeof v === "string" && v in THEMES;

/** A theme's main colours, for swatches. */
export function themeColors(name: ThemeName): { body: string; accent: string } {
  const p = THEMES[name].parts;
  return { body: p.shell.color, accent: p.limb.color === p.shell.color ? p.rim.color : p.limb.color };
}
