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

function pose(i: PoseInput): PoseOut {
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
      const cycle = Math.floor((t + 3) / 7);
      const into = t + 3 - cycle * 7;
      const w = into < 2.6 ? smoothstep(0, 0.25, into) * smoothstep(2.6, 2.3, into) : 0;
      if (w <= 0) return { pose: base, eye: "round" };
      const act = Math.floor(hash01(cycle + 21) * 6);
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

  drawTail(g, p);
  drawScarfEnd(g, p, nb, f);

  // The far legs and arm, behind the body.
  if (run > 0.4) drawWheelBlur(g, run);
  drawLeg(g, HIP_L, footL, p.kneeL, f);
  drawArm(g, shL, [p.pawLX, p.pawLY], -1, f);

  drawTorso(g, p);
  drawLeg(g, HIP_R, footR, p.kneeR, f);

  // Thin neck, the scarf round it, and the head on top.
  g.save();
  noodle(g, hose(nb, [hc[0] - 0.04, hc[1] + 0.11], 0.1), 0.05);
  g.restore();
  drawScarfBand(g, p, nb, f);

  g.save();
  g.translate(hc[0], hc[1]);
  g.rotate(p.headTilt);
  g.scale(HEAD_SCALE, HEAD_SCALE);
  drawHead(g, p, eye, f);
  g.restore();

  drawArm(g, shR, [p.pawRX, p.pawRY], 1, f);
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

function drawLeg(g: CanvasRenderingContext2D, hip: Pt, foot: Pt, knee: number, f: Frame) {
  g.save();
  noodle(g, hose(hip, foot, -knee), 0.034);
  // A small knobby foot, toes forward.
  g.translate(foot[0] + 0.02, foot[1]);
  g.fillStyle = C.furLight;
  g.beginPath();
  g.ellipse(0, 0, 0.043, 0.022, 0, 0, TAU);
  g.fill();
  g.strokeStyle = C.line;
  g.lineWidth = 0.008;
  g.stroke();
  if (f.detail > 0.3) {
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

function drawArm(g: CanvasRenderingContext2D, shoulder: Pt, paw: Pt, side: -1 | 1, f: Frame) {
  // Elbows bow forward, except reaching up behind his head (scratching), where
  // the arm curves back so it never crosses his eyes.
  const behind = clamp((-paw[1] - 0.8) / 0.15, 0, 1) * clamp((shoulder[0] + 0.1 - paw[0]) / 0.06, 0, 1);
  g.save();
  noodle(g, hose(shoulder, paw, 0.35 * side * (1 - 2 * behind)), 0.03);
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

  drawMuzzle(g);
  drawCheek(g, p, f);
  drawEye(g, EYE_L, -1, eye, p, f);
  drawEye(g, EYE_R, 1, eye, p, f);
  drawNose(g, 0.262, 0.045);
  drawMouth(g, p, f);
  if (p.hide > 0.01) drawHood(g, p, f);
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

  // The scarf spread over him like a blanket, fringe hanging down at the back.
  const bl = new Path2D();
  bl.moveTo(-0.35, -0.03);
  bl.bezierCurveTo(-0.37, -0.17, -0.26, -0.27, -0.11, -0.265);
  bl.bezierCurveTo(0.0, -0.26, 0.06, -0.2, 0.05, -0.13);
  bl.quadraticCurveTo(0.0, -0.08, 0.02, -0.025);
  bl.quadraticCurveTo(-0.16, -0.005, -0.35, -0.03);
  bl.closePath();
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
    g.save();
    g.globalAlpha *= Math.sin(Math.PI * k);
    g.translate(hx + 0.36 + 0.04 * Math.sin(k * 9), hy + 0.04 - 0.2 * k);
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
    g.translate(hx + 0.04, hy - 0.36 + 0.01 * Math.sin(f.t * 3));
    g.scale(p.qmark, p.qmark);
    g.rotate(0.15);
    g.strokeStyle = C.scarfDark;
    g.lineWidth = 0.024;
    g.lineCap = "round";
    g.beginPath();
    g.arc(0, -0.035, 0.035, Math.PI * 1.05, Math.PI * 2.45);
    g.quadraticCurveTo(0.003, 0.01, 0.0, 0.03);
    g.stroke();
    g.fillStyle = C.scarfDark;
    g.beginPath();
    g.arc(0, 0.065, 0.014, 0, TAU);
    g.fill();
    g.restore();
  }
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
