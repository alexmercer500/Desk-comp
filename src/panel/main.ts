// The activity panel: every agent session by project — what it's doing now,
// what it's asking permission for, and what it finished, with its own summary.
//
// The companion window owns the data (AgentTracker) and pushes snapshots as
// "sessions"; this page only renders them. All text goes in via textContent.

import { initTheme } from "../theme";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ClickGuard } from "../bubble/guard";
import { renderQuestions } from "../bubble/question";
import { AGENT_NAMES, describeStep, elsewhere, lineTotals, turnMeta, type DayStats, type Permission, type SessionView, type Turn } from "../desktop/agents";
import type { Change } from "../desktop/diff";
import { ago, elapsed, firstLine, plural } from "../desktop/format";
import { Engine } from "../engine/engine";
import type { CharacterId, StateName } from "../engine/types";
import { SKINS, isCharacter } from "../skins";
import { focusAsk, refreshAsk, setCharacter } from "./ask";
import { SetupCard, loadConnections, renderBadges, type ConnectionsView } from "./connections";
import { poseFor, ruiPicture, setRuiStyle } from "./rui-pictures";
import { refreshSettings } from "./settings";

// Colours from the chosen theme, before anything is drawn.
initTheme();

const panelEl = document.querySelector<HTMLElement>(".panel")!;
const list = document.getElementById("list")!;
const count = document.getElementById("count")!;
const closeBtn = document.getElementById("close")!;

// ── Tabs ─────────────────────────────────────────────────────────────────────

export type Tab = "ask" | "activity" | "settings";
let tab: Tab = "ask";
/** Settings → Ask can switch the Ask tab off. */
let askEnabled = true;

const tabButtons = () => [...document.querySelectorAll<HTMLButtonElement>("[data-tab]")].filter((b) => !b.hidden);

function showTab(next: Tab) {
  if (next === "ask" && !askEnabled) next = "activity";
  tab = next;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    const on = b.dataset.tab === next;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  }
  for (const name of ["ask", "activity", "settings"] as const) {
    document.getElementById(`view-${name}`)!.hidden = next !== name;
  }
  if (next === "ask") void refreshAsk().then(focusAsk);
  else if (next === "settings") void refreshSettings();
  else {
    render();
    void refreshConnections();
  }
}

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
  b.addEventListener("click", () => showTab(b.dataset.tab as Tab));
  b.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // Visual order (top mode puts Home first), wrapping round.
    const shown = tabButtons().sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const at = shown.indexOf(b);
    const next = shown[(at + (e.key === "ArrowRight" ? 1 : shown.length - 1)) % shown.length];
    showTab(next.dataset.tab as Tab);
    next.focus();
  });
}

interface PanelPrefs {
  askEnabled?: boolean;
  character?: string;
  ruiLook?: string;
  ruiTheme?: string;
}

/** Settings changed (here, in the tray, or anywhere else). */
function applyPrefs(p: PanelPrefs) {
  setRuiStyle(p);
  if (p.character) ruiChosen = p.character === "rui";
  askEnabled = p.askEnabled !== false;
  document.getElementById("tab-ask")!.hidden = !askEnabled;
  if (tab === "ask" && !askEnabled) showTab("activity");
}
void listen<PanelPrefs>("prefs", ({ payload }) => {
  applyPrefs(payload);
  if (open && tab === "settings") void refreshSettings();
  // Rui's colour or look changed: the tiles' pictures follow.
  if (open && place === "top" && tab === "activity") render();
});
void invoke<PanelPrefs>("get_prefs").then(applyPrefs);
// Settings → API key → "Add in Ask".
window.addEventListener("settings:open-ask", () => showTab("ask"));

/** Steps shown per task before "+N earlier". */
const VISIBLE_STEPS = 8;

let sessions: SessionView[] = [];
let open = false;

/** Nothing is drawn while closed: if the window is ever left on screen (a
 *  reload, a restart), it's invisible as well as click-through. */
