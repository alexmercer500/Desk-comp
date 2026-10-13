// The desktop window: hosts the character and turns the mouse into its life.
//
// The Rust side (src-tauri/src/desktop.rs) owns the window: click-through
// outside the body, carrying it during a drag, settling it after a drop. This
// page decides what the character feels about it: tap or pick up, dangle and
// land, and pottering about its corner when nothing is happening.
//
// Or, when the user puts it at the top edge (tray → Where I live), it lives in
// a little island there instead (island.ts): no dragging about, no pottering.
//
// Rui, the 3D character, is drawn by his own stage (src/three/stage.ts),
// loaded only when he's chosen. The same controller still decides his state;
// its 2D engine then only keeps time ("headless").

import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { BubbleMessage } from "../bubble/types";
import { CharacterController } from "../engine/controller";
import type { CharacterId, StateName } from "../engine/types";
import { CHARACTER_NAMES, SKINS, isCharacter } from "../skins";
import { AgentTracker, type AgentEvent, type DayStats, type Decision, type StatsStore } from "./agents";
import { Companion, allowed, type Prefs, type SystemEvent } from "./companion";
import { Island, agentRows, agentStatus } from "./island";
import { phoneView } from "./phone";
import { playFor } from "./sounds";
import type { RuiStage } from "../three/stage";
import { isLook, isTheme } from "../three/palette";

const canvas = document.getElementById("character") as HTMLCanvasElement;
const islandEl = document.getElementById("island")!;
const status = document.getElementById("status")!;

const initialPrefs = await invoke<Prefs>("get_prefs");
/** The 2D character (with Rui, the one the controller keeps, unseen). */
let character: CharacterId = isCharacter(initialPrefs.character) ? initialPrefs.character : "kulhi";
let top = initialPrefs.place === "top";
/** Rui's stage while he's the character, else null. */
let stage: RuiStage | null = null;
/** On battery power (a laptop unplugged): Rui draws less often, or steps aside for a 2D character. */
let onBattery = await invoke<boolean>("on_battery").catch(() => false);
/** Why Rui (3D) can't be shown this session, once found out: no 3D graphics, or too slow. */
let ruiFailed: "start" | "slow" | null = null;

/** Rui is the chosen character and can be shown right now. */
function wantRui(): boolean {
  return prefs.character === "rui" && !ruiFailed && !(onBattery && prefs.ruiFlatOnBattery === true);
}

/** Tells the user once why a 2D character stands in for Rui this session. */
function ruiStandIn(reason: "start" | "slow") {
  ruiFailed = reason;
  void useRui(false);
  const why = reason === "start" ? "can't start on this PC's graphics" : "is running too slowly on this PC";
  const text = `My 3D self ${why}, so ${CHARACTER_NAMES[character]} is standing in for me.`;
  bubble.show({ id: "notice:rui", category: "notice", title: "Rui", text, kind: "info" });
}

// Agent runs can take minutes, so WORKING never times out on the desktop.
const c = new CharacterController(SKINS, character, { workTimeoutMs: null });
c.engine.addView(canvas);
c.engine.gazeOrigin = () => {
  const r = canvas.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.6 };
};
c.engine.start();

c.onStateChange((_, to) => {
  canvas.setAttribute("aria-label", c.label());
  status.textContent = c.label();
  stage?.setState(to, c.getVariant());
  refreshIsland();
});

// The controller's one-shot extras (a wiggle when poked while busy, a hop while
// pottering about) go to Rui too.
const engineOverlay = c.engine.overlay.bind(c.engine);
c.engine.overlay = (name) => {
  engineOverlay(name);
  stage?.overlay(name);
};

