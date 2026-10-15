// Two ways to draw the same model:
//   toy   – soft vinyl and glossy plastic, lit by a studio environment with real
//           shadows (think a collectible figure, or Astro Bot)
//   anime – flat cel shading with a crisp light/shade edge, a rim of light and
//           ink outlines (think Genshin)
// Each mesh is tagged with what it's made of; `paint` swaps every material.
//
// Colour themes recolour the body parts. A new theme can be "painted on": the
// new colour spreads out from a point over the body, like wet paint.

import * as THREE from "three";

import { type Look, type Part, type Swatch, type ThemeName, SKIN, THEMES } from "./palette";

export { type Look, type ThemeName, THEMES, THEME_NAMES, themeColors } from "./palette";

export type Surface =
  | Part
  | "skin" | "ink" | "mouth" | "inner" | "dough" | "choc" | "sweat"
  | "wood" | "metal" | "bristle" | "gloss"
  /** Dogesh: butter-cream fur, pale muzzle and tummy, caramel ears, cocoa nose, his eyes and face bits. */
  | "fur" | "furPale" | "dogEar" | "dogEarTip" | "nose" | "sclera" | "pupil" | "brow" | "freckle" | "tongue" | "teeth"
  /** Knitted wool in teal with lighter stripes (his scarf): stripes run across the geometry's u. */
  | "knit"
  /** Magic: see-through ghostly stuff with a glowing rim, and things that glow (both looks alike). */
  | "ghost" | "glow";

interface Finish {
  rough: number;
  coat?: number;
  sheen?: number;
  metal?: number;
  /** Strength of the crisp anime highlight. */
  spec?: number;
}

const FINISH: Record<Surface, Finish> = {
  shell: { rough: 0.5, coat: 0.45, sheen: 0.6 },
  limb: { rough: 0.5, coat: 0.45, sheen: 0.6 },
  ear: { rough: 0.5, coat: 0.45, sheen: 0.6 },
  curl: { rough: 0.5, coat: 0.45, sheen: 0.6 },
  rim: { rough: 0.55, coat: 0.3, sheen: 0.5 },
  earInner: { rough: 0.42, coat: 0.3, sheen: 0.4 },
  skin: { rough: 0.42, coat: 0.3, sheen: 0.4 },
  ink: { rough: 0.06, coat: 1, spec: 1 },
  mouth: { rough: 0.4 },
  inner: { rough: 0.6 },
  dough: { rough: 0.75, sheen: 0.3 },
  choc: { rough: 0.35, coat: 0.6, spec: 0.5 },
  sweat: { rough: 0.05, coat: 1, spec: 1 },
  wood: { rough: 0.55, coat: 0.5, spec: 0.25 },
  metal: { rough: 0.25, metal: 1, spec: 0.8 },
  bristle: { rough: 0.7, sheen: 0.5 },
  gloss: { rough: 0.15, coat: 1, spec: 0.7 },
  fur: { rough: 0.55, coat: 0.35, sheen: 0.7 },
  furPale: { rough: 0.5, coat: 0.3, sheen: 0.5 },
  dogEar: { rough: 0.5, coat: 0.4, sheen: 0.6 },
  dogEarTip: { rough: 0.5, coat: 0.4, sheen: 0.6 },
  nose: { rough: 0.1, coat: 1, spec: 1 },
  sclera: { rough: 0.22, coat: 0.7, spec: 0.35 },
  pupil: { rough: 0.06, coat: 1, spec: 1 },
  brow: { rough: 0.5, coat: 0.3 },
  freckle: { rough: 0.5 },
  tongue: { rough: 0.35, coat: 0.6, spec: 0.3 },
  teeth: { rough: 0.25, coat: 0.6, spec: 0.3 },
  knit: { rough: 0.92, sheen: 1 },
  ghost: { rough: 1 },
  glow: { rough: 1 },
};

/** Dogesh's scarf: teal wool, and its lighter stripes. */
const SCARF: Swatch = { color: "#2f8f8a", shade: "#21706b" };
const SCARF_STRIPE: Swatch = { color: "#7cc3b9", shade: "#5aa59a" };
/** Where the stripes fall along one repeat of the knit's u (0..1): light from STRIPE[0] to STRIPE[1]. */
const STRIPE = [0.56, 0.84];

let knitTextures: { map: THREE.Texture; bump: THREE.Texture } | null = null;