function setOpen(on: boolean) {
  open = on;
  document.body.classList.toggle("open", on);
}
let focusId: string | null = null;
/** Summaries the user expanded, kept across re-renders. */
const expanded = new Set<string>();
/** Finished tasks whose "What it did" is open (session:startedAt). */
const storyOpen = new Set<string>();
/** Allow / Deny that just appeared ignore clicks for a moment (re-armed each time the panel opens). */
const guard = new ClickGuard();
/** Changed files whose diff the user has opened (the panel redraws often). */
const diffOpen = new Set<string>();

// ── Rendering ────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render() {
  const now = Date.now();
  if (tab !== "activity") {
    const busy = sessions.filter((s) => s.status === "working" || s.status === "waiting").length;
    count.textContent = busy > 0 ? String(busy) : "";
    return;
  }
  const busy = sessions.filter((s) => s.status === "working" || s.status === "waiting").length;
  count.textContent = busy > 0 ? String(busy) : "";
  count.title = busy > 0 ? `${plural(busy, "active session")}` : "";

  const scroll = list.scrollTop;
  list.replaceChildren();
  if (place === "top") {
    renderIsland(now);
    list.scrollTop = scroll;
    return;
  }
  list.classList.remove("tiles");
  const setup = setupCard();
  if (setup) list.append(setup);
  const badges = connectionBadges();
  if (badges) list.append(badges);
  const summary = todayLine();
  if (summary) list.append(summary);
  if (sessions.length === 0) {
    const empty = el("div", "empty");
    empty.append(el("strong", undefined, "No agent sessions yet"));
    empty.append("Start a session in any connected agent and I'll keep an eye on it: what it's doing, what it asks, what it finished.");
    list.append(empty);
    return;
  }
  for (const s of sessions) list.append(renderSession(s, now));
  list.scrollTop = scroll;
}

function renderSession(s: SessionView, now: number): HTMLElement {
  const card = el("section", "session");
  card.dataset.status = s.status;
  card.dataset.id = s.id;
  if (s.id === focusId) card.classList.add("focus");

  const row = el("div", "row");
  row.append(el("span", "dot"), el("h2", undefined, s.project || "Unknown project"));
  row.append(el("span", "agent", AGENT_NAMES[s.agent] ?? s.agent));
  row.append(el("span", "status", statusText(s, now)));
  card.append(row);
  if (s.procs.length && s.status !== "ended") card.append(showWindowButton(s));

  if (s.permission) card.append(renderPerm(s.permission));

  // While a permission waits, the box above already says what it's about to do.
  if (s.current) card.append(...renderCurrent(s.current, now, !s.permission));
  s.history.forEach((t, i) => {
    // The latest finished task in full; older ones only when nothing is running.
    if (i === 0 || (!s.current && i < 3)) card.append(renderDone(s.id, t, i, now));
  });
  return card;
}

