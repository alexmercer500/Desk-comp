// The speech bubble beside the character. The companion window sends
// "bubble:show" / "bubble:hide"; a click on the card is reported back as
// "bubble:clicked" (it acknowledges a notification and opens the panel).
// A permission bubble also carries Allow / Deny / In terminal, reported as
// "permission:answer" — the companion window forwards it to the waiting agent.

import { initTheme } from "../theme";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { ClickGuard } from "./guard";
import { renderQuestions } from "./question";
import { showFor, type BubbleMessage } from "./types";

// Colours from the chosen theme, before anything is drawn.
initTheme();

const wrap = document.getElementById("wrap")!;
const card = document.getElementById("card")!;
const body = document.getElementById("body")!;
const title = document.getElementById("title")!;
const text = document.getElementById("text")!;
const detail = document.getElementById("detail")!;
const meta = document.getElementById("meta")!;
const rows = document.getElementById("rows")!;
const actions = document.getElementById("actions")!;
const questionsBox = document.getElementById("questions")!;

/** While a card is up it checks this often whether he has moved away from it (Rust decides; see bubble_place). */
const FOLLOW_MS = 250;

let hideTimer = 0;
/** The card on screen. */
let current: BubbleMessage | null = null;
/** Cards that stay until answered or closed (permissions, questions), latest last. */
const pinned = new Map<string, BubbleMessage>();
/** The one passing notification, shown over the pinned ones while it lasts. */
let passing: BubbleMessage | null = null;
const guard = new ClickGuard();

/** What should be on screen: the passing notification, else the newest pinned card. */
function top(): BubbleMessage | null {
  if (passing) return passing;
  let last: BubbleMessage | null = null;
  for (const m of pinned.values()) last = m;
  return last;
}

function receive(msg: BubbleMessage) {
  // What agents are up to never covers a card waiting for an answer.
  if (msg.category === "agent-working" && pinned.size) return;
  if (msg.sticky) {
    pinned.delete(msg.id); // re-added last: it's the newest
    pinned.set(msg.id, msg);
    // A new request goes in front of a passing notification: the agent only
    // waits for a card that's actually on screen.
    if (passing?.id === msg.id || (msg.request && current?.request !== msg.request)) passing = null;
  } else {
    pinned.delete(msg.id);
    passing = msg;
  }
  void display(top());
}

function drop(id: string | null) {
  if (id === null) pinned.clear();
  else pinned.delete(id);
  if (id === null || passing?.id === id) passing = null;
  void display(top());
}

async function display(msg: BubbleMessage | null) {
  window.clearTimeout(hideTimer);
  if (!msg) return hide();
  const newRequest = Boolean(msg.request) && current?.request !== msg.request;
  current = msg;
  title.textContent = msg.title;
  text.textContent = msg.text;
  text.hidden = !msg.text;
  rows.hidden = !msg.rows?.length;
  rows.replaceChildren(
    ...(msg.rows ?? []).map((r) => {
      const row = document.createElement("span");
      row.className = "row";
      row.dataset.tone = r.tone;
      const project = document.createElement("span");
      project.className = "row-project";
      project.textContent = r.project;
      const line = document.createElement("span");
      line.className = "row-line";
      line.textContent = r.line;
      row.append(project, line);
      return row;
    }),
  );
  detail.textContent = msg.detail ?? "";
  detail.hidden = !msg.detail;
  detail.classList.toggle("mono", !!msg.mono);
  // What it's asking and its choices, one per line (answered where it was asked).
  detail.classList.toggle("choices", msg.category === "agent-permission" && !msg.mono);
  meta.textContent = msg.meta ?? "";
  meta.hidden = !msg.meta;
  actions.hidden = !msg.request;
  // A question is answered with its options; only "In terminal" stays.
  const asking = Boolean(msg.request && msg.questions?.length);
  questionsBox.hidden = !asking;
  if (asking) {
    const rid = msg.request!;
    renderQuestions(
      questionsBox,
      msg.questions!,
      (answers) => {
        void emitTo("companion", "question:answer", { rid, answers });
        drop(msg.id);
      },
      {
        armed: () => guard.ready(rid),
        // This window never takes the keyboard focus: typing happens in the panel.
        onOther: () => {
          void emitTo("companion", "bubble:clicked", { id: msg.id, session: msg.session ?? null, action: null });
          drop(msg.id);
        },
      },
    );
  }
  for (const b of actions.querySelectorAll<HTMLButtonElement>("[data-decision]")) {
    const d = b.dataset.decision;
    b.hidden = asking ? d !== "terminal" : d === "always" && !msg.always;
    if (d === "terminal") b.textContent = msg.elsewhere ?? "In terminal";
  }
  card.dataset.kind = msg.kind;
  // Buttons that just appeared under the cursor don't take clicks for a moment.
  if (newRequest) guard.arm(msg.request!);

  // Lay the card out, then measure it, then put it beside the character (desktop.rs, placement.rs).
  await new Promise(requestAnimationFrame);
  if (current !== msg) return;
  await place();
  if (current !== msg) return;
  void invoke("bubble_card", { rect: { x: wrap.offsetLeft, y: wrap.offsetTop, w: card.offsetWidth, h: card.offsetHeight } });
  card.classList.add("shown");
  // The agent waits only for a card that's on screen (see agents.rs).
  if (msg.request) void emitTo("companion", "permission:shown", msg.request);
  if (!msg.sticky) {
    hideTimer = window.setTimeout(() => {
      if (passing?.id === msg.id) passing = null;
      void display(top());
    }, showFor(msg));
  }
}

/** Moves the window so the card sits beside the character, its tail pointing at him. */
async function place() {
  const keep = card.classList.contains("shown") ? wrap.dataset.tail : undefined;
  const spot = await invoke<{ tail: string; at: number }>("bubble_place", {
    card: { w: card.offsetWidth, h: card.offsetHeight, keep: keep && keep !== "none" ? keep : null },
  });
  wrap.dataset.tail = spot.tail;
  wrap.style.setProperty("--tail-at", `${spot.at}px`);
}

// Rui and Dogesh can be mid-step when a card appears, and he can be dragged: follow him.
window.setInterval(() => {
  if (current && card.classList.contains("shown")) void place();
}, FOLLOW_MS);

function hide() {
  window.clearTimeout(hideTimer);
  if (!current) return;
  current = null;
  card.classList.remove("shown");
  // Let the fade finish before parking the window.
  window.setTimeout(() => {
    if (!current) void invoke("bubble_hide");
  }, 180);
}

body.addEventListener("click", () => {
  if (!current) return;
  void emitTo("companion", "bubble:clicked", { id: current.id, session: current.session ?? null, action: current.action ?? null });
  drop(current.id);
});

actions.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-decision]");
  if (!button || !current?.request) return;
  if (!guard.ready(current.request)) return; // the card has only just appeared
  void emitTo("companion", "permission:answer", { rid: current.request, decision: button.dataset.decision });
  drop(current.id);
});

void listen<BubbleMessage>("bubble:show", ({ payload }) => receive(payload));
// A targeted hide only closes the card it names.
void listen<string | null>("bubble:hide", ({ payload }) => drop(payload));
