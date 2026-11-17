---
name: Kulhi
description: A tiny chai cup that lives on your desktop and keeps an eye on your coding agents. The public website as a ruled sheet of warm paper, where the characters carry the colour.
colors:
  paper: "#fcfaf5"
  paper-2: "#f5efe4"
  paper-3: "#ece3d3"
  ink: "#231c16"
  text: "#4a4037"
  muted: "#74675b"
  line: "#e6ddcf"
  line-strong: "#d3c6b2"
  clay: "#a3532b"
  device: "#17130f"
  device-2: "#26201a"
  allow-cream: "#ffe1a3"
  work: "#e3961a"
  ask: "#e2416f"
  done: "#1f9a5c"
  dark-paper: "#161210"
  dark-paper-2: "#1f1a16"
  dark-paper-3: "#2b241e"
  dark-surface: "#1d1814"
  dark-ink: "#f3ece3"
  dark-text: "#cfc4b7"
  dark-muted: "#9a8e81"
  dark-line: "#2e2722"
  dark-line-strong: "#463b32"
  dark-clay: "#e08a5c"
  dark-device: "#0c0a08"
typography:
  display:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 5.4vw, 4.6rem)"
    fontWeight: 400
    lineHeight: 1.02
    letterSpacing: "-0.048em"
  headline:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3.8vw, 3.3rem)"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.042em"
  title:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  lede:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "1.1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Geist Mono Variable, ui-monospace, Cascadia Mono, monospace"
    fontSize: "0.7rem"
    fontWeight: 450
    lineHeight: 1.4
    letterSpacing: "0.12em"
  mono:
    fontFamily: "Geist Mono Variable, ui-monospace, Cascadia Mono, monospace"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  focus: "6px"
  button: "10px"
  window: "10px"
  panel: "12px"
  desk: "14px"
  card: "16px"
  phone: "42px"
  pill: "999px"
spacing:
  gutter: "clamp(0.75rem, 3vw, 2rem)"
  frame: "min(1240px, 100% - 2 * gutter)"
  pad: "clamp(1.25rem, 3.2vw, 2.75rem)"
  section: "clamp(3.5rem, 7vw, 6rem)"
  split-gap: "clamp(2.5rem, 6vw, 5.5rem)"
components:
  button-dark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.button}"
    padding: "0 1.4rem"
    height: "3.1rem"
  button-dark-hover:
    backgroundColor: "#3a2f25"
  button-line:
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "0 1.4rem"
    height: "3.1rem"
  text-link:
    textColor: "{colors.ink}"
  section-bar:
    typography: "{typography.label}"
    padding: "0.85rem pad"
  art-panel:
    backgroundColor: "{colors.paper-2}"
    rounded: "{rounded.panel}"
  app-card:
    backgroundColor: "{colors.device}"
    textColor: "#f3efe9"
    rounded: "{rounded.card}"
    padding: "0.95rem 1rem 1rem"
  app-card-allow:
    backgroundColor: "{colors.allow-cream}"
    textColor: "{colors.device}"
    rounded: "9px"
  app-island:
    backgroundColor: "{colors.device}"
    textColor: "#f3efe9"
    rounded: "{rounded.pill}"
    padding: "0.5rem 1rem"
---

# Design System: Kulhi

**Scope.** This system governs only the public website (`web/`). The desktop app's own windows (`app.html`, the panel, the companion, the bubble) keep their own look, defined in `src/panel/style.css` and `src/theme.ts`. Inside the site, the dark permission card, the dark island and the island list are copies of the app's real UI: they are part of the depiction, not site chrome.

## Overview

**Creative North Star: "The Ruled Sheet"**

The site is a sheet of warm paper ruled in fine lines. The page sits in a frame of two vertical hairlines; every section starts on a full-width rule with a numbered label bar; related things share ruled cells that run to the frame's edges, with a small clay square where the rules cross. Inspired by recto.design's restraint (taken as a direction, not copied).