/** Shows Rui (loading his stage the first time) or goes back to the 2D character. */
async function useRui(on: boolean) {
  document.body.dataset.character = on ? "rui" : "flat";
  if (on && !stage) {
    const { RuiStage, ROOM } = await import("../three/stage");
    const view = document.createElement("canvas");
    view.id = "rui";
    view.setAttribute("aria-hidden", "true");
    canvas.after(view);
    try {
      stage = new RuiStage(view, top ? "island" : "corner");
    } catch (e) {
      // No WebGL (old or blocked graphics driver): the 2D character it is.
      console.warn("Rui couldn't start", e);
      view.remove();
      ruiStandIn("start");
      return;
    }
    stage.onSlow = () => ruiStandIn("slow");
    stage.setPowerSaving(onBattery);
    // See-through room round his square, for scenes and strolls (only used in the corner).
    stage.setRoom(ROOM);
    void invoke("set_room", { x: ROOM.x, top: ROOM.top });
    // His saved look and colour, straight on (the latest, in case they changed while he loaded).
    if (isLook(prefs.ruiLook)) stage.setLook(prefs.ruiLook);
    if (isTheme(prefs.ruiTheme)) stage.setTheme(prefs.ruiTheme);
    stage.setReducedMotion(reducedMotion.matches);
    stage.setState(c.getState(), c.getVariant());
    stage.setHidden(top && island.shapeNow() === "tucked");
    if (!fullscreen) stage.start();
  } else if (!on && stage) {
    void invoke("set_room", { x: 0, top: 0 });
    stage.dispose();
    document.getElementById("rui")?.remove();
    stage = null;
  }
  c.engine.setHeadless(on);
  reportHit();
}

