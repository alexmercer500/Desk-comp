import type { CharacterId, Skin } from "../engine/types";
import { billu } from "./billu";
import { custom, setCustomShape } from "./custom";
import { dogesh } from "./dogesh";
import { glim } from "./glim";
import { hexo } from "./hexo";
import { kulhi } from "./kulhi";

export const SKINS: Record<CharacterId, Skin> = { kulhi, hexo, glim, billu, dogesh, custom };

/** Names as shown. Your own character's is yours (applyCustomPrefs). */
export const CHARACTER_NAMES: Record<CharacterId, string> = { kulhi: "Kulhi", hexo: "Hexo", glim: "Glim", billu: "Billu", dogesh: "Dogesh Bhai", custom: "My character" };

export const isCharacter = (id: string): id is CharacterId => id in SKINS;

/** Your own character's name and shape, from the settings. */
export function applyCustomPrefs(p: { customName?: string; customShape?: string }) {
  if (p.customName) CHARACTER_NAMES.custom = p.customName;
  setCustomShape(p.customShape);
}