Colour is held back on purpose. The surface is paper, the type is ink, and there is one accent: clay, the kulhi's own terracotta, used for the second line of every heading, the section numbers and a few small markers. The characters, drawn live by the app's engine, are the only strong colour on the page, and the copies of the app's dark card and island are the only dark surfaces.

The mood is calm and grown-up but warm, never a generic white SaaS page: the paper is warm, the clay is earthy, the characters are alive, and the hero is a working demo you can answer.

**Key Characteristics:**
- Warm paper ground, warm near-black ink, one clay accent.
- A ruled frame, full-width section rules, numbered mono label bars, ruled cells.
- One typeface (Geist) at a light 400 with tight tracking; two-tone headings (ink, then clay).
- Real product UI as the evidence: the live desk demo, the app's card, island and notes.
- Live characters with a soft warm drop shadow, no outlines.

## Colors

### Primary
- **Ink** (`ink`): headings, the dark button, links, table names, selection fill.
- **Clay** (`clay`): the second line of headings, section numbers, step numbers, cell markers, the FAQ plus, the brand's full stop, the focus ring. Never a fill for large areas.

### Neutral
- **Paper** (`paper`): the page. **Paper 2** (`paper-2`): art panels, table head, terminal bars. **Paper 3** (`paper-3`): window dots.
- **Text** (`text`): running copy. **Muted** (`muted`): ledes, labels, fine print, captions.
- **Line** (`line`): every rule, frame edge and panel border. **Line Strong** (`line-strong`): the desk's border, the number dash, "no" marks, the dashed "your own" ring.
- **Device** (`device`) and **Device 2** (`device-2`): only the depicted app card, island, island list, phone body and phone buttons.

### State
- **Working Amber** (`work`), **Needs-you Rose** (`ask`), **Done Green** (`done`): 8px status dots only.

