# Character Animation and Behavior Specification

Implementation spec for three original mascot characters (Kulhi, Hexo, Glim) used in a device-help assistant app. This document is meant to be given to an AI coding assistant to implement the character system.

---

## 0. Instructions for the AI coding assistant

1. Implement one shared **character engine** (state machine, timing, layered animation) and three **character skins** that define parts and per-state poses. Do not write three separate engines.
2. Read Section 2 (state machine) and Section 3 (layer system) before writing code.
3. Respect the timing, easing, and transition rules exactly; they define the personality.
4. Support `prefers-reduced-motion` / OS reduced-motion settings (Section 8).
5. Expose the public API in Section 6 so the rest of the app can drive the character.
6. Ask the developer which platform they target (web, Android, iOS, Flutter) before writing platform code. The recommended approach is in Section 9.

---

## 1. Characters and their rigs

Each character is built from separately animatable parts. All positions are relative to the character's origin (center of the base). Units: 1 unit = character height.

### 1.1 Kulhi (clay tea cup)
| Part | Description | Animatable properties |
|---|---|---|
| `body` | Tapered cup | scaleX, scaleY, rotation, y |
| `rim` | Rolled top lip | follows body |
| `chaiSurface` | Liquid inside rim | tilt (slosh), color brightness |
| `eyeL`, `eyeR` | Vertical ovals | scaleX, scaleY (blink), x/y offset (gaze), shape morph (oval, arc, line) |
| `mouth` | Small curve | curve amount, open amount |
| `armL`, `armR` | Nub arms | rotation, y |
| `steam` | Bezier ribbon with 4–5 control points | per-point offsets, opacity, length, curl amount |

**Signature behavior:** the steam path is procedural (sine-driven control points), not a fixed sprite.

### 1.2 Hexo (hex-nut buddy)
| Part | Description | Animatable properties |
|---|---|---|
| `body` | Rounded hexagon slab | scaleX, scaleY, rotation, y |
| `screen` | Dark glass face disc | brightness, scanline overlay |
| `eyes` | Glyph renderer inside screen | glyph (pills, arcs, dots, check, question, lines), glow intensity |
| `ring` | Glowing ring around screen | intensity, progress (0–1 arc fill), pulse |
| `antenna` | Bolt antenna with tip | rotation (spring), tip color, tip blink |
| `armL`, `armR`, `footL`, `footR` | Short limbs | rotation, y |

**Signature behavior:** eyes are a glyph system; the ring doubles as a progress indicator.

### 1.3 Glim (firefly)
| Part | Description | Animatable properties |
|---|---|---|
| `body` | Teardrop | x, y (hover path), rotation (tilt), scale |
| `eyeL`, `eyeR` | Large rounds | scaleY (blink), gaze offset, shape morph |
| `mouth` | Tiny curve | curve amount |
| `wingL`, `wingR` | Translucent leaves | rotation (flutter), fold amount |
| `antennaL`, `antennaR` | Soft antennae | rotation (spring follow) |
| `orb` | Glowing tail light | intensity, glow radius, color |
| `trail` | Optional light trail | opacity, length |

**Signature behavior:** Glim always hovers on a slow Lissajous path; it never sits still except when asleep.

---

## 2. State machine

### 2.1 States

| State | Meaning | Trigger |
|---|---|---|
| `OFF` | Not rendered / app cold start | initial |
| `BOOTING` | Waking up from off | app launch, character first shown |
| `IDLE` | Waiting, relaxed | default resting state |
| `ATTENTIVE` | User is typing or about to interact | input focused / user typing |
| `TOUCHED` | One-shot reaction to tap | user taps the character |
| `WORKING` | Processing a request | search or agent task started |
| `SUCCESS` | Confident answer found | result with high confidence |
| `SUGGESTING` | Partial match, offering options | result with medium confidence |
| `CONFUSED` | Could not understand | low confidence / fallback |
| `ERROR` | Technical failure | network or server error |
| `NOTIFY` | Has something for the user | notification arrives |
| `SLEEPY` | About to sleep | idle timeout warning |
| `SLEEPING` | Asleep, minimal animation | idle timeout reached |
| `WAKING` | Waking from sleep | any interaction while sleeping |

