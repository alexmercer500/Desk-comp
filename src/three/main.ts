/// <reference types="vite/client" />
// 3D prototype page: Rui (or Dogesh Bhai) on a see-through stage, with buttons
// for each behaviour and mood, the app's states, two looks (toy and anime), and
// a readout of what drawing him costs.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { DOG_EXPRESSIONS } from "./dog-face";
import { DOG_ACTIONS, Dogesh, type OutfitChange } from "./dogesh";
import { OUTFITS, OUTFIT_NAMES } from "../skins/dogesh-outfits";
import { EXPRESSIONS } from "./face";
import { Look, THEMES, THEME_NAMES, ThemeName, currentTheme, lookShared, themeColors } from "./looks";
import { prewarm } from "./props";
import { ACTIONS, ChangeStyle, Rui } from "./rui";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const canvas = $<HTMLCanvasElement>("#view");
const stage = $<HTMLDivElement>("#stage");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
const CAMERA = { near: { y: 1.2, z: 7, look: 1.0 }, wide: { y: 1.5, z: 9.6, look: 1.3 } };
camera.position.set(0, CAMERA.near.y, CAMERA.near.z);
camera.lookAt(0, CAMERA.near.look, 0);
/** 0 normal framing … 1 pulled back for a scene that needs room. */
let wideNow = 0;

function frameCamera(dt: number): void {
  wideNow += (char.wide - wideNow) * (1 - Math.exp(-dt * 3));
  const { near, wide } = CAMERA;
  const k = wideNow * wideNow * (3 - 2 * wideNow);
  camera.position.set(0, near.y + (wide.y - near.y) * k, near.z + (wide.z - near.z) * k);
  camera.lookAt(0, near.look + (wide.look - near.look) * k, 0);
}

// Studio lighting: a soft room for reflections, a key light that casts
// shadows, and a cool rim light from behind.
const pmrem = new THREE.PMREMGenerator(renderer);
const studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = studio;
scene.environmentIntensity = 0.75;

const key = new THREE.DirectionalLight("#fff6ea", 2.2);
key.position.set(-2, 4, 4);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = key.shadow.camera.bottom = -2.2;
key.shadow.camera.right = key.shadow.camera.top = 2.2;
key.shadow.camera.near = 1;
key.shadow.camera.far = 12;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
key.shadow.radius = 5;
scene.add(key, key.target);

const back = new THREE.DirectionalLight("#dfe9ff", 1.1);
back.position.set(2.5, 3, -4);
scene.add(back);

// The floor shows only the shadow falling on it.
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.16 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// ── The character: Rui or Dogesh Bhai ────────────────────────────────────────

type Who = "rui" | "dogesh";
type Char = Rui | Dogesh;
const NAMES: Record<Who, { name: string; blurb: string; aria: string }> = {
  rui: {
    name: "Rui",
    blurb: "Click Rui to poke him (or pop his nap bubble). Move the mouse and he watches you.",
    aria: "Rui, a small yeti in a hood",
  },
  dogesh: {
    name: "Dogesh Bhai",
    blurb: "Click Dogesh to startle him (gently!). Move the mouse and he watches you, nervously.",
    aria: "Dogesh Bhai, a timid little pup in a big knitted scarf",
  },
};

let who: Who = new URLSearchParams(location.search).get("who") === "dogesh" ? "dogesh" : "rui";
let char: Char = make(who);
let look: Look = "toy";

function make(w: Who): Char {
  return w === "dogesh" ? new Dogesh(scene) : new Rui(scene);
}

/** Swaps the character on stage for a fresh one (`w`), keeping the look and settings. */
function useCharacter(w: Who): void {
  const auto = char.autoLife;
  char.retire();
  who = w;
  char = make(w);
  char.autoLife = auto;
  setLook(look);
  resize();
  buildControls();
  const n = NAMES[w];
  $("#who-name").textContent = n.name;
  $("#who-blurb").textContent = n.blurb;
  canvas.setAttribute("aria-label", n.aria);
  document.title = `${n.name} 3D Prototype`;
  $("#colour-group").hidden = w !== "rui";
  $("#outfit-group").hidden = w !== "dogesh";
  document.querySelectorAll<HTMLButtonElement>("button[data-who]").forEach((b) => b.classList.toggle("on", b.dataset.who === w));
  void warm();
}

