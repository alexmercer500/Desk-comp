// A pretend agent session on a pretend desk: it reads, edits, runs the tests,
// then waits for you on a permission card, the way the app shows a real one.
// Only plays while it's on screen.

import type { CharacterController } from "@app/engine/controller";

type Answer = "allow" | "always" | "deny";

const STEP_MS = 2600;
const AGAIN_MS = 6000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startDemo(root: HTMLElement, c: CharacterController) {
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const island = q("[data-island]");
  const islandText = q("[data-island-text]");
  const dot = q("[data-dot]");
  const card = q("[data-card]");
  const done = q("[data-done]");
  const doneText = q("[data-done-text]");
  const note = q("[data-demo-note]");
  const term = q("[data-term]");

  /** One line in the pretend agent's terminal. */
  const line = (text: string, kind: "tool" | "ok" | "ask" | "say" = "tool") => {
    const li = document.createElement("li");
    li.dataset.kind = kind;
    li.textContent = text;
    term.append(li);
    while (term.children.length > 6) term.firstElementChild?.remove();
  };

  let visible = false;
  let wake: (() => void) | null = null;
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) wake?.();
  }, { threshold: 0.35 }).observe(root);

  /** Waits for `ms`, then for the desk to be on screen. */
  const beat = async (ms: number) => {
    await sleep(ms);
    if (!visible) await new Promise<void>((r) => (wake = r));
    wake = null;
  };

  let answered: ((a: Answer) => void) | null = null;
  for (const b of card.querySelectorAll<HTMLButtonElement>("[data-answer]")) {
    b.addEventListener("click", () => answered?.(b.dataset.answer as Answer));
  }

  const status = (text: string, state: "work" | "ask" | "done" | "rest") => {
    islandText.textContent = text;
    dot.dataset.state = state;
    island.dataset.state = state;
  };

  const run = async () => {
    for (;;) {
      card.hidden = true;
      done.hidden = true;
      term.replaceChildren();
      line("> fix the cart total when a coupon is applied", "say");
      await beat(1200);
      status("shop-app · Reading cart.ts", "work");
      line("Read src/cart.ts");
      c.startWork({ timeoutMs: null });
      c.setWork({ kind: "research", now: true });
      await beat(STEP_MS);
      status("shop-app · Editing cart.ts", "work");
      line("Edit src/cart.ts  +12 −3");
      c.setWork({ kind: "edit", now: true });
      await beat(STEP_MS);
      status("shop-app · Running npm test", "work");
      line("Run npm test");
      c.setWork({ kind: "run", now: true });
      await beat(STEP_MS);

      line("24 passed", "ok");
      line("Wants to run git push origin main", "ask");
      status("shop-app · waiting on you", "ask");
      c.setWork({ waiting: "permission" });
      card.hidden = false;
      note.textContent = "It's waiting for you. Allow, Always or Deny?";
      const answer = await new Promise<Answer>((r) => (answered = r));
      answered = null;
      card.hidden = true;
      c.setWork({ waiting: null });

      if (answer === "deny") {
        c.finishWork({ confidence: 0.5 });
        status("shop-app · stopped", "rest");
        line("Denied: git push origin main", "ask");
        doneText.textContent = "Okay, nothing was pushed. The agent hears why.";
        note.textContent = "Denied. The agent carries on without it.";
      } else {
        status("shop-app · Pushing to main", "work");
        line("Run git push origin main");
        await beat(1400);
        line("main → origin/main, 3 commits", "ok");
        c.finishWork({ confidence: 1 });
        status("shop-app is done", "done");
        doneText.textContent = answer === "always" ? "Pushed. It won't ask about git push again." : "Pushed 3 commits to main.";
        note.textContent = answer === "always" ? "Allowed for good. Kulhi remembers." : "Allowed. Kulhi's pleased.";
      }
      done.hidden = false;
      await beat(AGAIN_MS);
      note.textContent = "Here it goes again.";
    }
  };
  void run();
}
