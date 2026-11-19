// Kulhi's website. The app's own characters, live (their eyes follow the
// cursor, a click says hello, one dozes beside the phone), a pretend agent
// whose card you answer, and download links to the latest release.

import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";

import { CharacterController } from "@app/engine/controller";
import type { CharacterId } from "@app/engine/types";
import { SKINS, isCharacter } from "@app/skins";
// Through the build, so the picture resolves in dev and in production alike.
import ruiStill from "@app/assets/rui/idle-anime-panda.webp";
import { startDemo } from "./demo";
import { links } from "./links";
import { theme } from "./theme";
import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";

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

// The one beside the phone is asleep; the one at the end wakes as you arrive.
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

// ── The pretend agent, and the links ─────────────────────────────────────────

const demo = document.querySelector<HTMLElement>("[data-demo]");
const pal = lives.find((l) => l.el.hasAttribute("data-demo-pal"));
if (demo && pal) startDemo(demo, pal.c);

// ── The real recording: plays while it's on screen, never by itself for
// visitors who asked for less motion (they get the poster and the controls).
const film = document.querySelector<HTMLVideoElement>("[data-film]");
if (film) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    film.autoplay = false;
    film.removeAttribute("autoplay");
    film.pause();
  } else {
    film.autoplay = false; // the observer decides
    new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void film.play().catch(() => {});
        else film.pause();
      },
      { threshold: 0.35 },
    ).observe(film);
  }
}

theme();
void links();

// Page views, through Vercel Web Analytics: no cookies, nothing that follows
// a visitor around. It only runs on the deployed site (and only once it's
// switched on in the Vercel project).
inject({ mode: import.meta.env.PROD ? "production" : "development", debug: false });
// How fast the page loads for real visitors (Vercel Speed Insights), on the
// deployed site only.
if (import.meta.env.PROD) injectSpeedInsights();
