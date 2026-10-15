// Top mode: the character lives in a little island at the top edge of the
// screen, the way coucou does on Windows. One shape that grows and shrinks
// with what's going on:
//
//   tucked  a thin tab: nothing is happening
//   peek    just the character: the cursor is at the edge, or it's reacting
//   status  a pill with a line: an agent is working, or waiting for an OK
//   list    hovering the pill: one row per busy session, what each is doing
//   notice  a card: a notification (a finished task, a permission with
//           Allow / Deny, a break reminder), then back to whatever was before
//
// In top mode notifications live here instead of the bubble window. The Rust
// side sizes the window (desktop.rs, ISLAND_W × ISLAND_H) and keeps it on the
// top edge; this decides what the island shows and how big it is.

import { ClickGuard } from "../bubble/guard";
import { renderQuestions, type Answers } from "../bubble/question";
import type { BubbleKind, BubbleMessage } from "../bubble/types";
import { describeStep, type Decision, type SessionView } from "./agents";
import { firstLine } from "./format";

export type IslandState = "tucked" | "peek" | "status" | "list" | "notice";

export interface IslandStatus {
  tone: "working" | "attention";
  text: string;
  /** Secondary, muted: what it's doing now, or how many more sessions. */
  more?: string;
}

/** One busy session, as a row of the hover list. */
export interface IslandRow {
  id: string;
  tone: "working" | "attention";
  project: string;
  line: string;
}

/** Tucked tab, the open head (character only), and the wider shapes, logical px. */
const TAB = { w: 84, h: 5 };
const HEAD_H = 52;
const PEEK_W = 74;
const MAX_STATUS_W = 440;
const LIST_W = 440;
const NOTICE_W = 380;
/** A finished task gets a bigger card, like coucou's (the window is ISLAND_W wide in desktop.rs). */
const CELEBRATE_W = 560;
/** Sparks drifting up behind a finished task. */
const SPARKS = 26;
/** Rows shown in the hover list. */
const MAX_ROWS = 4;
/** Pushing the cursor this close to the top edge brings the island out. */
const EDGE_PX = 4;
/** Half the width of the strip along the edge that counts. */
const EDGE_REACH = 120;
/** The island stays out while the cursor is this close to it… */
const HOVER_MARGIN = 18;
/** …and this long after it leaves. */
const LEAVE_MS = 700;
/** How long a notification stays (longer with more to read), and how long
 *  after the cursor leaves it if the user was reading it. */
const NOTICE_MS = 6000;
const NOTICE_MS_DETAIL = 9000;
const NOTICE_AFTER_HOVER_MS = 2000;

/**
 * What the island shows. A notification wins; then hovering a busy island
 * lists the sessions; then the status line; then the character on its own
 * while anything else is going on; otherwise just the tab.
 */
export function islandState(o: { notice: boolean; status: IslandStatus | null; hover: boolean; busy: boolean }): IslandState {
  if (o.notice) return "notice";
  if (o.status) return o.hover ? "list" : "status";
  return o.hover || o.busy ? "peek" : "tucked";
}

/** The status line for the agent sessions: who needs an OK, or who is working on what. */
export function agentStatus(sessions: SessionView[]): IslandStatus | null {
  const waiting = sessions.filter((s) => s.status === "waiting");
  const working = sessions.filter((s) => s.status === "working");
  if (waiting.length) {
    const others = waiting.length + working.length - 1;
    return { tone: "attention", text: `${name(waiting[0])} needs your OK`, more: others > 0 ? `+${others}` : undefined };
  }
  if (working.length > 1) return { tone: "working", text: `${working.length} agents working` };
  if (working.length === 1) return { tone: "working", text: name(working[0]), more: nowLine(working[0], 44) };
  return null;
}

/** The busy sessions as rows for the hover list, the ones waiting for an OK first. */
export function agentRows(sessions: SessionView[]): IslandRow[] {
  return sessions
    .filter((s) => s.status === "waiting" || s.status === "working")
    .sort((a, b) => Number(b.status === "waiting") - Number(a.status === "waiting"))
    .slice(0, MAX_ROWS)
    .map((s) => ({
      id: s.id,
      tone: s.status === "waiting" ? "attention" : "working",
      project: name(s),
      line: s.permission ? `wants to ${s.permission.action}` : nowLine(s, 110),
    }));
}

