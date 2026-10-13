// Still pictures of Rui for the panel (Settings card, session tiles), made
// ahead of time by scripts/make-rui-stills.mjs: one per pose, look and colour.
// The panel never loads 3D of its own.

import type { StateName } from "../engine/types";
import { type Look, type ThemeName, isLook, isTheme } from "../three/palette";

export type RuiPose = "idle" | "work" | "call" | "droop" | "sleep";

const FILES = import.meta.glob<string>("../assets/rui/*.webp", { eager: true, query: "?url", import: "default" });

/** Rui's look and colour as last saved. */
export const ruiStyle: { look: Look; theme: ThemeName } = { look: "toy", theme: "cream" };

export function setRuiStyle(p: { ruiLook?: string; ruiTheme?: string }): void {
  if (isLook(p.ruiLook)) ruiStyle.look = p.ruiLook;
  if (isTheme(p.ruiTheme)) ruiStyle.theme = p.ruiTheme;
}

/** The picture's address, in his saved look and colour unless told otherwise. */
export function ruiPicture(pose: RuiPose, look: Look = ruiStyle.look, theme: ThemeName = ruiStyle.theme): string {
  return FILES[`../assets/rui/${pose}-${look}-${theme}.webp`] ?? FILES[`../assets/rui/${pose}-toy-cream.webp`] ?? "";
}

/** The pose for a character state (the moods a session tile shows). */
export function poseFor(state: StateName): RuiPose {
  switch (state) {
    case "WORKING": return "work";
    case "NOTIFY": return "call";
    case "ERROR": return "droop";
    case "SLEEPING":
    case "SLEEPY": return "sleep";
    default: return "idle";
  }
}