/** What it wants to do, with Allow / Deny / In terminal while the agent waits for us. */
function renderPerm(p: Permission): HTMLElement {
  const box = el("div", "perm");
  if (p.questions) {
    // Claude Code's question: answered with its options, here or in the terminal.
    box.append(el("div", "perm-label", p.headline ? `${p.headline}:` : p.questions.length > 1 ? "Has a few questions:" : "Has a question:"));
    if (p.rid) {
      const rid = p.rid;
      guard.armOnce(rid);
      const qs = el("div", "perm-questions");
      renderQuestions(qs, p.questions, (answers) => void emitTo("companion", "question:answer", { rid, answers }), { armed: () => guard.ready(rid) });
      qs.addEventListener("click", (e) => e.stopPropagation());
      const row = el("div", "perm-actions");
      const terminal = el("button", "act terminal", elsewhere(p.where ?? "your terminal"));
      terminal.type = "button";
      terminal.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!guard.ready(rid)) return;
        void emitTo("companion", "permission:answer", { rid, decision: "terminal" });
      });
      row.append(terminal);
      box.append(qs, row);
    } else {
      // Its choices too, so you know what you'll be picking from there.
      for (const q of p.questions) {
        box.append(el("p", "perm-question", q.question));
        for (const o of q.options) box.append(el("div", "perm-option", `• ${o.label}`));
      }
      box.append(el("div", "perm-hint", `Answer in ${p.where ?? "your terminal"}`));
    }
    return box;
  }
  box.append(el("div", "perm-label", `Wants to ${p.action}${p.detail ? ":" : ""}`));
  if (p.detail) box.append(el("pre", undefined, p.detail));
  if (p.rid) {
    const rid = p.rid;
    guard.armOnce(rid);
    const row = el("div", "perm-actions");
    const choices: [string, string][] = [["deny", "Deny"], ["terminal", elsewhere(p.where ?? "your terminal")]];
    if (p.canAlways) choices.push(["always", "Always"]);
    choices.push(["allow", "Allow"]);
    for (const [decision, label] of choices) {
      const b = el("button", `act ${decision}`, label);
      b.type = "button";
      if (decision === "always") b.title = "Allow, and don't ask again for this in this project";
      b.addEventListener("click", (e) => {
        e.stopPropagation(); // not a click on the tile behind it
        if (!guard.ready(rid)) return; // only just appeared under the cursor
        void emitTo("companion", "permission:answer", { rid, decision });
      });
      row.append(b);
    }
    box.append(row);
  } else {
    box.append(el("div", "perm-hint", `Answer in ${p.where ?? "your terminal"}`));
  }
  return box;
}

function renderCurrent(t: Turn, now: number, showNow: boolean): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (t.prompt) out.push(el("p", "prompt", t.prompt));
  const last = t.steps[t.steps.length - 1];
  if (last && showNow) {
    const nowLine = el("p", "now");
    nowLine.append("Now: ", el("b", undefined, describeStep(last)));
    out.push(nowLine);
  }
  if (t.steps.length > 1) {
    const ol = el("ol", "steps");
    const shown = t.steps.slice(-VISIBLE_STEPS);
    if (t.steps.length > shown.length) ol.append(el("li", "earlier", `+${t.steps.length - shown.length} earlier steps`));
    shown.forEach((st, i) => {
      const li = el("li");
      if (st.failed) li.classList.add("failed");
      if (i === shown.length - 1) li.classList.add("last");
      li.append(el("span", "tool", st.tool), el("span", "code", st.detail ?? ""));
      ol.append(li);
    });
    out.push(ol);
  }
  out.push(el("p", "meta so-far", currentMeta(t, now)));
  return out;
}

function currentMeta(t: Turn, now: number): string {
  const parts = [`${elapsed(now - t.startedAt)} so far`];
  if (t.files.length) parts.push(`${plural(t.files.length, "file")} edited`);
  const lines = lineTotals(t.changes);
  if (lines) parts.push(lines);
  if (t.commands) parts.push(plural(t.commands, "command"));
  return parts.join(" · ");
}

function renderDone(sessionId: string, t: Turn, index: number, now: number): HTMLElement {
  const box = el("div", "done");
  box.dataset.outcome = t.outcome;
  const head = el("div", "head");
  const outcome = t.outcome === "done" ? "Done" : t.outcome === "error" ? "Failed" : "Stopped";
  head.append(el("span", "outcome", outcome), el("span", undefined, `${turnMeta(t)} · ${ago(now - (t.endedAt ?? now))}`));
  box.append(head);
  if (t.prompt) box.append(el("p", "prompt", t.prompt));
  if (t.summary) {
    const key = `${sessionId}:${t.startedAt}`;
    const summary = el("p", "summary", t.summary);
    if (expanded.has(key)) summary.classList.add("open");
    box.append(summary);
    if (t.summary.length > 260 || t.summary.split("\n").length > 5) {
      const more = el("button", "more", expanded.has(key) ? "Show less" : "Show more");
      more.type = "button";
      more.addEventListener("click", () => {
        if (expanded.has(key)) expanded.delete(key);
        else expanded.add(key);
        render();
      });
      box.append(more);
    }
  } else if (index === 0 && t.files.length) {
    box.append(el("p", "summary", `Edited ${t.files.join(", ")}`));
  }
  if (t.steps.length) box.append(renderStory(`${sessionId}:${t.startedAt}`, t));
  return box;
}

