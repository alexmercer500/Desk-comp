// Dogesh Bhai's outfits, picked in Settings like Rui's colours. Each outfit
// is his clothes and the fur he wears them in (an outfit is a whole look).
// Plain data with no three.js: the 2D drawing (skins/dogesh.ts), the 3D
// materials (three/dogesh.ts, three/looks.ts), the Settings picker and the
// Character theme (theme.ts) all read it. Never pink fur: he's his own dog.

export type OutfitName = "cozy" | "desi" | "detective" | "hero" | "rainy" | "coder" | "pyjamas" | "chef" | "dapper";

/** A colour, and the same on the shaded side (2D shading and the 3D anime look). */
export interface Tone {
  color: string;
  shade: string;
}

/** His fur, ears and face bits (names as in skins/dogesh.ts). */
export interface Fur {
  fur: Tone;
  /** Lit edge of the fur (2D). */
  furLight: string;
  /** Muzzle, tummy and paws. */
  pale: Tone;
  /** Outline (2D) and the darkest face bits. */
  line: string;
  ear: Tone;
  earTip: Tone;
  brow: Tone;
  freckle: Tone;
}

export interface Outfit {
  label: string;
  /** One line for Settings. */
  blurb: string;
  fur: Fur;
  /** The clothes' colours, by name (each outfit names its own parts). */
  cloth: Record<string, Tone>;
}

function fur(f: {
  fur: string; furShade: string; furLight: string; pale: string; paleShade: string; line: string;
  ear: string; earShade: string; earTip: string; earTipShade: string; brow: string; freckle: string;
}): Fur {
  return {
    fur: { color: f.fur, shade: f.furShade },
    furLight: f.furLight,
    pale: { color: f.pale, shade: f.paleShade },
    line: f.line,
    ear: { color: f.ear, shade: f.earShade },
    earTip: { color: f.earTip, shade: f.earTipShade },
    brow: { color: f.brow, shade: f.line },
    freckle: { color: f.freckle, shade: f.freckle },
  };
}

const t = (color: string, shade: string): Tone => ({ color, shade });

/** The furs the outfits come in. */
const FURS = {
  butter: fur({
    fur: "#F3DFA8", furShade: "#DCC07F", furLight: "#FBEFCB", pale: "#FFF6DC", paleShade: "#ECDCB4", line: "#6E4C28",
    ear: "#C98A4B", earShade: "#A86B33", earTip: "#8E5A28", earTipShade: "#6C421B", brow: "#7A4E26", freckle: "#B57A45",
  }),
  ginger: fur({
    fur: "#EBA968", furShade: "#CC8848", furLight: "#F6CB98", pale: "#FDEBD3", paleShade: "#EBCFA8", line: "#6A3A18",
    ear: "#9C5426", earShade: "#7C3F1A", earTip: "#64320F", earTipShade: "#4A240A", brow: "#5E3416", freckle: "#A85F2C",
  }),
  cocoa: fur({
    fur: "#A97A55", furShade: "#876041", furLight: "#C49A75", pale: "#F0DCC2", paleShade: "#D7BC9A", line: "#3E2616",
    ear: "#5C3920", earShade: "#45291A", earTip: "#3C2414", earTipShade: "#2A180D", brow: "#3A2212", freckle: "#6E4A2E",
  }),
  snow: fur({
    fur: "#F2EFEA", furShade: "#D9D3CA", furLight: "#FAF8F5", pale: "#FFFFFF", paleShade: "#E6E2DC", line: "#5A4E46",
    ear: "#A68F7E", earShade: "#887262", earTip: "#75604F", earTipShade: "#5A4839", brow: "#5A4E46", freckle: "#B8A596",
  }),
  slate: fur({
    fur: "#BAC3CD", furShade: "#98A3B0", furLight: "#D7DDE4", pale: "#F3F5F8", paleShade: "#D8DEE5", line: "#3F4752",
    ear: "#6F7A88", earShade: "#57616E", earTip: "#4A535F", earTipShade: "#363D47", brow: "#3E4650", freckle: "#8A94A1",
  }),
  peanut: fur({
    fur: "#D9AE84", furShade: "#BC8F63", furLight: "#E8C8A6", pale: "#F8E9D6", paleShade: "#E3CDB0", line: "#5E3A1E",
    ear: "#8F5A33", earShade: "#714526", earTip: "#5F3A1F", earTipShade: "#472A15", brow: "#5A361C", freckle: "#A87750",
  }),
  lilac: fur({
    fur: "#D3C3EE", furShade: "#B19ED6", furLight: "#E6DCF7", pale: "#F8F4FE", paleShade: "#E1D6F3", line: "#4A3570",
    ear: "#8A6CC2", earShade: "#6E52A4", earTip: "#614698", earTipShade: "#48337A", brow: "#4A3570", freckle: "#9A82C8",
  }),
  honey: fur({
    fur: "#E8BE5C", furShade: "#C99D3E", furLight: "#F3D68E", pale: "#FCF0CF", paleShade: "#EBD7A3", line: "#6A4A16",
    ear: "#A8702A", earShade: "#87561C", earTip: "#6E4612", earTipShade: "#52330B", brow: "#5F4214", freckle: "#B07E35",
  }),
  chestnut: fur({
    fur: "#A9603F", furShade: "#884A30", furLight: "#C47E5D", pale: "#F1D7C2", paleShade: "#D9B89E", line: "#3F2114",
    ear: "#6B3520", earShade: "#522817", earTip: "#4A2313", earTipShade: "#35180C", brow: "#3F2114", freckle: "#7A4129",
  }),
};

