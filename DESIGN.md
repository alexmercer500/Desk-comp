---
name: Kulhi
description: A tiny chai cup that lives on your desktop and keeps an eye on your coding agents. The public website's sticker-lid world.
colors:
  cobalt: "#2346f5"
  pink: "#ff4f8b"
  pink-deep: "#e0336f"
  sun: "#ffd23f"
  sun-deep: "#f2b800"
  ink: "#17122b"
  ink-soft: "#2a2347"
  sheet: "#f4f4fa"
  vinyl: "#ffffff"
  cut: "#c9c6dc"
  work: "#ffb020"
  ask: "#ff4f8b"
  done: "#a8eb34"
  on-cobalt-soft: "#d9e0ff"
  on-pink-soft: "#fff0f5"
  on-ink-soft: "#c9c2e8"
  caption: "#4b4566"
  device-black: "#050409"
typography:
  wordmark:
    fontFamily: "Shrikhand, Schibsted Grotesk Variable, serif"
    fontSize: "clamp(4.6rem, 14vw, 12rem)"
    fontWeight: 400
    lineHeight: 0.95
  display:
    fontFamily: "Shrikhand, Schibsted Grotesk Variable, serif"
    fontSize: "clamp(2.3rem, 5.4vw, 4.4rem)"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Shrikhand, Schibsted Grotesk Variable, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.1
  body:
    fontFamily: "Schibsted Grotesk Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Schibsted Grotesk Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "1.08rem"
    fontWeight: 750
    lineHeight: 1.15
  mono:
    fontFamily: "Martian Mono, ui-monospace, Cascadia Mono, monospace"
    fontSize: "0.84rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  chip: "10px"
  label: "14px"
  tag: "16px"
  button: "18px"
  card: "20px"
  bubble: "22px"
  home: "24px"
  slot: "28px"
  sheet: "34px"
  pill: "999px"
spacing:
  lid: "clamp(4.5rem, 10vw, 8rem)"
  gutter: "clamp(1rem, 4vw, 3rem)"
  wrap: "1180px"
  border: "6px"
components:
  button-sun:
    backgroundColor: "{colors.sun}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "0.8rem 1.2rem"
    height: "3.6rem"
  button-pink:
    backgroundColor: "{colors.pink}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "0.8rem 1.2rem"
    height: "3.6rem"
  label-sticker:
    backgroundColor: "{colors.vinyl}"
    textColor: "{colors.ink}"
    rounded: "{rounded.label}"
    padding: "0.9rem 1.15rem"
  nav-link:
    textColor: "{colors.vinyl}"
    rounded: "{rounded.pill}"
    padding: "0.45rem 0.85rem"
  nav-link-hover:
    backgroundColor: "{colors.vinyl}"
    textColor: "{colors.ink}"
  tag:
    backgroundColor: "{colors.on-pink-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    padding: "0.7rem 1rem"
  tag-full:
    backgroundColor: "{colors.sun}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    padding: "0.7rem 1rem"
  speech-bubble:
    backgroundColor: "{colors.vinyl}"
    textColor: "{colors.ink}"
    rounded: "{rounded.bubble}"
    padding: "1rem 1.25rem"
  sheet:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.sheet}"
    padding: "clamp(1.25rem, 3vw, 2.25rem)"
  agent-card:
    backgroundColor: "{colors.device-black}"
    textColor: "{colors.vinyl}"
    rounded: "{rounded.card}"
    padding: "1rem 1.1rem 1.05rem"
  card-btn-allow:
    backgroundColor: "{colors.done}"
    textColor: "{colors.ink}"
    rounded: "{rounded.chip}"
    height: "2.5rem"
---

# Design System: Kulhi

## Overview

**Creative North Star: "The Sticker-Bombed Laptop Lid"**

Scope first. This file governs the public website in `web/` only. The desktop app's own windows (`app.html`, the settings panel, the companion, the bubble) keep their incumbent warm look, defined in `src/panel/style.css` and `src/theme.ts`. They are not governed by this DESIGN.md. Work on the app does not inherit the lids, vinyl borders, Shrikhand stickers or tilts described here, and work on the website does not borrow the app panel's tokens.