/** The clickable part of the window: the character's body (the island reports its own). */
let lastHit = "";
function reportHit() {
  if (top) return;
  const rect = stage ? stage.hitRect() : SKINS[character].hit;
  const key = JSON.stringify(rect);
  if (key === lastHit) return;
  lastHit = key;
  void invoke("set_hit_rect", { rect });
}
// Rui moves about inside his window, so his clickable box follows him.
window.setInterval(() => {
  if (stage) reportHit();
}, 250);

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
c.setReducedMotion(reducedMotion.matches);
reducedMotion.addEventListener("change", (e) => {
  c.setReducedMotion(e.matches);
  stage?.setReducedMotion(e.matches);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

// ── Speech bubble (its own window, see src/bubble) ───────────────────────────

/** While a bubble is up the character stays put, so the bubble keeps pointing at it. */
let bubbleUntil = 0;

/** While a full-screen app has the display, bubbles wait here (the latest one). */
let fullscreen = false;
let heldBack: { msg: BubbleMessage; at: number } | null = null;

/** The current settings (Settings tab or tray), kept fresh by "prefs" events. */
let prefs: Prefs = initialPrefs;
/** Notifications on screen now (by id), so an update to one doesn't chime again. */
const shownIds = new Set<string>();

const bubble = {
  show(msg: BubbleMessage) {
    // Switched off, or notifications paused (Settings).
    if (!allowed(msg, prefs, Date.now())) return;
    // Rui reacts to some in his own way (a break: exercises with you).
    if (!shownIds.has(msg.id)) stage?.hint(msg.category);
    // A chime for a new notification, not for one that's only being updated.
    if (prefs.sounds && !shownIds.has(msg.id)) playFor(msg);
    shownIds.add(msg.id);
    if (fullscreen) {
      heldBack = { msg, at: performance.now() };
      return;
    }
    // At the top edge the island itself grows into the notification.
    if (top) {
      island.notify(msg);
      return;
    }
    // As long as the bubble itself stays up (src/bubble/main.ts), plus its fade.
    bubbleUntil = msg.sticky ? Infinity : performance.now() + (msg.detail ? 9200 : 6200);
    void emitTo("bubble", "bubble:show", msg);
  },
  hide(id: string | null = null) {
    if (id === null) shownIds.clear();
    else shownIds.delete(id);
    if (heldBack && (!id || heldBack.msg.id === id)) heldBack = null;
    bubbleUntil = 0;
    // Both, so nothing is left behind when switching between the two.
    island.dismiss(id);
    void emitTo("bubble", "bubble:hide", id);
  },
};

// ── Top edge (island.ts) ─────────────────────────────────────────────────────

/** States that don't need the island out: the character is just resting. */
const QUIET: ReadonlySet<StateName> = new Set(["OFF", "IDLE", "ATTENTIVE", "SLEEPY", "SLEEPING", "WAKING"]);

const byId = (id: string) => document.getElementById(id)!;
const island = new Island(
  islandEl,
  {
    inner: byId("island-inner"),
    text: byId("island-text"),
    more: byId("island-more"),
    measure: byId("island-measure"),
    card: byId("island-card"),
    cardBody: byId("island-card-body"),
    sparkles: byId("island-sparkles"),
    cardText: byId("island-card-text"),
    cardDetail: byId("island-card-detail"),
    cardMeta: byId("island-card-meta"),
    actions: byId("island-actions"),
    questions: byId("island-questions"),
    rows: byId("island-rows"),
  },
  {
    hit(rect) {
      if (top) void invoke("set_hit_rect", { rect });
    },
    hover() {
      if (island.isHovered()) c.activity();
      refreshIsland();
    },
    noticeClicked(msg) {
      c.acknowledge();
      if (msg.action === "settings") void openPanel(null, "settings");
      else if (msg.session) void openPanel(msg.session);
    },
    answer: (rid, decision) => void answerPermission(rid, decision),
    questionAnswered: (rid, answers) => void answerQuestion(rid, answers),
    cardShown: (rid) => void invoke("permission_shown", { rid }).catch(() => {}),
    rowClicked: (session) => void openPanel(session),
    // Tucked away to a thin tab: nothing to see, so nothing to draw.
    shape: (state) => {
      c.engine.setHidden(top && state === "tucked");
      stage?.setHidden(top && state === "tucked");
    },
  },
);

/** Set once everything below exists (the page wires itself up top to bottom). */
let islandReady = false;

/** Re-decides what the island shows. Cheap; called whenever anything changes. */
function refreshIsland() {
  if (!top || !islandReady) return;
  const sessions = agents.snapshot();
  island.setAgents(agentStatus(sessions), agentRows(sessions));
  island.setBusy(panelOpen || press !== null || performance.now() < bubbleUntil || !QUIET.has(c.getState()));
}

function applyPlace(nextTop: boolean) {
  top = nextTop;
  document.body.dataset.place = top ? "top" : "corner";
  island.setActive(top);
  stage?.setFraming(top ? "island" : "corner");
  if (top) refreshIsland();
  else {
    c.engine.setHidden(false);
    stage?.setHidden(false);
    lastHit = "";
    reportHit();
  }
}

// Full-screen app on our display: the window is parked by Rust; stop drawing
// entirely, and on return show what's still worth showing.
void listen<boolean>("fullscreen", ({ payload }) => {
  fullscreen = payload;
  if (payload) {
    c.engine.stop();
    stage?.stop();
    return;
  }
  c.engine.start();
  stage?.start();
  const back = heldBack;
  heldBack = null;
  if (back && (back.msg.sticky || performance.now() - back.at < 60_000)) bubble.show(back.msg);
});

// Results of tray actions (connecting Claude Code, start with Windows).
void listen<{ title: string; text: string; kind: BubbleMessage["kind"]; action?: "settings" }>("notice", ({ payload }) => {
  bubble.show({ id: `notice:${payload.title}`, category: "notice", ...payload });
});

// Character, size and place (and Rui's look and colour) from the tray or Settings.
void listen<Prefs>("prefs", ({ payload }) => {
  const before = prefs;
  prefs = payload;
  if (payload.phoneLink && !before.phoneLink) sendToPhone();
  if (stage) {
    if (isLook(payload.ruiLook)) stage.setLook(payload.ruiLook);
    // A new colour: he changes into it with a little scene.
    if (isTheme(payload.ruiTheme) && payload.ruiTheme !== before.ruiTheme) stage.changeTheme(payload.ruiTheme);
  }
  const showRui = wantRui();
  if (showRui !== (stage !== null) || (isCharacter(payload.character) && payload.character !== character)) {
    if (isCharacter(payload.character)) {
      character = payload.character;
      c.setCharacter(character);
    }
    void useRui(showRui).then(() => c.tap()); // a little hello from the newcomer
  }
  const nextTop = payload.place === "top";
  if (nextTop !== top) {
    closePanel();
    bubble.hide();
    applyPlace(nextTop);
    c.tap(); // "here I am"
  }
});

void listen<{ id: string; session: string | null; action?: string | null }>("bubble:clicked", ({ payload }) => {
  bubbleUntil = 0;
  c.acknowledge();
  // "Update available" opens Settings; a bubble about an agent session opens the panel on it.
  if (payload.action === "settings") void openPanel(null, "settings");
  else if (payload.session) void openPanel(payload.session);
});

// ── Coding agents (events from the companion-hook relay) ─────────────────────

/** Today's totals survive a restart (this window's own storage). */
const STATS_KEY = "desk-companion.today";
const statsStore: StatsStore = {
  load() {
    try {
      return JSON.parse(localStorage.getItem(STATS_KEY) ?? "null") as DayStats | null;
    } catch {
      return null;
    }
  },
  save(stats) {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch {
      // Storage unavailable: the totals start again tomorrow, that's all.
    }
  },
};
const agents = new AgentTracker(c, bubble, undefined, statsStore);

// "Show window" (panel): bring that session's terminal or editor to the front.
void listen<string>("session:focus", async ({ payload }) => {
  const s = agents.snapshot().find((x) => x.id === payload);
  if (!s?.procs.length) return;
  closePanel();
  const found = await invoke<boolean>("focus_session", { procs: s.procs, project: s.project }).catch(() => false);
  if (!found) bubble.show({ id: "notice:window", category: "notice", title: s.project, text: "Couldn't find that session's window.", kind: "info" });
});
void listen<AgentEvent>("agent", ({ payload }) => agents.handle(payload));
window.setInterval(() => agents.sweep(), 5000);

// Allow / Deny / In terminal, from the bubble or the panel. The decision goes
// to the relay that is holding the request open; it is the only path by which
// anything is ever allowed, and it always starts from a click.
void listen<{ rid: string; decision: Decision }>("permission:answer", ({ payload }) =>
  void answerPermission(payload.rid, payload.decision),
);

// Options picked for Claude Code's question (bubble, island or panel).
void listen<{ rid: string; answers: Record<string, string> }>("question:answer", ({ payload }) =>
  void answerQuestion(payload.rid, payload.answers),
);

async function answerQuestion(rid: string, answers: Record<string, string>) {
  const delivered = await invoke<boolean>("answer_question", { rid, answers }).catch(() => false);
  if (delivered) {
    agents.answered(rid);
    c.acknowledge();
  } else {
    agents.permissionClosed(rid); // too late: the terminal has it now
  }
}

async function answerPermission(rid: string, decision: Decision) {
  if (!["allow", "always", "deny", "terminal"].includes(decision)) return;
  const delivered = await invoke<boolean>("answer_permission", { rid, decision });
  if (delivered) {
    agents.answer(rid, decision);
    if (decision !== "terminal") c.acknowledge();
  } else {
    agents.permissionClosed(rid); // too late: the terminal has it now
  }
}
// The bubble put a permission or question card on screen; without this the
// agent is let go after a moment and asks in its terminal (agents.rs).
void listen<string>("permission:shown", ({ payload }) => void invoke("permission_shown", { rid: payload }).catch(() => {}));
// The relay stopped waiting: answered in the terminal, or out of time.
void listen<string>("permission-closed", ({ payload }) => agents.permissionClosed(payload));

// ── Activity panel (its own window, see src/panel) ───────────────────────────

let panelOpen = false;
/** When the panel last closed itself (click-away). A click on the character right
 *  after must not reopen it: that click is what closed it. */
let panelClosedAt = 0;

const sendSessions = () => {
  void emitTo("panel", "stats", agents.today());
  void emitTo("panel", "sessions", agents.snapshot());
};
agents.onChange = () => {
  if (panelOpen) sendSessions();
  refreshIsland();
  sendToPhone();
};

// ── Phone link (src-tauri/src/phone) ─────────────────────────────────────────

let phoneTimer = 0;
/** The session list for paired phones, a moment after the last change (bursts of steps arrive together). */
function sendToPhone() {
  if (!prefs.phoneLink) return;
  window.clearTimeout(phoneTimer);
  phoneTimer = window.setTimeout(() => {
    void invoke("phone_sessions", { sessions: phoneView(agents.snapshot()) }).catch(() => {});
  }, 250);
}
// "3 min ago" on the phone comes from updatedAt; a fresh list now and then keeps
// the rest (a request that timed out, a session that went quiet) up to date too.
window.setInterval(sendToPhone, 30_000);
sendToPhone();

// Allow / Deny from the phone: already on its way to the agent; close the card here.
void listen<{ rid: string; decision: Decision }>("phone:decided", ({ payload }) => {
  if (agents.answer(payload.rid, payload.decision)) c.acknowledge();
});
// Timers run out (bubbles, hover) without an event of their own.
window.setInterval(refreshIsland, 1000);

type Tab = "ask" | "activity" | "settings";

async function openPanel(focus: string | null = null, tab: Tab | null = null) {
  if (tab === "ask" && prefs.askEnabled === false) tab = "activity";
  panelOpen = true;
  bubble.hide();
  refreshIsland();
  sendSessions();
  lastOpen = { focus, tab, character: stage ? "rui" : character, place: top ? "top" : "corner" };
  await invoke("panel_show");
  await emitTo("panel", "panel:open", lastOpen);
}

/** What the panel was last opened with, to repeat when its page has only just loaded. */
let lastOpen: { focus: string | null; tab: Tab | null; character: string; place: string } | null = null;

function closePanel() {
  if (!panelOpen) return;
  panelOpen = false;
  void invoke("panel_hide");
  void emitTo("panel", "panel:close");
  refreshIsland();
}

function togglePanel() {
  if (panelOpen) closePanel();
  else if (performance.now() - panelClosedAt > 400) void openPanel();
}

void listen("panel:closed", () => {
  panelOpen = false;
  panelClosedAt = performance.now();
  refreshIsland();
});
// The panel page (re)loaded: give it the current sessions.
void listen("panel:ready", () => {
  sendSessions();
  // Just made (opened for the first time): the open message went out before
  // the page could hear it, so say it again. Reloaded while closed: put the
  // window away.
  if (panelOpen && lastOpen) void emitTo("panel", "panel:open", lastOpen);
  else void invoke("panel_hide");
});
// Tray → "Ask…" / "Show activity" / "Settings…".
void listen<Tab>("panel:toggle", ({ payload }) => void openPanel(null, payload));

// ── Device help: the Ask tab drives the character (spec Section 7) ───────────

/** Matches the assistant's 90 s request timeout, plus a little. */
const ASK_TIMEOUT_MS = 95_000;

void listen<boolean>("ask:focus", ({ payload }) => c.inputFocused(payload));
void listen("ask:typing", () => c.userTyping());
void listen("ask:start", () => c.startWork({ timeoutMs: ASK_TIMEOUT_MS }));
void listen("ask:picked", () => c.suggestionPicked());
void listen<{ kind?: string; confidence?: number; error?: boolean }>("ask:done", ({ payload }) => {
  if (payload.error) {
    c.finishWork({ confidence: 0, error: true });
  } else if (payload.kind === "suggestions") {
    c.finishWork({ confidence: 0.6 }); // "Did you mean one of these?"
  } else if (payload.kind === "unclear") {
    c.finishWork({ confidence: 0.1 }); // apologetic, asks to rephrase
  } else {
    c.finishWork({ confidence: payload.confidence ?? 0.5 });
  }
});

// ── Everyday companion: breaks, battery, downloads, welcome back ─────────────

const companion = new Companion(c, bubble, initialPrefs);
void listen<SystemEvent>("system", ({ payload }) => companion.handle(payload));
void listen<Prefs>("prefs", ({ payload }) => companion.setPrefs(payload));
window.setInterval(() => companion.tick(), 30_000);

// ── Cursor (reported by Rust, since the window is mostly click-through) ───────

/** Within this distance (logical px) the cursor counts as the user being around. */
const NEARBY = 220;

void listen<{ x: number; y: number }>("cursor", ({ payload }) => {
  c.setGazeTarget(payload.x, payload.y);
  stage?.lookAt(payload.x, payload.y);
  if (top) {
    island.cursor(payload.x, payload.y);
    return;
  }
  const s = canvas.clientWidth;
  const at = stage ? stage.center() : { x: s / 2, y: s * 0.6 };
  if (Math.hypot(payload.x - at.x, payload.y - at.y) < NEARBY) c.activity();
});

// ── Tap or pick up ───────────────────────────────────────────────────────────

/** Movement (px) that turns a press into a pick-up. */
const PICKUP_SLOP = 5;

let press: { x: number; y: number } | null = null;
let held = false;
let last = { x: 0, y: 0, t: 0 };
let vel = { x: 0, y: 0 };
let decay = 0;

// On the island (top mode) the whole island takes the press, not just the
// character; on the desktop the island box doesn't exist and it's the canvas.
islandEl.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  // The notification card and the session rows have buttons of their own.
  if ((e.target as Element).closest(".card, .rows")) return;
  (e.target as Element).setPointerCapture(e.pointerId);
  press = { x: e.screenX, y: e.screenY };
  last = { x: e.screenX, y: e.screenY, t: e.timeStamp };
  vel = { x: 0, y: 0 };
  held = false;
  void invoke("drag_begin");
  refreshIsland();
});

