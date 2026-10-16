// Dogesh Bhai, the scaredy pup: a lanky, jittery, butter-cream noodle of a dog
// in an oversized teal knitted scarf, drawn in a late-90s rubber-hose style.
// Frightened of everything, brave in the end and very sweet.
//
// He stands in three-quarter view, facing right: a bean-shaped torso hunched
// forward on thin noodle legs, a big lopsided bean head on a thin neck, and a
// long narrow muzzle that ends in a big round glossy button nose. Huge bulging
// eyes with small dot pupils do the acting, with heavy lids and little brows;
// long caramel ears flap with every move and fly up when he's scared (the near,
// right one is his tell). Limbs are noodles with no joints: they bend in smooth
// curves, knees knock, legs whirl into a blur when he panics.
//
// Signature bits: freaking out (straight up, legs cycling, eyes popping, fur on
// end, a scream full of blocky teeth), hiding under the scarf pulled over his
// head and peeking out, chattering teeth, a wobbly happy jig, melting into a
// puddle of fear and popping back up. Own identity markers: cream fur, a ROUND
// cocoa nose, three freckles per cheek, the teal scarf.
//
// Outfits (dogesh-outfits.ts, picked in Settings with setDogeshOutfit): each is
// his clothes and the fur he wears them in. The cozy scarf above is the first;
// the others (Desi Bhai's kurta, jacket and cap; the detective's trench coat and
// deerstalker; the hero's cape and mask; the rainy-day coat, hat and boots; the
// coder's hoodie, headphones and glasses; pyjamas and nightcap; the chef's apron
// and toque; the dapper vest, bow tie and flat cap) are drawn into the same rig
// (sleeves on the noodle arms, a top in torso space, hats in head space) and
// each hides its own way: pulling a hat down over his eyes, the collar up, the
// cape round him, the hood drawn tight, a frying pan up. Some bring props: the
// detective's magnifying glass, the coder's laptop and music. See "Outfits" below.
//
// Drawing space: units, origin on the ground under him, y down. The rig is
// computed in "body space"; the torso rotates (hunches) round the hips, the head
// hangs off the neck, and the whole figure is nudged left by DX so the long
// muzzle and the tail balance in the view.

import { Ease, clamp, lerp, smoothstep } from "../engine/ease";
import { hash01, kf } from "../engine/track";
import type { Emit, Frame, Pose, PoseInput, PoseOut, Skin } from "../engine/types";
import {
  DEG, ENGINE_REST, TAU, confusedTilt, crossedAt, dizzyWobble, heldSwing,
  notifyPop, sleepyFace, wakeBlink, workNod,
} from "./common";
import { OUTFITS, isOutfit, type OutfitName } from "./dogesh-outfits";

/** His colours. The fur parts change with the outfit picked in Settings (setDogeshOutfit). */
const C = {
  fur: "#F3DFA8",
  furShade: "#DCC07F",
  furLight: "#FBEFCB",
  pale: "#FFF6DC",
  line: "#6E4C28",
  ear: "#C98A4B",
  earTip: "#8E5A28",
  nose: "#4A2C22",
  eye: "#2B1B14",
  brow: "#7A4E26",
  freckle: "#B57A45",
  blush: "244,150,140",
  mouth: "#4A1E18",
  tongue: "#EE8A8A",
  scarf: "#2F8F8A",
  scarfLight: "#7CC3B9",
  scarfDark: "#1E6965",
  /** Scarf stripes that have "knitted up" with WORKING progress. */
  scarfDone: "#F6C85F",
  sweat: "#B4E3F7",
  sweatEdge: "#5AA9CF",
};

/** The outfit he's drawn in now. */
let outfit: OutfitName = "cozy";

/** Dresses him in an outfit (dogesh-outfits.ts): every drawing from now on shows it. */
export function setDogeshOutfit(name: unknown): void {
  if (!isOutfit(name)) return;
  outfit = name;
  const f = OUTFITS[name].fur;
  Object.assign(C, {
    fur: f.fur.color, furShade: f.fur.shade, furLight: f.furLight, pale: f.pale.color, line: f.line,
    ear: f.ear.color, earTip: f.earTip.color, brow: f.brow.color, freckle: f.freckle.color,
  });
}

/** The outfit he's in now. */
export function dogeshOutfit(): OutfitName {
  return outfit;
}

/** Draws in another outfit for a moment (Settings' pictures of each), then back. */
export function withDogeshOutfit<T>(name: OutfitName, fn: () => T): T {
  const was = outfit;
  setDogeshOutfit(name);
  try {
    return fn();
  } finally {
    setDogeshOutfit(was);
  }
}

type Pt = [number, number];

/** The whole figure is nudged left so nose and tail balance in the view. */
const DX = -0.07;
/** Hips: the torso rotates round here. */
const HIP_Y = -0.33;
/** In torso space (origin at the hips, y up the spine): neck base and shoulders. */
const NECK_BASE: Pt = [0.02, -0.29];
const SHOULDER_L: Pt = [-0.045, -0.235];
const SHOULDER_R: Pt = [0.04, -0.225];
/** Hips in body space (L is the far side, R the near side, facing right). */
const HIP_L: Pt = [-0.04, HIP_Y + 0.005];
const HIP_R: Pt = [0.035, HIP_Y];
/** Head centre from the neck base, and the head's size (its drawing is in head units). */
const HEAD_OFF: Pt = [0.05, -0.2];
const HEAD_SCALE = 1.25;
/** Eyes in head space. */
const EYE_L: Pt = [-0.03, -0.072];
const EYE_R: Pt = [0.066, -0.068];

// ── Pose ──────────────────────────────────────────────────────────────────────

const rest: Pose = {
  ...ENGINE_REST,
  /** Torso lean forward (radians), stretch along the spine, extra neck. */
  hunch: 0.12, torsoSY: 1, neck: 0,
  headTilt: 0, headX: 0, headY: 0,
  eyeScale: 1, eyeScaleL: 1, eyeScaleR: 1,
  /** Eyes bulging out of his head (0…1+), pupil size (1 = small dot, 0.4 pinprick). */
  pop: 0, pupil: 1,
  /** Heavy upper lids (0 open … 1 shut), sad tilt, the far eye squeezed shut. */
  lid: 0.18, eyeTilt: 0, wink: 0,
  /** Eyebrows: 1 worried (inner ends up), 0 calm, −1 determined; and how high. */
  brow: 0.5, browUp: 0,
  /** Mouth: smile, jaw drop, blocky teeth, flapping tongue, chattering grin, whistling "o". */
  mouthCurve: 0.3, mouthO: 0, teeth: 0, tongue: 0, grin: 0, whistle: 0,
  /** Ears: 0 floppy, 1 straight up, >1 flying out back, <0 flattened. Plus flapping. */
  earL: 0, earR: 0, earFlap: 0,
  /** Paws and feet, in body space (L far, R near). Knees: + bends forward. */
  pawLX: 0.05, pawLY: -0.43, pawRX: 0.12, pawRY: -0.42,
  footLX: -0.055, footLY: -0.012, footRX: 0.075, footRY: -0.012,
  kneeL: 0.18, kneeR: 0.18,
  /** Legs whirling into a cartoon wheel (0…1). */
  run: 0,
  tail: 0, tailTuck: 0,
  /** Scarf: pulled over his head (0…1), its end flying like a flag, progress fill. */
  hide: 0, flag: 0, fill: 0,
  /** Fur on end, fright lines, flying sweat (phase 0…1), "?", whistled note (phase), muttering, his skin left behind, blush. */
  poof: 0, shock: 0, sweat: 0, qmark: 0, note: 0, mutter: 0, ghost: 0, blush: 0.3,
  /** Tremble amplitude (0…1). */
  shiver: 0,
  /** Curled up asleep (0…1), and a dreaming twitch. */
  curl: 0, dream: 0,
  /** Outfits: a prop in his paw (detective's magnifying glass, coder's laptop; 0…1), music notes (phase). */
  prop: 0, music: 0,
  /** Coder: loosening his drawn-tight hood to peek out (0…1). */
  peek: 0,
  /**
   * Working, by kind (0…1 unless noted): reading a book (a page turning over,
   * 0…1) through a magnifying glass, a "!" when he finds it; the big red push
   * button (pushed down, its lamp lit); binoculars up (and lowered in a
   * fright); a sign held up for you (tilted, radians; his near paw tapping it,
   * and knocking); his paw at his chin (and tapping it).
   */
  book: 0, page: 0, lens: 0, excl: 0,
  button: 0, press: 0, lamp: 0,
  bino: 0, binoDrop: 0,
  sign: 0, signTilt: 0, signTap: 0, signKnock: 0,
  chin: 0, chinTap: 0,
};

const PAW_L: Pt = [0.05, -0.43];
const PAW_R: Pt = [0.12, -0.42];
const FOOT_L: Pt = [-0.055, -0.012];
const FOOT_R: Pt = [0.075, -0.012];
/** Paw targets (body space, head at rest). */
const NAILS: Pt = [0.26, -0.7];
const SCRATCH: Pt = [-0.07, -1.0];
const WAVE: Pt = [0.33, -0.88];
const POINT: Pt = [0.4, -0.56];
const CLING_L: Pt = [-0.02, -1.2];
const CLING_R: Pt = [0.2, -1.2];
const FLAIL_L: Pt = [-0.19, -0.86];
const FLAIL_R: Pt = [0.34, -0.88];
const HOOD_L: Pt = [-0.06, -0.73];
const HOOD_R: Pt = [0.21, -0.69];
const TUCK_L: Pt = [0.07, -0.52];
const TUCK_R: Pt = [0.15, -0.5];

const mix = (a: Pt, b: Pt, k: number): Pt => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
const add = (a: Pt, x: number, y: number): Pt => [a[0] + x, a[1] + y];
const paws = (l: Pt, r: Pt) => ({ pawLX: l[0], pawLY: l[1], pawRX: r[0], pawRY: r[1] });
const feet = (l: Pt, r: Pt) => ({ footLX: l[0], footLY: l[1], footRX: r[0], footRY: r[1] });

/** Crossfades two partial poses, channel by channel (missing channels rest). */
function blend(a: Partial<Pose>, b: Partial<Pose>, w: number): Partial<Pose> {
  const out: Partial<Pose> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = lerp(a[k] ?? rest[k], b[k] ?? rest[k], w);
  return out;
}

/** Each ear twitches on its own clock. */
function twitch(t: number, seed: number): number {
  const period = 2.1 + seed * 0.8;
  const n = Math.floor(t / period);
  const k = t - n * period;
  return hash01(n * 3 + seed) < 0.6 && k < 0.22 ? Math.sin((Math.PI * k) / 0.22) * 0.22 : 0;
}

/** Knees knocking together (far knee forward, near knee back). */
const knock = (t: number, m: number, amt = 1) => {
  const k = (0.4 + 0.3 * Math.sin(t * 24) * m) * amt;
  return { kneeL: k, kneeR: -k };
};

/**
 * The full-body freak-out (first ~700 ms): crouch, then straight up with the
 * legs cycling, arms flung up, eyes popping, fur on end, ears flying, a
 * scream full of teeth; then a jelly-legged landing.
 */
function freakOut(st: number, m: number, h: number): Partial<Pose> {
  const fling = kf(st, [[60, 0], [140, 1, Ease.outBack], [480, 1], [650, 0]]);
  return {
    lift: kf(st, [[0, 0], [80, 0], [260, h, Ease.outCubic], [460, 0, Ease.inQuad]]) * m,
    sy: kf(st, [[0, 1], [80, 0.82, Ease.outQuad], [200, 1.08, Ease.outQuad], [460, 1.02], [540, 0.84, Ease.outQuad], [720, 1, Ease.outElastic]]),
    sx: kf(st, [[0, 1], [80, 1.12, Ease.outQuad], [200, 0.9, Ease.outQuad], [460, 0.98], [540, 1.12, Ease.outQuad], [720, 1, Ease.outElastic]]),
    run: kf(st, [[80, 0], [150, 1], [400, 1], [470, 0]]) * m,
    torsoSY: kf(st, [[60, 1], [160, 1.06], [480, 1.04], [600, 1]]),
    neck: kf(st, [[0, 0], [100, 0.04, Ease.outBack], [480, 0.04], [640, 0]]),
    pop: kf(st, [[0, 0], [90, 1.1, Ease.outBack], [550, 1], [760, 0.3]]),
    pupil: kf(st, [[0, 1], [90, 0.4], [550, 0.4], [760, 0.8]]),
    lid: 0,
    poof: kf(st, [[0, 0], [90, 1, Ease.outCubic], [600, 1], [900, 0]]),
    shock: kf(st, [[0, 0], [90, 1], [550, 1], [700, 0]]),
    earL: kf(st, [[0, 0], [100, 1.25, Ease.outBack], [550, 1.2], [800, 0.1]]),
    earR: kf(st, [[0, 0], [100, 1.3, Ease.outBack], [550, 1.2], [800, 0.3]]),
    earFlap: kf(st, [[0, 0], [100, 1], [500, 1], [700, 0]]),
    mouthO: kf(st, [[0, 0], [90, 1, Ease.outBack], [520, 1], [650, 0]]),
    teeth: 1,
    tongue: kf(st, [[90, 0], [150, 1], [520, 1], [650, 0]]),
    ...paws(mix(PAW_L, FLAIL_L, fling), mix(PAW_R, FLAIL_R, fling)),
    kneeL: kf(st, [[460, 0.18], [540, -0.7], [650, 0.4], [760, 0.18]]),
    kneeR: kf(st, [[460, 0.18], [540, 0.9], [650, -0.2], [760, 0.18]]),
    shiver: kf(st, [[0, 0], [90, 1], [600, 1], [700, 0.4]]) * m,
    brow: 1,
    browUp: kf(st, [[0, 0], [90, 1], [550, 1], [760, 0.4]]),
    tailTuck: kf(st, [[0, 0], [100, 1]]),
    flag: kf(st, [[80, 0], [200, 1], [500, 1], [700, 0]]),
    blink: 0,
  };
}

/** Hiding under the scarf pulled over his head, peeking out, knees knocking. */
function hiding(t: number, m: number): Partial<Pose> {
  return {
    hide: 1,
    hunch: 0.36, headY: 0.025, torsoSY: 0.93,
    ...paws(HOOD_L, HOOD_R),
    ...feet(add(FOOT_L, -0.02, 0), add(FOOT_R, 0.02, 0)),
    ...knock(t, m),
    grin: 0.85, shiver: 0.45 * m,
    pop: 0.25, pupil: 0.7, lid: 0,
    // Eyes darting left and right.
    gazeLock: 1, gazeLockX: (Math.sin(t * 1.7) > 0 ? 0.9 : -0.6) * (0.3 + 0.7 * m), gazeLockY: 0.1,
    tailTuck: 1,
    brow: 1, browUp: 0.3,
  };
}

/** IDLE's quirk clock: every 7 s one of six quirks (`act`), faded in and out by `w`. */
function idleQuirk(t: number): { into: number; w: number; act: number } {
  const cycle = Math.floor((t + 3) / 7);
  const into = t + 3 - cycle * 7;
  const w = into < 2.6 ? smoothstep(0, 0.25, into) * smoothstep(2.6, 2.3, into) : 0;
  return { into, w, act: Math.floor(hash01(cycle + 21) * 6) };
}

/** Paw targets for the outfits (body space, like the others). */
const GLASS: Pt = [0.235, -0.79];
/** Coder: the far paw holds the laptop up from below, the near one types. */
const TYPE_L: Pt = [0.33, -0.468];
const TYPE_R: Pt = [0.215, -0.522];
const PAN_L: Pt = [0.25, -0.44];
const PAN_R: Pt = [0.31, -0.45];
/** Pulling a hat down: the far paw at its back edge, the near one at its front tip. */
const BRIM_L: Pt = [-0.06, -0.855];
const BRIM_R: Pt = [0.36, -0.835];
const STRINGS_L: Pt = [0.27, -0.58];
const STRINGS_R: Pt = [0.33, -0.6];

/**
 * The outfit's own touches on a pose: how he hides in it (pulling a hat down,
 * a pan up, drawstrings tight), and the props he plays with (the detective's
 * magnifying glass, the coder's laptop and music).
 */
function dress(i: PoseInput, out: PoseOut): PoseOut {
  if (outfit === "cozy") return out;
  const p = out.pose;
  const { st, t, motion: m } = i;
  const hide = clamp(p.hide ?? 0, 0, 1);
  const pawsTo = (l: Pt, r: Pt, k: number) => {
    if (k <= 0) return;
    p.pawLX = lerp(p.pawLX ?? rest.pawLX, l[0], k);
    p.pawLY = lerp(p.pawLY ?? rest.pawLY, l[1], k);
    p.pawRX = lerp(p.pawRX ?? rest.pawRX, r[0], k);
    p.pawRY = lerp(p.pawRY ?? rest.pawRY, r[1], k);
  };
  const nearPawTo = (r: Pt, k: number) => {
    p.pawRX = lerp(p.pawRX ?? rest.pawRX, r[0], k);
    p.pawRY = lerp(p.pawRY ?? rest.pawRY, r[1], k);
  };
  switch (outfit) {
    case "desi":
    case "rainy":
    case "dapper":
    case "pyjamas":
      // Pulls his hat down over his eyes and peeks out from under it.
      if (hide > 0) {
        // (Paws reach the brim early and leave it late: they hold the hat as he lifts it.)
        pawsTo(BRIM_L, BRIM_R, smoothstep(0, 0.3, hide));
        p.gazeLockY = lerp(p.gazeLockY ?? 0, 0.85, hide);
      }
      break;
    case "chef":
      // Hides behind a frying pan.
      pawsTo(PAN_L, PAN_R, hide);
      break;
    case "detective": {
      // Collar up, chin tucked down into it, sinking into his coat (and
      // screaming into it).
      if (hide > 0) {
        p.hunch = lerp(p.hunch ?? rest.hunch, 0.06, hide);
        p.headX = (p.headX ?? 0) - 0.07 * hide;
        p.headY = (p.headY ?? 0) + 0.08 * hide;
        p.headTilt = (p.headTilt ?? 0) + 0.5 * hide;
        p.neck = (p.neck ?? 0) - 0.02 * hide;
        p.mouthO = (p.mouthO ?? 0) * (1 - hide);
        p.tongue = (p.tongue ?? 0) * (1 - hide);
      }
      // The magnifying glass up to his eye: while working (reading, he holds
      // it over his book instead), and for some idle double takes.
      let k = 0;
      if (i.state === "WORKING" && i.variant === null) k = kf(st, [[0, 0], [350, 1, Ease.outBack]]);
      else if (i.state === "IDLE") {
        const q = idleQuirk(t);
        if (q.act === 0) k = q.w;
      }
      if (k > 0) {
        p.prop = k;
        nearPawTo(add(GLASS, 0.01 * Math.sin(t * 2.1) * m, 0.008 * Math.sin(t * 3.3) * m), k);
      }
      break;
    }
    case "coder":
      // Drawstrings pulled tight; every few seconds he loosens them to peek out.
      pawsTo(STRINGS_L, STRINGS_R, hide);
      if (hide > 0) {
        const c = (t % 3.2) / 3.2;
        p.peek = hide * smoothstep(0.5, 0.58, c) * smoothstep(0.92, 0.84, c);
        // Drawn tight, his eyes and brows stay inside the hood.
        const shut = hide * (1 - p.peek);
        p.pop = (p.pop ?? 0) * (1 - shut);
        p.browUp = (p.browUp ?? 0) * (1 - shut);
      }
      if (i.state === "WORKING" && i.variant === null) {
        // Typing away, bobbing to the music in his headphones.
        const k = kf(st, [[0, 0], [300, 1, Ease.outBack]]);
        const tap = Math.sin(t * 22);
        const beat = Math.abs(Math.sin(t * Math.PI * 2));
        p.prop = k;
        pawsTo(TYPE_L, add(TYPE_R, 0.012 * Math.sin(t * 9) * m, -0.014 * Math.max(0, tap) * m), k);
        Object.assign(p, {
          grin: 0, mouthCurve: 0.8, lid: 0.3, brow: 0.15, pop: 0, pupil: 1, shiver: 0, sweat: 0, tailTuck: 0,
          tail: 0.5 * Math.sin(t * Math.PI * 4) * m,
          headY: (p.headY ?? 0) + 0.014 * beat * m,
          headTilt: 0.05 * Math.sin(t * Math.PI * 2) * m,
          gazeLock: 1, gazeLockX: 0.7, gazeLockY: 0.6,
          music: m ? (st / 1400) % 1 : 0,
        });
      }
      break;
  }
  return out;
}

function pose(i: PoseInput): PoseOut {
  return dress(i, basePose(i));
}

