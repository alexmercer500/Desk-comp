// Props for the change-colour scenes: a paint palette and brush, a wardrobe
// and a standing mirror, and a spooky-cute magic trunk with ghostly hands.
// All built from simple rounded shapes in the same toy / anime style as Rui.
// The palette and brush are made fresh each time; the rest are built once
// (ahead of time) and reused.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { Look, THEMES, THEME_NAMES, paint, tag } from "./looks";

const solid = { outline: true, cast: true, receive: true };

function box(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 4, r);
}

/** Frees every geometry, and the mirror's render target, under `root`. */
export function dispose(root: THREE.Object3D): void {
  root.removeFromParent();
  root.traverse((o) => {
    if (o instanceof Reflector) o.dispose();
    else if (o instanceof THREE.Mesh && !o.userData.outline) o.geometry.dispose();
  });
}

/**
 * Compiles every prop's materials ahead of time, in both looks, so the first
 * time one pops up doesn't stutter.
 */
export async function prewarm(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene): Promise<void> {
  // This repaints the whole scene in each look; the caller puts its look back after.
  const all = new THREE.Group();
  const loose = [palette(), brush("#ffffff"), tablet("#ffffff"), book("#ffffff").group, magnifier(), pushButton().group, binoculars()];
  all.add(theWardrobe().group, theMirror(), theTrunk().group, theGhosts().group, theQuestion(), ...loose);
  scene.add(all);
  // The mirror draws the scene into a texture, which needs its own shader
  // versions of everything; compile those too.
  const offscreen = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  const looks: Look[] = ["toy", "anime"];
  for (const look of looks) {
    paint(scene, look);
    const jobs = [renderer.compileAsync(scene, camera)];
    renderer.setRenderTarget(offscreen);
    jobs.push(renderer.compileAsync(scene, camera));
    renderer.setRenderTarget(null);
    await Promise.all(jobs);
  }
  offscreen.dispose();
  all.removeFromParent();
  loose.forEach(dispose);
  all.remove(...all.children);
}

let builtWardrobe: Wardrobe | null = null;
let builtMirror: THREE.Group | null = null;
let builtTrunk: Trunk | null = null;
let builtGhosts: Ghosts | null = null;
let builtQuestion: THREE.Sprite | null = null;

/** The one wardrobe, built on first use. Take it out of the scene with `removeFromParent` when done. */
export function theWardrobe(): Wardrobe {
  return (builtWardrobe ??= wardrobe());
}

/** The one mirror, built on first use. */
export function theMirror(): THREE.Group {
  return (builtMirror ??= mirror());
}

/** The one magic trunk, built on first use. */
export function theTrunk(): Trunk {
  return (builtTrunk ??= trunk());
}

/** The trunk's ghostly hands, built on first use. */
export function theGhosts(): Ghosts {
  return (builtGhosts ??= ghosts());
}

/** A little floating "?", built on first use. */
export function theQuestion(): THREE.Sprite {
  return (builtQuestion ??= question());
}

/** A painter's palette with a dab of every theme colour, held flat towards you. */
export function palette(): THREE.Group {
  const g = new THREE.Group();
  const board = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 40)), "wood", solid);
  board.scale.x = 1.25;
  g.add(board);
  const blob = new THREE.SphereGeometry(0.035, 16, 10);
  THEME_NAMES.forEach((name, i) => {
    const a = -2.4 + i * 0.62;
    const m = tag(new THREE.Mesh(blob), "gloss", { tint: THEMES[name].parts.shell.color });
    m.position.set(Math.cos(a) * 0.17, 0.02, Math.sin(a) * 0.11);
    m.scale.y = 0.5;
    g.add(m);
  });
  // Flat side to the front.
  g.rotation.x = Math.PI / 2;
  return g;
}

/** A paint brush pointing down its -y axis, its tip loaded with `color`. */
export function brush(color: string): THREE.Group {
  const g = new THREE.Group();
  const handle = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.34, 16)), "wood", solid);
  handle.position.y = 0.05;
  const ferrule = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.03, 0.07, 16)), "metal", { cast: true });
  ferrule.position.y = -0.15;
  const tip = tag(new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12)), "gloss", { ...solid, tint: color });
  tip.scale.set(0.8, 1.6, 0.8);
  tip.position.y = -0.23;
  g.add(handle, ferrule, tip);
  return g;
}

/**
 * A tablet held in both mittens while he works: its screen faces him, so you
 * see its back, with a little logo in `color`.
 */
export function tablet(color: string): THREE.Group {
  const g = new THREE.Group();
  const body = tag(new THREE.Mesh(box(0.54, 0.36, 0.035, 0.03)), "gloss", { ...solid, tint: "#e9e9ee" });
  const screen = tag(new THREE.Mesh(box(0.48, 0.3, 0.01, 0.01)), "ink", {});
  screen.position.z = -0.02;
  const logo = tag(new THREE.Mesh(new THREE.CircleGeometry(0.035, 24)), "gloss", { tint: color });
  logo.position.z = 0.019;
  g.add(body, screen, logo);
  return g;
}

