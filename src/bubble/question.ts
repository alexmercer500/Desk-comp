// Claude Code's multiple-choice questions, answered with buttons. Shared by
// the speech bubble, the top-edge island and the activity panel.
//
// One question with one answer: a tap on an option sends it. Several questions
// or "pick any": choose, then Send. Every question also has "Other…" for an
// answer of your own, as in the terminal. Only offered options or text typed
// here can be sent (the relay checks again); "In terminal" is always there as
// the way out.

import type { Question } from "./types";
import "./question.css";

export type Answers = Record<string, string>;

/** Longest answer typed by hand; the relay refuses more. */
export const MAX_OTHER = 500;

export interface QuestionOptions {
  /** Says whether clicks count yet (see guard.ts). */
  armed?: () => boolean;
  /**
   * Where typing happens. Without it, "Other…" shows a text box right there.
   * The bubble and the island never take the keyboard focus (so they can't
   * interrupt your typing elsewhere), so they pass this to open the panel,
   * which does.
   */
  onOther?: () => void;
}

/** What `chosen` and `typed` add up to: the answer text for one question. */
export function answerFor(q: Question, picked: ReadonlySet<string>, typed: string | null): string {
  // In the order they were offered, the way the agent listed them.
  const parts = q.options.map((o) => o.label).filter((l) => picked.has(l));
  const own = typed?.trim();
  if (own) parts.push(own);
  return parts.join(", ");
}

export function renderQuestions(
  container: HTMLElement,
  questions: Question[],
  send: (answers: Answers) => void,
  options: QuestionOptions = {},
) {
  const armed = options.armed ?? (() => true);
  const chosen = new Map<string, Set<string>>(questions.map((q) => [q.question, new Set<string>()]));
  /** null: "Other…" not chosen; otherwise the text typed so far. */
  const typed = new Map<string, string | null>(questions.map((q) => [q.question, null]));
  const instant = questions.length === 1 && !questions[0].multiSelect;
  container.replaceChildren();

  const sendButton = document.createElement("button");
  sendButton.type = "button";
  sendButton.className = "q-send";
  sendButton.textContent = "Send";

  const ready = () =>
    questions.every((q) => {
      const own = typed.get(q.question);
      // Chosen "Other…" with nothing typed yet is not an answer.
      return (chosen.get(q.question)?.size ?? 0) > 0 || (own != null && own.trim() !== "");
    });
  const answers = (): Answers =>
    Object.fromEntries(questions.map((q) => [q.question, answerFor(q, chosen.get(q.question)!, typed.get(q.question) ?? null)]));
  // A single question answered by a tap sends at once; typing needs Send.
  const syncSend = () => {
    const typing = questions.some((q) => typed.get(q.question) != null);
    sendButton.hidden = instant && !typing;
    sendButton.disabled = !ready();
  };

  for (const q of questions) {
    const block = document.createElement("div");
    block.className = "q-block";
    block.setAttribute("role", "group");
    const label = document.createElement("div");
    label.className = "q-text";
    label.textContent = q.question;
    block.setAttribute("aria-label", q.question);
    block.append(label);

    const row = document.createElement("div");
    row.className = "q-options";
    const field = document.createElement("input");
    field.type = "text";
    field.className = "q-other-input";
    field.maxLength = MAX_OTHER;
    field.placeholder = "Type your answer";
    field.setAttribute("aria-label", `Your own answer: ${q.question}`);
    field.hidden = true;

    const otherButton = document.createElement("button");
    otherButton.type = "button";
    otherButton.className = "q-option q-other";
    otherButton.textContent = "Other…";
    otherButton.title = options.onOther ? "Type your own answer in the panel" : "Type your own answer";
    otherButton.setAttribute("aria-pressed", "false");

    const refresh = () => {
      const set = chosen.get(q.question)!;
      const own = typed.get(q.question);
      for (const b of row.querySelectorAll<HTMLButtonElement>(".q-option:not(.q-other)")) {
        b.setAttribute("aria-pressed", String(set.has(b.textContent ?? "")));
      }
      otherButton.setAttribute("aria-pressed", String(own != null));
      field.hidden = own == null;
      syncSend();
    };

    for (const o of q.options) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "q-option";
      b.textContent = o.label;
      if (o.description) b.title = o.description;
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!armed()) return; // the card has only just appeared
        const set = chosen.get(q.question)!;
        if (q.multiSelect) {
          if (set.has(o.label)) set.delete(o.label);
          else set.add(o.label);
        } else {
          set.clear();
          set.add(o.label);
          typed.set(q.question, null); // one answer: a button replaces typed text
        }
        refresh();
        if (instant) send(answers());
      });
      row.append(b);
    }

    otherButton.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!armed()) return;
      if (options.onOther) return options.onOther();
      if (q.multiSelect) {
        typed.set(q.question, typed.get(q.question) == null ? "" : null);
      } else {
        chosen.get(q.question)!.clear(); // one answer: typing replaces the buttons
        typed.set(q.question, typed.get(q.question) ?? "");
      }
      refresh();
      if (typed.get(q.question) != null) field.focus();
    });
    row.append(otherButton);

    field.addEventListener("input", () => {
      typed.set(q.question, field.value);
      syncSend();
    });
    field.addEventListener("keydown", (e) => {
      e.stopPropagation(); // typing is not a shortcut for the page behind
      if (e.key === "Enter" && ready() && armed()) send(answers());
    });
    field.addEventListener("click", (e) => e.stopPropagation());

    block.append(row, field);
    container.append(block);
  }

  sendButton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (ready() && armed()) send(answers());
  });
  container.append(sendButton);
  syncSend();
}