function basePose(i: PoseInput): PoseOut {
  const { st, t, motion: m } = i;

  switch (i.state) {
    case "OFF":
      return { pose: { fade: 0 }, eye: "round" };

    case "BOOTING": {
      // One eye peeks in from the left edge, he tiptoes in on his noodle legs,
      // then gives you a shy, jittery little wave.
      const ph = (st / 1000) * TAU * 3;
      const sneak = st >= 450 && st < 1050 ? 1 : 0;
      const waving = kf(st, [[1050, 0], [1200, 1, Ease.outBack], [1500, 1], [1600, 0]]);
      const tuck = kf(st, [[350, 0], [500, 1], [1000, 1], [1150, 0]]);
      return {
        pose: {
          fade: kf(st, [[0, 0], [200, 0], [380, 1]]),
          bodyX: kf(st, [[0, -0.62], [450, -0.62], [1050, 0, Ease.inOutSine]]) * m,
          bodyRot: kf(st, [[0, 0.32], [450, 0.32], [650, 0, Ease.outCubic]]) * m,
          lift: 0.015 * sneak * m,
          hunch: kf(st, [[0, 0.25], [450, 0.32], [1050, 0.32], [1250, 0.14]]),
          wink: kf(st, [[0, 1], [450, 1], [600, 0]]),
          pop: kf(st, [[100, 0], [250, 0.5, Ease.outBack], [600, 0.2], [1100, 0]]),
          ...feet(
            add(FOOT_L, 0, -0.04 * Math.max(0, Math.sin(ph)) * sneak * m),
            add(FOOT_R, 0, -0.04 * Math.max(0, -Math.sin(ph)) * sneak * m),
          ),
          kneeL: 0.18 + 0.4 * Math.max(0, Math.sin(ph)) * sneak * m,
          kneeR: 0.18 + 0.4 * Math.max(0, -Math.sin(ph)) * sneak * m,
          ...paws(mix(PAW_L, TUCK_L, tuck), mix(mix(PAW_R, TUCK_R, tuck), add(WAVE, 0.03 * Math.sin(st / 40) * m, 0), waving)),
          gazeLock: kf(st, [[300, 1], [1050, 1], [1200, 0]]),
          gazeLockX: Math.sin(st / 160) > 0 ? 0.8 : -0.3,
          gazeLockY: 0,
          earR: kf(st, [[150, 0], [250, 0.6, Ease.outBack], [600, 0.2], [1100, 0]]),
          grin: kf(st, [[1050, 0], [1150, 0.6], [1500, 0.6], [1600, 0]]),
          blush: kf(st, [[1000, 0.3], [1200, 1]]),
          mouthCurve: 0.8,
          brow: 0.9,
          shiver: 0.2 * m,
          blink: 0,
        },
        eye: st >= 1250 && st < 1550 ? "happy" : "round",
      };
    }

    case "IDLE": {
      // He can't stand still: weight shifting from one thin leg to the other,
      // wringing his paws, ears twitching on their own. Every 7 s one quirk: a
      // double take at nothing, a nervous whistle, a peek behind himself,
      // muttering, a scratch with a back leg, or knocking knees. (Offset so a
      // fresh IDLE starts calm.)
      const shift = Math.sin(t * 1.9);
      const base: Partial<Pose> = {
        bodyX: 0.012 * shift * m,
        hunch: 0.12 + 0.03 * shift * m,
        ...feet(
          add(FOOT_L, 0, -0.014 * Math.max(0, -shift) * m),
          add(FOOT_R, 0, -0.014 * Math.max(0, shift) * m),
        ),
        kneeL: 0.18 + 0.15 * Math.max(0, -shift) * m,
        kneeR: 0.18 + 0.15 * Math.max(0, shift) * m,
        ...paws(add(PAW_L, 0.01 * Math.sin(t * 7) * m, 0), add(PAW_R, -0.01 * Math.sin(t * 7) * m, 0.006 * Math.cos(t * 7) * m)),
        earL: twitch(t, 1), earR: twitch(t, 2),
        tail: 0.5 * Math.sin(t * 5) * m,
        brow: 0.55,
      };
      const { into, w, act } = idleQuirk(t);
      if (w <= 0) return { pose: base, eye: "round" };
      let quirk: Partial<Pose>;
      let eye = "round";
      switch (act) {
        case 0: {
          // A glance… nothing… then a double take, eyes popping, ears up.
          const take = into > 1.0 && into < 2.1 ? 1 : 0;
          quirk = {
            gazeLock: 1, gazeLockX: into < 0.5 || into > 0.95 ? 0.95 : 0, gazeLockY: 0,
            pop: 0.85 * take, pupil: 1 - 0.4 * take, lid: 0.18 * (1 - take),
            earL: 0.7 * take, earR: 0.9 * take, headX: 0.03 * take,
            brow: 0.6 + 0.4 * take, browUp: take,
          };
          break;
        }
        case 1:
          // A nervous little whistle, eyes rolling up and away.
          quirk = {
            whistle: 1, note: (into / 2.6) % 1,
            gazeLock: 1, gazeLockX: -0.4, gazeLockY: -0.8,
            lid: 0.3, brow: 0.2, headTilt: -0.08,
          };
          break;
        case 2:
          // Peeks behind himself.
          quirk = {
            headX: -0.05, hunch: 0.24, bodyRot: -0.05 * m,
            gazeLock: 1, gazeLockX: -1, gazeLockY: 0.1,
            earR: 0.4, pop: 0.3, lid: 0, brow: 0.9,
          };
          break;
        case 3:
          // Mutters to himself.
          quirk = {
            mutter: 1, mouthO: 0.08 + 0.08 * Math.abs(Math.sin(t * 14)) * m,
            gazeLock: 1, gazeLockX: Math.sin(t * 3) > 0 ? 0.6 : -0.2, gazeLockY: 0.3,
            brow: 0.95,
          };
          break;
        case 4:
          // Scratches his neck with a back leg: bliss.
          quirk = {
            bodyRot: -0.06 * m, hunch: 0.02, bodyX: -0.02 * m,
            ...feet([0.0, -0.012], [0.04 + 0.01 * Math.sin(t * 30) * m, -0.66 + 0.02 * Math.sin(t * 30) * m]),
            kneeL: 0.05, kneeR: 0.9,
            tongue: 0.5, mouthCurve: 0.9, earR: 0.3, earFlap: 0.4,
            brow: 0, blink: 0,
          };
          eye = into > 0.3 && into < 2.3 ? "happy" : "round";
          break;
        default:
          // Knees knocking, teeth chattering.
          quirk = { ...knock(t, m), grin: 0.9, shiver: 0.6 * m, pop: 0.25, lid: 0.05, brow: 1, tailTuck: 0.7 };
      }
      return { pose: blend(base, { ...base, ...quirk }, w), eye };
    }

    case "ATTENTIVE":
      // Freaks out (a smaller leap), then hides under the scarf and peeks out.
      return {
        pose: blend(freakOut(st, m, 0.12), hiding(t, m), kf(st, [[550, 0], [900, 1, Ease.inOutSine]])),
        eye: "round",
      };

    case "TOUCHED": {
      if (i.variant === "dizzy") {
        // Spun round: everything wobbles, ears whirl, tongue lolls, stars.
        const sway = st < 1200 ? Math.sin((st / 1000) * TAU * 1.6) * (1 - st / 1400) : 0;
        return {
          pose: {
            bodyRot: dizzyWobble(st, m) * 2,
            headTilt: dizzyWobble(st + 150, m) * 2.5,
            kneeL: 0.18 + 0.5 * sway * m, kneeR: 0.18 - 0.5 * sway * m,
            earFlap: st < 1200 ? 1 : 0.2,
            earL: 0.4 * sway * m, earR: -0.4 * sway * m,
            tongue: 1, mouthO: st < 1200 ? 0.3 : 0.15, mouthCurve: 0.5,
            hunch: 0.22, lid: 0.2, brow: 0.6, blush: 0.6,
            blink: 0,
          },
          eye: st < 1200 ? "spiral" : "closed",
        };
      }
      // Jumps clean out of his skin (it stays on the ground for a moment),
      // clings to the top of the window, slides back down, sheepish grin.
      const cling = kf(st, [[60, 0], [190, 1, Ease.outBack], [380, 1], [520, 0, Ease.inOutSine]]);
      const air = kf(st, [[50, 0], [150, 1], [460, 1], [530, 0]]);
      const sheepish = kf(st, [[460, 0], [560, 1]]);
      return {
        pose: {
          lift: kf(st, [[0, 0], [50, 0], [190, 0.17, Ease.outCubic], [370, 0.16], [520, 0, Ease.inQuad]]) * m,
          sy: kf(st, [[0, 1], [50, 0.82, Ease.outQuad], [190, 1.06, Ease.outQuad], [370, 1.03], [520, 1], [560, 0.88, Ease.outQuad], [600, 1]]),
          sx: kf(st, [[0, 1], [50, 1.12, Ease.outQuad], [190, 0.9, Ease.outQuad], [370, 0.95], [520, 1], [560, 1.1, Ease.outQuad], [600, 1]]),
          ghost: kf(st, [[40, 0], [70, 1], [320, 0.8], [480, 0]]) * m,
          ...paws(mix(PAW_L, CLING_L, cling), mix(PAW_R, CLING_R, cling)),
          ...feet(add(FOOT_L, 0, 0.05 * air), add(FOOT_R, 0, 0.05 * air)),
          kneeL: lerp(0.18, -0.05, air), kneeR: lerp(0.18, 0.3, air),
          torsoSY: 1 + 0.04 * air, neck: 0.02 * air,
          pop: 1.05 * air, pupil: 1 - 0.55 * air, lid: 0.18 * (1 - air),
          poof: kf(st, [[0, 0], [60, 1], [380, 1], [540, 0]]),
          earL: 1.2 * air, earR: 1.3 * air + 0.15 * sheepish,
          mouthO: kf(st, [[40, 0], [100, 0.7], [380, 0.6], [470, 0]]),
          teeth: 1,
          grin: 0.6 * sheepish,
          mouthCurve: 0.9,
          blush: 0.3 + 0.7 * sheepish,
          headTilt: -0.12 * sheepish,
          brow: 1, browUp: air,
          tailTuck: air,
          blink: 0,
        },
        eye: st < 470 ? "round" : "happy",
      };
    }

    case "WORKING": {
      switch (i.variant) {
        case "research": return researching(i);
        case "run": return pressing(i);
        case "browse": return lookout(i);
        case "wait": return calling(i);
        case "ask": return pondering(i);
      }
      // Tiptoeing in place, eyes darting, chewing his nails with chattering
      // teeth, sweat flying off now and then; the scarf's stripes knit up gold
      // with progress. After 5 s a determined little nod every 3 s.
      const nod = workNod(st);
      const tip = Math.sin(t * 14);
      const to = kf(st, [[0, 0], [300, 1, Ease.outBack]]);
      return {
        pose: {
          lift: 0.012 * m,
          ...feet(add(FOOT_L, 0, -0.012 * Math.max(0, tip) * m), add(FOOT_R, 0, -0.012 * Math.max(0, -tip) * m)),
          kneeL: 0.25 + 0.1 * Math.max(0, tip) * m, kneeR: 0.25 + 0.1 * Math.max(0, -tip) * m,
          ...paws(PAW_L, mix(PAW_R, add(NAILS, 0.006 * Math.sin(t * 31) * m, 0.006 * Math.cos(t * 27) * m), to)),
          grin: 0.9,
          hunch: 0.2 + 0.08 * nod,
          headY: 0.012 * nod,
          gazeLock: 1, gazeLockX: (Math.sin(t * 2.3) > 0 ? 0.9 : 0.05) * (0.4 + 0.6 * m), gazeLockY: 0.25,
          pop: 0.15, pupil: 0.85, lid: 0.08,
          brow: 1,
          earL: twitch(t, 3), earR: twitch(t, 4),
          sweat: st > 800 ? ((st - 800) % 2600) / 2600 : 0,
          shiver: 0.2 * m,
          tailTuck: 0.5,
          fill: i.progress ?? 0,
        },
        eye: "round",
      };
    }

    case "SUCCESS": {
      // A wobbly noodle-legged jig with his ears whirling, then he melts into a
      // relieved slouch and wipes his brow ("phew"). The short version jigs half as long.
      const short = i.variant === "short";
      const jigEnd = short ? 700 : 1450;
      const end = short ? 1200 : 2500;
      const ph = (st / 1000) * TAU * 2.6;
      const s = Math.sin(ph);
      const jig: Partial<Pose> = {
        lift: 0.05 * Math.abs(s) * m,
        bodyRot: 0.08 * s * m,
        ...feet(
          add(FOOT_L, -0.05 * Math.max(0, s) * m, -0.07 * Math.max(0, s) * m),
          add(FOOT_R, 0.06 * Math.max(0, -s) * m, -0.07 * Math.max(0, -s) * m),
        ),
        kneeL: 0.18 + 0.5 * Math.sin(ph * 2) * m, kneeR: 0.18 - 0.5 * Math.sin(ph * 2) * m,
        ...paws(add(FLAIL_L, 0.05, 0.04 + 0.06 * s * m), add(FLAIL_R, -0.03, 0.04 - 0.06 * s * m)),
        earFlap: 1, earL: 0.5 + 0.4 * s * m, earR: 0.5 - 0.4 * s * m,
        mouthO: 0.35, mouthCurve: 1, tongue: 0.3,
        lid: 0, brow: 0.1, blush: 0.9,
        tail: Math.sin(t * 20) * m,
      };
      const wipe = kf(st, [[jigEnd, 0], [jigEnd + 200, 1, Ease.outBack], [end - 250, 1], [end, 0]]);
      const sweep = kf(st, [[jigEnd + 150, 0.34], [end - 300, 0.17, Ease.inOutSine]]);
      const phew: Partial<Pose> = {
        hunch: 0.32, torsoSY: 0.9, headY: 0.03,
        sy: 0.95,
        kneeL: 0.4, kneeR: 0.4,
        ...paws(PAW_L, mix(PAW_R, [sweep, -0.98], wipe)),
        mouthO: kf(st, [[jigEnd, 0], [jigEnd + 200, 0.22], [end - 200, 0.12]]),
        mouthCurve: 0.7,
        lid: 0.5, brow: 0, blush: 0.7,
        earL: -0.3, earR: -0.3,
        tail: 0.3 * Math.sin(t * 6) * m,
      };
      return {
        pose: blend(jig, phew, kf(st, [[jigEnd - 150, 0], [jigEnd + 100, 1]])),
        eye: st < jigEnd ? "happy" : "round",
      };
    }

    case "SUGGESTING": {
      // "Maybe one of these?": an extreme curious head tilt toward them and a
      // noodle arm pointing, the other paw fidgeting.
      const point = kf(st, [[250, 0], [600, 1, Ease.outBack]]);
      return {
        pose: {
          bodyX: kf(st, [[0, 0], [500, 0.03]]) * m,
          headTilt: kf(st, [[0, 0], [400, 0.38, Ease.outBack]]) + 0.04 * Math.sin(t * 1.5) * m,
          hunch: 0.2,
          ...paws(add(PAW_L, 0.01 * Math.sin(t * 7) * m, 0), mix(PAW_R, POINT, point)),
          earL: 0.35, earR: -0.25, earFlap: 0.2,
          gazeLock: 0.9, gazeLockX: 0.9, gazeLockY: 0.2,
          mouthCurve: 0.6, brow: 0.4, blush: 0.6, lid: 0.1,
          tail: 0.4 * Math.sin(t * 4) * m,
        },
        eye: "round",
      };
    }

    case "CONFUSED": {
      // Extreme head tilt one way, then the other, ears flopping, scratching
      // his head, a "?" above.
      const scr = kf(st, [[200, 0], [550, 1, Ease.outBack], [2600, 1], [2900, 0]]);
      const tilt = confusedTilt(st) * 4;
      return {
        pose: {
          headTilt: tilt,
          qmark: kf(st, [[0, 0], [350, 1, Ease.outBack], [2600, 1], [3000, 0]]),
          hunch: 0.18,
          ...paws(PAW_L, mix(PAW_R, add(SCRATCH, 0.014 * Math.sin(t * 25) * m, 0), scr)),
          earL: 0.3 + tilt * 2, earR: -tilt * 2, earFlap: 0.3,
          eyeScaleL: 1.15, eyeScaleR: 0.9, pupil: 0.8, lid: 0.05,
          mouthCurve: -0.4, brow: 0.9,
          tailTuck: 0.3,
        },
        eye: "round",
      };
    }

    case "ERROR": {
      // The big cartoon scream (to 900 ms); he faints stiff as a board and
      // tips back, melts into a puddle of fear (to 2300), then pops back up
      // woozy and pulls himself together, brave after all.
      const fling = kf(st, [[40, 0], [120, 1, Ease.outBack], [850, 1], [950, 0]]);
      const woozy = st > 2450 && st < 2950 ? 0.2 * Math.sin(((st - 2450) / 1000) * TAU * 2) * (1 - (st - 2450) / 500) : 0;
      return {
        pose: {
          lift: kf(st, [[0, 0], [60, 0], [200, 0.07, Ease.outCubic], [380, 0, Ease.inQuad]]) * m,
          sy: kf(st, [[0, 1], [60, 0.88], [200, 1.05], [380, 1], [1450, 1], [1650, 0.42, Ease.outCubic], [2300, 0.45], [2550, 1.12, Ease.outBack], [2800, 1, Ease.outElastic]]),
          sx: kf(st, [[0, 1], [60, 1.08], [200, 0.94], [380, 1], [1450, 1], [1650, 1.45, Ease.outCubic], [2300, 1.42], [2550, 0.92], [2800, 1, Ease.outElastic]]),
          bodyRot: kf(st, [[950, 0], [1350, -30 * DEG, Ease.inQuad], [1450, -30 * DEG], [1600, 0, Ease.outCubic]]) * m,
          torsoSY: kf(st, [[0, 1], [90, 1.06], [850, 1.05], [950, 1]]),
          neck: kf(st, [[0, 0], [90, 0.04], [850, 0.04], [950, 0]]),
          pop: kf(st, [[0, 0], [80, 1.15, Ease.outBack], [850, 1.1], [950, 0]]),
          pupil: kf(st, [[0, 1], [80, 0.35], [850, 0.35], [950, 1]]),
          lid: kf(st, [[0, 0.18], [80, 0], [2600, 0], [2800, 0.15]]),
          mouthO: kf(st, [[0, 0], [90, 1.1, Ease.outBack], [850, 1], [950, 0]]),
          teeth: 1,
          tongue: kf(st, [[90, 0], [150, 1], [850, 1], [950, 0], [1700, 0], [1800, 0.5], [2400, 0.5], [2500, 0]]),
          poof: kf(st, [[0, 0], [80, 1], [850, 1], [1000, 0]]),
          shock: kf(st, [[0, 0], [80, 1], [850, 1], [950, 0]]),
          earL: kf(st, [[0, 0], [90, 1.3, Ease.outBack], [850, 1.25], [1000, 0], [1500, -1], [2300, -1], [2700, 0, Ease.outBack]]),
          earR: kf(st, [[0, 0], [90, 1.35, Ease.outBack], [850, 1.25], [1000, 0], [1500, -1], [2300, -1], [2700, 0, Ease.outBack]]),
          earFlap: kf(st, [[0, 0], [90, 1], [850, 1], [950, 0]]),
          ...paws(
            mix(mix(PAW_L, FLAIL_L, fling), [0.0, -0.36], kf(st, [[950, 0], [1100, 1], [1450, 1], [1600, 0]])),
            mix(mix(PAW_R, FLAIL_R, fling), [0.08, -0.35], kf(st, [[950, 0], [1100, 1], [1450, 1], [1600, 0]])),
          ),
          kneeL: kf(st, [[900, 0.18], [1000, 0], [1450, 0], [1650, 0.6], [2300, 0.6], [2550, 0.18]]),
          kneeR: kf(st, [[900, 0.18], [1000, 0], [1450, 0], [1650, -0.4], [2300, -0.4], [2550, 0.18]]),
          headTilt: woozy * (0.4 + 0.6 * m),
          shiver: kf(st, [[0, 0], [80, 1], [850, 1], [900, 0]]) * m,
          sweat: st > 1650 && st < 2300 ? ((st - 1650) % 650) / 650 : 0,
          brow: kf(st, [[0, 0.5], [80, 1], [2600, 1], [2800, -0.6]]),
          browUp: kf(st, [[0, 0], [80, 1], [850, 1], [950, 0]]),
          mouthCurve: kf(st, [[950, -0.5], [2600, -0.5], [2800, 0.4]]),
          tailTuck: kf(st, [[0, 0], [100, 1], [2500, 1], [2800, 0]]),
          blink: st < 2700 ? 0 : 1,
        },
        eye: st < 950 ? "round" : st < 1650 ? "closed" : st < 2650 ? "spiral" : "round",
      };
    }

    case "NOTIFY": {
      if (i.variant === "ack") {
        // Pulls the scarf off his head and melts with relief: "phew".
        const off = kf(st, [[0, 1], [300, 0, Ease.outCubic]]);
        return {
          pose: {
            hide: off,
            ...paws(mix(PAW_L, HOOD_L, off), mix(PAW_R, HOOD_R, off)),
            hunch: 0.28, torsoSY: kf(st, [[0, 1], [150, 1.04], [450, 0.92]]),
            kneeL: 0.35, kneeR: 0.35,
            mouthO: kf(st, [[80, 0], [180, 0.22], [450, 0.05]]),
            mouthCurve: 0.9, lid: 0.45, brow: 0, blush: 0.8,
            earL: -0.25, earR: -0.25,
            tail: 0.6 * Math.sin(t * 14) * m,
            blink: 0,
          },
          eye: "round",
        };
      }
      // Something needs you: a full freak-out, then he hides under the scarf
      // and peeks out. Every 1.2 s another jolt: a hop, ears flying, eyes popping.
      const n = notifyPop(st);
      const body = blend(freakOut(st, m, 0.18), hiding(t, m), kf(st, [[550, 0], [900, 1, Ease.inOutSine]]));
      return {
        pose: {
          ...body,
          sx: n.scale * (body.sx ?? 1), sy: n.scale * (body.sy ?? 1),
          lift: (body.lift ?? 0) + n.pulse * 0.04 * m,
          pop: Math.max(body.pop ?? 0, 0.8 * n.pulse),
          shock: Math.max(body.shock ?? 0, 0.8 * n.pulse),
          poof: Math.max(body.poof ?? 0, 0.4 * n.pulse),
          mouthO: Math.max(body.mouthO ?? 0, 0.5 * n.pulse),
          pupil: (body.pupil ?? 1) - 0.3 * n.pulse,
        },
        eye: "round",
      };
    }

    case "SLEEPY": {
      // A huge yawn, droopy lids and ears, slouching, his head nodding off and
      // jerking back up.
      const f = sleepyFace(st);
      const k = (st % 3800) / 3800;
      const nodOff = k < 0.8 ? Ease.inOutSine(k / 0.8) : 1 - Ease.outCubic((k - 0.8) / 0.2);
      return {
        pose: {
          hunch: 0.3 + 0.1 * nodOff,
          headY: 0.02 + 0.05 * nodOff,
          headTilt: 0.15 * nodOff * m,
          mouthO: f.yawn,
          tongue: 0.2 * f.yawn,
          lid: clamp(0.55 + 0.45 * (1 - f.eyeOpen) + 0.2 * nodOff, 0, 1),
          earL: -0.5, earR: -0.5,
          kneeL: 0.35, kneeR: 0.35,
          ...paws([0.04, -0.37], [0.11, -0.36]),
          brow: 0, browUp: f.yawn * 0.5,
          blink: 0,
        },
        eye: "round",
      };
    }

    case "SLEEPING": {
      // Curls up under the scarf like a blanket; dreams like a dog does, with
      // twitches, a little whimper and paddling paws.
      const k = st > 2000 ? ((st - 2000) % 3600) / 3600 : 1;
      const dream = k < 0.25 ? Math.sin((Math.PI * k) / 0.25) : 0;
      return {
        pose: {
          curl: kf(st, [[0, 0], [300, 0], [1000, 1, Ease.inOutSine]]),
          sy: kf(st, [[0, 1], [700, 0.8]]),
          hunch: kf(st, [[0, 0.3], [700, 0.5]]),
          kneeL: 0.6, kneeR: 0.6,
          dream: dream * m,
          mouthO: 0.05 + 0.04 * Math.sin((TAU * t) / 5) + 0.12 * dream,
          earL: 0.3 * dream * m, earR: 0.4 * dream * m,
          brow: 0.6 * dream, blush: 0.5,
          blink: 0,
        },
        eye: "closed",
      };
    }

    case "WAKING":
      // Uncurls, a big stretch and a yawn, blinks twice, then a double take:
      // "what was that?!"
      return {
        pose: {
          curl: kf(st, [[0, 1], [400, 0, Ease.outCubic]]),
          sy: kf(st, [[300, 1], [500, 1.12, Ease.outQuad], [750, 1, Ease.outElastic]]),
          sx: kf(st, [[300, 1], [500, 0.92, Ease.outQuad], [750, 1, Ease.outElastic]]),
          ...paws(mix(PAW_L, add(CLING_L, 0, 0.12), kf(st, [[300, 0], [450, 1], [650, 0]])), mix(PAW_R, add(CLING_R, 0, 0.12), kf(st, [[300, 0], [450, 1], [650, 0]]))),
          mouthO: kf(st, [[250, 0], [420, 0.8], [650, 0]]),
          lid: kf(st, [[0, 0.6], [650, 0.6], [700, 0]]),
          eyeOpen: wakeBlink(Math.max(0, st - 400)),
          pop: kf(st, [[650, 0], [720, 0.7, Ease.outBack], [900, 0.3]]),
          earR: kf(st, [[650, 0], [720, 0.9, Ease.outBack], [900, 0.4]]),
          earL: kf(st, [[650, 0], [720, 0.6], [900, 0.2]]),
          brow: kf(st, [[0, 0], [700, 0.9]]),
          blink: 0,
        },
        eye: "round",
      };

    case "HELD":
      // Picked up: legs running wildly in the air (a cartoon wheel), arms
      // flailing, screaming, scarf flying.
      return {
        pose: {
          ...heldSwing(i, 1.0),
          run: m,
          ...paws(add(FLAIL_L, 0.05 * Math.sin(t * 17) * m, 0.05 * Math.cos(t * 17) * m), add(FLAIL_R, 0.05 * Math.cos(t * 15) * m, 0.05 * Math.sin(t * 15) * m)),
          mouthO: 0.85, teeth: 1, tongue: 1,
          pop: 0.9, pupil: 0.45, lid: 0,
          earL: 1.2, earR: 1.25, earFlap: 1,
          flag: 1, poof: 0.4, shiver: 0.6 * m,
          tailTuck: 1,
          brow: 1, browUp: 0.8,
        },
        eye: "round",
      };

    case "LANDING": {
      // Set down: his legs buckle like jelly, then wobble him upright.
      const wob = 0.12 * Math.sin((st / 450) * TAU * 2) * (1 - st / 450) * m;
      return {
        pose: {
          lift: kf(st, [[0, 0.04], [100, 0, Ease.inQuad]]) * m,
          sy: kf(st, [[0, 1.04], [100, 0.72, Ease.outQuad], [260, 1.08, Ease.outQuad], [450, 1, Ease.outElastic]]),
          sx: kf(st, [[0, 0.97], [100, 1.18, Ease.outQuad], [260, 0.95, Ease.outQuad], [450, 1, Ease.outElastic]]),
          bodyRot: wob,
          ...feet(add(FOOT_L, -0.03 * kf(st, [[0, 0], [100, 1], [450, 0]]), 0), add(FOOT_R, 0.03 * kf(st, [[0, 0], [100, 1], [450, 0]]), 0)),
          kneeL: kf(st, [[0, 0], [100, -0.9], [250, 0.5], [350, -0.25], [450, 0.18]]),
          kneeR: kf(st, [[0, 0], [100, 0.9], [250, -0.5], [350, 0.25], [450, 0.18]]),
          earL: kf(st, [[0, 1.2], [100, 1.3], [450, 0, Ease.outBack]]),
          earR: kf(st, [[0, 1.25], [100, 1.35], [450, 0, Ease.outBack]]),
          pop: kf(st, [[0, 0.9], [100, 0], [200, 0.4], [450, 0]]),
          mouthO: kf(st, [[100, 0], [160, 0.3], [400, 0]]),
          brow: 0.9,
          tailTuck: kf(st, [[0, 1], [450, 0.3]]),
        },
        eye: st < 180 ? "closed" : "round",
      };
    }
  }
}

// ── Working, by what the agent is doing ───────────────────────────────────────
// Each lasts as long as the work does, so each is a calm loop with a beat now
// and then; all stand on his toes like plain working, so switching between
// them (every few seconds at most) crossfades naturally. Props scale in over
// the first ~350 ms. Under reduced motion the continuous wiggles stop (they
// run on `t`, which is frozen then) and the beats (`st`) play smaller.

/** Paw targets (body space). Reading: the far paw holds the book, the near one the glass over it. */
const BOOK_PAW: Pt = [0.19, -0.48];
const LENS_PAW: Pt = [0.52, -0.44];
/** The push button stands on the ground in front of him: where, how tall (its housing's top). */
const BUTTON_X = 0.5;
const BUTTON_H = 0.36;
/** How big the button is drawn (its housing's top is at BUTTON_H). */
const BUTTON_S = 1.2;
/** Running: his paw up over the button, and on its cap. */
const HOVER: Pt = [BUTTON_X - 0.01, -0.68];
const CAP: Pt = [BUTTON_X + 0.005, -0.445];
/** The sign: the far paw holds its lower back corner, the near one its front edge (where `signFrame` puts it). */
const SIGN_L: Pt = [0.19, -0.45];
const SIGN_R: Pt = [0.51, -0.49];
/** How big the sign is drawn. */
const SIGN_S = 1.3;
/** Thinking: the far paw holding his near elbow. */
const ELBOW: Pt = [0.15, -0.49];