// ── Working props: what he holds while an agent reads, runs commands, browses ─

const PAPER = "#fbf5e6";

export interface Book {
  /** Lies open with its pages facing +y, the spine along z. */
  group: THREE.Group;
  /** A loose leaf hinged on the spine: turn it over by setting rotation.z (0 lying on the right … π on the left). */
  leaf: THREE.Group;
}

/** An open storybook in `color`, a few lines of writing on each page. */
export function book(color: string): Book {
  const group = new THREE.Group();
  const W = 0.24;
  const L = 0.32;
  const cover = tag(new THREE.Mesh(box(2 * W + 0.04, 0.025, L + 0.04, 0.012)), "vinyl", { ...solid, tint: color });
  cover.position.y = -0.012;
  group.add(cover);
  const block = box(W, 0.045, L, 0.015);
  const line = box(W * 0.62, 0.004, 0.016, 0.002);
  for (const side of [-1, 1]) {
    // Each half rises a little from the spine, so the book reads as open.
    const half = new THREE.Group();
    half.rotation.z = side * 0.1;
    group.add(half);
    const pages = tag(new THREE.Mesh(block), "cloth", { ...solid, tint: PAPER });
    pages.position.set(side * (W / 2 + 0.008), 0.02, 0);
    half.add(pages);
    for (let i = 0; i < 5; i++) {
      const l = tag(new THREE.Mesh(line), "ink", {});
      l.position.set(side * (W / 2 + 0.008) - (i === 4 ? side * 0.03 : 0), 0.044, -L / 2 + 0.06 + i * 0.05);
      if (i === 4) l.scale.x = 0.6;
      half.add(l);
    }
  }
  // The leaf that turns, hinged at the top of the spine, with writing on both sides.
  const leaf = new THREE.Group();
  leaf.position.y = 0.048;
  const sheet = tag(new THREE.Mesh(box(W - 0.01, 0.008, L - 0.012, 0.004)), "cloth", { ...solid, tint: PAPER });
  sheet.position.set(W / 2 + 0.01, 0.004, 0);
  leaf.add(sheet);
  for (const y of [0.0085, -0.0005]) {
    for (let i = 0; i < 5; i++) {
      const l = tag(new THREE.Mesh(line), "ink", {});
      l.position.set(W / 2 + 0.01 - (i === 4 ? 0.03 : 0), y, -L / 2 + 0.06 + i * 0.05);
      if (i === 4) l.scale.x = 0.6;
      leaf.add(l);
    }
  }
  group.add(leaf);
  return { group, leaf };
}

/**
 * A magnifying glass: the lens at the origin facing +z, the handle hanging
 * down -y. `MAGNIFIER_GRIP` is where a mitten holds it.
 */
export function magnifier(): THREE.Group {
  const g = new THREE.Group();
  const R = 0.13;
  g.add(tag(new THREE.Mesh(new THREE.TorusGeometry(R, 0.026, 14, 48)), "metal", solid));
  const lens = tag(new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16)), "lens", {});
  lens.scale.z = 0.14;
  g.add(lens);
  // A glint, so the glass reads as glass in either look.
  const glint = tag(new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 10)), "gloss", { tint: "#ffffff" });
  glint.scale.set(1.3, 0.55, 0.3);
  glint.position.set(-0.055, 0.06, 0.02);
  glint.rotation.z = 0.7;
  g.add(glint);
  const neck = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.06, 16)), "metal", { cast: true });
  neck.position.y = -R - 0.04;
  const handle = tag(new THREE.Mesh(new THREE.CapsuleGeometry(0.034, 0.17, 6, 16)), "wood", { ...solid, tint: "#9b5a3a" });
  handle.position.y = -R - 0.17;
  g.add(neck, handle);
  return g;
}
/** Where the mitten holds the magnifying glass, in its own space. */
export const MAGNIFIER_GRIP = new THREE.Vector3(0, -0.29, 0);

export interface PushButton {
  /** Stands on the floor, its origin under the middle of the stand. */
  group: THREE.Group;
  /** The big round cap: press it by squashing scale.y (1 up … ~0.45 down). */
  cap: THREE.Group;
  /** Top of the cap (unpressed), in the group's space. */
  top: number;
  /** A little lamp on the stand: show `on` while the command runs. */
  on: THREE.Object3D;
}