### 2.2 Transitions

```
OFF ──launch──▶ BOOTING ──done──▶ IDLE

IDLE ──input focus──▶ ATTENTIVE ──input blur (2s)──▶ IDLE
IDLE / ATTENTIVE ──tap──▶ TOUCHED ──done──▶ (previous state)
IDLE / ATTENTIVE ──task start──▶ WORKING

WORKING ──result: confidence ≥ HIGH──▶ SUCCESS ──2.5s──▶ IDLE
WORKING ──result: LOW ≤ confidence < HIGH──▶ SUGGESTING ──user picks / 6s──▶ IDLE
WORKING ──result: confidence < LOW──▶ CONFUSED ──3s──▶ IDLE
WORKING ──error──▶ ERROR ──3s──▶ IDLE
WORKING ──timeout (15s)──▶ ERROR

any except SLEEPING/OFF ──notification──▶ NOTIFY ──acknowledged / 5s──▶ (previous state)

IDLE ──no interaction 45s──▶ SLEEPY ──no interaction 15s more──▶ SLEEPING
SLEEPY ──any interaction──▶ IDLE
SLEEPING ──any interaction / notification──▶ WAKING ──done──▶ IDLE (then NOTIFY if triggered by notification)
```

### 2.3 Rules
- **One-shot states** (`TOUCHED`, `SUCCESS`, `CONFUSED`, `ERROR`, `NOTIFY`) return to a defined state when finished. Store the previous state for `TOUCHED` and `NOTIFY`.
- **Priority** (higher interrupts lower): `ERROR` > `NOTIFY` > `WORKING` > `SUCCESS`/`SUGGESTING`/`CONFUSED` > `TOUCHED` > `ATTENTIVE` > `IDLE` > `SLEEPY` > `SLEEPING`.
- `TOUCHED` during `WORKING` plays only a small wiggle layered on top; it does not leave `WORKING`.
- Tapping more than 5 times within 3 seconds triggers a special "dizzy" variant of `TOUCHED` (Section 4.4).
- Never transition by snapping. Every state change crossfades poses over 150–300 ms (Section 5).
- `HIGH` and `LOW` confidence thresholds come from app config, the same values the search backend uses.

---

## 3. Layered animation system

Each frame, the final pose is the sum of these layers, evaluated in order:

1. **Base pose** for the current state (blended during transitions).
2. **Breathing layer**: continuous, always on except `OFF`.
3. **Blink layer**: random blinks, suppressed in `SLEEPING` and during eye-shape morphs.
4. **Gaze layer**: eyes follow the user's touch or cursor, or drift randomly in `IDLE`.
5. **Signature layer**: steam (Kulhi), ring and antenna (Hexo), hover, wings, orb (Glim).
6. **One-shot overlay**: tap wiggles, sparkles, puffs.

### 3.1 Breathing (all characters)
- `body.scaleY = 1 + A * sin(2π t / P)`, `body.scaleX = 1 - A * 0.5 * sin(2π t / P)` (volume preservation).
- IDLE: A = 0.015, P = 3.2 s. SLEEPING: A = 0.025, P = 5 s. WORKING: A = 0.01, P = 1.6 s.

### 3.2 Blink
- Random interval 2.5–6 s; 15% chance of a double blink (gap 180 ms).
- Blink duration 140 ms: close 60 ms (ease-in), hold 20 ms, open 60 ms (ease-out).
- Hexo: blink by scaling eye glyph height to 10%, and dim the glow by 40% during the blink.

### 3.3 Gaze
- Max eye offset: 6% of eye-area width.
- Follow target with a critically damped spring (stiffness 120, damping 2*sqrt(stiffness)).
- In IDLE with no input, pick a random gaze point every 2–4 s; return to center 30% of the time.

### 3.4 Secondary motion (springs)
Antennae, steam tip, and wings follow body motion through springs (stiffness 180, damping 12) so they lag and overshoot slightly. This is what makes the characters feel alive; do not skip it.

---

## 4. State-by-state animation details

Timings in milliseconds. Easing names refer to Section 5.