The site is a laptop lid covered in die-cut vinyl stickers. Each section is a whole lid of one flat, saturated, powder-coated colour (cobalt, hot pink, sunflower, and one ink lid for the phone, away from the desk at night), with a faint grain on top so it reads as paint and not as a screen. Everything placed on a lid is a sticker: a white vinyl border that follows its own outline, a soft lifted shadow under it, and a small hand-placed tilt. The cast are the app's real characters, drawn live by the app's own engine onto canvases, and you can peel them off and drop them somewhere else.

The tone is loud and friendly. The density is generous: one idea per lid, big Shrikhand headings, short copy. The one quiet surface is the pretend desk, a dark device screen inside a lid. On it, colour stops being decoration and only means agent state.

**Key Characteristics:**
- Whole-section flat colour lids, full bleed, with a soft-light grain overlay at 9% opacity.
- Every object on a lid has a white vinyl border and a soft ambient lift, and is rotated a little (roughly -5deg to +6deg).
- Shrikhand display lettering made into stickers: ink or sun fill inside a white die-cut contour.
- Live, draggable character stickers. The characters are the imagery; there are no screenshots or stock pictures.
- Dark device mockups (the agent desk, the phone, small scenes) are the only places that use state colour.

## Colors

Three saturated lid colours and a deep violet-black ink, white vinyl on top of them, and three state colours kept for the pretend devices.

### Primary
- **Lid Cobalt** (cobalt): The hero, "the little things" and closing lids, and the `theme-color`. White text on it; headings on it are sun-yellow.
- **Hot Sticker Pink** (pink): The agents and install lids, the Star button, speech-bubble variants, and the scrollbar thumb.
- **Sunflower** (sun): The crew and private lids, the Download button, step-number discs, the wordmark fill on dark lids, text selection, and focus rings on dark lids.

### Secondary
- **Deep Pink** (pink-deep): Small pink accents that sit on white: the FAQ chevron, the phone notification's app name, and the dashed "your own" slot icon.
- **Hazard Amber** (sun-deep): Only in the hazard-stripe border of the warning labels.

### Tertiary (state, devices only)
- **Working Amber** (work): A pulsing dot while an agent works.
- **Needs-You Pink** (ask): The dot, terminal line and card marker when an agent asks for permission. It has the same hex as Hot Sticker Pink, but on a device it only means "needs you".
- **Done Lime** (done): The finished dot, "ok" terminal lines, and the Allow button on the card and phone.

### Neutral
- **Sticker Ink** (ink): The page ground, the phone lid, the footer, all text on light stickers, the sticker-text stroke, and focus rings on light lids.
- **Soft Ink** (ink-soft): The second stripe of the ink warning label.
- **Vinyl White** (vinyl): Sticker borders, label and bubble faces, button borders, and text on cobalt and ink.
- **Backing Sheet** (sheet): The kiss-cut sheet the cast sits on.
- **Cut Line** (cut): The dashed cut line round each slot on the sheet.
- **Caption Violet-Grey** (caption): Secondary text on white stickers (slot captions, home and step details, FAQ answers, phone body).
- **Soft Tints** (on-cobalt-soft, on-pink-soft, on-ink-soft): Muted text on cobalt and on ink, and the face of the status-only agent tags.
- **Device Black** (device-black): The island, the agent card and the small scene islands, the surfaces of the pretend hardware.

### Named Rules
**The Lid Is One Colour Rule.** A section's background is one flat lid colour edge to edge (plus the grain). Lids are never split, given gradients or given a second ground. Gradients belong only inside device screens and scenes.

**The State Only On The Desk Rule.** Inside a device mockup, amber, pink and lime mean working, needs you and done, and nothing else. Never use them as decoration on a device.

## Typography

**Display Font:** Shrikhand (falls back to Schibsted Grotesk Variable, then serif)
**Body Font:** Schibsted Grotesk Variable (falls back to Segoe UI, then system-ui)
**Label/Mono Font:** Martian Mono, used only for real commands and code

**Character:** Shrikhand's fat, swashy, hand-painted forms recall Gujarati shop lettering and give the desi warmth. Turned into stickers, they carry every heading. Schibsted Grotesk is a sturdy, warm grotesk for everything you actually read. All three fonts are self-hosted through Fontsource.