// ── Looks ─────────────────────────────────────────────────────────────────────

function setLook(next: Look): void {
  look = next;
  char.setLook(look);
  const toy = look === "toy";
  scene.environment = toy ? studio : null;
  back.visible = toy;
  floor.visible = toy;
}

/** Characters whose scenes are compiled already (once a page is plenty). */
const warmed = new Set<Who>();

/** Compiles everything his scenes use, then puts the chosen look back. */
async function warm(): Promise<void> {
  if (warmed.has(who)) return;
  warmed.add(who);
  if (char instanceof Dogesh) await char.prewarm(renderer, camera, scene);
  else await prewarm(renderer, camera, scene);
  setLook(look);
}

// ── Sizing ────────────────────────────────────────────────────────────────────

let sharpness = 2;

function resize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio * sharpness, 3));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(lookShared.uRes.value);
  lookShared.uWidth.value = 1.7 * renderer.getPixelRatio();
  // How far he can walk and still stay on stage.
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * CAMERA.near.z;
  char.bounds = Math.max(0, halfH * camera.aspect - 0.85);
}
new ResizeObserver(resize).observe(canvas);

// ── Controls ──────────────────────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  walk: "Walk", stroll: "Stroll", spin: "Spin", wave: "Wave", sit: "Sit (tired)",
  exercise: "Exercise", eat: "Eat", nap: "Nap",
  spook: "Spooked", hide: "Hide",
};
const DOG_LABELS: Record<string, string> = {
  spin: "Chase tail", exercise: "Shake off", eat: "Biscuit", sit: "Sit",
  stroll: "Tiptoe", walk: "Tiptoe across", whistle: "Whistle", scratch: "Scratch", mutter: "Mutter", peer: "Peer (detective)",
};
/** The app's states, as the desktop stage cues them (stage.ts). */
const CUES: [string, string][] = [
  ["call", "Needs you"], ["work", "Working"], ["hooray", "Success"], ["droop", "Error"],
  ["poke", "Poked"], ["dizzy", "Dizzy"], ["ponder", "Suggesting"], ["shrug", "Confused"],
  ["nod", "Nod"], ["boot", "Waking up"], ["doze", "Dozing"], ["sleep", "Asleep"],
  ["held", "Held"], ["land", "Landing"], ["hopRight", "Hop"], ["stand", "Stand / stop"],
];

function play(name: string): void {
  (char.play as (n: string) => void)(name);
}

function buildControls(): void {
  const actions = $("#actions");
  actions.innerHTML = "";
  const names: string[] = who === "dogesh" ? DOG_ACTIONS : ACTIONS;
  for (const name of names) {
    const b = document.createElement("button");
    b.textContent = (who === "dogesh" ? DOG_LABELS[name] : undefined) ?? LABELS[name] ?? name;
    b.addEventListener("click", () => play(name));
    actions.append(b);
  }

  const cues = $("#cues");
  cues.innerHTML = "";
  for (const [name, label] of CUES) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", () => play(name));
    cues.append(b);
  }

  const moods = $("#moods");
  moods.innerHTML = "";
  const list = Object.keys(who === "dogesh" ? DOG_EXPRESSIONS : EXPRESSIONS);
  for (const name of list) {
    if (name === "chew" || name === "ooh") continue;
    const b = document.createElement("button");
    b.textContent = name[0].toUpperCase() + name.slice(1);
    b.classList.toggle("on", name === char.mood);
    b.addEventListener("click", () => {
      (char as { mood: string }).mood = name;
      moods.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    });
    moods.append(b);
  }
}

$<HTMLInputElement>("#auto").addEventListener("change", (e) => {
  char.autoLife = (e.target as HTMLInputElement).checked;
});
$<HTMLSelectElement>("#sharpness").addEventListener("change", (e) => {
  sharpness = Number((e.target as HTMLSelectElement).value);
  resize();
});
$<HTMLSelectElement>("#shadows").addEventListener("change", (e) => {
  key.castShadow = (e.target as HTMLSelectElement).value === "on";
});
let fpsCap = 60;
$<HTMLSelectElement>("#fps").addEventListener("change", (e) => {
  fpsCap = Number((e.target as HTMLSelectElement).value);
});