export const OUTFITS: Record<OutfitName, Outfit> = {
  // His first look: butter fur and the long teal scarf he's still knitting.
  cozy: {
    label: "Cozy scarf",
    blurb: "His long teal scarf. He's still knitting it.",
    fur: FURS.butter,
    cloth: {
      scarf: t("#2F8F8A", "#21706B"),
      stripe: t("#7CC3B9", "#5AA59A"),
      scarfDark: t("#1E6965", "#16504D"),
      /** Stripes "knitted up" while an agent works. */
      done: t("#F6C85F", "#D9A93E"),
    },
  },
  desi: {
    label: "Desi Bhai",
    blurb: "Kurta, Nehru jacket and a cap, ready for any function.",
    fur: FURS.ginger,
    cloth: {
      kurta: t("#F6EFDF", "#DCCFB4"),
      jacket: t("#7A2335", "#5C1726"),
      /** Buttons and the jacket's edging. */
      gold: t("#D9A93E", "#B08427"),
      cap: t("#7A2335", "#5C1726"),
    },
  },
  detective: {
    label: "Detective",
    blurb: "Trench coat, deerstalker and a magnifying glass. Scared of every clue.",
    fur: FURS.cocoa,
    cloth: {
      coat: t("#C8A96B", "#A68A50"),
      /** Lapels, belt and cuffs. */
      coatDark: t("#8E7443", "#6E5932"),
      hat: t("#8B6A45", "#6A5033"),
      /** The deerstalker's check. */
      check: t("#5E4630", "#46331F"),
      lens: t("#CFE8F2", "#9CC7D8"),
      brass: t("#C9A04A", "#A07C32"),
      /** The magnifying glass's wooden handle (2D). */
      handle: t("#6B4526", "#4F321B"),
    },
  },
  hero: {
    label: "Superhero",
    blurb: "A cape and a mask: brave for you.",
    fur: FURS.snow,
    cloth: {
      cape: t("#D2392F", "#A82A22"),
      capeInside: t("#9E2A23", "#7C1F19"),
      mask: t("#22252B", "#111317"),
      /** The badge on his chest (a lightning bolt). */
      emblem: t("#F2C230", "#C99B1D"),
    },
  },
  rainy: {
    label: "Rainy day",
    blurb: "Raincoat, rain hat and boots.",
    fur: FURS.slate,
    cloth: {
      coat: t("#F2C230", "#CDA01E"),
      /** Buttons, seams and the hat's brim edge. */
      coatDark: t("#C99B1D", "#A27C12"),
      hat: t("#F2C230", "#CDA01E"),
      boots: t("#E2513C", "#B83D2C"),
    },
  },
  coder: {
    label: "Coder Bhai",
    blurb: "Hoodie, headphones and glasses.",
    fur: FURS.peanut,
    cloth: {
      hoodie: t("#3B4250", "#2A2F3A"),
      /** Cuffs, pocket and drawstrings. */
      hoodieLight: t("#5A6375", "#454C5C"),
      logo: t("#F08A3C", "#C96D27"),
      phones: t("#2F8F8A", "#21706B"),
      frames: t("#22252B", "#111317"),
      lens: t("#DDEFF7", "#B9D6E3"),
      /** The little laptop he types on while working (2D). */
      laptop: t("#B9C0CC", "#959DAB"),
    },
  },
  pyjamas: {
    label: "Pyjamas",
    blurb: "Stripes and a floppy nightcap.",
    fur: FURS.lilac,
    cloth: {
      pj: t("#5B7FC7", "#4566A8"),
      stripe: t("#F4F6FB", "#D4D9E6"),
      cap: t("#5B7FC7", "#4566A8"),
      pom: t("#FFFFFF", "#E0E3EA"),
    },
  },
  chef: {
    label: "Chef",
    blurb: "An apron and a tall chef's hat.",
    fur: FURS.honey,
    cloth: {
      apron: t("#FFFFFF", "#E3E5EA"),
      hat: t("#FFFFFF", "#E3E5EA"),
      neckerchief: t("#D2392F", "#A82A22"),
      /** The frying pan he hides behind, and its handle. */
      pan: t("#3A3D44", "#24262B"),
      panHandle: t("#3A2A20", "#24190F"),
    },
  },
  dapper: {
    label: "Dapper",
    blurb: "Sweater vest, bow tie and a flat cap.",
    fur: FURS.chestnut,
    cloth: {
      vest: t("#3F7A4F", "#2F5E3C"),
      /** The vest's argyle diamonds. */
      argyle: t("#6FA57D", "#55885F"),
      bow: t("#C8342C", "#A02820"),
      cap: t("#7D7468", "#5F574D"),
      capCheck: t("#5F574D", "#463F37"),
      /** The shirt under the vest: sleeves and collar (2D). */
      shirt: t("#F4EEDF", "#DCD3BF"),
    },
  },
};

export const OUTFIT_NAMES = Object.keys(OUTFITS) as OutfitName[];
export const isOutfit = (v: unknown): v is OutfitName => typeof v === "string" && v in OUTFITS;