### Hierarchy
- **Wordmark** (Shrikhand 400, clamp(4.6rem, 14vw, 12rem), 0.95): The hero "Kulhi". A smaller version (clamp(2.8rem, 7vw, 5.2rem)) carries the closing line.
- **Display** (Shrikhand 400, clamp(2.3rem, 5.4vw, 4.4rem), 1.04, max 17ch): Every section heading, always as sticker text.
- **Title** (Shrikhand 400, 1.25 to 1.55rem, 1.1): Character names on the sheet, home titles, warning-label heads, step numbers.
- **Body** (Schibsted 400, 1.0625rem, 1.55, max 62ch): Running copy. Section ledes go up to 1.1 to 1.2rem.
- **Label** (Schibsted 650 to 750, 0.95 to 1.08rem): Buttons, nav, tags, card titles, FAQ summaries.
- **Mono** (Martian Mono 400, 0.7 to 0.84rem, 1.4 to 1.6): Terminal lines, card commands, code in scenes.

### Named Rules
**The Sticker Text Rule.** Display type is never plain ink on a lid. On light lids it is an ink fill with a thick white stroke (0.16em, painted behind the fill). On cobalt and ink lids it is a sun fill, an ink stroke (0.12em) and a white die-cut contour drawn with the eight-direction cut-ring, with extra word spacing. It always has a soft drop shadow and the element's own tilt.

**The Real Commands Only Rule.** Martian Mono appears only where a real command or real code is shown. It is never used for decoration, labels or numbers.

## Layout

One full-bleed lid per section, stacked vertically, each with vertical padding of clamp(4.5rem, 10vw, 8rem). Content sits in a centred column of min(1180px, 100% minus twice clamp(1rem, 4vw, 3rem)). Inside a lid the layout is asymmetric: two-column grids weighted 0.9/1.1, 1.1/0.9 or 0.8/1.2, with gaps of clamp(2rem, 5 to 6vw, 4.5 to 5rem). The hero is a stage, not a grid: copy sits top-left, and the live stickers are placed absolutely by percentage across the right 62% of the lid.

Stickers are placed loosely on purpose. Bubbles are staggered vertically, tags wrap freely, homes break their grid (one overhangs by -1.5rem, and a character steps out over a frame edge). The crew sheet is an auto-fill grid of slots at least 230px wide.

Responsive: at 900px and below, the two-column grids stack, and the hero stage becomes a 420px block under the copy with fixed sticker sizes (230px hero, 104px others). At 560px and below, nav links collapse to the GitHub pill alone, the two action buttons stack, the sheet becomes two columns, and tilts on large containers (the sheet, staggered bubbles) are flattened.

## Elevation & Depth

Depth is physical: stickers sit slightly above a painted lid. Shadows are ambient and soft, tinted with ink (rgb 23 18 43), never pure black on a lid. Hover and holding a sticker raise it. Pure black shadows appear only under device hardware inside a lid (the island, the card, the phone shell), because those are objects on a screen, not stickers.

### Shadow Vocabulary
- **Lift** (`box-shadow: 0 10px 14px rgb(23 18 43 / 0.26), 0 2px 3px rgb(23 18 43 / 0.18)`): The resting shadow for every label, tag, bubble, button, step, FAQ item and warning.
- **High Lift** (`box-shadow: 0 26px 30px rgb(23 18 43 / 0.3), 0 6px 8px rgb(23 18 43 / 0.2)`): Button hover, the crew sheet, and the desk screen.
- **Vinyl Outline** (`filter: drop-shadow(±var(--border) 0 0 #fff) ×4` plus `drop-shadow(0 10px 12px rgb(23 18 43 / 0.28))`): The die-cut white border that follows a character canvas's alpha. The border width scales with the sticker: 9px hero, 8px close, 6px default, 4px for small scene and phone stickers.
- **Cut Ring** (`text-shadow` of white offsets at 0.09em in eight directions): The die-cut contour round sticker text on dark lids.

### Named Rules
**The Zero-Blur Means Vinyl Rule.** Zero-blur offsets are allowed only when they are arranged symmetrically to draw a white vinyl contour (the vinyl outline, the cut ring). A one-directional hard offset shadow is not part of this world.

**The Lift On Touch Rule.** Hover raises a sticker (button: up 3px, straightens to 0deg, high lift; character: scale 1.03 and a deeper shadow). Holding it raises it further (scale 1.1, an extra 5deg of tilt, 34px shadow). Pressing pushes it back down.

## Shapes

Everything is rounded like a die-cut sticker, and nothing has a sharp corner. Radius grows with the object: 10px chips, 14px labels, 16px tags, 18px buttons, 20px cards, 22px bubbles, 24px homes, 28px slots, 34px sheet, 44px phone shell, and full pills for nav links, the island and hints. White vinyl borders are drawn as real borders on rectangular stickers (5px on buttons, 4px on tags and step discs, 6px on the phone shell) and as drop-shadow contours on characters.

