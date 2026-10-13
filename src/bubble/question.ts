// Claude Code's multiple-choice questions, answered with buttons. Shared by
// the speech bubble, the top-edge island and the activity panel.
//
// One question with one answer: a tap on an option sends it. Several questions
// or "pick any": choose, then Send. Only offered options can be sent (the
// relay checks again); "In terminal" is always there as the way out.

import type { Question } from "./types";
import "./question.css";

export type Answers = Record<string, string>;

export function renderQuestions(container: HTMLElement, questions: Question[], send: (answers: Answers) => void) {
  const chosen = new Map<string, Set<string>>(questions.map((q) => [q.question, new Set<string>()]));
  const instant = questions.length === 1 && !questions[0].multiSelect;
  container.replaceChildren();

  const sendButton = document.createElement("button");
  sendButton.type = "button";
  sendButton.className = "q-send";
  sendButton.textContent = "Send";

  const ready = () => questions.every((q) => (chosen.get(q.question)?.size ?? 0) > 0);
  const answers = (): Answers =>
    Object.fromEntries(
      questions.map((q) => {
        // In the order they were offered, the way the agent listed them.
        const picked = q.options.map((o) => o.label).filter((l) => chosen.get(q.question)!.has(l));
        return [q.question, picked.join(", ")];
      }),
    );

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
    for (const o of q.options) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "q-option";
      b.textContent = o.label;
      if (o.description) b.title = o.description;
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const set = chosen.get(q.question)!;
        if (q.multiSelect) {
          if (set.has(o.label)) set.delete(o.label);
          else set.add(o.label);
        } else {
          set.clear();
          set.add(o.label);
        }
        for (const other of row.querySelectorAll<HTMLButtonElement>(".q-option")) {
          other.setAttribute("aria-pressed", String(set.has(other.textContent ?? "")));
        }
        if (instant) send(answers());
        else sendButton.disabled = !ready();
      });
      row.append(b);
    }
    block.append(row);
    container.append(block);
  }

  if (!instant) {
    sendButton.disabled = true;
    sendButton.addEventListener("click", (e) => {
      e.stopPropagation();
      if (ready()) send(answers());
    });
    container.append(sendButton);
  }
}