/** What every kind of work shares: up on his toes, a little tremble, the scarf knitting up with progress. */
function workBase(i: PoseInput, tipAmt = 1): Partial<Pose> {
  const { t, motion: m } = i;
  const tip = Math.sin(t * 9) * tipAmt * m;
  return {
    lift: 0.01 * m,
    ...feet(add(FOOT_L, 0, -0.01 * Math.max(0, tip)), add(FOOT_R, 0, -0.01 * Math.max(0, -tip))),
    kneeL: 0.25 + 0.08 * Math.max(0, tip), kneeR: 0.25 + 0.08 * Math.max(0, -tip),
    hunch: 0.2,
    earL: twitch(t, 3), earR: twitch(t, 4),
    tailTuck: 0.5,
    shiver: 0.12 * m,
    fill: i.progress ?? 0,
  };
}

/**
 * Reading or searching: nose down in a book, peering through a magnifying
 * glass. His eyes run along a line and flick back for the next, mouthing the
 * words; every few seconds a page turns over, and now and then instead, "oh!":
 * found it. Head up, ears up, eyes wide, a "!" and a wag, then back to it.
 */
function researching(i: PoseInput): PoseOut {
  const { st, t, motion: m } = i;
  const big = 0.4 + 0.6 * m;
  const up = kf(st, [[0, 0], [350, 1, Ease.outBack]]);
  const line = (st % 1400) / 1400;
  const along = line < 0.8 ? lerp(-1, 1, line / 0.8) : lerp(1, -1, Ease.inOutSine((line - 0.8) / 0.2));
  const n = Math.floor(st / 4200), u = st % 4200;
  const found = n % 3 === 1 && hash01(n * 5 + 17) < 0.8;
  const aha = found ? kf(u, [[1500, 0], [1620, 1, Ease.outBack], [2700, 1], [3100, 0, Ease.inOutSine]]) : 0;
  const turning = !found && u >= 2700 && u < 3500;
  const page = turning ? Ease.inOutSine((u - 2700) / 800) : 0;
  const lensUp = found ? 0 : kf(u, [[2500, 0], [2700, 1], [3400, 1], [3650, 0]]);
  const read = 1 - aha;
  const sweep = along * read * (1 - lensUp);
  const mouthing = 0.02 + 0.07 * Math.max(0, Math.sin(t * 13)) * Math.max(0, Math.sin(t * 2.1)) * m;
  return {
    pose: {
      ...workBase(i, 0.6),
      hunch: 0.27 - 0.12 * aha * big,
      headTilt: 0.22 - 0.34 * aha * big,
      headX: 0.012 * sweep * m,
      headY: 0.012 - 0.02 * aha * big,
      ...paws(mix(PAW_L, BOOK_PAW, up), mix(PAW_R, add(LENS_PAW, 0.035 * sweep, -0.06 * lensUp - 0.05 * aha), up)),
      book: up, lens: up, page, excl: aha,
      gazeLock: 1,
      gazeLockX: aha > 0.3 ? -0.3 : turning ? lerp(0.9, -0.1, page) : lerp(0.05, 0.85, (along + 1) / 2),
      gazeLockY: lerp(0.8, -0.1, aha),
      pop: 0.1 + 0.6 * aha * big, pupil: 0.9 - 0.15 * aha, lid: 0.15 * read,
      brow: lerp(0.75, 0.3, aha), browUp: aha,
      earL: lerp(twitch(t, 3), 0.8 * big, aha), earR: lerp(twitch(t, 4), 0.95 * big, aha), earFlap: 0.3 * aha * m,
      mouthO: mouthing * read + 0.32 * aha * (u < 2200 ? 1 : 0.4),
      mouthCurve: 0.2 + 0.7 * aha,
      tail: 0.8 * Math.sin(t * 18) * m * aha, tailTuck: 0.4 * read,
    },
    eye: aha > 0.5 && u > 2050 && u < 2600 ? "happy" : "round",
  };
}

/** Running a command: the push button's cycle (ms), and when the first one starts. */
const RUN_P = 6800;
const RUN_AT = 600;
/** When in the cycle his paw hits the button. */
const RUN_HIT = 900;

/**
 * Running a command: the big red button. Paw up over it, trembling; he leans
 * away, screws his eyes shut, and... *press*. A one-eyed peek; then he waits,
 * wringing his paws, eyes on the blinking lamp (and darting to you), sweating,
 * until he steels himself and presses again.
 */
function pressing(i: PoseInput): PoseOut {
  const { st, t, motion: m } = i;
  const big = 0.4 + 0.6 * m;
  const base = workBase(i, 0.5);
  const show = kf(st, [[0, 0], [350, 1, Ease.outBack]]);
  const u = (st + RUN_P - RUN_AT) % RUN_P;
  const wind = kf(u, [[0, 0], [450, 1, Ease.inOutSine], [850, 1], [940, 0]]);
  const press = kf(u, [[820, 0], [RUN_HIT, 1, Ease.inQuad], [1600, 1], [1850, 0, Ease.inOutSine]]);
  const down = kf(u, [[860, 0], [RUN_HIT + 10, 1], [1650, 1], [1720, 0]]);
  const shut = kf(u, [[250, 0], [450, 1], [1700, 1], [1950, 0]]);
  const peek = kf(u, [[1750, 0], [1950, 1], [2800, 1], [3100, 0]]);
  const waiting = kf(u, [[2900, 0], [3300, 1], [RUN_P - 800, 1], [RUN_P - 500, 0]]);
  const gulp = kf(u, [[RUN_P - 800, 0], [RUN_P - 550, 1], [RUN_P - 100, 1], [RUN_P, 0]]);
  const click = kf(u, [[RUN_HIT - 20, 0], [RUN_HIT + 20, 1], [RUN_HIT + 300, 0]]);
  const lit = u > RUN_HIT + 20 && u < RUN_P - 800;
  const wring = (s: number) => 0.008 * Math.sin(t * 9 + s) * m;
  const hover = add(HOVER, 0.008 * Math.sin(t * 38) * m * wind, 0.006 * Math.cos(t * 33) * m * wind);
  const near = mix(mix(add(TUCK_R, wring(0), 0), hover, wind), add(CAP, 0, 0.028 * down), press);
  const kn = knock(t, m, 0.9);
  return {
    pose: {
      ...base,
      hunch: 0.2 - 0.2 * shut * big + 0.1 * press + 0.06 * waiting,
      bodyRot: -0.05 * shut * m,
      headX: -0.05 * shut * big + 0.02 * peek,
      headY: 0.015 * gulp,
      headTilt: -0.25 * shut * big + 0.12 * peek + 0.16 * waiting + 0.05 * gulp,
      sy: kf(u, [[RUN_HIT - 20, 1], [RUN_HIT + 30, 0.94], [RUN_HIT + 150, 1.03], [RUN_HIT + 300, 1]]),
      sx: kf(u, [[RUN_HIT - 20, 1], [RUN_HIT + 30, 1.04], [RUN_HIT + 150, 0.98], [RUN_HIT + 300, 1]]),
      kneeL: lerp(base.kneeL!, kn.kneeL, wind), kneeR: lerp(base.kneeR!, kn.kneeR, wind),
      ...paws(add(TUCK_L, -wring(1.5), 0), near),
      button: show, press: down,
      lamp: lit ? (m && Math.floor(st / 400) % 2 ? 0.25 : 1) : 0,
      lid: Math.max(shut, 0.45 * peek, 0.08), wink: peek,
      grin: Math.max(0.9 * shut, 0.55 * waiting),
      gazeLock: 1, gazeLockX: waiting > 0.5 && st % 2300 < 350 ? -0.35 : 0.85, gazeLockY: 0.6,
      pop: 0.15 * waiting + 0.25 * click * big,
      brow: lerp(1, -0.4, gulp), browUp: 0.3 * waiting,
      earL: lerp(base.earL!, -0.7, shut) + 0.5 * click * big,
      earR: lerp(base.earR!, -0.7, shut) + 0.6 * click * big,
      sweat: waiting > 0.5 && u > 3300 ? ((u - 3300) % 1600) / 1600 : 0,
      tailTuck: 0.5 + 0.5 * shut,
      shiver: lerp(0.12, 0.5, Math.max(wind, shut)) * m,
    },
    eye: "round",
  };
}

/** On the web: the binoculars' cycle (ms). */
const BROWSE_P = 8500;

/**
 * On the web: binoculars up, slowly scanning the far distance, swaying from
 * side to side... then a double take: "huh?", down come the binoculars, eyes
 * popping, ears flying, fur on end... gulp... and up they go again.
 */
function lookout(i: PoseInput): PoseOut {
  const { st, t, motion: m } = i;
  const big = 0.4 + 0.6 * m;
  const up = kf(st, [[0, 0], [400, 1, Ease.outBack]]);
  const n = Math.floor(st / BROWSE_P), u = st % BROWSE_P;
  const a = u - (4600 + 1800 * hash01(n * 3 + 11));
  const freeze = kf(a, [[0, 0], [100, 1], [1800, 1], [2100, 0]]);
  const huh = kf(a, [[0, 0], [80, 1], [220, 0]]);
  const lower = kf(a, [[150, 0], [290, 1, Ease.outBack], [1250, 1], [1600, 0, Ease.inOutSine]]);
  const fright = kf(a, [[220, 0], [320, 1], [950, 0.7], [1350, 0]]);
  const gulp = kf(a, [[1150, 0], [1300, 1], [1650, 1], [1800, 0]]);
  const sweep = Math.sin((st / 1000) * TAU / 5.5) * (1 - freeze) * m;
  return {
    pose: {
      ...workBase(i, 0.5),
      hunch: 0.13 + 0.05 * lower,
      bodyRot: 0.04 * sweep,
      headX: 0.035 * sweep - 0.03 * huh * big,
      headY: 0.01 * gulp,
      headTilt: -0.06 + 0.06 * sweep,
      // (His paws are on the binoculars: drawStanding puts them there.)
      ...paws(mix(PAW_L, [0.12, -0.74], up), mix(PAW_R, [0.33, -0.78], up)),
      bino: up, binoDrop: lower,
      lift: 0.01 * m + 0.03 * fright * m,
      pop: fright * big, pupil: 1 - 0.55 * fright * big, lid: 0.1 * (1 - fright),
      shock: fright * (0.5 + 0.5 * m), poof: 0.5 * fright * m,
      earL: lerp(twitch(t, 3), 1.1 * big, fright), earR: lerp(twitch(t, 4), 1.2 * big, fright), earFlap: 0.5 * fright * m,
      mouthO: 0.42 * fright * big, teeth: 1, grin: 0.8 * gulp,
      gazeLock: 1, gazeLockX: 1, gazeLockY: 0,
      brow: 0.7 + 0.3 * fright, browUp: fright,
      tail: 0.3 * Math.sin(t * 2) * m * (1 - fright), tailTuck: 0.3 + 0.7 * fright,
      shiver: (0.08 + 0.5 * fright) * m,
    },
    eye: "round",
  };
}

/** Waiting for your OK: the sign's cycle (ms), after the first fright. */
const WAIT_P = 5200;
const WAIT_AT = 850;

/**
 * Waiting for your OK (as long as it takes): the jolt of his NOTIFY fright,
 * then a sign with a big "!" held up at you: waved and pumped while he calls
 * out "hey! hey!", eyes on you, ears up; then, holding it still, he leans in
 * over it with pleading puppy eyes and taps the "!", then waves it again.
 * Each wave starts with a little attention jolt.
 */
function calling(i: PoseInput): PoseOut {
  const { st, t, motion: m } = i;
  const big = 0.4 + 0.6 * m;
  const into = kf(st, [[450, 0], [WAIT_AT, 1, Ease.inOutSine]]);
  const sign = kf(st, [[450, 0], [WAIT_AT, 1, Ease.outBack]]);
  const u = Math.max(0, st - WAIT_AT) % WAIT_P;
  const wave = st < WAIT_AT ? 1 : kf(u, [[0, 1], [2600, 1], [2900, 0], [WAIT_P - 300, 0], [WAIT_P, 1]]);
  const plead = 1 - wave;
  const jolt = st < WAIT_AT ? 0 : kf(u, [[0, 0], [90, 1], [380, 0]]);
  const tap = kf(u, [[3200, 0], [3400, 1], [4500, 1], [4700, 0]]);
  const knockK = tap * Math.max(0, Math.sin(((u - 3400) / 1000) * TAU * 2.5)) * big;
  const ph = t * TAU * 0.85;
  const pump = 0.022 * Math.sin(2 * ph) * m * wave;
  const loop: Partial<Pose> = {
    ...workBase(i),
    lift: 0.01 * m + 0.025 * Math.abs(Math.sin(ph)) * m * wave + 0.04 * jolt * m,
    hunch: 0.16 + 0.07 * plead,
    headX: 0.04 * plead * big, headY: -0.012 * plead,
    headTilt: -0.07 * plead * big + 0.04 * Math.sin(ph) * m * wave,
    ...paws(add(SIGN_L, 0, pump), add(SIGN_R, 0, pump)),
    sign, signTilt: 0.16 * Math.sin(ph) * m * wave, signTap: tap, signKnock: knockK,
    gazeLock: 1, gazeLockX: -0.35, gazeLockY: -0.05 + 0.1 * plead,
    pop: 0.3 + 0.25 * plead + 0.5 * jolt * big, pupil: lerp(0.85, 1.3, plead), lid: 0, eyeTilt: 0.35 * plead,
    brow: 1, browUp: 0.6 * wave + 0.3 * plead + 0.4 * jolt,
    mouthO: wave * (0.1 + 0.14 * Math.abs(Math.sin(t * TAU * 1.7)) * m),
    mouthCurve: lerp(0.4, -0.35, plead),
    earL: 0.1 + 0.6 * wave, earR: 0.15 + 0.65 * wave + 0.4 * jolt * big, earFlap: 0.3 * wave * m,
    shock: 0.7 * jolt,
    tail: 0.4 * Math.sin(t * 9) * m * wave, tailTuck: 0.35,
    shiver: 0.15 * m,
  };
  return { pose: blend(freakOut(st, m, 0.1), loop, into), eye: "round" };
}

/**
 * The agent asked you something (as long as it takes to answer): a "?" over
 * his head, his head tilted one way and (every few seconds) the other, a paw
 * at his chin, tapping it, eyes rolled up thinking, "hmm"; every few seconds
 * a hopeful look at you, brows up, the "?" bobbing.
 */
function pondering(i: PoseInput): PoseOut {
  const { st, t, motion: m } = i;
  const big = 0.4 + 0.6 * m;
  const k = kf(st, [[0, 0], [400, 1, Ease.outBack]]);
  const side = clamp(Math.sin((st / 1000) * TAU / 9) * 2.2, -1, 1);
  const u = st % 3600;
  const look = st > 1500 ? kf(u, [[2200, 0], [2450, 1], [3300, 1], [3550, 0]]) : 0;
  const bob = st > 1500 ? kf(u, [[2200, 0], [2350, 1], [2700, 0]]) : 0;
  return {
    pose: {
      ...workBase(i, 0.4),
      hunch: 0.17,
      headTilt: (0.1 + 0.17 * side) * big - 0.05 * look,
      headX: 0.012 * look,
      ...paws(mix(PAW_L, ELBOW, k), mix(PAW_R, [0.26, -0.64], k)),
      // (Drawn at his chin, wherever his head is.)
      chin: k, chinTap: Math.max(0, Math.sin(t * TAU * 1.6)) * m * (1 - look),
      qmark: kf(st, [[150, 0], [550, 1.2, Ease.outBack]]) * (1 + 0.18 * bob),
      gazeLock: 1, gazeLockX: lerp(-0.55, -0.3, look), gazeLockY: lerp(-0.8, 0.05, look),
      lid: lerp(0.32, 0.05, look), brow: lerp(0.35, 0.8, look), browUp: 0.45 * look,
      eyeScaleL: 1.08, eyeScaleR: 0.94,
      whistle: 0.7 * (1 - look), mouthCurve: lerp(-0.2, 0.5, look),
      earL: 0.3 + 0.2 * side + 0.2 * look, earR: 0.05 - 0.1 * side + 0.4 * look, earFlap: 0.15 * bob * m,
      tail: 0.3 * Math.sin(t * 3) * m, tailTuck: 0.2,
      shiver: 0.05 * m,
    },
    eye: "round",
  };
}

/** Where the head is, in body space (head centre). */
function headCentre(p: Pose): Pt {
  const nb = torsoPt(p, NECK_BASE[0], NECK_BASE[1]);
  return [nb[0] + HEAD_OFF[0] + p.headX, nb[1] + HEAD_OFF[1] - p.neck + p.headY];
}

/** Where his head is, in particle units (y up from the ground). */
function headAt(p: Pose): { x: number; y: number } {
  if (p.curl > 0.5) return { x: p.bodyX + DX + 0.13, y: p.lift + 0.16 };
  const [x, y] = headCentre(p);
  return { x: p.bodyX + DX + x, y: p.lift - y * p.sy };
}

function events(i: PoseInput, prev: number, emit: Emit, p: Pose) {
  const crossed = crossedAt(prev, i.st);
  const head = headAt(p);
  /** Two dust puffs at his feet (a landing). */
  const dust = () => {
    for (const side of [-1, 1]) emit({ kind: "puff", x: p.bodyX + DX + 0.01 + side * 0.13, y: 0.03, vx: side * 0.3, vy: 0.06, size: 0.045, life: 0.45 });
  };
  switch (i.state) {
    case "ATTENTIVE":
      if (crossed(470)) dust();
      break;
    case "TOUCHED":
      if (i.variant === "dizzy" && crossed(40)) {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * TAU;
          emit({ kind: "star", x: head.x + Math.cos(a) * 0.22, y: head.y + 0.22 + Math.sin(a) * 0.05, vx: -Math.sin(a) * 0.3, vy: 0.05, size: 0.06, life: 1.1, spin: 3 });
        }
      } else if (i.variant === null && crossed(530)) dust();
      break;
    case "SUCCESS":
      for (const at of [200, i.variant === "short" ? 450 : 800]) {
        if (crossed(at)) {
          for (let k = 0; k < 3; k++) {
            const a = -Math.PI / 2 + (k - 1) * 0.8;
            emit({ kind: "sparkle", x: head.x + Math.cos(a) * 0.25, y: head.y + 0.12 - Math.sin(a) * 0.12, vx: Math.cos(a) * 0.3, vy: 0.25, size: 0.06, life: 0.9, spin: 2 });
          }
        }
      }
      break;
    case "ERROR":
      if (crossed(380)) dust();
      if (crossed(1650)) dust();
      break;
    case "LANDING":
      if (crossed(90)) dust();
      break;
    case "WORKING":
      if (i.variant === "run") {
        // Click! Sparks off the button.
        const hit = RUN_AT + RUN_HIT + Math.floor((i.st - RUN_AT - RUN_HIT) / RUN_P) * RUN_P;
        if (hit > 0 && crossed(hit)) {
          for (let k = 0; k < 3; k++) {
            const a = -Math.PI / 2 + (k - 1) * 0.7;
            emit({ kind: "sparkle", x: p.bodyX + DX + BUTTON_X + Math.cos(a) * 0.09, y: BUTTON_H + 0.1 - Math.sin(a) * 0.04, vx: Math.cos(a) * 0.35, vy: 0.3, size: 0.045, life: 0.6, spin: 3 });
          }
        }
      } else if (i.variant === "research" && p.excl > 0.5) {
        // "Found it!": one sparkle by his head.
        const n = Math.floor(i.st / 4200);
        if (crossed(n * 4200 + 1600)) emit({ kind: "sparkle", x: head.x + 0.26, y: head.y + 0.2, vx: 0.15, vy: 0.2, size: 0.06, life: 0.8, spin: 2 });
      }
      break;
    case "SLEEPING":
      if (i.st >= 1500) {
        const n = Math.floor((i.st - 1500) / 4000);
        if (crossed(1500 + n * 4000)) emit({ kind: "z", x: head.x + 0.12, y: head.y + 0.14, vx: 0.07, vy: 0.1, size: 0.08, life: 3.2 });
      }
      break;
  }
}

// ── Drawing ───────────────────────────────────────────────────────────────────

/** A point in torso space (origin at the hips, y up the spine) in body space. */
function torsoPt(p: Pose, x: number, y: number): Pt {
  const c = Math.cos(p.hunch), s = Math.sin(p.hunch);
  const yy = y * p.torsoSY;
  return [x * c - yy * s, HIP_Y + x * s + yy * c];
}

/**
 * A soft bean (torso or head). `pear` widens the lower half, `bow` pushes the
 * middle forward (a belly). With `poof` the outline breaks into tufts of fur
 * standing on end.
 */
function bean(cx: number, cy: number, rx: number, ry: number, pear: number, bow: number, poof: number, seed: number): Path2D {
  const N = 48;
  const pts: Pt[] = [];
  for (let k = 0; k < N; k++) {
    const a = (k / N) * TAU;
    const s = Math.sin(a);
    let x = rx * Math.cos(a) * (1 + pear * s) + bow * (1 - s * s);
    let y = ry * s;
    if (poof > 0.01) {
      const r = 1 + poof * (k % 2 ? 0.13 + 0.06 * hash01(k + seed) : -0.015);
      x *= r;
      y *= r;
    }
    pts.push([cx + x, cy + y]);
  }
  const p = new Path2D();
  if (poof > 0.01) {
    p.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < N; k++) p.lineTo(pts[k][0], pts[k][1]);
  } else {
    const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const start = mid(pts[N - 1], pts[0]);
    p.moveTo(start[0], start[1]);
    for (let k = 0; k < N; k++) {
      const m = mid(pts[k], pts[(k + 1) % N]);
      p.quadraticCurveTo(pts[k][0], pts[k][1], m[0], m[1]);
    }
  }
  p.closePath();
  return p;
}

/** Path of a rubber-hose limb from a to b, bowed sideways by `bend` (no joints). */
function hose(a: Pt, b: Pt, bend: number): Path2D {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-6;
  const nx = -dy / len, ny = dx / len;
  const k = bend * len * 0.6;
  const p = new Path2D();
  p.moveTo(a[0], a[1]);
  p.bezierCurveTo(a[0] + dx / 3 + nx * k, a[1] + dy / 3 + ny * k, a[0] + (2 * dx) / 3 + nx * k, a[1] + (2 * dy) / 3 + ny * k, b[0], b[1]);
  return p;
}

/** A noodle: a thin outline round a cream stroke. */
function noodle(g: CanvasRenderingContext2D, path: Path2D, w: number, color = C.fur) {
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = C.line;
  g.lineWidth = w + 0.014;
  g.stroke(path);
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke(path);
}

function draw(g: CanvasRenderingContext2D, p: Pose, eye: string, f: Frame) {
  const { U, ox, oy } = f;
  const curled = smoothstep(0.3, 0.7, p.curl);

  // Contact shadow: stays on the ground, shrinks as he leaps, spreads when he melts.
  {
    const k = clamp(1 - p.lift * 3, 0.35, 1.1);
    g.save();
    g.translate(ox + (p.bodyX + DX + 0.01) * U, oy);
    g.scale(U, U);
    const r = (0.2 + 0.08 * curled) * k * Math.max(1, p.sx);
    const sh = g.createRadialGradient(0, 0, 0, 0, 0, r);
    sh.addColorStop(0, `rgba(90,62,28,${0.3 * k})`);
    sh.addColorStop(1, "rgba(90,62,28,0)");
    g.fillStyle = sh;
    g.beginPath();
    g.ellipse(0, 0, r, r * 0.2, 0, 0, TAU);
    g.fill();
    g.restore();
  }

  // His skin, left behind on the ground for a moment when he jumps out of it:
  // a faded copy of him, standing where he was.
  if (p.ghost > 0.01 && curled < 0.5) {
    g.save();
    g.translate(ox + (p.bodyX + DX) * U, oy);
    g.scale(U, U);
    g.globalAlpha *= clamp(p.ghost, 0, 1) * 0.35;
    const skin: Pose = {
      ...p, run: 0, poof: 0, shock: 0, ghost: 0, torsoSY: 1, neck: 0, mouthO: 0.3, pop: 0.6, flag: 0,
      pawLX: PAW_L[0], pawLY: PAW_L[1], pawRX: PAW_R[0], pawRY: PAW_R[1],
      footLX: FOOT_L[0], footLY: FOOT_L[1], footRX: FOOT_R[0], footRY: FOOT_R[1],
    };
    drawStanding(g, skin, "round", f);
    g.restore();
  }

  // The push button, standing on the ground in front of him (it doesn't hop with him).
  if (p.button > 0.01) {
    g.save();
    g.translate(ox + (p.bodyX + DX) * U, oy);
    g.scale(U, U);
    drawButton(g, p, f);
    g.restore();
  }

  // A tremble when he's frightened (fast and tiny; frozen under reduced motion).
  const quake = p.shiver * 0.006 * Math.sin(f.t * 75);

  g.save();
  g.translate(ox + (p.bodyX + DX + quake) * U, oy - p.lift * U);
  g.scale(U, U);
  g.rotate(p.bodyRot);
  if (curled < 0.999) {
    g.save();
    g.scale(p.sx, p.sy);
    g.globalAlpha *= 1 - curled;
    drawStanding(g, p, eye, f);
    g.restore();
  }
  if (curled > 0.001) {
    // Curled up he keeps his own shape (the sinking squash is the standing
    // figure's), breathing slowly.
    g.save();
    g.scale(1, 1 + 0.025 * Math.sin((TAU * f.t) / 5));
    g.globalAlpha *= curled;
    drawCurled(g, p, f);
    g.restore();
  }
  g.restore();
}

