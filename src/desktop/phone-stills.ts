// Development only (phone-stills.html, driven by scripts/make-phone-pictures.mjs):
// draws the four 2D characters in the moods the phone app shows, as small
// transparent pictures: { "kulhi-work": "data:image/webp;…" }.

import { Engine } from "../engine/engine";
import { SKINS } from "../skins";
import type { CharacterId, StateName } from "../engine/types";

/** Phone mood → the character state it is drawn in, and how long to let it settle (ms). */
const MOODS: Record<string, [StateName, number]> = {
  idle: ["IDLE", 600],
  work: ["WORKING", 900],
  call: ["NOTIFY", 700],
  done: ["SUCCESS", 500],
  droop: ["ERROR", 700],
  sleep: ["SLEEPING", 1200],
};

/** A character whose mood reads better at another moment of the state (ms). */
const SETTLE: Partial<Record<CharacterId, Partial<Record<string, number>>>> = {
  // Dogesh's moods come later in their states: hiding under his scarf (call),
  // fainted stiff after the scream (droop), curled up under the scarf (sleep).
  dogesh: { call: 1500, droop: 1250, sleep: 2200 },
};

const SIZE = 192;
const out = document.getElementById("out")!;
window.addEventListener("error", (e) => (out.textContent = `ERROR ${e.message}`));
window.addEventListener("unhandledrejection", (e) => (out.textContent = `ERROR ${String(e.reason)}`));

const pictures: Record<string, string> = {};
for (const [id, skin] of Object.entries(SKINS)) {
  for (const [mood, [state, settle]] of Object.entries(MOODS)) {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    canvas.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
    document.body.append(canvas);
    const engine = new Engine(skin);
    engine.addView(canvas);
    engine.setState("IDLE", null, 0);
    engine.advance(300);
    engine.setState(state, null, 0);
    engine.advance(SETTLE[id as CharacterId]?.[mood] ?? settle);
    pictures[`${id}-${mood}`] = canvas.toDataURL("image/webp", 0.9);
  }
}
out.textContent = JSON.stringify(pictures);