islandEl.addEventListener("pointermove", (e) => {
  if (!press) return;
  const dt = (e.timeStamp - last.t) / 1000;
  if (dt > 0) {
    const k = Math.min(1, dt * 12); // smooth the velocity over ~80 ms
    vel.x += ((e.screenX - last.x) / dt - vel.x) * k;
    vel.y += ((e.screenY - last.y) / dt - vel.y) * k;
  }
  last = { x: e.screenX, y: e.screenY, t: e.timeStamp };

  if (!held && Math.hypot(e.screenX - press.x, e.screenY - press.y) > PICKUP_SLOP) {
    held = true;
    canvas.classList.add("held");
    bubble.hide(); // it would be left pointing at an empty spot
    closePanel();
    // The island just slides along the edge; the character stays inside it.
    if (top) return;
    c.pickUp();
    // Pointer events stop when the hand is still: let the swing die down on its own.
    decay = window.setInterval(() => {
      if (performance.now() - last.t > 60) {
        vel.x *= 0.7;
        vel.y *= 0.7;
        c.setCarry(vel.x, vel.y);
        stage?.setCarry(vel.x, vel.y);
      }
    }, 50);
  }
  if (held && !top) {
    c.setCarry(vel.x, vel.y);
    stage?.setCarry(vel.x, vel.y);
  }
});