/** The stripes (colour), and knitted stitches (a bump map of little Vs), for the toy look. */
function knitMaps(): { map: THREE.Texture; bump: THREE.Texture } {
  if (knitTextures) return knitTextures;
  const stripes = document.createElement("canvas");
  stripes.width = 64;
  stripes.height = 4;
  const g = stripes.getContext("2d")!;
  g.fillStyle = SCARF.color;
  g.fillRect(0, 0, 64, 4);
  g.fillStyle = SCARF_STRIPE.color;
  g.fillRect(Math.round(STRIPE[0] * 64), 0, Math.round((STRIPE[1] - STRIPE[0]) * 64), 4);
  const map = new THREE.CanvasTexture(stripes);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;

  // One stitch per tile: a "V" of two plump loops, lit from the middle of each loop.
  const st = document.createElement("canvas");
  st.width = st.height = 32;
  const b = st.getContext("2d")!;
  b.fillStyle = "#000";
  b.fillRect(0, 0, 32, 32);
  for (const side of [-1, 1]) {
    const grad = b.createRadialGradient(16 + side * 7, 16, 1, 16 + side * 7, 16, 11);
    grad.addColorStop(0, "#fff");
    grad.addColorStop(1, "#000");
    b.save();
    b.translate(16 + side * 7, 16);
    b.rotate(side * 0.5);
    b.scale(0.55, 1);
    b.translate(-(16 + side * 7), -16);
    b.fillStyle = grad;
    b.beginPath();
    b.arc(16 + side * 7, 16, 14, 0, Math.PI * 2);
    b.fill();
    b.restore();
  }
  const bump = new THREE.CanvasTexture(st);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  // u runs along the scarf (rows of stitches), v around it (columns).
  bump.repeat.set(5, 14);
  knitTextures = { map, bump };
  return knitTextures;
}

const FIXED: Record<Exclude<Surface, Part>, Swatch> = {
  skin: SKIN,
  ink: { color: "#17110e", shade: "#17110e" },
  mouth: { color: "#3a221b", shade: "#3a221b" },
  inner: { color: "#86392f", shade: "#682a24" },
  dough: { color: "#cf8f4e", shade: "#a6683a" },
  choc: { color: "#4a2a1a", shade: "#2e1a10" },
  sweat: { color: "#b5e1ff", shade: "#86c3ee" },
  wood: { color: "#c98d5c", shade: "#9a6440" },
  metal: { color: "#e2be72", shade: "#b48e48" },
  bristle: { color: "#f3e6cc", shade: "#d3bf99" },
  gloss: { color: "#ffffff", shade: "#d9d9d9" },
  fur: { color: "#f3dfa8", shade: "#dcc07f" },
  furPale: { color: "#fff6dc", shade: "#ecdcb4" },
  dogEar: { color: "#c98a4b", shade: "#a86b33" },
  dogEarTip: { color: "#8e5a28", shade: "#6c421b" },
  nose: { color: "#4a2c22", shade: "#2f1a13" },
  sclera: { color: "#ffffff", shade: "#dfe2ea" },
  pupil: { color: "#2b1b14", shade: "#2b1b14" },
  brow: { color: "#6e4226", shade: "#55311a" },
  freckle: { color: "#b57a45", shade: "#9a6436" },
  tongue: { color: "#ec8a8f", shade: "#c96870" },
  teeth: { color: "#ffffff", shade: "#e4ded4" },
  knit: SCARF,
  // A ghost's pale middle, and its glowing edge.
  ghost: { color: "#e6d8ff", shade: "#9257ff" },
  glow: { color: "#d2a8ff", shade: "#d2a8ff" },
};

// ── Themes (their colours are in palette.ts) ──────────────────────────────────

const isPart = (s: Surface): s is Part => s in THEMES.cream.parts;

/** The theme the body shows now, and the one being painted on (if any). */
let theme: ThemeName = "cream";
let incoming: ThemeName = "cream";

export function currentTheme(): ThemeName {
  return theme;
}

/** Where the new colour has reached: inside `uRadius` of `uCenter` (world units). Negative: nowhere. */
export const paintShared = {
  uPaintCenter: { value: new THREE.Vector3() },
  uPaintRadius: { value: -1 },
};

// ── Shared uniforms ───────────────────────────────────────────────────────────

/** Uniforms shared by every anime material and outline, updated each frame. */
export const lookShared = {
  /** Key light direction in view space. */
  uLight: { value: new THREE.Vector3(-0.35, 0.55, 0.75).normalize() },
  /** Outline width in device pixels, and the drawing size. */
  uWidth: { value: 2 },
  uRes: { value: new THREE.Vector2(1, 1) },
};