/** The full story of a finished task: files changed, commands run, every step. */
function renderStory(key: string, t: Turn): HTMLElement {
  const story = el("details", "story");
  story.open = storyOpen.has(key);
  // The panel redraws often; remember what the user opened or closed.
  story.addEventListener("toggle", () => {
    if (story.open) storyOpen.add(key);
    else storyOpen.delete(key);
  });
  story.append(el("summary", undefined, `What it did · ${plural(t.steps.length, "step")}`));

  if (t.files.length) {
    const files = el("div", "story-part");
    files.append(el("h4", undefined, `Files changed (${t.files.length})`));
    const ul = el("ul", "story-list");
    for (const f of t.files) {
      const change = t.changes.find((c) => c.path === f);
      ul.append(change && change.add + change.del > 0 ? renderFileDiff(`${key}:${f}`, change) : el("li", "code", f));
    }
    files.append(ul);
    story.append(files);
  }

  const commands = t.steps.filter((st) => st.tool === "Bash" && st.detail);
  if (commands.length) {
    const part = el("div", "story-part");
    part.append(el("h4", undefined, `Commands (${commands.length})`));
    const ul = el("ul", "story-list");
    for (const st of commands) {
      const li = el("li", "code", st.detail ?? "");
      if (st.failed) li.classList.add("failed");
      ul.append(li);
    }
    part.append(ul);
    story.append(part);
  }

  const part = el("div", "story-part");
  part.append(el("h4", undefined, "Steps"));
  const ol = el("ol", "steps");
  for (const st of t.steps) {
    const li = el("li");
    if (st.failed) li.classList.add("failed");
    li.append(el("span", "tool", st.tool), el("span", "code", st.detail ?? ""));
    li.title = describeStep(st);
    ol.append(li);
  }
  part.append(ol);
  story.append(part);
  return story;
}

/** One changed file: its name and +N −M, opening into the lines that changed. */
function renderFileDiff(key: string, c: Change): HTMLElement {
  const li = el("li", "diff-item");
  const d = el("details", "diff");
  d.open = diffOpen.has(key);
  d.addEventListener("toggle", () => {
    if (d.open) diffOpen.add(key);
    else diffOpen.delete(key);
  });
  const head = el("summary");
  head.append(el("span", "code diff-name", c.path), el("span", "diff-add", `+${c.add}`), el("span", "diff-del", `−${c.del}`));
  d.append(head);
  if (c.hunks.length) {
    const body = el("div", "diff-lines");
    c.hunks.forEach((hunk, i) => {
      if (i > 0) body.append(el("div", "dl gap", "⋯"));
      for (const line of hunk) body.append(el("div", `dl ${line.t === "+" ? "add" : line.t === "-" ? "del" : "ctx"}`, `${line.t === " " ? " " : line.t} ${line.s}`));
    });
    if (c.truncated) body.append(el("div", "dl gap", "⋯ more lines not shown"));
    d.append(body);
  } else {
    const body = el("div", "diff-lines");
    body.append(el("div", "dl gap", "Too large to show line by line."));
    d.append(body);
  }
  li.append(d);
  return li;
}

function statusText(s: SessionView, now: number): string {
  switch (s.status) {
    case "waiting": return `Needs your OK · ${elapsed(now - (s.permission?.since ?? now))}`;
    case "working": return `Working · ${elapsed(now - (s.current?.startedAt ?? now))}`;
    case "ended": return "Closed";
    default: {
      const last = s.history[0];
      return last?.endedAt ? `Idle · ${ago(now - last.endedAt)}` : "Idle";
    }
  }
}