const name = (s: SessionView) => s.project || "Agent";

function nowLine(s: SessionView, max: number): string {
  const last = s.current?.steps[s.current.steps.length - 1];
  return last ? firstLine(describeStep(last), max) : "Thinking…";
}

export interface IslandParts {
  inner: HTMLElement;
  text: HTMLElement;
  more: HTMLElement;
  measure: HTMLElement;
  /** The notification card: its readable part, and the Allow / Deny row. */
  card: HTMLElement;
  cardBody: HTMLElement;
  cardText: HTMLElement;
  cardDetail: HTMLElement;
  cardMeta: HTMLElement;
  actions: HTMLElement;
  questions: HTMLElement;
  rows: HTMLElement;
  /** Behind a finished task's card (optional, so tests can leave it out). */
  sparkles?: HTMLElement;
}

export interface IslandHandlers {
  /** The clickable rectangle changed: fractions of the window. */
  hit(rect: { x0: number; y0: number; x1: number; y1: number }): void;
  /** The hover changed, so the owner can refresh `busy`. */
  hover(): void;
  /** The user clicked a notification (not its buttons). */
  noticeClicked(msg: BubbleMessage): void;
  /** Allow / Always / Deny / In terminal on a permission notification. */
  answer(rid: string, decision: Decision): void;
  /** Options picked for Claude Code's question. */
  questionAnswered(rid: string, answers: Answers): void;
  /** A permission or question card is on screen with its buttons (the agent waits only for those). */
  cardShown(rid: string): void;
  /** A row of the hover list. */
  rowClicked(sessionId: string): void;
  /** The island changed shape (tucked away: nothing to draw). */
  shape(state: IslandState): void;
}

export class Island {
  private state: IslandState = "tucked";
  private status: IslandStatus | null = null;
  private rows: IslandRow[] = [];
  private hover = false;
  private leaveTimer = 0;
  private busy = false;
  private width = TAB.w;
  private height = TAB.h;
  private active = false;

  /** Notifications that stay until answered or closed (permissions), latest last. */
  private pinned = new Map<string, BubbleMessage>();
  /** The one passing notification, shown over the pinned ones while it lasts. */
  private passing: BubbleMessage | null = null;
  private passingTimer = 0;
  private shown: BubbleMessage | null = null;
  private guard = new ClickGuard();