/** A big red push button on a small pedestal, with a little lamp beside it. */
export function pushButton(): PushButton {
  const group = new THREE.Group();
  const H = 0.38;
  const R = 0.15;
  const BODY = "#5f6f86";
  const base = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 32)), "gloss", { ...solid, tint: BODY });
  base.position.y = 0.025;
  const post = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, H, 24)), "gloss", { ...solid, tint: BODY });
  post.position.y = H / 2;
  const head = tag(new THREE.Mesh(box(0.44, 0.12, 0.36, 0.05)), "gloss", { ...solid, tint: "#f1efe9" });
  head.position.y = H + 0.06;
  const ring = tag(new THREE.Mesh(new THREE.TorusGeometry(R + 0.012, 0.022, 12, 40)), "metal", { cast: true });
  ring.rotation.x = Math.PI / 2;
  ring.position.y = H + 0.12;
  group.add(base, post, head, ring);
  const cap = new THREE.Group();
  cap.position.y = H + 0.12;
  const dome = new THREE.SphereGeometry(R, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const capMesh = tag(new THREE.Mesh(dome), "gloss", { ...solid, tint: "#e5484d" });
  capMesh.scale.y = 0.7;
  cap.add(capMesh);
  group.add(cap);
  // The lamp, on the front: dark when idle; a glowing green bead shows over it while running.
  const bead = new THREE.SphereGeometry(0.04, 16, 12);
  const off = tag(new THREE.Mesh(bead), "gloss", { outline: true, tint: "#2f5a3a" });
  off.position.set(0.12, H + 0.06, 0.185);
  const on = tag(new THREE.Mesh(bead), "glow", { tint: "#8cff9e" });
  on.position.copy(off.position);
  on.scale.setScalar(1.12);
  on.visible = false;
  group.add(off, on);
  return { group, cap, top: H + 0.12 + R * 0.7, on };
}

/** Half the distance between the binoculars' barrels (his eyes are about this far either side). */
export const BINOCULAR_EYE = 0.19;
export const BINOCULAR_GRIPS = [new THREE.Vector3(-0.27, -0.09, 0.08), new THREE.Vector3(0.27, -0.09, 0.08)];

/**
 * Binoculars held to his eyes: the eyepieces at z = 0, the barrels along +z,
 * centred between the eyes (`BINOCULAR_EYE` apart). `BINOCULAR_GRIPS` are
 * where the mittens hold them (left, right).
 */
export function binoculars(): THREE.Group {
  const g = new THREE.Group();
  const BODY = "#3f4c63";
  const tube = new THREE.CylinderGeometry(0.092, 0.092, 0.2, 28);
  tube.rotateX(Math.PI / 2);
  const front = new THREE.CylinderGeometry(0.112, 0.098, 0.09, 28);
  front.rotateX(Math.PI / 2);
  const cup = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 24);
  cup.rotateX(Math.PI / 2);
  const rim = new THREE.TorusGeometry(0.1, 0.017, 10, 32);
  const glass = new THREE.CircleGeometry(0.094, 28);
  const glint = new THREE.SphereGeometry(0.022, 12, 8);
  for (const side of [-1, 1]) {
    const x = side * BINOCULAR_EYE;
    const t = tag(new THREE.Mesh(tube), "gloss", { ...solid, tint: BODY });
    t.position.set(x, 0, 0.13);
    const f = tag(new THREE.Mesh(front), "gloss", { ...solid, tint: BODY });
    f.position.set(x, 0, 0.27);
    const c = tag(new THREE.Mesh(cup), "gloss", { ...solid, tint: "#2a2f3a" });
    c.position.set(x, 0, 0.025);
    const r = tag(new THREE.Mesh(rim), "metal", { cast: true });
    r.position.set(x, 0, 0.312);
    const lens = tag(new THREE.Mesh(glass), "gloss", { tint: "#8fd0ee" });
    lens.position.set(x, 0, 0.311);
    const shine = tag(new THREE.Mesh(glint), "gloss", { tint: "#ffffff" });
    shine.scale.set(1.2, 0.7, 0.2);
    shine.position.set(x - 0.035, 0.035, 0.313);
    g.add(t, f, c, r, lens, shine);
  }
  const bridge = tag(new THREE.Mesh(box(0.2, 0.06, 0.16, 0.025)), "gloss", { ...solid, tint: BODY });
  bridge.position.set(0, 0.02, 0.14);
  const knob = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 16)), "metal", { cast: true });
  knob.position.set(0, 0.07, 0.12);
  g.add(bridge, knob);
  return g;
}

export interface Wardrobe {
  group: THREE.Group;
  /** Left and right door hinges: open by turning them (left −, right +). */
  doors: THREE.Group[];
  /** How deep inside the wardrobe stands. */
  inside: number;
}

