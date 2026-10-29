// Kulhi's website: one day in Kulhi's life. The app's own characters, live
// (their eyes follow the cursor, a click says hello, they doze when night
// falls), a pretend agent whose card you answer, the nav's colour script
// following the time of day, and download links to the latest release.

import "@fontsource-variable/bricolage-grotesque/standard.css";
import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";

import { CharacterController } from "@app/engine/controller";
import type { CharacterId } from "@app/engine/types";
import { SKINS, isCharacter } from "@app/skins";
// Through the build, so the picture resolves in dev and in production alike.
import ruiStill from "@app/assets/rui/idle-anime-panda.webp";
import { startDemo } from "./demo";
import { links } from "./links";
import { inject } from "@vercel/analytics";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

// Rui is 3D in the app; here he's one of his own still pictures.
for (const plate of document.querySelectorAll<HTMLElement>("[data-rui]")) {
  const img = new Image(144, 144);
  img.className = "still";
  img.src = ruiStill;
  img.alt = "Rui, a 3D yeti in a hood";
  plate.append(img);
}

// ── Live characters ──────────────────────────────────────────────────────────

interface Live {
  el: HTMLElement;
  c: CharacterController;
}

const lives: Live[] = [];

for (const el of document.querySelectorAll<HTMLElement>(".live")) {
  const id = el.dataset.character ?? "";
  const canvas = el.querySelector("canvas");
  if (!canvas || !isCharacter(id)) continue;
  // Slower to doze than the app, so a visitor reading a section still finds them awake.
  const c = new CharacterController(SKINS, id as CharacterId, { idleToSleepyMs: 70_000, sleepyToSleepMs: 20_000 });
  c.engine.addView(canvas);
  c.setReducedMotion(reduced.matches);
  c.engine.start();
  void c.boot();
  lives.push({ el, c });
}

reduced.addEventListener("change", (e) => {
  for (const l of lives) l.c.setReducedMotion(e.matches);
});

// Only the ones on screen draw; the rest keep their clocks.
const seen = new IntersectionObserver(
  (entries) => {
    for (const e of entries) lives.find((l) => l.el === e.target)?.c.engine.setHidden(!e.isIntersecting);
  },
  { rootMargin: "120px" },
);
for (const l of lives) seen.observe(l.el);

window.addEventListener(
  "pointermove",
  (e) => {
    for (const l of lives) l.c.setGazeTarget(e.clientX, e.clientY);
  },
  { passive: true },
);

// A click (or Enter) says hello. The one in the nav is just the logo.
for (const l of lives) {
  if (l.el.closest(".brand")) continue;
  const name = l.el.querySelector("canvas")?.getAttribute("aria-label") ?? "Character";
  l.el.tabIndex = 0;
  l.el.setAttribute("role", "button");
  l.el.setAttribute("aria-label", `${name}. Click to say hello.`);
  const hello = () => {
    l.c.tap();
    l.el.classList.remove("is-poked");
    void l.el.offsetWidth; // restart the bounce
    l.el.classList.add("is-poked");
  };
  l.el.addEventListener("click", hello);
  l.el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    hello();
  });
}

// Night falls on the one in the phone scene; the sun wakes the one at the end.
const onScreen = (el: Element, fn: () => void) =>
  new IntersectionObserver(([e]) => e.isIntersecting && fn(), { threshold: 0.5 }).observe(el);
for (const l of lives) {
  if (l.el.hasAttribute("data-asleep")) {
    onScreen(l.el, () => {
      l.c.sleepNow();
      setTimeout(() => l.c.sleepNow(), 1500); // still waking from boot the first time
    });
  }
  if (l.el.hasAttribute("data-wake")) onScreen(l.el, () => l.c.tap());
}

// ── The colour script: which frame of the day you're in ──────────────────────

const navWrap = document.querySelector<HTMLElement>(".nav-wrap");
const chips = [...document.querySelectorAll<HTMLAnchorElement>(".script-strip a")];
const nowTime = document.querySelector<HTMLElement>("[data-now-time]");
const nowLabel = document.querySelector<HTMLElement>("[data-now-label]");
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
const scenes = [...document.querySelectorAll<HTMLElement>(".scene[id]")];

const showScene = (scene: HTMLElement) => {
  const css = getComputedStyle(scene);
  const bg = css.getPropertyValue("--nav").trim();
  const ink = css.getPropertyValue("--ink").trim();
  if (navWrap && bg) {
    navWrap.style.setProperty("--nav-bg", bg);
    navWrap.style.setProperty("--nav-ink", scene.id === "sunrise" ? "#2b1606" : ink);
  }
  if (themeColor && bg) themeColor.content = bg;
  for (const a of chips) a.setAttribute("aria-current", String(a.hash === `#${scene.id}`));
  if (nowTime) nowTime.textContent = scene.dataset.time ?? "";
  if (nowLabel) nowLabel.textContent = scene.dataset.label ?? "";
};

// The frame under a line just below the nav is the one you're in.
const where = new IntersectionObserver(
  (entries) => {
    for (const e of entries) if (e.isIntersecting) showScene(e.target as HTMLElement);
  },
  { rootMargin: "-12% 0px -87% 0px" },
);
for (const s of scenes) where.observe(s);

// ── The pretend agent, and the links ─────────────────────────────────────────

const demo = document.querySelector<HTMLElement>("[data-demo]");
const pal = lives.find((l) => l.el.hasAttribute("data-demo-pal"));
if (demo && pal) startDemo(demo, pal.c);

void links();

// Page views, through Vercel Web Analytics: no cookies, nothing that follows
// a visitor around. It only runs on the deployed site (and only once it's
// switched on in the Vercel project).
inject({ mode: import.meta.env.PROD ? "production" : "development", debug: false });
