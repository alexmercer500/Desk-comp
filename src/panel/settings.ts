// The Settings tab: everything the companion can do, each switchable, the way
// coucou has it. Every change goes to Rust (`set_setting` and friends), which
// checks it, saves it, applies it, ticks the tray to match and tells every
// window ("prefs"); this tab then redraws from what was actually stored.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Engine } from "../engine/engine";
import type { CharacterId, StateName, Variant } from "../engine/types";
import { CHARACTER_NAMES, SKINS, applyCustomPrefs, isCharacter } from "../skins";
import { MOODS, customPicture, hasCustomCharacter, type Mood } from "../skins/custom";
import { loadCustomCharacter } from "../skins/custom-load";
import { PICTURE_TYPES, isSheet, prepareSet, preparePicture, splitSheet } from "./picture";
import { FILE_NAMES, filesPrompt, isPictureName, moodFromName, pictureType, sheetPrompt } from "./character-import";
import { readZip } from "./zip";
import { LOOKS, LOOK_NAMES, THEMES, THEME_NAMES, themeColors } from "../three/palette";
import { UI_THEMES } from "../theme";
import { linkState, linkText, since, type AgentStatus, type RelayTest } from "./connections";
import { ruiPicture, setRuiStyle } from "./rui-pictures";
import { OUTFITS, OUTFIT_NAMES } from "../skins/dogesh-outfits";
import { setDogeshOutfit, withDogeshOutfit } from "../skins/dogesh";

interface Prefs {
  uiTheme: string;
  breaks: boolean;
  breakMinutes: number;
  battery: boolean;
  downloads: boolean;
  welcome: boolean;
  hideFullscreen: boolean;
  size: string;
  character: string;
  place: string;
  quietUntil: number;
  notifyDone: boolean;
  notifyPermission: boolean;
  notifyWaiting: boolean;
  notifyWorking: boolean;
  keyboardShortcuts: boolean;
  notifyErrors: boolean;
  answerPermissions: boolean;
  askEnabled: boolean;
  shareDevice: boolean;
  sounds: boolean;
  autoUpdate: boolean;
  ruiLook: string;
  ruiTheme: string;
  dogeshStyle: string;
  dogeshOutfit: string;
  customName: string;
  customShape: string;
  ruiFlatOnBattery: boolean;
  phoneLink: boolean;
  phoneRelay: boolean;
  phonePeek: boolean;
  relayUrl: string;
}

interface PhoneStatus {
  on: boolean;
  listening: boolean;
  port: number;
  hosts: string[];
  phones: { device: string; address: string; since: number }[];
  error: string | null;
  relay: { state: "off" | "connecting" | "connected" | "retrying"; error: string | null };
}

interface Pairing {
  link: string;
  /** SVG data URL. */
  qr: string;
  name: string;
  hosts: string[];
}

interface Settings {
  prefs: Prefs;
  claudeConnected: boolean;
  agents: AgentStatus[];
  relayTest: RelayTest | null;
  autostart: boolean;
  version: string;
  /** The relay built into this copy, used when no address is saved. */
  builtInRelay: string | null;
}

interface UpdateInfo {
  configured: boolean;
  current: string;
  available: string | null;
  notes: string | null;
}

/** What each agent's switch says underneath. */
const AGENT_HINTS: Record<string, string> = {
  "claude-code": "Adds my hooks to Claude Code's settings (backed up first). Your other hooks stay as they are.",
  codex: "Codex asks you once to trust the new hook: run /hooks in Codex. Allow / Deny works from here.",
  copilot: "Copilot CLI and VS Code's agent mode share one hook file: shows what each is doing and when it's done. Permissions stay where they're asked.",
  cursor: "Adds my hooks to Cursor's hooks.json. Shows what its agent is doing, when it's done, stopped or failed. Permissions stay in Cursor.",
  antigravity: "Adds a hook group to Antigravity's hooks.json: the Antigravity app and CLI. Shows each step once it's done, and when a task ends. It never answers its permission prompts. The older standalone IDE doesn't run hooks yet.",
  gemini: "Shows what Gemini CLI is doing and when it's done. Permissions stay in the terminal.",
  commandcode: "Adds a small mod and hooks to Command Code: the CLI, the desktop app and the VS Code chat panel. Shows each step and when it's done, its questions (answer them here or on your phone) and plans waiting for review. In the CLI and app also when it's stopped or waiting for your OK; the VS Code chat panel doesn't tell other apps about its permission prompts, so those stay in VS Code.",
};

interface AskStatus {
  hasKey: boolean;
  device: string;
}

type BoolKey = { [K in keyof Prefs]: Prefs[K] extends boolean ? K : never }[keyof Prefs];

const root = document.getElementById("settings")!;
const CHARACTERS: { id: CharacterId | "rui"; what: string }[] = [
  { id: "kulhi", what: "chai cup" },
  { id: "hexo", what: "hex nut" },
  { id: "glim", what: "firefly" },
  { id: "billu", what: "space cat" },
  { id: "rui", what: "3D yeti" },
  { id: "dogesh", what: "scaredy pup" },
];
const BREAK_CHOICES = [30, 45, 50, 60, 90];
const PAUSES: { label: string; until: () => number }[] = [
  { label: "For 30 minutes", until: () => Date.now() + 30 * 60_000 },
  { label: "For 1 hour", until: () => Date.now() + 60 * 60_000 },
  { label: "For 3 hours", until: () => Date.now() + 3 * 60 * 60_000 },
  { label: "Until tomorrow morning", until: tomorrowMorning },
  { label: "Until I turn them back on", until: () => -1 },
];

function tomorrowMorning(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}

// ── Small builders ───────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

let uid = 0;

function section(title: string, ...rows: HTMLElement[]): HTMLElement {
  const s = el("section", "set-group");
  const id = `set-h-${++uid}`;
  const h = el("h3", undefined, title);
  h.id = id;
  s.setAttribute("aria-labelledby", id);
  // The app window shows one section per page, by this name ("coding-agents", "ask-ai"…).
  s.dataset.section = title.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
  s.append(h, ...rows);
  return s;
}

/** A row: title and hint on the left, the control on the right. */
function row(title: string, hint: string | null, control: HTMLElement, forId?: string): HTMLElement {
  const r = el("div", "set-row");
  const text = el(forId ? "label" : "div", "set-text");
  if (forId) (text as HTMLLabelElement).htmlFor = forId;
  text.append(el("span", "set-title", title));
  if (hint) text.append(el("span", "set-hint", hint));
  r.append(text, control);
  return r;
}

function toggle(onChange: (on: boolean) => void): HTMLInputElement {
  const input = el("input", "switch");
  input.type = "checkbox";
  input.setAttribute("role", "switch");
  input.id = `set-c-${++uid}`;
  input.addEventListener("change", () => onChange(input.checked));
  return input;
}