/** A chubby two-door wardrobe, with a few hoodies in theme colours hanging inside. */
function wardrobe(): Wardrobe {
  const W = 1.9;
  const H = 2.65;
  const D = 1.35;
  const T = 0.08;
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.1;
  group.add(body);

  // Back, sides and top. There's no floor panel: he stands on the real floor,
  // and the sides, back and doors reach right down to it (a little below the
  // body) so nothing shows underneath, even mid-wobble.
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, tint?: string) => {
    const m = tag(new THREE.Mesh(geo), "wood", { ...solid, tint });
    m.position.set(x, y, z);
    body.add(m);
  };
  const DOWN = 0.14;
  const tall = H + DOWN;
  const mid = (H - DOWN) / 2;
  // The back is darker, so the inside reads as deep.
  add(box(W, tall, T, 0.03), 0, mid, -D / 2 + T / 2, "#8d5e3c");
  add(box(T, tall, D, 0.03), -W / 2 + T / 2, mid, 0);
  add(box(T, tall, D, 0.03), W / 2 - T / 2, mid, 0);
  add(box(W + 0.16, 0.16, D + 0.12, 0.07), 0, H + 0.08, 0);

  // Little round feet at the corners.
  const foot = new THREE.SphereGeometry(0.08, 16, 12);
  for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) {
    for (const z of [-D / 2 + 0.06, D / 2 - 0.06]) {
      const f = tag(new THREE.Mesh(foot), "wood", { cast: true });
      f.position.set(x, 0.02, z);
      group.add(f);
    }
  }

  // A rail with hoodies in the other theme colours.
  const rail = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, W - 0.2, 12)), "metal", {});
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, H - 0.3, -D / 2 + 0.3);
  body.add(rail);
  const hoodie = box(0.34, 0.5, 0.12, 0.06);
  ["mint", "sky", "lavender", "peach"].forEach((name, i) => {
    const h = tag(new THREE.Mesh(hoodie), "shell", { outline: true, tint: THEMES[name as keyof typeof THEMES].parts.shell.color });
    h.position.set(-0.6 + i * 0.4, H - 0.62, -D / 2 + 0.3);
    h.rotation.y = (i - 1.5) * 0.15;
    body.add(h);
  });

  // Two doors on hinges at the outer edges, with brass knobs.
  const doors: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set((side * W) / 2, H / 2, D / 2);
    // From just under the top down to the floor.
    const door = tag(new THREE.Mesh(box(W / 2, H + DOWN - 0.02, 0.07, 0.03)), "wood", solid);
    door.position.set((-side * W) / 4, -DOWN / 2, 0);
    const panel = tag(new THREE.Mesh(box(W / 2 - 0.22, H - 0.5, 0.02, 0.01)), "gloss", { tint: "#e7b98e" });
    panel.position.set((-side * W) / 4, 0, 0.04);
    const knob = tag(new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12)), "metal", { cast: true });
    knob.position.set(-side * (W / 2 - 0.12), 0, 0.07);
    hinge.add(door, panel, knob);
    body.add(hinge);
    doors.push(hinge);
  }
  return { group, doors, inside: -0.2 };
}

/** A standing oval mirror with a real reflection. */
function mirror(): THREE.Group {
  const g = new THREE.Group();
  const RX = 0.55;
  const RY = 0.95;
  const CY = 1.35;

  // The mirror is small on screen, so a small reflection (shaped like the glass) is plenty.
  const glass = new Reflector(new THREE.CircleGeometry(1, 64), {
    textureWidth: 224,
    textureHeight: 384,
    multisample: 2,
    color: "#dfeef6",
    shader: glassShader,
  });
  glass.scale.set(RX, RY, 1);
  glass.position.y = CY;
  g.add(glass);

  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * RX, CY + Math.sin(a) * RY, 0));
  }
  const frame = tag(
    new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.07, 14, true)),
    "wood",
    solid,
  );
  g.add(frame);

  // A back panel, so the mirror isn't see-through from behind, and a stand.
  const back = tag(new THREE.Mesh(new THREE.CircleGeometry(1, 64)), "wood", { cast: true });
  back.scale.set(RX, RY, 1);
  back.position.set(0, CY, -0.02);
  back.rotation.y = Math.PI;
  g.add(back);
  const leg = new THREE.CylinderGeometry(0.035, 0.04, CY - RY + 0.1, 12);
  for (const x of [-0.3, 0.3]) {
    const l = tag(new THREE.Mesh(leg), "wood", { cast: true, outline: true });
    l.position.set(x, (CY - RY) / 2, -0.05);
    g.add(l);
  }
  const base = tag(new THREE.Mesh(box(0.9, 0.08, 0.4, 0.04)), "wood", solid);
  base.position.set(0, 0.04, -0.05);
  g.add(base);
  return g;
}

