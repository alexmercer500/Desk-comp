// Your own character: pictures you picked (Settings), one per mood, brought to
// life with the motion every character shares (common.ts): breathing, a hop
// when a task is done, a slump on an error, a pop when an agent needs you,
// Z's while asleep. The picture changes with the mood, through the engine's
// eye morph (a quick squash, swap, and back), so a mood never just blinks over.
// With a "blink" picture (its eyes closed) the main one blinks now and then,
// and sleeps with it when there's no "sleeping" one.
//
// The pictures live in the app (custom.rs); custom-load.ts brings them into
// each window. Until the main one is here there's nothing to draw.

import { Ease } from "../engine/ease";
import { kf } from "../engine/track";
import type { Emit, Frame, Pose, PoseInput, PoseOut, Skin, StateName, Variant } from "../engine/types";
import {
  DEG, ENGINE_REST, TAU, confusedTilt, crossedAt, dizzyWobble, errorSlump, heldSwing,
  landingSquash, notifyPop, successHop, touchSquash,
} from "./common";

/**
 * What a picture can be for. "idle" is the main one, shown for any mood
 * without its own; "blink" is the main one with its eyes closed; "surprised"
 * is for being poked or dragged. In the order Settings (and a sheet) has them.
 */
export type Mood = "idle" | "blink" | "working" | "waiting" | "done" | "error" | "sleeping" | "surprised";
export const MOODS: readonly Mood[] = ["idle", "blink", "working", "waiting", "done", "error", "sleeping", "surprised"];

/** How the pictures are shown: as they are, or each as a round sticker (good for photos). */
export type Shape = "free" | "round";

type Picture = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

let pictures: Partial<Record<Mood, Picture>> = {};
let shape: Shape = "free";

/** How the character sits in its square view (as every skin's `fit`). */
const FIT = { units: 1.45, base: 0.93 };
/** The box a picture is fitted into, units (1 = the character's height in the others). */
const BOX = 1.15;
/** A round sticker's diameter, units, and its white rim. */
const ROUND = 1.05;
const RIM = 0.035;

/** The picture to show for a mood: its own, or (asleep) the main one with its eyes closed, or the main one. */
export const pictureFor = (mood: string): Picture | undefined =>
  pictures[mood as Mood] ?? (mood === "sleeping" ? pictures.blink : undefined) ?? pictures.idle;

/** A mood's own picture, if it has one (Settings' thumbnails). */
export const customPicture = (mood: Mood): HTMLImageElement | undefined => {
  const p = pictures[mood];
  return p instanceof HTMLImageElement ? p : undefined;
};

/** Whether there's a character to show (it has its main picture). */
export const hasCustomCharacter = () => pictures.idle !== undefined;

/** Puts in the pictures (custom-load.ts), by mood. */
export function setCustomPictures(next: Partial<Record<Mood, Picture>>) {
  pictures = { ...next };
  custom.hit = hitFor();
}

export function setCustomShape(next: string | undefined) {
  shape = next === "round" ? "round" : "free";
  custom.hit = hitFor();
}

/** The picture's size inside BOX, units, keeping its proportions. */
function fitted(p: Picture): { w: number; h: number } {
  const k = Math.min(BOX / p.width, BOX / p.height);
  return { w: p.width * k, h: p.height * k };
}

/** The clickable part of the square view: the main picture (or sticker), a little padded. */
function hitFor(): Skin["hit"] {
  const main = pictures.idle;
  const { w, h } = shape === "round" || !main ? { w: ROUND, h: ROUND } : fitted(main);
  const pad = 0.04;
  return {
    x0: Math.max(0, 0.5 - w / 2 / FIT.units - pad),
    y0: Math.max(0, FIT.base - h / FIT.units - pad),
    x1: Math.min(1, 0.5 + w / 2 / FIT.units + pad),
    y1: Math.min(1, FIT.base + pad / 2),
  };
}

/** The mood a state shows. */
export function moodOf(state: StateName, variant: Variant): Mood {
  switch (state) {
    case "WORKING":
      return variant === "wait" || variant === "ask" ? "waiting" : "working";
    case "NOTIFY":
      return "waiting";
    case "SUCCESS":
      return "done";
    case "ERROR":
      return "error";
    case "SLEEPY":
    case "SLEEPING":
      return "sleeping";
    case "TOUCHED":
    case "HELD":
    case "LANDING":
    case "CONFUSED":
      return "surprised";
    default:
      return "idle";
  }
}