### 4.1 BOOTING (total about 1600 ms)
| Kulhi | Hexo | Glim |
|---|---|---|
| 0–300: empty cup fades/scales in from 0.8 to 1 (easeOutBack). 300–600: eyes open (blink-open). 600–900: tiny steam puff appears at chai surface. 900–1400: steam rises and curls to full length (easeOutCubic). 1400–1600: small hop and happy eyes. | 0–300: body appears, screen black. 300–700: a cyan scanline sweeps top to bottom across the screen. 700–1100: ring lights up in 6 segments, one every 60 ms. 1100–1300: eyes fade in as pills. 1300–1600: antenna springs up (overshoot) and tip blinks once. | 0–400: dim orb glows on the ground. 400–800: orb brightens, body fades in above it. 800–1200: wings unfold (easeOutBack), body lifts 0.15 units. 1200–1600: eyes open, quick happy 360° spin. |

### 4.2 IDLE (looping)
- **Kulhi:** steam control points driven by layered sines (periods 2.8 s and 4.1 s), curl alternating left and right; chai surface tilts ±2° with body. Every 12–20 s, a random "idle flourish": steam forms a small loop or Kulhi glances around.
- **Hexo:** ring pulses intensity 0.6 to 0.85 over 2.5 s; antenna sways ±4°. Every 15–25 s, a flourish: eyes glance to one side, or a tiny body tilt like stretching.
- **Glim:** hover path `x = 0.04 sin(t * 0.9)`, `y = 0.05 sin(t * 1.3)`; wings flutter ±12° at 8 Hz in short bursts (1 s on, 1.5 s glide); orb pulse 0.7 to 1.0 over 2 s.

### 4.3 ATTENTIVE
- Eyes slightly larger (scale 1.08), gaze locks toward the input field position.
- Kulhi: steam straightens 50%. Hexo: antenna upright, ring intensity 0.9. Glim: hover amplitude halved, antennae perk forward.
- While the user types, small "listening" reaction on each keystroke burst (throttle to once per 400 ms): a 2% squash pulse.

### 4.4 TOUCHED (one-shot, about 600 ms)
- 0–120: squash (scaleY 0.88, scaleX 1.1), easeOutQuad.
- 120–300: stretch (scaleY 1.08, scaleX 0.94), easeOutQuad.
- 300–600: settle to 1.0 with easeOutElastic (small amplitude).
- Eyes switch to happy arcs during 120–500.
- Kulhi: steam puffs into a small curl. Hexo: smile curve appears on screen, ring flashes. Glim: quick spin, orb flash.
- **Dizzy variant** (5+ taps in 3 s): eyes become spirals or swirls for 1200 ms, body wobbles ±8° twice, then returns to IDLE with a small "phew" (eyes close briefly).

### 4.5 WORKING (looping until result)
- **Kulhi:** steam forms a rotating spiral (rotate control points around the steam axis, one revolution per 1.4 s); eyes look up-left (thinking); body bobs 1.5% at 1.6 s period.
- **Hexo:** body rotates ±15° back and forth like tightening a nut (period 900 ms, easeInOutSine); eyes switch to three loading dots that light in sequence (each 200 ms); ring acts as a progress indicator. If real progress is known, fill to that value; otherwise loop 0 to 1 every 1.5 s.
- **Glim:** flies a small figure-eight (`x = 0.12 sin(t * 2.2)`, `y = 0.06 sin(t * 4.4)`), leaving a faint orb-colored trail (opacity 0.4, fades over 400 ms); eyes focused (slightly narrowed).
- After 5 s in WORKING, add a subtle "still working" cue every 3 s (a small determined nod) so it never looks frozen.

### 4.6 SUCCESS (one-shot, about 2500 ms)
- Small hop (0.08 units, 400 ms, easeOutBack), eyes become closed happy arcs.
- Kulhi: steam forms a sparkle shape. Hexo: eyes become a checkmark glyph, ring full and bright. Glim: three small sparkles burst around the orb.
- Then settle into IDLE.

### 4.7 SUGGESTING (holds until user chooses or 6 s)
- Curious head tilt (8°), one eye slightly larger.
- Kulhi: steam bends toward the suggestion list. Hexo: antenna points toward suggestions, eyes become pills tilted toward them. Glim: drifts toward the suggestion list and hovers near it.
- When the user picks a suggestion, play a short SUCCESS (1200 ms version).

