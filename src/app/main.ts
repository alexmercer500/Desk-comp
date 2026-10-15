// The Desk Companion window: everything in one place, like a normal app.
// It opens when you start Desk Companion yourself (not when it starts with
// Windows), from the tray, or by starting it again while it runs.
//
// Pages: Home (connecting agents, their status, shortcuts), then the Settings
// sections, one per page. Settings are the very same rows as the panel's
// Settings tab (src/panel/settings.ts renders into #settings here too); this
// page only shows one section at a time. Above each page, the little
// characters wander along a coloured band and react when you poke them.

import { initTheme } from "../theme";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { Engine } from "../engine/engine";
import type { CharacterId, StateName, Variant } from "../engine/types";
import { CHARACTER_NAMES, SKINS } from "../skins";
import { SetupCard, loadConnections, renderBadges, since, type ConnectionsView } from "../panel/connections";
import { ruiPicture, setRuiStyle } from "../panel/rui-pictures";
import { refreshSettings } from "../panel/settings";

// Colours from the chosen theme, before anything is drawn.
initTheme();

type Page = "home" | "coding-agents" | "appearance" | "notifications" | "phone" | "ask-ai" | "system";

const PAGES: Record<Page, { title: string; lede: string }> = {
  home: { title: "Home", lede: "" },
  "coding-agents": { title: "Coding agents", lede: "Which agents I watch, whether they reach me, and what I tell you about." },
  appearance: { title: "Character", lede: "Who sits on your desktop, where, and how big." },
  notifications: { title: "Notifications", lede: "Breaks, battery, downloads and the rest. Agents have their own page." },
  phone: { title: "Phone", lede: "Desk Companion for Android: your agents on your phone." },
  "ask-ai": { title: "Ask (AI)", lede: "Questions about your PC, answered by Claude with your own key." },
  system: { title: "System and updates", lede: "Starting with Windows, updates, and this version." },
};