// ── Pose ──────────────────────────────────────────────────────────────────────

// Blinks (the engine's) show only with a "blink" picture, on the main one (draw).
const rest: Pose = { ...ENGINE_REST };

/** A hop every `everyMs` (0…1 height), for "look at me". */
function bounce(st: number, everyMs: number): number {
  const k = st % everyMs;
  return k < 380 ? Math.sin((Math.PI * k) / 380) : 0;
}

function pose(i: PoseInput): PoseOut {
  const { st, t, motion: m } = i;
  const eye = moodOf(i.state, i.variant);
  switch (i.state) {
    case "OFF":
      return { pose: { fade: 0 }, eye };

    case "BOOTING":
      // Pops in: grows from nothing with a little overshoot, then settles.
      return {
        pose: {
          fade: kf(st, [[0, 0], [250, 1]]),
          sx: kf(st, [[0, 0.3], [450, 1.08, Ease.outBack], [700, 1, Ease.outCubic]]),
          sy: kf(st, [[0, 0.3], [450, 1.1, Ease.outBack], [700, 1, Ease.outCubic]]),
        },
        eye,
      };

    case "IDLE":
    case "ATTENTIVE":
      // A slow sway; perking up a touch when you come near.
      return {
        pose: {
          bodyRot: 2 * DEG * Math.sin(t * 0.8) * m,
          lift: i.state === "ATTENTIVE" ? 0.02 * m : 0,
          sy: i.state === "ATTENTIVE" ? 1.02 : 1,
        },
        eye,
      };

    case "TOUCHED":
      return { pose: { ...touchSquash(st), bodyRot: i.variant === "dizzy" ? dizzyWobble(st, m) : 0 }, eye };

    case "WORKING": {
      if (i.variant === "wait") {
        // Needs your OK: a hop now and then, like tapping a foot.
        const b = bounce(st, 1400);
        return { pose: { lift: 0.05 * b * m, sy: 1 - 0.04 * b, sx: 1 + 0.03 * b }, eye };
      }
      if (i.variant === "ask") {
        // A question for you: a tilt one way, then the other.
        return { pose: { bodyRot: confusedTilt(st % 2400), lift: 0.015 * m }, eye };
      }
      // Busy: a quick little bob, leaning into it.
      const bob = Math.abs(Math.sin(t * Math.PI * 1.6));
      return { pose: { lift: 0.018 * bob * m, bodyRot: 2.5 * DEG * Math.sin(t * 1.6) * m, sy: 1 + 0.015 * bob }, eye };
    }

    case "SUCCESS":
      return { pose: successHop(st, m), eye };

    case "SUGGESTING":
      return { pose: { lift: 0.02 * m, bodyRot: 3 * DEG * m }, eye };

    case "CONFUSED":
      return { pose: { bodyRot: confusedTilt(st) * m }, eye };

    case "ERROR":
      return { pose: { ...errorSlump(st, m), sy: kf(st, [[0, 1], [300, 0.95], [2000, 0.95], [2600, 1, Ease.outCubic]]) }, eye };

    case "NOTIFY": {
      const n = notifyPop(st);
      return { pose: { sx: n.scale + 0.03 * n.pulse, sy: n.scale + 0.03 * n.pulse, lift: n.hop * m }, eye };
    }

    case "SLEEPY":
      return { pose: { bodyRot: kf(st, [[0, 0], [1200, 4 * DEG, Ease.inOutSine]]) * m, sy: kf(st, [[0, 1], [1200, 0.97]]) }, eye };

    case "SLEEPING":
      return { pose: { bodyRot: 4 * DEG * m, sy: 0.95, lift: -0.01 * m }, eye };

    case "WAKING":
      // A stretch: down, up tall, back.
      return {
        pose: {
          sy: kf(st, [[0, 0.95], [200, 1.07, Ease.outQuad], [450, 1, Ease.outElastic]]),
          sx: kf(st, [[0, 1.03], [200, 0.95, Ease.outQuad], [450, 1, Ease.outElastic]]),
        },
        eye,
      };

    case "HELD":
      return { pose: heldSwing(i, BOX), eye };

    case "LANDING":
      return { pose: landingSquash(st, m), eye };
  }
}