const paintGlsl = /* glsl */ `
uniform vec3 uPaintCenter;
uniform float uPaintRadius;
varying vec3 vPaintPos;
// 1 where the new colour has spread to, with a wavy wet-paint edge.
float paintMask() {
  if (uPaintRadius < 0.0) return 0.0;
  float wobble = 0.045 * sin(vPaintPos.x * 23.0 + vPaintPos.y * 9.0) * sin(vPaintPos.y * 19.0 - vPaintPos.z * 13.0);
  float d = distance(vPaintPos, uPaintCenter) + wobble;
  float w = fwidth(d) + 0.004;
  return 1.0 - smoothstep(uPaintRadius - w, uPaintRadius + w, d);
}
`;

// ── Toy ───────────────────────────────────────────────────────────────────────

function toy(s: Surface, sw: Swatch, next: Swatch): THREE.Material {
  const f = FINISH[s];
  const m = new THREE.MeshPhysicalMaterial({
    color: sw.color,
    roughness: f.rough,
    metalness: f.metal ?? 0,
    clearcoat: f.coat ?? 0,
    clearcoatRoughness: 0.28,
    sheen: f.sheen ?? 0,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color("#ffffff"),
  });
  if (s === "sweat") {
    m.transparent = true;
    m.opacity = 0.8;
  }
  if (s === "knit") {
    const { map, bump } = knitMaps();
    m.color.set("#ffffff");
    m.map = map;
    m.bumpMap = bump;
    m.bumpScale = 1.6;
    m.sheenColor.set("#bfeee6");
  }
  if (isPart(s)) {
    // Mix towards the incoming colour wherever the paint has reached.
    const uNewColor = { value: new THREE.Color(next.color) };
    m.userData.next = uNewColor;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, paintShared, { uNewColor });
      sh.vertexShader = "varying vec3 vPaintPos;\n" + sh.vertexShader.replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n  vPaintPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
      sh.fragmentShader = "uniform vec3 uNewColor;\n" + paintGlsl + sh.fragmentShader.replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        "vec4 diffuseColor = vec4( mix( diffuse, uNewColor, paintMask() ), opacity );",
      );
    };
    m.customProgramCacheKey = () => "paintable";
  }
  return m;
}

// ── Anime ─────────────────────────────────────────────────────────────────────

const celVertex = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vPaintPos;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vPaintPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const celFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uShade;
uniform vec3 uNewColor;
uniform vec3 uNewShade;
uniform vec3 uLight;
uniform float uSpec;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vV;
${paintGlsl}

// A hard step with just enough softness to stay smooth at any size.
float edge(float x, float at) {
  float w = fwidth(x) * 1.2;
  return smoothstep(at - w, at + w, x);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  vec3 L = normalize(uLight);
  float p = paintMask();
  vec3 base = mix(uColor, uNewColor, p);
  vec3 shade = mix(uShade, uNewShade, p);
  float ndl = dot(N, L);
  vec3 col = mix(shade, base, edge(ndl, 0.05));
  // A thin rim of light around the lit side of the silhouette.
  float fres = 1.0 - max(dot(N, V), 0.0);
  float rim = edge(fres, 0.7) * smoothstep(-0.2, 0.4, ndl);
  col = mix(col, base * 1.1 + 0.05, rim * 0.6);
  // A crisp highlight on glossy parts.
  col += uSpec * edge(dot(N, normalize(L + V)), 0.965) * 0.85;
  gl_FragColor = vec4(col, uOpacity);
  #include <colorspace_fragment>
}
`;

// The knit: the same cel shading, in two colours along the stripes.
const knitVertex = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * mv;
}
`;

const knitFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uShade;
uniform vec3 uColor2;
uniform vec3 uShade2;
uniform vec2 uStripe;
uniform vec3 uLight;
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;

