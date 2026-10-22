// Development only (phone-stills.html, driven by scripts/make-phone-pictures.mjs):
// draws the 2D characters in the moods the phone app shows, as small
// transparent pictures: { "kulhi-work": "data:image/webp;…" }. Dogesh Bhai is
// drawn in every outfit: { "dogesh-work-detective": … }.

import { Engine } from "../engine/engine";
import { SKINS } from "../skins";
import { withDogeshOutfit } from "../skins/dogesh";
import { OUTFIT_NAMES } from "../skins/dogesh-outfits";
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
  // Dogesh's moods come later in their states: hiding (under his scarf, cap,
  // hood…) (call), fainted stiff after the scream (droop), curled up asleep (sleep).
  dogesh: { call: 1500, droop: 1250, sleep: 2200 },
};

const SIZE = 192;
const out = document.getElementById("out")!;
window.addEventListener("error", (e) => (out.textContent = `ERROR ${e.message}`));
window.addEventListener("unhandledrejection", (e) => (out.textContent = `ERROR ${String(e.reason)}`));

const pictures: Record<string, string> = {};
for (const [id, skin] of Object.entries(SKINS)) {
  // Your own character is made on each PC from its own pictures: none to bundle.
  if (id === "custom") continue;
  for (const [mood, [state, settle]] of Object.entries(MOODS)) {
    const draw = () => {
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
      return canvas.toDataURL("image/webp", 0.9);
    };
    if (id === "dogesh") {
      for (const outfit of OUTFIT_NAMES) pictures[`dogesh-${mood}-${outfit}`] = withDogeshOutfit(outfit, draw);
    } else {
      pictures[`${id}-${mood}`] = draw();
    }
  }
}
out.textContent = JSON.stringify(pictures);