function switchRow(key: BoolKey, title: string, hint: string | null = null): HTMLElement {
  const input = toggle((on) => void set(key, on));
  controls.set(key, input);
  return row(title, hint, input, input.id);
}

/** Buttons in a row, one pressed. */
/** `as` keeps a second control for the same setting apart (Dogesh's look is Rui's look). */
function segmented(key: keyof Prefs, label: string, choices: [string, string][], as: string = key): HTMLElement {
  const group = el("div", "segmented");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", label);
  for (const [value, text] of choices) {
    const b = el("button", undefined, text);
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.value = value;
    b.addEventListener("click", () => void set(key, value));
    group.append(b);
  }
  controls.set(as, group);
  return group;
}

// ── State ────────────────────────────────────────────────────────────────────

/** The control for each setting, to redraw from stored values. */
const controls = new Map<string, HTMLElement>();
let built = false;
/** The latest settings from Rust (the agent list comes from there). */
let current: Settings | null = null;
const message = el("p", "set-message");
message.setAttribute("role", "status");

async function set(key: keyof Prefs, value: unknown) {
  try {
    await invoke("set_setting", { key, value });
    say("");
  } catch (e) {
    say(`Couldn't change that: ${String(e)}`, true);
  }
  await refreshSettings();
}

function say(text: string, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
}

// ── Building ─────────────────────────────────────────────────────────────────

/** Characters as cards, each a still drawing of its idle pose (Rui: a picture, in his colours). */
function characterPicker(): HTMLElement {
  const grid = el("div", "char-grid");
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", "Character");
  for (const { id, what } of CHARACTERS) {
    const b = el("button", "char-card");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.value = id;
    b.addEventListener("click", () => void set("character", id));
    grid.append(b);
    if (!isCharacter(id)) {
      const img = el("img", "char-picture");
      img.alt = "";
      img.src = ruiPicture("idle");
      controls.set("ruiPicture", img);
      b.append(img, el("span", "char-name", "Rui"), el("span", "char-what", what));
      continue;
    }
    const c = el("canvas");
    c.setAttribute("aria-hidden", "true");
    b.append(c, el("span", "char-name", CHARACTER_NAMES[id]), el("span", "char-what", what));
    // Drawn once it has a size, and again if that changes: a canvas on a page
    // that isn't showing yet (the Desk Companion window) has none.
    const e = new Engine(SKINS[id]);
    e.addView(c);
    e.setState("IDLE", null, 0);
    let settled = false;
    const draw = () => {
      if (!c.clientWidth) return;
      e.advance(settled ? 0 : 400);
      settled = true;
    };
    new ResizeObserver(draw).observe(c);
    // Dogesh Bhai again in a new outfit.
    if (id === "dogesh") redrawDogesh = draw;
  }
  grid.append(customCard());
  controls.set("character", grid);
  return grid;
}

// ── Your own character ───────────────────────────────────────────────────────

/** Each mood's slot: its title, and when it shows. */
const MOOD_TEXT: Record<Mood, [string, string]> = {
  idle: ["Main", "Shown whenever a mood has no picture of its own"],
  blink: ["Blink", "The main one with its eyes closed, for blinking"],
  working: ["Working", "While an agent works"],
  waiting: ["Needs you", "A permission or a question"],
  done: ["Done", "A task finished"],
  error: ["Oops", "Something went wrong"],
  sleeping: ["Asleep", "After a while with nothing going on"],
  surprised: ["Surprised", "When you poke it or drag it about"],
};
/** What the preview plays for each mood. */
const MOOD_STATE: Record<Mood, [StateName, Variant]> = {
  idle: ["IDLE", null],
  blink: ["IDLE", null],
  working: ["WORKING", null],
  waiting: ["WORKING", "wait"],
  done: ["SUCCESS", null],
  error: ["ERROR", null],
  sleeping: ["SLEEPING", null],
  surprised: ["TOUCHED", "dizzy"],
};

/** Its editor is open without it being the character (its card was clicked before it had a picture). */
let customOpen = false;
/** Redraws its card (new pictures, a new shape). */
let redrawCustomCard: (() => void) | null = null;
/** The editor's live preview. */
let customPreview: Engine | null = null;
/** Take away plain backgrounds from pictures added (on unless switched off here). */
let plainBackground = true;
/** Which prompt the AI box shows and copies. */
let promptKind: "sheet" | "files" = "sheet";

/** Its card: a drawing of it once it has its main picture, else a "+" to make it. */
function customCard(): HTMLElement {
  const b = el("button", "char-card");
  b.type = "button";
  b.setAttribute("role", "radio");
  b.dataset.value = "custom";
  const c = el("canvas");
  c.setAttribute("aria-hidden", "true");
  const plus = el("span", "char-plus", "+");
  plus.setAttribute("aria-hidden", "true");
  const name = el("span", "char-name", "Your own");
  controls.set("customCardName", name);
  b.append(c, plus, name, el("span", "char-what", "your pictures"));
  b.addEventListener("click", () => {
    if (hasCustomCharacter()) {
      void set("character", "custom");
      return;
    }
    // Nothing to show yet: open its editor to add pictures.
    customOpen = true;
    void refreshSettings();
  });
  const e = new Engine(SKINS.custom);
  e.addView(c);
  e.setState("IDLE", null, 0);
  redrawCustomCard = () => {
    const has = hasCustomCharacter();
    c.hidden = !has;
    plus.hidden = has;
    if (has && c.clientWidth) e.advance(400);
  };
  new ResizeObserver(() => redrawCustomCard?.()).observe(c);
  return b;
}

/** A hidden file picker behind a button. */
function picker(label: string, accept: string, multiple: boolean, picked: (files: File[]) => void): HTMLButtonElement {
  const input = el("input");
  input.type = "file";
  input.accept = accept;
  input.multiple = multiple;
  input.hidden = true;
  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length) picked(files);
  });
  const b = el("button", "set-button", label);
  b.type = "button";
  // The input sits in the button: its own click comes up through here too.
  b.addEventListener("click", (e) => {
    if (e.target !== input) input.click();
  });
  b.append(input);
  return b;
}

