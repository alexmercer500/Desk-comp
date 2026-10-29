---
name: Kulhi
description: A tiny chai cup that lives on your desktop and keeps an eye on your coding agents. The public website as one painted day in Kulhi's life.
colors:
  ink-morning: "#2b1606"
  text-morning: "#45270f"
  muted-morning: "#6a4220"
  chai-gold: "#ffcf73"
  cream: "#fff3d9"
  sky-morning: "#fbc96f"
  sky-cream: "#ffe6b3"
  sky-peach: "#ffd2bd"
  sky-rose: "#f7a3ab"
  sky-mauve: "#c98fc4"
  sky-indigo: "#3d3383"
  sky-night: "#1d1a4a"
  sky-midnight: "#121032"
  sky-predawn: "#283064"
  ink-afternoon: "#3b0d1f"
  ink-dusk: "#2d0f33"
  ink-evening: "#24102e"
  ink-moon: "#f6f1ff"
  text-moon: "#ddd6f6"
  muted-moon: "#c3bbe6"
  paper: "#fffdf8"
  moonlight: "#fff2cf"
  film: "#1a1322"
  device: "#15121c"
  device-2: "#221e2c"
  allow-cream: "#ffe1a3"
  work: "#f0a21a"
  ask: "#ee4377"
  done: "#23a764"
typography:
  display:
    fontFamily: "Bricolage Grotesque Variable, Geist Variable, system-ui, sans-serif"
    fontSize: "clamp(2.9rem, 5.6vw, 5.5rem)"
    fontWeight: 760
    lineHeight: 0.96
    letterSpacing: "-0.022em"
    fontVariation: "'wdth' 90"
  headline:
    fontFamily: "Bricolage Grotesque Variable, Geist Variable, system-ui, sans-serif"
    fontSize: "clamp(2.3rem, 4.4vw, 4rem)"
    fontWeight: 740
    lineHeight: 1
    letterSpacing: "-0.018em"
    fontVariation: "'wdth' 90"
  title:
    fontFamily: "Bricolage Grotesque Variable, Geist Variable, system-ui, sans-serif"
    fontSize: "clamp(1.4rem, 2vw, 1.7rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 90"
  body:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  lede:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 600
    lineHeight: 1.4
  timecode:
    fontFamily: "Geist Mono Variable, ui-monospace, Cascadia Mono, monospace"
    fontSize: "0.72rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.06em"
  mono:
    fontFamily: "Geist Mono Variable, ui-monospace, Cascadia Mono, monospace"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  film: "3px"
  tag: "6px"
  strip: "9px"
  sm: "10px"
  window: "12px"
  toast: "16px"
  card: "18px"
  frame: "20px"
  pane: "22px"
  desk: "26px"
  phone: "44px"
  pill: "999px"
spacing:
  gutter: "clamp(1rem, 4vw, 2.5rem)"
  wrap: "min(1180px, 100% - 2 * gutter)"
  scene: "clamp(5rem, 9vw, 8rem)"
  split-gap: "clamp(2.5rem, 6vw, 5.5rem)"
  board-gap: "clamp(1.25rem, 2.5vw, 2rem)"
  stack: "0.75rem"
components:
  button-primary:
    backgroundColor: "{colors.ink-morning}"
    textColor: "{colors.cream}"
    rounded: "{rounded.pill}"
    padding: "0 1.5rem"
    height: "3.3rem"
  button-secondary:
    backgroundColor: "rgb(255 255 255 / 0.4)"
    textColor: "{colors.ink-morning}"
    rounded: "{rounded.pill}"
    padding: "0 1.5rem"
    height: "3.3rem"
  button-secondary-hover:
    backgroundColor: "rgb(255 255 255 / 0.62)"
  nav-github:
    textColor: "{colors.ink-morning}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 0.95rem"
  film-strip:
    backgroundColor: "{colors.film}"
    rounded: "{rounded.strip}"
    padding: "9px 7px"
  frame-tag:
    backgroundColor: "rgb(21 18 28 / 0.78)"
    textColor: "#fff3e6"
    typography: "{typography.timecode}"
    rounded: "{rounded.tag}"
    padding: "0.25rem 0.5rem"
  storyboard-frame:
    rounded: "{rounded.frame}"
  table-pane:
    backgroundColor: "rgb(255 250 238 / 0.62)"
    rounded: "{rounded.pane}"
  toast:
    backgroundColor: "rgb(255 251 246 / 0.92)"
    rounded: "{rounded.toast}"
    padding: "1rem 1.1rem"
  app-card:
    backgroundColor: "{colors.device}"
    textColor: "#f4f3f8"
    rounded: "{rounded.card}"
    padding: "0.95rem 1rem 1rem"
  app-card-allow:
    backgroundColor: "{colors.allow-cream}"
    textColor: "{colors.device}"
    rounded: "{rounded.sm}"
  app-island:
    backgroundColor: "{colors.device}"
    textColor: "#f4f3f8"
    rounded: "{rounded.pill}"
    padding: "0.5rem 1rem"