function segment(attr: string, apply: (v: string) => void): void {
  document.querySelectorAll<HTMLButtonElement>(`button[data-${attr}]`).forEach((b) => {
    b.addEventListener("click", () => {
      b.parentElement!.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      apply(b.dataset[attr]!);
    });
  });
}
segment("bg", (v) => (stage.dataset.bg = v));
segment("size", (v) => {
  stage.classList.toggle("desk", v === "desk");
  resize();
});
segment("look", (v) => setLook(v as Look));
segment("who", (v) => {
  if (v !== who) useCharacter(v as Who);
});
$<HTMLInputElement>("#calm").addEventListener("change", (e) => {
  if (char instanceof Dogesh) char.calm = (e.target as HTMLInputElement).checked;
});

// ── Colour themes (Rui): pick one, then Apply plays a change-colour scene ────

const swatches = $("#swatches");
const applyBtn = $<HTMLButtonElement>("#apply-theme");
let picked: ThemeName = currentTheme();
/** The theme the swatches last showed as "now". */
let shownTheme = currentTheme();

function renderSwatches(): void {
  shownTheme = currentTheme();
  swatches.innerHTML = "";
  for (const name of THEME_NAMES) {
    const { body, accent } = themeColors(name);
    const b = document.createElement("button");
    b.className = "swatch";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(name === picked));
    b.innerHTML = `<span class="chip" style="background: linear-gradient(135deg, ${body} 55%, ${accent} 55%)"></span>${THEMES[name].label}`;
    if (name === currentTheme()) b.insertAdjacentHTML("beforeend", `<span class="now-tag">now</span>`);
    b.addEventListener("click", () => {
      picked = name;
      renderSwatches();
    });
    swatches.append(b);
  }
  applyBtn.disabled = picked === currentTheme();
}
renderSwatches();

applyBtn.addEventListener("click", () => {
  if (!(char instanceof Rui)) return;
  const how = $<HTMLSelectElement>("#change-style").value;
  char.applyTheme(picked, how === "random" ? undefined : (how as ChangeStyle));
  applyBtn.disabled = true;
});

// ── Outfits (Dogesh): picking one changes into it with a scene ──────────────

const outfitPick = $<HTMLSelectElement>("#outfit");
for (const name of OUTFIT_NAMES) outfitPick.add(new Option(OUTFITS[name].label, name));
const changeOutfit = () => {
  if (!(char instanceof Dogesh)) return;
  const how = $<HTMLSelectElement>("#outfit-style").value;
  char.changeOutfit(outfitPick.value, how === "random" ? undefined : (how as OutfitChange));
};
// Picking an outfit changes into it at once; Change plays it again (handy after switching the scene).
outfitPick.addEventListener("change", changeOutfit);
$<HTMLButtonElement>("#apply-outfit").addEventListener("click", changeOutfit);

// ── Pointer: watch it, poke him ───────────────────────────────────────────────

const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();
const head = new THREE.Vector3();

window.addEventListener("pointermove", (e) => {
  const r = canvas.getBoundingClientRect();
  char.headWorld(head).project(camera);
  const hx = r.left + ((head.x + 1) / 2) * r.width;
  const hy = r.top + ((1 - head.y) / 2) * r.height;
  char.lookAt((e.clientX - hx) / (r.width * 0.5), -(e.clientY - hy) / (r.height * 0.5));
});

canvas.addEventListener("click", (e) => {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (ray.intersectObject(char.hitTarget, true).length) char.tap();
});

// ── Loop and cost readout ─────────────────────────────────────────────────────

const perf = $("#perf");
const now = $("#now");
let last = performance.now();
let frames = 0;
let work = 0;
let since = last;
let frozen = false;

function draw(): void {
  // The shadow follows him as he walks.
  const x = char.root.position.x;
  key.position.set(x - 1.4, 5, 3.2);
  key.target.position.set(x, 0.8, 0);
  lookShared.uLight.value.copy(key.position).sub(key.target.position).normalize()
    .transformDirection(camera.matrixWorldInverse);
  renderer.render(scene, camera);
}