/** Your own character's choices: making it with an AI, its pictures, name, shape, and a preview. */
function customOptions(): HTMLElement {
  const box = el("div", "rui-options custom-options");
  controls.set("customOptions", box);

  // ① Made with an AI: the prompt to copy, and where its pictures come back in.
  const ai = el("div", "custom-ai");
  const kinds = el("div", "segmented");
  kinds.setAttribute("role", "radiogroup");
  kinds.setAttribute("aria-label", "What the AI makes");
  const promptText = el("pre", "custom-prompt");
  const showPrompt = () => {
    promptText.textContent = promptKind === "sheet" ? sheetPrompt() : filesPrompt();
    for (const b of kinds.children) b.setAttribute("aria-checked", String((b as HTMLElement).dataset.kind === promptKind));
  };
  for (const [kind, label] of [["sheet", "One sheet"], ["files", "Separate files"]] as const) {
    const b = el("button", undefined, label);
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.kind = kind;
    b.addEventListener("click", () => {
      promptKind = kind;
      showPrompt();
    });
    kinds.append(b);
  }
  const copy = el("button", "set-button", "Copy the prompt");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    const text = promptText.textContent ?? "";
    let copied = await navigator.clipboard.writeText(text).then(() => true, () => false);
    if (!copied) {
      // The clipboard API can be refused; copying a selection still works.
      details.open = true;
      const range = document.createRange();
      range.selectNodeContents(promptText);
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      copied = document.execCommand("copy");
    }
    if (copied) customSay("Prompt copied. Paste it into ChatGPT or Gemini along with a picture of your character.");
    else customSay("Couldn't copy it: the prompt is selected below, press Ctrl+C.", true);
  });
  const steps = el("ol", "custom-steps");
  for (const step of [
    "Copy the prompt.",
    "In ChatGPT or Gemini, attach a picture of your character and paste the prompt.",
    "Save the picture it makes and add it here with Add a sheet… (or any Choose…). The app cuts it into the 8 moods and puts each in its place.",
  ]) steps.append(el("li", undefined, step));
  const details = el("details", "custom-prompt-box");
  details.append(el("summary", undefined, "Read the prompt"), promptText);
  const aiHead = row(
    "Make it with AI",
    "An AI that draws pictures can make your character in every mood from one picture of it. One sheet works with any of them; separate files need one that can make a zip. (Claude doesn't draw pictures.)",
    kinds,
  );
  const copyLine = el("div", "custom-buttons");
  copyLine.append(copy);
  ai.append(aiHead, steps, copyLine, details);
  showPrompt();

  // ② Pictures: several at once, or one per mood.
  const sheet = picker("Add a sheet…", PICTURE_TYPES, false, ([file]) => void addSheet(file));
  const many = picker("Add files or a zip…", `${PICTURE_TYPES},.zip,application/zip`, true, (files) => void addFiles(files));
  const addLine = el("div", "custom-buttons");
  addLine.append(sheet, many);
  const addRow = row(
    "Add several at once",
    `A sheet: one picture, 4 moods across and 2 down, in the order below. Files: named after their mood, like ${FILE_NAMES.idle}, ${FILE_NAMES.working}, ${FILE_NAMES.waiting}.`,
    addLine,
  );
  const status = el("p", "set-hint custom-status");
  status.setAttribute("role", "status");
  controls.set("customStatus", status);

  const background = toggle((on) => {
    plainBackground = on;
  });
  background.checked = plainBackground;
  const backgroundRow = row("Remove plain backgrounds", "Takes away a one-colour background around the character (AI pictures usually have one).", background, background.id);

  const slots = el("div", "custom-slots");
  for (const mood of MOODS) slots.append(customSlot(mood));

  const name = el("input", "set-input");
  name.maxLength = 24;
  name.spellcheck = false;
  name.setAttribute("aria-label", "Your character's name");
  controls.set("customNameInput", name);
  const saveName = () => {
    if (name.value.trim() && name.value.trim() !== CHARACTER_NAMES.custom) void set("customName", name.value);
  };
  name.addEventListener("change", saveName);
  name.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveName();
  });
  const nameLine = el("div", "set-key");
  nameLine.append(name);

  // ③ The preview: your character, playing the mood picked under it.
  const preview = el("div", "custom-preview");
  controls.set("customPreviewBox", preview);
  const stage = el("canvas");
  stage.setAttribute("aria-hidden", "true");
  customPreview = new Engine(SKINS.custom);
  customPreview.addView(stage);
  customPreview.setState("IDLE", null, 0);
  const moods = el("div", "custom-moods");
  moods.setAttribute("role", "radiogroup");
  moods.setAttribute("aria-label", "Preview a mood");
  for (const mood of MOODS) {
    if (mood === "blink") continue; // it blinks by itself in Main
    const m = el("button", undefined, MOOD_TEXT[mood][0]);
    m.type = "button";
    m.setAttribute("role", "radio");
    m.setAttribute("aria-checked", String(mood === "idle"));
    m.addEventListener("click", () => {
      for (const other of moods.children) other.setAttribute("aria-checked", String(other === m));
      const [state, variant] = MOOD_STATE[mood];
      customPreview?.setState(state, variant, 200);
    });
    moods.append(m);
  }
  preview.append(stage, moods);

  const use = el("button", "set-button", "Use it");
  use.type = "button";
  use.addEventListener("click", () => void set("character", "custom"));
  const useRow = row("Use your character", "Instead of the one you have now", use);
  controls.set("customUseRow", useRow);

  box.append(
    el("p", "set-hint custom-intro", "Your character is your pictures, brought to life: it breathes, hops, slumps and dozes like the others. One picture is enough; a picture for each mood makes it far livelier."),
    ai,
    addRow,
    backgroundRow,
    status,
    slots,
    row("Name", null, nameLine),
    row("Shape", "As it is suits a picture with a see-through background. Round sticker puts each picture in a white circle, for photos.", segmented("customShape", "Shape", [["free", "As it is"], ["round", "Round sticker"]])),
    preview,
    useRow,
  );
  return box;
}