const release = () => {
  if (!press) return;
  press = null;
  canvas.classList.remove("held");
  window.clearInterval(decay);
  void invoke("drag_end");
  if (!held) onTap();
  else if (!top) c.drop();
  held = false;
  refreshIsland();
};

/** A click pokes the character and opens or closes the panel. Quick repeated
 *  clicks are poking (and eventually dizziness), so the panel waits a moment. */
const PANEL_CLICK_DELAY = 280;
let panelTimer = 0;
let lastTap = -Infinity;

function onTap() {
  c.tap();
  const now = performance.now();
  const quick = now - lastTap < PANEL_CLICK_DELAY;
  lastTap = now;
  window.clearTimeout(panelTimer);
  if (!quick) panelTimer = window.setTimeout(togglePanel, PANEL_CLICK_DELAY);
}
islandEl.addEventListener("pointerup", release);
islandEl.addEventListener("pointercancel", release);
islandEl.addEventListener("contextmenu", (e) => e.preventDefault());

// ── Pottering about the corner ───────────────────────────────────────────────

let nextWander = performance.now() + rand(15_000, 30_000);
let wandering = false;

window.setInterval(async () => {
  const now = performance.now();
  if (top || c.getState() !== "IDLE" || press || reducedMotion.matches || now < bubbleUntil || panelOpen) {
    nextWander = Math.max(nextWander, now + 5_000);
    return;
  }
  if (wandering || now < nextWander) return;

  wandering = true;
  let dir = Math.random() < 0.5 ? -1 : 1;
  const hops = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < hops && c.getState() === "IDLE" && !press; i++) {
    const moved = await invoke<number>("hop_by", { dx: dir * 22, ms: 380 });
    if (Math.abs(moved) < 1) {
      dir = -dir; // hit the edge of its patch: turn round next time
      continue;
    }
    c.engine.overlay(moved < 0 ? "hopLeft" : "hopRight");
    await sleep(460);
  }
  wandering = false;
  nextWander = performance.now() + rand(18_000, 40_000);
}, 1000);