// The reflection over a soft glass tint (empty parts of the reflection would
// otherwise come out black), with two diagonal shine streaks.
const glassShader = {
  name: "MirrorGlass",
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vLocal;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vLocal = position.xy;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    varying vec4 vUv;
    varying vec2 vLocal;
    void main() {
      vec4 base = texture2DProj(tDiffuse, vUv);
      vec3 c = mix(color, base.rgb * 0.9 + color * 0.1, clamp(base.a, 0.0, 1.0));
      float k = vLocal.x * 0.8 + vLocal.y;
      float shine = smoothstep(0.03, 0.0, abs(k - 0.35)) * 0.35 + smoothstep(0.015, 0.0, abs(k - 0.5)) * 0.25;
      gl_FragColor = vec4(c + shine, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

// ── The magic trunk ───────────────────────────────────────────────────────────

export interface Trunk {
  /** Stands on the floor, its origin at the middle of its footprint. */
  group: THREE.Group;
  /** Everything that rattles and hops (the group itself stays put). */
  body: THREE.Group;
  /** The lid's hinge along the top back edge: open by turning it (rotation.x = −angle). */
  lid: THREE.Group;
  /** Two glowing eyes that peek out from under the lid. */
  eyes: THREE.Group;
  /** Light spilling up out of the open trunk; its strength is `beamLight.value`. */
  beam: THREE.Mesh;
  beamLight: { value: number };
  /** A dark glow pooling on the floor round it; its strength is `auraLight.value`. */
  auraLight: { value: number };
  /** Height of the opening, and the inside's size. */
  rim: number;
  width: number;
  depth: number;
}

// Near-black plum wood, cold dark iron, and runes that glow violet with a sickly teal edge.
const TRUNK_WOOD = "#2c2034";
const TRUNK_IRON = "#3b3652";
const RUNE = "#c79aff";
const FANG = "#f3ecdf";

/**
 * A chubby (slightly ominous) treasure chest: dark wood, iron bands and studs,
 * claw feet, a domed lid with little fangs along its edge like a mimic, and
 * glowing runes.
 */
function trunk(): Trunk {
  const W = 1.6;
  const D = 0.92;
  const H = 0.72;
  const T = 0.08;
  const BASE = 0.07;
  const LH = 0.3;
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const put = (parent: THREE.Object3D, m: THREE.Mesh, x: number, y: number, z: number) => {
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const wood = (geo: THREE.BufferGeometry) => tag(new THREE.Mesh(geo), "wood", { ...solid, tint: TRUNK_WOOD });
  const iron = (geo: THREE.BufferGeometry) => tag(new THREE.Mesh(geo), "metal", { ...solid, tint: TRUNK_IRON });
  const glow = (geo: THREE.BufferGeometry, tint = RUNE) => tag(new THREE.Mesh(geo), "glow", { tint });

  // A hollow box: four walls and a floor, the inside a glowing purple pool.
  const wallH = H - BASE;
  const midY = BASE + wallH / 2;
  put(body, wood(box(W, wallH, T, 0.03)), 0, midY, D / 2 - T / 2);
  put(body, wood(box(W, wallH, T, 0.03)), 0, midY, -D / 2 + T / 2);
  put(body, wood(box(T, wallH, D, 0.03)), -W / 2 + T / 2, midY, 0);
  put(body, wood(box(T, wallH, D, 0.03)), W / 2 - T / 2, midY, 0);
  put(body, wood(box(W, T, D, 0.03)), 0, BASE + T / 2, 0);
  const pool = glow(new THREE.PlaneGeometry(W - 2 * T + 0.02, D - 2 * T + 0.02), "#6a1fd0");
  pool.rotation.x = -Math.PI / 2;
  put(body, pool, 0, H - 0.07, 0);

  // Iron bands round the top and bottom, straps down the front and back, round feet.
  for (const y of [H - 0.05, BASE + 0.05]) {
    put(body, iron(box(W + 0.05, 0.1, 0.05, 0.02)), 0, y, D / 2);
    put(body, iron(box(W + 0.05, 0.1, 0.05, 0.02)), 0, y, -D / 2);
    put(body, iron(box(0.05, 0.1, D + 0.05, 0.02)), -W / 2, y, 0);
    put(body, iron(box(0.05, 0.1, D + 0.05, 0.02)), W / 2, y, 0);
  }
  const STRAP = 0.48;
  for (const x of [-STRAP, STRAP]) {
    for (const z of [D / 2 + 0.01, -D / 2 - 0.01]) put(body, iron(box(0.11, wallH, 0.05, 0.02)), x, midY, z);
    // A rivet top and bottom.
    for (const y of [BASE + 0.16, H - 0.16]) {
      put(body, tag(new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8)), "metal", {}), x, y, D / 2 + 0.04);
    }
  }
  // Studs along the top band, and round caps on the corners.
  const stud = new THREE.SphereGeometry(0.03, 12, 8);
  for (let x = -0.68; x <= 0.69; x += 0.34) {
    if (Math.abs(x) > 0.1) put(body, tag(new THREE.Mesh(stud), "metal", { tint: TRUNK_IRON }), x, H - 0.05, D / 2 + 0.03);
  }
  const cap = new THREE.SphereGeometry(0.065, 16, 12);
  for (const x of [-W / 2, W / 2]) {
    for (const z of [-D / 2, D / 2]) {
      for (const y of [H - 0.05, BASE + 0.05]) put(body, tag(new THREE.Mesh(cap), "metal", { ...solid, tint: TRUNK_IRON }), x, y, z);
    }
  }
  // Claw feet: three stubby rounded toes splayed out from each corner.
  const toe = new THREE.CapsuleGeometry(0.03, 0.07, 4, 10);
  toe.rotateX(Math.PI / 2);
  toe.translate(0, 0, 0.06);
  for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) {
    for (const z of [-D / 2 + 0.1, D / 2 - 0.1]) {
      const paw = new THREE.Group();
      paw.position.set(x, 0.06, z);
      paw.rotation.y = Math.atan2(x, z);
      for (const a of [-0.55, 0, 0.55]) {
        const t = tag(new THREE.Mesh(toe), "metal", { cast: true, outline: true, tint: TRUNK_IRON });
        t.rotation.set(0.35, a, 0);
        paw.add(t);
      }
      const ball = tag(new THREE.Mesh(cap), "metal", { cast: true, tint: TRUNK_IRON });
      ball.position.y = 0.0;
      paw.add(ball);
      group.add(paw);
    }
  }

  // A brass lock on the front with a glowing keyhole.
  put(body, tag(new THREE.Mesh(box(0.26, 0.28, 0.06, 0.03)), "metal", { ...solid, tint: "#a88a4e" }), 0, H - 0.2, D / 2 + 0.03);
  put(body, glow(new THREE.CircleGeometry(0.035, 20)), 0, H - 0.18, D / 2 + 0.062);
  put(body, glow(new THREE.PlaneGeometry(0.03, 0.07)), 0, H - 0.235, D / 2 + 0.062);

  // Runes on the front and sides: rings, diamonds and dots.
  const ring = new THREE.TorusGeometry(0.06, 0.014, 8, 28);
  const diamond = new THREE.OctahedronGeometry(0.07, 0);
  const dot = new THREE.SphereGeometry(0.022, 10, 8);
  const runeY = midY - 0.04;
  const front = D / 2 + 0.004;
  put(body, glow(ring), -0.27, runeY, front);
  put(body, glow(diamond), 0.27, runeY, front).scale.set(1, 1, 0.25);
  put(body, glow(diamond), -0.66, runeY, front).scale.set(0.7, 1, 0.25);
  put(body, glow(ring), 0.66, runeY, front).scale.setScalar(0.75);
  for (const [x, y] of [[-0.27, runeY + 0.13], [0.27, runeY + 0.13], [-0.27, runeY - 0.13], [0.27, runeY - 0.13]]) {
    put(body, glow(dot), x, y, front);
  }
  for (const side of [-1, 1]) {
    put(body, glow(ring), side * (W / 2 + 0.004), runeY, 0).rotation.y = Math.PI / 2;
    put(body, glow(dot), side * (W / 2 + 0.004), runeY, 0.2);
    put(body, glow(dot), side * (W / 2 + 0.004), runeY, -0.2);
  }

  // The domed lid, on a hinge along the top back edge.
  const lid = new THREE.Group();
  lid.position.set(0, H, -D / 2);
  body.add(lid);
  const arch = new THREE.Shape();
  arch.moveTo(-D / 2, 0);
  arch.absellipse(0, 0, D / 2, LH, Math.PI, 0, true);
  const span = W - 0.08;
  const shell = new THREE.ExtrudeGeometry(arch, {
    depth: span,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 3,
    curveSegments: 28,
  });
  shell.translate(0, 0.04, -span / 2);
  shell.rotateY(Math.PI / 2);
  shell.translate(0, 0, D / 2);
  shell.computeVertexNormals();
  lid.add(wood(shell));
  // The inside of the lid is a dark matt lining, so the open trunk looks deep.
  const lining = tag(new THREE.Mesh(box(span - 0.04, 0.02, D - 0.06, 0.01)), "inner", { tint: "#1a1020" });
  put(lid, lining, 0, 0.005, D / 2);
  // Little fangs along the lid's front edge, and smaller ones on the rim below:
  // hidden while it's shut, a toothy grin when it opens.
  const fang = new THREE.SphereGeometry(1, 14, 10);
  fang.translate(0, -1, 0);
  for (const [x, big] of [[-0.6, 0], [-0.44, 1], [-0.2, 0], [0, 0], [0.2, 0], [0.44, 1], [0.6, 0]] as [number, number][]) {
    const f = tag(new THREE.Mesh(fang), "gloss", { outline: true, tint: FANG });
    f.scale.set(big ? 0.042 : 0.03, big ? 0.06 : 0.04, big ? 0.042 : 0.03);
    put(lid, f, x, -0.005, D - 0.13);
  }
  for (const x of [-0.53, -0.12, 0.12, 0.53]) {
    const f = tag(new THREE.Mesh(fang), "gloss", { outline: true, tint: FANG });
    f.scale.set(0.026, -0.035, 0.026);
    put(body, f, x, H, D / 2 - T - 0.03);
  }
  // Iron bands over the dome, a hasp at the front, and a rune on top.
  const A = D / 2 + 0.045;
  const B = LH + 0.085;
  const archAt = (a: number, x: number) => new THREE.Vector3(x, Math.sin(a) * B, D / 2 - Math.cos(a) * A);
  for (const x of [-STRAP, STRAP, -W / 2 + 0.06, W / 2 - 0.06]) {
    const pts = Array.from({ length: 17 }, (_, i) => archAt((i / 16) * Math.PI, x));
    lid.add(iron(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.035, 10, false)));
  }
  put(lid, tag(new THREE.Mesh(box(0.14, 0.16, 0.05, 0.02)), "metal", solid), 0, 0.02, D + 0.05);
  const top = 0.68 * Math.PI;
  const at = archAt(top, 0);
  const facing = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, Math.sin(top) / B, -Math.cos(top) / A).normalize(),
  );
  put(lid, glow(new THREE.TorusGeometry(0.08, 0.016, 8, 32)), at.x, at.y, at.z).quaternion.copy(facing);
  const gem = put(lid, glow(new THREE.SphereGeometry(0.03, 12, 8)), at.x, at.y, at.z);
  gem.scale.z = 0.4;
  gem.quaternion.copy(facing);

  // Eyes in the dark, peeking out when the lid lifts a crack.
  const eyes = new THREE.Group();
  eyes.position.set(0, H + 0.07, D / 2 - 0.2);
  const eye = new THREE.SphereGeometry(1, 16, 12);
  for (const side of [-1, 1]) {
    // Slanted in a little: mischievous rather than scary.
    const e = tag(new THREE.Mesh(eye), "glow", { tint: "#e2ff86" });
    e.scale.set(0.055, 0.04, 0.02);
    e.position.x = side * 0.13;
    e.rotation.z = -side * 0.35;
    eyes.add(e);
  }
  body.add(eyes);

  // A soft column of purple light over the opening.
  const beamLight = { value: 0 };
  const beamGeo = new THREE.CylinderGeometry(0.5, 0.45, 1.5, 40, 1, true);
  beamGeo.translate(0, 0.75, 0);
  const beam = new THREE.Mesh(
    beamGeo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uLight: beamLight, uColor: { value: new THREE.Color("#8d4dff") } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLight;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float a = pow(1.0 - vUv.y, 1.8) * (0.75 + 0.25 * sin(vUv.x * 37.7 + vUv.y * 6.0));
          gl_FragColor = vec4(uColor, a * 0.32 * uLight);
          #include <colorspace_fragment>
        }`,
    }),
  );
  beam.scale.set((W - 2 * T) / 0.9, 1, (D - 2 * T) / 0.9);
  beam.position.y = H - 0.08;
  beam.renderOrder = 8;
  body.add(beam);

  // A dark glow pooling on the floor round it.
  const auraLight = { value: 0 };
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(38,12,60,0.7)");
  grad.addColorStop(0.55, "rgba(52,18,84,0.38)");
  grad.addColorStop(1, "rgba(60,20,90,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const auraTex = new THREE.CanvasTexture(c);
  auraTex.colorSpace = THREE.SRGBColorSpace;
  const aura = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 2.4),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { map: { value: auraTex }, uLight: auraLight },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform float uLight;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(map, vUv);
          gl_FragColor = vec4(c.rgb, c.a * uLight);
        }`,
    }),
  );
  aura.rotation.x = -Math.PI / 2;
  aura.position.y = 0.004;
  aura.renderOrder = -1;
  group.add(aura);

  return { group, body, lid, eyes, beam, beamLight, auraLight, rim: H, width: W - 2 * T, depth: D - 2 * T };
}