/** One mood's picture: a thumbnail, Choose… and Remove. */
function customSlot(mood: Mood): HTMLElement {
  const s = el("div", "custom-slot");
  const thumb = el("div", "custom-thumb");
  const img = el("img");
  img.alt = "";
  thumb.append(img);
  const text = el("div", "custom-slot-text");
  text.append(el("span", "custom-slot-title", MOOD_TEXT[mood][0]), el("span", "custom-slot-hint", MOOD_TEXT[mood][1]));
  const what = MOOD_TEXT[mood][0].toLowerCase();
  const choose = picker("Choose…", PICTURE_TYPES, false, ([file]) => void addPicture(mood, file));
  choose.setAttribute("aria-label", `Choose the ${what} picture`);
  const remove = el("button", "set-button", "Remove");
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove the ${what} picture`);
  remove.addEventListener("click", () => void removePicture(mood));
  const buttons = el("div", "custom-slot-buttons");
  buttons.append(choose, remove);
  s.append(thumb, text, buttons);
  controls.set(`customSlot:${mood}`, s);
  return s;
}

/** Shows each slot's picture, and what can be done with it. */
function fillCustom(p: Prefs) {
  applyCustomPrefs(p);
  const has = hasCustomCharacter();
  const open = p.character === "custom" || customOpen;
  controls.get("customOptions")!.hidden = !open;
  controls.get("customCardName")!.textContent = has ? p.customName : "Your own";
  const name = controls.get("customNameInput") as HTMLInputElement;
  if (document.activeElement !== name) name.value = p.customName;
  for (const mood of MOODS) {
    const s = controls.get(`customSlot:${mood}`)!;
    const pic = customPicture(mood);
    const img = s.querySelector("img")!;
    img.hidden = !pic;
    if (pic && img.src !== pic.src) img.src = pic.src;
    s.classList.toggle("no-picture", !pic);
    const [choose, remove] = s.querySelectorAll<HTMLButtonElement>(".custom-slot-buttons > button");
    choose.firstChild!.textContent = pic ? "Change…" : "Choose…";
    remove.hidden = !pic;
  }
  controls.get("customPreviewBox")!.hidden = !has;
  controls.get("customUseRow")!.hidden = !has || p.character === "custom";
  redrawCustomCard?.();
  if (open && has) customPreview?.start();
  else customPreview?.stop();
}

/** A line under the editor's buttons: what just happened. */
function customSay(text: string, error = false) {
  const status = controls.get("customStatus");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("set-error", error);
}

const moodWords = (moods: Iterable<Mood>) => [...moods].map((m) => MOOD_TEXT[m][0]).join(", ");

/** Keeps pictures (base64 PNGs by mood); true when they all went in. */
async function keepPictures(ready: Map<Mood, string>): Promise<Mood[]> {
  const kept: Mood[] = [];
  // The main one first: the others fall back to it.
  for (const mood of [...ready.keys()].sort((a, b) => MOODS.indexOf(a) - MOODS.indexOf(b))) {
    try {
      await invoke("custom_picture_set", { mood, png: ready.get(mood) });
      kept.push(mood);
    } catch (e) {
      customSay(`Couldn't keep the ${MOOD_TEXT[mood][0].toLowerCase()} picture: ${String(e)}`, true);
    }
  }
  return kept;
}

/** After pictures were added: the windows' copies, and (with its first main picture) it becomes the character. */
async function afterAdding(hadMain: boolean) {
  await loadCustomCharacter();
  if (!hadMain && hasCustomCharacter()) await set("character", "custom");
  else await refreshSettings();
}

async function addPicture(mood: Mood, file: File) {
  // A whole sheet picked here is cut up into every mood, not kept as this one.
  if (await isSheet(file, { plainBackground })) return addSheet(file);
  const hadMain = hasCustomCharacter();
  customSay("Getting the picture ready…");
  try {
    const png = await preparePicture(file, { plainBackground });
    await invoke("custom_picture_set", { mood, png });
    customSay(`${MOOD_TEXT[mood][0]} picture added.`);
  } catch (e) {
    customSay(e instanceof Error ? e.message : `Couldn't add it: ${String(e)}`, true);
    return;
  }
  await afterAdding(hadMain);
}

async function addSheet(file: File) {
  const hadMain = hasCustomCharacter();
  customSay("Cutting up the sheet…");
  let ready: Map<Mood, string>;
  try {
    ready = await splitSheet(file, MOODS, { plainBackground });
  } catch (e) {
    customSay(e instanceof Error ? e.message : `Couldn't read that sheet: ${String(e)}`, true);
    return;
  }
  const kept = await keepPictures(ready);
  const missing = MOODS.filter((m) => !ready.has(m));
  customSay(`Added ${kept.length} from the sheet: ${moodWords(kept)}.${missing.length ? ` Empty in the sheet: ${moodWords(missing)}.` : ""}`);
  await afterAdding(hadMain);
}