// ── Tray "Try a reaction" ────────────────────────────────────────────────────

const results: Record<string, { confidence: number; error?: boolean }> = {
  success: { confidence: 0.9 },
  suggest: { confidence: 0.6 },
  confused: { confidence: 0.1 },
  error: { confidence: 0, error: true },
};

/** A fake coding-agent session, so the agent flow can be tried without any hooks installed. */
const DEMO_CWD = "C:\\Projects\\demo-shop";
function demoAgent(event: string, extra: Partial<AgentEvent> = {}) {
  agents.handle({
    agent: "claude-code", event, session: "demo", cwd: DEMO_CWD,
    tool: null, detail: null, message: null, kind: null, ...extra,
  });
}
const demoStep = (tool: string, detail: string) => {
  demoAgent("PreToolUse", { tool, detail });
  demoAgent("PostToolUse", { tool });
};

void listen<string>("demo", async ({ payload }) => {
  if (payload === "agent-permission") {
    demoAgent("UserPromptSubmit", { prompt: "Add Stripe checkout to the cart page" });
    demoStep("Read", `${DEMO_CWD}\\src\\cart.ts`);
    await sleep(1500);
    demoAgent("PreToolUse", { tool: "Bash", detail: "npm install stripe @stripe/stripe-js" });
    demoAgent("PermissionRequest", { tool: "Bash", detail: "npm install stripe @stripe/stripe-js" });
  } else if (payload === "agent-done") {
    demoAgent("UserPromptSubmit", { prompt: "Fix the rounding bug in the cart total" });
    demoStep("Grep", "toFixed");
    demoStep("Read", `${DEMO_CWD}\\src\\cart.ts`);
    await sleep(1500);
    demoStep("Edit", `${DEMO_CWD}\\src\\cart.ts`);
    demoStep("Edit", `${DEMO_CWD}\\src\\cart.test.ts`);
    demoStep("Bash", "npm test -- cart");
    await sleep(2500);
    demoAgent("Stop", {
      summary:
        "Fixed the cart total rounding: prices are now summed in cents and formatted once at the end, " +
        "so 0.1 + 0.2 no longer shows as 0.30000000000000004. Added two tests for mixed quantities; all 48 tests pass.",
    });
  } else if (payload === "break") {
    c.notify();
    bubble.show({ id: "system:Break time", title: "Break time", text: "Chai break? You've been at it for 50 minutes.", kind: "attention" });
  } else if (payload === "battery") {
    companion.handle({ kind: "batteryLow", percent: 18, critical: false });
  } else if (payload === "download") {
    companion.handle({ kind: "download", name: "invoice-october.pdf", count: 1 });
  } else if (payload === "notify") {
    c.notify();
  } else if (payload === "sleep") {
    c.sleepNow();
  } else if (results[payload]) {
    c.startWork();
    await sleep(3000);
    c.finishWork(results[payload]);
  }
});

// Plugged in or unplugged: Rui saves power, or steps aside for a 2D character if asked to.
void listen<boolean>("power", ({ payload }) => {
  onBattery = payload;
  stage?.setPowerSaving(payload);
  const showRui = wantRui();
  if (showRui !== (stage !== null)) void useRui(showRui).then(() => c.tap());
});

islandReady = true;
applyPlace(top);
if (wantRui()) await useRui(true);
await c.boot();
