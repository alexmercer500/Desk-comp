// The speech bubble beside the character. The companion window sends
// "bubble:show" / "bubble:hide"; a click on the card is reported back as
// "bubble:clicked" (it acknowledges a notification and opens the panel).
// A permission bubble also carries Allow / Deny / In terminal, reported as
// "permission:answer" — the companion window forwards it to the waiting agent.

import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { renderQuestions } from "./question";
import type { BubbleMessage } from "./types";

const wrap = document.getElementById("wrap")!;
const card = document.getElementById("card")!;
const body = document.getElementById("body")!;
const title = document.getElementById("title")!;
const text = document.getElementById("text")!;
const detail = document.getElementById("detail")!;
const meta = document.getElementById("meta")!;
const actions = document.getElementById("actions")!;
const questionsBox = document.getElementById("questions")!;

/** How long a non-sticky bubble stays up; longer when there's more to read. */
const SHOW_MS = 6000;
const SHOW_MS_DETAIL = 9000;

let hideTimer = 0;
let current: BubbleMessage | null = null;

async function show(msg: BubbleMessage) {
  window.clearTimeout(hideTimer);
  current = msg;
  title.textContent = msg.title;
  text.textContent = msg.text;
  detail.textContent = msg.detail ?? "";
  detail.hidden = !msg.detail;
  detail.classList.toggle("mono", !!msg.mono);
  meta.textContent = msg.meta ?? "";
  meta.hidden = !msg.meta;
  actions.hidden = !msg.request;
  // A question is answered with its options; only "In terminal" stays.
  const asking = Boolean(msg.request && msg.questions?.length);
  questionsBox.hidden = !asking;
  if (asking) {
    renderQuestions(questionsBox, msg.questions!, (answers) => {
      void emitTo("companion", "question:answer", { rid: msg.request, answers });
      hide();
    });
  }
  for (const b of actions.querySelectorAll<HTMLButtonElement>("[data-decision]")) {
    const d = b.dataset.decision;
    b.hidden = asking ? d !== "terminal" : d === "always" && !msg.always;
  }
  card.dataset.kind = msg.kind;

  wrap.dataset.tail = await invoke<string>("bubble_place");
  // Measure after layout so the click area matches the card exactly.
  requestAnimationFrame(() => {
    const r = card.getBoundingClientRect();
    void invoke("bubble_card", { rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
    card.classList.add("shown");
  });
  if (!msg.sticky) hideTimer = window.setTimeout(hide, msg.detail ? SHOW_MS_DETAIL : SHOW_MS);
}

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
  if (current) void emitTo("companion", "bubble:clicked", { id: current.id, session: current.session ?? null, action: current.action ?? null });
  hide();
});

actions.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-decision]");
  if (!button || !current?.request) return;
  void emitTo("companion", "permission:answer", { rid: current.request, decision: button.dataset.decision });
  hide();
});

void listen<BubbleMessage>("bubble:show", ({ payload }) => void show(payload));
void listen<string | null>("bubble:hide", ({ payload }) => {
  // A targeted hide only closes the bubble it names.
  if (!payload || current?.id === payload) hide();
});
