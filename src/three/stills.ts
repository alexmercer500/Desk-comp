// Development only (rui-stills.html, driven by scripts/make-rui-stills.mjs):
// renders Rui's still pictures for the Settings panel, one per pose, look and
// colour, so the panel can show him without any 3D of its own.
//
//   ?sheet        a contact sheet of every pose over time, to choose the moments
//   (no query)    the final pictures, as JSON in #out: { "work-toy-mint": "data:image/webp;…" }

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Expression } from "./face";
import type { Cue, Rui as RuiType } from "./rui";

/** The same random numbers every run, so the pictures only change when he does. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = seeded(7);

const { LOOK_NAMES, THEME_NAMES } = await import("./palette");
const { lookShared, setTheme } = await import("./looks");
const { Rui } = await import("./rui");
type Look = (typeof LOOK_NAMES)[number];

/** The pictures the panel uses: a resting one, and one per agent-session mood (moodOf in src/panel/main.ts). */
const POSES: Record<string, { cue: Cue | null; mood?: Expression; t: number }> = {
  idle: { cue: null, mood: "happy", t: 1.5 },
  work: { cue: "work", t: 3.2 },
  call: { cue: "call", t: 1.6 },
  droop: { cue: "droop", t: 1.6 },
  sleep: { cue: "sleep", t: 13 },
};
const SIZE = 144;
const SHEET_TIMES = [1.1, 1.6, 3.2, 6, 8.5, 10, 11.5, 13, 15];

const sheet = new URLSearchParams(location.search).has("sheet");

const canvas = document.createElement("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.setPixelRatio(1);
// Drawn at twice the size and scaled down, for smooth edges.
renderer.setSize(SIZE * 2, SIZE * 2, false);
renderer.getDrawingBufferSize(lookShared.uRes.value);
lookShared.uWidth.value = 4.2;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
const studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;
const key = new THREE.DirectionalLight("#fff6ea", 2.2);
const back = new THREE.DirectionalLight("#dfe9ff", 1.1);
back.position.set(2.5, 3, -4);
scene.add(key, key.target, back);

// The desktop corner's camera (stage.ts), a touch closer: the pictures are small.
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
camera.position.set(0, 1.32, 5.25);
camera.lookAt(0, 1.12, 0);
camera.updateMatrixWorld();

const small = document.createElement("canvas");
small.width = small.height = SIZE;
const g = small.getContext("2d")!;
g.imageSmoothingQuality = "high";

function draw(look: Look): void {
  scene.environment = look === "toy" ? studio : null;
  back.visible = look === "toy";
  key.position.set(-1.4, 5, 3.2);
  key.target.position.set(0, 0.8, 0);
  lookShared.uLight.value.copy(key.position).sub(key.target.position).normalize()
    .transformDirection(camera.matrixWorldInverse);
  renderer.render(scene, camera);
  g.clearRect(0, 0, SIZE, SIZE);
  g.drawImage(canvas, 0, 0, SIZE, SIZE);
}

/** A fresh Rui doing `name` for `t` seconds. */
function posed(name: string, t: number): RuiType {
  Math.random = seeded(7);
  const pose = POSES[name];
  const rui = new Rui(scene);
  rui.naps = false;
  rui.autoLife = false;
  rui.bounds = 0;
  if (pose.mood) rui.mood = pose.mood;
  if (pose.cue) rui.play(pose.cue);
  for (let k = 0; k < Math.round(t * 60); k++) rui.update(1 / 60);
  return rui;
}

const out = document.getElementById("out")!;
window.addEventListener("error", (e) => (out.textContent = `ERROR ${e.message}`));
window.addEventListener("unhandledrejection", (e) => (out.textContent = `ERROR ${String(e.reason)}`));

if (sheet) {
  // Rows: poses. Columns: moments. Toy look, cream.
  const names = Object.keys(POSES);
  const sheetCanvas = document.createElement("canvas");
  sheetCanvas.width = SHEET_TIMES.length * SIZE;
  sheetCanvas.height = names.length * SIZE;
  const s = sheetCanvas.getContext("2d")!;
  s.fillStyle = "#d8d0c4";
  s.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);
  s.font = "12px sans-serif";
  names.forEach((name, row) => {
    SHEET_TIMES.forEach((t, col) => {
      const rui = posed(name, t);
      setTheme("cream");
      draw("toy");
      s.drawImage(small, col * SIZE, row * SIZE);
      s.fillStyle = "#000";
      s.fillText(`${name} ${t}s`, col * SIZE + 4, row * SIZE + 14);
      rui.root.removeFromParent();
    });
  });
  out.textContent = JSON.stringify({ sheet: sheetCanvas.toDataURL("image/png") });
} else {
  const pictures: Record<string, string> = {};
  for (const name of Object.keys(POSES)) {
    const rui = posed(name, POSES[name].t);
    for (const look of LOOK_NAMES) {
      rui.setLook(look);
      for (const theme of THEME_NAMES) {
        setTheme(theme);
        draw(look);
        pictures[`${name}-${look}-${theme}`] = small.toDataURL("image/webp", 0.86);
      }
    }
    rui.root.removeFromParent();
  }
  out.textContent = JSON.stringify(pictures);
}
