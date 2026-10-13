// The Ask tab: questions about the user's PC, answered by Claude via the Rust
// side (src-tauri/src/assistant.rs — the API key never comes near this page).
//
// The character follows along through events to the companion window:
// "ask:focus" / "ask:typing" while the user writes, "ask:start" when the
// question goes out, "ask:done" with the result (which sets SUCCESS,
// SUGGESTING or CONFUSED), "ask:picked" when a suggestion is chosen.

import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";

interface Status {
  hasKey: boolean;
  model: string;
  device: string;
}

interface Answer {
  kind: "answer" | "suggestions" | "unclear" | "off_topic";
  confidence: number;
  answer: string;
  suggestions: string[];
}

interface AskError {
  kind: string;
  message: string;
}

interface Turn {
  role: "user" | "assistant";
  text: string;
}

const setup = document.getElementById("setup")!;
const chat = document.getElementById("chat")!;
const keyForm = document.getElementById("key-form") as HTMLFormElement;
const keyInput = document.getElementById("key-input") as HTMLInputElement;
const keyError = document.getElementById("key-error")!;
const thread = document.getElementById("thread")!;
const composer = document.getElementById("composer") as HTMLFormElement;
const question = document.getElementById("question") as HTMLTextAreaElement;
const send = document.getElementById("send") as HTMLButtonElement;
const device = document.getElementById("device")!;
const forgetKey = document.getElementById("forget-key")!;

const toCompanion = (event: string, payload?: unknown) => void emitTo("companion", event, payload);

/** The conversation sent back with each question (plain text, oldest first). */
const history: Turn[] = [];
let busy = false;

/** Which character is answering (set by the companion when the panel opens). */
let character = "kulhi";
export function setCharacter(id: string) {
  character = id;
}

export async function refreshAsk() {
  const status = await invoke<Status>("assistant_status");
  setup.hidden = status.hasKey;
  chat.hidden = !status.hasKey;
  device.textContent = status.device;
  if (thread.childElementCount === 0) greet();
}

export function focusAsk() {
  (chat.hidden ? keyInput : question).focus();
}

// ── Key setup ────────────────────────────────────────────────────────────────

keyForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  keyError.textContent = "";
  try {
    await invoke("assistant_set_key", { key: keyInput.value });
    keyInput.value = "";
    await refreshAsk();
    focusAsk();
  } catch (err) {
    keyError.textContent = String(err);
  }
});

forgetKey.addEventListener("click", async () => {
  await invoke("assistant_forget_key");
  await refreshAsk();
});

// ── Asking ───────────────────────────────────────────────────────────────────

function greet() {
  addKulhi({ text: "Hi! What's up with your PC? Ask me anything: Wi-Fi, Bluetooth, printer, battery, a setting you can't find." });
}

async function ask(text: string) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  send.disabled = true;
  addUser(text);
  const pending = addKulhi({ pending: true });
  toCompanion("ask:start");
  try {
    const answer = await invoke<Answer>("assistant_ask", { question: text, history, character });
    history.push({ role: "user", text }, { role: "assistant", text: answer.answer });
    pending.remove();
    addKulhi({ text: answer.answer, suggestions: answer.kind === "suggestions" ? answer.suggestions : [] });
    toCompanion("ask:done", { kind: answer.kind, confidence: answer.confidence });
  } catch (err) {
    const e = err as AskError;
    pending.remove();
    addKulhi({ text: friendlyError(e), error: true });
    toCompanion("ask:done", { error: true });
    if (e.kind === "no_key" || e.kind === "auth") void refreshAsk();
  } finally {
    busy = false;
    send.disabled = false;
    question.focus();
  }
}

function friendlyError(e: AskError): string {
  switch (e.kind) {
    case "auth": return "That API key didn't work. Check it, then add it again.";
    case "rate_limit": return "Too many questions at once. Give me a moment and try again.";
    case "overloaded": return "Claude is very busy right now. Try again in a minute.";
    case "network": return "I can't reach the internet right now. Is Wi-Fi connected?";
    case "refused": return "Sorry, I can't help with that one.";
    case "no_key": return "Add your Anthropic API key first.";
    default: return `Something went wrong: ${e.message ?? e}`;
  }
}

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = question.value;
  question.value = "";
  autosize();
  void ask(text);
});

question.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    composer.requestSubmit();
  }
});

let lastTyping = 0;
question.addEventListener("input", () => {
  autosize();
  const now = performance.now();
  if (now - lastTyping > 300) {
    lastTyping = now;
    toCompanion("ask:typing");
  }
});
question.addEventListener("focus", () => toCompanion("ask:focus", true));
question.addEventListener("blur", () => toCompanion("ask:focus", false));

function autosize() {
  question.style.height = "auto";
  question.style.height = `${Math.min(question.scrollHeight, 120)}px`;
  question.style.overflowY = question.scrollHeight > 120 ? "auto" : "hidden";
}

// ── Thread rendering ─────────────────────────────────────────────────────────

function addUser(text: string) {
  const li = document.createElement("li");
  li.className = "msg user";
  li.textContent = text;
  thread.append(li);
  li.scrollIntoView({ block: "end" });
}

function addKulhi(opts: { text?: string; pending?: boolean; error?: boolean; suggestions?: string[] }): HTMLElement {
  const li = document.createElement("li");
  li.className = "msg kulhi";
  if (opts.error) li.classList.add("error");
  if (opts.pending) {
    li.classList.add("pending");
    li.setAttribute("aria-label", "Kulhi is thinking");
    li.append(...[0, 1, 2].map(() => Object.assign(document.createElement("span"), { className: "dot" })));
  } else if (opts.text) {
    li.append(renderText(opts.text));
  }
  if (opts.suggestions?.length) {
    const chips = document.createElement("div");
    chips.className = "chips";
    for (const s of opts.suggestions) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = s;
      b.addEventListener("click", () => {
        chips.remove();
        toCompanion("ask:picked");
        void ask(s);
      });
      chips.append(b);
    }
    li.append(chips);
  }
  thread.append(li);
  li.scrollIntoView({ block: "end" });
  return li;
}

/**
 * A small, safe renderer for the answer: paragraphs, numbered and bulleted
 * lists, **bold** and `code`. Everything is built with text nodes, so nothing
 * in an answer can become markup.
 */
function renderText(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let list: HTMLOListElement | HTMLUListElement | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (numbered || bullet) {
      const tag = numbered ? "ol" : "ul";
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = document.createElement(tag);
        frag.append(list);
      }
      const li = document.createElement("li");
      inline(li, numbered ? numbered[2] : bullet![1]);
      list.append(li);
    } else if (line.trim() === "") {
      list = null;
    } else {
      list = null;
      const p = document.createElement("p");
      inline(p, line.replace(/^#+\s*/, ""));
      frag.append(p);
    }
  }
  return frag;
}

function inline(parent: HTMLElement, text: string) {
  for (const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**")) {
      parent.append(Object.assign(document.createElement("strong"), { textContent: part.slice(2, -2) }));
    } else if (part.startsWith("`") && part.endsWith("`")) {
      parent.append(Object.assign(document.createElement("code"), { textContent: part.slice(1, -1) }));
    } else {
      parent.append(part);
    }
  }
}
