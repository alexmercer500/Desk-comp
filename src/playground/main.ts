// Playground: drives the character through every state of the spec, at the
// sizes it will really be shown at, before it moves into the desktop window.

import { CharacterController } from "../engine/controller";
import { CHARACTER_NAMES, SKINS, isCharacter } from "../skins";

const FAST = { idleToSleepyMs: 6000, sleepyToSleepMs: 4000 };
const NORMAL = { idleToSleepyMs: 45_000, sleepyToSleepMs: 15_000 };

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const hero = $<HTMLCanvasElement>("#hero");
const c = new CharacterController(SKINS, "kulhi", FAST);

const picker = $<HTMLSelectElement>("#character");
picker.addEventListener("change", () => {
  if (!isCharacter(picker.value)) return;
  c.setCharacter(picker.value);
  $("#char-name").textContent = CHARACTER_NAMES[picker.value];
});
c.engine.addView(hero);
document.querySelectorAll<HTMLCanvasElement>(".previews canvas").forEach((cv) => c.engine.addView(cv));
c.engine.start();

// ── State readout and log ─────────────────────────────────────────────────────

const stateName = $("#state-name");
const stateLabel = $("#state-label");
const log = $("#log");
const t0 = performance.now();

c.onStateChange((from, to) => {
  stateName.textContent = to;
  stateLabel.textContent = c.label();
  hero.setAttribute("aria-label", c.label());
  const li = document.createElement("li");
  li.textContent = `${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${from} → ${to}`;
  log.prepend(li);
  while (log.children.length > 60) log.lastElementChild?.remove();
});

// ── Pointer: poke and gaze ────────────────────────────────────────────────────

hero.addEventListener("click", () => c.tap());
window.addEventListener("pointermove", (e) => c.setGazeTarget(e.clientX, e.clientY));

// ── Fake search input ─────────────────────────────────────────────────────────

const input = $<HTMLInputElement>("#fake-input");
input.addEventListener("focus", () => c.inputFocused(true));
input.addEventListener("blur", () => c.inputFocused(false));
input.addEventListener("input", () => c.userTyping());
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startWork();
});

// ── Buttons ───────────────────────────────────────────────────────────────────

const timeout = $<HTMLSelectElement>("#timeout");
const startWork = () => c.startWork({ timeoutMs: timeout.value === "none" ? null : Number(timeout.value) });

const actions: Record<string, () => void> = {
  boot: () => void c.boot(),
  activity: () => c.activity(),
  tap: () => c.tap(),
  start: startWork,
  high: () => c.finishWork({ confidence: 0.92 }),
  mid: () => c.finishWork({ confidence: 0.6 }),
  low: () => c.finishWork({ confidence: 0.15 }),
  error: () => c.finishWork({ confidence: 0, error: true }),
  pick: () => c.suggestionPicked(),
  notify: () => c.notify(),
  ack: () => c.acknowledge(),
};

document.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) => {
  b.addEventListener("click", () => actions[b.dataset.act!]?.());
});

// ── Options ───────────────────────────────────────────────────────────────────

const fast = $<HTMLInputElement>("#fast");
fast.addEventListener("change", () => c.configure(fast.checked ? FAST : NORMAL));

const reduced = $<HTMLInputElement>("#reduced");
const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
reduced.checked = mq.matches;
c.setReducedMotion(mq.matches);
reduced.addEventListener("change", () => c.setReducedMotion(reduced.checked));

const stage = $(".stage-wrap");
document.querySelectorAll<HTMLButtonElement>("[data-bg-set]").forEach((b) => {
  b.addEventListener("click", () => {
    stage.dataset.bg = b.dataset.bgSet!;
    document.querySelectorAll("[data-bg-set]").forEach((x) => x.classList.toggle("on", x === b));
  });
});

void c.boot();

// For automated checks from the console: window.__character.engine.advance(ms)
(window as unknown as { __character: CharacterController }).__character = c;