function events(i: PoseInput, prev: number, emit: Emit, p: Pose) {
  const crossed = crossedAt(prev, i.st);
  const top = BOX * p.sy + p.lift;
  switch (i.state) {
    case "BOOTING":
      if (crossed(450)) {
        for (const s of [-1, 1]) emit({ kind: "sparkle", x: s * 0.4, y: top * 0.8, vx: s * 0.2, vy: 0.2, size: 0.06, life: 0.8, spin: 2 });
      }
      break;
    case "SUCCESS":
      if (crossed(200)) {
        for (let k = 0; k < 4; k++) {
          const a = Math.PI / 2 + (k - 1.5) * 0.7;
          emit({ kind: "sparkle", x: Math.cos(a) * 0.4, y: top - 0.1 + Math.sin(a) * 0.1, vx: Math.cos(a) * 0.35, vy: 0.3, size: 0.07, life: 0.9, spin: 2 });
        }
      }
      break;
    case "ERROR":
      if (crossed(300)) emit({ kind: "puff", x: 0.35, y: top * 0.85, vx: 0.12, vy: 0.15, size: 0.09, life: 0.9 });
      break;
    case "TOUCHED":
      if (i.variant === "dizzy" && crossed(40)) {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * TAU;
          emit({ kind: "star", x: Math.cos(a) * 0.35, y: top + Math.sin(a) * 0.06, vx: -Math.sin(a) * 0.3, vy: 0.05, size: 0.07, life: 1.1, spin: 3 });
        }
      }
      break;
    case "SLEEPING":
      if (i.st >= 1500) {
        const n = Math.floor((i.st - 1500) / 4000);
        if (crossed(1500 + n * 4000)) emit({ kind: "z", x: 0.35, y: top * 0.9, vx: 0.07, vy: 0.1, size: 0.09, life: 3.2 });
      }
      break;
  }
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function draw(g: CanvasRenderingContext2D, p: Pose, eye: string, f: Frame) {
  // A blink: the main picture with its eyes closed, for the moment the engine's eyes are shut.
  const blinking = eye === "idle" && p.eyeOpen < 0.5 && pictures.blink !== undefined;
  const pic = blinking ? pictures.blink : pictureFor(eye);
  if (!pic) return;
  g.save();
  g.translate(f.ox, f.oy);
  g.scale(f.U, f.U);

  // A soft shadow on the ground, smaller as he rises.
  const sw = (shape === "round" ? ROUND : fitted(pic).w) * 0.42 * (1 - Math.min(0.5, Math.max(0, p.lift) * 4));
  g.fillStyle = "rgba(0, 0, 0, 0.13)";
  g.beginPath();
  g.ellipse(p.bodyX, 0, Math.max(0.05, sw), 0.035, 0, 0, TAU);
  g.fill();

  // Pivot at the bottom centre, like standing on the ground. The picture
  // changes with a quick squash (the engine's eye morph: 1, down to 0.1, back).
  const morph = p.eyeMorph ?? 1;
  g.translate(p.bodyX, -p.lift);
  g.rotate(p.bodyRot + (p.gazeX ?? 0) * 0.02);
  g.scale(p.sx * (1 + 0.08 * (1 - morph)), p.sy * (0.72 + 0.28 * morph));
  // Leans a little toward the cursor.
  const lookX = (p.gazeX ?? 0) * 0.02;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";

  if (shape === "round") {
    const r = ROUND / 2;
    g.save();
    g.shadowColor = "rgba(0, 0, 0, 0.18)";
    g.shadowBlur = 0.06 * f.U;
    g.shadowOffsetY = 0.015 * f.U;
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(lookX, -r, r, 0, TAU);
    g.fill();
    g.restore();
    // The picture fills the circle inside the rim (cropped, like a cover photo).
    const inner = r - RIM;
    g.save();
    g.beginPath();
    g.arc(lookX, -r, inner, 0, TAU);
    g.clip();
    const k = Math.max((2 * inner) / pic.width, (2 * inner) / pic.height);
    const w = pic.width * k, h = pic.height * k;
    g.drawImage(pic, lookX - w / 2, -r - h / 2, w, h);
    g.restore();
  } else {
    const { w, h } = fitted(pic);
    g.drawImage(pic, lookX - w / 2, -h, w, h);
  }
  g.restore();
}

export const custom: Skin = {
  id: "custom",
  fit: FIT,
  hit: hitFor(),
  rest,
  restEye: "idle",
  pose,
  events,
  draw,
};
