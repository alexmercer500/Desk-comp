// The Settings tab: everything the companion can do, each switchable, the way
// coucou has it. Every change goes to Rust (`set_setting` and friends), which
// checks it, saves it, applies it, ticks the tray to match and tells every
// window ("prefs"); this tab then redraws from what was actually stored.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Engine } from "../engine/engine";
import type { CharacterId } from "../engine/types";
import { CHARACTER_NAMES, SKINS, isCharacter } from "../skins";
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
  ruiFlatOnBattery: boolean;
  phoneLink: boolean;
  phoneRelay: boolean;
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
  commandcode: "Adds a small mod and hooks to Command Code: the CLI, the desktop app and the VS Code chat panel. Shows each step and when it's done; in the CLI and app also when it's stopped or waiting for your OK, and its questions can be answered here.",
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
  controls.set("character", grid);
  return grid;
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
    switchRow("answerPermissions", "Allow / Deny from here", "Off: requests go straight to your terminal. Nothing is ever allowed without your click."),
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