async function addFiles(files: File[]) {
  const hadMain = hasCustomCharacter();
  customSay("Getting the pictures ready…");
  // Pictures picked as they are, and those inside any zip.
  const named: { name: string; file: Blob }[] = [];
  try {
    for (const f of files) {
      if (/\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed") {
        for (const entry of await readZip(f)) {
          if (isPictureName(entry.name)) named.push({ name: entry.name, file: new Blob([entry.data], { type: pictureType(entry.name) }) });
        }
      } else {
        named.push({ name: f.name, file: f });
      }
    }
  } catch (e) {
    customSay(e instanceof Error ? e.message : `Couldn't open that: ${String(e)}`, true);
    return;
  }
  // A sheet among them (by its name, or a picture that is one) is cut up; the rest go by their names.
  let sheetFile = named.find((n) => moodFromName(n.name) === "sheet");
  if (!sheetFile) {
    for (const n of named) {
      if (moodFromName(n.name) === null && (await isSheet(n.file, { plainBackground }))) {
        sheetFile = n;
        break;
      }
    }
  }
  const items = new Map<Mood, { key: Mood; file: Blob }>();
  const unknown: string[] = [];
  for (const n of named) {
    const mood = moodFromName(n.name);
    if (mood === "sheet" || n === sheetFile) continue;
    if (mood && !items.has(mood)) items.set(mood, { key: mood, file: n.file });
    else unknown.push(n.name.split("/").pop() ?? n.name);
  }
  const ready = new Map<Mood, string>();
  const failed: string[] = [];
  if (sheetFile) {
    try {
      for (const [m, png] of await splitSheet(sheetFile.file, MOODS, { plainBackground })) ready.set(m, png);
    } catch (e) {
      failed.push(`the sheet (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  const set_ = await prepareSet([...items.values()], { plainBackground });
  for (const [m, png] of set_.ready) ready.set(m, png); // named files win over the sheet's cells
  for (const f of set_.failed) failed.push(`${MOOD_TEXT[f.key][0]} (${f.why})`);
  if (!ready.size) {
    customSay(
      unknown.length
        ? `None of those names say which mood they are (${unknown.slice(0, 3).join(", ")}…). Name them like ${FILE_NAMES.idle}, ${FILE_NAMES.done}, or add them one by one below.`
        : `Nothing could be added${failed.length ? `: ${failed.join("; ")}` : "."}`,
      true,
    );
    return;
  }
  const kept = await keepPictures(ready);
  const notes = [
    `Added ${kept.length}: ${moodWords(kept)}.`,
    unknown.length ? `Not used (name not recognised): ${unknown.join(", ")}.` : "",
    failed.length ? `Couldn't use: ${failed.join("; ")}.` : "",
  ];
  customSay(notes.filter(Boolean).join(" "), unknown.length + failed.length > 0);
  await afterAdding(hadMain);
}

async function removePicture(mood: Mood) {
  try {
    await invoke("custom_picture_clear", { mood });
    customSay(`${MOOD_TEXT[mood][0]} picture removed.`);
  } catch (e) {
    customSay(`Couldn't remove it: ${String(e)}`, true);
  }
  await loadCustomCharacter();
  // Without its main picture it isn't the character any more; the editor stays open to add another.
  if (mood === "idle") customOpen = true;
  await refreshSettings();
}

/** Redraws Dogesh Bhai's card (after a change of outfit). */
let redrawDogesh: (() => void) | null = null;

/** Dogesh Bhai's own choices: his outfit, 3D or 2D, and (in 3D) the same look as Rui's. Shown while he's the character. */
function dogeshOptions(): HTMLElement {
  const box = el("div", "rui-options");
  controls.set("dogeshOptions", box);

  // His outfits as little picture cards, each a drawing of him wearing it.
  const outfits = el("div", "outfit-grid");
  outfits.setAttribute("role", "radiogroup");
  outfits.setAttribute("aria-label", "Dogesh Bhai's outfit");
  for (const name of OUTFIT_NAMES) {
    const b = el("button", "outfit-card");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.value = name;
    b.title = OUTFITS[name].blurb;
    const c = el("canvas");
    c.setAttribute("aria-hidden", "true");
    b.append(c, el("span", "outfit-name", OUTFITS[name].label));
    b.addEventListener("click", () => void set("dogeshOutfit", name));
    outfits.append(b);
    const e = new Engine(SKINS.dogesh);
    e.addView(c);
    e.setState("IDLE", null, 0);
    let settled = false;
    new ResizeObserver(() => {
      if (!c.clientWidth || settled) return;
      settled = true;
      withDogeshOutfit(name, () => e.advance(400));
    }).observe(c);
  }
  controls.set("dogeshOutfit", outfits);
  const outfitRow = row("Outfit", null, el("span"));
  const outfitBlurb = el("span", "set-hint");
  controls.set("dogeshOutfitBlurb", outfitBlurb);
  outfitRow.querySelector(".set-text")!.append(outfitBlurb);
  const outfitBox = el("div", "outfit-box");
  outfitBox.append(outfitRow, outfits);

  const lookRow = row(
    "3D look",
    "Toy: soft vinyl. Anime: flat colours and outlines.",
    segmented("ruiLook", "Dogesh Bhai's look", LOOK_NAMES.map((l) => [l, LOOKS[l]]), "ruiLook:dogesh"),
  );
  controls.set("dogeshLookRow", lookRow);
  box.append(
    row(
      "Drawn in",
      "3D: a little 3D pup, like Rui. 2D: drawn like the others, and lighter on your PC.",
      segmented("dogeshStyle", "Dogesh Bhai is drawn in", [["3d", "3D"], ["2d", "2D"]]),
    ),
    lookRow,
    outfitBox,
  );
  return box;
}

/** Rui's own choices: shown while he's the character. */
function ruiOptions(): HTMLElement {
  const box = el("div", "rui-options");
  controls.set("ruiOptions", box);

  const swatches = el("div", "swatches");
  swatches.setAttribute("role", "radiogroup");
  swatches.setAttribute("aria-label", "Rui's colour");
  for (const name of THEME_NAMES) {
    const { body, accent } = themeColors(name);
    const b = el("button", "swatch");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.value = name;
    b.title = THEMES[name].label;
    b.setAttribute("aria-label", THEMES[name].label);
    const chip = el("span", "chip");
    chip.style.background = `linear-gradient(135deg, ${body} 55%, ${accent} 55%)`;
    b.append(chip);
    b.addEventListener("click", () => void set("ruiTheme", name));
    swatches.append(b);
  }
  controls.set("ruiTheme", swatches);
  const colourName = el("span", "set-hint");
  controls.set("ruiThemeName", colourName);

  const look = segmented("ruiLook", "Rui's look", LOOK_NAMES.map((l) => [l, LOOKS[l]]));
  box.append(
    row("Rui's look", "Toy: soft vinyl. Anime: flat colours and outlines.", look),
    row("Rui's colour", null, swatches),
    switchRow("ruiFlatOnBattery", "On battery, use a 2D character", "Saves power on a laptop. Rui comes back when you plug in."),
  );
  // The colour's name goes under the title.
  box.children[1].querySelector(".set-text")!.append(colourName);
  return box;
}

function build() {
  // Appearance
  const sizeRow = row("Size", null, segmented("size", "Size", [["small", "Small"], ["medium", "Medium"], ["large", "Large"]]));
  sizeRow.dataset.for = "size";
  const appearance = section(
    "Appearance",
    characterPicker(),
    ruiOptions(),
    dogeshOptions(),
    customOptions(),
    row("Where I live", null, segmented("place", "Where I live", [["corner", "Desktop"], ["top", "Top edge"]])),
    row(
      "Theme",
      "Character: colours from your character (Rui and Dogesh Bhai: from what they wear). System follows Windows.",
      segmented("uiTheme", "Theme", Object.entries(UI_THEMES)),
    ),
    sizeRow,
    switchRow("hideFullscreen", "Step aside for full-screen apps", "Games, videos and slideshows"),
  );

  // Notifications
  const pause = el("select", "set-select");
  pause.id = `set-c-${++uid}`;
  pause.addEventListener("change", () => {
    const v = pause.value;
    if (v === "keep") return;
    void set("quietUntil", v === "off" ? 0 : PAUSES[Number(v)].until());
  });
  controls.set("quietUntil", pause);

  const every = el("select", "set-select");
  every.id = `set-c-${++uid}`;
  every.setAttribute("aria-label", "Break reminder interval");
  for (const m of BREAK_CHOICES) every.append(new Option(`Every ${m} min`, String(m)));
  every.addEventListener("change", () => void set("breakMinutes", Number(every.value)));
  controls.set("breakMinutes", every);
  const breaks = toggle((on) => void set("breaks", on));
  controls.set("breaks", breaks);
  const breakControls = el("div", "set-pair");
  breakControls.append(every, breaks);

  const notifications = section(
    "Notifications",
    row("Pause notifications", "Permission requests still show: an agent is waiting on them", pause, pause.id),
    row("Break reminders", null, breakControls, breaks.id),
    switchRow("battery", "Low battery"),
    switchRow("downloads", "Finished downloads"),
    switchRow("welcome", "Welcome back", "After you've been away 20 minutes or more"),
    switchRow("sounds", "Sounds", "A soft chime when a task finishes, an agent needs you, or something fails"),
  );

  // Coding agents: one switch each, in the order Rust lists them.
  const agentRows = (current?.agents ?? []).map((a) => {
    const t = toggle(async (on) => {
      try {
        say(await invoke<string>("set_agent_connected", { agent: a.id, on }));
      } catch (e) {
        say(String(e), true);
      }
      await refreshSettings();
    });
    controls.set(`agent:${a.id}`, t);
    const r = row(a.name, AGENT_HINTS[a.id] ?? null, t, t.id);
    r.dataset.agent = a.id;
    return r;
  });
  // The relay test: can agents actually reach the app (an antivirus may hold the relay)?
  const testLine = el("div", "set-key");
  controls.set("relayTest", testLine);
  const testStatus = el("span", "set-hint set-update-status");
  controls.set("relayTestStatus", testStatus);
  const testRow = row("Connection test", null, testLine);
  testRow.querySelector(".set-text")?.append(testStatus);
  const agents = section(
    "Coding agents",
    testRow,
    ...agentRows,
    switchRow("notifyWorking", "What agents are working on", "A few seconds when one starts. In the top island it's always on its status line."),
    switchRow("notifyDone", "When a task finishes"),
    switchRow("notifyPermission", "When an agent needs permission"),
    switchRow("answerPermissions", "Allow / Deny from here", "Off: requests go straight to your terminal. Nothing is ever allowed unless you click Allow or press its shortcut."),
    switchRow(
      "keyboardShortcuts",
      "Keyboard shortcuts",
      "Ctrl+Alt+Y / Ctrl+Alt+N: Allow / Deny the request on screen. Ctrl+Alt+J: go to the agent that needs you. Ctrl+Alt+A: activity. Ctrl+Alt+M: pause notifications. Ctrl+Alt+H: hide or show the character.",
    ),
    switchRow("notifyWaiting", "When an agent is waiting for you"),
    switchRow("notifyErrors", "When something fails"),
  );

  // Phone
  const phoneBox = el("div", "set-phone");
  controls.set("phoneBox", phoneBox);
  const relayBox = relaySettings();
  const phone = section(
    "Phone",
    switchRow(
      "phoneLink",
      "Link a phone",
      "Desk Companion for Android: see your agents and Allow / Deny from your phone, over your own Wi-Fi (or your phone's hotspot).",
    ),
    switchRow(
      "phonePeek",
      "Peek from the phone",
      "Lets the phone ask for a picture of an agent's window (only that window, one picture per tap) so you can see what it's asking. A notice here says each time it happens.",
    ),
    phoneBox,
    relayBox,
  );

  // Ask
  const keyLine = el("div", "set-key");
  controls.set("key", keyLine);
  const device = el("pre", "set-device");
  controls.set("device", device);
  const shared = el("details", "set-details");
  shared.append(el("summary", undefined, "What's in the device details"), device);
  const ask = section(
    "Ask (AI)",
    switchRow("askEnabled", "Ask tab", "Questions about your PC, answered by Claude with your own API key"),
    switchRow("shareDevice", "Send device details with questions", "Windows version, model, processor, memory, disk, battery"),
    shared,
    row("API key", null, keyLine),
  );

  // System
  const autostart = toggle(async (on) => {
    try {
      await invoke("set_autostart", { on });
      say("");
    } catch (e) {
      say(String(e), true);
    }
    await refreshSettings();
  });
  controls.set("autostart", autostart);
  const version = el("p", "set-version");
  controls.set("version", version);

  // Updates: what's on offer, and the buttons to get it.
  // The status (which can be a long error) sits under the title; only the button is on the right.
  const updateLine = el("div", "set-key");
  controls.set("update", updateLine);
  const updateStatus = el("span", "set-hint set-update-status");
  controls.set("updateStatus", updateStatus);
  const updatesRow = row("Updates", null, updateLine);
  updatesRow.querySelector(".set-text")?.append(updateStatus);
  const system = section(
    "System",
    row("Start with Windows", null, autostart, autostart.id),
    switchRow("autoUpdate", "Check for updates automatically", "Every few hours. Installing always waits for your click."),
    updatesRow,
    version,
  );
  void checkUpdates(false);

  root.replaceChildren(message, appearance, notifications, agents, phone, ask, system);
  built = true;
}

// ── Updates ──────────────────────────────────────────────────────────────────

let update: UpdateInfo | null = null;
let updateState: "idle" | "checking" | "installing" | "error" = "idle";
let updateError = "";
/** While installing: how much is downloaded (0–1, null while the size isn't known), then "installing". */
let updateProgress: number | null | "installing" = null;

void listen<{ done: number; total: number | null }>("update:progress", ({ payload }) => {
  updateProgress = payload.total ? Math.min(1, payload.done / payload.total) : null;
  drawUpdateButton();
});
void listen("update:installing", () => {
  updateProgress = "installing";
  drawUpdateButton();
});

async function checkUpdates(userAsked: boolean) {
  updateState = "checking";
  drawUpdates();
  try {
    update = await invoke<UpdateInfo>("check_update");
    updateState = "idle";
    if (userAsked && update.configured && !update.available) say("You have the latest version.");
  } catch (e) {
    updateState = "error";
    updateError = String(e);
  }
  drawUpdates();
}

async function installUpdate() {
  updateState = "installing";
  updateProgress = null;
  drawUpdates();
  try {
    await invoke("install_update"); // the app restarts when it's done
  } catch (e) {
    updateState = "error";
    updateError = String(e);
    drawUpdates();
  }
}

function drawUpdates() {
  const line = controls.get("update");
  const status = controls.get("updateStatus");
  if (!line || !status) return;
  line.replaceChildren();
  status.textContent = "";
  const hint = (text: string) => (status.textContent = text);
  const button = (text: string, onClick: () => void, disabled = false) => {
    const b = el("button", "set-button", text);
    b.type = "button";
    b.disabled = disabled;
    b.addEventListener("click", onClick);
    line.append(b);
  };
  if (update && !update.configured) {
    hint("This copy doesn't have an update server set up.");
    return;
  }
  if (updateState === "installing") {
    hint("Downloading and installing… I'll restart when it's done.");
    // The button fills from the left as the download goes.
    button("", () => {}, true);
    line.lastElementChild?.classList.add("set-progress");
    drawUpdateButton();
    return;
  }
  if (updateState === "error") hint(updateError);
  else if (updateState === "checking") hint("Checking…");
  else if (update?.available) hint(`Version ${update.available} is ready`);
  else if (update) hint("You're up to date");
  if (update?.available && updateState !== "checking") button(`Install ${update.available} and restart`, () => void installUpdate());
  else button(updateState === "checking" ? "Checking…" : "Check now", () => void checkUpdates(true), updateState === "checking");
  if (updateState === "checking") line.lastElementChild?.classList.add("set-progress", "set-progress-busy");
}

/** The install button's fill and words, from the latest download progress. */
function drawUpdateButton() {
  const b = controls.get("update")?.querySelector<HTMLElement>(".set-progress");
  if (!b || updateState !== "installing") return;
  const p = updateProgress;
  b.classList.toggle("set-progress-busy", p === null);
  b.style.setProperty("--progress", typeof p === "number" ? String(p) : "1");
  b.textContent = p === "installing" ? "Installing…" : typeof p === "number" ? `Downloading ${Math.floor(p * 100)}%` : "Downloading…";
  if (typeof p === "number") b.setAttribute("aria-valuenow", String(Math.floor(p * 100)));
  b.setAttribute("role", "progressbar");
}

// ── Connection test ──────────────────────────────────────────────────────────

let relayTest: RelayTest | null = null;
let testing = false;

async function runRelayTest() {
  testing = true;
  drawRelayTest();
  try {
    relayTest = await invoke<RelayTest>("test_connection");
  } finally {
    testing = false;
  }
  await refreshSettings();
}

function drawRelayTest() {
  const line = controls.get("relayTest");
  const status = controls.get("relayTestStatus");
  if (!line || !status) return;
  const t = relayTest;
  status.textContent = testing
    ? "Running the relay the way your agents do…"
    : !t
      ? "Checks that your agents can reach me (an antivirus can block the relay)."
      : t.ok
        ? `Passed ${since(Date.now() - t.at)}: agents reach me in ${t.ms} ms.`
        : t.problem ?? "Failed.";
  status.classList.toggle("set-error", !testing && t !== null && !t.ok);
  line.replaceChildren();
  const b = el("button", "set-button", testing ? "Testing…" : "Test");
  b.type = "button";
  b.disabled = testing;
  if (testing) b.classList.add("set-progress", "set-progress-busy");
  b.addEventListener("click", () => void runRelayTest());
  line.append(b);
}

// ── Redrawing from the stored values ─────────────────────────────────────────

function time(ms: number): string {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? hm : `${d.toLocaleDateString([], { weekday: "short" })} ${hm}`;
}

function fill(s: Settings, ask: AskStatus) {
  const p = s.prefs;
  for (const [key, node] of controls) {
    if (node instanceof HTMLInputElement && key in p) node.checked = Boolean(p[key as keyof Prefs]);
    if (node.getAttribute("role") === "radiogroup") {
      const value = String(p[key.split(":")[0] as keyof Prefs]);
      for (const b of node.querySelectorAll<HTMLButtonElement>("[data-value]")) {
        b.setAttribute("aria-checked", String(b.dataset.value === value));
      }
    }
  }

  // Rui: his picture in the saved look and colour; his own choices only while he's chosen.
  setRuiStyle(p);
  (controls.get("ruiPicture") as HTMLImageElement).src = ruiPicture("idle");
  controls.get("ruiOptions")!.hidden = p.character !== "rui";
  controls.get("dogeshOptions")!.hidden = p.character !== "dogesh";
  fillCustom(p);
  controls.get("dogeshLookRow")!.hidden = p.dogeshStyle === "2d";
  const outfit = OUTFITS[p.dogeshOutfit as keyof typeof OUTFITS] ?? OUTFITS.cozy;
  controls.get("dogeshOutfitBlurb")!.textContent = `${outfit.label}: ${outfit.blurb} He changes into it with a little scene.`;
  setDogeshOutfit(p.dogeshOutfit);
  redrawDogesh?.();
  const themeName = THEMES[p.ruiTheme as keyof typeof THEMES]?.label ?? "";
  controls.get("ruiThemeName")!.textContent = `${themeName}. He changes into it with a little scene.`;

  // Size only applies on the desktop.
  const top = p.place === "top";
  const size = controls.get("size")!;
  for (const b of size.querySelectorAll("button")) b.disabled = top;
  const sizeRow = root.querySelector<HTMLElement>('[data-for="size"] .set-text')!;
  sizeRow.querySelector(".set-hint")?.remove();
  if (top) sizeRow.append(el("span", "set-hint", "On the desktop only"));

  // Pause: what's on now, then the choices.
  const pause = controls.get("quietUntil") as HTMLSelectElement;
  const pausedNow = p.quietUntil === -1 || p.quietUntil > Date.now();
  pause.replaceChildren();
  if (pausedNow) {
    pause.append(new Option(p.quietUntil === -1 ? "Paused" : `Paused until ${time(p.quietUntil)}`, "keep"));
    pause.append(new Option("Resume now", "off"));
  } else {
    pause.append(new Option("Off", "off"));
  }
  PAUSES.forEach((c, k) => pause.append(new Option(c.label, String(k))));
  pause.value = pausedNow ? "keep" : "off";

  const every = controls.get("breakMinutes") as HTMLSelectElement;
  if (![...every.options].some((o) => o.value === String(p.breakMinutes))) {
    every.append(new Option(`Every ${p.breakMinutes} min`, String(p.breakMinutes)));
  }
  every.value = String(p.breakMinutes);
  every.disabled = !p.breaks;

  // The relay: only with the link on; its address as saved, unless it's being edited.
  controls.get("relayBox")!.hidden = !p.phoneLink;
  const relayInput = controls.get("relayUrl") as HTMLInputElement;
  if (document.activeElement !== relayInput) relayInput.value = p.relayUrl;
  relayInput.placeholder = s.builtInRelay ?? "https://desk-companion-relay.<your-name>.workers.dev";
  const builtIn = controls.get("relayBuiltIn")!;
  builtIn.textContent = s.builtInRelay ? `Empty uses the relay built into this copy (${s.builtInRelay}). Paste another to use your own.` : "";
  builtIn.hidden = !s.builtInRelay;
  (controls.get("phoneRelay") as HTMLInputElement).disabled = !p.relayUrl && !s.builtInRelay && !p.phoneRelay;

  (controls.get("phonePeek") as HTMLInputElement).disabled = !p.phoneLink;

  // Answering from here only makes sense while permission requests show here.
  (controls.get("answerPermissions") as HTMLInputElement).disabled = !p.notifyPermission;

  for (const a of s.agents) {
    const t = controls.get(`agent:${a.id}`) as HTMLInputElement | undefined;
    if (!t) continue;
    t.checked = a.connected;
    // Not on this PC: nothing to connect (but always allowed to disconnect).
    t.disabled = !a.installed && !a.connected;
    const text = root.querySelector<HTMLElement>(`[data-agent="${a.id}"] .set-text`);
    text?.querySelector(".set-link")?.remove();
    const link = el("span", "set-hint set-link", linkText(a, s.relayTest));
    link.dataset.state = linkState(a, s.relayTest);
    text?.append(link);
  }
  relayTest = s.relayTest;
  drawRelayTest();
  (controls.get("autostart") as HTMLInputElement).checked = s.autostart;
  (controls.get("shareDevice") as HTMLInputElement).disabled = !p.askEnabled;
  controls.get("device")!.textContent = ask.device;

  const keyLine = controls.get("key")!;
  keyLine.replaceChildren();
  if (ask.hasKey) {
    keyLine.append(el("span", "set-hint", "Saved in Windows Credential Manager"));
    const remove = el("button", "set-button", "Remove");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      await invoke("assistant_forget_key");
      say("API key removed.");
      await refreshSettings();
    });
    keyLine.append(remove);
  } else {
    keyLine.append(el("span", "set-hint", "Not added"));
    const add = el("button", "set-button", "Add in Ask");
    add.type = "button";
    add.disabled = !p.askEnabled;
    add.addEventListener("click", () => window.dispatchEvent(new CustomEvent("settings:open-ask")));
    keyLine.append(add);
  }

  controls.get("version")!.textContent = `Desk Companion ${s.version}`;
}

