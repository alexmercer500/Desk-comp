// Kulhi's website: the app's own characters as live stickers you can poke and
// peel off, a pretend agent whose card you answer, and download links that
// always point at the latest release.

import "@fontsource/shrikhand/400.css";
import "@fontsource-variable/schibsted-grotesk/index.css";
import "@fontsource/martian-mono/400.css";
import "./style.css";

import { CharacterController } from "@app/engine/controller";
import type { CharacterId } from "@app/engine/types";
import { SKINS, isCharacter } from "@app/skins";
import { startDemo } from "./demo";
import { links } from "./links";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

// ── Tilt: every sticker sits a little crooked, as stuck on by hand ───────────

for (const el of document.querySelectorAll<HTMLElement>("[data-tilt]")) {
  el.style.setProperty("--r", `${el.dataset.tilt}deg`);
}

// ── Live stickers ────────────────────────────────────────────────────────────

interface Live {
  el: HTMLElement;
  c: CharacterController;
}

const lives: Live[] = [];

function makeLive(el: HTMLElement): Live | null {
  const id = el.dataset.character ?? "";
  const canvas = el.querySelector("canvas");
  if (!canvas || !isCharacter(id)) return null;
  // Slower to doze than the app, so a visitor reading a section still finds them awake.
  const c = new CharacterController(SKINS, id as CharacterId, { idleToSleepyMs: 70_000, sleepyToSleepMs: 20_000 });
  c.engine.addView(canvas);
  c.setReducedMotion(reduced.matches);
  c.engine.start();
  void c.boot();
  return { el, c };
}

for (const el of document.querySelectorAll<HTMLElement>(".sticker.live")) {
  const live = makeLive(el);
  if (live) lives.push(live);
}

reduced.addEventListener("change", (e) => {
  for (const l of lives) l.c.setReducedMotion(e.matches);
});

// Only the ones on screen draw; the rest keep their clocks.
const seen = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const live = lives.find((l) => l.el === e.target);
      live?.c.engine.setHidden(!e.isIntersecting);
    }
  },
  { rootMargin: "120px" },
);
for (const l of lives) seen.observe(l.el);

// Every character's eyes follow the cursor.
window.addEventListener(
  "pointermove",
  (e) => {
    for (const l of lives) l.c.setGazeTarget(e.clientX, e.clientY);
  },
  { passive: true },
);

// ── Peel: pick a sticker up, carry it, stick it down somewhere else ──────────

const PEEL_AFTER_PX = 6;

for (const el of document.querySelectorAll<HTMLElement>(".sticker")) {
  const live = lives.find((l) => l.el === el);
  let start: { x: number; y: number; dx: number; dy: number } | null = null;
  let held = false;
  let last = { x: 0, y: 0, t: 0 };
  let offset = { x: 0, y: 0 };

  el.tabIndex = 0;
  el.setAttribute("role", "button");
  if (!el.hasAttribute("aria-label")) {
    const name = el.querySelector("canvas")?.getAttribute("aria-label") ?? el.querySelector("img")?.alt ?? "Sticker";
    el.setAttribute("aria-label", `${name}. Press to poke, or drag to peel it off.`);
  }

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, dx: offset.x, dy: offset.y };
    last = { x: e.clientX, y: e.clientY, t: performance.now() };
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener("pointermove", (e) => {
    if (!start) return;
    const mx = e.clientX - start.x;
    const my = e.clientY - start.y;
    if (!held && Math.hypot(mx, my) < PEEL_AFTER_PX) return;
    if (!held) {
      held = true;
      el.classList.add("is-held");
      live?.c.pickUp();
    }
    offset = { x: start.dx + mx, y: start.dy + my };
    el.style.setProperty("--dx", `${offset.x}px`);
    el.style.setProperty("--dy", `${offset.y}px`);
    const now = performance.now();
    const dt = Math.max(1, now - last.t) / 1000;
    live?.c.setCarry((e.clientX - last.x) / dt, (e.clientY - last.y) / dt);
    last = { x: e.clientX, y: e.clientY, t: now };
  });

  const end = () => {
    if (!start) return;
    if (held) {
      el.classList.remove("is-held");
      live?.c.drop();
    } else {
      live?.c.tap();
      el.classList.remove("is-poked");
      void el.offsetWidth; // restart the squish
      el.classList.add("is-poked");
    }
    start = null;
    held = false;
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);

  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    live?.c.tap();
  });
}

// ── The pretend agent, and the links ─────────────────────────────────────────

const demo = document.querySelector<HTMLElement>("[data-demo]");
const pal = lives.find((l) => l.el.hasAttribute("data-demo-pal"));
if (demo && pal) startDemo(demo, pal.c);

void links();
