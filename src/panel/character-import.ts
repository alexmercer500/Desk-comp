// Making your own character with an AI (Settings): the prompt to give
// ChatGPT, Gemini or the like with one picture of the character, and how the
// pictures it makes come back in. A sheet (one picture, every mood in a 4 × 2
// grid, in MOODS order) is the sure way: image AIs can't name the files they
// make. Pictures can also come one by one, or several at once or in a zip,
// named after their mood (FILE_NAMES, and the other names moodFromName knows).

import { MOODS, type Mood } from "../skins/custom";

/** What each mood asks the AI to draw. */
const DRAW: Record<Mood, string> = {
  idle: "Idle: relaxed and friendly, a small smile, eyes open. This is the main picture.",
  blink: "Blink: exactly the same as Idle, only with the eyes closed.",
  working: "Working: focused and busy, for example typing on a small laptop or reading something closely.",
  waiting: "Needs you: alert, waving or raising a hand to get attention, eyebrows up.",
  done: "Done: very happy, celebrating, arms up, a big smile.",
  error: "Oops: something went wrong, worried or embarrassed, a small sweat drop.",
  sleeping: "Asleep: eyes closed, peaceful, sleeping (a small \"z\" is fine).",
  surprised: "Surprised: startled, eyes wide, as if someone just poked it.",
};

/** The file name the "separate pictures" prompt asks for, per mood (Settings' own words). */
export const FILE_NAMES: Record<Mood, string> = {
  idle: "idle.png",
  blink: "blink.png",
  working: "working.png",
  waiting: "needs-you.png",
  done: "done.png",
  error: "oops.png",
  sleeping: "asleep.png",
  surprised: "surprised.png",
};

const SAME = [
  "The same character in every picture: the same design, colours, proportions, art style and size as my picture. Only the expression and pose change.",
  "Show the whole character (or the same crop as my picture), facing the viewer.",
  "Keep it simple and readable when small (about 100 pixels tall): bold shapes, clear outlines, no tiny details.",
];

/** The prompt for one sheet: works with any AI that draws pictures. */
export function sheetPrompt(): string {
  const cells = MOODS.map((m, n) => `${n + 1}. ${DRAW[m]}`);
  return [
    "I'm attaching a picture of a character. Please draw a character sheet of this same character in 8 moods, for a little desktop companion app.",
    "",
    "Layout (an app cuts the sheet up by position, so this matters):",
    "- One wide picture (landscape, about 2:1), divided into a grid of 4 columns and 2 rows of equal cells.",
    "- One mood per cell, the character whole and centred in its cell, with clear space all round. Nothing crosses into another cell.",
    "- The same plain, flat background colour everywhere (pure white, or transparent if you can). No floor, no shadows, no scenery, no grid lines or borders, no text, labels or numbers.",
    ...SAME.map((s) => `- ${s}`),
    "- Draw the character at the same size in every cell.",
    "",
    "The cells, left to right: the top row is 1 to 4, the bottom row 5 to 8.",
    ...cells,
  ].join("\n");
}

/** The prompt for separate pictures in a zip: for an AI that can make files. */
export function filesPrompt(): string {
  const files = MOODS.map((m) => `- ${FILE_NAMES[m]}: ${DRAW[m]}`);
  return [
    "I'm attaching a picture of a character. Please make 8 pictures of this same character in different moods, for a little desktop companion app, and give them to me together in one .zip file.",
    "",
    "Each picture:",
    "- A PNG with a transparent background (or a plain white one if you can't). No floor, shadows, scenery or text.",
    "- All 8 the same size (for example 512 × 512), the character centred and whole, at the same size in every picture.",
    ...SAME.map((s) => `- ${s}`),
    "",
    "Name the files exactly like this (the app reads the names):",
    ...files,
  ].join("\n");
}

/** Other names a mood's picture may have (checked as whole words of the file name). */
const NAMES: [Mood | "sheet", string[]][] = [
  // The more particular first: "idle-blink" is a blink.
  ["sheet", ["sheet", "grid", "spritesheet", "sprite-sheet", "character-sheet"]],
  ["blink", ["blink", "blinking", "eyes-closed", "closed-eyes"]],
  ["surprised", ["surprised", "surprise", "startled", "shocked", "poked", "held"]],
  ["sleeping", ["asleep", "sleeping", "sleep", "sleepy"]],
  ["waiting", ["needs-you", "needsyou", "waiting", "wait", "attention", "alert", "notify", "question"]],
  ["working", ["working", "work", "busy", "typing"]],
  ["done", ["done", "happy", "success", "celebrate", "celebrating"]],
  ["error", ["oops", "error", "sad", "fail", "failed", "worried"]],
  ["idle", ["idle", "main", "default", "neutral", "normal", "base"]],
];

/** The mood a file is for, by its name ("needs-you.png", "Mochi_Asleep.webp"), a sheet, or null. */
export function moodFromName(path: string): Mood | "sheet" | null {
  const base = path.split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.[^.]*$/, "").toLowerCase();
  const words = `-${stem.split(/[^a-z0-9]+/).filter(Boolean).join("-")}-`;
  for (const [mood, names] of NAMES) {
    if (names.some((n) => words.includes(`-${n}-`))) return mood;
  }
  return null;
}

/** Files that are pictures, by their name (a zip's own entries have no type). */
export const isPictureName = (path: string) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(path) && !/(^|\/)(__MACOSX|\.)/.test(path);

/** A picture's type from its name, for the browser to open it. */
export function pictureType(path: string): string {
  const ext = path.toLowerCase().split(".").pop();
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext ? `image/${ext}` : "";
}