/** Fetches the stored settings and redraws the tab (builds it the first time). */
export async function refreshSettings() {
  const [s, ask] = await Promise.all([invoke<Settings>("get_settings"), invoke<AskStatus>("assistant_status")]);
  current = s;
  if (!built) build();
  drawUpdates();
  fill(s, ask);
  await refreshPhone();
}

// ── Phone link ───────────────────────────────────────────────────────────────

let phoneStatus: PhoneStatus | null = null;
/** The pairing code, while shown (only after a click: anyone who sees it can pair a phone). */
let pairing: Pairing | null = null;
/** "Pair again" asks once more before cutting off the phones. */
let confirmPairAgain = false;

async function refreshPhone() {
  phoneStatus = await invoke<PhoneStatus>("phone_status").catch(() => null);
  drawPhone();
}

// Phones connecting and leaving, the link starting or failing.
void listen<PhoneStatus>("phone-status", ({ payload }) => {
  phoneStatus = payload;
  if (built) drawPhone();
});

/** Away from home: the relay switch, its address, and how it's doing. */
function relaySettings(): HTMLElement {
  const box = el("div", "set-relay");
  controls.set("relayBox", box);
  const input = el("input", "set-input");
  input.type = "url";
  input.spellcheck = false;
  input.placeholder = "https://desk-companion-relay.<your-name>.workers.dev";
  input.setAttribute("aria-label", "Relay address");
  controls.set("relayUrl", input);
  const save = el("button", "set-button", "Save");
  save.type = "button";
  const store = () => void set("relayUrl", input.value.trim());
  save.addEventListener("click", store);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") store();
  });
  const line = el("div", "set-key");
  line.append(input, save);
  const address = el("label", "set-relay-address");
  const builtIn = el("span", "set-hint");
  controls.set("relayBuiltIn", builtIn);
  address.append(el("span", "set-title", "Relay address"), line, builtIn);
  const status = el("p", "set-hint");
  controls.set("relayStatus", status);
  box.append(
    switchRow(
      "phoneRelay",
      "Reach your phone anywhere",
      "When the phone isn't on this network, it connects through a relay you run on Cloudflare (free). Everything is encrypted between this PC and the phone: the relay can't read it. Setup: docs/RELAY.md.",
    ),
    address,
    status,
  );
  return box;
}