// ── Top mode: the island grown big ───────────────────────────────────────────
//
// When the character lives at the top edge, this window opens flush with the
// edge, like coucou's island: every session as a tile with its own little
// character showing how that session is doing. A tile opens the full story
// (the same card the desktop panel shows).

type Place = "corner" | "top";
let place: Place = "corner";
let character: CharacterId = "kulhi";
/** Rui is the character: tiles show still pictures of him instead of a 2D character. */
let ruiChosen = false;
/** The session whose full card is shown instead of the tiles. */
let detailId: string | null = null;

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

interface TileCharacter {
  readonly who: CharacterId | "rui";
  readonly node: HTMLElement;
  show(state: StateName): void;
  start(): void;
  stop(): void;
}

/** A small live character, one per tile. */
class Avatar implements TileCharacter {
  readonly node = el("canvas", "avatar");
  private engine: Engine;
  private state: StateName | null = null;

  constructor(readonly who: CharacterId) {
    this.engine = new Engine(SKINS[who]);
    this.engine.addView(this.node);
    this.engine.setReducedMotion(reduced.matches);
    this.node.setAttribute("aria-hidden", "true");
  }

  show(state: StateName) {
    if (state === this.state) return;
    this.engine.setState(state, null, this.state ? 300 : 0);
    this.state = state;
  }

  start() {
    this.engine.start();
  }

  stop() {
    this.engine.stop();
  }
}

/** Rui on a tile: a still picture of him in the session's mood (no 3D in the panel). */
class RuiAvatar implements TileCharacter {
  readonly who = "rui";
  readonly node = el("img", "avatar rui-avatar");

  constructor() {
    this.node.alt = "";
    this.node.decoding = "async";
  }

  show(state: StateName) {
    const pose = poseFor(state);
    const src = ruiPicture(pose);
    if (this.node.getAttribute("src") !== src) this.node.src = src;
    this.node.dataset.pose = pose;
  }

  start() {}
  stop() {}
}

const avatars = new Map<string, TileCharacter>();

function avatar(key: string): TileCharacter {
  let a = avatars.get(key);
  const who = ruiChosen ? "rui" : character;
  if (!a || a.who !== who) {
    a?.stop();
    a = who === "rui" ? new RuiAvatar() : new Avatar(who);
    avatars.set(key, a);
  }
  a.start();
  return a;
}

/** Stops and forgets the characters of tiles that aren't shown any more. */
function pruneAvatars(keep: Set<string>) {
  for (const [key, a] of avatars) {
    if (keep.has(key)) continue;
    a.stop();
    avatars.delete(key);
  }
}

/** How a session's character looks: busy, asking, pleased, sorry, or asleep. */
function moodOf(s: SessionView, now: number): StateName {
  if (s.status === "working") return "WORKING";
  if (s.status === "waiting") return "NOTIFY";
  if (s.status === "ended") return "SLEEPING";
  const last = s.history[0];
  if (last?.outcome === "error" && now - (last.endedAt ?? 0) < 2 * 60_000) return "ERROR";
  return "IDLE";
}

/** One line on what the session is doing, or how its last task went. */
function tileLine(s: SessionView): string {
  if (s.current) {
    const last = s.current.steps[s.current.steps.length - 1];
    return last ? describeStep(last) : "Thinking…";
  }
  const done = s.history[0];
  if (!done) return s.status === "ended" ? "Closed" : "Waiting for a task";
  const outcome = done.outcome === "done" ? "Done" : done.outcome === "error" ? "Failed" : "Stopped";
  return [outcome, turnMeta(done)].filter(Boolean).join(" · ");
}