---

# Design System: Kulhi

**Scope.** This system governs only the public website (`web/`). The desktop app's own windows (`app.html`, the panel, the companion, the bubble) keep their own look, defined in `src/panel/style.css` and `src/theme.ts`, and are not governed here. Inside the site, the dark permission card, the dark island and the island list are copies of the app's real UI: they are part of the depiction, not general site chrome, and their dark values do not license dark site surfaces outside the night scenes.

## Overview

**Creative North Star: "Colour Script"**

The site is one day in Kulhi's life, painted the way an animation studio paints a colour script: each section is a scene at a time of day, and the sky runs on from one scene into the next. Morning gold gives way to a cream noon, an afternoon rose, a mauve dusk, a lamplit evening falling to indigo, three night scenes in deepening blue, and a sunrise that brings the gold back for the close. Every sky is a two-stop gradient mixed in oklab with a fine warm paper grain over it, so the colour reads as painted light rather than flat fill.

Type and ink follow the light. Day scenes carry dark, warm ink tinted to their sky (brown in the morning, plum at dusk); night scenes switch to moonlit, pale lavender ink. A sun travels across the day scenes (big and blooming in the hero, high at noon, lower and pinker in the afternoon, on the horizon at dusk); at night it hands over to stars and a crescent moon. The characters, drawn live by the app's own engine, are the cast: they act in the scenes, doze at night and greet the sunrise.

The mood is fun but grown-up: rich, cinematic, mood-led colour, never flat primaries, never a white SaaS page, never a die-cut sticker sheet. One idea per scene, generous vertical rhythm, copy capped near 62ch.

**Key Characteristics:**
- Every section is a scene with its own sky, ink and shade, blended in oklab under a paper grain.
- Dark warm ink by day, moonlit light ink by night; nothing is pure black or pure white.
- A travelling sun by day; stars and moon by night; a rising sun at the close.
- Bricolage Grotesque, heavy and slightly condensed, for display; Geist for reading; Geist Mono for commands and timecodes.
- Pill buttons with a 2px ink border; the sticky nav carries a film-strip colour script with a playhead.
- Live characters with a soft drop shadow tinted by the scene, no outlines.

## Colors

A painted day: warm golds, peaches and roses falling through mauve into indigo, with ink that is always a deep tint of its own sky.

### Primary
- **Morning Ink** (`ink-morning`): headings, links, the filled primary button, the step counter ink, the footer wordmark, the selection fill. The site's decisive colour, and the ink of every scene that does not set its own.

### Secondary
- **Chai Gold** (`chai-gold`): the page and footer ground, the sunrise's final stop, the step counters' fill, and the focus ring in night scenes. Kulhi's own warmth.
- **Cream** (`cream`): text on the filled ink button; the selection's text colour is the cream sky stop.

### Tertiary (the skies)
Each scene's sky runs from its top stop to its bottom stop, and the next scene starts where the last one ended.
- **Morning Gold** (`sky-morning`) to **Noon Cream** (`sky-cream`): the hero, 09:40.
- **Noon Cream** to **Afternoon Peach** (`sky-peach`): every agent, 12:30.
- **Afternoon Peach** to **Dusk Rose** (`sky-rose`): the storyboard, 15:10.
- **Dusk Rose** to **Dusk Mauve** (`sky-mauve`): the crew, 17:30.
- **Dusk Mauve** to **Evening Indigo** (`sky-indigo`), with a warm lamp glow at the left: little things, 18:45.
- **Evening Indigo** to **Night Blue** (`sky-night`) to **Midnight** (`sky-midnight`) to **Predawn Blue** (`sky-predawn`): phone, privacy and setup.
- Sunrise runs Predawn Blue through violet, pink and apricot to Chai Gold.