function drawStanding(g: CanvasRenderingContext2D, p: Pose, eye: string, f: Frame) {
  const hc = headCentre(p);
  const nb = torsoPt(p, NECK_BASE[0], NECK_BASE[1]);
  const shL = torsoPt(p, SHOULDER_L[0], SHOULDER_L[1]);
  const shR = torsoPt(p, SHOULDER_R[0], SHOULDER_R[1]);

  // Feet: where the pose puts them, or whirling round the hips when he runs on air.
  const run = clamp(p.run, 0, 1);
  const wheel = (hip: Pt, phase: number): Pt => [hip[0] + 0.02 + 0.1 * Math.cos(phase), HIP_Y + 0.2 + 0.07 * Math.sin(phase)];
  const ph = f.t * 18;
  const footL = mix([p.footLX, p.footLY], wheel(HIP_L, ph + Math.PI), run);
  const footR = mix([p.footRX, p.footRY], wheel(HIP_R, ph), run);

  // His paws, unless a working prop holds them (binoculars, a sign, his chin).
  const work = workPaws(p, hc);
  const pawL = work.L, pawR = work.R;

  const cozy = outfit === "cozy";
  drawTail(g, p);
  if (cozy) drawScarfEnd(g, p, nb, f);
  else drawOutfitBack(g, p, nb, f);

  // The far legs and arm, behind the body.
  if (run > 0.4) drawWheelBlur(g, run);
  drawLeg(g, HIP_L, footL, p.kneeL, f, -1);
  drawArm(g, shL, pawL, -1, f);

  drawTorso(g, p);
  drawLeg(g, HIP_R, footR, p.kneeR, f, 1);
  if (!cozy) drawTop(g, p, f);

  // Thin neck, the scarf (or the outfit's collar) round it, and the head on top.
  g.save();
  noodle(g, hose(nb, [hc[0] - 0.04, hc[1] + 0.11], 0.1), 0.05);
  g.restore();
  if (cozy) drawScarfBand(g, p, nb, f);
  else drawCollar(g, p, nb, f);
  // Pulling a hat down, his near arm reaches up behind his head: only the mitt
  // shows, on the brim (so the arm never crosses his face).
  const armBehind = !cozy && HAT_HIDERS.has(outfit) && p.hide > 0.05;
  if (armBehind) drawArm(g, shR, pawR, 1, f, "arm");

  g.save();
  g.translate(hc[0], hc[1]);
  g.rotate(p.headTilt);
  g.scale(HEAD_SCALE, HEAD_SCALE);
  drawHead(g, p, eye, f);
  g.restore();

  // What he's working with, in front of him; the far paw that holds it on top.
  if (drawWorkProps(g, p, work, f)) drawArm(g, shL, pawL, -1, f, "mitt");
  if (!cozy) drawHeldProp(g, p, hc, eye, f);
  drawArm(g, shR, pawR, 1, f, armBehind ? "mitt" : "all");
  if (!cozy) drawOutfitFront(g, p, hc, nb);
  drawOverlays(g, p, hc, f);
}

/** The motion blur of legs whirling on air. */
function drawWheelBlur(g: CanvasRenderingContext2D, run: number) {
  g.save();
  g.strokeStyle = `rgba(110,76,40,${0.22 * run})`;
  g.lineWidth = 0.012;
  g.beginPath();
  g.ellipse(0.02, HIP_Y + 0.2, 0.13, 0.09, 0, 0, TAU);
  g.stroke();
  g.beginPath();
  g.ellipse(0.02, HIP_Y + 0.2, 0.09, 0.06, 0, 0, TAU);
  g.stroke();
  g.restore();
}

function drawLeg(g: CanvasRenderingContext2D, hip: Pt, foot: Pt, knee: number, f: Frame, side: -1 | 1) {
  g.save();
  noodle(g, hose(hip, foot, -knee), 0.034);
  const boot = outfit === "rainy";
  if (outfit !== "cozy") dressLeg(g, hip, foot, -knee, side);
  // A small knobby foot, toes forward (or a rubber boot).
  g.translate(foot[0] + 0.02, foot[1]);
  g.fillStyle = boot ? (side < 0 ? KS("boots") : K("boots")) : C.furLight;
  g.beginPath();
  if (boot) g.ellipse(0.004, -0.004, 0.05, 0.028, 0, 0, TAU);
  else g.ellipse(0, 0, 0.043, 0.022, 0, 0, TAU);
  g.fill();
  g.strokeStyle = C.line;
  g.lineWidth = 0.008;
  g.stroke();
  if (boot) {
    // The sole.
    g.lineWidth = 0.007;
    g.beginPath();
    g.moveTo(-0.044, 0.008);
    g.quadraticCurveTo(0.004, 0.026, 0.052, 0.006);
    g.stroke();
  } else if (f.detail > 0.3) {
    g.lineWidth = 0.006;
    g.beginPath();
    for (const x of [0.012, 0.027]) {
      g.moveTo(x, 0.02);
      g.lineTo(x, 0.006);
    }
    g.stroke();
  }
  g.restore();
}

/** An arm and its mitt (or, for an arm drawn behind something, just one of them). */
function drawArm(g: CanvasRenderingContext2D, shoulder: Pt, paw: Pt, side: -1 | 1, f: Frame, part: "all" | "arm" | "mitt" = "all") {
  // Elbows bow forward, except reaching up behind his head (scratching), where
  // the arm curves back so it never crosses his eyes.
  const behind = clamp((-paw[1] - 0.8) / 0.15, 0, 1) * clamp((shoulder[0] + 0.1 - paw[0]) / 0.06, 0, 1);
  const bend = 0.35 * side * (1 - 2 * behind);
  g.save();
  if (part !== "mitt") {
    noodle(g, hose(shoulder, paw, bend), 0.03);
    if (outfit !== "cozy") drawSleeve(g, shoulder, paw, bend, side);
  }
  if (part === "arm") {
    g.restore();
    return;
  }
  // A little three-fingered mitt.
  const a = Math.atan2(paw[1] - shoulder[1], paw[0] - shoulder[0]);
  g.translate(paw[0], paw[1]);
  g.rotate(a);
  g.fillStyle = C.furLight;
  g.beginPath();
  g.ellipse(0.006, 0, 0.026, 0.023, 0, 0, TAU);
  g.fill();
  g.strokeStyle = C.line;
  g.lineWidth = 0.008;
  g.stroke();
  if (f.detail > 0.3) {
    g.lineWidth = 0.006;
    g.beginPath();
    for (const y of [-0.007, 0.007]) {
      g.moveTo(0.032, y);
      g.lineTo(0.016, y);
    }
    g.stroke();
  }
  g.restore();
}

function drawTorso(g: CanvasRenderingContext2D, p: Pose) {
  g.save();
  g.translate(0, HIP_Y);
  g.rotate(p.hunch);
  g.scale(1, p.torsoSY);
  const body = bean(0.0, -0.15, 0.1, 0.165, 0.18, 0.02, p.poof, 3);
  const bg = g.createRadialGradient(-0.03, -0.22, 0.01, 0, -0.15, 0.2);
  bg.addColorStop(0, C.furLight);
  bg.addColorStop(0.55, C.fur);
  bg.addColorStop(1, C.furShade);
  g.fillStyle = bg;
  g.fill(body);
  g.strokeStyle = C.line;
  g.lineWidth = 0.009;
  g.lineJoin = "round";
  g.stroke(body);
  // Pale belly.
  g.fillStyle = C.pale;
  g.beginPath();
  g.ellipse(0.045, -0.12, 0.05, 0.1, 0.1, 0, TAU);
  g.fill();
  g.restore();
}

/** A thin wiry tail with a caramel tuft: wags when he's happy, tucks between his legs when he's scared. */
function drawTail(g: CanvasRenderingContext2D, p: Pose) {
  const tuck = clamp(p.tailTuck, 0, 1);
  const base = torsoPt(p, -0.085, -0.04);
  const up: Pt = [base[0] - 0.15 + 0.03 * p.tail, base[1] - 0.15 + 0.02 * Math.abs(p.tail)];
  const tip = mix(up, [base[0] + 0.03, -0.06], tuck);
  g.save();
  noodle(g, hose(base, tip, lerp(-0.5, 0.4, tuck)), 0.02);
  // The tuft.
  g.translate(tip[0], tip[1]);
  g.rotate(Math.atan2(tip[1] - base[1], tip[0] - base[0]));
  g.fillStyle = C.ear;
  g.strokeStyle = C.line;
  g.lineWidth = 0.007;
  for (const a of [-0.5, 0, 0.5]) {
    g.save();
    g.rotate(a);
    g.beginPath();
    g.ellipse(0.022, 0, 0.026, 0.011, 0, 0, TAU);
    g.fill();
    g.stroke();
    g.restore();
  }
  g.restore();
}

// ── Head ──────────────────────────────────────────────────────────────────────

/** One long floppy ear, root at the origin, pointing up (−y); darker towards the tip. */
const EAR = (() => {
  const p = new Path2D();
  p.moveTo(-0.025, 0.01);
  p.bezierCurveTo(-0.05, -0.08, -0.05, -0.22, -0.02, -0.29);
  p.quadraticCurveTo(0.004, -0.315, 0.025, -0.285);
  p.bezierCurveTo(0.045, -0.21, 0.04, -0.08, 0.025, 0.01);
  p.closePath();
  return p;
})();

/** Ear angle from straight up, sweeping back (never forward over his face). */
function earAngle(e: number): number {
  if (e < 0) return Math.PI + 0.25 - 0.45 * e; // flattened back
  const up = Math.min(e, 1);
  return lerp(Math.PI + 0.25, TAU - 0.15, up) - 0.7 * Math.max(0, e - 1);
}

function drawEar(g: CanvasRenderingContext2D, p: Pose, side: -1 | 1, f: Frame) {
  const e = side < 0 ? p.earL : p.earR;
  const back = clamp(-e, 0, 1);
  const flap = p.earFlap * 0.45 * Math.sin(f.t * 16 + side * 1.3);
  const swing = -p.lagX * 3 * (1 - 0.6 * clamp(e, 0, 1));
  const root: Pt = side < 0 ? [-0.11, -0.085] : [-0.06, -0.11];
  g.save();
  g.translate(root[0], root[1]);
  g.rotate(earAngle(e) + flap + swing);
  g.scale(1, 1 - 0.25 * back);
  const eg = g.createLinearGradient(0, 0, 0, -0.3);
  eg.addColorStop(0, side < 0 ? C.earTip : C.ear);
  eg.addColorStop(0.35, C.ear);
  eg.addColorStop(1, C.earTip);
  g.fillStyle = eg;
  g.fill(EAR);
  g.strokeStyle = C.line;
  g.lineWidth = 0.008;
  g.stroke(EAR);
  g.restore();
}

/** Whether an ear hangs (drawn in front of the head) or stands (drawn behind it). */
const earHangs = (e: number) => {
  const a = earAngle(e) % TAU;
  return a > Math.PI * 0.5 && a < Math.PI * 1.45;
};

function drawHead(g: CanvasRenderingContext2D, p: Pose, eye: string, f: Frame) {
  drawEar(g, p, -1, f); // the far ear is always behind the head
  if (!earHangs(p.earR)) drawEar(g, p, 1, f);

  // The big lopsided bean of a head.
  g.save();
  g.rotate(-0.18);
  const head = bean(0, 0, 0.16, 0.135, -0.08, 0, p.poof, 11);
  const hg = g.createRadialGradient(-0.05, -0.06, 0.01, 0, 0, 0.18);
  hg.addColorStop(0, C.furLight);
  hg.addColorStop(0.6, C.fur);
  hg.addColorStop(1, C.furShade);
  g.fillStyle = hg;
  g.fill(head);
  g.strokeStyle = C.line;
  g.lineWidth = 0.009;
  g.lineJoin = "round";
  g.stroke(head);
  g.restore();

  if (earHangs(p.earR)) drawEar(g, p, 1, f);
  const cozy = outfit === "cozy";
  if (!cozy) drawHeadwear(g, p, f, "back");

  drawMuzzle(g);
  drawCheek(g, p, f);
  if (!cozy) drawHeadwear(g, p, f, "face");
  drawEye(g, EYE_L, -1, eye, p, f);
  drawEye(g, EYE_R, 1, eye, p, f);
  drawNose(g, 0.262, 0.045);
  drawMouth(g, p, f);
  if (!cozy) drawHeadwear(g, p, f, "front");
  else if (p.hide > 0.01) drawHood(g, p, f);
}

/** The long, narrow muzzle, ending under the big round nose. */
function drawMuzzle(g: CanvasRenderingContext2D) {
  const m = new Path2D();
  m.moveTo(0.02, -0.025);
  m.quadraticCurveTo(0.14, -0.03, 0.25, 0.012);
  m.quadraticCurveTo(0.3, 0.05, 0.25, 0.088);
  m.quadraticCurveTo(0.14, 0.098, 0.03, 0.082);
  m.closePath();
  g.fillStyle = C.pale;
  g.fill(m);
  g.strokeStyle = C.line;
  g.lineWidth = 0.009;
  g.stroke(m);
}

/** Blush and three freckles on the near cheek. */
function drawCheek(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  const cx = 0.0, cy = 0.035;
  g.fillStyle = `rgba(${C.blush},${0.15 + 0.4 * clamp(p.blush, 0, 1)})`;
  g.beginPath();
  g.ellipse(cx, cy + 0.005, 0.04, 0.024, 0, 0, TAU);
  g.fill();
  if (f.detail > 0.12) {
    g.fillStyle = C.freckle;
    for (const [dx, dy] of [[-0.016, -0.006], [0.012, -0.01], [-0.002, 0.012]] as const) {
      g.beginPath();
      g.arc(cx + dx, cy + dy, 0.0075, 0, TAU);
      g.fill();
    }
  }
}

function drawEye(g: CanvasRenderingContext2D, at: Pt, side: -1 | 1, shape: string, p: Pose, f: Frame) {
  const s = p.eyeScale * (side < 0 ? p.eyeScaleL : p.eyeScaleR);
  const pop = Math.max(0, p.pop);
  const rx = 0.05 * s * (1 + 0.15 * pop);
  const ry = 0.066 * s * (1 + 0.45 * pop);
  g.save();
  g.translate(at[0], at[1] - 0.045 * pop);
  g.scale(1, p.eyeMorph);
  g.strokeStyle = C.eye;
  g.lineCap = "round";
  const closedLine = () => {
    g.lineWidth = 0.014;
    g.beginPath();
    g.arc(0, -ry * 0.25, rx * 0.85, 0.35, Math.PI - 0.35);
    g.stroke();
  };
  switch (shape) {
    case "round": {
      const open = clamp(p.eyeOpen, 0, 1);
      const lidAmt = Math.max(p.lid, 1 - open, side < 0 ? p.wink : 0);
      if (lidAmt > 0.9) {
        closedLine();
        break;
      }
      const outer = side; // the outer corner is away from the other eye
      const lid = (x: number) => -ry + 2 * ry * lidAmt + p.eyeTilt * ry * 0.7 * (1 + (x * outer) / rx) * 0.5;
      const ball = new Path2D();
      ball.ellipse(0, 0, rx, ry, 0, 0, TAU);
      g.fillStyle = "#FFFFFF";
      g.fill(ball);
      g.save();
      g.clip(ball);
      // Bloodshot squiggles in a big fright (kept light).
      if (pop > 0.6 && f.detail > 0.4) {
        g.strokeStyle = `rgba(226,110,110,${0.55 * Math.min(1, pop - 0.6) * 2})`;
        g.lineWidth = 0.004;
        g.beginPath();
        for (const dy of [-0.3, 0.25]) {
          g.moveTo(outer * rx, dy * ry);
          g.lineTo(outer * rx * 0.7, dy * ry + 0.008);
          g.lineTo(outer * rx * 0.5, dy * ry - 0.004);
        }
        g.stroke();
      }
      // A small dot pupil, looking a little toward his nose, following the gaze.
      const pr = 0.0145 * s * p.pupil;
      const px = clamp(0.25 + p.gazeX * 0.75, -1, 1) * rx * 0.55;
      const py = clamp(p.gazeY, -1, 1) * ry * 0.45 + ry * 0.05;
      g.fillStyle = C.eye;
      g.beginPath();
      g.arc(px, py, Math.max(0.006, pr), 0, TAU);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.beginPath();
      g.arc(px - pr * 0.35, py - pr * 0.4, Math.max(0.002, pr * 0.32), 0, TAU);
      g.fill();
      // Heavy upper lid.
      if (lidAmt > 0.01 || p.eyeTilt > 0.01) {
        g.fillStyle = C.fur;
        g.beginPath();
        g.moveTo(-2 * rx, -2 * ry);
        g.lineTo(2 * rx, -2 * ry);
        g.lineTo(2 * rx, lid(2 * rx));
        g.lineTo(-2 * rx, lid(-2 * rx));
        g.closePath();
        g.fill();
        g.lineWidth = 0.011;
        g.beginPath();
        g.moveTo(-2 * rx, lid(-2 * rx));
        g.lineTo(2 * rx, lid(2 * rx));
        g.stroke();
      }
      g.restore();
      g.lineWidth = 0.009;
      g.stroke(ball);
      drawBrow(g, p, side, rx, ry);
      break;
    }
    case "happy":
      g.lineWidth = 0.015;
      g.beginPath();
      g.arc(0, ry * 0.35, rx * 0.8, Math.PI + 0.35, TAU - 0.35);
      g.stroke();
      drawBrow(g, p, side, rx, ry);
      break;
    case "closed":
      closedLine();
      break;
    case "spiral":
      g.fillStyle = "#FFFFFF";
      g.beginPath();
      g.ellipse(0, 0, rx, ry, 0, 0, TAU);
      g.fill();
      g.lineWidth = 0.009;
      g.stroke();
      g.lineWidth = 0.008;
      g.rotate(f.t * 7 * side);
      g.beginPath();
      for (let a = 0; a <= 4 * Math.PI; a += 0.25) {
        const r = (rx * 0.85 * a) / (4 * Math.PI);
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.stroke();
      break;
  }
  g.restore();
}

/** A little brow above an eye: worried (inner end up), calm, or determined. */
function drawBrow(g: CanvasRenderingContext2D, p: Pose, side: -1 | 1, rx: number, ry: number) {
  const inner = -side; // toward the other eye
  const y = -ry - 0.022 - 0.02 * p.browUp;
  const ix = inner * rx * 0.55, ox = -inner * rx * 0.6;
  const iy = y - 0.024 * p.brow, oy = y + 0.008 * p.brow;
  g.strokeStyle = C.brow;
  g.lineWidth = 0.013;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(ix, iy);
  g.quadraticCurveTo((ix + ox) / 2, (iy + oy) / 2 - 0.01, ox, oy);
  g.stroke();
}

/** The big round glossy button nose (never a wedge). */
function drawNose(g: CanvasRenderingContext2D, x: number, y: number) {
  const ng = g.createRadialGradient(x - 0.015, y - 0.016, 0.004, x, y, 0.055);
  ng.addColorStop(0, "#7A4E3E");
  ng.addColorStop(1, C.nose);
  g.fillStyle = ng;
  g.beginPath();
  g.arc(x, y, 0.05, 0, TAU);
  g.fill();
  g.strokeStyle = C.line;
  g.lineWidth = 0.007;
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.8)";
  g.beginPath();
  g.ellipse(x - 0.017, y - 0.018, 0.014, 0.009, -0.5, 0, TAU);
  g.fill();
}

/** The wide rubbery mouth along the bottom of the muzzle. */
function drawMouth(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  const back: Pt = [0.045, 0.074];
  const front: Pt = [0.225, 0.084];
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = C.line;
  const o = p.mouthO;
  if (o > 0.04) {
    // Open: the jaw drops. Wide open, a row of blocky teeth top and bottom and a flapping tongue.
    const D = 0.17 * o;
    const m = new Path2D();
    m.moveTo(front[0], front[1]);
    m.quadraticCurveTo(0.14, 0.095, back[0], back[1]);
    m.bezierCurveTo(0.05, back[1] + D * 0.8, 0.11, back[1] + D * 1.15, 0.16, back[1] + D);
    m.quadraticCurveTo(0.22, front[1] + D * 0.6, front[0], front[1]);
    m.closePath();
    g.fillStyle = C.mouth;
    g.fill(m);
    g.save();
    g.clip(m);
    const flap = p.tongue * 0.018 * Math.sin(f.t * 34);
    g.fillStyle = C.tongue;
    g.beginPath();
    g.ellipse(0.13 + flap, back[1] + D * 0.95, 0.055, 0.03 + 0.25 * D, 0.1 + flap * 4, 0, TAU);
    g.fill();
    if (p.teeth > 0.01 && o > 0.35) {
      g.fillStyle = "#FFFFFF";
      g.strokeStyle = C.line;
      g.lineWidth = 0.004;
      const h = 0.024 * p.teeth;
      for (const x of [0.07, 0.105, 0.14, 0.175]) {
        g.beginPath();
        g.rect(x - 0.015, lerp(back[1], front[1], (x - 0.045) / 0.18) - 0.004, 0.03, h);
        g.fill();
        g.stroke();
      }
      for (const x of [0.1, 0.135, 0.17]) {
        const by = back[1] + D * lerp(1.05, 0.75, (x - 0.09) / 0.1);
        g.beginPath();
        g.rect(x - 0.015, by - h, 0.03, h + 0.01);
        g.fill();
        g.stroke();
      }
    }
    g.restore();
    g.lineWidth = 0.009;
    g.strokeStyle = C.line;
    g.stroke(m);
  } else if (p.grin > 0.04) {
    // A clenched, chattering grin of teeth.
    const chatter = 0.004 * Math.sin(f.t * 55) * p.grin;
    const h = 0.03 * p.grin;
    g.translate(0, chatter);
    const strip = new Path2D();
    strip.moveTo(back[0] + 0.01, back[1] - 0.004);
    strip.quadraticCurveTo(0.14, 0.088, front[0], front[1] - 0.004);
    strip.lineTo(front[0] - 0.01, front[1] + h * 0.8);
    strip.quadraticCurveTo(0.14, 0.088 + h * 1.1, back[0] + 0.015, back[1] + h * 0.7);
    strip.closePath();
    g.fillStyle = "#FFFFFF";
    g.fill(strip);
    g.save();
    g.clip(strip);
    g.lineWidth = 0.004;
    g.beginPath();
    for (let x = 0.075; x < 0.22; x += 0.03) {
      g.moveTo(x, 0.06);
      g.lineTo(x, 0.13);
    }
    g.moveTo(0.04, 0.09 + h * 0.35);
    g.lineTo(0.24, 0.094 + h * 0.35);
    g.stroke();
    g.restore();
    g.lineWidth = 0.008;
    g.stroke(strip);
  } else if (p.whistle > 0.05) {
    // A puckered little "o".
    g.lineWidth = 0.009;
    g.beginPath();
    g.moveTo(back[0], back[1]);
    g.quadraticCurveTo(0.13, 0.086, 0.19, 0.088);
    g.stroke();
    g.fillStyle = C.mouth;
    g.beginPath();
    g.arc(0.205, 0.094, 0.013 * p.whistle, 0, TAU);
    g.fill();
    g.stroke();
  } else {
    // The wide line of a mouth, its back corner turning up or down.
    const c = p.mouthCurve;
    g.lineWidth = 0.01;
    g.beginPath();
    g.moveTo(front[0], front[1]);
    g.quadraticCurveTo(0.13, 0.092 + 0.012 * c, back[0], back[1] - 0.022 * c);
    g.stroke();
  }
  // Tongue lolling out of a closed or half-open mouth.
  if (p.tongue > 0.05 && o < 0.4) {
    const sway = 0.012 * Math.sin(f.t * 9);
    g.fillStyle = C.tongue;
    g.strokeStyle = C.line;
    g.lineWidth = 0.007;
    g.beginPath();
    g.ellipse(0.19 + sway, 0.1 + 0.02 * p.tongue, 0.018, 0.028 * p.tongue, 0.2, 0, TAU);
    g.fill();
    g.stroke();
  }
  g.restore();
}