function renderIsland(now: number) {
  const keep = new Set<string>();
  const detail = detailId ? sessions.find((s) => s.id === detailId) : undefined;
  list.classList.toggle("tiles", !detail);

  if (detail) {
    const back = el("button", "back", "‹ All sessions");
    back.type = "button";
    back.addEventListener("click", () => {
      detailId = null;
      render();
    });
    list.append(back, renderSession(detail, now));
  } else if (sessions.length === 0) {
    const setup = setupCard();
    if (setup) list.append(setup);
    const badges = connectionBadges();
    if (badges) list.append(badges);
    const empty = el("div", "empty");
    const a = avatar("self");
    a.show("IDLE");
    keep.add("self");
    empty.append(a.node, el("strong", undefined, "No agent sessions yet"));
    empty.append("Start a session in any connected agent and I'll keep an eye on it here.");
    list.append(empty);
  } else {
    const summary = todayLine();
    if (summary) list.append(summary);
    for (const s of sessions) {
      keep.add(s.id);
      list.append(renderTile(s, now));
    }
  }
  pruneAvatars(keep);
}

function renderTile(s: SessionView, now: number): HTMLElement {
  const tile = el("div", "tile");
  tile.dataset.status = s.status;
  tile.dataset.id = s.id;
  tile.tabIndex = 0;
  tile.setAttribute("role", "button");
  tile.setAttribute("aria-label", `${s.project || "Unknown project"}: ${statusText(s, now)}. Show details`);
  if (s.id === focusId) tile.classList.add("focus");

  const a = avatar(s.id);
  a.show(moodOf(s, now));

  const body = el("div", "tile-body");
  const row = el("div", "row");
  row.append(el("span", "dot"), el("h2", undefined, s.project || "Unknown project"));
  row.append(el("span", "agent", AGENT_NAMES[s.agent] ?? s.agent));
  body.append(row);
  // A waiting tile's permission box below already says what it wants.
  if (!s.permission) body.append(el("p", "tile-line", tileLine(s)));
  const prompt = s.current?.prompt ?? s.history[0]?.prompt;
  if (prompt) body.append(el("p", "tile-prompt", firstLine(prompt, 80)));
  body.append(el("p", "status", statusText(s, now)));
  tile.append(a.node, body);
  if (s.permission) tile.append(renderPerm(s.permission));

  const openDetail = () => {
    detailId = s.id;
    render();
  };
  tile.addEventListener("click", openDetail);
  tile.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openDetail();
    }
  });
  return tile;
}

// The window follows the island's content height (Rust clamps it).
new ResizeObserver(() => {
  if (place === "top" && open) void invoke("panel_fit", { height: Math.ceil(panelEl.getBoundingClientRect().height) });
}).observe(panelEl);

// ── Open / close ─────────────────────────────────────────────────────────────

function close() {
  if (!open) return;
  setOpen(false);
  focusId = null;
  detailId = null;
  pruneAvatars(new Set());
  void invoke("panel_hide");
  void emitTo("companion", "panel:closed");
}

closeBtn.addEventListener("click", close);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") close();
});
// Clicking anywhere else closes it, like a menu.
void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
  if (!focused) close();
});

void listen<SessionView[]>("sessions", ({ payload }) => {
  sessions = payload;
  if (open) render();
});

/** Today's totals, sent with the sessions. */
let today: DayStats | null = null;
void listen<DayStats>("stats", ({ payload }) => {
  today = payload;
});

/** "Today: 12 done · 1 failed · 2h 10m of agent work · asked you 5 times", or nothing yet. */
function todayLine(): HTMLElement | null {
  const t = today;
  if (!t || t.done + t.failed + t.asks === 0) return null;
  const parts = [`${t.done} done`];
  if (t.failed) parts.push(`${t.failed} failed`);
  if (t.workMs >= 60_000) parts.push(`${elapsed(t.workMs).replace(/ \d+s$/, "")} of agent work`);
  if (t.asks) parts.push(`asked you ${plural(t.asks, "time")}`);
  const line = el("p", "today");
  line.append(el("b", undefined, "Today"), ` · ${parts.join(" · ")}`);
  return line;
}