interface Prefs {
  character: string;
  ruiLook: string;
  ruiTheme: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const nav = document.getElementById("nav")!;
const band = document.getElementById("band")!;
const title = document.getElementById("page-title")!;
const lede = document.getElementById("page-lede")!;
const home = document.getElementById("home")!;
const settingsRoot = document.getElementById("settings")!;

/** Opened on a page (app.html#system), or Home. */
let page: Page = location.hash.slice(1) in PAGES ? (location.hash.slice(1) as Page) : "home";
let prefs: Prefs | null = null;
let connections: ConnectionsView | null = null;
let version = "";

// ── Pages ────────────────────────────────────────────────────────────────────

function show(next: Page) {
  page = next;
  for (const b of nav.querySelectorAll<HTMLButtonElement>("[data-page]")) {
    if (b.dataset.page === next) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  title.textContent = PAGES[next].title;
  band.style.setProperty("--band", `var(--band-${next})`);
  home.hidden = next !== "home";
  settingsRoot.hidden = next === "home";
  if (next === "home") drawHome();
  else void refreshSettings().then(showSection);
  drawLede();
  document.querySelector(".content")!.scrollTop = 0;
}

/** Only this page's Settings section (and the message line, which says what just happened). */
function showSection() {
  for (const s of settingsRoot.querySelectorAll<HTMLElement>("[data-section]")) s.hidden = s.dataset.section !== page;
}

function drawLede() {
  if (page !== "home") {
    lede.textContent = PAGES[page].lede;
    return;
  }
  const name = prefs ? (CHARACTER_NAMES[prefs.character as CharacterId] ?? "Rui") : "";
  const watching = connections?.agents.filter((a) => a.connected).length ?? 0;
  lede.textContent = watching
    ? `${name} is keeping an eye on ${watching === 1 ? "one coding agent" : `${watching} coding agents`}.`
    : `${name} is here. Connect a coding agent and I'll keep an eye on it.`;
}

for (const b of nav.querySelectorAll<HTMLButtonElement>("[data-page]")) {
  b.addEventListener("click", () => show(b.dataset.page as Page));
}
// Up and down move through the pages.
nav.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const all = [...nav.querySelectorAll<HTMLButtonElement>("[data-page]")];
  const at = all.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  const next = all[(at + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length];
  next.focus();
  show(next.dataset.page as Page);
});

// ── Home ─────────────────────────────────────────────────────────────────────

const setup = new SetupCard(
  () => drawHome(),
  () => show("coding-agents"),
  async () => {
    connections = await loadConnections();
    return connections;
  },
);
let testing = false;

function drawHome() {
  if (page !== "home") return;
  home.replaceChildren();
  const c = connections;
  const card = c ? setup.render(c) : null;
  if (card) home.append(card);

  // Coding agents: who's connected, and whether they reach me.
  const agents = el("section", "card");
  agents.append(el("h2", undefined, "Coding agents"));
  const connected = c?.agents.filter((a) => a.connected) ?? [];
  if (!c) agents.append(el("p", undefined, "Looking…"));
  else if (connected.length === 0) agents.append(el("p", undefined, "None connected yet."));
  else {
    const relay = c.relay;
    agents.append(
      el(
        "p",
        undefined,
        testing
          ? "Testing the connection…"
          : !relay
            ? "Hover a badge to see when I last heard from it."
            : relay.ok
              ? `Connection test passed ${since(Date.now() - relay.at)}. Hover a badge to see when I last heard from it.`
              : "",
      ),
    );
    const badges = renderBadges(c, () => show("coding-agents"));
    if (badges) agents.append(badges);
  }
  const actions = el("div", "card-actions");
  const manage = el("button", "set-button", "Manage agents");
  manage.type = "button";
  manage.addEventListener("click", () => show("coding-agents"));
  actions.append(manage);
  if (connected.length > 0) {
    const test = el("button", "set-button", testing ? "Testing…" : "Test the connection");
    test.type = "button";
    test.disabled = testing;
    if (testing) test.classList.add("set-progress", "set-progress-busy");
    test.addEventListener("click", async () => {
      testing = true;
      drawHome();
      await invoke("test_connection").catch(() => {});
      testing = false;
      connections = await loadConnections();
      drawHome();
    });
    actions.append(test);
  }
  agents.append(actions);
  home.append(agents);

  // Shortcuts to the other pages, each with a word on where things stand.
  const grid = el("div", "tiles-grid");
  const name = prefs ? (CHARACTER_NAMES[prefs.character as CharacterId] ?? "Rui") : "";
  const tiles: [Page, string, string][] = [
    ["appearance", "Character", name ? `${name} on your desktop` : "Who, where, how big"],
    ["notifications", "Notifications", "Breaks, battery, downloads"],
    ["phone", "Phone", "Notifications and Allow / Deny on Android"],
    ["system", "Updates", version ? `You have ${version}` : "Check for a new version"],
  ];
  for (const [to, head, sub] of tiles) {
    const t = el("button", "tile");
    t.type = "button";
    t.append(el("b", undefined, head), el("span", undefined, sub));
    t.addEventListener("click", () => show(to));
    grid.append(t);
  }
  home.append(grid);
  drawLede();
}

/** The sidebar's dot on Coding agents: agents that can't reach me. */
function drawAlert() {
  const b = nav.querySelector<HTMLButtonElement>('[data-page="coding-agents"]')!;
  const blocked = connections?.relay?.ok === false && connections.agents.some((a) => a.connected);
  if (blocked) {
    b.dataset.alert = "";
    b.title = "Your agents can't reach me";
  } else {
    delete b.dataset.alert;
    b.removeAttribute("title");
  }
}

async function refreshConnections() {
  connections = await loadConnections();
  drawAlert();
  if (page === "home") drawHome();
}

// ── The characters on the band ───────────────────────────────────────────────

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const stage = document.getElementById("stage")!;
const WALKERS: CharacterId[] = ["kulhi", "hexo", "glim", "billu", "dogesh"];
const SIZE = 72;

class Walker {
  readonly node = el("div", "walker");
  private engine: Engine | null = null;
  private x = 0;
  private dir = 1;
  private speed = 14 + Math.random() * 14;
  /** Standing still until then (ms, performance.now()). */
  private restUntil = 0;
  private busyUntil = 0;