/** "Relay: connected", or what's wrong. */
function drawRelay() {
  const status = controls.get("relayStatus");
  if (!status) return;
  const r = phoneStatus?.relay;
  const words: Record<string, string> = {
    off: "",
    connecting: "Relay: connecting…",
    connected: "Relay: connected. Your phone can reach this PC from anywhere.",
    retrying: `Relay: not connected${r?.error ? `. ${r.error}` : ""}. Trying again.`,
  };
  status.textContent = r ? words[r.state] : "";
  status.classList.toggle("set-error", r?.state === "retrying");
  status.hidden = !status.textContent;
}

function drawPhone() {
  drawRelay();
  const box = controls.get("phoneBox");
  if (!box) return;
  box.replaceChildren();
  const s = phoneStatus;
  if (!s?.on) {
    pairing = null;
    confirmPairAgain = false;
    box.hidden = true;
    return;
  }
  box.hidden = false;
  if (s.error) {
    box.append(el("p", "set-hint set-error", s.error));
    return;
  }
  if (!s.listening) {
    box.append(el("p", "set-hint", "Starting…"));
    return;
  }

  const where = s.hosts.length
    ? `Listening on ${s.hosts[0]}, port ${s.port}.`
    : s.relay.state !== "off"
      ? "No local network a phone can join: phones connect through the relay."
      : "This PC isn't on a network a phone can reach. Connect to Wi-Fi or your phone's hotspot.";
  box.append(el("p", "set-hint", where));
  if (s.phones.length) {
    for (const p of s.phones) {
      const line = el("p", "set-phone-item");
      line.append(el("span", "set-dot"), `${p.device} connected (${p.address === "relay" ? "through the relay" : p.address})`);
      box.append(line);
    }
  } else {
    box.append(el("p", "set-hint", "No phone connected."));
    box.append(el("p", "set-hint", "If a phone can't connect, allow Desk Companion through Windows Firewall on private networks (Windows asks the first time: tick Private)."));
  }

  const buttons = el("div", "set-key");
  const show = el("button", "set-button", pairing ? "Hide pairing code" : "Show pairing code");
  show.type = "button";
  show.disabled = s.hosts.length === 0 && s.relay.state === "off";
  show.addEventListener("click", async () => {
    if (pairing) {
      pairing = null;
    } else {
      try {
        pairing = await invoke<Pairing>("phone_pairing");
        say("");
      } catch (e) {
        say(String(e), true);
      }
    }
    drawPhone();
  });
  const again = el("button", "set-button", confirmPairAgain ? "Yes, unlink every phone" : "Pair again");
  again.type = "button";
  again.title = "A new code: phones paired before are unlinked and must scan again";
  again.addEventListener("click", async () => {
    if (!confirmPairAgain) {
      confirmPairAgain = true;
      drawPhone();
      return;
    }
    confirmPairAgain = false;
    try {
      phoneStatus = await invoke<PhoneStatus>("phone_pair_again");
      if (pairing) pairing = await invoke<Pairing>("phone_pairing");
      say("New pairing code made. Phones paired before have been unlinked.");
    } catch (e) {
      say(String(e), true);
    }
    drawPhone();
  });
  buttons.append(show, again);
  box.append(buttons);

  if (pairing) {
    const code = el("div", "set-qr");
    const img = el("img");
    img.src = pairing.qr;
    img.alt = "Pairing code for Desk Companion on your phone";
    img.width = 200;
    img.height = 200;
    code.append(img);
    const how = el("div", "set-qr-text");
    how.append(
      el("span", "set-title", `Pair with ${pairing.name}`),
      el("span", "set-hint", "In Desk Companion on your phone: Settings → Link a computer, then scan this code."),
      el("span", "set-hint", "Anyone who sees this code can link a phone until you pair again."),
      el("span", "set-hint", "The first time, Windows may ask whether to allow Desk Companion on private networks: allow it, or the phone can't connect."),
    );
    code.append(how);
    box.append(code);
  }
}