/** The scarf pulled over his head like a hood; his eyes peek out from under it. */
function drawHood(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  const k = clamp(p.hide, 0, 1);
  const hood = new Path2D();
  hood.moveTo(-0.17, 0.17);
  hood.bezierCurveTo(-0.28, 0.0, -0.23, -0.21, -0.06, -0.235);
  hood.bezierCurveTo(0.09, -0.255, 0.18, -0.19, 0.17, -0.13);
  hood.quadraticCurveTo(0.09, -0.165, 0.02, -0.15);
  hood.quadraticCurveTo(-0.08, -0.14, -0.115, -0.04);
  hood.quadraticCurveTo(-0.125, 0.07, -0.08, 0.17);
  hood.closePath();
  g.save();
  // Pulled up from his neck: revealed from the bottom.
  g.beginPath();
  g.rect(-0.4, lerp(0.25, -0.32, k), 0.8, 0.8);
  g.clip();
  g.fillStyle = C.scarf;
  g.fill(hood);
  g.save();
  g.clip(hood);
  g.strokeStyle = C.scarfLight;
  g.lineWidth = 0.032;
  g.beginPath();
  for (const y of [-0.15, -0.06, 0.03, 0.12]) {
    g.moveTo(-0.3, y + 0.04);
    g.quadraticCurveTo(-0.05, y - 0.04, 0.2, y - 0.02);
  }
  g.stroke();
  if (f.detail > 0.35) {
    g.strokeStyle = `rgba(20,80,76,${0.18 * f.detail})`;
    g.lineWidth = 0.004;
    g.beginPath();
    for (let x = -0.28; x <= 0.2; x += 0.024) {
      g.moveTo(x, -0.3);
      g.lineTo(x + 0.04, 0.2);
    }
    g.stroke();
  }
  g.restore();
  g.strokeStyle = C.scarfDark;
  g.lineWidth = 0.01;
  g.stroke(hood);
  // The rolled front edge.
  g.strokeStyle = "rgba(190,235,228,0.75)";
  g.lineWidth = 0.012;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(0.16, -0.14);
  g.quadraticCurveTo(0.09, -0.172, 0.02, -0.16);
  g.quadraticCurveTo(-0.07, -0.15, -0.105, -0.05);
  g.stroke();
  g.restore();
}

// ── Scarf ─────────────────────────────────────────────────────────────────────

/** The chunky band round his thin neck, with the knot at the back. */
function drawScarfBand(g: CanvasRenderingContext2D, p: Pose, nb: Pt, f: Frame) {
  const k = 1 - clamp(p.hide, 0, 1) * 0.5;
  g.save();
  g.translate(nb[0] + 0.012, nb[1] - 0.035);
  g.rotate(p.hunch * 0.6 - 0.05);
  const band = new Path2D();
  band.ellipse(0, 0, 0.082, 0.042 * k + 0.012, 0, 0, TAU);
  g.fillStyle = C.scarf;
  g.fill(band);
  g.save();
  g.clip(band);
  g.strokeStyle = C.scarfLight;
  g.lineWidth = 0.026;
  g.beginPath();
  for (const x of [-0.045, 0.015, 0.07]) {
    g.moveTo(x, -0.07);
    g.quadraticCurveTo(x + 0.012, 0, x, 0.07);
  }
  g.stroke();
  if (f.detail > 0.35) {
    g.strokeStyle = `rgba(20,80,76,${0.2 * f.detail})`;
    g.lineWidth = 0.004;
    g.beginPath();
    for (let x = -0.08; x <= 0.08; x += 0.02) {
      g.moveTo(x, -0.06);
      g.lineTo(x, 0.06);
    }
    g.stroke();
  }
  g.restore();
  g.strokeStyle = C.scarfDark;
  g.lineWidth = 0.009;
  g.stroke(band);
  // The knot, at the back.
  g.fillStyle = C.scarf;
  g.beginPath();
  g.ellipse(-0.07, 0.012, 0.034, 0.03, 0.3, 0, TAU);
  g.fill();
  g.stroke();
  g.lineWidth = 0.006;
  g.beginPath();
  g.moveTo(-0.08, -0.004);
  g.quadraticCurveTo(-0.068, 0.012, -0.076, 0.03);
  g.stroke();
  g.restore();
}

/** The long trailing end: hangs down his back, flies out behind him like a flag. */
function drawScarfEnd(g: CanvasRenderingContext2D, p: Pose, nb: Pt, f: Frame) {
  const knot: Pt = [nb[0] - 0.06, nb[1] - 0.02];
  const fly = clamp(p.flag + Math.abs(p.lagX) * 5, 0, 1);
  const hang: Pt = [-0.42, 1];
  const out: Pt = [-1, -0.12];
  const dir = mix(hang, out, fly);
  const dl = Math.hypot(dir[0], dir[1]);
  const dx = dir[0] / dl, dy = dir[1] / dl;
  const L = 0.34;
  const N = 14;
  const amp = 0.006 + 0.022 * fly;
  const pts: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    const s = k / N;
    const wave = amp * Math.sin(s * 7 - f.t * 12) * s;
    pts.push([
      knot[0] + dx * L * s - dy * wave - p.lagX * 0.6 * s * s,
      knot[1] + dy * L * s + dx * wave + p.lagY * 0.3 * s * s,
    ]);
  }
  const half = (s: number) => 0.03 - 0.004 * s;
  const normal = (k: number): Pt => {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(N, k + 1)];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    return [-ey / len, ex / len];
  };
  const ribbon = (k0: number, k1: number) => {
    const q = new Path2D();
    for (let k = k0; k <= k1; k++) {
      const [nx, ny] = normal(k);
      const h = half(k / N);
      if (k === k0) q.moveTo(pts[k][0] + nx * h, pts[k][1] + ny * h);
      else q.lineTo(pts[k][0] + nx * h, pts[k][1] + ny * h);
    }
    for (let k = k1; k >= k0; k--) {
      const [nx, ny] = normal(k);
      const h = half(k / N);
      q.lineTo(pts[k][0] - nx * h, pts[k][1] - ny * h);
    }
    q.closePath();
    return q;
  };
  g.save();
  const whole = ribbon(0, N);
  g.fillStyle = C.scarf;
  g.fill(whole);
  // Four light stripes; with WORKING progress they knit up gold from the knot out.
  const lit = clamp(p.fill, 0, 1) * 4;
  for (let j = 0; j < 4; j++) {
    const k0 = 2 + j * 3;
    g.fillStyle = j + 1 <= lit + 1e-6 ? C.scarfDone : C.scarfLight;
    g.fill(ribbon(k0, k0 + 1));
  }
  g.strokeStyle = C.scarfDark;
  g.lineWidth = 0.009;
  g.lineJoin = "round";
  g.stroke(whole);
  // Fringe.
  const [nx, ny] = normal(N);
  const tdx = pts[N][0] - pts[N - 1][0], tdy = pts[N][1] - pts[N - 1][1];
  const tl = Math.hypot(tdx, tdy) || 1;
  g.strokeStyle = C.scarf;
  g.lineWidth = 0.009;
  g.lineCap = "round";
  g.beginPath();
  for (let j = -2; j <= 2; j++) {
    const fx = pts[N][0] + nx * j * 0.012, fy = pts[N][1] + ny * j * 0.012;
    g.moveTo(fx, fy);
    g.lineTo(fx + (tdx / tl) * 0.03, fy + (tdy / tl) * 0.03);
  }
  g.stroke();
  g.restore();
}

// ── Asleep ────────────────────────────────────────────────────────────────────

/** Curled up on the ground under the scarf, head on his paws, dreaming. */
function drawCurled(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  const d = p.dream;
  const paddle = 0.014 * d * Math.sin(f.t * 14);

  // Back foot and the curled body.
  g.save();
  g.fillStyle = C.furLight;
  g.strokeStyle = C.line;
  g.lineWidth = 0.008;
  g.beginPath();
  g.ellipse(-0.3 + paddle, -0.018, 0.045, 0.022, 0, 0, TAU);
  g.fill();
  g.stroke();
  const body = bean(-0.11, -0.13, 0.22, 0.13, 0.12, 0, 0, 5);
  const bg = g.createRadialGradient(-0.14, -0.19, 0.01, -0.11, -0.13, 0.24);
  bg.addColorStop(0, C.furLight);
  bg.addColorStop(0.6, C.fur);
  bg.addColorStop(1, C.furShade);
  g.fillStyle = bg;
  g.fill(body);
  g.stroke(body);
  g.restore();

  // Tail curled round the front.
  g.save();
  noodle(g, hose([-0.3, -0.06], [-0.02, -0.012], 0.25), 0.02);
  g.fillStyle = C.ear;
  g.strokeStyle = C.line;
  g.lineWidth = 0.007;
  g.beginPath();
  g.ellipse(0.0, -0.014, 0.028, 0.012, 0, 0, TAU);
  g.fill();
  g.stroke();
  g.restore();

  // The scarf (or the outfit) spread over him like a blanket.
  const bl = new Path2D();
  bl.moveTo(-0.35, -0.03);
  bl.bezierCurveTo(-0.37, -0.17, -0.26, -0.27, -0.11, -0.265);
  bl.bezierCurveTo(0.0, -0.26, 0.06, -0.2, 0.05, -0.13);
  bl.quadraticCurveTo(0.0, -0.08, 0.02, -0.025);
  bl.quadraticCurveTo(-0.16, -0.005, -0.35, -0.03);
  bl.closePath();
  if (outfit === "cozy") drawScarfBlanket(g, bl);
  else drawBlanket(g, bl, f);

  // A pillow under his head, in his pyjamas.
  if (outfit === "pyjamas") drawPillow(g);

  // Front paws under his chin, paddling when he dreams.
  g.save();
  g.fillStyle = C.furLight;
  g.strokeStyle = C.line;
  g.lineWidth = 0.008;
  for (const [x, ph] of [[0.12, 0], [0.18, 2]] as const) {
    g.beginPath();
    g.ellipse(x + 0.014 * d * Math.sin(f.t * 14 + ph), -0.022, 0.034, 0.02, 0, 0, TAU);
    g.fill();
    g.stroke();
  }
  g.restore();

  // Head resting on them.
  g.save();
  g.translate(0.13, -0.14);
  g.rotate(0.2);
  g.scale(1.1, 1.1);
  drawHead(g, { ...p, pop: 0, earL: Math.min(p.earL, 0.4), earR: Math.min(p.earR, 0.4), hide: 0 }, "closed", f);
  g.restore();
}

/** The scarf spread over him like a blanket, fringe hanging down at the back. */
function drawScarfBlanket(g: CanvasRenderingContext2D, bl: Path2D) {
  g.save();
  g.fillStyle = C.scarf;
  g.fill(bl);
  g.save();
  g.clip(bl);
  g.strokeStyle = C.scarfLight;
  g.lineWidth = 0.03;
  g.beginPath();
  for (const x of [-0.27, -0.18, -0.09, 0.0]) {
    g.moveTo(x - 0.03, -0.29);
    g.quadraticCurveTo(x + 0.03, -0.12, x, 0.02);
  }
  g.stroke();
  g.restore();
  g.strokeStyle = C.scarfDark;
  g.lineWidth = 0.009;
  g.stroke(bl);
  g.strokeStyle = C.scarf;
  g.lineCap = "round";
  g.beginPath();
  for (let j = 0; j < 4; j++) {
    g.moveTo(-0.33 + j * 0.016, -0.03 + j * 0.002);
    g.lineTo(-0.335 + j * 0.016, -0.004 + j * 0.002);
  }
  g.stroke();
  g.restore();
}

// ── Overlays ──────────────────────────────────────────────────────────────────

function drawOverlays(g: CanvasRenderingContext2D, p: Pose, hc: Pt, f: Frame) {
  const [hx, hy] = hc;

  // Fright lines bursting out round his head.
  if (p.shock > 0.01) {
    const k = clamp(p.shock, 0, 1);
    g.save();
    g.strokeStyle = `rgba(110,76,40,${0.9 * k})`;
    g.lineWidth = 0.014;
    g.lineCap = "round";
    g.beginPath();
    for (const deg of [-70, -45, -20, 25, 50]) {
      const a = deg * DEG;
      const r0 = 0.29, r1 = 0.29 + 0.07 * k;
      g.moveTo(hx + Math.sin(a) * r0, hy - Math.cos(a) * r0);
      g.lineTo(hx + Math.sin(a) * r1, hy - Math.cos(a) * r1);
    }
    g.stroke();
    g.restore();
  }

  // Sweat flying off his head.
  if (p.sweat > 0.01 && p.sweat < 0.99) {
    const k = p.sweat;
    for (const [vx, vy, delay] of [[0.3, -0.22, 0], [-0.26, -0.18, 0.15]] as const) {
      const q = clamp((k - delay) / (1 - delay), 0, 1);
      if (q <= 0 || q >= 1) continue;
      const x = hx - 0.04 + vx * q * 0.6;
      const y = hy - 0.2 + vy * q * 0.6 + 0.35 * q * q;
      drawDrop(g, x, y, Math.atan2(vy + 0.7 * q, vx), 1 - q);
    }
  }

  // A whistled note floating up from his lips.
  if (p.note > 0.01) {
    const k = clamp(p.note, 0, 1);
    drawNote(g, hx + 0.36 + 0.04 * Math.sin(k * 9), hy + 0.04 - 0.2 * k, Math.sin(Math.PI * k));
  }

  // Music leaking out of his headphones.
  if (p.music > 0.01 && outfit === "coder") {
    for (const [dx, delay] of [[0, 0], [0.07, 0.5]] as const) {
      const k = (p.music + delay) % 1;
      drawNote(g, hx - 0.17 + dx - 0.05 * k, hy - 0.1 - 0.22 * k + 0.02 * Math.sin(k * 12), Math.sin(Math.PI * k));
    }
  }

  // Muttering to himself: a tiny bubble full of scribble.
  if (p.mutter > 0.01) {
    g.save();
    g.globalAlpha *= clamp(p.mutter, 0, 1);
    g.translate(hx + 0.32, hy - 0.24);
    g.fillStyle = "#FFFFFF";
    g.strokeStyle = C.line;
    g.lineWidth = 0.008;
    g.beginPath();
    g.roundRect(-0.07, -0.04, 0.14, 0.08, 0.035);
    g.moveTo(-0.045, 0.035);
    g.lineTo(-0.075, 0.075);
    g.lineTo(-0.02, 0.04);
    g.fill();
    g.stroke();
    g.lineWidth = 0.006;
    g.beginPath();
    const ph = Math.floor(f.t * 6);
    for (let k = 0; k < 7; k++) {
      const x = -0.05 + k * 0.016;
      const y = (hash01(k + ph) - 0.5) * 0.03;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.restore();
  }

  // A "?" above his head.
  if (p.qmark > 0.01) {
    g.save();
    // (Asking, in the chef's tall hat, it moves out in front of it.)
    const aside = outfit === "chef" ? 0.2 * clamp(p.chin, 0, 1) : 0;
    g.translate(hx + 0.04 + aside, hy - 0.36 + 0.01 * Math.sin(f.t * 3) + 0.3 * aside);
    g.scale(p.qmark, p.qmark);
    g.rotate(0.15);
    g.strokeStyle = outfit === "cozy" ? C.scarfDark : markColour();
    g.lineWidth = 0.024;
    g.lineCap = "round";
    g.beginPath();
    g.arc(0, -0.035, 0.035, Math.PI * 1.05, Math.PI * 2.45);
    g.quadraticCurveTo(0.003, 0.01, 0.0, 0.03);
    g.stroke();
    g.fillStyle = outfit === "cozy" ? C.scarfDark : markColour();
    g.beginPath();
    g.arc(0, 0.065, 0.014, 0, TAU);
    g.fill();
    g.restore();
  }

  // A "!" above his head: found it!
  if (p.excl > 0.01) {
    const col = outfit === "cozy" ? C.scarfDark : markColour();
    g.save();
    g.translate(hx + (outfit === "chef" ? 0.27 : 0.08), hy - (outfit === "chef" ? 0.32 : 0.4));
    g.scale(p.excl, p.excl);
    g.rotate(0.12);
    g.strokeStyle = col;
    g.lineWidth = 0.03;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(0, -0.075);
    g.lineTo(0, 0.02);
    g.stroke();
    g.fillStyle = col;
    g.beginPath();
    g.arc(0, 0.062, 0.018, 0, TAU);
    g.fill();
    g.restore();
  }
}

/** A little music note. */
function drawNote(g: CanvasRenderingContext2D, x: number, y: number, alpha: number) {
  g.save();
  g.globalAlpha *= alpha;
  g.translate(x, y);
  g.rotate(0.15);
  g.fillStyle = C.line;
  g.strokeStyle = C.line;
  g.lineWidth = 0.008;
  g.beginPath();
  g.ellipse(0, 0, 0.018, 0.013, -0.4, 0, TAU);
  g.fill();
  g.beginPath();
  g.moveTo(0.016, -0.004);
  g.lineTo(0.016, -0.065);
  g.quadraticCurveTo(0.04, -0.05, 0.036, -0.03);
  g.stroke();
  g.restore();
}

function drawDrop(g: CanvasRenderingContext2D, x: number, y: number, a: number, alpha: number) {
  g.save();
  g.globalAlpha *= alpha;
  g.translate(x, y);
  g.rotate(a + Math.PI / 2);
  const d = new Path2D();
  d.moveTo(0, -0.032);
  d.bezierCurveTo(0.01, -0.012, 0.02, 0, 0.02, 0.01);
  d.arc(0, 0.01, 0.02, 0, Math.PI);
  d.bezierCurveTo(-0.02, 0, -0.01, -0.012, 0, -0.032);
  d.closePath();
  g.fillStyle = C.sweat;
  g.fill(d);
  g.strokeStyle = C.sweatEdge;
  g.lineWidth = 0.006;
  g.stroke(d);
  g.restore();
}

// ── Working props (body space) ────────────────────────────────────────────────
// The book and magnifying glass, the push button, the binoculars and the sign,
// in his own palette (the detective's glass is his own). They're held where
// his paws are; binoculars, the sign and his chin move his paws to them instead.

/** A point in head space (as drawHead draws it) in body space. */
function headPt(p: Pose, hc: Pt, x: number, y: number): Pt {
  const c = Math.cos(p.headTilt), s = Math.sin(p.headTilt);
  return [hc[0] + HEAD_SCALE * (x * c - y * s), hc[1] + HEAD_SCALE * (x * s + y * c)];
}

/** Where a held prop is: its origin and turn (body space). */
interface Held { at: Pt; rot: number }

/** A point in a held prop's own space, scaled by `s`. */
function inHeld(h: Held, x: number, y: number, s: number): Pt {
  const c = Math.cos(h.rot), sn = Math.sin(h.rot);
  return [h.at[0] + s * (x * c - y * sn), h.at[1] + s * (x * sn + y * c)];
}

interface WorkPaws { L: Pt; R: Pt; bino: Held; sign: Held }

/** His paws as drawn, and where the binoculars and the sign are. */
function workPaws(p: Pose, hc: Pt): WorkPaws {
  let L: Pt = [p.pawLX, p.pawLY];
  let R: Pt = [p.pawRX, p.pawRY];
  // Binoculars: at his eyes, or lowered to his chest and tipped down.
  const drop = clamp(p.binoDrop, 0, 1);
  const bino: Held = { at: mix(headPt(p, hc, 0.03, -0.068), headPt(p, hc, 0.07, 0.25), drop), rot: p.headTilt + 0.45 * drop };
  const b = smoothstep(0, 1, clamp(p.bino, 0, 1));
  if (b > 0) {
    L = mix(L, inHeld(bino, -0.05, 0.08, HEAD_SCALE), b);
    R = mix(R, inHeld(bino, 0.12, 0.085, HEAD_SCALE), b);
  }
  // The sign hangs off his far paw (its lower back corner); the near paw holds its front edge, or taps the "!".
  const sign: Held = { at: L, rot: p.signTilt };
  const s = clamp(p.sign, 0, 1);
  if (s > 0) {
    const grip = inHeld(sign, 0.245, -0.03, SIGN_S);
    const tap = inHeld(sign, 0.205, -0.115 - 0.03 * p.signKnock, SIGN_S);
    R = mix(R, mix(grip, tap, clamp(p.signTap, 0, 1)), s);
  }
  // A paw at his chin, tapping it.
  const c = clamp(p.chin, 0, 1);
  if (c > 0) R = mix(R, headPt(p, hc, 0.125, 0.13 + 0.018 * p.chinTap), c);
  return { L, R, bino, sign };
}

/** Draws the working props; true if his far paw holds one (so its mitt goes on top). */
function drawWorkProps(g: CanvasRenderingContext2D, p: Pose, w: WorkPaws, f: Frame): boolean {
  let held = false;
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  if (p.book > 0.01) {
    drawBook(g, p, w.L, f);
    held = true;
  }
  if (p.lens > 0.01) drawLens(g, p, w.R, f);
  if (p.sign > 0.01) {
    drawSign(g, p, w.sign, f);
    held = true;
  }
  if (p.bino > 0.01) {
    drawBinoculars(g, p, w.bino, f);
    held = true;
  }
  g.restore();
  return held;
}

/** The book's cover (one that doesn't match the outfit's own colours). */
const COVER: Partial<Record<OutfitName, string>> = { hero: "#3D5A99", chef: "#3D5A99", desi: "#2F7A6B", rainy: "#3D5A99" };
const PAGE = "#FFFCF0";
const INK = "rgba(110,90,70,0.5)";

/** An open book held up in his far paw, its pages towards him; a page turning over (`page`). */
function drawBook(g: CanvasRenderingContext2D, p: Pose, paw: Pt, f: Frame) {
  const k = clamp(p.book, 0, 1.2);
  const W = 0.13, H = 0.072, V = 0.022;
  g.save();
  g.translate(paw[0] + 0.13, paw[1] - 0.05);
  g.rotate(-0.1);
  g.scale(1.25 * k, 1.25 * k);
  paint(g, poly([[-W - 0.014, -H + 0.008], [0, -H + V + 0.006], [W + 0.014, -H + 0.008], [W + 0.014, H + 0.016], [0, H + V + 0.02], [-W - 0.014, H + 0.016]]), COVER[outfit] ?? "#B5473A", 0.008);
  /** A page from the spine to its free edge at `x`, lifted off the book by `lift`. */
  const leaf = (x: number, lift = 0) => {
    const q = new Path2D();
    q.moveTo(0, -H + V);
    q.quadraticCurveTo(x * 0.5, -H - 0.014 - lift, x, -H - lift * 0.6);
    q.lineTo(x, H - lift * 0.6);
    q.quadraticCurveTo(x * 0.5, H - 0.004 - lift, 0, H + V);
    q.closePath();
    return q;
  };
  const lines = (q: Path2D, x: number, lift = 0) => {
    g.save();
    g.clip(q);
    g.strokeStyle = INK;
    g.lineWidth = f.detail > 0.3 ? 0.008 : 0.014;
    g.beginPath();
    for (const y of f.detail > 0.3 ? [-0.042, -0.016, 0.01, 0.036] : [-0.028, 0.016]) {
      g.moveTo(Math.sign(x) * 0.02, y + V * 0.7 - lift * 0.5);
      g.quadraticCurveTo(x * 0.5, y - 0.006 - lift, x - Math.sign(x) * 0.018, y + 0.002 - lift * 0.6);
    }
    g.stroke();
    g.restore();
  };
  for (const x of [-W, W]) {
    const q = leaf(x);
    paint(g, q, PAGE, 0.006);
    lines(q, x);
  }
  // The page turning over, right to left.
  const turn = clamp(p.page, 0, 1);
  if (turn > 0.01 && turn < 0.99) {
    const x = W * Math.cos(Math.PI * turn);
    const lift = 0.05 * Math.sin(Math.PI * turn);
    const q = leaf(x, lift);
    paint(g, q, x > 0 ? PAGE : "#F1E9D2", 0.006);
    if (Math.abs(x) > 0.04) lines(q, x, lift);
  }
  g.strokeStyle = C.line;
  g.lineWidth = 0.006;
  g.beginPath();
  g.moveTo(0, -H + V);
  g.lineTo(0, H + V);
  g.stroke();
  g.restore();
}

/** The magnifying glass over his book (the detective's own, in his colours), in his near paw. */
function drawLens(g: CanvasRenderingContext2D, p: Pose, paw: Pt, f: Frame) {
  const k = clamp(p.lens, 0, 1.2);
  const det = outfit === "detective";
  const lc: Pt = [-0.125, -0.07];
  const r = 0.058;
  g.save();
  g.translate(paw[0], paw[1]);
  g.scale(k, k);
  noodle(g, hose([0.006, 0.018], [lc[0] + 0.022, lc[1] + r - 0.006], 0), 0.018, det ? K("handle") : "#6B4526");
  const lens = new Path2D();
  lens.arc(lc[0], lc[1], r, 0, TAU);
  // The page through it: its lines, big.
  g.save();
  g.clip(lens);
  g.fillStyle = "rgba(255,252,240,0.6)";
  g.fill(lens);
  g.strokeStyle = "rgba(110,90,70,0.6)";
  g.lineWidth = 0.017;
  g.beginPath();
  for (const y of [-0.026, 0.016]) {
    g.moveTo(lc[0] - r, lc[1] + y + 0.008);
    g.lineTo(lc[0] + r, lc[1] + y - 0.004);
  }
  g.stroke();
  g.restore();
  g.fillStyle = "rgba(207,232,242,0.3)";
  g.fill(lens);
  g.strokeStyle = C.line;
  g.lineWidth = 0.024;
  g.stroke(lens);
  g.strokeStyle = det ? K("brass") : "#C9A04A";
  g.lineWidth = 0.013;
  g.stroke(lens);
  if (f.detail > 0.2) {
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 0.008;
    g.beginPath();
    g.arc(lc[0], lc[1], r - 0.016, -2.6, -1.8);
    g.stroke();
  }
  g.restore();
}

/** The big red push button on its post, its cap pushed down (`press`), its lamp blinking (`lamp`). Ground space. */
function drawButton(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  const k = clamp(p.button, 0, 1.2) * BUTTON_S;
  const top = -BUTTON_H / BUTTON_S;
  g.save();
  g.translate(BUTTON_X, 0);
  g.scale(k, k);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.fillStyle = "rgba(90,62,28,0.22)";
  g.beginPath();
  g.ellipse(0, 0, 0.12, 0.022, 0, 0, TAU);
  g.fill();
  // Foot, post and the box on top.
  const foot = new Path2D();
  foot.ellipse(0, -0.006, 0.075, 0.02, 0, 0, TAU);
  paint(g, foot, "#4A505A", 0.008);
  const post = new Path2D();
  post.rect(-0.022, top + 0.07, 0.044, -top - 0.076);
  const pg = g.createLinearGradient(-0.022, 0, 0.022, 0);
  pg.addColorStop(0, "#7C8492");
  pg.addColorStop(1, "#4F5561");
  paint(g, post, pg, 0.008);
  const box = new Path2D();
  box.roundRect(-0.105, top, 0.21, 0.085, 0.02);
  paint(g, box, "#4A505A", 0.009);
  // Hazard stripes along its front.
  g.save();
  g.clip(box);
  g.fillStyle = "#F2C230";
  g.fillRect(-0.11, top + 0.04, 0.22, 0.028);
  g.fillStyle = "#2E3138";
  for (let x = -0.14; x < 0.12; x += 0.04) g.fill(poly([[x, top + 0.068], [x + 0.018, top + 0.04], [x + 0.036, top + 0.04], [x + 0.018, top + 0.068]]));
  g.restore();
  g.strokeStyle = C.line;
  g.lineWidth = 0.009;
  g.stroke(box);
  const lid = new Path2D();
  lid.ellipse(0, top + 0.004, 0.1, 0.02, 0, 0, TAU);
  paint(g, lid, "#68707C", 0.007);
  // The lamp on its back corner: lit while the command runs.
  const lamp = clamp(p.lamp, 0, 1);
  if (lamp > 0.05) {
    const glow = g.createRadialGradient(-0.07, top - 0.006, 0, -0.07, top - 0.006, 0.07);
    glow.addColorStop(0, `rgba(255,214,90,${0.55 * lamp})`);
    glow.addColorStop(1, "rgba(255,214,90,0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(-0.07, top - 0.006, 0.07, 0, TAU);
    g.fill();
  }
  dot(g, -0.07, top - 0.006, 0.021, lamp > 0.5 ? "#FFD34E" : lamp > 0.05 ? "#C9A040" : "#7A5E2A", 0.006);
  // The collar and the big red cap.
  const ring = new Path2D();
  ring.ellipse(0.012, top - 0.002, 0.068, 0.017, 0, 0, TAU);
  paint(g, ring, "#2E3138", 0.006);
  const dy = 0.028 * clamp(p.press, 0, 1);
  const cap = new Path2D();
  cap.moveTo(-0.048, top - 0.004);
  cap.bezierCurveTo(-0.05, top - 0.072 + dy, 0.074, top - 0.072 + dy, 0.072, top - 0.004);
  cap.quadraticCurveTo(0.012, top + 0.016, -0.048, top - 0.004);
  cap.closePath();
  const cg = g.createRadialGradient(-0.005, top - 0.05 + dy, 0.005, 0.012, top - 0.02, 0.08);
  cg.addColorStop(0, "#FF7A5E");
  cg.addColorStop(0.5, "#E5412F");
  cg.addColorStop(1, "#B32A1E");
  paint(g, cap, cg, 0.009);
  if (f.detail > 0.2) {
    g.fillStyle = "rgba(255,255,255,0.6)";
    g.beginPath();
    g.ellipse(-0.008, top - 0.042 + dy * 0.8, 0.018, 0.008, -0.3, 0, TAU);
    g.fill();
  }
  g.restore();
}

/** Binoculars over his eyes (or lowered), two barrels pointing where he looks. In head units. */
function drawBinoculars(g: CanvasRenderingContext2D, p: Pose, h: Held, f: Frame) {
  const k = clamp(p.bino, 0, 1.2);
  g.save();
  g.translate(h.at[0], h.at[1]);
  g.rotate(h.rot);
  g.scale(HEAD_SCALE * k, HEAD_SCALE * k);
  const barrel = (x0: number, x1: number, y: number, r: number, body: string, light: string) => {
    const q = new Path2D();
    q.moveTo(x0, y - r);
    q.lineTo(x1, y - r * 0.94);
    q.ellipse(x1, y, r * 0.38, r * 0.94, 0, -Math.PI / 2, Math.PI / 2);
    q.lineTo(x0, y + r);
    q.ellipse(x0, y, r * 0.38, r, 0, Math.PI / 2, Math.PI * 1.5);
    q.closePath();
    const bg = g.createLinearGradient(0, y - r, 0, y + r);
    bg.addColorStop(0, light);
    bg.addColorStop(0.45, body);
    bg.addColorStop(1, body);
    paint(g, q, bg, 0.009);
    // The rubber grip round its middle.
    const gx = lerp(x0, x1, 0.42);
    g.strokeStyle = "rgba(255,255,255,0.14)";
    g.lineWidth = 0.022;
    g.beginPath();
    g.ellipse(gx, y, r * 0.38, r * 0.97, 0, -Math.PI / 2, Math.PI / 2);
    g.stroke();
    // The big front lens.
    const rim = new Path2D();
    rim.ellipse(x1, y, r * 0.38, r * 0.94, 0, 0, TAU);
    paint(g, rim, "#24262B", 0.007);
    const lens = new Path2D();
    lens.ellipse(x1 + 0.003, y, r * 0.26, r * 0.72, 0, 0, TAU);
    const lg = g.createRadialGradient(x1 - 0.004, y - r * 0.3, 0.002, x1, y, r * 0.8);
    lg.addColorStop(0, "#BFE4F5");
    lg.addColorStop(1, "#3F6F8E");
    g.fillStyle = lg;
    g.fill(lens);
    if (f.detail > 0.2) {
      g.fillStyle = "rgba(255,255,255,0.8)";
      g.beginPath();
      g.ellipse(x1 - 0.002, y - r * 0.38, r * 0.08, r * 0.18, 0, 0, TAU);
      g.fill();
    }
  };
  barrel(-0.085, 0.035, -0.022, 0.06, "#2C2F35", "#5A5F69");
  // The hinge between them.
  const hinge = new Path2D();
  hinge.roundRect(-0.02, -0.07, 0.06, 0.036, 0.014);
  paint(g, hinge, "#3A3E46", 0.007);
  barrel(0.012, 0.14, 0.006, 0.066, "#33363D", "#646a75");
  g.restore();
}

/** A card with a big "!" held up for you: hangs off his far paw (`h`). */
function drawSign(g: CanvasRenderingContext2D, p: Pose, h: Held, f: Frame) {
  const k = clamp(p.sign, 0, 1.2) * SIGN_S;
  const red = "#D2392F";
  g.save();
  g.translate(h.at[0], h.at[1]);
  g.rotate(h.rot);
  g.scale(k, k);
  const card = new Path2D();
  card.roundRect(-0.025, -0.18, 0.28, 0.19, 0.022);
  g.fillStyle = "rgba(90,62,28,0.18)";
  g.save();
  g.translate(0.008, 0.01);
  g.fill(card);
  g.restore();
  paint(g, card, PAGE, 0.009);
  if (f.detail > 0.3) {
    g.strokeStyle = "rgba(210,57,47,0.35)";
    g.lineWidth = 0.006;
    g.beginPath();
    g.roundRect(-0.008, -0.163, 0.246, 0.156, 0.014);
    g.stroke();
  }
  const cx = 0.115, cy = -0.085;
  g.strokeStyle = red;
  g.lineCap = "round";
  g.lineWidth = 0.036;
  g.beginPath();
  g.moveTo(cx, cy - 0.055);
  g.lineTo(cx - 0.002, cy + 0.02);
  g.stroke();
  g.fillStyle = red;
  g.beginPath();
  g.arc(cx - 0.003, cy + 0.06, 0.021, 0, TAU);
  g.fill();
  g.restore();
}

// ── Outfits ───────────────────────────────────────────────────────────────────
// Each outfit (dogesh-outfits.ts) draws its clothes into the same rig: sleeves
// along the noodle arms, trousers and boots on the legs, a top in torso space,
// a collar at the neck, headwear in head space, and its own way of hiding.

const NO_TONE = { color: "#888888", shade: "#666666" };
const tone = (k: string) => OUTFITS[outfit].cloth[k] ?? NO_TONE;
/** A cloth colour of the current outfit, and its shaded side. */
const K = (k: string) => tone(k).color;
const KS = (k: string) => tone(k).shade;

/** Each outfit's colour for his "?". */
const MARK: Record<OutfitName, string> = {
  cozy: "scarfDark", desi: "jacket", detective: "coatDark", hero: "cape", rainy: "coatDark",
  coder: "logo", pyjamas: "pj", chef: "neckerchief", dapper: "vest",
};
const markColour = () => KS(MARK[outfit]);

/** Fills a shape and outlines it in his line. */
function paint(g: CanvasRenderingContext2D, path: Path2D, fill: string | CanvasGradient, lw = 0.008) {
  g.fillStyle = fill;
  g.fill(path);
  g.strokeStyle = C.line;
  g.lineWidth = lw;
  g.lineJoin = "round";
  g.stroke(path);
}

/** Cloth shading: lit up and to the left, shaded down and to the right. */
function clothShade(g: CanvasRenderingContext2D, name: string, x: number, y: number, r: number): CanvasGradient {
  const gr = g.createRadialGradient(x - r * 0.4, y - r * 0.5, r * 0.05, x, y, r);
  gr.addColorStop(0, K(name));
  gr.addColorStop(0.55, K(name));
  gr.addColorStop(1, KS(name));
  return gr;
}

function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, lw = 0.005) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = C.line;
  g.lineWidth = lw;
  g.stroke();
}