Each scene also sets a nav tint (`--nav`, a mid-tone of its sky) that the sticky nav adopts.

### Scene ink
- **Afternoon Plum** (`ink-afternoon`), **Dusk Plum** (`ink-dusk`), **Evening Plum** (`ink-evening`): the day inks deepen and cool with the light.
- **Moon Ink** (`ink-moon`), **Moon Text** (`text-moon`), **Moon Muted** (`muted-moon`): headings, running copy and supporting copy in the three night scenes.

### Neutral
- **Morning Text** (`text-morning`) and **Morning Muted** (`muted-morning`): running copy and supporting copy by day; afternoon, dusk and evening carry their own plum-tinted pair.
- **Line** and **Pane** are derived per scene: line is the scene's ink at 16-20% (table rules, ledger and FAQ rules, footer rule, frame outlines); pane is a translucent warm white by day (the agent table) and white at 6% by night.
- **Shade** is the scene's ink hue as an RGB triple, used for every shadow so depth takes the colour of the light.
- **Paper** (`paper`): the depicted terminal, shop window and the done toast; warm, never cool white.
- **Moonlight** (`moonlight`): the crescent moon.
- **Film Black** (`film`): the nav's film strip.
- **Device Black** (`device`) and **Device Raised** (`device-2`): only for the depicted app card, island and island list and their inner rows. The card's Allow button is **Allow Cream** (`allow-cream`).

### State
- **Working Amber** (`work`), **Needs-you Rose** (`ask`), **Done Green** (`done`): 8px status dots, the needs-you bullet on notes (9px), and the text caret (rose).

### Named Rules
**The Scene Owns The Colour Rule.** A section never picks colours on its own; it declares its sky stops, ink, text, muted, line, pane, shade and nav tint as scene tokens, and every component inside reads them. A new section is a new time of day.

**The Continuous Sky Rule.** A scene's top stop is the previous scene's bottom stop. Skies mix in oklab and always carry the paper grain.

**The Ink Follows The Light Rule.** Ink is a deep tint of the scene's own hue by day and a pale moonlit lavender by night. No pure black text, no pure white text.

**The Depicted Device Rule.** Device black belongs to copies of the app's UI. By day, site chrome never goes dark; at night the sky itself is the dark surface.

## Typography

**Display Font:** Bricolage Grotesque Variable (with Geist Variable, system-ui), width axis at 88-90%
**Body Font:** Geist Variable (with Segoe UI, system-ui)
**Label/Mono Font:** Geist Mono Variable (with ui-monospace, Cascadia Mono), for commands, terminal lines and timecodes

**Character:** A heavy, slightly condensed grotesque with ink-trap warmth sets the scenes' titles like title cards; Geist reads quietly underneath; mono marks anything that is a real command or a time on the clock.

### Hierarchy
- **Display** (760, clamp 2.9-5.5rem, 0.96, -0.022em): the hero headline only, balanced wrap.
- **Headline** (740, clamp 2.3-4rem, 1, -0.018em): scene headings; the close steps up to clamp 2.6-5rem.
- **Title** (700, clamp 1.4-1.7rem, 1.1): storyboard frame headings. Character names in the lineup use the display face at 700, 1.15rem.
- **Body** (400, 1.0625rem, 1.6): running copy in the scene's text colour, max 62ch, pretty wrap; split copy steps up to 1.08rem.
- **Lede** (400, 1.15rem): supporting copy beside a heading, in the scene's muted colour.
- **Label** (600, 0.82rem): table headers, ledger sub-labels (450), toast times and fine print with tabular figures.
- **Timecode** (500-600 mono, 0.72-0.78rem, +0.06em, tabular): storyboard frame tags and the nav's current time.
- **Mono** (400, 0.8-0.83rem, 1.45-1.5): terminal lines and the command on the permission card.

