// Props for the change-colour scenes: a paint palette and brush, a wardrobe
// and a standing mirror. All built from simple rounded shapes in the same
// toy / anime style as Rui. The palette and brush are made fresh each time;
// the wardrobe and mirror are built once (ahead of time) and reused.

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
  const loose = [palette(), brush("#ffffff"), tablet("#ffffff")];
  all.add(theWardrobe().group, theMirror(), ...loose);
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

/** The one wardrobe, built on first use. Take it out of the scene with `removeFromParent` when done. */
export function theWardrobe(): Wardrobe {
  return (builtWardrobe ??= wardrobe());
}

/** The one mirror, built on first use. */
export function theMirror(): THREE.Group {
  return (builtMirror ??= mirror());
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
