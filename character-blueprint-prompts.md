# Character Blueprint Prompts

Image-generation prompts for three original mascot characters for a device-help assistant app. Each character has a master blueprint sheet prompt plus individual panel prompts (image models often produce cleaner results one panel at a time).

---

## 0. How to use this file

1. Start with the **master sheet prompt** for a character. If the result is cluttered or inconsistent, generate the **individual panels** instead and assemble them in Figma.
2. Always append the **Shared Style Block** and **Shared Negative Prompt** to every prompt.
3. Generate the turnaround first. Once you have a front view you like, use it as a reference image (image-to-image or character reference) for all other panels to keep the character consistent.
4. Image models are bad at text. Ask for empty label boxes, then add labels, hex codes, and arrows yourself in Figma.
5. Recommended aspect ratios: master sheet 16:9; turnaround 21:9 or 16:9; expression sheet 1:1; animation strips 21:9.

---

## 1. Shared Style Block (append to every prompt)

> Original mascot character design, professional animation model sheet, soft 3D toy-like render with gentle subsurface shading, rounded forms, matte vinyl material, soft studio lighting from top-left, subtle contact shadows, clean light gray background (#F2F4F7) with faint light-blue blueprint grid lines, consistent proportions across all views, crisp edges, high detail, friendly and calm personality, designed to read clearly at small sizes on a 2-inch screen and a phone app icon.

## 2. Shared Negative Prompt

> no text, no letters, no logos, no watermarks, no brand marks, no existing cartoon characters, no fur, no rosy cheeks, no human hands with fingers, no realistic human features, no teeth, no scary expressions, no sharp spikes, no cluttered background, no inconsistent proportions between views, no extra limbs, no motion blur

---

## 3. Character A: KULHI (the chai cup companion)

### Identity
- **Concept:** A small, warm clay tea cup (kulhad) with a living steam wisp. Feels like comfort, patience, and "let me sort this out for you over chai."
- **Personality:** Warm, patient, a little playful. Never panics.
- **Signature feature:** The **steam wisp** above its head acts as its emotional antenna: it curls when relaxed, stands straight when alert, spirals when working, and fades when sleeping.
- **Why it works for your app:** Culturally familiar for Indian users without being a stereotype; instantly readable silhouette.

### Proportions and anatomy
- Body: a tapered cylinder, wider at the top (rim) than the base, about 1 unit tall, top diameter 0.9 units, base diameter 0.65 units.
- Rim: a slightly darker, thick rolled lip around the top edge.
- Inside the rim: visible chai surface (warm caramel color), slightly glossy.
- Face: on the front of the cup, upper-middle third. Two vertical oval eyes (dark espresso) each with one large and one small white highlight. A small soft curved mouth below.
- Steam wisp: a soft, semi-translucent ribbon rising from the chai surface, about 0.6 units tall, ending in a small curl.
- Limbs: two small stubby rounded nubs on the sides (no fingers), used for gestures. No legs; it hops or slides.
- Surface detail: subtle hand-made clay texture, a few tiny darker glaze specks, a faint thumbprint dent on the back (personality detail).

### Color palette
| Part | Hex |
|---|---|
| Clay body | #C8643B |
| Rim and shadows | #8E3F22 |
| Chai surface | #D9A066 |
| Steam wisp | #F4EFE6 at 70% opacity |
| Eyes | #2B1B14 |
| Eye highlights | #FFFFFF |
| Glaze specks | #7A3519 |

### Master sheet prompt
> Character model sheet blueprint for an original mascot named Kulhi: a small, chubby terracotta clay tea cup character (Indian kulhad) with a thick rolled rim, warm caramel chai visible inside, and a soft semi-translucent steam wisp rising from the top that ends in a gentle curl. Two vertical oval dark-brown eyes with white highlights and a small soft smile on the front of the cup, two tiny rounded nub arms on the sides, no legs. Subtle handmade clay texture with tiny darker glaze specks. Sheet layout: top row is a turnaround showing front, three-quarter front, side, three-quarter back, back, and top-down views; middle-left is a large hero pose with feature callout lines pointing to the rim, steam wisp, eyes, and nub arms with empty label boxes; middle-right is a color palette row of swatches (terracotta, dark rim brown, caramel, cream steam, espresso); bottom section is a 6-panel expression grid (happy, curious, thinking, surprised, sleepy, worried) and a row of small animation keyframe thumbnails showing idle steam curl, tap response squash, working steam spiral, notification hop, falling asleep, and boot-up.

### Individual panel prompts

**Turnaround**
> Turnaround model sheet of Kulhi, an original chubby terracotta clay tea cup mascot with a thick rolled rim, caramel chai inside, and a soft cream steam wisp curling above. Six evenly spaced views in a row at the same scale and ground line: front, three-quarter front, side, three-quarter back, back (showing a small thumbprint dent and no face), and top-down (showing chai surface and steam base). Neutral relaxed expression in all front-facing views.

**Expression sheet**
> Expression sheet of Kulhi, an original terracotta clay tea cup mascot, 3x3 grid, front view, same scale: neutral, happy (eyes become upward arcs, steam forms a heart-like curl), curious (one eye slightly larger, steam tilts into a question-mark shape), thinking (eyes look up-left, steam spirals), surprised (eyes wide circles, steam straight up and puffed), sleepy (eyes half-closed lines, steam droops), asleep (eyes closed curves, steam faded to a faint wisp), worried (eyes tilted, steam wobbly zigzag), success (eyes closed happy arcs, steam forms a small sparkle).

**Animation keyframe strips**
> Animation keyframe sheet of Kulhi, an original terracotta clay tea cup mascot, six horizontal strips of 5 frames each, labeled with empty boxes. Strip 1 idle: gentle breathing scale and the steam wisp slowly curling left then right. Strip 2 tap: squash down, stretch up, small bounce, happy eyes. Strip 3 working: steam forms a rotating spiral, eyes focused, body subtly bobbing. Strip 4 notification: quick hop, steam shoots straight up into a small puff, eyes wide. Strip 5 going to sleep: yawn, eyes drooping, steam shrinking and fading, body settling lower. Strip 6 boot up: empty cup with no steam, eyes open, a tiny puff appears, steam rises and curls, happy greeting.

---

## 4. Character B: HEXO (the device-repair buddy)

### Identity
- **Concept:** A rounded, friendly hex-nut character whose center hole is a dark glass face screen with glowing pill-shaped eyes. A tiny technician who loves fixing things.
- **Personality:** Curious, focused, encouraging. Gets visibly determined when working.
- **Signature feature:** The **glowing core ring** around the face screen and the **face screen eyes**, which can change into loading dots, checkmarks, and other symbols. When working, its whole body rotates slightly like a nut being tightened.
- **Why it works for your app:** Directly communicates "device help and repair" without being a literal phone.

### Proportions and anatomy
- Body: a thick hexagonal slab with heavily rounded corners and edges, about 1 unit wide and 0.4 units deep. Looks soft and toy-like, not sharp metal.
- Face: the center "hole" is a recessed circular dark glass screen, 0.5 units in diameter.
- Eyes: two glowing cyan vertical pills inside the screen. No mouth by default; a small glowing curve appears for smiles.
- Core ring: a thin glowing warm-yellow ring around the face screen, used for status (pulses, fills like a progress ring).
- Top: a tiny rounded bolt-shaped antenna with a small sphere tip.
- Limbs: two short rounded arms ending in mitten-like ends; two short rounded feet. It can float slightly when excited.
- Surface: matte soft-touch steel-blue finish, faint machined circular grooves on the flat faces.

### Color palette
| Part | Hex |
|---|---|
| Body | #3A7CA5 |
| Body shadow | #2A5C7C |
| Face screen | #1B2430 |
| Eyes | #7FE7FF |
| Core ring | #FFD166 |
| Antenna tip | #FF8C6B |
| Edge highlights | #A9D6EE |

### Master sheet prompt
> Character model sheet blueprint for an original mascot named Hexo: a chubby, rounded hexagonal hex-nut shaped character with heavily softened corners, matte steel-blue soft-touch finish, and a recessed circular dark glass face screen in the center where the nut's hole would be. Inside the screen, two glowing cyan vertical pill-shaped eyes. A thin glowing warm-yellow ring surrounds the face screen. A tiny rounded bolt-shaped antenna on top with a small coral sphere tip. Two short rounded mitten arms and two short rounded feet. Sheet layout: top row turnaround with front, three-quarter front, side (showing the thickness of the hexagonal slab), three-quarter back, back (with faint machined circular grooves), and top-down views; middle-left large hero pose with callout lines to the face screen, glowing ring, antenna, and limbs, with empty label boxes; middle-right color palette swatches (steel blue, dark navy screen, cyan glow, warm yellow ring, coral tip); bottom section a 6-panel screen-eye expression grid and a row of animation keyframe thumbnails: idle, tap, working spin, notification, sleep, boot-up.

### Individual panel prompts

**Turnaround**
> Turnaround model sheet of Hexo, an original rounded hexagonal hex-nut mascot with a matte steel-blue body, a recessed dark glass face screen with glowing cyan pill eyes, a thin glowing yellow ring around the screen, a tiny bolt antenna with a coral tip, short mitten arms and short feet. Six views at the same scale and ground line: front, three-quarter front, side showing slab thickness, three-quarter back, back with circular machined grooves and no face, and top-down.

**Expression sheet (screen eyes)**
> Expression sheet of Hexo's face screen, an original hex-nut mascot, 3x3 grid of close-up front views: neutral (two cyan pills), happy (eyes become upward arcs and a small glowing smile curve appears), curious (one pill taller than the other), thinking (three small cyan dots in a row like a loading indicator), surprised (two large cyan circles), determined (pills tilted inward like focused brows), sleepy (eyes become thin horizontal lines, glow dimmed), success (a single glowing cyan checkmark), confused (a small glowing question mark).

**Animation keyframe strips**
> Animation keyframe sheet of Hexo, an original hex-nut mascot, six horizontal strips of 5 frames each with empty label boxes. Strip 1 idle: slow breathing, yellow ring softly pulsing, occasional blink. Strip 2 tap: quick squash, wiggle, happy arc eyes. Strip 3 working: body rotates 15 degrees back and forth like a nut being tightened, eyes become loading dots, yellow ring fills clockwise like a progress bar. Strip 4 notification: antenna tip blinks coral, body jumps, eyes widen. Strip 5 going to sleep: eyes shrink to lines, ring dims, antenna droops, body settles. Strip 6 boot up: screen is black, a cyan scan line sweeps down, ring lights segment by segment, eyes appear, antenna springs up.

---

## 5. Character C: GLIM (the firefly helper)

### Identity
- **Concept:** A small floating creature shaped like a soft teardrop, with two translucent leaf-like wings and a glowing tail-light orb. It "lights the way" to answers.
- **Personality:** Gentle, cheerful, attentive. Moves gracefully, never jittery.
- **Signature feature:** The **glowing tail orb**, which pulses, changes brightness, and flashes for notifications. Glim always hovers and has a lazy floating path.
- **Why it works for your app:** Feels calm and light; good for a premium or minimal UI.

### Proportions and anatomy
- Body: a soft teardrop shape, wide rounded top and a tapered bottom, about 1 unit tall, 0.7 units wide.
- Face: upper half. Two large round dark eyes, each with two white highlights. A tiny small mouth.
- Wings: two translucent leaf-shaped wings on the upper back, about 0.6 units long, with faint vein lines.
- Tail orb: a glowing sphere hanging from the tapered bottom by a short soft stem, about 0.25 units in diameter.
- Antennae: two short soft antennae on top, each ending in a tiny rounded tip.
- No arms or legs; it expresses through body tilt, wings, antennae, and the orb.

### Color palette
| Part | Hex |
|---|---|
| Body | #B8A9E6 |
| Body shadow | #8F7FC4 |
| Wings | #E8F4FF at 60% opacity |
| Tail orb glow | #9BF6C4 |
| Eyes | #241E3A |
| Antenna tips | #FFD6E8 |

### Master sheet prompt
> Character model sheet blueprint for an original mascot named Glim: a small floating teardrop-shaped creature with a soft lavender body, two large round dark eyes with white highlights and a tiny mouth, two translucent pale leaf-shaped wings with faint veins on its upper back, two short soft antennae with tiny pale pink tips, and a glowing mint-green orb hanging from the tapered bottom of its body like a firefly's light. It hovers above the ground with a soft shadow below. Sheet layout: top row turnaround with front, three-quarter front, side (showing wing placement and orb stem), three-quarter back, back (showing wing attachment), and top-down; middle-left large hero pose with callout lines to the wings, antennae, eyes, and glowing orb, with empty label boxes; middle-right color palette swatches (lavender, deep lavender shadow, pale wing blue, mint glow, dark eye, pink tip); bottom section 6-panel expression grid and a row of animation keyframe thumbnails: idle hover, tap, working, notification, sleep, boot-up.

### Individual panel prompts

**Turnaround**
> Turnaround model sheet of Glim, an original floating teardrop-shaped lavender creature with large round dark eyes, translucent leaf-shaped wings, short antennae with pink tips, and a glowing mint orb hanging from its tapered bottom. Six views at the same scale, all hovering at the same height with soft ground shadows: front, three-quarter front, side, three-quarter back, back, and top-down.

**Expression sheet**
> Expression sheet of Glim, an original floating lavender teardrop firefly mascot, 3x3 grid, front view: neutral, happy (eyes become arcs, antennae perk up, orb bright), curious (head tilt, one antenna bent), thinking (eyes look up, orb slowly dimming and brightening), surprised (eyes wide, wings spread, orb flash), sleepy (eyes half closed, wings folded, orb dim), asleep (eyes closed, orb a faint glow), worried (eyes tilted, antennae drooped), success (eyes closed happy, small sparkles around the orb).

**Animation keyframe strips**
> Animation keyframe sheet of Glim, an original floating firefly mascot, six horizontal strips of 5 frames each with empty label boxes. Strip 1 idle: slow up-and-down hover, wing flutter, orb softly pulsing. Strip 2 tap: little spin, happy eyes, orb brightens. Strip 3 working: flies a small figure-eight loop leaving a faint light trail, focused eyes. Strip 4 notification: orb flashes twice, Glim zips toward the viewer and stops. Strip 5 going to sleep: wings fold, body lowers onto the ground, orb dims to a faint glow, eyes close. Strip 6 boot up: a dim orb on the ground glows brighter, body lifts, wings unfold, eyes open, small happy spin.

---

## 6. Consistency checklist after generating

- [ ] Same proportions across all six turnaround views
- [ ] Signature feature (steam / core ring and screen / tail orb) visible and consistent
- [ ] Palette matches the hex table (correct in Figma if needed)
- [ ] Reads clearly at 64x64 pixels (shrink the front view to test)
- [ ] Does not resemble any existing mascot or brand character
- [ ] Labels, hex codes, and arrows added manually in Figma