### Named Rules
**The Title Card Rule.** Display type is Bricolage at weights 700-760 with the width axis at 88-90% and slight negative tracking; it never drops below 700 and never runs at full width.

**The Real Mono Rule.** Mono appears only for a real command, terminal output, or a clock time. Never as decoration or section labelling.

## Layout

A centred column, `wrap` wide (max 1180px with a fluid gutter). Each scene is full-bleed sky with `scene` padding on top and 80% of it below; the hero and sunrise have their own shorter padding. Inside, scenes use a two-column split (about 0.9fr copy / 1.1fr evidence, `split-gap`), the hero a 0.92fr / 1.08fr split with the desk on the right, the storyboard three equal frames (`board-gap`), and the crew a single full-width lineup of seven actors (wider than the wrap, up to 1320px). Little-things toasts stagger with small left offsets like notes stuck on a wall. The close is centred under the rising sun.

The sticky nav is a three-column grid: brand left, the colour script centred, GitHub right.

Responsive: below 1080px the nav drops the current-time label. Below 980px every split collapses to one column, the storyboard stacks (max 30rem), and the lineup becomes a horizontal scroll-snap row of 9.5rem actors. Below 640px the brand and GitHub collapse to their icons, the film-strip frames narrow to 15px, buttons go full width, the desk becomes 3:3.5 with the terminal on top and the shop window below, the ledger stacks, table cells tighten and toasts lose their stagger.

## Elevation & Depth

Depth is light, not material. Surfaces are translucent or paper-warm and sit on the sky; shadows are long, soft, offset straight down, and tinted with the scene's own shade colour at 30-75% so a shadow at dusk is plum and a shadow at noon is brown. Outlines, where used, are 1.5px rings in the scene's line colour, never a hard border.

### Shadow Vocabulary
- **Button** (`0 10px 22px -10px rgb(shade / 0.7)`, secondary at -12px / 0.35; hover `0 16px 28px -12px rgb(shade / 0.7)`): pill buttons.
- **Pane** (`0 0 0 1.5px line, 0 30px 50px -34px rgb(shade / 0.55)`): the agent table; frames use `0 30px 46px -30px` at 0.7.
- **Desk** (`0 0 0 1.5px rgb(43 22 6 / 0.12), 0 40px 70px -34px rgb(shade / 0.65)`): the hero desk.
- **Window** (`0 22px 40px -20px rgb(shade / 0.7)`): depicted terminal and windows; toasts `0 20px 34px -22px` at 0.75.
- **Device** (`0 24px 44px -16px rgb(21 18 28 / 0.6)`): depicted app card and island list.
- **Character** (`drop-shadow(0 16px 14px rgb(shade / 0.32))`): live characters and Rui's still.

### Named Rules
**The Coloured Shadow Rule.** Site shadows take the scene's shade (depicted devices keep their own dark shadow); no neutral grey shadows by day, no hard offset shadows, no outlines around characters.

## Shapes

Rounding grows with the object: 3px for film frames, 6px for timecode tags, 9-10px for the strip, focus rings, command blocks and card buttons, 12px for depicted windows, 16-18px for toasts, the app card and phone notes, 20px for storyboard frames, 22px for the table pane, 26px for the hero desk, 36-44px for the phone. Every site action is a pill (999px), as are the island and the status dots. Lights are circles: the sun, the moon, the stage spotlight pools. The only dashed line is the "your own" slot, a 2px dashed circle.

## Components

### Buttons
Round, confident and equal: Download and Star always appear as a same-size pair.
- **Shape:** pill (999px), min 13.75rem wide, 3.3rem tall, 2px border in the scene's ink, weight 600 at 1.02rem.
- **Primary:** filled ink with cream text and the button shadow.
- **Secondary:** white at 40% over the sky with ink text and border; 62% on hover.
- **Hover / Focus:** lift 2px with a deeper shade shadow (0.35s expo-out); the star icon turns 72deg. Active returns to rest. Focus is a 2.5px ring in the scene's ink, 3px offset, following the pill.