### Dark
The same system on warm black paper: every token has a dark value (`dark-*` above), clay lightens to `dark-clay` so it reads on the dark paper, the terminal's green and red lighten, shadows turn neutral, and the app's dark card, island and phone get a 1px white-at-10% edge so they stay distinct from the page. The page follows the system setting until the visitor picks light or dark with the moon/sun button in the nav; the pick is remembered (`src/theme.ts`, with a small script in `index.html`'s head that sets it before the first paint).

### Named Rules
**The One Accent Rule.** Clay is the only accent. No gradients of colour, no tinted section backgrounds, no second accent.

**The Characters Carry The Colour Rule.** Anything vivid on the page is a character or a status dot.

**The Depicted Device Rule.** Dark surfaces belong to copies of the app's UI; site chrome never goes dark.

## Typography

**Font:** Geist Variable for everything you read; Geist Mono Variable for labels, terminal lines, commands and times.

### Hierarchy
- **Display** (400, clamp 2.5-4.6rem, 1.02, -0.048em): the hero headline.
- **Headline** (400, clamp 2-3.3rem, 1.05, -0.042em): section headings. Every display and headline is two-tone: the first phrase in ink, then a `.soft` second line in clay on its own line.
- **Title** (400, 1.3rem, -0.02em): cell headings, step groups.
- **Body** (400, 1.0625rem, 1.6, max 62ch). **Lede** (1.1rem, muted).
- **Label** (mono 450, 0.7rem, +0.12em, uppercase, muted): section bars, table heads, timecodes, "optional", "Live demo".
- **Mono** (400, 0.8rem): terminal lines and commands.

### Named Rules
**The Light Weight Rule.** Headings stay at 400 with tight tracking; weight and size do not compete. Emphasis comes from the clay second line, not from bold.

## Layout

The frame is max 1240px with a fluid gutter, bordered left and right by hairlines, with `pad` inside. Each section is full width with a top rule; inside the frame it opens with a label bar (`01 —— EVERY AGENT` left, a short tagline right) and then content with `section` padding below. Content is either a split (0.9fr copy / 1.1fr evidence) or ruled cells: three cells for the afternoon moments, the "No" statements, the ledger and the setup steps; seven for the crew. The hero is copy on top, then the full-width desk demo with a caption row under it.

Responsive: below 1100px the crew is four to a row. Below 980px the nav links hide (brand, GitHub and Download stay), splits and cells stack, and the desk becomes 16:11 with Kulhi bottom-left. Below 640px the taglines hide, buttons go full width, the desk becomes 3:4.2 with the terminal on top, and the crew is two to a row.

## Elevation & Depth

Flat by default: hairlines do the separating. Depicted windows and toasts get one soft warm shadow (`0 18px 36px -24px rgb(70 45 20 / 0.5)`); the app card and island a darker one; characters `drop-shadow(0 12px 12px rgb(70 45 20 / 0.2))`. No shadow on site chrome, buttons or panels.

## Shapes

Small, quiet radii: 10px buttons and windows, 12px panels and the table, 14px the desk, 16px the app card, 42px the phone. Pills only for the island and status dots. Cell markers are 7px squares.

## Components

### Buttons
- **Dark button:** ink fill, paper text, 10px, 3.1rem tall (2.4rem small in the nav), weight 500. Hover lightens to `#3a2f25`; active nudges down 1px.
- **Line button:** the second choice beside the dark one. Same size and radius, no fill, a 1.5px ink line drawn inside; hover fills it with paper-2. Used for Get the Android app.
- **Text link with arrow:** ink, weight 500; the arrow slides 3px on hover. Used for How to set up, which scrolls to the set-up steps.

### Navigation
Sticky, paper at 86% with a 12px blur and a bottom rule. Brand left (live Kulhi mark and "kulhi." with a clay full stop), section links centred; on the right the light/dark button (a moon in light, a sun in dark) and a small Download button in ink. The source is linked from the footer.

### Section bar
The first thing in every section: a mono label with the clay number and a short dash, a muted tagline on the right, rules above and below.

### Ruled cells
Grid cells divided by vertical hairlines, running to the frame edges, with a clay square marker where each vertical rule meets the top rule.

### Art panels
Paper 2 with a faint 22px dot grid, a hairline border and 12px corners; they hold a live character and one real UI fragment, with a mono timecode bottom-left.

### Desk demo (signature)
A pretend Windows desktop (paper with the dot grid, hairline border, translucent taskbar) holding the agent's terminal, the shop it's fixing, the dark island at the top and Kulhi in the corner. The permission card grows out of the island and you can answer it.

### Statements
The privacy section's three cells each lead with a large clay "No" (clamp 4-6.5rem, -0.06em) over the noun it denies.

### Characters
Live canvases from the app's engine (Rui as a still), 1.04 hover scale and a squash-and-stretch hello on click. The Kulhi beside the phone is asleep; the closing Kulhi greets the visitor.

### Motion
Expo-out easing (`cubic-bezier(0.16, 1, 0.3, 1)`). The demo plays only on screen; terminal lines type in with a 4px slide. Under reduced motion all animation collapses and the characters keep still.

## Do's and Don'ts

### Do:
- **Do** start every new section with a full-width rule and a numbered label bar.
- **Do** write headings as two phrases: ink first, clay second.
- **Do** separate with hairlines before reaching for shadows or fills.
- **Do** let the characters and the app's real UI be the colour and the proof.
- **Do** take every colour from a token, so the dark theme follows for free.
- **Do** honour prefers-reduced-motion everywhere, including the characters.

### Don't:
- **Don't** add colours beyond paper, ink and clay (plus the status dots and the characters).
- **Don't** use gradients of colour, tinted section backgrounds, painted skies or sticker effects.
- **Don't** set headings bold or in a second display face.
- **Don't** make site chrome dark in the light theme; device black is only for depicted app UI. In the dark theme the page itself is dark, from the tokens, never from one-off colours.
- **Don't** let the restraint become a generic white SaaS page: keep the paper warm, the clay present and the characters alive.