// ── Ghostly hands ─────────────────────────────────────────────────────────────

export interface GhostHand {
  /** The hand: fingers along +y, palm facing +z. Placed in world units. */
  root: THREE.Group;
  /** Finger and thumb joints: curl them by turning rotation.x (0 open … ~1.4 a fist). */
  fingers: THREE.Group[];
  /** The wispy arm back to the trunk; shaped with `reachArm`. */
  arm: THREE.Mesh;
}

export interface Ghosts {
  /** Lives at the world origin: hands and arms are placed in world units. */
  group: THREE.Group;
  hands: GhostHand[];
}

// Drawn in two passes: first only their depth, then their colour wherever
// they're nearest, so a ghost reads as one soft see-through shape with no
// fingers showing through the palm.
const ghostDepth = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, depthWrite: true });

function ghostly(geo: THREE.BufferGeometry): THREE.Mesh {
  const m = tag(new THREE.Mesh(geo), "ghost");
  m.renderOrder = 11;
  const depth = new THREE.Mesh(geo, ghostDepth);
  depth.renderOrder = 10;
  m.add(depth);
  return m;
}

const ARM_SEGS = 28;
const ARM_SIDES = 12;

function armGeometry(): THREE.BufferGeometry {
  const n = (ARM_SEGS + 1) * (ARM_SIDES + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const idx: number[] = [];
  for (let i = 0; i < ARM_SEGS; i++) {
    for (let j = 0; j < ARM_SIDES; j++) {
      const a = i * (ARM_SIDES + 1) + j;
      const b = a + ARM_SIDES + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  g.setIndex(idx);
  return g;
}

function ghosts(): Ghosts {
  const group = new THREE.Group();
  const palm = new THREE.SphereGeometry(1, 28, 20);
  const finger = new THREE.CapsuleGeometry(0.042, 0.085, 6, 14);
  finger.translate(0, 0.085 / 2 + 0.042, 0);
  const hands: GhostHand[] = [];
  for (let i = 0; i < 4; i++) {
    const root = new THREE.Group();
    const p = ghostly(palm);
    p.scale.set(0.14, 0.13, 0.085);
    root.add(p);
    const fingers: THREE.Group[] = [];
    [-0.075, -0.025, 0.025, 0.075].forEach((x, k) => {
      const joint = new THREE.Group();
      joint.position.set(x, 0.085, 0.01);
      joint.rotation.z = -x * 1.6;
      const f = ghostly(finger);
      f.scale.y = k === 1 || k === 2 ? 1.1 : 0.9;
      joint.add(f);
      root.add(joint);
      fingers.push(joint);
    });
    // A stubby thumb out to the side.
    const thumb = new THREE.Group();
    thumb.position.set(0.11, -0.01, 0.03);
    thumb.rotation.z = -1.05;
    thumb.add(ghostly(finger));
    root.add(thumb);
    fingers.push(thumb);
    // Every other one is a left hand.
    if (i % 2) root.scale.x = -1;
    const arm = ghostly(armGeometry());
    arm.frustumCulled = false;
    arm.children[0].frustumCulled = false;
    group.add(root, arm);
    hands.push({ root, fingers, arm });
  }
  return { group, hands };
}

const tube = {
  pts: Array.from({ length: ARM_SEGS + 1 }, () => new THREE.Vector3()),
  t: new THREE.Vector3(),
  n: new THREE.Vector3(),
  b: new THREE.Vector3(),
  v: new THREE.Vector3(),
};

/**
 * Shapes a hand's arm along `curve` from its start to `upTo` (0..1 of the
 * way), thin at the trunk (`r0`) and swelling to `r1` at the wrist.
 */
export function reachArm(hand: GhostHand, curve: THREE.Curve<THREE.Vector3>, upTo: number, r0: number, r1: number): void {
  const geo = hand.arm.geometry;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
  const { pts, t, n, b, v } = tube;
  for (let i = 0; i <= ARM_SEGS; i++) curve.getPoint((upTo * i) / ARM_SEGS, pts[i]);
  for (let i = 0; i <= ARM_SEGS; i++) {
    // Tangent from the neighbours, and a frame carried along without twisting.
    t.subVectors(pts[Math.min(i + 1, ARM_SEGS)], pts[Math.max(i - 1, 0)]);
    if (t.lengthSq() < 1e-12) t.set(0, 1, 0);
    t.normalize();
    if (i === 0) {
      n.set(t.y, -t.x, 0);
      if (n.lengthSq() < 1e-6) n.set(0, t.z, -t.y);
    }
    n.addScaledVector(t, -n.dot(t)).normalize();
    b.crossVectors(t, n);
    const u = i / ARM_SEGS;
    const r = r0 + (r1 - r0) * u * u * (3 - 2 * u);
    for (let j = 0; j <= ARM_SIDES; j++) {
      const a = (j / ARM_SIDES) * Math.PI * 2;
      v.copy(n).multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
      const k = i * (ARM_SIDES + 1) + j;
      nor.setXYZ(k, v.x, v.y, v.z);
      pos.setXYZ(k, pts[i].x + v.x * r, pts[i].y + v.y * r, pts[i].z + v.z * r);
    }
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
}

let builtExclaim: THREE.Sprite | null = null;

/** A little "!" for a start (Dogesh, when you're needed), built on first use. */
export function theExclaim(): THREE.Sprite {
  return (builtExclaim ??= glyph("!", "#d4552c"));
}

/** A letter that always faces you, drawn white-edged in `color` (each one its own material, so it can fade alone). */
export function glyph(text: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "bold 104px 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = 14;
  g.strokeStyle = "#ffffff";
  g.strokeText(text, 64, 70);
  g.fillStyle = color;
  g.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.renderOrder = 12;
  return sprite;
}

/** A dog biscuit shaped like a bone, held flat towards you. */
export function biscuit(): THREE.Group {
  const g = new THREE.Group();
  const bar = new THREE.CapsuleGeometry(0.036, 0.2, 6, 16);
  bar.rotateZ(Math.PI / 2);
  g.add(tag(new THREE.Mesh(bar), "dough", solid));
  const knob = new THREE.SphereGeometry(0.048, 16, 12);
  for (const x of [-0.13, 0.13]) {
    for (const y of [-0.03, 0.03]) {
      const k = tag(new THREE.Mesh(knob), "dough", solid);
      k.position.set(x, y, 0);
      k.scale.z = 0.8;
      g.add(k);
    }
  }
  return g;
}

/** A little "?" that always faces you. */
function question(): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "bold 104px 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = 14;
  g.strokeStyle = "#ffffff";
  g.strokeText("?", 64, 70);
  g.fillStyle = "#5b3f8c";
  g.fillText("?", 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.renderOrder = 12;
  return sprite;
}