float edge(float x, float at) {
  float w = fwidth(x) * 1.2;
  return smoothstep(at - w, at + w, x);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  vec3 L = normalize(uLight);
  float u = fract(vUv.x);
  float stripe = edge(u, uStripe.x) * (1.0 - edge(u, uStripe.y));
  vec3 base = mix(uColor, uColor2, stripe);
  vec3 shade = mix(uShade, uShade2, stripe);
  float ndl = dot(N, L);
  vec3 col = mix(shade, base, edge(ndl, 0.05));
  float fres = 1.0 - max(dot(N, V), 0.0);
  float rim = edge(fres, 0.7) * smoothstep(-0.2, 0.4, ndl);
  col = mix(col, base * 1.1 + 0.05, rim * 0.5);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

function anime(s: Surface, sw: Swatch, next: Swatch): THREE.Material {
  if (s === "knit") {
    return new THREE.ShaderMaterial({
      vertexShader: knitVertex,
      fragmentShader: knitFragment,
      uniforms: {
        uColor: { value: new THREE.Color(SCARF.color) },
        uShade: { value: new THREE.Color(SCARF.shade) },
        uColor2: { value: new THREE.Color(SCARF_STRIPE.color) },
        uShade2: { value: new THREE.Color(SCARF_STRIPE.shade) },
        uStripe: { value: new THREE.Vector2(STRIPE[0], STRIPE[1]) },
        uLight: lookShared.uLight,
      },
    });
  }
  const opacity = s === "sweat" ? 0.85 : 1;
  const m = new THREE.ShaderMaterial({
    vertexShader: celVertex,
    fragmentShader: celFragment,
    transparent: opacity < 1,
    uniforms: {
      uColor: { value: new THREE.Color(sw.color) },
      uShade: { value: new THREE.Color(sw.shade) },
      uNewColor: { value: new THREE.Color(next.color) },
      uNewShade: { value: new THREE.Color(next.shade) },
      uSpec: { value: FINISH[s].spec ?? 0 },
      uOpacity: { value: opacity },
      uLight: lookShared.uLight,
      ...paintShared,
    },
  });
  return m;
}

// Outlines: a copy of the mesh pushed out a few pixels along its normals,
// showing only its back faces, so it peeks out around the silhouette.
const outline = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: {
    uColor: { value: new THREE.Color("#4a3127") },
    uWidth: lookShared.uWidth,
    uRes: lookShared.uRes,
  },
  vertexShader: /* glsl */ `
    uniform float uWidth;
    uniform vec2 uRes;
    void main() {
      vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      vec3 n = normalize(normalMatrix * normal);
      vec2 dir = (projectionMatrix * vec4(n, 0.0)).xy;
      dir = length(dir) > 1e-5 ? normalize(dir) : vec2(0.0);
      clip.xy += dir * uWidth * 2.0 / uRes * clip.w;
      gl_Position = clip;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    void main() {
      gl_FragColor = vec4(uColor, 1.0);
      #include <colorspace_fragment>
    }`,
});

// ── Magic ─────────────────────────────────────────────────────────────────────

/**
 * Shared by the magic materials: a clock for the runes' crawling flicker, how
 * stirred up they are (0 calm … 1 frantic), and how solid ghosts are.
 */
export const magicShared = {
  uTime: { value: 0 },
  uPulse: { value: 0.5 },
  uFade: { value: 1 },
};

const magicVertex = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vW = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * mv;
}
`;

// See-through in the middle, glowing towards the edges: a soft gradient for
// the toy look, two crisp bands for anime.
const ghostFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRim;
uniform float uCel;
uniform float uFade;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float f = 1.0 - abs(dot(N, V));
  float w = fwidth(f) * 1.5 + 0.002;
  float k = mix(pow(f, 1.2), smoothstep(0.5 - w, 0.5 + w, f), uCel);
  vec3 col = mix(uColor, uRim, k);
  // A soft sheen from above.
  col += pow(max(N.y, 0.0), 6.0) * 0.18 * (1.0 - uCel);
  gl_FragColor = vec4(col, mix(0.5, 0.95, k) * uFade);
  #include <colorspace_fragment>
}
`;

// Light that crawls across the runes in waves, with the odd flicker; at the
// crest of each wave the violet turns a sickly teal.
const glowFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uPulse;
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float speed = 2.0 + 6.0 * uPulse;
  float crawl = 0.5 + 0.5 * sin(uTime * speed - vW.x * 6.0 - vW.y * 9.0 + vW.z * 4.0);
  float tick = floor(uTime * (6.0 + 12.0 * uPulse));
  float flick = step(0.86 - 0.12 * uPulse, fract(sin(tick * 12.9898 + floor(vW.x * 5.0) * 78.233) * 43758.5453));
  float lit = 0.45 + 0.75 * crawl * (0.55 + 0.45 * uPulse) - 0.3 * flick;
  vec3 col = mix(uColor, vec3(0.45, 1.0, 0.82), smoothstep(0.75, 1.0, crawl) * 0.55) * lit;
  col += f * vec3(0.25, 0.6, 0.5) * 0.4;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * The ghost and glow materials. A ghost is drawn only where it's nearest
 * (see `ghostly` in props.ts), so overlapping fingers don't double up.
 */