  constructor(
    who: CharacterId | "rui",
    private min: () => number,
    private max: () => number,
  ) {
    if (who === "rui") {
      const img = el("img");
      img.alt = "";
      img.src = ruiPicture("idle");
      this.node.append(img);
      this.speed = 0;
    } else {
      const canvas = el("canvas");
      this.node.append(canvas);
      this.engine = new Engine(SKINS[who]);
      this.engine.addView(canvas);
      this.engine.setReducedMotion(reduced.matches);
      this.engine.setState("IDLE", null, 0);
      this.engine.start();
      this.node.title = CHARACTER_NAMES[who];
    }
    this.x = min() + Math.random() * Math.max(0, max() - min());
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.node.addEventListener("click", () => this.poke());
    this.place();
  }

  private place() {
    this.node.style.transform = `translateX(${Math.round(this.x)}px)`;
    this.node.classList.toggle("facing-left", this.dir < 0);
  }

  private set(state: StateName, variant: Variant = null) {
    this.engine?.setState(state, variant, 200);
  }

  /** Poked: a jolt (now and then a dizzy one), then a happy beat. */
  poke() {
    if (!this.engine) return;
    const now = performance.now();
    if (now < this.busyUntil) return;
    this.busyUntil = now + 2600;
    this.restUntil = this.busyUntil;
    this.set("TOUCHED", Math.random() < 0.3 ? "dizzy" : null);
    window.setTimeout(() => this.set("SUCCESS"), 1300);
    window.setTimeout(() => this.set("IDLE"), 2600);
  }

  step(dt: number, now: number) {
    if (this.speed === 0 || reduced.matches || now < this.restUntil) return;
    // Now and then, a pause to look round.
    if (Math.random() < dt * 0.12) {
      this.restUntil = now + 1200 + Math.random() * 2600;
      if (now > this.busyUntil && Math.random() < 0.4) {
        this.set("ATTENTIVE");
        window.setTimeout(() => now > this.busyUntil && this.set("IDLE"), 1500);
      }
      return;
    }
    this.x += this.dir * this.speed * dt;
    if (this.x < this.min()) {
      this.x = this.min();
      this.dir = 1;
    } else if (this.x > this.max()) {
      this.x = this.max();
      this.dir = -1;
    }
    this.place();
  }

  setHidden(hidden: boolean) {
    this.engine?.setHidden(hidden);
  }

  stop() {
    this.engine?.stop();
    this.node.remove();
  }
}

let walkers: Walker[] = [];

function cast() {
  for (const w of walkers) w.stop();
  const width = () => stage.clientWidth;
  // They keep to the right of the page's words, never under them.
  const left = () => Math.min(width() * 0.45, 420);
  const right = () => width() - SIZE - 16;
  walkers = WALKERS.map((who) => new Walker(who, left, right));
  if (prefs?.character === "rui") {
    setRuiStyle(prefs);
    walkers.push(new Walker("rui", right, right));
  }
  for (const w of walkers) stage.append(w.node);
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!document.hidden) for (const w of walkers) w.step(dt, now);
  requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange", () => {
  for (const w of walkers) w.setHidden(document.hidden);
});

// ── Start ────────────────────────────────────────────────────────────────────

// "Add in Ask" (Settings → Ask): the conversation lives in the character's panel.
window.addEventListener("settings:open-ask", () => void emitTo("companion", "panel:toggle", "ask"));

// Opened from the tray or the panel on a given page.
void listen<string>("home:page", ({ payload }) => {
  if (payload in PAGES) show(payload as Page);
});

void listen<Prefs>("prefs", ({ payload }) => {
  const who = prefs?.character;
  prefs = payload;
  if (payload.character !== who) cast();
  void refreshConnections();
});
void listen("connections", () => void refreshConnections());
// "Last heard" moves on.
window.setInterval(() => void refreshConnections(), 30_000);

async function start() {
  prefs = await invoke<Prefs>("get_prefs").catch(() => null);
  const s = await invoke<{ version: string }>("get_settings").catch(() => null);
  version = s?.version ?? "";
  document.getElementById("version")!.textContent = version ? `Version ${version}` : "";
  cast();
  requestAnimationFrame(frame);
  await refreshConnections();
  // Build the Settings rows once, so every page opens at once.
  await refreshSettings();
  showSection();
  show(page);
}

void start();