// Development only: freeze time and step it exactly, for checking poses.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __rui: {
      get rui() {
        return char;
      },
      setLook,
      useCharacter,
      /** Where he stands on the canvas, 0..1 across. */
      screenX() {
        return (char.root.getWorldPosition(new THREE.Vector3()).project(camera).x + 1) / 2;
      },
      freeze(on = true) {
        frozen = on;
      },
      advance(seconds: number) {
        for (let i = 0; i < Math.round(seconds * 60); i++) {
          char.update(1 / 60);
          frameCamera(1 / 60);
        }
        draw();
      },
      shoot,
    },
  });
}

interface Shot {
  label?: string;
  look?: Look;
  /** A behaviour or app cue to play. */
  play?: string;
  mood?: string;
  tap?: boolean;
  theme?: ThemeName;
  style?: ChangeStyle;
  /** Start from a fresh character standing still. */
  fresh?: boolean;
  calm?: boolean;
  /** Seconds to run before the picture. */
  t?: number;
  zoom?: number;
  /** Vertical centre of the crop, 0..1 down the canvas. */
  cy?: number;
}

/**
 * Development only: freezes time and lays out exact frames as a contact sheet
 * over the page; returns it as a PNG data URL too.
 */
function shoot(shots: Shot[], scale = 1, columns = 4): string {
  frozen = true;
  const cols = Math.min(columns, shots.length);
  const W = 240 * scale;
  const H = 270 * scale;
  const out = document.createElement("canvas");
  out.width = cols * W;
  out.height = Math.ceil(shots.length / cols) * H;
  const g = out.getContext("2d")!;
  g.fillStyle = "#d8d0c4";
  g.fillRect(0, 0, out.width, out.height);
  shots.forEach((s, i) => {
    if (s.fresh) {
      char.retire();
      char = make(who);
      resize();
      setLook(look);
    }
    if (s.calm !== undefined && char instanceof Dogesh) char.calm = s.calm;
    if (s.look) setLook(s.look);
    if (s.mood) (char as { mood: string }).mood = s.mood;
    if (s.play) play(s.play);
    if (s.tap) char.tap();
    if (s.theme && char instanceof Rui) char.applyTheme(s.theme, s.style);
    for (let k = 0; k < Math.round((s.t ?? 0) * 60); k++) {
      char.update(1 / 60);
      frameCamera(1 / 60);
    }
    draw();
    const z = s.zoom ?? 1;
    // The crop keeps the cell's shape, whatever the canvas size.
    const h = (canvas.height * 0.95) / z;
    const w = (h * W) / H;
    const sx = (char.root.getWorldPosition(new THREE.Vector3()).project(camera).x + 1) / 2;
    const x = (i % cols) * W;
    const y = Math.floor(i / cols) * H;
    g.drawImage(canvas, canvas.width * sx - w / 2, canvas.height * (s.cy ?? 0.5) - h / 2, w, h, x, y, W, H);
    g.fillStyle = "#000";
    g.font = `${Math.round(14 * scale)}px sans-serif`;
    g.fillText(s.label ?? "", x + 6, y + 16 * scale);
  });
  document.getElementById("montage")?.remove();
  const url = out.toDataURL();
  const img = new Image();
  img.src = url;
  img.id = "montage";
  img.style.cssText = "position:fixed;left:0;top:0;z-index:99;border:2px solid red";
  img.addEventListener("click", () => img.remove());
  document.body.append(img);
  return url;
}

function frame(t: number): void {
  requestAnimationFrame(frame);
  const dt = (t - last) / 1000;
  if (dt < 1 / fpsCap - 0.004) return;
  last = t;
  if (frozen) return;

  const t0 = performance.now();
  char.update(dt);
  frameCamera(dt);
  draw();
  work += performance.now() - t0;
  frames++;

  if (t - since >= 500) {
    const secs = (t - since) / 1000;
    const info = renderer.info.render;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const rows: [string, string][] = [
      ["Frames", `${Math.round(frames / secs)} fps`],
      ["Script + draw", `${(work / frames).toFixed(2)} ms a frame`],
      ["Draw calls", String(info.calls)],
      ["Triangles", info.triangles.toLocaleString()],
      ["Pixels", `${canvas.width} × ${canvas.height}`],
    ];
    if (mem) rows.push(["Page memory", `${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB`]);
    perf.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    now.textContent = char.current;
    if (currentTheme() !== shownTheme) renderSwatches();
    frames = 0;
    work = 0;
    since = t;
  }
}

useCharacter(who);
requestAnimationFrame(frame);