### 4.8 CONFUSED (one-shot, about 3000 ms)
- Head tilt alternating ±6° twice (600 ms each), eyes slightly tilted (worried).
- Kulhi: steam forms a question-mark curl. Hexo: question-mark glyph on screen, ring dims. Glim: antennae droop, orb dims.
- This state should feel apologetic and gentle, never sad or broken. Pair it with UI copy asking the user to describe the problem differently.

### 4.9 ERROR (one-shot, about 3000 ms)
- Small slump (body y down 3%, 300 ms), eyes worried.
- Kulhi: steam flickers and wobbles. Hexo: brief screen static (noise overlay 300 ms), ring turns soft orange (#FFB070) then returns. Glim: orb flickers twice.
- Then a recovering "shake it off" (quick ±5° wiggle) and back to IDLE.

### 4.10 NOTIFY (holds until acknowledged or 5 s)
- Entry (400 ms): quick hop or zip toward the viewer (scale 1.0 to 1.12, easeOutBack), eyes wide.
- Loop: attention pulse every 1.2 s.
- Kulhi: steam shoots straight up into a small puff on each pulse. Hexo: antenna tip blinks coral twice per pulse. Glim: orb flashes twice per pulse.
- If the app provides a notification badge position, the character glances toward it.
- On acknowledgement: happy eyes for 500 ms, then return to the previous state.

### 4.11 SLEEPY (about 15 s window)
- Slow yawn at entry (mouth opens over 600 ms, holds 400 ms, closes 600 ms).
- Eyes half closed; slow blinks every 2 s that close longer (400 ms).
- Kulhi: steam shrinks to 50% and droops. Hexo: glow dims to 50%, antenna droops. Glim: hover lowers, wings flutter less.

### 4.12 SLEEPING (looping)
- Transition in (1200 ms): eyes close fully, body settles lower (y down 4%), breathing switches to sleep values.
- Kulhi: steam reduced to a faint short wisp (opacity 0.25) rising slowly. Hexo: screen almost black, eyes are dim horizontal lines, ring off except a very slow faint pulse (6 s period). Glim: lands on the ground, wings folded, orb at 20% with slow pulse.
- Optional: tiny floating "z" shapes drawn as simple vector curls (no text glyph) every 4 s.
- Reduce render rate to 15–20 fps while sleeping to save battery.

### 4.13 WAKING (about 900 ms)
- Eyes open with a quick double blink, body springs back to normal height (easeOutBack), signature element restores (steam grows, ring relights, Glim lifts off).
- If woken by a notification, chain directly into NOTIFY.

---

## 5. Timing and easing reference

| Name | cubic-bezier | Use |
|---|---|---|
| easeOutBack | (0.34, 1.56, 0.64, 1) | Pops, hops, appearances |
| easeOutCubic | (0.33, 1, 0.68, 1) | Growing, rising |
| easeInOutSine | (0.37, 0, 0.63, 1) | Loops, sways |
| easeOutQuad | (0.5, 1, 0.89, 1) | Squash and stretch |
| easeInQuad | (0.11, 0, 0.5, 0) | Settling down, falling asleep |
| easeOutElastic | spring: stiffness 300, damping 10 | Settles after tap |

- State-to-state pose crossfade: 200 ms default, 300 ms into or out of SLEEPING, 150 ms into TOUCHED and NOTIFY.
- Target 60 fps in active states; 15–20 fps in SLEEPING; pause entirely when the character is off-screen or the app is backgrounded.

---

## 6. Public API

```ts
type CharacterId = "kulhi" | "hexo" | "glim";

interface CharacterController {
  setCharacter(id: CharacterId): void;          // swap skin, keep current state
  boot(): Promise<void>;                        // OFF -> BOOTING -> IDLE
  inputFocused(focused: boolean): void;         // ATTENTIVE on/off
  userTyping(): void;                           // listening pulse
  tap(): void;                                  // TOUCHED (or dizzy)
  startWork(): void;                            // WORKING
  setProgress(value: number | null): void;      // 0..1, null = indeterminate
  finishWork(result: {
    confidence: number;                         // 0..1 from search backend
    error?: boolean;
  }): void;                                     // -> SUCCESS / SUGGESTING / CONFUSED / ERROR
  suggestionPicked(): void;                     // SUGGESTING -> short SUCCESS
  notify(opts?: { badgeX?: number; badgeY?: number }): void; // NOTIFY
  acknowledge(): void;                          // close NOTIFY
  activity(): void;                             // resets idle timer
  setGazeTarget(x: number, y: number): void;    // optional, screen coords
  setReducedMotion(enabled: boolean): void;
  onStateChange(cb: (from: string, to: string) => void): () => void;
}
```

`finishWork` maps confidence to states using the same HIGH and LOW thresholds as the search backend, loaded from app config.

---

## 7. Integration with the device-help search

| App event | Character call |
|---|---|
| App opened | `boot()` |
| Search box focused / blurred | `inputFocused(true/false)` |
| User typing | `userTyping()` and `activity()` |
| Search submitted | `startWork()` |
| Result: matched (high confidence) | `finishWork({ confidence })` → SUCCESS |
| Result: "did you mean" options | `finishWork({ confidence })` → SUGGESTING |
| Result: fallback | `finishWork({ confidence })` → CONFUSED |
| Network/server error | `finishWork({ confidence: 0, error: true })` |
| Push or in-app notification | `notify()` |
| Any touch anywhere in app | `activity()` |

UI copy pairs (English and Hindi/Hinglish versions should be provided by the app, not drawn into the character):
- CONFUSED: "I didn't quite get that. Can you describe it differently?" / "Samajh nahi aaya, thoda alag tarike se batayenge?"
- SUGGESTING: "Did you mean one of these?" / "Kya aapka matlab inme se kuch hai?"

---

## 8. Accessibility

- **Reduced motion:** replace loops with static poses; keep only opacity and eye-glyph changes; no hops, spins, or hover paths. Transitions become 150 ms crossfades.
- Never use the character as the only signal. Every state that matters (working, result, error, notification) must also be communicated by text or a standard UI element.
- Provide an accessible label that reflects the state, e.g. "Assistant is searching", "Assistant found a match".
- Notification flashes must stay under 3 flashes per second.
- Ensure the character never covers interactive UI; respect safe areas.

---

## 9. Recommended implementation approach

**Preferred: Rive.** Rive supports bones, state machines, inputs (booleans, numbers, triggers), and blend states natively, with runtimes for web, Android, iOS, Flutter, and React Native.
- Build one Rive file per character with identical state machine input names: `state` (number), `tap` (trigger), `notify` (trigger), `progress` (number), `confidence` (number), `reducedMotion` (boolean).
- The app-side `CharacterController` (Section 6) translates app events into Rive inputs and owns timers (idle timeout, one-shot durations).
- Procedural layers (gaze, steam bezier, Glim hover path) can be driven by Rive numeric inputs updated from code each frame, or built inside Rive with constraints.

**Alternative: pure code (SVG/Canvas, Jetpack Compose, or SwiftUI).** Each part is a shape; the engine computes per-frame transforms from the layer system in Section 3. This gives full control, but takes more effort to make it look polished.

**Not recommended as the main approach: Lottie.** It plays fixed clips well but has no built-in state machine or procedural layers. It is acceptable only for the BOOTING sequence or marketing animations.

---

## 10. Asset and performance requirements

- Vector source for all parts; no raster textures except optional subtle noise for Kulhi's clay.
- Character must read clearly at 48x48, 96x96, and 240x240 pixels. Provide a simplified LOD for 48x48 (drop glaze specks, ring grooves, wing veins).
- Total Rive file per character under 150 KB.
- CPU budget: under 2 ms per frame on a mid-range Android device in active states.

---

## 11. Definition of done

- [ ] Shared engine with state machine, priorities, and transitions from Section 2
- [ ] All four layers (breathing, blink, gaze, secondary springs) working
- [ ] All 14 states implemented for all three characters
- [ ] Public API from Section 6 with unit tests for transitions and confidence mapping
- [ ] Integration hooks from Section 7 wired to search events
- [ ] Reduced-motion mode verified
- [ ] Sleep mode reduces frame rate; animation pauses when hidden
- [ ] Characters verified at 48, 96, and 240 px