function poly(pts: Pt[]): Path2D {
  const q = new Path2D();
  pts.forEach(([x, y], k) => (k ? q.lineTo(x, y) : q.moveTo(x, y)));
  q.closePath();
  return q;
}

/** A point along a rubber-hose limb (the same curve as `hose`), t from 0 at a to 1 at b. */
function hoseAt(a: Pt, b: Pt, bend: number, t: number): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-6;
  const nx = -dy / len, ny = dx / len;
  const k = bend * len * 0.6;
  const c1: Pt = [a[0] + dx / 3 + nx * k, a[1] + dy / 3 + ny * k];
  const c2: Pt = [a[0] + (2 * dx) / 3 + nx * k, a[1] + (2 * dy) / 3 + ny * k];
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return [w0 * a[0] + w1 * c1[0] + w2 * c2[0] + w3 * b[0], w0 * a[1] + w1 * c1[1] + w2 * c2[1] + w3 * b[1]];
}

/** The part of a limb from t0 to t1 (for sleeves, trousers, boots). */
function hoseSeg(a: Pt, b: Pt, bend: number, t0: number, t1: number): Path2D {
  const q = new Path2D();
  for (let k = 0; k <= 10; k++) {
    const [x, y] = hoseAt(a, b, bend, lerp(t0, t1, k / 10));
    if (k) q.lineTo(x, y);
    else q.moveTo(x, y);
  }
  return q;
}

/** A sleeve: its cloth, how far down the arm it reaches, its width, a cuff, stripes. */
interface Sleeve { cloth: string; len: number; w: number; cuff?: string; stripe?: string }
const SLEEVES: Partial<Record<OutfitName, Sleeve>> = {
  desi: { cloth: "kurta", len: 0.84, w: 0.046 },
  detective: { cloth: "coat", len: 0.8, w: 0.052, cuff: "coatDark" },
  rainy: { cloth: "coat", len: 0.82, w: 0.054, cuff: "coatDark" },
  coder: { cloth: "hoodie", len: 0.84, w: 0.05, cuff: "hoodieLight" },
  pyjamas: { cloth: "pj", len: 0.84, w: 0.048, cuff: "pj", stripe: "stripe" },
  dapper: { cloth: "shirt", len: 0.84, w: 0.044, cuff: "shirt" },
};

/** Stripes along a limb: a broad light band with a thin dark one down its middle. */
function stripeAlong(g: CanvasRenderingContext2D, path: Path2D, w: number, light: string, dark: string) {
  g.strokeStyle = light;
  g.lineWidth = w * 0.55;
  g.stroke(path);
  g.strokeStyle = dark;
  g.lineWidth = w * 0.18;
  g.stroke(path);
}

function drawSleeve(g: CanvasRenderingContext2D, a: Pt, b: Pt, bend: number, side: -1 | 1) {
  const s = SLEEVES[outfit];
  if (!s) return;
  const pick = (n: string) => (side < 0 ? KS(n) : K(n));
  const sleeve = hoseSeg(a, b, bend, 0, s.len);
  noodle(g, sleeve, s.w, pick(s.cloth));
  if (s.stripe) stripeAlong(g, sleeve, s.w, pick(s.stripe), pick(s.cloth));
  if (s.cuff) noodle(g, hoseSeg(a, b, bend, s.len - 0.08, s.len), s.w + 0.006, pick(s.cuff));
}

/** Pyjama trousers, or rubber boots. */
function dressLeg(g: CanvasRenderingContext2D, hip: Pt, foot: Pt, bend: number, side: -1 | 1) {
  const pick = (n: string) => (side < 0 ? KS(n) : K(n));
  if (outfit === "pyjamas") {
    const leg = hoseSeg(hip, foot, bend, 0, 0.84);
    noodle(g, leg, 0.05, pick("pj"));
    stripeAlong(g, leg, 0.05, pick("stripe"), pick("pj"));
    noodle(g, hoseSeg(hip, foot, bend, 0.78, 0.84), 0.056, pick("pj"));
  } else if (outfit === "rainy") {
    noodle(g, hoseSeg(hip, foot, bend, 0.62, 0.97), 0.052, pick("boots"));
    noodle(g, hoseSeg(hip, foot, bend, 0.6, 0.64), 0.06, pick("boots"));
  }
}

/** A point on the torso's bean (torso space), grown about its middle. */
function beanPt(a: number, grow: number): Pt {
  const s = Math.sin(a);
  const x = 0.1 * Math.cos(a) * (1 + 0.18 * s) + 0.02 * (1 - s * s);
  return [x * grow, -0.15 + 0.165 * s * grow];
}

/** A top that follows his torso down to the waist, then hangs to `hem`, flaring out. */
function garmentPath(hem: number, flare: number, grow = 1.07): Path2D {
  const q = new Path2D();
  const a0 = (Math.PI * 5) / 6, a1 = TAU + Math.PI / 6;
  for (let k = 0; k <= 32; k++) {
    const [x, y] = beanPt(lerp(a0, a1, k / 32), grow);
    if (k) q.lineTo(x, y);
    else q.moveTo(x, y);
  }
  const fw = beanPt(a1, grow), bw = beanPt(a0, grow);
  q.quadraticCurveTo(fw[0] + flare * 0.2, (fw[1] + hem) / 2, fw[0] + flare, hem);
  q.quadraticCurveTo((fw[0] + bw[0]) / 2, hem + 0.025, bw[0] - flare, hem);
  q.quadraticCurveTo(bw[0] - flare * 0.2, (bw[1] + hem) / 2, bw[0], bw[1]);
  q.closePath();
  return q;
}

/** Argyle diamonds over an area, with thin crossing lines. */
function argyle(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, a: number, b: number, f: Frame) {
  g.fillStyle = K("argyle");
  for (let j = 0; y0 + j * b <= y1 + b; j++) {
    for (let i = 0; x0 + i * 2 * a <= x1 + 2 * a; i++) {
      if ((i + j) % 2) continue;
      const x = x0 + i * 2 * a + (j % 2) * a, y = y0 + j * b;
      g.fill(poly([[x, y - b], [x + a, y], [x, y + b], [x - a, y]]));
    }
  }
  if (f.detail > 0.2) {
    g.strokeStyle = "rgba(255,248,230,0.55)";
    g.lineWidth = 0.004;
    g.beginPath();
    for (let x = x0 - (y1 - y0); x < x1 + (y1 - y0); x += 4 * a) {
      g.moveTo(x, y0);
      g.lineTo(x + ((y1 - y0) * a) / b, y1);
      g.moveTo(x, y1);
      g.lineTo(x + ((y1 - y0) * a) / b, y0);
    }
    g.stroke();
  }
}

/** The lightning bolt of his badge. */
const BOLT: Pt[] = [[0.01, -0.032], [-0.016, 0.004], [0.0, 0.004], [-0.01, 0.033], [0.018, -0.008], [0.002, -0.008], [0.014, -0.032]];

/** His top (kurta and jacket, coat, raincoat, hoodie, pyjama top, apron, vest; or the hero's badge), in torso space. */
function drawTop(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  g.save();
  g.translate(0, HIP_Y);
  g.rotate(p.hunch);
  g.scale(1, p.torsoSY);
  g.lineCap = "round";
  g.lineJoin = "round";
  const sh = (n: string) => clothShade(g, n, 0.0, -0.12, 0.27);
  const inside = (path: Path2D, fn: () => void) => {
    g.save();
    g.clip(path);
    fn();
    g.restore();
  };
  const line = (color: string, w: number, fn: () => void) => {
    g.strokeStyle = color;
    g.lineWidth = w;
    g.beginPath();
    fn();
    g.stroke();
  };
  switch (outfit) {
    case "desi": {
      // A long ivory kurta to mid-thigh, under a maroon Nehru jacket with gold buttons.
      const kurta = garmentPath(0.15, 0.035);
      paint(g, kurta, sh("kurta"), 0.009);
      inside(kurta, () => line(K("gold"), 0.008, () => {
        g.moveTo(-0.22, 0.128);
        g.quadraticCurveTo(0.0, 0.155, 0.22, 0.12);
      }));
      const jacket = garmentPath(0.035, 0.008, 1.1);
      paint(g, jacket, sh("jacket"), 0.009);
      inside(jacket, () => {
        line(K("gold"), 0.01, () => {
          g.moveTo(0.06, -0.34);
          g.quadraticCurveTo(0.118, -0.16, 0.104, 0.07);
        });
        line(K("gold"), 0.007, () => {
          g.moveTo(-0.22, 0.034);
          g.quadraticCurveTo(0.0, 0.058, 0.22, 0.03);
        });
        line(K("gold"), 0.006, () => {
          g.moveTo(-0.01, -0.2);
          g.lineTo(0.038, -0.206);
        });
      });
      for (const [x, y] of [[0.09, -0.25], [0.102, -0.18], [0.108, -0.11], [0.108, -0.04]] as const) dot(g, x, y, 0.01, K("gold"));
      break;
    }
    case "detective": {
      // A belted khaki trench coat with wide lapels and a flared skirt.
      const coat = garmentPath(0.17, 0.05, 1.09);
      paint(g, coat, sh("coat"), 0.009);
      inside(coat, () => {
        line(C.line, 0.006, () => {
          g.moveTo(0.1, -0.05);
          g.quadraticCurveTo(0.13, 0.06, 0.16, 0.22);
          g.moveTo(-0.03, 0.035);
          g.lineTo(0.05, 0.025);
        });
        const belt = new Path2D();
        belt.rect(-0.25, -0.088, 0.5, 0.036);
        paint(g, belt, K("coatDark"), 0.006);
        paint(g, poly([[0.035, -0.34], [0.13, -0.32], [0.088, -0.19]]), C.pale, 0.006);
        paint(g, poly([[0.025, -0.34], [0.088, -0.19], [0.05, -0.2], [-0.005, -0.27]]), K("coat"), 0.007);
        paint(g, poly([[0.13, -0.32], [0.088, -0.19], [0.135, -0.215], [0.15, -0.29]]), KS("coat"), 0.007);
      });
      g.strokeStyle = K("brass");
      g.lineWidth = 0.007;
      g.strokeRect(0.082, -0.094, 0.034, 0.048);
      for (const [x, y] of [[0.04, -0.155], [0.095, -0.15], [0.045, -0.115], [0.1, -0.11]] as const) dot(g, x, y, 0.009, K("coatDark"));
      break;
    }
    case "hero": {
      // Just a badge on his chest: a gold bolt on red.
      g.translate(0.072, -0.2);
      g.scale(0.82, 1);
      const badge = new Path2D();
      badge.arc(0, 0, 0.043, 0, TAU);
      g.fillStyle = K("cape");
      g.fill(badge);
      g.strokeStyle = K("emblem");
      g.lineWidth = 0.01;
      g.stroke(badge);
      g.beginPath();
      g.arc(0, 0, 0.049, 0, TAU);
      g.strokeStyle = C.line;
      g.lineWidth = 0.005;
      g.stroke();
      paint(g, poly(BOLT), K("emblem"), 0.004);
      break;
    }
    case "rainy": {
      // A glossy yellow raincoat with toggles and a pocket flap.
      const coat = garmentPath(0.13, 0.045, 1.09);
      paint(g, coat, sh("coat"), 0.009);
      inside(coat, () => {
        line(KS("coatDark"), 0.006, () => {
          g.moveTo(0.08, -0.34);
          g.quadraticCurveTo(0.122, -0.12, 0.128, 0.18);
        });
        paint(g, poly([[-0.035, 0.02], [0.06, 0.012], [0.058, 0.042], [-0.032, 0.048]]), KS("coat"), 0.006);
        line("rgba(255,255,255,0.55)", 0.012, () => {
          g.moveTo(-0.045, -0.29);
          g.quadraticCurveTo(-0.09, -0.22, -0.085, -0.12);
        });
      });
      for (const y of [-0.25, -0.17, -0.09]) {
        const x = 0.098 + 0.06 * (y + 0.25) * 0.4;
        line(K("coatDark"), 0.005, () => {
          g.moveTo(x - 0.022, y);
          g.lineTo(x + 0.02, y + 0.002);
        });
        g.save();
        g.translate(x, y);
        g.rotate(-0.15);
        const tog = new Path2D();
        tog.ellipse(0, 0, 0.019, 0.008, 0, 0, TAU);
        paint(g, tog, K("coatDark"), 0.005);
        g.restore();
      }
      break;
    }
    case "coder": {
      // A charcoal hoodie: ribbed hem, kangaroo pocket, a little orange logo.
      const hoodie = garmentPath(0.035, 0.012, 1.09);
      paint(g, hoodie, sh("hoodie"), 0.009);
      inside(hoodie, () => {
        g.fillStyle = K("hoodieLight");
        g.fillRect(-0.3, 0.008, 0.6, 0.1);
        line(C.line, 0.006, () => {
          g.moveTo(-0.3, 0.008);
          g.lineTo(0.3, 0.008);
        });
        line(K("hoodieLight"), 0.007, () => {
          g.moveTo(0.0, 0.008);
          g.lineTo(0.012, -0.07);
          g.quadraticCurveTo(0.07, -0.092, 0.135, -0.075);
        });
      });
      g.save();
      g.translate(0.064, -0.205);
      g.scale(0.85, 1);
      dot(g, 0, 0, 0.022, K("logo"));
      if (f.detail > 0.25) {
        line("#FFFFFF", 0.005, () => {
          g.moveTo(-0.004, -0.01);
          g.lineTo(-0.012, 0);
          g.lineTo(-0.004, 0.01);
          g.moveTo(0.004, -0.01);
          g.lineTo(0.012, 0);
          g.lineTo(0.004, 0.01);
        });
      }
      g.restore();
      break;
    }
    case "pyjamas": {
      // A blue-and-white striped pyjama top with white buttons.
      const top = garmentPath(0.055, 0.015, 1.08);
      g.fillStyle = K("pj");
      g.fill(top);
      inside(top, () => {
        g.fillStyle = K("stripe");
        for (let x = -0.16; x < 0.2; x += 0.05) g.fillRect(x, -0.4, 0.019, 0.5);
        const sd = g.createRadialGradient(-0.03, -0.24, 0.02, 0, -0.12, 0.26);
        sd.addColorStop(0, "rgba(40,50,100,0)");
        sd.addColorStop(1, "rgba(40,50,100,0.22)");
        g.fillStyle = sd;
        g.fillRect(-0.3, -0.4, 0.6, 0.5);
        line(KS("pj"), 0.014, () => {
          g.moveTo(0.085, -0.33);
          g.quadraticCurveTo(0.112, -0.12, 0.106, 0.09);
        });
        g.strokeStyle = C.line;
        g.lineWidth = 0.005;
        g.strokeRect(-0.012, -0.228, 0.042, 0.04);
      });
      g.strokeStyle = C.line;
      g.lineWidth = 0.009;
      g.stroke(top);
      for (const [x, y] of [[0.094, -0.25], [0.103, -0.17], [0.107, -0.09], [0.107, -0.01]] as const) dot(g, x, y, 0.008, K("pom"));
      break;
    }
    case "chef": {
      // A white bib apron tied at the back.
      const tie = new Path2D();
      tie.moveTo(-0.035, -0.07);
      tie.lineTo(-0.1, -0.078);
      noodle(g, tie, 0.012, KS("apron"));
      g.save();
      g.translate(-0.105, -0.078);
      for (const a of [-0.7, 0.7]) {
        g.save();
        g.rotate(a + Math.PI);
        const loop = new Path2D();
        loop.ellipse(0.02, 0, 0.022, 0.011, 0, 0, TAU);
        paint(g, loop, KS("apron"), 0.006);
        g.restore();
      }
      dot(g, 0, 0, 0.009, KS("apron"));
      g.restore();
      const apron = new Path2D();
      apron.moveTo(0.012, -0.255);
      apron.lineTo(0.098, -0.258);
      apron.quadraticCurveTo(0.138, -0.16, 0.13, -0.07);
      apron.quadraticCurveTo(0.152, 0.04, 0.168, 0.135);
      apron.quadraticCurveTo(0.06, 0.16, -0.055, 0.138);
      apron.quadraticCurveTo(-0.048, 0.03, -0.035, -0.07);
      apron.quadraticCurveTo(0.0, -0.13, 0.012, -0.255);
      apron.closePath();
      paint(g, apron, clothShade(g, "apron", 0.06, -0.08, 0.24), 0.009);
      inside(apron, () => {
        g.strokeStyle = C.line;
        g.lineWidth = 0.005;
        g.strokeRect(0.025, 0.005, 0.08, 0.055);
        line(K("neckerchief"), 0.006, () => {
          g.moveTo(-0.1, -0.072);
          g.quadraticCurveTo(0.05, -0.08, 0.16, -0.075);
        });
      });
      break;
    }
    case "dapper": {
      // A green argyle sweater vest over a cream shirt.
      const vest = garmentPath(0.03, 0.004, 1.08);
      paint(g, vest, sh("vest"), 0.009);
      inside(vest, () => {
        argyle(g, -0.2, -0.34, 0.2, 0.06, 0.03, 0.042, f);
        g.fillStyle = KS("vest");
        g.fillRect(-0.3, 0.004, 0.6, 0.1);
        line(C.line, 0.005, () => {
          g.moveTo(-0.3, 0.004);
          g.lineTo(0.3, 0.004);
        });
      });
      g.strokeStyle = C.line;
      g.lineWidth = 0.009;
      g.stroke(vest);
      paint(g, poly([[0.012, -0.32], [0.128, -0.3], [0.082, -0.175]]), K("shirt"), 0.006);
      line(KS("vest"), 0.008, () => {
        g.moveTo(0.012, -0.315);
        g.lineTo(0.082, -0.18);
        g.lineTo(0.126, -0.296);
      });
      break;
    }
  }
  g.restore();
}