// ── Connections ──────────────────────────────────────────────────────────────
//
// Which agents are connected and whether they've been heard from, as small
// badges above the sessions; a card offering to connect the agents found on
// this PC while none is (connections.ts draws both, for the app window too).

let connections: ConnectionsView | null = null;
const setup = new SetupCard(() => render(), () => showTab("settings"), async () => {
  connections = await loadConnections();
  return connections;
});

async function refreshConnections() {
  connections = await loadConnections();
  if (open && tab === "activity") render();
}

const setupCard = () => (connections ? setup.render(connections) : null);
const connectionBadges = () => (connections ? renderBadges(connections, () => showTab("settings")) : null);

void listen("connections", () => void refreshConnections());
// Connecting or disconnecting in Settings (or the tray) broadcasts the prefs.
void listen("prefs", () => void refreshConnections());
// "Last heard" moves on while the panel is open.
window.setInterval(() => {
  if (open && tab === "activity") void refreshConnections();
}, 30_000);

/** Brings the session's terminal or editor window to the front. */
function showWindowButton(s: SessionView): HTMLElement {
  const b = el("button", "show-window", "Show window");
  b.type = "button";
  b.title = "Bring this session's terminal or editor to the front";
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    void emitTo("companion", "session:focus", s.id);
  });
  return b;
}

/** `tab` chosen by the companion; `focus` is an agent session to highlight. */
void listen<{ tab: Tab | null; focus: string | null; character?: string; place?: Place }>("panel:open", ({ payload }) => {
  guard.reset(); // its buttons are new under the cursor again
  setOpen(true);
  if (payload.character) setCharacter(payload.character);
  if (payload.character && isCharacter(payload.character)) character = payload.character;
  if (payload.character) ruiChosen = payload.character === "rui";
  place = payload.place === "top" ? "top" : "corner";
  document.body.dataset.place = place;
  focusId = payload.focus;
  // Opened on a session (from its "done", say): its latest task's story starts open.
  const latest = sessions.find((s) => s.id === payload.focus)?.history[0];
  if (payload.focus && latest) storyOpen.add(`${payload.focus}:${latest.startedAt}`);
  // Settings starts from the top each time it's opened.
  document.getElementById("settings")!.scrollTop = 0;
  // From a bubble about one session: go straight to its full card.
  detailId = place === "top" ? payload.focus : null;
  const waiting = sessions.some((s) => s.status === "waiting" || s.status === "working");
  // The island opens on its sessions (its home), like coucou's.
  showTab(payload.tab ?? (place === "top" || focusId || waiting ? "activity" : "ask"));
  if (focusId) list.querySelector(`[data-id="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: "nearest" });
});

void listen("panel:close", () => {
  setOpen(false);
  focusId = null;
  detailId = null;
  pruneAvatars(new Set());
});

// Timers ("Working · 2m 14s") tick while the panel is open. Only the time
// texts change, so focus and scroll stay where they are.
window.setInterval(() => {
  if (!open) return;
  const now = Date.now();
  for (const s of sessions) {
    const card = list.querySelector<HTMLElement>(`[data-id="${CSS.escape(s.id)}"]`);
    if (!card) continue;
    const status = card.querySelector(".status");
    if (status) status.textContent = statusText(s, now);
    const soFar = card.querySelector(".so-far");
    if (soFar && s.current) soFar.textContent = currentMeta(s.current, now);
  }
}, 1000);

document.getElementById("open-home")!.addEventListener("click", () => {
  void invoke("home_show", { page: "coding-agents" });
  close();
});

showTab("ask");
// Loaded (made on first open, or reloaded): the companion window answers with
// "panel:open" if it's meant to be open, or puts the window away if not.
void emitTo("companion", "panel:ready");