function magic(look: Look, s: "ghost" | "glow", sw: Swatch): THREE.Material {
  if (s === "glow") {
    return new THREE.ShaderMaterial({
      vertexShader: magicVertex,
      fragmentShader: glowFragment,
      uniforms: { uColor: { value: new THREE.Color(sw.color) }, uTime: magicShared.uTime, uPulse: magicShared.uPulse },
    });
  }
  return new THREE.ShaderMaterial({
    vertexShader: magicVertex,
    fragmentShader: ghostFragment,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(sw.color) },
      uRim: { value: new THREE.Color(sw.shade) },
      uCel: { value: look === "anime" ? 1 : 0 },
      uFade: magicShared.uFade,
    },
  });
}

// ── Tagging and painting ──────────────────────────────────────────────────────

interface TagOptions {
  outline?: boolean;
  cast?: boolean;
  receive?: boolean;
  /** A colour of its own, in place of the surface's usual one. */
  tint?: string;
}

/** Marks what `mesh` is made of, and whether it gets an outline and shadows. */
export function tag(mesh: THREE.Mesh, surface: Surface, o: TagOptions = {}): THREE.Mesh {
  mesh.userData.surface = surface;
  mesh.userData.tint = o.tint;
  mesh.userData.cast = !!o.cast;
  mesh.userData.receive = !!o.receive;
  if (o.outline) {
    const hull = new THREE.Mesh(mesh.geometry, outline);
    hull.userData.outline = true;
    mesh.add(hull);
  }
  return mesh;
}

function swatch(s: Surface, t: ThemeName, tint?: string): Swatch {
  if (tint) {
    const shade = new THREE.Color(tint).offsetHSL(0, 0, -0.16).getStyle();
    return { color: tint, shade };
  }
  return isPart(s) ? THEMES[t].parts[s] : FIXED[s];
}

const cache = new Map<string, THREE.Material>();

function material(look: Look, s: Surface, tint?: string): THREE.Material {
  const key = `${look}|${s}|${tint ?? ""}`;
  let m = cache.get(key);
  if (!m) {
    if (s === "ghost" || s === "glow") m = magic(look, s, swatch(s, theme, tint));
    else {
      const make = look === "toy" ? toy : anime;
      m = make(s, swatch(s, theme, tint), swatch(s, incoming, tint));
    }
    m.userData.surface = s;
    m.userData.tint = tint;
    cache.set(key, m);
  }
  return m;
}

/** Gives every tagged mesh under `root` its material for `look`. */
export function paint(root: THREE.Object3D, look: Look): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o.userData.outline) {
      o.visible = look === "anime";
      return;
    }
    const s = o.userData.surface as Surface | undefined;
    if (!s) return;
    o.material = material(look, s, o.userData.tint);
    o.castShadow = o.userData.cast;
    // Cel shading draws its own light and shade.
    o.receiveShadow = o.userData.receive && look === "toy";
  });
}

/** Sets the colours on both sides of the paint edge, for every body material made so far. */
function recolour(): void {
  for (const m of cache.values()) {
    const s = m.userData.surface as Surface;
    if (!isPart(s) || m.userData.tint) continue;
    const now = THEMES[theme].parts[s];
    const next = THEMES[incoming].parts[s];
    if (m instanceof THREE.MeshPhysicalMaterial) {
      m.color.set(now.color);
      (m.userData.next as { value: THREE.Color }).value.set(next.color);
    } else if (m instanceof THREE.ShaderMaterial) {
      m.uniforms.uColor.value.set(now.color);
      m.uniforms.uShade.value.set(now.shade);
      m.uniforms.uNewColor.value.set(next.color);
      m.uniforms.uNewShade.value.set(next.shade);
    }
  }
}

/** Gets ready to paint `name` on: nothing shows it until the paint radius grows. */
export function startTheme(name: ThemeName): void {
  incoming = name;
  paintShared.uPaintRadius.value = 0;
  recolour();
}

/** The new theme now covers everything. */
export function finishTheme(): void {
  theme = incoming;
  paintShared.uPaintRadius.value = -1;
  recolour();
}

/** Switches theme at once, with no paint effect. */
export function setTheme(name: ThemeName): void {
  incoming = name;
  finishTheme();
}

/** The incoming theme's body colour, for brushes and sparkles. */
export function incomingColor(): string {
  return THEMES[incoming].parts.shell.color;
}