Signature forms:
- **The Peel**: a 26px corner folding up at the bottom right, with backing grey on the fold and the lid colour beneath it, used on the hero label and the small promise.
- **The Kiss-Cut Slot**: a 2px dashed cut line round each sheet slot.
- **The Hazard Border**: a 9px border of -45deg stripes (10px bands) on warning labels.
- **The Speech Tail**: a clipped triangle under each bubble.

## Components

### Buttons
Two equal stickers, never a primary and a secondary.
- **Shape:** gently rounded (18px), with a 5px white vinyl border and min-height 3.6rem.
- **Download:** sun face, ink text, Windows icon, tilted -1.5deg. **Star:** pink face, ink text, star icon, tilted +1.5deg. Both are label type at 750 weight, 1.08rem. They sit in a two-column grid with a max width of 38rem.
- **Hover / Focus:** lift up 3px, straighten to 0deg and take the high lift (0.3s, ease-out-expo). Pressing pushes them down 1px with a short shadow. Focus is a 3px ring offset by 4px (ink on light lids, sun on dark).

### Chips (Agent Tags)
- **Style:** a 4px white border, 16px radius and lift, alternating -1.2deg and +1.4deg tilts. The name is in bold and the capability is in a smaller line below it.
- **State:** agents with full Allow/Deny support get a sun face; status-only agents get the pale pink tint.

### Cards / Containers
- **Labels and bubbles:** a white (or sun/pink) face, 14 to 22px radius, lift, and the element's own tilt. Bubbles have the speech tail.
- **Warning labels:** a white or ink face inside the hazard border, with a Shrikhand head.
- **Install steps:** white cards with a Shrikhand number on a sun disc with a white border, each tilted slightly differently.
- **FAQ:** white `details` with an 18px radius and alternating tilts, and a deep-pink chevron that rotates 180deg when open.
- **Internal padding:** about 0.9 to 1.25rem.

### Navigation
- A small Shrikhand "Kulhi" mark in sun with an ink stroke on the left. Pill links (0.45rem by 0.85rem, 650 weight, white) on the right turn white with ink text on hover. GitHub is a permanently ink-filled pill and is the only link kept on mobile.

### Live Character Sticker (signature)
A canvas drawn by the app's own engine (`src/engine`, `src/skins`), wrapped in the vinyl outline, tilted by `data-tilt`, and draggable with grab and grabbing cursors. A poke plays a squish (0.42s). The characters' eyes follow the cursor, and only stickers on screen are drawn. Rui is a still image in the same wrapper. Never put a screenshot or illustration in place of a character.

### Pretend Desk (signature)
A device screen with a 10px ink bezel and a 26px radius on a violet radial gradient. It holds a pill island with a state dot, a terminal, and the app's Allow / Always / Deny card (device black, a mono command, a lime Allow and violet secondary buttons). This is the only surface where state colour carries meaning.

## Do's and Don'ts

### Do:
- **Do** give every section one flat lid colour (cobalt, pink, sun, or ink for the phone) with the 9% soft-light grain.
- **Do** give every object on a lid a white vinyl border, the ink-tinted lift, and a small tilt set with `data-tilt`.
- **Do** set section headings as sticker text: ink fill and white stroke on light lids; sun fill, ink stroke and cut ring on cobalt and ink lids.
- **Do** keep Download and Star as two equal stickers, side by side.
- **Do** show the real, live characters from the app's engine wherever a character appears.
- **Do** respect `prefers-reduced-motion`. Motion collapses to near-instant and the characters get the engine's reduced-motion mode.

### Don't:
- **Don't** apply this world to the desktop app's windows (app.html, panel, companion, bubble). They keep the warm panel tokens in `src/panel/style.css` and `src/theme.ts`.
- **Don't** use working amber, needs-you pink or done lime as decoration inside a device mockup; there they mean agent state only.
- **Don't** put gradients on a lid; gradients live only inside device screens and scenes.
- **Don't** use Martian Mono for anything but real commands and code.
- **Don't** use one-directional hard offset shadows. Zero-blur offsets are only for symmetric vinyl contours.
- **Don't** replace live characters with screenshots, and don't add invented stats, testimonials or star counts.
