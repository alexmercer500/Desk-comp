// The colours of every window (the character's island, the bubble, the panel,
// the Desk Companion window), from one setting (prefs.uiTheme):
//
//   character  a bright palette tinted by your character (Rui: by the colour he
//              wears, Dogesh Bhai: by his outfit)
//   system     light or dark, as Windows is
//   light      always light
//   dark       always dark (a neutral graphite)
//
// Each window calls initTheme() first thing. The colours go on <html> as CSS
// variables, with data-scheme="light|dark" for the few rules that differ by
// more than a colour. The last palette is kept in localStorage (all windows
// share it), so a window opens in the right colours before it hears from Rust.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type UiTheme = "character" | "system" | "light" | "dark";
export const UI_THEMES: Record<UiTheme, string> = { character: "Character", system: "System", light: "Light", dark: "Dark" };

type Scheme = "light" | "dark";

/** Every colour a window uses. */
interface Palette {
  surface: string;
  raised: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  code: string;
  attention: string;
  attentionBg: string;
  working: string;
  success: string;
  error: string;
  allow: string;
  allowHover: string;
  allowText: string;
  /** The Desk Companion window's sidebar. */
  side: string;
  sideActive: string;
  /** The island at the top edge, and the card inside it. */
  island: string;
  islandCard: string;
}

const LIGHT: Palette = {
  surface: "#fffdf9",
  raised: "#f6efe8",
  text: "#2a1d16",
  muted: "#6b5b51",
  faint: "#8f8077",
  border: "rgba(122, 53, 25, 0.2)",
  code: "rgba(122, 53, 25, 0.07)",
  attention: "#b8532c",
  attentionBg: "rgba(184, 83, 44, 0.09)",
  working: "#5a7fa8",
  success: "#3f8a5a",
  error: "#b4412a",
  allow: "#2f7a4b",
  allowHover: "#276a40",
  allowText: "#ffffff",
  side: "#f3e9df",
  sideActive: "rgba(122, 53, 25, 0.1)",
  island: "#fffdf9",
  islandCard: "#f6efe8",
};

const DARK: Palette = {
  surface: "#1c1d20",
  raised: "#26282c",
  text: "#eceef1",
  muted: "#b3b8bf",
  faint: "#868c94",
  border: "rgba(236, 238, 241, 0.12)",
  code: "rgba(236, 238, 241, 0.07)",
  attention: "#f0956a",
  attentionBg: "rgba(240, 149, 106, 0.13)",
  working: "#9cbde0",
  success: "#7cc796",
  error: "#ef8a72",
  allow: "#7cc796",
  allowHover: "#8fd4a7",
  allowText: "#13261a",
  side: "#17181b",
  sideActive: "rgba(236, 238, 241, 0.08)",
  island: "#121315",
  islandCard: "#1e1f22",
};

/** A light palette in one character's colours: background tints, its accent, text tuned to match. */
function tinted(t: { surface: string; raised: string; side: string; ink: string; text: string; muted: string; accent: string }): Palette {
  const rgb = hexRgb(t.ink);
  return {
    ...LIGHT,
    surface: t.surface,
    raised: t.raised,
    text: t.text,
    muted: t.muted,
    border: `rgba(${rgb}, 0.22)`,
    code: `rgba(${rgb}, 0.08)`,
    attention: t.accent,
    attentionBg: `rgba(${hexRgb(t.accent)}, 0.1)`,
    side: t.side,
    sideActive: `rgba(${rgb}, 0.11)`,
    island: t.surface,
    islandCard: t.raised,
  };
}

function hexRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** Each character's palette (Rui's by the colour he wears, Dogesh's by his outfit). Accents keep 4.5:1 on their surfaces. */
const CHARACTER: Record<string, Palette> = {
  kulhi: tinted({ surface: "#fffaf6", raised: "#fbeee6", side: "#f7e2d5", ink: "#a54b27", text: "#2a1b14", muted: "#6e5246", accent: "#a5481f" }),
  hexo: tinted({ surface: "#f8fbfd", raised: "#eaf2f8", side: "#dcebf5", ink: "#2a5c7c", text: "#14222c", muted: "#4b6170", accent: "#256590" }),
  glim: tinted({ surface: "#fbfaff", raised: "#f0ecfb", side: "#e6dff8", ink: "#5f4fa6", text: "#221c36", muted: "#5c5478", accent: "#6450b0" }),
  billu: tinted({ surface: "#fffaf3", raised: "#fdf0e0", side: "#fae3c8", ink: "#b8661f", text: "#2b1d10", muted: "#6b5440", accent: "#a2541a" }),
  "dogesh:cozy": tinted({ surface: "#fffcf2", raised: "#faf1d9", side: "#f3e5bd", ink: "#8a6a2a", text: "#2a2214", muted: "#625a44", accent: "#1f6e69" }),
  "dogesh:desi": tinted({ surface: "#fffaf4", raised: "#fdeedd", side: "#f9dfc2", ink: "#9c5426", text: "#2b1c10", muted: "#6b5442", accent: "#7a2335" }),
  "dogesh:detective": tinted({ surface: "#fdf9f5", raised: "#f3e8dc", side: "#e8d6c3", ink: "#5c3920", text: "#261911", muted: "#5f4c3f", accent: "#6e5932" }),
  "dogesh:hero": tinted({ surface: "#fdfcfb", raised: "#f4f1ee", side: "#e9e4df", ink: "#7a6a5e", text: "#221c18", muted: "#5e554e", accent: "#b0322a" }),
  "dogesh:rainy": tinted({ surface: "#f8fafc", raised: "#edf1f5", side: "#dfe5ec", ink: "#4a535f", text: "#1a1f26", muted: "#535d69", accent: "#7a5c08" }),
  "dogesh:coder": tinted({ surface: "#fffaf5", raised: "#f8ede0", side: "#efdcc6", ink: "#8f5a33", text: "#261a10", muted: "#5f4c3c", accent: "#3b4250" }),
  "dogesh:pyjamas": tinted({ surface: "#fbf9ff", raised: "#f1ebfb", side: "#e4daf6", ink: "#614698", text: "#221c36", muted: "#5c5478", accent: "#3f5fa0" }),
  "dogesh:chef": tinted({ surface: "#fffcf3", raised: "#fbf1d6", side: "#f5e3b4", ink: "#a8702a", text: "#2a2010", muted: "#625640", accent: "#a82a22" }),
  "dogesh:dapper": tinted({ surface: "#fdf8f5", raised: "#f5e8e0", side: "#ecd6c9", ink: "#6b3520", text: "#27160f", muted: "#604a40", accent: "#2f5e3c" }),
  "rui:cream": tinted({ surface: "#fffcf6", raised: "#f8f0e2", side: "#f1e4cf", ink: "#9a6b3a", text: "#2a2016", muted: "#665848", accent: "#8a5a2b" }),
  "rui:mint": tinted({ surface: "#f7fcf9", raised: "#e7f5ed", side: "#d4eee0", ink: "#3f8a68", text: "#15261d", muted: "#4c6458", accent: "#2b7253" }),
  "rui:sky": tinted({ surface: "#f7fbff", raised: "#e6f0fc", side: "#d3e5f9", ink: "#3a72ad", text: "#14202e", muted: "#4b5e72", accent: "#2a65a3" }),
  "rui:lavender": tinted({ surface: "#fbf9ff", raised: "#efe9fb", side: "#e1d7f6", ink: "#6a55b8", text: "#221c36", muted: "#5c5478", accent: "#6450b0" }),
  "rui:peach": tinted({ surface: "#fff9f9", raised: "#fdeaea", side: "#f9d8da", ink: "#b04a5c", text: "#2e1a1d", muted: "#6c5054", accent: "#a63f52" }),
  "rui:panda": tinted({ surface: "#fbfbfa", raised: "#f0efed", side: "#e4e2df", ink: "#3b3637", text: "#1e1c1c", muted: "#5b5657", accent: "#3b3637" }),
};

interface ThemePrefs {
  uiTheme?: string;
  character?: string;
  ruiTheme?: string;
  dogeshOutfit?: string;
}

const darkOs = window.matchMedia("(prefers-color-scheme: dark)");
let latest: ThemePrefs = {};

/** The palette and scheme these prefs mean, right now. */
function resolve(p: ThemePrefs): { scheme: Scheme; palette: Palette } {
  const theme = (p.uiTheme ?? "character") as UiTheme;
  if (theme === "character") {
    const key =
      p.character === "rui" ? `rui:${p.ruiTheme ?? "cream"}`
      : p.character === "dogesh" ? `dogesh:${p.dogeshOutfit ?? "cozy"}`
      : (p.character ?? "kulhi");
    return { scheme: "light", palette: CHARACTER[key] ?? LIGHT };
  }
  const dark = theme === "dark" || (theme === "system" && darkOs.matches);
  return { scheme: dark ? "dark" : "light", palette: dark ? DARK : LIGHT };
}

const CACHE = "desk-companion-theme";

function paint(scheme: Scheme, palette: Palette) {
  const root = document.documentElement;
  root.dataset.scheme = scheme;
  root.style.colorScheme = scheme;
  for (const [key, value] of Object.entries(palette)) {
    root.style.setProperty(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value);
  }
  // The names some windows use for the same colours.
  root.style.setProperty("--card", palette.surface);
  root.style.setProperty("--ink", palette.text);
  root.style.setProperty("--line", palette.border);
  root.style.setProperty("--info", palette.working);
}

function apply(p: ThemePrefs) {
  latest = { ...latest, ...p };
  const { scheme, palette } = resolve(latest);
  paint(scheme, palette);
  try {
    localStorage.setItem(CACHE, JSON.stringify({ scheme, palette }));
  } catch {
    // No storage (private mode): the colours just arrive a moment later next time.
  }
}

let started = false;

/** Colours this window as the setting says, and keeps them so. Call once, first thing. */
export function initTheme(): void {
  if (started) return;
  started = true;
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE) ?? "null") as { scheme: Scheme; palette: Palette } | null;
    if (cached?.palette) paint(cached.scheme, cached.palette);
  } catch {
    // Nothing kept yet.
  }
  void invoke<ThemePrefs>("get_prefs").then(apply, () => apply({}));
  void listen<ThemePrefs>("prefs", ({ payload }) => apply(payload));
  darkOs.addEventListener("change", () => apply({}));
}
