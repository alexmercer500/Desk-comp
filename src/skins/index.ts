import type { CharacterId, Skin } from "../engine/types";
import { billu } from "./billu";
import { dogesh } from "./dogesh";
import { glim } from "./glim";
import { hexo } from "./hexo";
import { kulhi } from "./kulhi";

export const SKINS: Record<CharacterId, Skin> = { kulhi, hexo, glim, billu, dogesh };

export const CHARACTER_NAMES: Record<CharacterId, string> = { kulhi: "Kulhi", hexo: "Hexo", glim: "Glim", billu: "Billu", dogesh: "Dogesh Bhai" };

export const isCharacter = (id: string): id is CharacterId => id in SKINS;