### Navigation
A sticky bar whose background and ink are the current scene's nav tint and ink, crossfading over 0.6s. Left: the live Kulhi mark (34px) and the wordmark in Bricolage 760. Centre: the colour script, a film-black strip with sprocket-hole rows holding nine small painted frames, one per scene, each a gradient of that scene's sky; frames rest at 62% opacity, and the current one (the playhead) is full opacity, scaled 1.18 and ringed in film black and cream. Beside it, the current time in mono and the scene's label. Right: a GitHub pill outlined 1.5px in currentColor with a faint white hover wash.

### Storyboard Frames (signature)
Three frames in a row, each a 4:3.7 art panel (20px) keyed to its own light (rose, mint, violet radial gradients under the grain), outlined with the scene line and the frame shadow. A timecode tag sits bottom-left in mono on translucent device black. Inside: a live character and one real UI fragment. Below: a title and a short paragraph.

### Crew Lineup (signature)
Seven actors on one dusk stage: a broad warm glow behind the row, and a soft elliptical spotlight pool under each character's feet. Names in the display face, one-line descriptions in muted. The seventh is the "your own" dashed circle with a plus.

### Cards / Containers
- **Table pane**: translucent warm pane, 22px, 1.5px line ring and pane shadow; rows on line rules with a white wash on hover; yes marks are ink discs with a gold check, no marks a faint minus.
- **Toasts**: near-opaque warm paper (16px), toast shadow, a 28px icon on 8px corners, title, body and a tabular time.
- **Ledger and FAQ**: rows on the scene's line rules; FAQ uses a masked plus that rotates 45deg when open.
- **Steps**: chai-gold circular counters (2.25rem) in the display face beside bold step titles.

### Depicted App UI
The permission card, the island and the island list copy the app's real UI: device black, device-raised rows, near-white text, an Allow Cream Allow button beside dark Always and Deny; the card grows out of the island (0.5s, from 0.92 scale). They carry their own light ink and are not site components. The phone in the night scene is a 44px device with a night-sky screen and one bright note on top.

### Celestial Set (signature)
A radial-gradient sun clipped to its scene: large and blooming top-right in the hero, smaller and high at noon, pinker and low-right in the afternoon, on the horizon at dusk, and rising at the centre of the close. At night, two layers of small stars (one layer twinkling on a 3.2s clock) and a crescent moon with a soft glow.

### Characters
Live canvases from the app's engine (Rui as a still) with the character shadow, a 1.04 hover scale and a squash-and-stretch hello on click. Night Kulhi dozes, slightly desaturated and dimmed; sunrise Kulhi greets the visitor when it comes on screen. The hero Kulhi steps out over the desk's corner.

### Motion
Expo-out easing (`cubic-bezier(0.16, 1, 0.3, 1)`) for lifts, grows, the playhead and the FAQ icon. The hero demo plays only on screen; terminal lines type in with a 4px slide. Under reduced motion all animation and transition collapses to 0.01ms, smooth scrolling stops, and the characters are told to keep still.

## Do's and Don'ts

### Do:
- **Do** make every new section a scene: declare its sky stops, ink, text, muted, line, pane, shade and nav tint, and continue the previous scene's sky.
- **Do** mix sky gradients in oklab and lay the paper grain over every painted surface.
- **Do** tint shadows with the scene's shade and keep them long, soft and offset straight down.
- **Do** set titles in Bricolage Grotesque at 700-760 with the width axis at 88-90%; read in Geist; use Geist Mono only for commands and clock times.
- **Do** keep Download and Star as equal pill buttons with a 2px ink border.
- **Do** let the live characters act in the scene and show real product fragments as the proof.
- **Do** honour prefers-reduced-motion everywhere, including the characters.

### Don't:
- **Don't** use flat primaries, a white or near-white SaaS page, or a die-cut sticker sheet look.
- **Don't** use pure black or pure white text; ink is always a tint of the light.
- **Don't** put sticker borders or outlines on characters, or use hard offset shadows.
- **Don't** make day-scene chrome dark; device black is only for depicted app UI.
- **Don't** add eyebrow or kicker labels above headings; timecodes live on storyboard frames and in the nav, not as section labels.
- **Don't** use neutral grey shadows in day scenes; depth takes the scene's colour.
- **Don't** apply this system to the desktop app's windows; they follow `src/panel/style.css` and `src/theme.ts`.
