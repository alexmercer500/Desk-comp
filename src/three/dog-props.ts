// Things Dogesh Bhai's outfits bring along: the detective's magnifying glass,
// the chef's frying pan, and the two ways he changes outfit: a cartoon puff of
// smoke, and a folding dressing screen with clothes flying over the top.
// Built from simple shapes in the same toy / anime style as he is.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { OUTFITS } from "../skins/dogesh-outfits";
import { type TagOptions, tag } from "./looks";

const solid = { outline: true, cast: true, receive: true };

const tone = (color: string, shade: string): TagOptions => ({ ...solid, tint: color, shade });

/** A brass magnifying glass, held by its handle (the handle's end at the origin, the lens up +y). */
export function magnifier(): THREE.Group {
  const c = OUTFITS.detective.cloth;
  const g = new THREE.Group();
  const handle = new THREE.CapsuleGeometry(0.018, 0.12, 4, 10);
  handle.translate(0, 0.07, 0);
  g.add(tag(new THREE.Mesh(handle), "wood", tone(c.handle.color, c.handle.shade)));
  const rim = tag(new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.013, 10, 32)), "brass", tone(c.brass.color, c.brass.shade));
  rim.position.y = 0.23;
  g.add(rim);
  const lens = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.008, 28).rotateX(Math.PI / 2)), "lens", {
    tint: c.lens.color, shade: c.lens.shade,
  });
  lens.position.y = 0.23;
  g.add(lens);
  return g;
}

/** A frying pan, its bottom towards +z (held up in front of his face), its handle hanging down. */
export function fryingPan(): THREE.Group {
  const { pan: c, panHandle } = OUTFITS.chef.cloth;
  const g = new THREE.Group();
  const pts = [
    [0, -0.012], [0.15, -0.012], [0.175, 0.0], [0.19, 0.035], [0.178, 0.04], [0.163, 0.006], [0, 0.006],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(pts, 36).rotateX(-Math.PI / 2);
  g.add(tag(new THREE.Mesh(body), "iron", tone(c.color, c.shade)));
  const handle = new THREE.CapsuleGeometry(0.022, 0.2, 4, 10);
  handle.translate(0, -0.29, -0.01);
  g.add(tag(new THREE.Mesh(handle), "wood", tone(panHandle.color, panHandle.shade)));
  return g;
}

// ── The puff of smoke ─────────────────────────────────────────────────────────

export interface Puff {
  group: THREE.Group;
  /** Each cloud ball, with where it sits in the cloud and how big it gets. */
  balls: { mesh: THREE.Mesh; at: THREE.Vector3; size: number; delay: number; drift: THREE.Vector3 }[];
}

let builtPuff: Puff | null = null;

/** A cartoon smoke cloud big enough to hide him (balls start at zero size; the scene grows them). Built once. */
export function thePuff(): Puff {
  if (builtPuff) return builtPuff;
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 18, 12);
  const balls: Puff["balls"] = [];
  // Round a capsule from his feet to over his head, rings of balls, a few on top.
  const rings = [
    { y: 0.25, r: 0.5, n: 5, s: 0.3 }, { y: 0.75, r: 0.55, n: 6, s: 0.36 }, { y: 1.2, r: 0.58, n: 7, s: 0.4 },
    { y: 1.6, r: 0.5, n: 6, s: 0.38 }, { y: 1.95, r: 0.2, n: 3, s: 0.32 },
  ];
  let k = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.n; i++) {
      const a = (i / ring.n) * Math.PI * 2 + ring.y * 2.1;
      const at = new THREE.Vector3(Math.sin(a) * ring.r, ring.y, Math.cos(a) * ring.r * 0.9 + 0.2);
      const mesh = tag(new THREE.Mesh(geo), "puff", { outline: true });
      mesh.scale.setScalar(0.001);
      mesh.visible = false;
      mesh.position.copy(at);
      group.add(mesh);
      const out = new THREE.Vector3(at.x, 0, at.z - 0.1).normalize();
      balls.push({
        mesh, at, size: ring.s * (0.85 + 0.3 * ((k * 0.618) % 1)), delay: ((k * 0.37) % 1) * 0.12,
        drift: out.multiplyScalar(0.5).add(new THREE.Vector3(0, 0.6, 0)),
      });
      k++;
    }
  }
  // And a few more in front of his face (his long snout sticks out a long way).
  for (const [x, y, z, size] of [[-0.2, 1.38, 0.85, 0.32], [0.22, 1.3, 0.88, 0.34], [0, 1.62, 0.75, 0.32], [0, 1.08, 0.9, 0.32]]) {
    const at = new THREE.Vector3(x, y, z);
    const mesh = tag(new THREE.Mesh(geo), "puff", { outline: true });
    mesh.scale.setScalar(0.001);
    mesh.visible = false;
    group.add(mesh);
    balls.push({ mesh, at, size, delay: 0.04, drift: new THREE.Vector3(x * 2, 0.6, 0.4) });
  }
  builtPuff = { group, balls };
  return builtPuff;
}