/** Behind him: the hero's cape, the coder's hood hanging down his back. */
function drawOutfitBack(g: CanvasRenderingContext2D, p: Pose, nb: Pt, f: Frame) {
  if (outfit === "hero") drawCape(g, p, nb, f);
  if (outfit === "coder") {
    const k = 1 - clamp(p.hide, 0, 1);
    if (k < 0.05) return;
    g.save();
    g.translate(nb[0] - 0.05, nb[1] - 0.005);
    g.rotate(p.hunch * 0.6 - 0.35);
    g.scale(k, k);
    const hood = new Path2D();
    hood.ellipse(0, 0, 0.082, 0.056, 0, 0, TAU);
    paint(g, hood, K("hoodie"), 0.009);
    const opening = new Path2D();
    opening.ellipse(0.018, -0.012, 0.05, 0.026, 0, 0, TAU);
    paint(g, opening, KS("hoodie"), 0.006);
    g.restore();
  }
}

/** The red cape: hangs down his back, flies out behind him like the scarf does. */
function drawCape(g: CanvasRenderingContext2D, p: Pose, nb: Pt, f: Frame) {
  const gone = smoothstep(0.05, 0.4, p.hide);
  if (gone > 0.99) return;
  const top: Pt = [nb[0] - 0.035, nb[1] + 0.005];
  const fly = clamp(p.flag + Math.abs(p.lagX) * 5, 0, 1);
  const dir = mix([-0.28, 1], [-1, -0.18], fly);
  const dl = Math.hypot(dir[0], dir[1]);
  const dx = dir[0] / dl, dy = dir[1] / dl;
  const L = 0.5 - 0.06 * fly;
  const N = 16;
  const amp = 0.006 + 0.03 * fly;
  const pts: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    const s = k / N;
    const wave = amp * Math.sin(s * 6 - f.t * 10) * s;
    pts.push([top[0] + dx * L * s - dy * wave - p.lagX * 0.7 * s * s, top[1] + dy * L * s + dx * wave + p.lagY * 0.3 * s * s]);
  }
  const half = (s: number) => 0.04 + 0.12 * Math.pow(s, 0.8);
  const normal = (k: number): Pt => {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(N, k + 1)];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    return [-ey / len, ex / len];
  };
  const ribbon = (shift: number) => {
    const q = new Path2D();
    for (let k = 0; k <= N; k++) {
      const [nx, ny] = normal(k);
      const h = half(k / N) + shift;
      if (k) q.lineTo(pts[k][0] + nx * h, pts[k][1] + ny * h);
      else q.moveTo(pts[k][0] + nx * h, pts[k][1] + ny * h);
    }
    // The bottom hem, scalloped where the cloth folds.
    const [ex, ey] = pts[N];
    const [nx, ny] = normal(N);
    const tx = ex - pts[N - 1][0], ty = ey - pts[N - 1][1];
    const h = half(1);
    for (let j = 1; j <= 4; j++) {
      const s = 1 - j / 2;
      const bump = 0.6 * (j % 2 ? 1 : -0.4);
      q.lineTo(ex + nx * (h * s + shift) + tx * bump, ey + ny * (h * s + shift) + ty * bump);
    }
    for (let k = N; k >= 0; k--) {
      const [mx, my] = normal(k);
      const hh = half(k / N) - shift;
      q.lineTo(pts[k][0] - mx * hh, pts[k][1] - my * hh);
    }
    q.closePath();
    return q;
  };
  g.save();
  g.globalAlpha *= 1 - gone;
  g.lineJoin = "round";
  // The darker lining shows along one edge as it turns.
  paint(g, ribbon(0.014), K("capeInside"), 0.009);
  const cape = ribbon(0);
  paint(g, cape, K("cape"), 0.009);
  // Folds.
  g.save();
  g.clip(cape);
  g.strokeStyle = KS("cape");
  g.lineWidth = 0.012;
  g.lineCap = "round";
  g.beginPath();
  for (const off of [-0.45, 0.4]) {
    for (let k = 3; k <= N; k++) {
      const [nx, ny] = normal(k);
      const h = half(k / N) * off;
      if (k === 3) g.moveTo(pts[k][0] + nx * h, pts[k][1] + ny * h);
      else g.lineTo(pts[k][0] + nx * h, pts[k][1] + ny * h);
    }
  }
  g.stroke();
  g.restore();
  g.restore();
}

/** Round his neck: the outfit's collar, neckerchief or bow tie. */
function drawCollar(g: CanvasRenderingContext2D, p: Pose, nb: Pt, f: Frame) {
  g.save();
  g.translate(nb[0] + 0.012, nb[1] - 0.035);
  g.rotate(p.hunch * 0.6 - 0.05);
  g.lineCap = "round";
  const band = (rx: number, ry: number, fill: string, dy = 0) => {
    const b = new Path2D();
    b.ellipse(0, dy, rx, ry, 0, 0, TAU);
    paint(g, b, fill, 0.008);
  };
  switch (outfit) {
    case "desi":
      // The jacket's mandarin collar, piped in gold.
      band(0.064, 0.032, K("jacket"), 0.006);
      g.strokeStyle = K("gold");
      g.lineWidth = 0.006;
      g.beginPath();
      g.ellipse(0, 0.002, 0.058, 0.024, 0, Math.PI * 1.05, Math.PI * 1.95);
      g.stroke();
      break;
    case "detective":
      band(0.076, 0.037, K("coat"));
      paint(g, poly([[0.015, 0.0], [0.098, -0.012], [0.07, 0.065]]), K("coat"), 0.007);
      break;
    case "hero":
      band(0.058, 0.024, K("cape"));
      dot(g, 0.056, 0.008, 0.022, K("emblem"), 0.006);
      break;
    case "rainy":
      band(0.076, 0.038, K("coat"));
      paint(g, poly([[0.02, 0.0], [0.1, -0.008], [0.072, 0.066]]), K("coat"), 0.007);
      break;
    case "coder": {
      band(0.068, 0.033, K("hoodie"));
      if (p.hide < 0.5) {
        // Drawstrings, swinging.
        const sway = clamp(-p.lagX * 0.6, -0.04, 0.04) + 0.004 * Math.sin(f.t * 3);
        for (const x0 of [0.032, 0.06]) {
          const end: Pt = [x0 + 0.004 + sway, 0.12];
          noodle(g, hose([x0, 0.026], end, 0.15), 0.006, K("hoodieLight"));
          g.fillStyle = K("logo");
          g.fillRect(end[0] - 0.006, end[1] - 0.004, 0.012, 0.016);
        }
      }
      break;
    }
    case "pyjamas":
      band(0.064, 0.031, K("pj"));
      paint(g, poly([[0.018, -0.002], [0.074, -0.008], [0.052, 0.048]]), K("stripe"), 0.006);
      paint(g, poly([[0.062, -0.006], [0.104, -0.012], [0.098, 0.036]]), K("stripe"), 0.006);
      break;
    case "chef":
      // A red neckerchief, knotted in front.
      band(0.068, 0.033, K("neckerchief"));
      paint(g, poly([[0.044, 0.024], [0.082, 0.02], [0.058, 0.104]]), KS("neckerchief"), 0.007);
      paint(g, poly([[0.06, 0.024], [0.1, 0.018], [0.104, 0.094]]), K("neckerchief"), 0.007);
      dot(g, 0.064, 0.018, 0.02, K("neckerchief"), 0.007);
      break;
    case "dapper":
      // Shirt collar points and a red bow tie.
      band(0.062, 0.029, K("shirt"));
      paint(g, poly([[0.018, -0.002], [0.07, -0.008], [0.046, 0.048]]), K("shirt"), 0.006);
      paint(g, poly([[0.052, -0.006], [0.096, -0.014], [0.09, 0.036]]), K("shirt"), 0.006);
      g.save();
      g.translate(0.074, 0.03);
      g.rotate(-0.15);
      paint(g, poly([[0, 0], [-0.04, -0.024], [-0.042, 0.024]]), KS("bow"), 0.006);
      paint(g, poly([[0, 0], [0.04, -0.026], [0.042, 0.022]]), K("bow"), 0.006);
      dot(g, 0, 0, 0.012, K("bow"), 0.006);
      g.restore();
      break;
  }
  g.restore();
}

// ── Outfits: headwear (head space) ────────────────────────────────────────────

/** Outfits whose hat he pulls down over his eyes to hide. */
const HAT_HIDERS = new Set<OutfitName>(["desi", "rainy", "dapper", "pyjamas"]);
/** How far into hiding (0…1) the hat goes from behind his eyes to in front of them: it's lifted clear of them then. */
const HAT_SWAP = 0.25;

/**
 * Where a hat sits: on the crown, tipped back. As he hides (`hide` 0…1) he
 * first lifts it clear of his eyes, then pulls it down over them.
 */
function hatFrame(g: CanvasRenderingContext2D, hide: number) {
  const lift = 0.1 * Math.sin(Math.PI * clamp(hide / (2 * HAT_SWAP), 0, 1));
  const down = smoothstep(HAT_SWAP, 1, hide);
  g.translate(lerp(-0.035, 0.02, down), lerp(-0.13, -0.045, down) - lift);
  g.rotate(lerp(-0.25, 0.1, down) - 0.15 * lift);
  g.scale(lerp(1, 1.18, down), lerp(1, 1.3, down));
}

function drawHeadwear(g: CanvasRenderingContext2D, p: Pose, f: Frame, layer: "back" | "face" | "front") {
  const hide = clamp(p.hide, 0, 1);
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  switch (outfit) {
    case "desi":
    case "rainy":
    case "dapper":
    case "pyjamas": {
      // Hats he pulls down over his eyes to hide: in front of his eyes then.
      const front = hide > HAT_SWAP;
      if (layer === "face" || (layer === "front") !== front) break;
      hatFrame(g, hide);
      if (outfit === "desi") drawBoatCap(g);
      else if (outfit === "rainy") drawSouwester(g, f);
      else if (outfit === "dapper") drawFlatCap(g, f);
      else drawNightcap(g, p, f);
      break;
    }
    case "detective":
      if (layer !== "back") break;
      hatFrame(g, 0);
      drawDeerstalker(g, f);
      break;
    case "chef":
      if (layer !== "back") break;
      hatFrame(g, 0);
      drawToque(g, f);
      break;
    case "hero":
      if (layer === "face") drawMask(g, p, f);
      break;
    case "coder":
      // (The headphones stay on under the hood.)
      if (layer === "back" && hide < 0.4) drawHeadphones(g);
      else if (layer === "front") {
        drawGlasses(g, p);
        if (hide > 0.01) drawCoderHood(g, hide, clamp(p.peek, 0, 1));
      }
      break;
  }
  g.restore();
}

/** Desi Bhai's boat-shaped cap, piped in gold. */
function drawBoatCap(g: CanvasRenderingContext2D) {
  const cap = new Path2D();
  cap.moveTo(-0.165, 0.026);
  cap.quadraticCurveTo(-0.17, -0.03, -0.135, -0.066);
  cap.quadraticCurveTo(-0.01, -0.04, 0.115, -0.062);
  cap.quadraticCurveTo(0.15, -0.025, 0.14, 0.016);
  cap.quadraticCurveTo(-0.01, 0.0, -0.165, 0.026);
  cap.closePath();
  paint(g, cap, clothShade(g, "cap", -0.02, -0.03, 0.17), 0.009);
  g.save();
  g.clip(cap);
  g.strokeStyle = K("gold");
  g.lineWidth = 0.008;
  g.beginPath();
  g.moveTo(-0.17, 0.006);
  g.quadraticCurveTo(-0.01, -0.016, 0.15, -0.004);
  g.stroke();
  g.strokeStyle = KS("cap");
  g.lineWidth = 0.007;
  g.beginPath();
  g.moveTo(-0.125, -0.058);
  g.quadraticCurveTo(-0.01, -0.025, 0.105, -0.054);
  g.stroke();
  g.restore();
}

/** The detective's check deerstalker: peaks front and back, ear flaps tied on top. */
function drawDeerstalker(g: CanvasRenderingContext2D, f: Frame) {
  const back = new Path2D();
  back.moveTo(-0.08, 0.0);
  back.quadraticCurveTo(-0.17, -0.005, -0.205, 0.058);
  back.quadraticCurveTo(-0.13, 0.06, -0.08, 0.03);
  back.closePath();
  paint(g, back, KS("hat"));
  const crown = new Path2D();
  crown.moveTo(-0.125, 0.028);
  crown.bezierCurveTo(-0.145, -0.11, 0.095, -0.14, 0.11, 0.006);
  crown.quadraticCurveTo(-0.01, 0.032, -0.125, 0.028);
  crown.closePath();
  g.fillStyle = clothShade(g, "hat", -0.01, -0.03, 0.15);
  g.fill(crown);
  if (f.detail > 0.1) {
    g.save();
    g.clip(crown);
    g.strokeStyle = K("check");
    g.globalAlpha *= 0.6;
    g.lineWidth = 0.007;
    g.beginPath();
    for (let x = -0.14; x < 0.13; x += 0.036) {
      g.moveTo(x, -0.15);
      g.lineTo(x + 0.02, 0.05);
    }
    for (let y = -0.1; y < 0.05; y += 0.036) {
      g.moveTo(-0.16, y);
      g.lineTo(0.13, y - 0.012);
    }
    g.stroke();
    g.restore();
  }
  g.strokeStyle = C.line;
  g.lineWidth = 0.008;
  g.stroke(crown);
  const peak = new Path2D();
  peak.moveTo(0.06, -0.004);
  peak.quadraticCurveTo(0.16, -0.03, 0.205, 0.032);
  peak.quadraticCurveTo(0.13, 0.048, 0.06, 0.026);
  peak.closePath();
  paint(g, peak, K("hat"));
  // Ear flaps tied in a bow on top.
  g.save();
  g.translate(-0.012, -0.1);
  for (const a of [-0.5, 0.5]) {
    const loop = new Path2D();
    loop.ellipse(a * 0.05, -0.008, 0.022, 0.011, a, 0, TAU);
    paint(g, loop, K("hat"), 0.005);
  }
  dot(g, 0, -0.004, 0.009, K("check"));
  g.restore();
}

/** The yellow sou'wester: a round crown, the brim long at the back. */
function drawSouwester(g: CanvasRenderingContext2D, f: Frame) {
  const brim = new Path2D();
  brim.moveTo(-0.25, 0.095);
  brim.quadraticCurveTo(-0.18, 0.0, -0.09, 0.01);
  brim.lineTo(0.09, -0.006);
  brim.quadraticCurveTo(0.175, -0.012, 0.188, 0.032);
  brim.quadraticCurveTo(0.08, 0.038, -0.02, 0.044);
  brim.quadraticCurveTo(-0.16, 0.055, -0.25, 0.095);
  brim.closePath();
  paint(g, brim, KS("hat"));
  if (f.detail > 0.2) {
    g.save();
    g.clip(brim);
    g.setLineDash([0.012, 0.009]);
    g.strokeStyle = K("coatDark");
    g.lineWidth = 0.004;
    g.beginPath();
    g.moveTo(-0.23, 0.08);
    g.quadraticCurveTo(-0.15, 0.04, -0.02, 0.034);
    g.quadraticCurveTo(0.08, 0.028, 0.175, 0.026);
    g.stroke();
    g.restore();
  }
  const crown = new Path2D();
  crown.moveTo(-0.115, 0.026);
  crown.bezierCurveTo(-0.125, -0.125, 0.095, -0.135, 0.105, 0.01);
  crown.quadraticCurveTo(0.0, 0.03, -0.115, 0.026);
  crown.closePath();
  paint(g, crown, clothShade(g, "hat", -0.01, -0.03, 0.15));
  g.strokeStyle = K("coatDark");
  g.lineWidth = 0.005;
  g.beginPath();
  g.moveTo(-0.012, -0.09);
  g.quadraticCurveTo(-0.03, -0.04, -0.03, 0.022);
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.6)";
  g.lineWidth = 0.01;
  g.beginPath();
  g.moveTo(-0.08, -0.04);
  g.quadraticCurveTo(-0.07, -0.08, -0.04, -0.09);
  g.stroke();
}

/** The dapper grey tweed flat cap, its short brim forward. */
function drawFlatCap(g: CanvasRenderingContext2D, f: Frame) {
  const brim = new Path2D();
  brim.moveTo(0.04, -0.012);
  brim.quadraticCurveTo(0.15, -0.03, 0.18, 0.016);
  brim.quadraticCurveTo(0.12, 0.034, 0.04, 0.02);
  brim.closePath();
  paint(g, brim, KS("cap"));
  const crown = new Path2D();
  crown.moveTo(-0.135, 0.024);
  crown.bezierCurveTo(-0.16, -0.065, -0.02, -0.105, 0.1, -0.06);
  crown.quadraticCurveTo(0.145, -0.035, 0.115, 0.0);
  crown.quadraticCurveTo(-0.01, 0.012, -0.135, 0.024);
  crown.closePath();
  g.fillStyle = clothShade(g, "cap", -0.02, -0.03, 0.15);
  g.fill(crown);
  if (f.detail > 0.1) {
    g.save();
    g.clip(crown);
    g.strokeStyle = K("capCheck");
    g.globalAlpha *= 0.55;
    g.lineWidth = 0.005;
    g.beginPath();
    for (let x = -0.24; x < 0.16; x += 0.026) {
      g.moveTo(x, -0.12);
      g.lineTo(x + 0.12, 0.04);
      g.moveTo(x + 0.12, -0.12);
      g.lineTo(x, 0.04);
    }
    g.stroke();
    g.restore();
  }
  g.strokeStyle = C.line;
  g.lineWidth = 0.008;
  g.stroke(crown);
  g.beginPath();
  g.moveTo(-0.11, 0.0);
  g.quadraticCurveTo(0.0, -0.05, 0.1, -0.03);
  g.strokeStyle = KS("cap");
  g.lineWidth = 0.006;
  g.stroke();
  dot(g, -0.04, -0.078, 0.01, KS("cap"));
}

/** The long floppy nightcap; its pom-pom swings behind him. */
function drawNightcap(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  const flop = clamp(p.flag, 0, 1);
  const sw = clamp(-p.lagX * 2.5, -0.12, 0.12) + 0.02 * Math.sin(f.t * 2.3);
  const B: Pt = [-0.01, -0.035];
  const c1: Pt = [0.0, -0.2];
  const c2: Pt = [-0.16, -0.25 - 0.05 * flop];
  const tip: Pt = [-0.25 + sw + 0.04 * flop, -0.07 - 0.14 * flop + clamp(p.lagY, -0.1, 0.1) * 0.5];
  const N = 16;
  const pts: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N, u = 1 - t;
    pts.push([
      u * u * u * B[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * tip[0],
      u * u * u * B[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * tip[1],
    ]);
  }
  const half = (s: number) => lerp(0.108, 0.014, Math.pow(s, 0.75));
  const normal = (k: number): Pt => {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(N, k + 1)];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    return [-ey / len, ex / len];
  };
  const ribbon = (k0: number, k1: number) => {
    const q = new Path2D();
    for (let k = k0; k <= k1; k++) {
      const [nx, ny] = normal(k);
      const h = half(k / N);
      if (k === k0) q.moveTo(pts[k][0] + nx * h, pts[k][1] + ny * h);
      else q.lineTo(pts[k][0] + nx * h, pts[k][1] + ny * h);
    }
    for (let k = k1; k >= k0; k--) {
      const [nx, ny] = normal(k);
      const h = half(k / N);
      q.lineTo(pts[k][0] - nx * h, pts[k][1] - ny * h);
    }
    q.closePath();
    return q;
  };
  const cap = ribbon(0, N);
  g.fillStyle = clothShade(g, "cap", -0.05, -0.15, 0.22);
  g.fill(cap);
  g.fillStyle = K("stripe");
  g.fill(ribbon(5, 6));
  g.fill(ribbon(10, 11));
  g.strokeStyle = C.line;
  g.lineWidth = 0.008;
  g.stroke(cap);
  // The cuff round his head.
  const cuff = new Path2D();
  cuff.moveTo(-0.135, 0.028);
  cuff.quadraticCurveTo(-0.01, -0.012, 0.112, 0.004);
  cuff.lineTo(0.108, -0.042);
  cuff.quadraticCurveTo(-0.01, -0.062, -0.13, -0.02);
  cuff.closePath();
  paint(g, cuff, K("stripe"));
  // The pom-pom.
  dot(g, tip[0], tip[1], 0.038, K("pom"), 0.007);
  g.fillStyle = KS("pom");
  g.beginPath();
  g.arc(tip[0] + 0.01, tip[1] + 0.01, 0.016, 0, TAU);
  g.fill();
}

/** The chef's tall pleated toque. */
function drawToque(g: CanvasRenderingContext2D, f: Frame) {
  g.rotate(-0.08);
  const puff = new Path2D();
  puff.moveTo(-0.095, -0.05);
  puff.bezierCurveTo(-0.18, -0.09, -0.16, -0.21, -0.075, -0.2);
  puff.bezierCurveTo(-0.065, -0.275, 0.065, -0.275, 0.075, -0.2);
  puff.bezierCurveTo(0.16, -0.21, 0.17, -0.09, 0.092, -0.055);
  puff.closePath();
  paint(g, puff, clothShade(g, "hat", -0.01, -0.13, 0.18), 0.008);
  if (f.detail > 0.1) {
    g.save();
    g.clip(puff);
    g.strokeStyle = KS("hat");
    g.lineWidth = 0.006;
    g.beginPath();
    for (const x of [-0.05, 0.0, 0.05]) {
      g.moveTo(x, -0.06);
      g.quadraticCurveTo(x * 1.2 - 0.005, -0.14, x * 1.4, -0.2);
    }
    g.stroke();
    g.restore();
  }
  const band = new Path2D();
  band.moveTo(-0.11, 0.024);
  band.lineTo(-0.1, -0.058);
  band.quadraticCurveTo(0.0, -0.075, 0.094, -0.062);
  band.lineTo(0.104, 0.008);
  band.quadraticCurveTo(0.0, 0.004, -0.11, 0.024);
  band.closePath();
  paint(g, band, K("hat"), 0.008);
}