  constructor(
    private el: HTMLElement,
    private parts: IslandParts,
    private on: IslandHandlers,
  ) {
    makeSparks(parts.sparkles);
    parts.cardBody.addEventListener("click", () => {
      const msg = this.notice();
      if (!msg) return;
      if (!msg.sticky) this.dismiss(msg.id);
      on.noticeClicked(msg);
    });
    parts.actions.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-decision]");
      const rid = this.notice()?.request;
      // Buttons that just appeared under the cursor don't take clicks for a moment.
      if (button && rid && this.guard.ready(rid)) on.answer(rid, button.dataset.decision as Decision);
    });
    parts.rows.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
      if (row?.dataset.id) on.rowClicked(row.dataset.id);
    });
  }

  setActive(on: boolean) {
    this.active = on;
    if (on) this.update(true);
  }

  /** The island's current shape. */
  shapeNow(): IslandState {
    return this.state;
  }

  setAgents(status: IslandStatus | null, rows: IslandRow[]) {
    this.status = status;
    this.rows = rows;
    this.update();
  }

  /** Anything besides agents that should keep the character in view. */
  setBusy(busy: boolean) {
    this.busy = busy;
    this.update();
  }

  isHovered() {
    return this.hover;
  }

  // ── Notifications ──────────────────────────────────────────────────────────

  notify(msg: BubbleMessage) {
    if (msg.sticky) {
      this.pinned.delete(msg.id); // re-added last: it's the newest
      this.pinned.set(msg.id, msg);
      // A new request goes in front of a passing notification: the agent only
      // waits for a card that's actually on screen.
      if (this.passing?.id === msg.id || (msg.request && this.shown?.request !== msg.request)) {
        this.passing = null;
        window.clearTimeout(this.passingTimer);
      }
    } else {
      this.passing = msg;
      this.armPassing(msg.detail ? NOTICE_MS_DETAIL : NOTICE_MS);
    }
    this.update();
  }

  /** Closes the notification with this id, or all of them. */
  dismiss(id: string | null = null) {
    if (id === null) this.pinned.clear();
    else this.pinned.delete(id);
    if (id === null || this.passing?.id === id) {
      this.passing = null;
      window.clearTimeout(this.passingTimer);
    }
    this.update();
  }

  private notice(): BubbleMessage | null {
    if (this.passing) return this.passing;
    let last: BubbleMessage | null = null;
    for (const m of this.pinned.values()) last = m;
    return last;
  }

  private armPassing(ms: number) {
    window.clearTimeout(this.passingTimer);
    this.passingTimer = window.setTimeout(() => {
      // Still being read: wait until the cursor leaves.
      if (this.hover) return this.armPassing(NOTICE_AFTER_HOVER_MS);
      this.passing = null;
      this.update();
    }, ms);
  }

  // ── Cursor ─────────────────────────────────────────────────────────────────

  /** The cursor, in window-local logical px (reported even while click-through). */
  cursor(x: number, y: number) {
    if (!this.active) return;
    const cx = window.innerWidth / 2;
    const near =
      this.state === "tucked"
        ? y <= EDGE_PX && Math.abs(x - cx) <= EDGE_REACH
        : Math.abs(x - cx) <= this.width / 2 + HOVER_MARGIN && y <= this.height + HOVER_MARGIN;
    if (near) {
      window.clearTimeout(this.leaveTimer);
      this.leaveTimer = 0;
      if (!this.hover) {
        this.hover = true;
        this.update();
        this.on.hover();
      }
    } else if (this.hover && !this.leaveTimer) {
      this.leaveTimer = window.setTimeout(() => {
        this.leaveTimer = 0;
        this.hover = false;
        this.update();
        this.on.hover();
      }, LEAVE_MS);
    }
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  private update(force = false) {
    if (!this.active) return;
    const msg = this.notice();
    const next = islandState({ notice: !!msg, status: this.status, hover: this.hover, busy: this.busy });
    const reshaped = next !== this.state;
    const changed = reshaped || msg !== this.shown;
    this.state = next;
    if (reshaped || force) this.on.shape(next);

    // The head's line: the notification's title, or the agents' status.
    const s = this.status;
    const label = msg ? { text: msg.title, more: undefined } : { text: s?.text ?? "", more: s?.more };
    this.parts.text.textContent = label.text;
    this.parts.more.textContent = label.more ?? "";
    this.parts.more.hidden = !label.more;
    this.el.dataset.tone = msg ? toneOf(msg.kind) : (s?.tone ?? "");
    this.el.toggleAttribute("data-celebrate", next === "notice" && celebrates(msg));

    const newRequest = Boolean(msg?.request) && this.shown?.request !== msg?.request;
    if (msg !== this.shown) this.fillCard(msg);
    this.shown = msg;
    if (newRequest && next === "notice") {
      this.guard.arm(msg!.request!);
      this.on.cardShown(msg!.request!);
    }
    if (next === "list") this.fillRows();
    this.layout(force || changed);
  }

  private fillCard(msg: BubbleMessage | null) {
    const p = this.parts;
    p.cardText.textContent = msg?.text ?? "";
    p.cardDetail.textContent = msg?.detail ?? "";
    p.cardDetail.hidden = !msg?.detail;
    p.cardDetail.classList.toggle("mono", !!msg?.mono);
    p.cardMeta.textContent = msg?.meta ?? "";
    p.cardMeta.hidden = !msg?.meta;
    p.actions.hidden = !msg?.request;
    // A question is answered with its options; only "In terminal" stays.
    const asking = Boolean(msg?.request && msg.questions?.length);
    p.questions.hidden = !asking;
    if (asking) {
      const rid = msg!.request!;
      renderQuestions(p.questions, msg!.questions!, (answers) => this.on.questionAnswered(rid, answers), {
        armed: () => this.guard.ready(rid),
        // The island never takes the keyboard focus: typing happens in the panel.
        onOther: () => this.on.noticeClicked(msg!),
      });
    } else {
      p.questions.replaceChildren();
    }
    for (const b of p.actions.querySelectorAll<HTMLButtonElement>("[data-decision]")) {
      const d = b.dataset.decision;
      b.hidden = asking ? d !== "terminal" : d === "always" && !msg?.always;
    }
    p.cardBody.title = msg?.session ? "Show this session" : "";
  }

  private fillRows() {
    const list = this.parts.rows;
    const key = JSON.stringify(this.rows);
    if (list.dataset.key === key) return; // unchanged: keep hover and focus
    list.dataset.key = key;
    list.replaceChildren(
      ...this.rows.map((r) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "row-item";
        b.dataset.id = r.id;
        b.dataset.tone = r.tone;
        const dot = document.createElement("span");
        dot.className = "r-dot";
        const project = document.createElement("span");
        project.className = "r-name";
        project.textContent = r.project;
        const line = document.createElement("span");
        line.className = "r-line";
        line.textContent = r.line;
        b.append(dot, project, line);
        return b;
      }),
    );
  }

  private layout(force: boolean) {
    let w = TAB.w;
    let h = TAB.h;
    // First, so the card or the rows are laid out for measuring.
    this.el.dataset.state = this.state;
    switch (this.state) {
      case "tucked":
        break;
      case "peek":
        [w, h] = [PEEK_W, HEAD_H];
        break;
      case "status": {
        // Same font as the label, measured off-screen: the pill grows to fit.
        this.parts.measure.textContent = [this.status?.text, this.status?.more].filter(Boolean).join("   ");
        [w, h] = [Math.min(MAX_STATUS_W, PEEK_W + 8 + 15 + this.parts.measure.offsetWidth), HEAD_H];
        break;
      }
      case "list":
      case "notice":
        // The content at its final width decides the height.
        w = this.state === "list" ? LIST_W : celebrates(this.notice()) ? CELEBRATE_W : NOTICE_W;
        this.parts.inner.style.width = `${w}px`;
        h = Math.min(window.innerHeight, this.parts.inner.offsetHeight);
        break;
    }
    if (!force && w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.parts.inner.style.width = `${w}px`;
    this.el.style.width = `${w}px`;
    this.el.style.height = `${h}px`;
    const W = window.innerWidth || 1;
    const H = window.innerHeight || 1;
    this.on.hit({ x0: (W - w) / 2 / W, y0: 0, x1: (W + w) / 2 / W, y1: Math.min(1, h / H) });
  }
}

/** A finished task: the bigger card. */
export function celebrates(msg: BubbleMessage | null): boolean {
  return msg?.kind === "success" && msg.category === "agent-done";
}

/** The sparks, scattered: each its own place, size, speed and start. */
function makeSparks(box: HTMLElement | undefined) {
  if (!box || box.childElementCount) return;
  for (let i = 0; i < SPARKS; i++) {
    const spark = document.createElement("i");
    const r = (n: number) => Math.round(((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1 * 1000) / 1000;
    spark.style.left = `${(i + r(1) * 0.8) * (100 / SPARKS)}%`;
    spark.style.height = `${6 + r(2) * 12}px`;
    spark.style.setProperty("--d", `${2.4 + r(3) * 2.6}s`);
    spark.style.setProperty("--w", `${-r(4) * 4}s`);
    spark.style.setProperty("--h", `${90 + r(5) * 70}px`);
    spark.style.setProperty("--o", `${0.25 + r(6) * 0.55}`);
    box.append(spark);
  }
}

function toneOf(kind: BubbleKind): string {
  return kind === "attention" ? "attention" : kind === "success" ? "success" : kind === "error" ? "error" : "info";
}