// ── The folding dressing screen ───────────────────────────────────────────────

/** The screen's colours (the same whatever he's changing into): a wooden frame, cream cloth with soft rose stripes. */
const SCREEN = {
  wood: { color: "#9a6440", shade: "#744a2e" },
  cloth: { color: "#f1e3c4", shade: "#d9c7a2" },
  stripe: { color: "#e6b9a8", shade: "#c99a88" },
};
/** Flying clothes: a pale toe on a sock. */
const SOCK_TOE = "#f4efe6";

export interface Screen {
  group: THREE.Group;
  /** The hinged side panels (they fold in and out). */
  hinges: THREE.Group[];
}

let builtScreen: Screen | null = null;

const PANEL = { w: 0.46, h: 1.62 };

/** One panel: a wooden frame with cloth stretched in it, standing on little feet, centred on x. */
function panelMesh(): THREE.Group {
  const g = new THREE.Group();
  const wood = tone(SCREEN.wood.color, SCREEN.wood.shade);
  const { w, h } = PANEL;
  const post = new RoundedBoxGeometry(0.045, h, 0.045, 2, 0.015);
  const rail = new RoundedBoxGeometry(w, 0.045, 0.04, 2, 0.015);
  const parts = [
    post.clone().translate(-w / 2, h / 2 + 0.04, 0), post.clone().translate(w / 2, h / 2 + 0.04, 0),
    rail.clone().translate(0, h + 0.04, 0), rail.clone().translate(0, 0.2, 0),
  ];
  g.add(tag(new THREE.Mesh(mergeGeometries(parts)), "wood", wood));
  // The cloth, gently gathered (a wavy sheet), in soft stripes.
  const cloth = new THREE.PlaneGeometry(w - 0.03, h - 0.2, 16, 1);
  const pos = cloth.getAttribute("position");
  const uv = cloth.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    pos.setZ(i, Math.sin((pos.getX(i) / w) * Math.PI * 6) * 0.012);
    uv.setXY(i, uv.getX(i) * 5, uv.getY(i));
  }
  cloth.computeVertexNormals();
  cloth.translate(0, 0.2 + (h - 0.2) / 2 + 0.02, 0);
  g.add(tag(new THREE.Mesh(cloth), "stripes", { ...tone(SCREEN.cloth.color, SCREEN.cloth.shade), tint2: SCREEN.stripe.color, shade2: SCREEN.stripe.shade }));
  // Knobs on top of the posts.
  const knob = new THREE.SphereGeometry(0.035, 12, 8);
  const knobs = [knob.clone().translate(-w / 2, h + 0.085, 0), knob.clone().translate(w / 2, h + 0.085, 0)];
  g.add(tag(new THREE.Mesh(mergeGeometries(knobs)), "wood", wood));
  return g;
}

/** A three-panel folding screen, its middle panel facing +z, side panels angled back. Built once. */
export function theScreen(): Screen {
  if (builtScreen) return builtScreen;
  const group = new THREE.Group();
  const mid = panelMesh();
  group.add(mid);
  const hinges: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.x = side * (PANEL.w / 2 + 0.01);
    const p = panelMesh();
    p.position.x = side * (PANEL.w / 2 + 0.01);
    hinge.add(p);
    group.add(hinge);
    hinges.push(hinge);
  }
  builtScreen = { group, hinges };
  return builtScreen;
}

// ── Clothes that fly over the top ─────────────────────────────────────────────

/** A plain T-shirt (flat-ish, about 0.4 across) in `color`. */
export function shirt(color: string): THREE.Mesh {
  const body = new RoundedBoxGeometry(0.26, 0.3, 0.06, 2, 0.025);
  const sleeve = new RoundedBoxGeometry(0.14, 0.09, 0.055, 2, 0.02);
  const parts = [body, sleeve.clone().rotateZ(-0.5).translate(-0.17, 0.09, 0), sleeve.clone().rotateZ(0.5).translate(0.17, 0.09, 0)];
  return tag(new THREE.Mesh(mergeGeometries(parts)), "cloth", { ...solid, tint: color });
}

/** A sock in `color`, with a pale toe and heel. */
export function sock(color: string): THREE.Group {
  const g = new THREE.Group();
  const leg = new THREE.CapsuleGeometry(0.045, 0.16, 4, 10);
  leg.translate(0, 0.1, 0);
  const foot = new THREE.CapsuleGeometry(0.045, 0.1, 4, 10).rotateX(Math.PI / 2).translate(0, 0, 0.06);
  g.add(tag(new THREE.Mesh(mergeGeometries([leg, foot])), "cloth", { ...solid, tint: color }));
  const toe = tag(new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 8)), "cloth", { ...solid, tint: SOCK_TOE });
  toe.position.z = 0.12;
  g.add(toe);
  return g;
}