/** The hero's black eye mask (behind the eyes, so they show through), ties fluttering. */
function drawMask(g: CanvasRenderingContext2D, p: Pose, f: Frame) {
  const pop = Math.max(0, p.pop);
  const dy = -0.045 * pop;
  const grow = 1 + 0.3 * pop;
  const mask = new Path2D();
  mask.ellipse(EYE_L[0] - 0.004, EYE_L[1] + dy + 0.006, 0.07, 0.082 * grow, 0, 0, TAU);
  mask.ellipse(EYE_R[0] + 0.004, EYE_R[1] + dy + 0.006, 0.072, 0.084 * grow, 0, 0, TAU);
  g.fillStyle = K("mask");
  g.fill(mask);
  // The band round his head and its knot and ties at the back.
  const flap = 0.012 * Math.sin(f.t * 9) + clamp(-p.lagX * 0.8, -0.05, 0.05);
  const knot: Pt = [-0.16, -0.045];
  g.strokeStyle = K("mask");
  g.lineWidth = 0.036;
  g.beginPath();
  g.moveTo(EYE_L[0] - 0.04, EYE_L[1] + dy * 0.5);
  g.quadraticCurveTo(-0.12, -0.06, knot[0], knot[1]);
  g.stroke();
  for (const [ex, ey, ph] of [[-0.25, -0.01, 0], [-0.245, -0.085, 1.7]] as const) {
    g.lineWidth = 0.024;
    g.beginPath();
    g.moveTo(knot[0], knot[1]);
    g.quadraticCurveTo(-0.205, knot[1] + (ey - knot[1]) * 0.4 + flap * Math.sin(ph + 1), ex + flap, ey + flap * Math.cos(ph));
    g.stroke();
  }
  dot(g, knot[0], knot[1], 0.02, K("mask"), 0.005);
  // Eye holes (fur shows through when his eyes are shut).
  g.fillStyle = C.fur;
  for (const [at, side] of [[EYE_L, -1], [EYE_R, 1]] as const) {
    const sc = p.eyeScale * (side < 0 ? p.eyeScaleL : p.eyeScaleR);
    g.beginPath();
    g.ellipse(at[0], at[1] + dy, 0.05 * sc * (1 + 0.15 * pop), 0.066 * sc * (1 + 0.45 * pop), 0, 0, TAU);
    g.fill();
  }
}

/** Teal over-ear headphones: the band over his crown, a cup over his near ear. */
function drawHeadphones(g: CanvasRenderingContext2D) {
  const band = new Path2D();
  band.moveTo(-0.12, -0.02);
  band.bezierCurveTo(-0.15, -0.17, 0.0, -0.235, 0.035, -0.15);
  noodle(g, band, 0.022, K("phones"));
  g.save();
  g.translate(-0.118, 0.0);
  g.rotate(0.25);
  const cup = new Path2D();
  cup.ellipse(0, 0, 0.044, 0.056, 0, 0, TAU);
  paint(g, cup, clothShade(g, "phones", 0, 0, 0.06), 0.008);
  const pad = new Path2D();
  pad.ellipse(0.012, 0.0, 0.028, 0.04, 0, 0, TAU);
  paint(g, pad, KS("phones"), 0.005);
  dot(g, 0.012, 0, 0.01, K("logo"), 0.004);
  g.restore();
}

/** Round glasses on his big eyes. */
function drawGlasses(g: CanvasRenderingContext2D, p: Pose) {
  const dy = -0.045 * Math.max(0, p.pop);
  // The arm back to his ear.
  g.strokeStyle = K("frames");
  g.lineWidth = 0.009;
  g.beginPath();
  g.moveTo(EYE_L[0] - 0.062, EYE_L[1] + dy);
  g.lineTo(-0.13, -0.05);
  g.stroke();
  for (const [x, y, r] of [[EYE_L[0], EYE_L[1], 0.064], [EYE_R[0], EYE_R[1], 0.067]] as const) {
    g.beginPath();
    g.arc(x, y + dy, r, 0, TAU);
    g.fillStyle = "rgba(200,232,245,0.22)";
    g.fill();
    g.strokeStyle = K("frames");
    g.lineWidth = 0.011;
    g.stroke();
  }
  g.strokeStyle = "rgba(255,255,255,0.75)";
  g.lineWidth = 0.008;
  g.beginPath();
  g.arc(EYE_R[0], EYE_R[1] + dy, 0.048, -2.5, -1.9);
  g.stroke();
}

/**
 * The hoodie's hood pulled up and drawn tight round his nose, so only the nose
 * pokes out; loosened (`peek`) the opening widens round his face and his eyes
 * look out. Pulled up over his head from behind (`k`).
 */
function drawCoderHood(g: CanvasRenderingContext2D, k: number, peek: number) {
  g.save();
  g.beginPath();
  g.rect(-0.5, -0.5, lerp(0.22, 0.95, k), 1);
  g.clip();
  // The face opening (its back half is the hood's front edge).
  const ox = lerp(0.236, 0.125, peek), oy = lerp(0.045, -0.025, peek);
  const rx = lerp(0.04, 0.165, peek), ry = lerp(0.075, 0.135, peek);
  const top: Pt = [ox, oy - ry], bottom: Pt = [ox, oy + ry];
  const hood = new Path2D();
  hood.moveTo(bottom[0], bottom[1]);
  hood.bezierCurveTo(lerp(0.15, 0.06, peek), 0.16, 0.0, 0.175, -0.12, 0.16);
  hood.bezierCurveTo(-0.2, 0.09, -0.215, -0.07, -0.165, -0.15);
  // A soft point at the back of the crown.
  hood.quadraticCurveTo(-0.135, -0.185, -0.08, -0.178);
  hood.bezierCurveTo(lerp(0.1, 0.02, peek), lerp(-0.205, -0.19, peek), lerp(0.235, 0.1, peek), lerp(-0.12, -0.19, peek), top[0], top[1]);
  hood.ellipse(ox, oy, rx, ry, 0, -Math.PI / 2, Math.PI / 2, true);
  hood.closePath();
  const hg = g.createRadialGradient(-0.08, -0.12, 0.01, -0.02, -0.02, 0.26);
  hg.addColorStop(0, K("hoodieLight"));
  hg.addColorStop(0.75, K("hoodie"));
  hg.addColorStop(1, KS("hoodie"));
  paint(g, hood, hg, 0.009);
  g.save();
  g.clip(hood);
  // The seam over the crown, a soft sheen, and the gathers round the opening.
  g.strokeStyle = KS("hoodie");
  g.lineWidth = 0.007;
  g.beginPath();
  g.moveTo(-0.16, 0.06);
  g.bezierCurveTo(-0.2, -0.1, -0.1, -0.2, top[0] - 0.02, top[1] + 0.005);
  g.stroke();
  g.strokeStyle = "rgba(150,160,180,0.55)";
  g.lineWidth = 0.006;
  g.beginPath();
  for (const a of [-1.1, -0.55, 0, 0.55, 1.1]) {
    const c = Math.PI + a;
    g.moveTo(ox + Math.cos(c) * rx, oy + Math.sin(c) * ry);
    g.lineTo(ox + Math.cos(c) * (rx + 0.08), oy + Math.sin(c) * (ry + 0.06));
  }
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.2)";
  g.lineWidth = 0.022;
  g.beginPath();
  g.arc(-0.05, -0.01, 0.13, -2.7, -1.6);
  g.stroke();
  // Drawn tight, the fabric bunches round his nose: a lighter puckered patch.
  const tight = 1 - peek;
  if (tight > 0.02) {
    const pk = new Path2D();
    pk.ellipse(0.175, 0.045, 0.085 * tight + 0.02, 0.11 * tight + 0.04, 0, 0, TAU);
    const pg = g.createRadialGradient(0.22, 0.045, 0.01, 0.18, 0.045, 0.12);
    pg.addColorStop(0, K("hoodieLight"));
    pg.addColorStop(0.6, K("hoodieLight"));
    pg.addColorStop(1, K("hoodie"));
    g.globalAlpha *= tight;
    g.fillStyle = pg;
    g.fill(pk);
    g.fillStyle = "rgba(255,255,255,0.1)";
    g.fill(pk);
    // His big eyes push the fabric out: two round bulges.
    for (const [ex, ey] of [EYE_L, EYE_R]) {
      g.fillStyle = "rgba(255,255,255,0.1)";
      g.beginPath();
      g.ellipse(ex, ey, 0.05, 0.064, 0, 0, TAU);
      g.fill();
      g.lineWidth = 0.009;
      g.strokeStyle = "rgba(255,255,255,0.32)";
      g.beginPath();
      g.ellipse(ex, ey, 0.046, 0.06, 0, Math.PI * 1.05, Math.PI * 1.6);
      g.stroke();
      g.strokeStyle = KS("hoodie");
      g.beginPath();
      g.ellipse(ex, ey, 0.05, 0.064, 0, 0.1, 1.5);
      g.stroke();
    }
    g.strokeStyle = KS("hoodie");
    g.lineWidth = 0.006;
    g.beginPath();
    for (let a = 1.75; a < TAU - 1.7; a += 0.36) {
      g.moveTo(0.236 + Math.cos(a) * 0.04, 0.045 + Math.sin(a) * 0.07);
      g.lineTo(0.175 + Math.cos(a) * (0.085 * tight + 0.02), 0.045 + Math.sin(a) * (0.11 * tight + 0.04));
    }
    g.stroke();
  }
  g.restore();
  // The cinched rim: a ring round his nose, opening to frame his face.
  const sweep = lerp(TAU, Math.PI * 1.05, peek);
  g.lineCap = "round";
  g.strokeStyle = C.line;
  g.lineWidth = 0.034;
  g.beginPath();
  g.ellipse(ox, oy, rx, ry, 0, Math.PI - sweep / 2, Math.PI + sweep / 2);
  g.stroke();
  g.strokeStyle = K("hoodieLight");
  g.lineWidth = 0.02;
  g.stroke();
  // Scrunched where the drawstring pulls it tight: little puffs of fabric round the rim.
  const puffs = Math.round(lerp(11, 7, peek));
  for (let j = 0; j < puffs; j++) {
    const a = Math.PI - sweep / 2 + (sweep * (j + 0.5)) / puffs;
    dot(g, ox + Math.cos(a) * rx, oy + Math.sin(a) * ry, 0.014, K("hoodieLight"), 0.005);
  }
  g.restore();
  if (k < 0.6) return;
  if (peek < 0.5) drawNose(g, 0.262, 0.045);
  // The drawstrings, dangling under his chin with orange tips.
  const sway = 0.01 * Math.sin(k * 7);
  for (const [dx, len] of [[-0.012, 0.13], [0.014, 0.115]] as const) {
    const a: Pt = [bottom[0] + dx, bottom[1] - 0.005];
    const b: Pt = [a[0] + dx * 0.8 + sway, a[1] + len];
    noodle(g, hose(a, b, 0.15), 0.006, K("hoodieLight"));
    g.fillStyle = K("logo");
    g.strokeStyle = C.line;
    g.lineWidth = 0.004;
    g.beginPath();
    g.roundRect(b[0] - 0.007, b[1] - 0.004, 0.014, 0.022, 0.004);
    g.fill();
    g.stroke();
  }
}

// ── Outfits: props and hiding (body space) ────────────────────────────────────

/** What he holds: the magnifying glass, the laptop, the frying pan. Drawn under his near paw. */
function drawHeldProp(g: CanvasRenderingContext2D, p: Pose, hc: Pt, eye: string, f: Frame) {
  const paw: Pt = [p.pawRX, p.pawRY];
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  if (outfit === "detective" && p.prop > 0.01) {
    const k = clamp(p.prop, 0, 1);
    g.translate(paw[0], paw[1]);
    g.scale(k, k);
    g.translate(-paw[0], -paw[1]);
    const lc: Pt = [paw[0] - 0.02, paw[1] - 0.11];
    noodle(g, hose([paw[0] + 0.006, paw[1] + 0.03], [lc[0] + 0.008, lc[1] + 0.065], 0), 0.018, K("handle"));
    const lens = new Path2D();
    lens.arc(lc[0], lc[1], 0.066, 0, TAU);
    g.save();
    g.clip(lens);
    // Everything behind it, bigger: his eye, huge.
    if (k > 0.8) {
      g.translate(lc[0], lc[1]);
      g.scale(1.6, 1.6);
      g.translate(-lc[0], -lc[1]);
      g.translate(hc[0], hc[1]);
      g.rotate(p.headTilt);
      g.scale(HEAD_SCALE, HEAD_SCALE);
      drawHead(g, { ...p, prop: 0 }, eye, f);
    }
    g.restore();
    g.fillStyle = "rgba(207,232,242,0.25)";
    g.fill(lens);
    g.strokeStyle = C.line;
    g.lineWidth = 0.024;
    g.stroke(lens);
    g.strokeStyle = K("brass");
    g.lineWidth = 0.014;
    g.stroke(lens);
    g.strokeStyle = "rgba(255,255,255,0.8)";
    g.lineWidth = 0.008;
    g.beginPath();
    g.arc(lc[0], lc[1], 0.046, -2.6, -1.8);
    g.stroke();
  } else if (outfit === "coder" && p.prop > 0.01) {
    // A little laptop resting on his far forearm (that paw holds it from
    // below), its lid towards us with the logo on it; the near paw types.
    const k = clamp(p.prop, 0, 1);
    g.translate(0.235, -0.497);
    g.scale(k, k);
    paint(g, poly([[-0.125, 0.0], [0.085, -0.014], [0.105, 0.006], [0.105, 0.02], [-0.105, 0.034], [-0.125, 0.014]]), K("laptop"), 0.007);
    g.strokeStyle = C.line;
    g.lineWidth = 0.004;
    g.beginPath();
    g.moveTo(-0.122, 0.012);
    g.lineTo(0.104, -0.002);
    g.stroke();
    // The screen's glowing edge, then the lid.
    paint(g, poly([[0.052, -0.012], [0.066, -0.01], [0.044, -0.17], [0.03, -0.17]]), "#BFE6FF", 0.005);
    const lid = poly([[0.066, -0.01], [0.1, 0.002], [0.08, -0.165], [0.044, -0.172]]);
    paint(g, lid, clothShade(g, "laptop", 0.06, -0.1, 0.12), 0.008);
    dot(g, 0.071, -0.085, 0.011, K("logo"), 0.004);
  } else if (outfit === "chef" && p.hide > 0.02) {
    // The frying pan he hides behind.
    const k = clamp(p.hide, 0, 1);
    g.translate(paw[0], paw[1]);
    g.scale(k, k);
    const c: Pt = [0.045, -0.21];
    noodle(g, hose([0.0, 0.02], [c[0] - 0.02, c[1] + 0.12], 0), 0.026, KS("pan"));
    const pan = new Path2D();
    pan.ellipse(c[0], c[1], 0.135, 0.128, 0, 0, TAU);
    const pg = g.createRadialGradient(c[0] - 0.03, c[1] - 0.04, 0.01, c[0], c[1], 0.14);
    pg.addColorStop(0, "#5A5E68");
    pg.addColorStop(1, K("pan"));
    paint(g, pan, pg, 0.01);
    g.strokeStyle = "rgba(255,255,255,0.18)";
    g.lineWidth = 0.012;
    g.beginPath();
    g.ellipse(c[0], c[1], 0.105, 0.098, 0, 0, TAU);
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = 0.012;
    g.beginPath();
    g.ellipse(c[0], c[1], 0.11, 0.104, 0, -2.7, -1.9);
    g.stroke();
    dot(g, c[0] - 0.012, c[1] + 0.11, 0.008, KS("pan"), 0.004);
  }
  g.restore();
}

/** In front of everything: the hero wrapped in his cape, the detective's collar turned up. */
function drawOutfitFront(g: CanvasRenderingContext2D, p: Pose, hc: Pt, nb: Pt) {
  const k = clamp(p.hide, 0, 1);
  if (k < 0.01) return;
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  if (outfit === "hero") {
    // Wrapped up to his eyes, peeking over the top, paws on the edge.
    const top = hc[1] + 0.012;
    const L = hc[0] - 0.19, R = hc[0] + 0.3;
    g.beginPath();
    g.rect(-1, lerp(0.1, top - 0.1, k), 2, 2);
    g.clip();
    const wrap = new Path2D();
    wrap.moveTo(L, top + 0.035);
    wrap.quadraticCurveTo(hc[0] + 0.05, top - 0.04, R, top + 0.01);
    wrap.bezierCurveTo(R + 0.07, top + 0.1, R - 0.02, top + 0.4, hc[0] + 0.03, -0.07);
    wrap.quadraticCurveTo(hc[0] - 0.08, -0.05, hc[0] - 0.16, -0.085);
    wrap.bezierCurveTo(L - 0.06, top + 0.42, L - 0.07, top + 0.12, L, top + 0.035);
    wrap.closePath();
    paint(g, wrap, clothShade(g, "cape", hc[0], top + 0.2, 0.4), 0.009);
    g.save();
    g.clip(wrap);
    g.fillStyle = K("capeInside");
    g.beginPath();
    g.moveTo(L - 0.05, top + 0.03);
    g.quadraticCurveTo(hc[0] + 0.03, top - 0.035, R + 0.05, top + 0.008);
    g.lineTo(R + 0.05, top + 0.04);
    g.quadraticCurveTo(hc[0] + 0.03, top, L - 0.05, top + 0.065);
    g.closePath();
    g.fill();
    g.strokeStyle = KS("cape");
    g.lineWidth = 0.012;
    g.beginPath();
    for (const x of [-0.12, 0.02, 0.17]) {
      g.moveTo(hc[0] + x, top + 0.07);
      g.quadraticCurveTo(hc[0] + x * 0.6 + 0.02, top + 0.3, hc[0] + x * 0.5, 0);
    }
    g.stroke();
    g.restore();
    for (const x of [-0.07, 0.2]) {
      g.save();
      g.translate(hc[0] + x, top + 0.012 - 0.01 * (x > 0 ? 1 : 0));
      g.fillStyle = C.furLight;
      g.beginPath();
      g.ellipse(0, 0, 0.03, 0.022, 0, 0, TAU);
      g.fill();
      g.strokeStyle = C.line;
      g.lineWidth = 0.008;
      g.stroke();
      g.lineWidth = 0.006;
      g.beginPath();
      for (const dx of [-0.009, 0.009]) {
        g.moveTo(dx, -0.02);
        g.lineTo(dx, -0.004);
      }
      g.stroke();
      g.restore();
    }
  } else if (outfit === "detective") {
    // His coat collar turned up round his face: two lapel points standing up,
    // hiding snout and mouth (only the hat and eyes show), rising out of the coat.
    const bottom = nb[1] + 0.24;
    const [x, y] = hc;
    g.beginPath();
    g.rect(-2, lerp(bottom + 0.02, y - 0.25, Ease.outCubic(smoothstep(0.08, 1, k))), 4, 4);
    g.clip();
    g.translate(nb[0], bottom);
    g.scale(lerp(0.5, 1, k), lerp(0.7, 1, k));
    g.translate(-nb[0], -bottom);
    // One piece rising out of the coat's shoulders: up the back to the back
    // point, a sagging edge down between his eyes and snout, up to the front
    // point, then down past his snout and back into the coat's chest.
    const backPt: Pt = [x - 0.23, y - 0.09], dip: Pt = [x + 0.1, y + 0.035], frontPt: Pt = [x + 0.43, y - 0.08];
    const edge = new Path2D();
    edge.moveTo(nb[0] - 0.1, bottom);
    edge.quadraticCurveTo(nb[0] - 0.13, y + 0.1, backPt[0], backPt[1]);
    edge.quadraticCurveTo(x - 0.06, y - 0.0, dip[0], dip[1]);
    edge.quadraticCurveTo(x + 0.26, y - 0.0, frontPt[0], frontPt[1]);
    edge.quadraticCurveTo(x + 0.42, y + 0.2, x + 0.34, y + 0.29);
    edge.quadraticCurveTo(nb[0] + 0.2, bottom - 0.04, nb[0] + 0.1, bottom);
    const collar = new Path2D(edge);
    collar.closePath();
    g.fillStyle = clothShade(g, "coat", x, y + 0.05, 0.36);
    g.fill(collar);
    g.save();
    g.clip(collar);
    // The darker underside turned out along the top, between the points.
    g.fillStyle = K("coatDark");
    g.beginPath();
    g.moveTo(backPt[0] - 0.02, backPt[1] - 0.02);
    g.quadraticCurveTo(x - 0.06, y - 0.0, dip[0], dip[1] - 0.01);
    g.quadraticCurveTo(x + 0.26, y - 0.0, frontPt[0] + 0.02, frontPt[1] - 0.02);
    g.lineTo(frontPt[0] - 0.01, frontPt[1] + 0.05);
    g.quadraticCurveTo(x + 0.26, y + 0.05, dip[0], dip[1] + 0.035);
    g.quadraticCurveTo(x - 0.06, y + 0.05, backPt[0] + 0.01, backPt[1] + 0.055);
    g.closePath();
    g.fill();
    // Where the collar folds over, and the coat's front edge below the dip.
    g.strokeStyle = KS("coat");
    g.lineWidth = 0.008;
    g.beginPath();
    g.moveTo(backPt[0] + 0.03, backPt[1] + 0.11);
    g.quadraticCurveTo(x + 0.1, y + 0.12, frontPt[0] - 0.01, frontPt[1] + 0.12);
    g.stroke();
    g.strokeStyle = C.line;
    g.lineWidth = 0.007;
    g.beginPath();
    g.moveTo(dip[0], dip[1] + 0.035);
    g.quadraticCurveTo(x + 0.15, y + 0.2, x + 0.13, bottom + 0.02);
    g.stroke();
    g.restore();
    g.strokeStyle = C.line;
    g.lineWidth = 0.009;
    g.stroke(edge);
    dot(g, x + 0.22, y + 0.17, 0.012, K("coatDark"));
    dot(g, x + 0.23, y + 0.25, 0.012, K("coatDark"));
  }
  g.restore();
}

// ── Outfits: asleep ───────────────────────────────────────────────────────────

/** The main cloth of each outfit, for the blanket he sleeps under. */
const BLANKET: Record<OutfitName, string> = {
  cozy: "scarf", desi: "jacket", detective: "coat", hero: "cape", rainy: "coat",
  coder: "hoodie", pyjamas: "pj", chef: "apron", dapper: "vest",
};

/** The outfit spread over him like a blanket. */
function drawBlanket(g: CanvasRenderingContext2D, bl: Path2D, f: Frame) {
  g.save();
  g.lineCap = "round";
  g.fillStyle = clothShade(g, BLANKET[outfit], -0.14, -0.2, 0.3);
  g.fill(bl);
  g.save();
  g.clip(bl);
  switch (outfit) {
    case "desi":
      // A maroon shawl with a gold border.
      g.strokeStyle = K("gold");
      g.lineWidth = 0.03;
      g.stroke(bl);
      for (const [x, y] of [[-0.24, -0.15], [-0.15, -0.2], [-0.06, -0.16], [-0.18, -0.09]] as const) dot(g, x, y, 0.012, K("gold"), 0.004);
      break;
    case "detective":
      g.fillStyle = K("coatDark");
      g.fillRect(-0.2, -0.3, 0.035, 0.3);
      for (const y of [-0.2, -0.13, -0.06]) dot(g, -0.08, y, 0.01, K("coatDark"));
      break;
    case "hero":
      g.strokeStyle = K("capeInside");
      g.lineWidth = 0.03;
      g.stroke(bl);
      dot(g, 0.0, -0.2, 0.022, K("emblem"));
      break;
    case "rainy":
      for (const y of [-0.21, -0.14, -0.07]) {
        g.save();
        g.translate(-0.06, y);
        const tog = new Path2D();
        tog.ellipse(0, 0, 0.019, 0.008, -0.2, 0, TAU);
        paint(g, tog, K("coatDark"), 0.005);
        g.restore();
      }
      break;
    case "coder":
      g.fillStyle = K("hoodieLight");
      g.fillRect(-0.4, -0.05, 0.5, 0.06);
      dot(g, -0.12, -0.17, 0.022, K("logo"));
      break;
    case "pyjamas":
      g.strokeStyle = K("stripe");
      g.lineWidth = 0.022;
      g.beginPath();
      for (const x of [-0.3, -0.22, -0.14, -0.06, 0.02]) {
        g.moveTo(x - 0.03, -0.29);
        g.quadraticCurveTo(x + 0.03, -0.12, x, 0.02);
      }
      g.stroke();
      break;
    case "chef":
      // A red gingham tablecloth.
      g.fillStyle = K("neckerchief");
      g.globalAlpha *= 0.45;
      for (let x = -0.4; x < 0.1; x += 0.05) g.fillRect(x, -0.3, 0.025, 0.32);
      for (let y = -0.3; y < 0.05; y += 0.05) g.fillRect(-0.4, y, 0.5, 0.025);
      break;
    case "dapper":
      argyle(g, -0.36, -0.28, 0.06, 0.0, 0.03, 0.042, f);
      break;
  }
  g.restore();
  g.strokeStyle = C.line;
  g.lineWidth = 0.009;
  g.stroke(bl);
  g.restore();
}

/** A little striped pillow under his head. */
function drawPillow(g: CanvasRenderingContext2D) {
  const pillow = new Path2D();
  pillow.ellipse(0.22, -0.03, 0.2, 0.042, -0.03, 0, TAU);
  g.save();
  paint(g, pillow, K("stripe"), 0.008);
  g.clip(pillow);
  g.strokeStyle = K("pj");
  g.lineWidth = 0.012;
  g.beginPath();
  for (let x = 0.04; x < 0.44; x += 0.05) {
    g.moveTo(x, -0.1);
    g.lineTo(x + 0.01, 0.02);
  }
  g.stroke();
  g.restore();
}

export const dogesh: Skin = {
  id: "dogesh",
  // Tall for his jumps: room above for flying ears.
  fit: { units: 1.6, base: 0.88 },
  // Head to feet, tail to nose (a leap or flying ears can poke above this).
  hit: { x0: 0.32, y0: 0.25, x1: 0.77, y1: 0.9 },
  rest,
  restEye: "round",
  pose,
  events,
  draw,
};
